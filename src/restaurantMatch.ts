import { normalizeText } from "./normalize.js";

export interface NamedRestaurant {
  id: number;
  name: string;
  normalized_name: string;
}

export interface RestaurantMatch<T extends NamedRestaurant> {
  item: T;
  exact: boolean;
  score: number;
}

/**
 * Returns only conservative candidates. Exact names can be acted on directly;
 * partial and near matches require the caller to ask for confirmation.
 */
export function matchRestaurantName<T extends NamedRestaurant>(items: T[], rawQuery: string): RestaurantMatch<T>[] {
  const query = compact(rawQuery);
  if (!query) return [];

  return items
    .map((item) => {
      const name = compact(item.normalized_name || normalizeText(item.name));
      if (name === query) return { item, exact: true, score: 0 };
      if (name.includes(query) || query.includes(name)) return { item, exact: false, score: 0 };

      const parts = normalizeText(item.name).split(" ").map(compact).filter(Boolean);
      const score = Math.min(...parts.map((part) => normalizedDistance(query, part)));
      return { item, exact: false, score };
    })
    .filter((match) => match.exact || match.score <= 0.2)
    .sort((left, right) => left.score - right.score || left.item.name.localeCompare(right.item.name));
}

function compact(value: string): string {
  return normalizeText(value).replace(/[\s\p{P}\p{S}]/gu, "");
}

function normalizedDistance(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 0;
  if (Math.abs(left.length - right.length) > Math.ceil(longest * 0.2)) return 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length]! / longest;
}
