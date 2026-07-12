export interface AppConfig {
  port: number;
  databaseUrl: string;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  botDisplayName: string;
  googleMapsApiKey: string;
  googleRegionCode: string;
  googleLanguageCode: string;
  googleLocationBias: string;
  googleDailyValidationLimit: number;
  googleGroupDailyValidationLimit: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: numberFromEnv(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? "",
    lineChannelSecret: env.LINE_CHANNEL_SECRET ?? "",
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    botDisplayName: env.BOT_DISPLAY_NAME ?? "เมื่อไรจะไปกิน",
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? "",
    googleRegionCode: env.GOOGLE_REGION_CODE ?? "TH",
    googleLanguageCode: env.GOOGLE_LANGUAGE_CODE ?? "th",
    googleLocationBias: env.GOOGLE_LOCATION_BIAS ?? "",
    googleDailyValidationLimit: numberFromEnv(env.GOOGLE_DAILY_VALIDATION_LIMIT, 500),
    googleGroupDailyValidationLimit: numberFromEnv(env.GOOGLE_GROUP_DAILY_VALIDATION_LIMIT, 30)
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
