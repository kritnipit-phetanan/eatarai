import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/parser.js";

const BOT = "เมื่อไรจะไปกิน";

describe("parseCommand", () => {
  it("parses explicit add commands", () => {
    assert.deepEqual(parseCommand("เพิ่ม Sukishi", BOT), {
      kind: "add",
      item: "Sukishi",
      source: "explicit"
    });
    assert.deepEqual(parseCommand("อยากกิน Hotpot Man", BOT), {
      kind: "add",
      item: "Hotpot Man",
      source: "explicit"
    });
  });

  it("parses bot mention as add", () => {
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน Sukishi", BOT), {
      kind: "add",
      item: "Sukishi",
      source: "mention"
    });
  });

  it("ignores standalone text without mention", () => {
    assert.deepEqual(parseCommand("Sukishi", BOT), { kind: "ignore" });
  });

  it("parses show, remove, and confirm commands", () => {
    assert.deepEqual(parseCommand("รายการ", BOT), { kind: "show" });
    assert.deepEqual(parseCommand("กิน Sukishi แล้ว", BOT), { kind: "remove", item: "Sukishi" });
    assert.deepEqual(parseCommand("ลบ Hotpot Man", BOT), { kind: "remove", item: "Hotpot Man" });
    assert.deepEqual(parseCommand("ยืนยัน Central World", BOT), { kind: "confirm", item: "Central World" });
  });
});
