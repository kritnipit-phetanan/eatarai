import { FetchGooglePlacesClient } from "../src/googlePlaces.js";
import { hasBotMentionPrefix } from "../src/normalize.js";
import { parseCommand } from "../src/parser.js";
export { ChatListPublisher } from "./chatListPublisher.js";
import { renderLiffPage } from "./liffPage.js";
import { enqueueLatestList } from "./chatListPublisher.js";
import { listMessage } from "./listMessage.js";
import { getChatId, getLineMemberDisplayName, getLineProfile, getLineTargetId, replyLine, replyLineMessages, type WorkerLineEvent, verifyLineSignature } from "./line.js";
import {
  addItem,
  addPlaceItem,
  cleanupExpiredLiffData,
  consumeLiffSession,
  createLiffSession,
  findItem,
  getLiffSession,
  isLiffSessionOwnedByAnotherUser,
  listItems,
  removeItems,
  removeItem,
  reserveLiffMapSearch,
  liffSessionTtlMs,
  supabase,
  type LiffFlowSessionRow,
  type LiffMapCandidateRow,
  type WorkerEnv
} from "./supabase.js";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/liff") return new Response(renderLiffPage(env.LIFF_ID), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname.startsWith("/api/liff/")) return handleLiffApi(request, env, url);
    if (request.method === "POST" && url.pathname === "/line/webhook") return handleWebhook(request, env);
    return json({ error: "not_found" }, 404);
  },
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanupLiffData(env));
  }
} satisfies ExportedHandler<WorkerEnv>;

async function handleWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  const rawBody = await request.text();
  console.log(JSON.stringify({ event: "line_webhook_arrived", bodySize: rawBody.length }));
  const valid = await verifyLineSignature(rawBody, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET);
  if (!valid) {
    console.error(JSON.stringify({ event: "line_webhook_rejected", reason: "invalid_signature" }));
    return json({ error: "invalid_signature" }, 401);
  }

  const payload = JSON.parse(rawBody) as { events?: WorkerLineEvent[] };
  const events = payload.events ?? [];
  console.log(JSON.stringify({ event: "line_webhook_received", eventCount: events.length }));
  try {
    await Promise.all(events.map((event) => handleLineEvent(event, env)));
  } catch (error) {
    console.error(JSON.stringify({ event: "line_event_failed", error: String(error) }));
    return json({ error: "event_processing_failed" }, 500);
  }
  return json({ ok: true });
}

async function handleLineEvent(event: WorkerLineEvent, env: WorkerEnv): Promise<void> {
  const chatId = getChatId(event);
  const replyToken = event.replyToken;
  const userId = event.source?.userId;
  if (!chatId || !replyToken || !userId || event.type !== "message" || event.message?.type !== "text" || !event.message.text) {
    console.log(JSON.stringify({
      event: "line_event_ignored",
      reason: !chatId ? "missing_chat" : !replyToken ? "missing_reply_token" : !userId ? "missing_user" : "unsupported_event",
      type: event.type,
      messageType: event.message?.type
    }));
    return;
  }

  const text = event.message.text;
  const structuredMention = event.message.mention?.mentionees?.some((mentionee) => mentionee.isSelf) ?? false;
  const textMention = hasBotMentionPrefix(text, env.BOT_DISPLAY_NAME);
  const command = parseCommand(text, env.BOT_DISPLAY_NAME, structuredMention || textMention);
  const client = supabase(env);

  console.log(JSON.stringify({
    event: "line_command_processed",
    command: command.kind,
    structuredMention,
    textMention,
    hasResponse: command.kind !== "ignore"
  }));
  if (command.kind === "ignore") return;
  if (isMaintenanceMode(env)) {
    await replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, textMessage("ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง"));
    return;
  }
  if (command.kind === "menu") {
    await replyLineMessages(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, await menuMessages(client, env, chatId, userId, event.source));
    return;
  }
  if (command.kind === "add") {
    if (!command.item.trim()) return replyLine(env.LINE_CHANNEL_ACCESS_TOKEN, replyToken, textMessage("ระบุชื่อร้านหรืออาหารที่อยากเพิ่ม"));
    await addItem(client, chatId, command.item);
    await enqueueLatestList(env, chatId);
    return;
  }
  if (command.kind === "remove") {
    await removeItem(client, chatId, command.item);
    await enqueueLatestList(env, chatId);
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
  if (isMaintenanceMode(env)) return corsJson({ error: "maintenance_mode" }, 503);
  try {
    const accessToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return corsJson({ error: "missing_liff_access_token" }, 401);
    const profile = await getLineProfile(accessToken);
    const client = supabase(env);

    if (request.method === "GET" && url.pathname === "/api/liff/session") {
      const id = url.searchParams.get("session");
      if (!id) return corsJson({ error: "missing_session" }, 400);
      const session = await getLiffSession(client, id, profile.userId);
      if (!session) return corsJson({ error: await liffSessionError(client, id, profile.userId) }, 404);
      const items = session.action === "remove" ? await listItems(client, session.chat_id) : [];
      return corsJson({ action: session.action, itemName: session.item_name, items });
    }

    const payload = await request.json().catch(() => ({})) as LiffPayload;
    if (!payload.sessionId) return corsJson({ error: "missing_session" }, 400);
    const session = await getLiffSession(client, payload.sessionId, profile.userId);
    if (!session) return corsJson({ error: await liffSessionError(client, payload.sessionId, profile.userId) }, 404);

    if (request.method === "POST" && url.pathname === "/api/liff/map-search") return searchMapCandidates(client, env, session, payload);
    if (request.method === "POST" && url.pathname === "/api/liff/complete") return completeLiffFlow(client, env, session, profile.userId, payload);
    return corsJson({ error: "not_found" }, 404);
  } catch (error) {
    console.error(JSON.stringify({ event: "liff_api_failed", error: String(error) }));
    return corsJson({ error: "internal_error" }, 500);
  }
}

async function liffSessionError(
  client: ReturnType<typeof supabase>,
  sessionId: string,
  userId: string
): Promise<"invalid_or_expired_session" | "session_owned_by_another_user"> {
  return await isLiffSessionOwnedByAnotherUser(client, sessionId, userId)
    ? "session_owned_by_another_user"
    : "invalid_or_expired_session";
}

async function completeLiffFlow(
  client: ReturnType<typeof supabase>,
  env: WorkerEnv,
  session: LiffFlowSessionRow,
  userId: string,
  payload: LiffPayload
): Promise<Response> {
  if (!getLineTargetId(session.chat_id)) return corsJson({ error: "invalid_chat" }, 400);
  let removedCount: number | undefined;
  let alreadyRemovedCount: number | undefined;
  if (session.action === "add") {
    const candidates = await getSelectedCandidates(client, session, payload.candidateIds);
    if (candidates.length === 0) return corsJson({ error: "candidate_required" }, 400);
    await Promise.all(candidates.map((candidate) => addPlaceItem(client, session.chat_id, candidate)));
  } else if (session.action === "remove") {
    const itemIds = [...new Set(payload.itemIds ?? [])].filter(Number.isInteger);
    if (itemIds.length === 0) return corsJson({ error: "item_required" }, 400);
    removedCount = await removeItems(client, session.chat_id, itemIds);
    alreadyRemovedCount = itemIds.length - removedCount;
  } else if (session.action === "map_link") {
    if (!payload.candidateId) return corsJson({ error: "candidate_required" }, 400);
    const { data, error } = await client.from("liff_map_candidates").select("*").eq("id", payload.candidateId).eq("session_id", session.id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw new Error(`Read map candidate failed: ${error.message}`);
    if (!data) return corsJson({ error: "invalid_or_expired_candidate" }, 404);
    const candidate = data as { item_id: number | null; place_id: string; display_name: string | null; formatted_address: string | null; types_json: string };
    if (candidate.item_id === null) return corsJson({ error: "invalid_or_expired_candidate" }, 404);
    const { error: updateError } = await client.from("restaurant_items").update({
      source: "google_places", google_place_id: candidate.place_id, matched_name: candidate.display_name,
      matched_address: candidate.formatted_address, matched_types_json: candidate.types_json
    }).eq("id", candidate.item_id).eq("chat_id", session.chat_id);
    if (updateError) throw new Error(`Save map link failed: ${updateError.message}`);
  }

  const consumed = await consumeLiffSession(client, session.id, userId);
  if (!consumed) return corsJson({ error: "session_already_used" }, 409);
  await enqueueLatestList(env, session.chat_id);
  return corsJson({ ok: true, removedCount, alreadyRemovedCount });
}

async function searchMapCandidates(
  client: ReturnType<typeof supabase>,
  env: WorkerEnv,
  session: LiffFlowSessionRow,
  payload: LiffPayload
): Promise<Response> {
  if (
    typeof payload.latitude !== "number" || !Number.isFinite(payload.latitude) || payload.latitude < -90 || payload.latitude > 90 ||
    typeof payload.longitude !== "number" || !Number.isFinite(payload.longitude) || payload.longitude < -180 || payload.longitude > 180
  ) return corsJson({ error: "invalid_map_search" }, 400);
  let itemId: number | null = null;
  let query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (session.action === "map_link") {
    if (!session.item_name) return corsJson({ error: "invalid_map_search" }, 400);
    const item = await findItem(client, session.chat_id, session.item_name);
    if (!item) return corsJson({ error: "restaurant_not_found" }, 404);
    itemId = item.id;
    query = item.name;
  } else if (session.action !== "add" || !query) {
    return corsJson({ error: "invalid_map_search" }, 400);
  }
  if (query.length > 120) return corsJson({ error: "query_too_long" }, 400);
  const reservation = await reserveLiffMapSearch(
    client,
    session,
    numericEnv(env.GOOGLE_DAILY_VALIDATION_LIMIT, 500),
    numericEnv(env.GOOGLE_GROUP_DAILY_VALIDATION_LIMIT, 30)
  );
  if (reservation === "rate_limited") return corsJson({ error: "map_search_rate_limited" }, 429);
  if (reservation === "google_quota_reached") return corsJson({ error: "google_quota_reached" }, 429);
  if (reservation !== "reserved") return corsJson({ error: "invalid_or_expired_session" }, 409);
  const places = await new FetchGooglePlacesClient().searchLocations(query, payload.latitude, payload.longitude, {
    apiKey: env.GOOGLE_MAPS_API_KEY, regionCode: env.GOOGLE_REGION_CODE ?? "TH", languageCode: env.GOOGLE_LANGUAGE_CODE ?? "th"
  });
  const candidates = await Promise.all(places.map(async (place) => {
    const id = crypto.randomUUID();
    const { error } = await client.from("liff_map_candidates").insert({
      id, session_id: session.id, item_id: itemId, requested_name: query, place_id: place.placeId, display_name: place.displayName,
      formatted_address: place.formattedAddress, primary_type: place.primaryType, types_json: JSON.stringify(place.types),
      expires_at: new Date(Date.now() + liffSessionTtlMs).toISOString()
    });
    if (error) throw new Error(`Save map candidate failed: ${error.message}`);
    return { id, name: place.displayName, address: place.formattedAddress };
  }));
  return corsJson({ candidates });
}

async function menuMessages(
  client: ReturnType<typeof supabase>,
  env: WorkerEnv,
  chatId: string,
  userId: string,
  source: WorkerLineEvent["source"]
): Promise<Record<string, unknown>[]> {
  const [add, remove, message, displayName] = await Promise.all([
    createLiffSession(client, chatId, userId, "add"),
    createLiffSession(client, chatId, userId, "remove"),
    listMessage(client, chatId),
    getLineMemberDisplayName(env.LINE_CHANNEL_ACCESS_TOKEN, source)
  ]);
  return [message, privateMenuFlex(displayName, liffUri(env, add.id), liffUri(env, remove.id))];
}

interface LiffPayload {
  sessionId?: string;
  query?: string;
  candidateId?: string;
  candidateIds?: string[];
  itemIds?: number[];
  latitude?: number;
  longitude?: number;
}

async function getSelectedCandidates(
  client: ReturnType<typeof supabase>,
  session: LiffFlowSessionRow,
  candidateIds: string[] | undefined
): Promise<LiffMapCandidateRow[]> {
  const ids = [...new Set(candidateIds ?? [])];
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("liff_map_candidates")
    .select("*")
    .eq("session_id", session.id)
    .in("id", ids)
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(`Read selected map candidates failed: ${error.message}`);
  if ((data?.length ?? 0) !== ids.length) return [];
  return data as LiffMapCandidateRow[];
}

function textMessage(text: string): Record<string, unknown> { return { type: "text", text }; }
function privateMenuFlex(displayName: string | null, addUri: string, removeUri: string): Record<string, unknown> {
  const owner = displayName ? compactDisplayName(displayName) : "คุณ";
  return {
    type: "flex",
    altText: `เมนูส่วนตัวของ ${owner}`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: `เมนูของ ${owner}`, weight: "bold", size: "lg", wrap: true, maxLines: 2 },
          { type: "text", text: "เลือกเพิ่มหรือลดรายการ แล้วบอทจะประกาศรายการล่าสุดในกลุ่ม", size: "sm", color: "#666666", wrap: true },
          { type: "separator" },
          { type: "text", text: "ลิงก์นี้ใช้ได้เฉพาะผู้ที่เรียกบอต คนอื่นให้เมนชันบอตเพื่อเปิดเมนูของตนเอง", size: "xs", color: "#888888", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", action: { type: "uri", label: "เพิ่มรายการ", uri: addUri } },
          { type: "button", style: "secondary", action: { type: "uri", label: "ลดรายการ", uri: removeUri } }
        ]
      }
    }
  };
}
function compactDisplayName(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > 40 ? `${characters.slice(0, 40).join("")}…` : normalized || "คุณ";
}
function liffPromptMessage(label: string, uri: string): Record<string, unknown> { return { type: "text", text: `${label}: เปิดเมนูส่วนตัวเพื่อดำเนินการต่อ`, quickReply: { items: [uriQuickReply(label, uri)] } }; }
function uriQuickReply(label: string, uri: string): Record<string, unknown> { return { type: "action", action: { type: "uri", label, uri } }; }
function liffUri(env: WorkerEnv, sessionId: string): string { return `https://liff.line.me/${encodeURIComponent(env.LIFF_ID)}?session=${encodeURIComponent(sessionId)}`; }
function isMaintenanceMode(env: WorkerEnv): boolean { return ["1", "true", "yes", "on"].includes(env.BOT_MAINTENANCE_MODE?.trim().toLowerCase() ?? ""); }
function numericEnv(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
async function cleanupLiffData(env: WorkerEnv): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await cleanupExpiredLiffData(supabase(env), cutoff);
    console.log(JSON.stringify({ event: "liff_data_cleaned", cutoff }));
  } catch (error) {
    console.error(JSON.stringify({ event: "liff_data_cleanup_failed", error: String(error) }));
    throw error;
  }
}
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function corsJson(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...corsHeaders() } }); }
function corsHeaders(): Record<string, string> { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; }
