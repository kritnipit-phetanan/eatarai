import { randomUUID } from "node:crypto";
import pg from "pg";
import { normalizeText } from "./normalize.js";
import type { Storage } from "./storage.js";
import type { PlaceValidation, RestaurantItem } from "./types.js";

const { Pool } = pg;

export class PostgresStorage implements Storage {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for Postgres storage");
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: sslConfig(databaseUrl)
    });
  }

  async init(): Promise<void> {
    await this.migrate();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async addItem(
    chatId: string,
    name: string,
    source: RestaurantItem["source"],
    validation: PlaceValidation | null
  ): Promise<{ item: RestaurantItem; created: boolean }> {
    const normalizedName = normalizeText(name);
    const googlePlaceId = validation?.placeId ?? null;
    const existing = googlePlaceId
      ? await this.getItemByPlaceId(chatId, googlePlaceId)
      : await this.getItemByNormalizedName(chatId, normalizedName);

    if (existing) return { item: existing, created: false };

    const result = await this.pool.query<ItemRow>(
      `INSERT INTO restaurant_items (
        chat_id, name, normalized_name, source, google_place_id,
        matched_name, matched_address, matched_types_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [
        chatId,
        name.trim(),
        normalizedName,
        source,
        googlePlaceId,
        validation?.displayName ?? null,
        validation?.formattedAddress ?? null,
        JSON.stringify(validation?.types ?? [])
      ]
    );

    const inserted = result.rows[0];
    if (inserted) return { item: rowToItem(inserted), created: true };

    const item = googlePlaceId
      ? await this.getItemByPlaceId(chatId, googlePlaceId)
      : await this.getItemByNormalizedName(chatId, normalizedName);

    if (!item) throw new Error("Failed to read inserted item");
    return { item, created: false };
  }

  async removeItem(chatId: string, name: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM restaurant_items WHERE chat_id = $1 AND normalized_name = $2", [
      chatId,
      normalizeText(name)
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async listItems(chatId: string): Promise<RestaurantItem[]> {
    const result = await this.pool.query<ItemRow>(
      "SELECT * FROM restaurant_items WHERE chat_id = $1 ORDER BY id ASC",
      [chatId]
    );
    return result.rows.map(rowToItem);
  }

  async tryReserveGoogleCall(chatId: string, globalLimit: number, groupLimit: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [20260720]);

      const globalResult = await client.query<{ call_count: number }>(
        "SELECT COALESCE(SUM(call_count), 0)::int AS call_count FROM google_call_log WHERE day = current_date"
      );
      const groupResult = await client.query<{ call_count: number }>(
        "SELECT call_count FROM google_call_log WHERE chat_id = $1 AND day = current_date",
        [chatId]
      );
      const globalCalls = Number(globalResult.rows[0]?.call_count ?? 0);
      const groupCalls = Number(groupResult.rows[0]?.call_count ?? 0);

      if (globalCalls >= globalLimit || groupCalls >= groupLimit) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `INSERT INTO google_call_log (chat_id, day, call_count, created_at, updated_at)
         VALUES ($1, current_date, 1, now(), now())
         ON CONFLICT(chat_id, day) DO UPDATE SET
           call_count = google_call_log.call_count + 1,
           updated_at = now()`,
        [chatId]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async beginMapLinkSelection(chatId: string, name: string): Promise<boolean> {
    const item = await this.getItemByNormalizedName(chatId, normalizeText(name));
    if (!item) return false;

    await this.pool.query(
      `INSERT INTO pending_map_link_selections (chat_id, item_id, expires_at, created_at)
       VALUES ($1, $2, now() + interval '15 minutes', now())
       ON CONFLICT(chat_id) DO UPDATE SET item_id = excluded.item_id, expires_at = excluded.expires_at, created_at = now()`,
      [chatId, item.id]
    );
    return true;
  }

  async takeMapLinkSelection(chatId: string): Promise<RestaurantItem | null> {
    const result = await this.pool.query<{ item_id: number }>(
      `DELETE FROM pending_map_link_selections
       WHERE chat_id = $1 AND expires_at > now()
       RETURNING item_id`,
      [chatId]
    );
    const itemId = result.rows[0]?.item_id;
    if (!itemId) return null;

    const itemResult = await this.pool.query<ItemRow>(
      "SELECT * FROM restaurant_items WHERE id = $1 AND chat_id = $2",
      [itemId, chatId]
    );
    const row = itemResult.rows[0];
    return row ? rowToItem(row) : null;
  }

  async createPendingMapLink(chatId: string, itemId: number, place: PlaceValidation): Promise<string> {
    if (!place.placeId) throw new Error("Map link candidate requires a Google place ID");
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO pending_map_link_candidates (
        id, chat_id, item_id, place_id, display_name, formatted_address, primary_type, types_json, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '15 minutes', now())`,
      [id, chatId, itemId, place.placeId, place.displayName, place.formattedAddress, place.primaryType, JSON.stringify(place.types)]
    );
    return id;
  }

  async takePendingMapLink(chatId: string, id: string): Promise<{ itemId: number; place: PlaceValidation } | null> {
    const result = await this.pool.query<PendingMapLinkRow>(
      `DELETE FROM pending_map_link_candidates
       WHERE id = $1 AND chat_id = $2 AND expires_at > now()
       RETURNING item_id, place_id, display_name, formatted_address, primary_type, types_json`,
      [id, chatId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      itemId: Number(row.item_id),
      place: {
        placeId: row.place_id,
        displayName: row.display_name,
        formattedAddress: row.formatted_address,
        primaryType: row.primary_type,
        types: parseJsonArray(row.types_json)
      }
    };
  }

  async setItemPlace(chatId: string, itemId: number, place: PlaceValidation): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE restaurant_items
       SET source = 'google_places', google_place_id = $3, matched_name = $4, matched_address = $5, matched_types_json = $6
       WHERE id = $1 AND chat_id = $2`,
      [itemId, chatId, place.placeId, place.displayName, place.formattedAddress, JSON.stringify(place.types)]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async getItemByNormalizedName(chatId: string, normalizedName: string): Promise<RestaurantItem | null> {
    const result = await this.pool.query<ItemRow>(
      "SELECT * FROM restaurant_items WHERE chat_id = $1 AND normalized_name = $2",
      [chatId, normalizedName]
    );
    const row = result.rows[0];
    return row ? rowToItem(row) : null;
  }

  private async getItemByPlaceId(chatId: string, placeId: string): Promise<RestaurantItem | null> {
    const result = await this.pool.query<ItemRow>(
      "SELECT * FROM restaurant_items WHERE chat_id = $1 AND google_place_id = $2",
      [chatId, placeId]
    );
    const row = result.rows[0];
    return row ? rowToItem(row) : null;
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS restaurant_items (
        id BIGSERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        source TEXT NOT NULL,
        google_place_id TEXT,
        matched_name TEXT,
        matched_address TEXT,
        matched_types_json TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS restaurant_items_chat_name_idx
        ON restaurant_items(chat_id, normalized_name);

      CREATE UNIQUE INDEX IF NOT EXISTS restaurant_items_chat_place_idx
        ON restaurant_items(chat_id, google_place_id)
        WHERE google_place_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS google_call_log (
        chat_id TEXT NOT NULL,
        day DATE NOT NULL,
        call_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (chat_id, day)
      );

      CREATE TABLE IF NOT EXISTS pending_map_link_selections (
        chat_id TEXT PRIMARY KEY,
        item_id BIGINT NOT NULL REFERENCES restaurant_items(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS pending_map_link_candidates (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        item_id BIGINT NOT NULL REFERENCES restaurant_items(id) ON DELETE CASCADE,
        place_id TEXT NOT NULL,
        display_name TEXT,
        formatted_address TEXT,
        primary_type TEXT,
        types_json TEXT NOT NULL DEFAULT '[]',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
}

function rowToItem(row: ItemRow): RestaurantItem {
  return {
    id: Number(row.id),
    chatId: row.chat_id,
    name: row.name,
    normalizedName: row.normalized_name,
    source: row.source as RestaurantItem["source"],
    googlePlaceId: row.google_place_id,
    matchedName: row.matched_name,
    matchedAddress: row.matched_address,
    matchedTypes: parseJsonArray(row.matched_types_json),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function sslConfig(databaseUrl: string): pg.PoolConfig["ssl"] {
  if (process.env.POSTGRES_SSL === "false") return false;
  if (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")) return false;
  return { rejectUnauthorized: false };
}

interface ItemRow {
  id: string | number;
  chat_id: string;
  name: string;
  normalized_name: string;
  source: string;
  google_place_id: string | null;
  matched_name: string | null;
  matched_address: string | null;
  matched_types_json: string;
  created_at: Date | string;
}

interface PendingMapLinkRow {
  item_id: string | number;
  place_id: string | null;
  display_name: string | null;
  formatted_address: string | null;
  primary_type: string | null;
  types_json: string;
}
