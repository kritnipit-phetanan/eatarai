import { normalizeText, stripBotMention } from "./normalize.js";
import type { ParsedCommand } from "./types.js";

const SHOW_COMMANDS = new Set(["รายการ", "list", "กินไรดี"]);
const STATS_COMMANDS = new Set(["stats", "สถิติ", "debug stats"]);

export function parseCommand(rawText: string, botDisplayName: string): ParsedCommand {
  const mention = stripBotMention(rawText, botDisplayName);
  const text = mention.text.trim();
  const normalized = normalizeText(text);

  if (!text) return { kind: "ignore" };
  if (SHOW_COMMANDS.has(normalized)) return { kind: "show" };
  if (STATS_COMMANDS.has(normalized)) return { kind: "stats" };

  const confirm = matchPrefix(text, ["ยืนยัน"]);
  if (confirm) return { kind: "confirm", item: confirm };

  const remove = matchRemove(text);
  if (remove) return { kind: "remove", item: remove };

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
    if (text.startsWith(`${prefix} `)) {
      const item = text.slice(prefix.length).trim();
      return item || null;
    }
  }
  return null;
}

function matchRemove(text: string): string | null {
  const deletePrefix = matchPrefix(text, ["ลบ"]);
  if (deletePrefix) return deletePrefix;

  if (text.startsWith("กิน ") && text.endsWith(" แล้ว")) {
    const item = text.slice("กิน ".length, -" แล้ว".length).trim();
    return item || null;
  }

  return null;
}
