# เมื่อไรจะไปกิน

LINE bot สำหรับเก็บลิสต์ร้านอาหารแยกตาม group, room และแชตส่วนตัว

```text
LINE Messaging API -> Cloudflare Worker -> Supabase REST/RPC
                              |                 |
                              |                 +-> PostgreSQL + RLS
                              +-> LIFF private flow -> Google Places Text Search
```

## การใช้งาน

```text
@เมื่อไรจะไปกิน
@เมื่อไรจะไปกิน เพิ่ม Shabushi
@เมื่อไรจะไปกิน ลบ Shabushi
@เมื่อไรจะไปกิน รายการ
```

- Mention เปล่า: ส่งรายการล่าสุดและ Flex menu ส่วนตัวสำหรับเพิ่ม/ลด
- Link ใน Flex เปิดได้เฉพาะ LINE user ที่เรียกบอต
- LIFF session และผลค้นหามีอายุ 20 นาที; session ใช้ซ้ำไม่ได้หลังบันทึก
- การเพิ่ม/ลดประกาศรายการล่าสุดในกลุ่มผ่าน Durable Object ต่อ `chatId`

## Google Places และ quota

Google Places Text Search เกิดเฉพาะตอนค้นหาร้านใกล้ตำแหน่งปัจจุบันใน LIFF. การเพิ่ม/ลดด้วยข้อความไม่เรียก Google.

- `GOOGLE_DAILY_VALIDATION_LIMIT=161`: เพดานรวมต่อวัน
- `GOOGLE_GROUP_DAILY_VALIDATION_LIMIT=80`: เพดานต่อแชตต่อวัน
- จำกัดการค้นหา server-side ต่อผู้ใช้ต่อแชต: 1 ครั้ง / 15 วินาที
- รับชื่อร้านสูงสุด 120 ตัวอักษร และตรวจพิกัดก่อนเรียก Google
- ผลค้นหาสูงสุด 5 สาขาต่อ request

Google server key อยู่ใน Cloudflare secret เท่านั้น และควร API-restrict เป็น Places API (New). Maps browser key ถ้าใช้ ต้องจำกัด HTTP referrer เป็น Worker URL.

## Supabase

Run migrations ตามลำดับใน Supabase SQL Editor:

1. [202608010001_cloudflare_liff.sql](supabase/migrations/202608010001_cloudflare_liff.sql)
2. [202609170001_grant_worker_table_access.sql](supabase/migrations/202609170001_grant_worker_table_access.sql)
3. [202609190001_liff_batch_selection.sql](supabase/migrations/202609190001_liff_batch_selection.sql)
4. [202609200001_harden_liff_flows.sql](supabase/migrations/202609200001_harden_liff_flows.sql)

RLS เปิดบนตาราง application ทั้งหมด. LIFF ไม่ติดต่อ Supabase โดยตรง; Worker ใช้ `SUPABASE_SERVICE_ROLE_KEY` เป็น secret. Cron ของ Worker ลบ LIFF session, candidates และ rate-limit records ที่หมดอายุเกิน 30 วันทุกวัน.

## Deploy

```bash
npm ci
npm test
npx wrangler login
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put LIFF_ID
npx wrangler secret put GOOGLE_MAPS_API_KEY
npx wrangler secret put BOT_DISPLAY_NAME
npx wrangler secret put GOOGLE_DAILY_VALIDATION_LIMIT
npx wrangler secret put GOOGLE_GROUP_DAILY_VALIDATION_LIMIT
npx wrangler secret put BOT_MAINTENANCE_MODE
npx wrangler deploy
```

ตั้ง LINE Messaging API webhook เป็น:

```text
https://eatarai.kp-dev.workers.dev/line/webhook
```

ตั้ง LIFF endpoint เป็น:

```text
https://eatarai.kp-dev.workers.dev/liff
```

เปิด maintenance:

```bash
npx wrangler secret put BOT_MAINTENANCE_MODE
# ใส่ true
```

ปิด maintenance โดยใส่ `false`. การแก้ secret ไม่ต้อง deploy ใหม่.

สำหรับ local Worker ให้ copy `.dev.vars.example` เป็น `.dev.vars`; ห้าม commit `.env`, `.dev.vars` หรือ secret ใด ๆ.

## ตรวจสอบ

```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run
npx wrangler tail eatarai --format pretty
```
