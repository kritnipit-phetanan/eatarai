import { DurableObject } from "cloudflare:workers";
import { getLineTargetId, pushLine } from "./line.js";
import { listMessage } from "./listMessage.js";
import { supabase, type WorkerEnv } from "./supabase.js";

interface PublicationState {
  chat_id: string;
  revision: number;
  published_revision: number;
}

const retryDelayMs = 30_000;
const deliveryLeaseMs = 60_000;
const announcementDebounceMs = 2_000;

/** Serializes list announcements for one LINE chat while Supabase remains the source of truth. */
export class ChatListPublisher extends DurableObject<WorkerEnv> {
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS publication_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        chat_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        published_revision INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS delivery_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        delivery_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async enqueue(chatId: string): Promise<void> {
    const state = this.readState();
    if (state) {
      if (state.chat_id !== chatId) throw new Error("Chat publisher mismatch");
      this.ctx.storage.sql.exec("UPDATE publication_state SET revision = revision + 1 WHERE id = 1");
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO publication_state (id, chat_id, revision, published_revision) VALUES (1, ?, 1, 0)",
        chatId
      );
    }
    // Preserve the first pending deadline so a burst becomes one announcement,
    // rather than moving the announcement later for every new mutation.
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + announcementDebounceMs);
    }
  }

  async alarm(): Promise<void> {
    const state = this.readState();
    if (!state || state.revision <= state.published_revision) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const revision = state.revision;
    const now = Date.now();
    const lock = this.readLock();
    if (lock && lock.expires_at > now) {
      await this.ctx.storage.setAlarm(lock.expires_at);
      return;
    }

    const deliveryId = reusableDeliveryId(lock?.delivery_id, revision) ?? `${revision}:${crypto.randomUUID()}`;
    const leaseExpiresAt = now + deliveryLeaseMs;
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO delivery_lock (id, delivery_id, expires_at) VALUES (1, ?, ?)",
      deliveryId,
      leaseExpiresAt
    );
    // Keep a retry scheduled before external I/O. New enqueues can advance revision while this runs.
    await this.ctx.storage.setAlarm(leaseExpiresAt);
    try {
      const target = getLineTargetId(state.chat_id);
      if (!target) throw new Error("Invalid chat id for list publisher");
      await pushLine(
        this.env.LINE_CHANNEL_ACCESS_TOKEN,
        target,
        await listMessage(supabase(this.env), state.chat_id),
        deliveryId.slice(deliveryId.indexOf(":") + 1)
      );

      if (this.readLock()?.delivery_id !== deliveryId) return;
      this.ctx.storage.sql.exec("UPDATE publication_state SET published_revision = ? WHERE id = 1", revision);
      this.ctx.storage.sql.exec("DELETE FROM delivery_lock WHERE id = 1 AND delivery_id = ?", deliveryId);
      const current = this.readState();
      if (current && current.revision > revision) {
        await this.ctx.storage.setAlarm(Date.now());
      } else {
        await this.ctx.storage.deleteAlarm();
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "chat_list_publish_failed",
        chatId: state.chat_id,
        error: String(error)
      }));
      if (this.readLock()?.delivery_id === deliveryId) {
        const retryAt = Date.now() + retryDelayMs;
        this.ctx.storage.sql.exec("UPDATE delivery_lock SET expires_at = ? WHERE id = 1 AND delivery_id = ?", retryAt, deliveryId);
        await this.ctx.storage.setAlarm(retryAt);
      }
    }
  }

  private readState(): PublicationState | null {
    return this.ctx.storage.sql
      .exec<PublicationState>("SELECT chat_id, revision, published_revision FROM publication_state WHERE id = 1")
      .toArray()[0] ?? null;
  }

  private readLock(): { delivery_id: string; expires_at: number } | null {
    return this.ctx.storage.sql
      .exec<{ delivery_id: string; expires_at: number }>("SELECT delivery_id, expires_at FROM delivery_lock WHERE id = 1")
      .toArray()[0] ?? null;
  }
}

function reusableDeliveryId(deliveryId: string | undefined, revision: number): string | null {
  if (!deliveryId) return null;
  const [savedRevision, retryKey] = deliveryId.split(":");
  return Number(savedRevision) === revision && isUuid(retryKey) ? deliveryId : null;
}

function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function enqueueLatestList(env: WorkerEnv, chatId: string): Promise<void> {
  await env.CHAT_LIST_PUBLISHER.getByName(chatId).enqueue(chatId);
}
