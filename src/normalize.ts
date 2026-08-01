export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function stripBotMention(text: string, botDisplayName: string): { mentioned: boolean; text: string } {
  const trimmed = text.trim();
  const names = [botDisplayName, `@${botDisplayName}`].filter(Boolean);

  for (const name of names) {
    if (trimmed === name) {
      return { mentioned: true, text: "" };
    }

    if (trimmed.startsWith(`${name} `)) {
      return { mentioned: true, text: trimmed.slice(name.length).trim() };
    }
  }

  return { mentioned: false, text: trimmed };
}

export function hasBotMentionPrefix(text: string, botDisplayName: string): boolean {
  const name = `@${botDisplayName}`;
  const trimmed = text.trim();
  return trimmed === name || trimmed.startsWith(`${name} `);
}
