export interface WorkerLineEvent {
  type: string;
  replyToken?: string;
  source?: {
    type?: "group" | "room" | "user";
    groupId?: string;
    roomId?: string;
    userId?: string;
  };
  message?: {
    type?: string;
    text?: string;
    mention?: { mentionees?: Array<{ isSelf?: boolean }> };
  };
}

export async function verifyLineSignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const actual = base64ToBytes(signature);
  if (actual.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= actual[index]! ^ expected[index]!;
  return mismatch === 0;
}

export function getChatId(event: WorkerLineEvent): string | null {
  const source = event.source;
  if (!source?.type) return null;
  if (source.type === "group" && source.groupId) return `group:${source.groupId}`;
  if (source.type === "room" && source.roomId) return `room:${source.roomId}`;
  if (source.type === "user" && source.userId) return `user:${source.userId}`;
  return null;
}

export function getLineTargetId(chatId: string): string | null {
  const separator = chatId.indexOf(":");
  if (separator <= 0) return null;
  const kind = chatId.slice(0, separator);
  return kind === "group" || kind === "room" || kind === "user" ? chatId.slice(separator + 1) : null;
}

export async function replyLine(token: string, replyToken: string, message: Record<string, unknown>): Promise<void> {
  await callLine("https://api.line.me/v2/bot/message/reply", token, { replyToken, messages: [message] });
}

export async function pushLine(token: string, to: string, message: Record<string, unknown>): Promise<void> {
  await callLine("https://api.line.me/v2/bot/message/push", token, { to, messages: [message] });
}

export async function getLineProfile(accessToken: string): Promise<{ userId: string }> {
  const response = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`LIFF profile lookup failed: ${response.status}`);
  const payload = await response.json() as { userId?: string };
  if (!payload.userId) throw new Error("LIFF profile response has no userId");
  return { userId: payload.userId };
}

async function callLine(url: string, token: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`LINE Messaging API failed: ${response.status} ${await response.text()}`);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
