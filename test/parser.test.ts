import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/parser.js";

const BOT = "เมื่อไรจะไปกิน";

describe("parseCommand", () => {
  it("requires a real bot mention for all commands", () => {
    assert.deepEqual(parseCommand("เพิ่ม Sukishi", BOT, false), { kind: "ignore" });
    assert.deepEqual(parseCommand("รายการ", BOT, false), { kind: "ignore" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน เพิ่ม Sukishi", BOT, true), {
      kind: "add",
      item: "Sukishi",
      source: "explicit"
    });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน อยากกิน Hotpot Man", BOT, true), {
      kind: "add",
      item: "Hotpot Man",
      source: "explicit"
    });
  });

  it("parses bot mention as add", () => {
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน Sukishi", BOT, true), {
      kind: "add",
      item: "Sukishi",
      source: "mention"
    });
  });

  it("opens the menu when the bot is mentioned without a command", () => {
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน", BOT, true), { kind: "menu" });
  });

  it("ignores standalone text without mention", () => {
    assert.deepEqual(parseCommand("Sukishi", BOT, false), { kind: "ignore" });
  });

  it("parses show and remove commands", () => {
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน รายการ", BOT, true), { kind: "show" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน กิน Sukishi แล้ว", BOT, true), { kind: "remove", item: "Sukishi" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน ลบ Hotpot Man", BOT, true), { kind: "remove", item: "Hotpot Man" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน ยืนยัน Central World", BOT, true), { kind: "ignore" });
  });

  it("parses map link commands only when the bot is mentioned", () => {
    assert.deepEqual(parseCommand("เพิ่มลิงก์แผนที่ Sushiro", BOT, false), { kind: "ignore" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน เพิ่มลิงก์แผนที่ Sushiro", BOT, true), {
      kind: "map_link",
      item: "Sushiro"
    });
  });
});
