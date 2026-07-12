import { isCuisineKeyword } from "./cuisine.js";
import { normalizeText } from "./normalize.js";
import type { PlaceValidation, ValidationStatus } from "./types.js";

export interface GooglePlacesConfig {
  apiKey: string;
  regionCode: string;
  languageCode: string;
  locationBias: string;
}

export interface GooglePlacesClient {
  searchText(query: string, config: GooglePlacesConfig): Promise<PlaceValidation>;
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

const NON_FOOD_HINTS = new Set([
  "shopping_mall",
  "school",
  "university",
  "office",
  "hotel",
  "lodging",
  "store",
  "department_store"
]);

export class FetchGooglePlacesClient implements GooglePlacesClient {
  async searchText(query: string, config: GooglePlacesConfig): Promise<PlaceValidation> {
    if (!config.apiKey) {
      return makeValidation("api_error", query, config, null, "Missing GOOGLE_MAPS_API_KEY");
    }

    const body: Record<string, unknown> = {
      textQuery: `${query} Thailand`,
      regionCode: config.regionCode,
      languageCode: config.languageCode
    };

    if (config.locationBias) {
      body.locationBias = parseLocationBias(config.locationBias);
    }

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
      return makeValidation("api_error", query, config, null, `Google Places returned ${response.status}`);
    }

    const payload = (await response.json()) as GoogleTextSearchResponse;
    return classifyPlaces(query, config, payload.places ?? []);
  }
}

export function validateLocalKeyword(query: string, config: GooglePlacesConfig): PlaceValidation | null {
  if (!isCuisineKeyword(query)) return null;

  return {
    status: "food_place",
    normalizedQuery: normalizeText(query),
    regionCode: config.regionCode,
    languageCode: config.languageCode,
    placeId: null,
    displayName: query.trim(),
    formattedAddress: null,
    primaryType: "cuisine_keyword",
    types: ["cuisine_keyword"],
    source: "local_keyword"
  };
}

export function classifyPlaces(
  query: string,
  config: GooglePlacesConfig,
  places: GooglePlace[]
): PlaceValidation {
  if (places.length === 0) {
    return makeValidation("no_result", query, config, null);
  }

  const top = places[0];
  if (!top) return makeValidation("no_result", query, config, null);

  const types = top.types ?? [];
  const primaryType = top.primaryType ?? null;
  const allTypes = new Set([primaryType, ...types].filter((type): type is string => Boolean(type)));
  const hasFoodType = [...allTypes].some((type) => FOOD_TYPES.has(type) || type.endsWith("_restaurant"));

  let status: ValidationStatus;
  if (hasFoodType) {
    status = "food_place";
  } else if ([...allTypes].some((type) => NON_FOOD_HINTS.has(type))) {
    status = "non_food_place";
  } else {
    status = "ambiguous";
  }

  return {
    status,
    normalizedQuery: normalizeText(query),
    regionCode: config.regionCode,
    languageCode: config.languageCode,
    placeId: top.id ?? null,
    displayName: top.displayName?.text ?? null,
    formattedAddress: top.formattedAddress ?? null,
    primaryType,
    types,
    source: "google"
  };
}

function makeValidation(
  status: ValidationStatus,
  query: string,
  config: GooglePlacesConfig,
  place: GooglePlace | null,
  error?: string
): PlaceValidation {
  return {
    status,
    normalizedQuery: normalizeText(query),
    regionCode: config.regionCode,
    languageCode: config.languageCode,
    placeId: place?.id ?? null,
    displayName: place?.displayName?.text ?? null,
    formattedAddress: error ?? place?.formattedAddress ?? null,
    primaryType: place?.primaryType ?? null,
    types: place?.types ?? [],
    source: "google"
  };
}

function parseLocationBias(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
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
