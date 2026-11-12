import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/miniapp/shop/page.tsx", import.meta.url), "utf8");
const fallbackStart = source.indexOf("  // Differentiate an expired LINE session");
const fallbackEnd = source.indexOf("  return (\n    <main", fallbackStart + 1);
const fallback = source.slice(fallbackStart, fallbackEnd);

test("the catalogue failure screen uses the Lotus's design and Thai messaging", () => {
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart);
  assert.match(fallback, /<LotusBrand size="sm" align="center" \/>/);
  assert.match(fallback, /rounded-\[26px\]/);
  assert.match(fallback, /bg-\[#F2F8F6\]/);
  assert.match(fallback, /bg-\[#FFBE16\]/);
  assert.match(fallback, /โหลดสินค้าไม่สำเร็จ/);
  assert.match(fallback, /เซสชัน LINE ของคุณหมดอายุ/);
  assert.doesNotMatch(fallback, /bg-white border rounded-2xl p-6 mt-5|text-red-600/);
});

test("expired LINE sessions have a functional LIFF relaunch and a separate home action", () => {
  assert.match(fallback, /lineSessionExpired = message\.includes\("เซสชัน LINE หมดอายุ"\)/);
  assert.match(fallback, /https:\/\/liff\.line\.me\/\$\{encodeURIComponent\(configuredLiffId\)\}/);
  assert.match(fallback, /href=\{lineMiniAppUrl\}/);
  assert.match(fallback, /เปิดผ่าน LINE อีกครั้ง/);
  assert.match(fallback, /onClick=\{goCustomerHome\}/);
  assert.match(fallback, /กลับหน้าหลัก/);
});

test("ordinary product load failures still show their real message and a retry action", () => {
  assert.match(fallback, /: message \|\| "ไม่สามารถโหลดข้อมูลสินค้าได้ กรุณาลองใหม่อีกครั้ง"/);
  assert.match(fallback, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(fallback, /ลองโหลดอีกครั้ง/);
  assert.match(source, /lineApiFetch\(/);
});
