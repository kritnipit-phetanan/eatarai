import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BotService } from "./botService.js";
import { loadConfig } from "./config.js";
import { FetchGooglePlacesClient } from "./googlePlaces.js";
import { getChatId, replyLineText, verifyLineSignature } from "./line.js";
import { parseCommand } from "./parser.js";
import { PostgresStorage } from "./postgresStorage.js";
import type { LineWebhookEvent } from "./types.js";

loadDotEnv();

const config = loadConfig();
const storage = new PostgresStorage(config.databaseUrl);
const bot = new BotService(storage, new FetchGooglePlacesClient(), config);

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/line/webhook") {
      await handleLineWebhook(req, res);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "internal_error" });
  }
});

await storage.init();

server.listen(config.port, () => {
  console.info(`เมื่อไรจะไปกิน listening on :${config.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleLineWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readBody(req);
  const signature = req.headers["x-line-signature"];
  const validSignature = verifyLineSignature(
    rawBody,
    Array.isArray(signature) ? signature[0] : signature,
    config.lineChannelSecret
  );

  if (!validSignature) {
    sendJson(res, 401, { error: "invalid_signature" });
    return;
  }

  const payload = JSON.parse(rawBody.toString("utf8")) as { events?: LineWebhookEvent[] };
  const events = payload.events ?? [];

  await Promise.all(events.map(handleLineEvent));
  sendJson(res, 200, { ok: true });
}

async function handleLineEvent(event: LineWebhookEvent): Promise<void> {
  const chatId = getChatId(event);
  if (!chatId || !event.replyToken) return;

  if (event.type === "postback" && event.postback?.data) {
    const response = await bot.handlePostback(chatId, event.postback.data);
    if (response) await replyLineText(config.lineChannelAccessToken, event.replyToken, response);
    return;
  }

  if (event.type !== "message" || event.message?.type !== "text" || !event.message.text) return;

  const isBotMentioned = event.message.mention?.mentionees?.some((mentionee) => mentionee.isSelf === true) ?? false;
  const command = parseCommand(event.message.text, config.botDisplayName, isBotMentioned);
  const response = await bot.handleCommand(chatId, command);
  if (!response) return;

  await replyLineText(config.lineChannelAccessToken, event.replyToken, response);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function loadDotEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function shutdown(): void {
  server.close(() => {
    storage.close().finally(() => process.exit(0));
  });
}
