import type { PlaceValidation } from "./types.js";

export interface GooglePlacesConfig {
  apiKey: string;
  regionCode: string;
  languageCode: string;
}

export interface GooglePlacesClient {
  searchLocations(query: string, latitude: number, longitude: number, config: GooglePlacesConfig): Promise<PlaceValidation[]>;
}

const FOOD_TYPES = new Set([
  "restaurant",
  "thai_restaurant",
  "sushi_restaurant",
  "japanese_restaurant",
  "korean_restaurant",
  "chinese_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "food_court",
  "meal_takeaway",
  "bar",
  "pub"
]);

export class FetchGooglePlacesClient implements GooglePlacesClient {
  async searchLocations(query: string, latitude: number, longitude: number, config: GooglePlacesConfig): Promise<PlaceValidation[]> {
    if (!config.apiKey) {
      throw new Error("Missing GOOGLE_MAPS_API_KEY");
    }

    const body: Record<string, unknown> = {
      textQuery: query,
      regionCode: config.regionCode,
      languageCode: config.languageCode,
      pageSize: 3,
      locationBias: { circle: { center: { latitude, longitude }, radius: 50000 } }
    };

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.primaryType,places.types"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Google Places returned ${response.status}`);
    }

    const payload = (await response.json()) as GoogleTextSearchResponse;
    return (payload.places ?? []).flatMap(toPlaceValidation);
  }
}

function toPlaceValidation(place: GooglePlace): PlaceValidation[] {
  const types = place.types ?? [];
  const primaryType = place.primaryType ?? null;
  const allTypes = new Set([primaryType, ...types].filter((type): type is string => Boolean(type)));
  const isFoodPlace = [...allTypes].some((type) => FOOD_TYPES.has(type) || type.endsWith("_restaurant"));
  if (!isFoodPlace || !place.id) return [];
  return [{
    placeId: place.id,
    displayName: place.displayName?.text ?? null,
    formattedAddress: place.formattedAddress ?? null,
    primaryType,
    types
  }];
}

interface GoogleTextSearchResponse {
  places?: GooglePlace[];
}

export interface GooglePlace {
  id?: string;
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  primaryType?: string;
  types?: string[];
}
