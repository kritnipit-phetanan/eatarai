import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchRestaurantName } from "../src/restaurantMatch.js";

const items = [
  { id: 1, name: "Sushiro MBK", normalized_name: "sushiro mbk" },
  { id: 2, name: "Sushiro Siam", normalized_name: "sushiro siam" },
  { id: 3, name: "Midori", normalized_name: "midori" }
];

describe("matchRestaurantName", () => {
  it("marks an exact item as safe to remove immediately", () => {
    assert.deepEqual(matchRestaurantName(items, "Midori"), [{ item: items[2], exact: true, score: 0 }]);
  });

  it("returns partial and small typo matches for confirmation", () => {
    assert.deepEqual(matchRestaurantName(items, "Sushiro").map(({ item, exact }) => [item.name, exact]), [
      ["Sushiro MBK", false],
      ["Sushiro Siam", false]
    ]);
    assert.deepEqual(matchRestaurantName(items, "Midor").map(({ item, exact }) => [item.name, exact]), [["Midori", false]]);
  });

  it("does not guess unrelated names", () => {
    assert.deepEqual(matchRestaurantName(items, "Shabushi"), []);
  });
});
