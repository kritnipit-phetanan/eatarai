import { createHmac, timingSafeEqual } from "node:crypto";
import type { BotReply, LineWebhookEvent } from "./types.js";

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined, channelSecret: string): boolean {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function getChatId(event: LineWebhookEvent): string | null {
  const source = event.source;
  if (!source?.type) return null;
  if (source.type === "group" && source.groupId) return `group:${source.groupId}`;
  if (source.type === "room" && source.roomId) return `room:${source.roomId}`;
  if (source.type === "user" && source.userId) return `user:${source.userId}`;
  return null;
}

export async function replyLineText(channelAccessToken: string, replyToken: string, reply: BotReply): Promise<void> {
  if (!channelAccessToken) {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN is empty; reply skipped");
    return;
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`
    },
    body: JSON.stringify({ replyToken, messages: [toLineMessage(reply)] })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE reply failed: ${response.status} ${body}`);
  }
}

function toLineMessage(reply: BotReply): Record<string, unknown> {
  if (reply.flex) {
    return {
      type: "flex",
      altText: reply.flex.altText,
      contents: reply.flex.contents
    };
  }

  return reply.quickReply
    ? { type: "text", text: reply.text, quickReply: reply.quickReply }
    : { type: "text", text: reply.text };
}
