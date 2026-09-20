import type { SupabaseClient } from "@supabase/supabase-js";
import { listItems, type RestaurantItemRow } from "./supabase.js";

export async function listMessage(client: SupabaseClient, chatId: string): Promise<Record<string, unknown>> {
  const items = await listItems(client, chatId);
  if (items.length === 0) return textMessage("ยังไม่มีรายการที่อยากกิน");
  if (!items.some((item) => item.google_place_id)) return textMessage(formatList(items));
  return {
    type: "flex",
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
          ...items.map(flexListItem)
        ]
      }
    }
  };
}

function flexListItem(item: RestaurantItemRow, index: number): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [
    { type: "text", text: `${index + 1}. ${item.name}`, size: "sm", wrap: true, flex: 1 }
  ];
  if (item.google_place_id) {
    contents.push({
      type: "button",
      style: "link",
      height: "sm",
      flex: 0,
      action: { type: "uri", label: "Map", uri: mapsUrl(item.matched_name ?? item.name, item.google_place_id) }
    });
  }
  return { type: "box", layout: "horizontal", alignItems: "center", contents };
}

function formatList(items: RestaurantItemRow[]): string {
  return ["รายการที่อยากกิน:", ...items.map((item, index) => `${index + 1}. ${item.name}`)].join("\n");
}

function mapsUrl(name: string, placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;
}

function textMessage(text: string): Record<string, unknown> {
  return { type: "text", text };
}
