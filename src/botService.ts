import { normalizeText } from "./normalize.js";
import type { AppConfig } from "./config.js";
import type { GooglePlacesClient, GooglePlacesConfig } from "./googlePlaces.js";
import { validateTrustedAlias } from "./googlePlaces.js";
import type { Storage } from "./storage.js";
import type { BotReply, ParsedCommand, PlaceValidation, RestaurantItem } from "./types.js";

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

  async handleCommand(chatId: string, command: ParsedCommand): Promise<BotReply | null> {
    switch (command.kind) {
      case "ignore":
        return null;
      case "menu":
        return this.menuReply();
      case "show":
        return this.textReply(await this.formatList(chatId));
      case "remove":
        return this.textReply(await this.removeItem(chatId, command.item));
      case "add":
        return this.addWithValidation(chatId, command.item);
    }
  }

  async handlePostback(chatId: string, data: string): Promise<BotReply | null> {
    if (data === "menu:list") return this.textReply(await this.formatList(chatId));
    if (data === "menu:add") return this.textReply("พิมพ์: @เมื่อไรจะไปกิน เพิ่ม <ชื่อร้าน>");
    if (data === "menu:remove") return this.textReply("พิมพ์: @เมื่อไรจะไปกิน ลบ <ชื่อร้าน>");

    const match = /^(confirm|cancel):([0-9a-f-]{36})$/i.exec(data);
    if (!match) return null;

    const action = match[1];
    const id = match[2];
    if (!action || !id) return null;

    const name = await this.storage.takePendingConfirmation(chatId, id);
    if (!name) return this.textReply("รายการยืนยันหมดอายุหรือถูกดำเนินการไปแล้ว");
    if (action === "cancel") return this.textReply(`ยกเลิกการเพิ่ม "${name}" แล้ว`);

    await this.storage.addItem(chatId, name, "manual_confirm", null);
    return this.textReply(await this.formatList(chatId));
  }

  private async addWithValidation(chatId: string, rawName: string): Promise<BotReply> {
    const name = rawName.trim();
    if (!name) return this.textReply("พิมพ์ชื่อร้านหรืออาหารที่อยากเพิ่มอีกครั้ง");

    const local = validateTrustedAlias(name, this.placesConfig);
    if (local) {
      await this.storage.addItem(chatId, name, "trusted_alias", local);
      return this.textReply(await this.formatList(chatId));
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

    const reservedGoogleCall = await this.storage.tryReserveGoogleCall(
      chatId,
      this.config.googleDailyValidationLimit,
      this.config.googleGroupDailyValidationLimit
    );
    if (!reservedGoogleCall) {
      return this.confirmationReply(chatId, name, "โควตาตรวจร้านวันนี้เต็มแล้ว");
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

  private async handleValidationResult(chatId: string, requestedName: string, validation: PlaceValidation): Promise<BotReply> {
    if (validation.status === "food_place") {
      const displayName = validation.displayName ?? requestedName;
      await this.storage.addItem(chatId, displayName, validation.source === "trusted_alias" ? "trusted_alias" : "google_places", validation);
      return this.textReply(await this.formatList(chatId));
    }

    if (validation.status === "api_error") {
      return this.confirmationReply(chatId, requestedName, `ตรวจ "${requestedName}" กับ Google Places ไม่สำเร็จ`);
    }

    return this.confirmationReply(chatId, requestedName, `ไม่แน่ใจว่า "${requestedName}" เป็นร้าน/อาหาร`);
  }

  private async confirmationReply(chatId: string, name: string, message: string): Promise<BotReply> {
    const id = await this.storage.createPendingConfirmation(chatId, name);
    return {
      text: message,
      quickReply: {
        items: [
          { type: "action", action: { type: "postback", label: "ยืนยันเพิ่ม", data: `confirm:${id}` } },
          { type: "action", action: { type: "postback", label: "ยกเลิก", data: `cancel:${id}` } }
        ]
      }
    };
  }

  private textReply(text: string): BotReply {
    return { text };
  }

  private menuReply(): BotReply {
    return {
      text: "เลือกสิ่งที่ต้องการ",
      quickReply: {
        items: [
          { type: "action", action: { type: "postback", label: "ดูรายการ", data: "menu:list" } },
          { type: "action", action: { type: "postback", label: "เพิ่มรายการ", data: "menu:add" } },
          { type: "action", action: { type: "postback", label: "ลดรายการ", data: "menu:remove" } }
        ]
      }
    };
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

}
