import { readFileSync } from "node:fs";
import { normalizeText } from "./normalize.js";

const aliases = JSON.parse(readFileSync(new URL("../trustedRestaurantAliases.json", import.meta.url), "utf8")) as unknown;

export function isTrustedRestaurantAlias(input: string): boolean {
  const normalized = normalizeText(input);
  return Array.isArray(aliases) && aliases.some((alias) => typeof alias === "string" && normalized === normalizeText(alias));
}
