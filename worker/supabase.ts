import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeText } from "../src/normalize.js";
import type { ChatListPublisher } from "./chatListPublisher.js";

export const liffSessionTtlMs = 20 * 60 * 1000;

export interface WorkerEnv {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  BOT_DISPLAY_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LIFF_ID: string;
  MAPS_BROWSER_KEY?: string;
  GOOGLE_MAPS_API_KEY: string;
  GOOGLE_REGION_CODE?: string;
  GOOGLE_LANGUAGE_CODE?: string;
  GOOGLE_DAILY_VALIDATION_LIMIT?: string;
  GOOGLE_GROUP_DAILY_VALIDATION_LIMIT?: string;
  BOT_MAINTENANCE_MODE?: string;
  CHAT_LIST_PUBLISHER: DurableObjectNamespace<ChatListPublisher>;
}

export interface RestaurantItemRow {
  id: number;
  chat_id: string;
  name: string;
  normalized_name: string;
  source: string;
  google_place_id: string | null;
  matched_name: string | null;
  matched_address: string | null;
  matched_types_json: string;
  created_at: string;
}

export interface LiffFlowSessionRow {
  id: string;
  chat_id: string;
  owner_user_id: string;
  action: "add" | "remove" | "show" | "map_link";
  item_name: string | null;
  expires_at: string;
  used_at: string | null;
}

export interface LiffMapCandidateRow {
  id: string;
  session_id: string;
  item_id: number | null;
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  primary_type: string | null;
  types_json: string;
  expires_at: string;
}

export type LiffMapSearchReservation = "reserved" | "rate_limited" | "google_quota_reached" | "invalid_session";

export function supabase(env: WorkerEnv): SupabaseClient {
  const isNewSecretKey = env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    // New Supabase secret keys are API keys, not JWTs. The SDK otherwise adds them as Bearer tokens for REST calls.
    global: isNewSecretKey ? { fetch: fetchWithoutAuthorization } : undefined
  });
}

async function fetchWithoutAuthorization(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.delete("Authorization");
  return fetch(input, { ...init, headers });
}

export async function listItems(client: SupabaseClient, chatId: string): Promise<RestaurantItemRow[]> {
  const { data, error } = await client.from("restaurant_items").select("*").eq("chat_id", chatId).order("id");
  if (error) throw new Error(`List restaurants failed: ${error.message}`);
  return (data ?? []) as RestaurantItemRow[];
}

export async function findItem(client: SupabaseClient, chatId: string, name: string): Promise<RestaurantItemRow | null> {
  const { data, error } = await client
    .from("restaurant_items")
    .select("*")
    .eq("chat_id", chatId)
    .eq("normalized_name", normalizeText(name))
    .maybeSingle();
  if (error) throw new Error(`Find restaurant failed: ${error.message}`);
  return data as RestaurantItemRow | null;
}

export async function addItem(client: SupabaseClient, chatId: string, rawName: string): Promise<{ item: RestaurantItemRow; created: boolean }> {
  const name = rawName.trim();
  if (!name) throw new Error("Restaurant name is required");

  const existing = await findItem(client, chatId, name);
  if (existing) return { item: existing, created: false };

  const { data, error } = await client
    .from("restaurant_items")
    .insert({ chat_id: chatId, name, normalized_name: normalizeText(name), source: "user_input", matched_types_json: "[]" })
    .select("*")
    .single();

  if (!error) return { item: data as RestaurantItemRow, created: true };
  if (error.code === "23505") {
    const item = await findItem(client, chatId, name);
    if (item) return { item, created: false };
  }
  throw new Error(`Add restaurant failed: ${error.message}`);
}

export async function removeItem(client: SupabaseClient, chatId: string, name: string): Promise<boolean> {
  const { data, error } = await client
    .from("restaurant_items")
    .delete()
    .eq("chat_id", chatId)
    .eq("normalized_name", normalizeText(name))
    .select("id");
  if (error) throw new Error(`Remove restaurant failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function removeItems(client: SupabaseClient, chatId: string, ids: number[]): Promise<number> {
  const uniqueIds = [...new Set(ids)].filter(Number.isInteger);
  if (uniqueIds.length === 0) return 0;
  const { data, error } = await client
    .from("restaurant_items")
    .delete()
    .eq("chat_id", chatId)
    .in("id", uniqueIds)
    .select("id");
  if (error) throw new Error(`Remove restaurants failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function addPlaceItem(client: SupabaseClient, chatId: string, candidate: LiffMapCandidateRow): Promise<boolean> {
  const name = candidate.display_name?.trim();
  if (!name) throw new Error("Google place has no display name");

  const { error } = await client
    .from("restaurant_items")
    .insert({
      chat_id: chatId,
      name,
      normalized_name: normalizeText(name),
      source: "google_places",
      google_place_id: candidate.place_id,
      matched_name: candidate.display_name,
      matched_address: candidate.formatted_address,
      matched_types_json: candidate.types_json
    });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Add Google place failed: ${error.message}`);
}

export async function createLiffSession(
  client: SupabaseClient,
  chatId: string,
  ownerUserId: string,
  action: LiffFlowSessionRow["action"],
  itemName: string | null = null
): Promise<LiffFlowSessionRow> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + liffSessionTtlMs).toISOString();
  const { data, error } = await client
    .from("liff_flow_sessions")
    .insert({ id, chat_id: chatId, owner_user_id: ownerUserId, action, item_name: itemName, expires_at: expiresAt })
    .select("*")
    .single();
  if (error) throw new Error(`Create LIFF session failed: ${error.message}`);
  return data as LiffFlowSessionRow;
}

export async function getLiffSession(
  client: SupabaseClient,
  id: string,
  ownerUserId: string
): Promise<LiffFlowSessionRow | null> {
  const { data, error } = await client
    .from("liff_flow_sessions")
    .select("*")
    .eq("id", id)
    .eq("owner_user_id", ownerUserId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Read LIFF session failed: ${error.message}`);
  return data as LiffFlowSessionRow | null;
}

export async function isLiffSessionOwnedByAnotherUser(
  client: SupabaseClient,
  id: string,
  ownerUserId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("liff_flow_sessions")
    .select("id")
    .eq("id", id)
    .neq("owner_user_id", ownerUserId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Read LIFF session owner failed: ${error.message}`);
  return Boolean(data);
}

export async function setLiffMapItem(
  client: SupabaseClient,
  id: string,
  ownerUserId: string,
  itemName: string
): Promise<LiffFlowSessionRow | null> {
  const { data, error } = await client
    .from("liff_flow_sessions")
    .update({ item_name: itemName.trim() })
    .eq("id", id)
    .eq("owner_user_id", ownerUserId)
    .eq("action", "map_link")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Set LIFF map item failed: ${error.message}`);
  return data as LiffFlowSessionRow | null;
}

export async function consumeLiffSession(client: SupabaseClient, id: string, ownerUserId: string): Promise<LiffFlowSessionRow | null> {
  const { data, error } = await client.rpc("bot_take_liff_flow_session", {
    p_session_id: id,
    p_owner_user_id: ownerUserId
  });
  if (error) throw new Error(`Consume LIFF session failed: ${error.message}`);
  return (data?.[0] ?? null) as LiffFlowSessionRow | null;
}

export async function reserveGoogleCall(client: SupabaseClient, chatId: string, globalLimit: number, groupLimit: number): Promise<boolean> {
  const { data, error } = await client.rpc("bot_reserve_google_call", {
    p_chat_id: chatId,
    p_global_limit: globalLimit,
    p_group_limit: groupLimit
  });
  if (error) throw new Error(`Reserve Google quota failed: ${error.message}`);
  return data === true;
}

export async function reserveLiffMapSearch(
  client: SupabaseClient,
  session: LiffFlowSessionRow,
  globalLimit: number,
  groupLimit: number
): Promise<LiffMapSearchReservation> {
  const { data, error } = await client.rpc("bot_reserve_liff_map_search", {
    p_session_id: session.id,
    p_owner_user_id: session.owner_user_id,
    p_chat_id: session.chat_id,
    p_global_limit: globalLimit,
    p_group_limit: groupLimit,
    p_cooldown_seconds: 15
  });
  if (error) throw new Error(`Reserve LIFF map search failed: ${error.message}`);
  return data as LiffMapSearchReservation;
}

export async function cleanupExpiredLiffData(client: SupabaseClient, cutoff: string): Promise<void> {
  const { error: sessionError } = await client.from("liff_flow_sessions").delete().lt("expires_at", cutoff);
  if (sessionError) throw new Error(`Clean expired LIFF sessions failed: ${sessionError.message}`);

  const { error: rateLimitError } = await client.from("liff_map_search_rate_limits").delete().lt("last_search_at", cutoff);
  if (rateLimitError) throw new Error(`Clean LIFF map search limits failed: ${rateLimitError.message}`);
}
