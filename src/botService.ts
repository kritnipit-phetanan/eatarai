import { normalizeText } from "./normalize.js";
import type { AppConfig } from "./config.js";
import type { GooglePlacesClient, GooglePlacesConfig } from "./googlePlaces.js";
import { validateLocalKeyword } from "./googlePlaces.js";
import type { Storage } from "./storage.js";
import type { ParsedCommand, PlaceValidation, RestaurantItem } from "./types.js";

export class BotService {
  private placesConfig: GooglePlacesConfig;

  constructor(
    private readonly storage: Storage,
    private readonly googlePlaces: GooglePlacesClient,
    private readonly config: AppConfig
  ) {
    this.placesConfig = {
      apiKey: config.googleMapsApiKey,
      regionCode: config.googleRegionCode,
      languageCode: config.googleLanguageCode,
      locationBias: config.googleLocationBias
    };
  }

  async handleCommand(chatId: string, command: ParsedCommand): Promise<string | null> {
    switch (command.kind) {
      case "ignore":
        return null;
      case "show":
        return this.formatList(chatId);
      case "stats":
        return this.formatStats(chatId);
      case "remove":
        return this.removeItem(chatId, command.item);
      case "confirm":
        return this.confirmItem(chatId, command.item);
      case "add":
        return this.addWithValidation(chatId, command.item);
    }
  }

  private async addWithValidation(chatId: string, rawName: string): Promise<string> {
    const name = rawName.trim();
    if (!name) return "พิมพ์ชื่อร้านหรืออาหารที่อยากเพิ่มอีกครั้ง";

    const local = validateLocalKeyword(name, this.placesConfig);
    if (local) {
      await this.storage.addItem(chatId, name, "cuisine_keyword", local);
      return this.formatList(chatId);
    }

    const normalizedQuery = normalizeText(name);
    const cached = await this.storage.getValidCache(
      normalizedQuery,
      this.config.googleRegionCode,
      this.config.googleLanguageCode
    );

    if (cached) {
      return this.handleValidationResult(chatId, name, cached);
    }

    const globalCalls = await this.storage.googleCallsToday();
    const groupCalls = await this.storage.googleCallsToday(chatId);
    if (
      globalCalls >= this.config.googleDailyValidationLimit ||
      groupCalls >= this.config.googleGroupDailyValidationLimit
    ) {
      return [
        "โควตาตรวจร้านวันนี้เต็มแล้ว",
        `ถ้าจะเพิ่ม "${name}" เอง พิมพ์: ยืนยัน ${name}`
      ].join("\n");
    }

    const startedAt = Date.now();
    let validation: PlaceValidation;
    try {
      validation = await this.googlePlaces.searchText(name, this.placesConfig);
    } catch (error) {
      validation = {
        status: "api_error",
        normalizedQuery,
        regionCode: this.config.googleRegionCode,
        languageCode: this.config.googleLanguageCode,
        placeId: null,
        displayName: null,
        formattedAddress: error instanceof Error ? error.message : "Unknown Google Places error",
        primaryType: null,
        types: [],
        source: "google"
      };
    }

    await this.storage.incrementGoogleCall(chatId);
    await this.storage.saveCache(validation);
    console.info(
      JSON.stringify({
        event: "google_places_validation",
        query: name,
        cache: "miss",
        status: validation.status,
        latencyMs: Date.now() - startedAt,
        skuIntent: "text_search_pro"
      })
    );

    return this.handleValidationResult(chatId, name, validation);
  }

  private async handleValidationResult(chatId: string, requestedName: string, validation: PlaceValidation): Promise<string> {
    if (validation.status === "food_place") {
      const displayName = validation.displayName ?? requestedName;
      await this.storage.addItem(chatId, displayName, validation.source === "local_keyword" ? "cuisine_keyword" : "google_places", validation);
      return this.formatList(chatId);
    }

    if (validation.status === "api_error") {
      return [
        `ตรวจ "${requestedName}" กับ Google Places ไม่สำเร็จ`,
        `ลองใหม่อีกครั้ง หรือถ้าจะเพิ่มเอง พิมพ์: ยืนยัน ${requestedName}`
      ].join("\n");
    }

    return [
      `ไม่แน่ใจว่า "${requestedName}" เป็นร้าน/อาหาร`,
      `ถ้าจะเพิ่มจริง พิมพ์: ยืนยัน ${requestedName}`
    ].join("\n");
  }

  private async confirmItem(chatId: string, name: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) return "พิมพ์ชื่อที่จะยืนยันอีกครั้ง เช่น ยืนยัน Sukishi";
    await this.storage.addItem(chatId, trimmed, "manual_confirm", null);
    return this.formatList(chatId);
  }

  private async removeItem(chatId: string, name: string): Promise<string> {
    const removed = await this.storage.removeItem(chatId, name);
    if (!removed) {
      return [`ไม่เจอ "${name}" ในลิสต์`, await this.formatList(chatId)].join("\n\n");
    }
    return this.formatList(chatId);
  }

  private async formatList(chatId: string): Promise<string> {
    const items = await this.storage.listItems(chatId);
    if (items.length === 0) return "ยังไม่มีรายการที่อยากกิน";

    return ["รายการที่อยากกิน:", ...items.map((item: RestaurantItem, index) => `${index + 1}. ${item.name}`)].join("\n");
  }

  private async formatStats(chatId: string): Promise<string> {
    const cache = await this.storage.cacheStats();
    const globalCalls = await this.storage.googleCallsToday();
    const groupCalls = await this.storage.googleCallsToday(chatId);
    return [
      "สถิติวันนี้:",
      `- Google calls ทั้งหมด: ${globalCalls}`,
      `- Google calls กลุ่มนี้: ${groupCalls}`,
      `- Cache active/total: ${cache.active}/${cache.total}`
    ].join("\n");
  }
}
