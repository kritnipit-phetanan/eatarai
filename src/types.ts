export type ChatType = "group" | "room" | "user";

export type ParsedCommand =
  | { kind: "menu" }
  | { kind: "add"; item: string; source: "explicit" | "mention" }
  | { kind: "remove"; item: string }
  | { kind: "show" }
  | { kind: "ignore" };

export type ValidationStatus =
  | "food_place"
  | "non_food_place"
  | "no_result"
  | "ambiguous"
  | "api_error";

export interface PlaceValidation {
  status: ValidationStatus;
  normalizedQuery: string;
  regionCode: string;
  languageCode: string;
  placeId: string | null;
  displayName: string | null;
  formattedAddress: string | null;
  primaryType: string | null;
  types: string[];
  source: "cache" | "google" | "trusted_alias" | "limit";
}

export interface RestaurantItem {
  id: number;
  chatId: string;
  name: string;
  normalizedName: string;
  source: "google_places" | "trusted_alias" | "manual_confirm";
  googlePlaceId: string | null;
  matchedName: string | null;
  matchedAddress: string | null;
  matchedTypes: string[];
  createdAt: string;
}

export interface BotReply {
  text: string;
  quickReply?: {
    items: Array<{
      type: "action";
      action: {
        type: "postback";
        label: string;
        data: string;
      };
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
