import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BotService } from "../src/botService.js";
import type { AppConfig } from "../src/config.js";
import type { GooglePlacesClient, GooglePlacesConfig } from "../src/googlePlaces.js";
import type { PlaceValidation } from "../src/types.js";
import { MemoryStorage } from "./memoryStorage.js";

const baseConfig: AppConfig = {
  port: 3000,
  databaseUrl: "postgres://test",
  lineChannelSecret: "secret",
  lineChannelAccessToken: "token",
  botDisplayName: "เมื่อไรจะไปกิน",
  googleMapsApiKey: "google-key",
  googleRegionCode: "TH",
  googleLanguageCode: "th",
  googleLocationBias: "",
  googleDailyValidationLimit: 500,
  googleGroupDailyValidationLimit: 30
};

describe("BotService", () => {
  let storage: MemoryStorage | null = null;

  afterEach(() => {
    void storage?.close();
    storage = null;
  });

  function createService(client: GooglePlacesClient, config: AppConfig = baseConfig): BotService {
    storage = new MemoryStorage();
    return new BotService(storage, client, config);
  }

  it("uses Google once, caches the result, and dedupes by place id", async () => {
    const client = new MockPlacesClient(foodValidation("Sukishi"));
    const service = createService(client);

    const first = await service.handleCommand("group:1", { kind: "add", item: "Sukishi", source: "mention" });
    const second = await service.handleCommand("group:1", { kind: "add", item: "Sukishi", source: "mention" });

    assert.match(first ?? "", /1\. Sukishi/);
    assert.match(second ?? "", /1\. Sukishi/);
    assert.equal(client.calls, 1);
    assert.equal((await storage?.listItems("group:1"))?.length, 1);
  });

  it("adds cuisine keywords without calling Google", async () => {
    const client = new MockPlacesClient(foodValidation("unused"));
    const service = createService(client);

    const response = await service.handleCommand("group:1", { kind: "add", item: "ชาบู", source: "explicit" });

    assert.match(response ?? "", /1\. ชาบู/);
    assert.equal(client.calls, 0);
  });

  it("asks for confirmation for non-food and reuses cached non-food result", async () => {
    const client = new MockPlacesClient({
      status: "non_food_place",
      normalizedQuery: "central world",
      regionCode: "TH",
      languageCode: "th",
      placeId: "places/central",
      displayName: "Central World",
      formattedAddress: "Bangkok",
      primaryType: "shopping_mall",
      types: ["shopping_mall"],
      source: "google"
    });
    const service = createService(client);

    const first = await service.handleCommand("group:1", { kind: "add", item: "Central World", source: "mention" });
    const second = await service.handleCommand("group:1", { kind: "add", item: "Central World", source: "mention" });

    assert.match(first ?? "", /ไม่แน่ใจ/);
    assert.match(second ?? "", /ยืนยัน Central World/);
    assert.equal(client.calls, 1);
  });

  it("does not call Google when the group daily limit is reached", async () => {
    const client = new MockPlacesClient(foodValidation("Sukishi"));
    const service = createService(client, { ...baseConfig, googleGroupDailyValidationLimit: 0 });

    const response = await service.handleCommand("group:1", { kind: "add", item: "Sukishi", source: "mention" });

    assert.match(response ?? "", /โควตาตรวจร้านวันนี้เต็มแล้ว/);
    assert.equal(client.calls, 0);
  });
});

class MockPlacesClient implements GooglePlacesClient {
  calls = 0;

  constructor(private readonly validation: PlaceValidation) {}

  async searchText(_query: string, _config: GooglePlacesConfig): Promise<PlaceValidation> {
    this.calls += 1;
    return this.validation;
  }
}

function foodValidation(name: string): PlaceValidation {
  return {
    status: "food_place",
    normalizedQuery: name.toLocaleLowerCase("en-US"),
    regionCode: "TH",
    languageCode: "th",
    placeId: "places/sukishi",
    displayName: name,
    formattedAddress: "Bangkok",
    primaryType: "sushi_restaurant",
    types: ["restaurant", "sushi_restaurant"],
    source: "google"
  };
}
