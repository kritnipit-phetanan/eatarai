export type ChatType = "group" | "room" | "user";

export type PendingInputMode = "add" | "remove" | "map_link";

export type ParsedCommand =
  | { kind: "menu" }
  | { kind: "add"; item: string; source: "explicit" | "mention" }
  | { kind: "remove"; item: string }
  | { kind: "map_link"; item: string }
  | { kind: "show" }
  | { kind: "ignore" };

export interface PlaceValidation {
  placeId: string | null;
  displayName: string | null;
  formattedAddress: string | null;
  primaryType: string | null;
  types: string[];
}

export interface RestaurantItem {
  id: number;
  chatId: string;
  name: string;
  normalizedName: string;
  source: "user_input" | "google_places" | "trusted_alias" | "manual_confirm";
  googlePlaceId: string | null;
  matchedName: string | null;
  matchedAddress: string | null;
  matchedTypes: string[];
  createdAt: string;
}

export interface BotReply {
  text: string;
  flex?: {
    altText: string;
    contents: Record<string, unknown>;
  };
  quickReply?: {
    items: Array<{
      type: "action";
      action:
        | { type: "postback"; label: string; data: string }
        | { type: "location"; label: string };
    }>;
  };
}

export interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source?: {
    type?: ChatType;
    groupId?: string;
    roomId?: string;
    userId?: string;
  };
  message?: {
    type?: string;
    text?: string;
    latitude?: number;
    longitude?: number;
    mention?: {
      mentionees?: Array<{
        isSelf?: boolean;
      }>;
    };
  };
  postback?: {
    data?: string;
  };
}
