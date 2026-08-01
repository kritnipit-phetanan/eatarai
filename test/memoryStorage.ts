import { normalizeText } from "../src/normalize.js";
import type { Storage } from "../src/storage.js";
import type { PendingInputMode, PlaceValidation, RestaurantItem } from "../src/types.js";

export class MemoryStorage implements Storage {
  private items: RestaurantItem[] = [];
  private calls = new Map<string, number>();
  private pendingInputs = new Map<string, { mode: PendingInputMode; expiresAt: number }>();
  private pendingSelection = new Map<string, { itemId: number; expiresAt: number }>();
  private pendingMapLinks = new Map<string, { chatId: string; itemId: number; place: PlaceValidation; expiresAt: number }>();
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

  async removeItem(chatId: string, name: string): Promise<boolean> {
    const before = this.items.length;
    const normalizedName = normalizeText(name);
    this.items = this.items.filter((item) => item.chatId !== chatId || item.normalizedName !== normalizedName);
    return this.items.length !== before;
  }

  async listItems(chatId: string): Promise<RestaurantItem[]> {
    return this.items.filter((item) => item.chatId === chatId);
  }

  async tryReserveGoogleCall(chatId: string, globalLimit: number, groupLimit: number): Promise<boolean> {
    const globalCalls = [...this.calls.values()].reduce((sum, count) => sum + count, 0);
    const groupCalls = this.calls.get(chatId) ?? 0;
    if (globalCalls >= globalLimit || groupCalls >= groupLimit) return false;
    this.calls.set(chatId, groupCalls + 1);
    return true;
  }

  async beginPendingInput(chatId: string, mode: PendingInputMode): Promise<void> {
    this.pendingInputs.set(chatId, { mode, expiresAt: Date.now() + 10 * 60 * 1000 });
  }

  async takePendingInput(chatId: string): Promise<PendingInputMode | null> {
    const pending = this.pendingInputs.get(chatId);
    this.pendingInputs.delete(chatId);
    if (!pending || pending.expiresAt <= Date.now()) return null;
    return pending.mode;
  }

  async beginMapLinkSelection(chatId: string, name: string): Promise<boolean> {
    const item = this.items.find((candidate) => candidate.chatId === chatId && candidate.normalizedName === normalizeText(name));
    if (!item) return false;
    this.pendingSelection.set(chatId, { itemId: item.id, expiresAt: Date.now() + 15 * 60 * 1000 });
    return true;
  }

  async takeMapLinkSelection(chatId: string): Promise<RestaurantItem | null> {
    const selection = this.pendingSelection.get(chatId);
    this.pendingSelection.delete(chatId);
    if (!selection || selection.expiresAt <= Date.now()) return null;
    return this.items.find((item) => item.id === selection.itemId && item.chatId === chatId) ?? null;
  }

  async createPendingMapLink(chatId: string, itemId: number, place: PlaceValidation): Promise<string> {
    const id = `00000000-0000-4000-8000-${String(this.pendingMapLinks.size + 1).padStart(12, "0")}`;
    this.pendingMapLinks.set(id, { chatId, itemId, place, expiresAt: Date.now() + 15 * 60 * 1000 });
    return id;
  }

  async takePendingMapLink(chatId: string, id: string): Promise<{ itemId: number; place: PlaceValidation } | null> {
    const pending = this.pendingMapLinks.get(id);
    if (!pending || pending.chatId !== chatId || pending.expiresAt <= Date.now()) return null;
    this.pendingMapLinks.delete(id);
    return { itemId: pending.itemId, place: pending.place };
  }

  async setItemPlace(chatId: string, itemId: number, place: PlaceValidation): Promise<boolean> {
    const item = this.items.find((candidate) => candidate.id === itemId && candidate.chatId === chatId);
    if (!item) return false;
    item.source = "google_places";
    item.googlePlaceId = place.placeId;
    item.matchedName = place.displayName;
    item.matchedAddress = place.formattedAddress;
    item.matchedTypes = place.types;
    return true;
  }
}
