import type { AppConfig } from "./config.js";
import type { GooglePlacesClient, GooglePlacesConfig } from "./googlePlaces.js";
import type { Storage } from "./storage.js";
import type { BotReply, ParsedCommand, RestaurantItem } from "./types.js";

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
      languageCode: config.googleLanguageCode
    };
  }

  async handleCommand(chatId: string, command: ParsedCommand): Promise<BotReply | null> {
    switch (command.kind) {
      case "ignore":
        return null;
      case "menu":
        return this.menuReply();
      case "show":
        return this.listReply(chatId);
      case "remove":
        return this.textReply(await this.removeItem(chatId, command.item));
      case "map_link":
        return this.beginMapLinkSelection(chatId, command.item);
      case "add":
        return this.addItem(chatId, command.item);
    }
  }

  async handlePostback(chatId: string, data: string): Promise<BotReply | null> {
    if (data === "menu:list") return this.listReply(chatId);
    if (data === "menu:add") return this.textReply("พิมพ์: @เมื่อไรจะไปกิน เพิ่ม <ชื่อร้าน>");
    if (data === "menu:remove") return this.textReply("พิมพ์: @เมื่อไรจะไปกิน ลบ <ชื่อร้าน>");
    if (data === "menu:map-link") return this.textReply("พิมพ์: @เมื่อไรจะไปกิน เพิ่มลิงก์แผนที่ <ชื่อร้าน>");

    const match = /^map-link:([0-9a-f-]{36})$/i.exec(data);
    if (!match) return null;

    const id = match[1];
    if (!id) return null;

    const pending = await this.storage.takePendingMapLink(chatId, id);
    if (!pending) return this.textReply("ตัวเลือกลิงก์หมดอายุหรือถูกดำเนินการไปแล้ว");

    const saved = await this.storage.setItemPlace(chatId, pending.itemId, pending.place);
    if (!saved) return this.textReply("ไม่พบรายการร้านนี้ในแชตนี้แล้ว");

    const name = pending.place.displayName ?? "สถานที่ที่เลือก";
    const mapsUrl = googleMapsUrl(name, pending.place.placeId);
    return this.textReply([`เพิ่มลิงก์แผนที่ของ ${name} แล้ว`, pending.place.formattedAddress, mapsUrl].filter(Boolean).join("\n"));
  }

  async handleLocation(chatId: string, latitude: number, longitude: number): Promise<BotReply | null> {
    const item = await this.storage.takeMapLinkSelection(chatId);
    if (!item) return null;

    const reservedGoogleCall = await this.storage.tryReserveGoogleCall(
      chatId,
      this.config.googleDailyValidationLimit,
      this.config.googleGroupDailyValidationLimit
    );
    if (!reservedGoogleCall) return this.textReply("โควต้าค้นหาสถานที่วันนี้เต็มแล้ว ลองใหม่พรุ่งนี้");

    const startedAt = Date.now();
    try {
      const places = await this.googlePlaces.searchLocations(item.name, latitude, longitude, this.placesConfig);
      console.info(JSON.stringify({ event: "google_places_map_link_search", query: item.name, latencyMs: Date.now() - startedAt }));
      if (places.length === 0) return this.textReply(`ไม่พบสถานที่ของ "${item.name}" ใกล้ตำแหน่งนี้`);

      const choices = await Promise.all(
        places.map(async (place) => ({
          place,
          id: await this.storage.createPendingMapLink(chatId, item.id, place)
        }))
      );
      return {
        text: `เลือกสถานที่สำหรับลิงก์แผนที่ของ ${item.name}`,
        quickReply: {
          items: choices.map(({ place, id }) => ({
            type: "action" as const,
            action: {
              type: "postback" as const,
              label: quickReplyLabel(place.displayName ?? item.name, place.formattedAddress),
              data: `map-link:${id}`
            }
          }))
        }
      };
    } catch (error) {
      console.error(JSON.stringify({ event: "google_places_map_link_search_failed", query: item.name, error: String(error) }));
      return this.textReply("ค้นหาสถานที่ไม่สำเร็จ ลองใหม่ภายหลัง");
    }
  }

  private async addItem(chatId: string, rawName: string): Promise<BotReply> {
    const name = rawName.trim();
    if (!name) return this.textReply("พิมพ์ชื่อร้านหรืออาหารที่อยากเพิ่มอีกครั้ง");

    await this.storage.addItem(chatId, name, "user_input", null);
    return this.textReply(await this.formatList(chatId));
  }

  private async beginMapLinkSelection(chatId: string, rawName: string): Promise<BotReply> {
    const name = rawName.trim();
    if (!name) return this.textReply("พิมพ์ชื่อร้านที่ต้องการเพิ่มลิงก์แผนที่อีกครั้ง");
    const started = await this.storage.beginMapLinkSelection(chatId, name);
    if (!started) return this.textReply(`ไม่เจอ "${name}" ในลิสต์ของแชตนี้`);
    return {
      text: `ส่งตำแหน่งเพื่อค้นหาสถานที่ของ ${name} ใกล้คุณ`,
      quickReply: {
        items: [
          { type: "action", action: { type: "location", label: "ส่งตำแหน่ง" } }
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
          { type: "action", action: { type: "postback", label: "ลดรายการ", data: "menu:remove" } },
          { type: "action", action: { type: "postback", label: "เพิ่มลิงก์แผนที่", data: "menu:map-link" } }
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

    return ["รายการที่อยากกิน:", ...items.map(formatListItem)].join("\n");
  }

  private async listReply(chatId: string): Promise<BotReply> {
    const items = await this.storage.listItems(chatId);
    if (items.length === 0) return this.textReply("ยังไม่มีรายการที่อยากกิน");
    if (!items.some((item) => item.googlePlaceId)) return this.textReply(await this.formatList(chatId));

    return {
      text: "รายการที่อยากกิน",
      flex: {
        altText: "รายการที่อยากกิน",
        contents: {
          type: "bubble",
          size: "mega",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "รายการที่อยากกิน", weight: "bold", size: "lg" },
              { type: "separator" },
              ...items.map(formatFlexListItem)
            ]
          }
        }
      }
    };
  }

}

function quickReplyLabel(name: string, address: string | null): string {
  const label = address ? `${name}: ${address}` : name;
  return label.length <= 20 ? label : `${label.slice(0, 17)}...`;
}

function googleMapsUrl(name: string, placeId: string | null): string {
  const query = encodeURIComponent(name);
  return placeId
    ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function formatListItem(item: RestaurantItem, index: number): string {
  if (!item.googlePlaceId) return `${index + 1}. ${item.name}`;

  const name = item.matchedName ?? item.name;
  return `${index + 1}. ${item.name}\n   ${googleMapsUrl(name, item.googlePlaceId)}`;
}

function formatFlexListItem(item: RestaurantItem, index: number): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [
    { type: "text", text: `${index + 1}. ${item.name}`, size: "sm", wrap: true, flex: 1 }
  ];

  if (item.googlePlaceId) {
    const name = item.matchedName ?? item.name;
    contents.push({
      type: "button",
      style: "link",
      height: "sm",
      flex: 0,
      action: { type: "uri", label: "GGMap", uri: googleMapsUrl(name, item.googlePlaceId) }
    });
  }

  return { type: "box", layout: "horizontal", alignItems: "center", contents };
}
