import type { PlaceValidation, RestaurantItem, ValidationStatus } from "./types.js";

export const CACHE_TTL_SECONDS: Record<ValidationStatus, number> = {
  food_place: 30 * 24 * 60 * 60,
  non_food_place: 14 * 24 * 60 * 60,
  no_result: 7 * 24 * 60 * 60,
  ambiguous: 7 * 24 * 60 * 60,
  api_error: 5 * 60
};

export interface Storage {
  init(): Promise<void>;
  close(): Promise<void>;
  addItem(
    chatId: string,
    name: string,
    source: RestaurantItem["source"],
    validation: PlaceValidation | null
  ): Promise<{ item: RestaurantItem; created: boolean }>;
  createPendingConfirmation(chatId: string, name: string): Promise<string>;
  takePendingConfirmation(chatId: string, id: string): Promise<string | null>;
  removeItem(chatId: string, name: string): Promise<boolean>;
  listItems(chatId: string): Promise<RestaurantItem[]>;
  getValidCache(normalizedQuery: string, regionCode: string, languageCode: string): Promise<PlaceValidation | null>;
  saveCache(validation: PlaceValidation): Promise<void>;
  tryReserveGoogleCall(chatId: string, globalLimit: number, groupLimit: number): Promise<boolean>;
}
