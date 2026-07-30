import type { PlaceValidation, RestaurantItem } from "./types.js";

export interface Storage {
  init(): Promise<void>;
  close(): Promise<void>;
  addItem(
    chatId: string,
    name: string,
    source: RestaurantItem["source"],
    validation: PlaceValidation | null
  ): Promise<{ item: RestaurantItem; created: boolean }>;
  removeItem(chatId: string, name: string): Promise<boolean>;
  listItems(chatId: string): Promise<RestaurantItem[]>;
  tryReserveGoogleCall(chatId: string, globalLimit: number, groupLimit: number): Promise<boolean>;
  beginMapLinkSelection(chatId: string, name: string): Promise<boolean>;
  takeMapLinkSelection(chatId: string): Promise<RestaurantItem | null>;
  createPendingMapLink(chatId: string, itemId: number, place: PlaceValidation): Promise<string>;
  takePendingMapLink(chatId: string, id: string): Promise<{ itemId: number; place: PlaceValidation } | null>;
  setItemPlace(chatId: string, itemId: number, place: PlaceValidation): Promise<boolean>;
}
