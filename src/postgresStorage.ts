import pg from "pg";
import { normalizeText } from "./normalize.js";
import { CACHE_TTL_SECONDS, type Storage } from "./storage.js";
import type { PlaceValidation, RestaurantItem, ValidationStatus } from "./types.js";

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

  async getValidCache(
    normalizedQuery: string,
    regionCode: string,
    languageCode: string
  ): Promise<PlaceValidation | null> {
    const result = await this.pool.query<CacheRow>(
      `SELECT * FROM place_validation_cache
       WHERE normalized_query = $1 AND region_code = $2 AND language_code = $3 AND expires_at > now()`,
      [normalizedQuery, regionCode, languageCode]
    );
    const row = result.rows[0];
    return row ? rowToValidation(row, "cache") : null;
  }

  async saveCache(validation: PlaceValidation): Promise<void> {
    const ttl = CACHE_TTL_SECONDS[validation.status];
    await this.pool.query(
      `INSERT INTO place_validation_cache (
        normalized_query, region_code, language_code, status, place_id,
        display_name, formatted_address, primary_type, types_json,
        expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' seconds')::interval, now(), now())
      ON CONFLICT(normalized_query, region_code, language_code) DO UPDATE SET
        status = excluded.status,
        place_id = excluded.place_id,
        display_name = excluded.display_name,
        formatted_address = excluded.formatted_address,
        primary_type = excluded.primary_type,
        types_json = excluded.types_json,
        expires_at = excluded.expires_at,
        updated_at = now()`,
      [
        validation.normalizedQuery,
        validation.regionCode,
        validation.languageCode,
        validation.status,
        validation.placeId,
        validation.displayName,
        validation.formattedAddress,
        validation.primaryType,
        JSON.stringify(validation.types),
        ttl
      ]
    );
  }

  async incrementGoogleCall(chatId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO google_call_log (chat_id, day, call_count, created_at, updated_at)
       VALUES ($1, current_date, 1, now(), now())
       ON CONFLICT(chat_id, day) DO UPDATE SET
         call_count = google_call_log.call_count + 1,
         updated_at = now()`,
      [chatId]
    );
  }

  async googleCallsToday(chatId?: string): Promise<number> {
    if (chatId) {
      const result = await this.pool.query<{ call_count: number }>(
        "SELECT call_count FROM google_call_log WHERE chat_id = $1 AND day = current_date",
        [chatId]
      );
      return Number(result.rows[0]?.call_count ?? 0);
    }

    const result = await this.pool.query<{ call_count: number }>(
      "SELECT COALESCE(SUM(call_count), 0)::int AS call_count FROM google_call_log WHERE day = current_date"
    );
    return Number(result.rows[0]?.call_count ?? 0);
  }

  async cacheStats(): Promise<{ total: number; active: number }> {
    const result = await this.pool.query<{ total: number; active: number }>(
      `SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN expires_at > now() THEN 1 ELSE 0 END)::int AS active
       FROM place_validation_cache`
    );
    return { total: Number(result.rows[0]?.total ?? 0), active: Number(result.rows[0]?.active ?? 0) };
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

      CREATE TABLE IF NOT EXISTS place_validation_cache (
        normalized_query TEXT NOT NULL,
        region_code TEXT NOT NULL,
        language_code TEXT NOT NULL,
        status TEXT NOT NULL,
        place_id TEXT,
        display_name TEXT,
        formatted_address TEXT,
        primary_type TEXT,
        types_json TEXT NOT NULL DEFAULT '[]',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (normalized_query, region_code, language_code)
      );

      CREATE TABLE IF NOT EXISTS google_call_log (
        chat_id TEXT NOT NULL,
        day DATE NOT NULL,
        call_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (chat_id, day)
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

function rowToValidation(row: CacheRow, source: "cache"): PlaceValidation {
  return {
    status: row.status as ValidationStatus,
    normalizedQuery: row.normalized_query,
    regionCode: row.region_code,
    languageCode: row.language_code,
    placeId: row.place_id,
    displayName: row.display_name,
    formattedAddress: row.formatted_address,
    primaryType: row.primary_type,
    types: parseJsonArray(row.types_json),
    source
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

interface CacheRow {
  normalized_query: string;
  region_code: string;
  language_code: string;
  status: string;
  place_id: string | null;
  display_name: string | null;
  formatted_address: string | null;
  primary_type: string | null;
  types_json: string;
}
