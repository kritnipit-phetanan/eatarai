import { normalizeText } from "./normalize.js";

const CUISINE_KEYWORDS = [
  "ชาบู",
  "หมูกระทะ",
  "ราเมง",
  "ส้มตำ",
  "ก๋วยเตี๋ยว",
  "ข้าวมันไก่",
  "บุฟเฟต์",
  "ซูชิ",
  "ปิ้งย่าง",
  "hotpot",
  "shabu",
  "sushi",
  "ramen",
  "bbq",
  "buffet"
];

export function isCuisineKeyword(input: string): boolean {
  const normalized = normalizeText(input);
  return CUISINE_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}
