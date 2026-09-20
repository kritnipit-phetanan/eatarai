import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderLiffPage } from "../worker/liffPage.js";

describe("renderLiffPage", () => {
  it("renders a parseable browser script for batch add and remove flows", () => {
    const page = renderLiffPage("2011581201-MJaRRFyI");
    const scripts = [...page.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    const appScript = scripts.find((script) => script?.includes("selectedCandidates"));

    assert.ok(appScript);
    assert.doesNotThrow(() => new Function(appScript));
    assert.match(page, /ค้นหาร้านใกล้ฉัน/);
    assert.match(page, /ลดรายการที่เลือก/);
    assert.match(page, /เมนชัน @เมื่อไรจะไปกิน เพื่อเปิดเมนูของคุณเอง/);
    assert.match(page, /ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง/);
  });
});
