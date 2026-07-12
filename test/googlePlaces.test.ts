import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPlaces } from "../src/googlePlaces.js";

const config = {
  apiKey: "key",
  regionCode: "TH",
  languageCode: "th",
  locationBias: ""
};

describe("classifyPlaces", () => {
  it("classifies food place by restaurant subtype", () => {
    const result = classifyPlaces("Sukishi", config, [
      {
        id: "places/sukishi",
        displayName: { text: "Sukishi" },
        primaryType: "sushi_restaurant",
        types: ["restaurant", "sushi_restaurant"]
      }
    ]);

    assert.equal(result.status, "food_place");
  });

  it("classifies obvious non-food places", () => {
    const result = classifyPlaces("Central World", config, [
      {
        id: "places/central",
        displayName: { text: "Central World" },
        primaryType: "shopping_mall",
        types: ["shopping_mall"]
      }
    ]);

    assert.equal(result.status, "non_food_place");
  });

  it("classifies no result", () => {
    const result = classifyPlaces("unknown", config, []);
    assert.equal(result.status, "no_result");
  });
});
