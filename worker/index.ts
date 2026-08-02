import { FetchGooglePlacesClient } from "../src/googlePlaces.js";
import { hasBotMentionPrefix } from "../src/normalize.js";
import { parseCommand } from "../src/parser.js";
import { renderLiffPage } from "./liffPage.js";
import { getChatId, getLineProfile, getLineTargetId, pushLine, replyLine, type WorkerLineEvent, verifyLineSignature } from "./line.js";
import {
  addItem,
  consumeLiffSession,
  createLiffSession,
  findItem,
  getLiffSession,
  listItems,
  removeItem,
  reserveGoogleCall,
  setLiffMapItem,
  supabase,
  type LiffFlowSessionRow,
  type RestaurantItemRow,
  type WorkerEnv
} from "./supabase.js";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/liff") return new Response(renderLiffPage(env.LIFF_ID, env.MAPS_BROWSER_KEY), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname.startsWith("/api/liff/")) return handleLiffApi(request, env, url);
    if (request.method === "POST" && url.pathname === "/line/webhook") return handleWebhook(request, env, ctx);
    return json({ error: "not_found" }, 404);
  }
} satisfies ExportedHandler<WorkerEnv>;

async function handleWebhook(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
  const rawBody = await request.text();
  const valid = await verifyLineSignature(rawBody, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET);
  if (!valid) return json({ error: "invalid_signature" }, 401);

  const payload = JSON.parse(rawBody) as { events?: WorkerLineEvent[] };
  const events = payload.events ?? [];
  console.log(JSON.stringify({ event: "line_webhook_received", eventCount: events.length }));
  ctx.waitUntil(Promise.all(events.map((event) => handleLineEvent(event, env))));
  return json({ ok: true });
}

async function handleLineEvent(event: WorkerLineEvent, env: WorkerEnv): Promise<void> {
  const chatId = getChatId(event);
  const replyToken = event.replyToken;
  const userId = event.source?.userId;
  if (!chatId || !replyToken || !userId || event.type !== "message" || event.message?.type !== "text" || !event.message.text) return;

  const text = event.message.text;
  const structuredMention = event.message.mention?.mentionees?.some((mentionee) => mentionee.isSelf) ?? false;
  const textMention = hasBotMentionPrefix(text, env.BOT_DISPLAY_NAME);
  const command = parseCommand(text, env.BOT_DISPLAY_NAME, structuredMention || textMention);
  const client = supabase(env);

  if (command.kind === "ignore") return;
  if (command.kind === "menu") {
    await replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, await menuMessage(client, env, chatId, userId));
    return;
  }
  if (command.kind === "add") {
    if (!command.item.trim()) return replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, textMessage("ระบุชื่อร้านหรืออาหารที่อยากเพิ่ม"));
    await addItem(client, chatId, command.item);
    await replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, await listMessage(client, chatId));
    return;
  }
  if (command.kind === "remove") {
    const removed = await removeItem(client, chatId, command.item);
    const list = await listMessage(client, chatId);
    if (list.type === "text") list.text = removed ? list.text : `ไม่เจอ "${command.item}" ในลิสต์\n\n${String(list.text)}`;
    await replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, list);
    return;
  }
  if (command.kind === "show") {
    await replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, await listMessage(client, chatId));
    return;
  }
  if (command.kind === "map_link") {
    const item = await findItem(client, chatId, command.item);
    if (!item) return replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, textMessage(`ไม่เจอ "${command.item}" ในลิสต์ของแชตนี้`));
    const session = await createLiffSession(client, chatId, userId, "map_link", item.name);
    await replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, liffPromptMessage("เพิ่มแผนที่", liffUri(env, session.id)));
  }
}

async function handleLiffApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  try {
    const accessToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return corsJson({ error: "missing_liff_access_token" }, 401);
    const profile = await getLineProfile(accessToken);
    const client = supabase(env);

    if (request.method === "GET" && url.pathname === "/api/liff/session") {
      const id = url.searchParams.get("session");
      if (!id) return corsJson({ error: "missing_session" }, 400);
      const session = await getLiffSession(client, id, profile.userId);
      if (!session) return corsJson({ error: "invalid_or_expired_session" }, 404);
      return corsJson({ action: session.action, itemName: session.item_name });
    }

    const payload = await request.json().catch(() => ({})) as { sessionId?: string; name?: string; candidateId?: string; latitude?: number; longitude?: number };
    if (!payload.sessionId) return corsJson({ error: "missing_session" }, 400);
    const session = await getLiffSession(client, payload.sessionId, profile.userId);
    if (!session) return corsJson({ error: "invalid_or_expired_session" }, 404);

    if (request.method === "POST" && url.pathname === "/api/liff/map-item") return setMapItem(client, session, profile.userId, payload);
    if (request.method === "POST" && url.pathname === "/api/liff/map-search") return searchMapCandidates(client, env, session, payload);
    if (request.method === "POST" && url.pathname === "/api/liff/complete") return completeLiffFlow(client, env, session, profile.userId, payload);
    return corsJson({ error: "not_found" }, 404);
  } catch (error) {
    console.error(JSON.stringify({ event: "liff_api_failed", error: String(error) }));
    return corsJson({ error: "internal_error" }, 500);
  }
}

async function setMapItem(
  client: ReturnType<typeof supabase>,
  session: LiffFlowSessionRow,
  userId: string,
  payload: { name?: string }
): Promise<Response> {
  if (session.action !== "map_link" || !payload.name?.trim()) return corsJson({ error: "restaurant_name_required" }, 400);
  const item = await findItem(client, session.chat_id, payload.name);
  if (!item) return corsJson({ error: "restaurant_not_found" }, 404);
  const saved = await setLiffMapItem(client, session.id, userId, item.name);
  if (!saved) return corsJson({ error: "invalid_or_expired_session" }, 404);
  return corsJson({ itemName: item.name });
}

async function completeLiffFlow(
  client: ReturnType<typeof supabase>,
  env: WorkerEnv,
  session: LiffFlowSessionRow,
  userId: string,
  payload: { name?: string; candidateId?: string }
): Promise<Response> {
  const target = getLineTargetId(session.chat_id);
  if (!target) return corsJson({ error: "invalid_chat" }, 400);
  if (session.action === "add") {
    if (!payload.name?.trim()) return corsJson({ error: "restaurant_name_required" }, 400);
    await addItem(client, session.chat_id, payload.name);
  } else if (session.action === "remove") {
    if (!payload.name?.trim()) return corsJson({ error: "restaurant_name_required" }, 400);
    await removeItem(client, session.chat_id, payload.name);
  } else if (session.action === "map_link") {
    if (!payload.candidateId) return corsJson({ error: "candidate_required" }, 400);
    const { data, error } = await client.from("liff_map_candidates").select("*").eq("id", payload.candidateId).eq("session_id", session.id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw new Error(`Read map candidate failed: ${error.message}`);
    if (!data) return corsJson({ error: "invalid_or_expired_candidate" }, 404);
    const candidate = data as { item_id: number; place_id: string; display_name: string | null; formatted_address: string | null; types_json: string };
    const { error: updateError } = await client.from("restaurant_items").update({
      source: "google_places", google_place_id: candidate.place_id, matched_name: candidate.display_name,
      matched_address: candidate.formatted_address, matched_types_json: candidate.types_json
    }).eq("id", candidate.item_id).eq("chat_id", session.chat_id);
    if (updateError) throw new Error(`Save map link failed: ${updateError.message}`);
  }

  const consumed = await consumeLiffSession(client, session.id, userId);
  if (!consumed) return corsJson({ error: "session_already_used" }, 409);
  await pushLine(env.LINE_CHANNEL_ACCESS_TOKEN, target, await listMessage(client, session.chat_id));
  return corsJson({ ok: true });
}

async function searchMapCandidates(
  client: ReturnType<typeof supabase>,
  env: WorkerEnv,
  session: LiffFlowSessionRow,
  payload: { latitude?: number; longitude?: number }
): Promise<Response> {
  if (session.action !== "map_link" || !session.item_name || payload.latitude === undefined || payload.longitude === undefined) return corsJson({ error: "invalid_map_search" }, 400);
  const item = await findItem(client, session.chat_id, session.item_name);
  if (!item) return corsJson({ error: "restaurant_not_found" }, 404);
  const reserved = await reserveGoogleCall(client, session.chat_id, numericEnv(env.GOOGLE_DAILY_VALIDATION_LIMIT, 500), numericEnv(env.GOOGLE_GROUP_DAILY_VALIDATION_LIMIT, 30));
  if (!reserved) return corsJson({ error: "google_quota_reached" }, 429);
  const places = await new FetchGooglePlacesClient().searchLocations(item.name, payload.latitude, payload.longitude, {
    apiKey: env.GOOGLE_MAPS_API_KEY, regionCode: env.GOOGLE_REGION_CODE ?? "TH", languageCode: env.GOOGLE_LANGUAGE_CODE ?? "th"
  });
  const candidates = await Promise.all(places.map(async (place) => {
    const id = crypto.randomUUID();
    const { error } = await client.from("liff_map_candidates").insert({
      id, session_id: session.id, item_id: item.id, place_id: place.placeId, display_name: place.displayName,
      formatted_address: place.formattedAddress, primary_type: place.primaryType, types_json: JSON.stringify(place.types),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    if (error) throw new Error(`Save map candidate failed: ${error.message}`);
    return { id, name: place.displayName, address: place.formattedAddress };
  }));
  return corsJson({ candidates });
}

async function menuMessage(client: ReturnType<typeof supabase>, env: WorkerEnv, chatId: string, userId: string): Promise<Record<string, unknown>> {
  const [add, remove, show, map] = await Promise.all([
    createLiffSession(client, chatId, userId, "add"), createLiffSession(client, chatId, userId, "remove"),
    createLiffSession(client, chatId, userId, "show"), createLiffSession(client, chatId, userId, "map_link")
  ]);
  return {
    // LINE Quick Reply must be attached to a message. A zero-width text keeps the group free of an instruction bubble.
    type: "text", text: "\u200b", quickReply: { items: [
      uriQuickReply("เพิ่มรายการ", liffUri(env, add.id)), uriQuickReply("ลดรายการ", liffUri(env, remove.id)),
      uriQuickReply("ดูรายการ", liffUri(env, show.id)), uriQuickReply("เพิ่มแผนที่", liffUri(env, map.id))
    ] }
  };
}

async function listMessage(client: ReturnType<typeof supabase>, chatId: string): Promise<Record<string, unknown>> {
  const items = await listItems(client, chatId);
  if (items.length === 0) return textMessage("ยังไม่มีรายการที่อยากกิน");
  if (!items.some((item) => item.google_place_id)) return textMessage(formatList(items));
  return {
    type: "flex", altText: "รายการที่อยากกิน", contents: {
      type: "bubble", size: "mega", body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: "รายการที่อยากกิน", weight: "bold", size: "lg" }, { type: "separator" }, ...items.map(flexListItem)
      ] }
    }
  };
}

function flexListItem(item: RestaurantItemRow, index: number): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [{ type: "text", text: `${index + 1}. ${item.name}`, size: "sm", wrap: true, flex: 1 }];
  if (item.google_place_id) contents.push({ type: "button", style: "link", height: "sm", flex: 0, action: { type: "uri", label: "Map", uri: mapsUrl(item.matched_name ?? item.name, item.google_place_id) } });
  return { type: "box", layout: "horizontal", alignItems: "center", contents };
}

function formatList(items: RestaurantItemRow[]): string { return ["รายการที่อยากกิน:", ...items.map((item, index) => `${index + 1}. ${item.name}`)].join("\n"); }
function textMessage(text: string): Record<string, unknown> { return { type: "text", text }; }
function liffPromptMessage(label: string, uri: string): Record<string, unknown> { return { type: "text", text: `${label}: เปิดเมนูส่วนตัวเพื่อดำเนินการต่อ`, quickReply: { items: [uriQuickReply(label, uri)] } }; }
function uriQuickReply(label: string, uri: string): Record<string, unknown> { return { type: "action", action: { type: "uri", label, uri } }; }
function liffUri(env: WorkerEnv, sessionId: string): string { return `https://liff.line.me/${encodeURIComponent(env.LIFF_ID)}?session=${encodeURIComponent(sessionId)}`; }
function mapsUrl(name: string, placeId: string): string { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`; }
function numericEnv(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function corsJson(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...corsHeaders() } }); }
function corsHeaders(): Record<string, string> { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; }
