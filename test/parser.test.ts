import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasBotMentionPrefix } from "../src/normalize.js";
import { parseCommand } from "../src/parser.js";

const BOT = "เมื่อไรจะไปกิน";

describe("parseCommand", () => {
  it("recognizes only an exact @bot-name text prefix for the fallback", () => {
    assert.equal(hasBotMentionPrefix("@เมื่อไรจะไปกิน เพิ่ม Sukishi", BOT), true);
    assert.equal(hasBotMentionPrefix("@เมื่อไรจะไปกิน", BOT), true);
    assert.equal(hasBotMentionPrefix("@เมื่อไรจะไปกินลบMidori", BOT), true);
    assert.equal(hasBotMentionPrefix("เมื่อไรจะไปกิน เพิ่ม Sukishi", BOT), false);
    assert.equal(hasBotMentionPrefix("@เมื่อไรจะไปกินนะ เพิ่ม Sukishi", BOT), false);
    assert.equal(hasBotMentionPrefix("มาคุยกับ @เมื่อไรจะไปกิน เพิ่ม Sukishi", BOT), false);
  });

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
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน กิน Sukishi มาแล้ว", BOT, true), { kind: "remove", item: "Sukishi" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกินกินSushiroแล้ว", BOT, true), { kind: "remove", item: "Sushiro" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน ลบ Hotpot Man", BOT, true), { kind: "remove", item: "Hotpot Man" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกินลบMidori", BOT, true), { kind: "remove", item: "Midori" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน ยืนยัน Central World", BOT, true), { kind: "ignore" });
  });

  it("accepts add commands without a space after the mention or command", () => {
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกินเพิ่มMidori", BOT, true), {
      kind: "add",
      item: "Midori",
      source: "explicit"
    });
  });

  it("parses map commands only when the bot is mentioned", () => {
    assert.deepEqual(parseCommand("เพิ่มแผนที่ Sushiro", BOT, false), { kind: "ignore" });
    assert.deepEqual(parseCommand("@เมื่อไรจะไปกิน เพิ่มแผนที่ Sushiro", BOT, true), {
      kind: "map_link",
      item: "Sushiro"
    });
    for (const command of ["เพิ่มลิงก์แผนที่", "เพิ่มลิงก์", "ใส่ลิงก์"]) {
      assert.deepEqual(parseCommand(`@เมื่อไรจะไปกิน ${command} Sushiro`, BOT, true), {
        kind: "map_link",
        item: "Sushiro"
      });
    }
  });
});
