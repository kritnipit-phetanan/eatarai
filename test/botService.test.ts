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

  it("adds any restaurant name immediately without calling Google", async () => {
    const client = new MockPlacesClient();
    const service = createService(client);

    const response = await service.handleCommand("group:1", { kind: "add", item: "Katsuya", source: "mention" });

    assert.match(response?.text ?? "", /1\. Katsuya/);
    assert.equal(client.calls, 0);
    assert.equal((await storage?.listItems("group:1"))?.[0]?.googlePlaceId, null);
  });

  it("searches Google only after the user sends location to add a map link", async () => {
    const client = new MockPlacesClient();
    const service = createService(client);

    await service.handleCommand("group:1", { kind: "add", item: "Sushiro", source: "explicit" });
    const prompt = await service.handleCommand("group:1", { kind: "map_link", item: "Sushiro" });
    assert.equal(prompt?.quickReply?.items[0]?.action.type, "location");
    assert.equal(client.calls, 0);

    const choices = await service.handleLocation("group:1", 13.7563, 100.5018);
    assert.equal(client.calls, 1);
    assert.equal(choices?.quickReply?.items.length, 2);
    const firstAction = choices?.quickReply?.items[0]?.action;
    assert.equal(firstAction?.type, "postback");
    assert.ok(firstAction && firstAction.type === "postback");
    const mapLinkData = firstAction.data;

    const foreignRoom = await service.handlePostback("room:2", mapLinkData);
    assert.match(foreignRoom?.text ?? "", /หมดอายุ/);

    const selected = await service.handlePostback("group:1", mapLinkData);
    assert.match(selected?.text ?? "", /google\.com\/maps\/search/);
    const item = (await storage?.listItems("group:1"))?.[0];
    assert.equal(item?.googlePlaceId, "places/sushiro-siam");
    assert.equal(item?.matchedAddress, "Siam Square, Bangkok");

    const list = await service.handleCommand("group:1", { kind: "show" });
    assert.equal(list?.flex?.altText, "รายการที่อยากกิน");
    const flexContents = JSON.stringify(list?.flex?.contents);
    assert.match(flexContents, /"label":"GGMap"/);
    assert.match(flexContents, /query_place_id=places%2Fsushiro-siam/);
  });

  it("does not call Google when no map link selection is pending", async () => {
    const client = new MockPlacesClient();
    const service = createService(client);

    const response = await service.handleLocation("group:1", 13.7563, 100.5018);

    assert.equal(response, null);
    assert.equal(client.calls, 0);
  });

  it("keeps menu lists and map link selection isolated by chat", async () => {
    const client = new MockPlacesClient();
    const service = createService(client);

    await service.handleCommand("group:1", { kind: "add", item: "Sushiro", source: "mention" });
    await service.handleCommand("room:2", { kind: "add", item: "Eat Am Are", source: "mention" });
    const groupList = await service.handlePostback("group:1", "menu:list");
    const roomList = await service.handlePostback("room:2", "menu:list");
    const mapLinkPrompt = await service.handleCommand("room:2", { kind: "map_link", item: "Sushiro" });

    assert.match(groupList?.text ?? "", /Sushiro/);
    assert.doesNotMatch(groupList?.text ?? "", /Eat Am Are/);
    assert.match(roomList?.text ?? "", /Eat Am Are/);
    assert.match(mapLinkPrompt?.text ?? "", /ไม่เจอ/);
  });

  it("applies the Google daily limit only to map link searches", async () => {
    const client = new MockPlacesClient();
    const service = createService(client, { ...baseConfig, googleGroupDailyValidationLimit: 0 });

    await service.handleCommand("group:1", { kind: "add", item: "Sushiro", source: "explicit" });
    await service.handleCommand("group:1", { kind: "map_link", item: "Sushiro" });
    const response = await service.handleLocation("group:1", 13.7563, 100.5018);

    assert.match(response?.text ?? "", /โควต้าค้นหาสถานที่วันนี้เต็มแล้ว/);
    assert.equal(client.calls, 0);
  });
});

class MockPlacesClient implements GooglePlacesClient {
  calls = 0;

  async searchLocations(
    _query: string,
    _latitude: number,
    _longitude: number,
    _config: GooglePlacesConfig
  ): Promise<PlaceValidation[]> {
    this.calls += 1;
    return [
      {
        placeId: "places/sushiro-siam",
        displayName: "Sushiro Siam Square",
        formattedAddress: "Siam Square, Bangkok",
        primaryType: "sushi_restaurant",
        types: ["restaurant", "sushi_restaurant"]
      },
      {
        placeId: "places/sushiro-centralworld",
        displayName: "Sushiro CentralWorld",
        formattedAddress: "CentralWorld, Bangkok",
        primaryType: "sushi_restaurant",
        types: ["restaurant", "sushi_restaurant"]
      }
    ];
  }
}
