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
    const client = new MockPlacesClient(foodValidation("Katsuya"));
    const service = createService(client);

    const first = await service.handleCommand("group:1", { kind: "add", item: "Katsuya", source: "mention" });
    const second = await service.handleCommand("group:1", { kind: "add", item: "Katsuya", source: "mention" });

    assert.match(first?.text ?? "", /1\. Katsuya/);
    assert.match(second?.text ?? "", /1\. Katsuya/);
    assert.equal(client.calls, 1);
    assert.equal((await storage?.listItems("group:1"))?.length, 1);
  });

  it("adds trusted restaurant aliases without calling Google", async () => {
    const client = new MockPlacesClient(foodValidation("unused"));
    const service = createService(client);

    const response = await service.handleCommand("group:1", { kind: "add", item: "Sushiro", source: "explicit" });

    assert.match(response?.text ?? "", /1\. Sushiro/);
    assert.equal(client.calls, 0);
  });

  it("uses Google for cuisine words that are not trusted aliases", async () => {
    const client = new MockPlacesClient(foodValidation("unused"));
    const service = createService(client);

    const response = await service.handleCommand("group:1", { kind: "add", item: "ชาบู", source: "explicit" });

    assert.match(response?.text ?? "", /1\. unused/);
    assert.equal(client.calls, 1);
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

    assert.match(first?.text ?? "", /ไม่แน่ใจ/);
    assert.equal(first?.quickReply?.items.length, 2);
    const confirmData = first?.quickReply?.items[0]?.action.data;
    assert.match(confirmData ?? "", /^confirm:/);

    const foreignRoom = await service.handlePostback("room:2", confirmData ?? "");
    assert.match(foreignRoom?.text ?? "", /หมดอายุ/);
    assert.equal((await storage?.listItems("room:2"))?.length, 0);

    const confirmed = await service.handlePostback("group:1", confirmData ?? "");
    assert.match(confirmed?.text ?? "", /1\. Central World/);

    assert.match(second?.text ?? "", /ไม่แน่ใจ/);
    assert.equal(second?.quickReply?.items.length, 2);
    assert.equal(client.calls, 1);
  });

  it("returns menu lists only for the originating chat", async () => {
    const client = new MockPlacesClient(foodValidation("unused"));
    const service = createService(client);

    await service.handleCommand("group:1", { kind: "add", item: "Sushiro", source: "mention" });
    await service.handleCommand("room:2", { kind: "add", item: "Eat Am Are", source: "mention" });

    const groupList = await service.handlePostback("group:1", "menu:list");
    const roomList = await service.handlePostback("room:2", "menu:list");

    assert.match(groupList?.text ?? "", /Sushiro/);
    assert.doesNotMatch(groupList?.text ?? "", /Eat Am Are/);
    assert.match(roomList?.text ?? "", /Eat Am Are/);
    assert.doesNotMatch(roomList?.text ?? "", /Sushiro/);
  });

  it("does not call Google when the group daily limit is reached", async () => {
    const client = new MockPlacesClient(foodValidation("Katsuya"));
    const service = createService(client, { ...baseConfig, googleGroupDailyValidationLimit: 0 });

    const response = await service.handleCommand("group:1", { kind: "add", item: "Katsuya", source: "mention" });

    assert.match(response?.text ?? "", /โควตาตรวจร้านวันนี้เต็มแล้ว/);
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
