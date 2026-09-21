import { normalizeText, stripBotMention } from "./normalize.js";
import type { ParsedCommand } from "./types.js";

const SHOW_COMMANDS = new Set(["รายการ", "list", "กินไรดี"]);

export function parseCommand(rawText: string, botDisplayName: string, isBotMentioned: boolean): ParsedCommand {
  const mention = stripBotMention(rawText, botDisplayName);
  const text = mention.text.trim();
  const normalized = normalizeText(text);

  if (!isBotMentioned) return { kind: "ignore" };
  if (!text) return mention.mentioned ? { kind: "menu" } : { kind: "ignore" };
  if (SHOW_COMMANDS.has(normalized)) return { kind: "show" };
  if (text === "ยืนยัน" || text.startsWith("ยืนยัน ")) return { kind: "ignore" };

  const remove = matchRemove(text);
  if (remove) return { kind: "remove", item: remove };

  const mapLink = matchPrefix(text, ["เพิ่มแผนที่", "เพิ่มลิงก์แผนที่", "เพิ่มลิงก์", "ใส่ลิงก์"]);
  if (mapLink) return { kind: "map_link", item: mapLink };

  const explicitAdd = matchPrefix(text, ["เพิ่ม", "อยากกิน", "+"]);
  if (explicitAdd) return { kind: "add", item: explicitAdd, source: "explicit" };

  if (mention.mentioned) {
    return { kind: "add", item: text, source: "mention" };
  }

  return { kind: "ignore" };
}

function matchPrefix(text: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    if (text === prefix) return null;
    if (text.startsWith(prefix)) {
      const item = text.slice(prefix.length).trim();
      return item || null;
    }
  }
  return null;
}

function matchRemove(text: string): string | null {
  const deletePrefix = matchPrefix(text, ["ลบ"]);
  if (deletePrefix) return deletePrefix;

  if (text.startsWith("กิน")) {
    const candidate = text.slice("กิน".length).trim();
    for (const suffix of ["มาแล้ว", "แล้ว"]) {
      if (candidate.endsWith(suffix)) {
        const item = candidate.slice(0, -suffix.length).trim();
        return item || null;
      }
    }
  }

  return null;
}
