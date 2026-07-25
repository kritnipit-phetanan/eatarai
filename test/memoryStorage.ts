import { normalizeText } from "../src/normalize.js";
import { CACHE_TTL_SECONDS, type Storage } from "../src/storage.js";
import type { PlaceValidation, RestaurantItem } from "../src/types.js";

export class MemoryStorage implements Storage {
  private items: RestaurantItem[] = [];
  private cache = new Map<string, { validation: PlaceValidation; expiresAt: number }>();
  private calls = new Map<string, number>();
  private pending = new Map<string, { chatId: string; name: string; expiresAt: number }>();
  private nextId = 1;

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async addItem(
    chatId: string,
    name: string,
    source: RestaurantItem["source"],
    validation: PlaceValidation | null
  ): Promise<{ item: RestaurantItem; created: boolean }> {
    const normalizedName = normalizeText(name);
    const placeId = validation?.placeId ?? null;
    const existing = this.items.find((item) => {
      if (item.chatId !== chatId) return false;
      if (placeId) return item.googlePlaceId === placeId;
      return item.normalizedName === normalizedName;
    });

    if (existing) return { item: existing, created: false };

    const item: RestaurantItem = {
      id: this.nextId++,
      chatId,
      name: name.trim(),
      normalizedName,
      source,
      googlePlaceId: placeId,
      matchedName: validation?.displayName ?? null,
      matchedAddress: validation?.formattedAddress ?? null,
      matchedTypes: validation?.types ?? [],
      createdAt: new Date().toISOString()
    };
    this.items.push(item);
    return { item, created: true };
  }

  async createPendingConfirmation(chatId: string, name: string): Promise<string> {
    const id = `00000000-0000-4000-8000-${String(this.pending.size + 1).padStart(12, "0")}`;
    this.pending.set(id, { chatId, name: name.trim(), expiresAt: Date.now() + 15 * 60 * 1000 });
    return id;
  }

  async takePendingConfirmation(chatId: string, id: string): Promise<string | null> {
    const pending = this.pending.get(id);
    if (!pending || pending.chatId !== chatId || pending.expiresAt <= Date.now()) return null;
    this.pending.delete(id);
    return pending.name;
  }

  async removeItem(chatId: string, name: string): Promise<boolean> {
    const before = this.items.length;
    const normalizedName = normalizeText(name);
    this.items = this.items.filter((item) => item.chatId !== chatId || item.normalizedName !== normalizedName);
    return this.items.length !== before;
  }

  async listItems(chatId: string): Promise<RestaurantItem[]> {
    return this.items.filter((item) => item.chatId === chatId);
  }

  async getValidCache(
    normalizedQuery: string,
    regionCode: string,
    languageCode: string
  ): Promise<PlaceValidation | null> {
    const entry = this.cache.get(cacheKey(normalizedQuery, regionCode, languageCode));
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return { ...entry.validation, source: "cache" };
  }

  async saveCache(validation: PlaceValidation): Promise<void> {
    this.cache.set(cacheKey(validation.normalizedQuery, validation.regionCode, validation.languageCode), {
      validation,
      expiresAt: Date.now() + CACHE_TTL_SECONDS[validation.status] * 1000
    });
  }

  async tryReserveGoogleCall(chatId: string, globalLimit: number, groupLimit: number): Promise<boolean> {
    const globalCalls = [...this.calls.values()].reduce((sum, count) => sum + count, 0);
    const groupCalls = this.calls.get(chatId) ?? 0;
    if (globalCalls >= globalLimit || groupCalls >= groupLimit) return false;
    this.calls.set(chatId, groupCalls + 1);
    return true;
  }
}

function cacheKey(normalizedQuery: string, regionCode: string, languageCode: string): string {
  return `${normalizedQuery}|${regionCode}|${languageCode}`;
}
