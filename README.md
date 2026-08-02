# เมื่อไรจะไปกิน

LINE bot สำหรับรายการร้านที่อยากกิน โดยแยกข้อมูลตาม LINE group, multi-person room และแชตส่วนตัว

## Architecture

การ deploy ปัจจุบันบน Render ยังทำงานได้ ระหว่างย้ายให้ใช้ Cloudflare ตามโครงสร้างนี้:

```text
LINE Messaging API -> Cloudflare Worker -> Supabase REST/RPC -> Supabase PostgreSQL
                              |
                              +-> LIFF private flow (/liff)
                              +-> Google Places Text Search (เฉพาะค้นหาสาขา)
```

Worker ไม่มี `pg.Pool` และไม่เปิด TCP connection ไป Postgres โดยตรง แต่ใช้ Supabase REST และ RPC ผ่าน `@supabase/supabase-js` แทน จึงเหมาะกับ Cloudflare Workers ที่เป็น stateless request runtime.

## User flows

คำสั่งตรงเป็น public: ทุกคนในแชตเห็นผลลัพธ์

```text
@เมื่อไรจะไปกิน เพิ่ม Shabushi
@เมื่อไรจะไปกิน ลบ Shabushi
@เมื่อไรจะไปกิน กิน Shabushi มาแล้ว
@เมื่อไรจะไปกิน รายการ
@เมื่อไรจะไปกิน เพิ่มแผนที่ Shabushi
```

คำสั่งแผนที่รองรับ `เพิ่มแผนที่`, `เพิ่มลิงก์แผนที่`, `เพิ่มลิงก์` และ `ใส่ลิงก์`.

- เพิ่ม/ลบ/รายการ: บันทึกหรือแสดงใน chat นั้นทันที โดยไม่เรียก Google
- เพิ่มแผนที่: เปิด LIFF เฉพาะผู้สั่ง เลือกตำแหน่งจากตำแหน่งปัจจุบันหรือ Maps picker, ค้น Google Places, เลือกสาขา แล้วค่อยประกาศรายการอัปเดตใน chat
- mention เปล่า `@เมื่อไรจะไปกิน`: LINE ต้องแนบ Quick Reply กับข้อความหนึ่งข้อความเสมอ Worker จึงส่งข้อความ zero-width ที่ไม่มีคำบรรยาย พร้อมปุ่มเปิด LIFF ของผู้กด
- LIFF session ถูกผูกกับ `chat_id + owner_user_id`; คนอื่นที่ได้ URL ไปจะอ่านหรือบันทึกแทนไม่ได้

ข้อมูล chat key:

- group: `group:<groupId>`
- multi-person room: `room:<roomId>`
- direct chat: `user:<userId>`

## Google Maps cost control

เพิ่มร้านไม่เรียก Google. Google Places Text Search (New) เกิดเฉพาะหลังผู้ใช้เลือกตำแหน่งใน LIFF เพื่อหา branch สำหรับผูก Maps link.

```text
เพิ่มร้าน -> เพิ่มแผนที่ -> เลือกตำแหน่ง -> reserve quota (RPC) -> Text Search -> เลือกสาขา
```

- `GOOGLE_DAILY_VALIDATION_LIMIT`: เพดานทุก chat ต่อวัน
- `GOOGLE_GROUP_DAILY_VALIDATION_LIMIT`: เพดานต่อ chat ต่อวัน
- `bot_reserve_google_call` ใช้ advisory lock ใน Postgres จึงกัน concurrent request เกินเพดานได้
- ผลค้นหาเก็บ `place_id`, ชื่อ, ที่อยู่ และ types ไว้กับรายการ
- Maps URL ไม่เรียก API: `https://www.google.com/maps/search/?api=1&query=<name>&query_place_id=<place-id>`
- `MAPS_BROWSER_KEY` ใช้เฉพาะการเปิด map picker ใน LIFF และต้องจำกัดด้วย HTTP referrer เมื่อทราบ Worker URL แล้ว

## Supabase setup

1. เปิด Supabase project > SQL Editor
2. วางและ Run ไฟล์ [202608010001_cloudflare_liff.sql](supabase/migrations/202608010001_cloudflare_liff.sql)
3. Project Settings > API: เก็บ `Project URL` และ `service_role` key ไว้สำหรับ Worker secret เท่านั้น

Migration สร้างตาราง `restaurant_items`, `google_call_log`, `liff_flow_sessions`, `liff_map_candidates` และ RPC สองตัว:

- `bot_reserve_google_call`: นับ quota Google แบบ atomic
- `bot_take_liff_flow_session`: ใช้ session ได้ครั้งเดียว

RLS ถูกเปิดโดยไม่มี anonymous policy. LIFF ไม่ติดต่อ Supabase โดยตรง; Worker เท่านั้นที่ใช้ service-role secret.

## Cloudflare Worker deployment

ลำดับนี้มี deploy สองครั้ง เพราะต้องมี Worker URL ก่อนจึงจะ register LIFF endpoint ได้:

```bash
npm ci
npm test
npx wrangler login
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put LIFF_ID # ใส่ pending ชั่วคราวสำหรับ deploy ครั้งแรก
npx wrangler secret put GOOGLE_MAPS_API_KEY
npx wrangler secret put MAPS_BROWSER_KEY
npx wrangler secret put BOT_DISPLAY_NAME
npx wrangler deploy
```

สำหรับ local Worker ให้ copy `.dev.vars.example` เป็น `.dev.vars`; ห้าม commit `.dev.vars`.

หลัง deploy จะได้ Worker URL รูปแบบ `https://eatarai.<account-subdomain>.workers.dev`.

1. Deploy Worker ครั้งแรก แล้วจด URL ที่ได้
2. ใน LINE Developers สร้าง LIFF app ภายใต้ LINE Login channel โดยใช้ Endpoint URL `https://eatarai.<account-subdomain>.workers.dev/liff`
3. ใส่ LIFF ID ที่ได้แทนค่า `pending`: `npx wrangler secret put LIFF_ID`
4. ตั้ง Maps browser key referrer เป็น `https://eatarai.<account-subdomain>.workers.dev/*` และ API restriction เป็น Maps JavaScript API เท่านั้น
5. ตั้ง LINE Messaging API Webhook URL เป็น `https://eatarai.<account-subdomain>.workers.dev/line/webhook` แล้วกด Verify
6. ทดสอบคำสั่ง public และ LIFF map flow ใน group ทดสอบ ก่อนปิด Render

Cloudflare Worker URL เป็น public endpoint ไม่ใช่ credential. ห้ามเผยแพร่ Channel secret, access token, Supabase service-role key หรือ Google server API key.

## Existing Render service

Render ยังใช้ `DATABASE_URL` ผ่าน `pg.Pool`; เก็บไว้เป็น rollback ระหว่าง cutover ได้. เมื่อ Worker ทดสอบครบแล้วจึงเปลี่ยน LINE webhook ไป Worker และ suspend Render ภายหลัง.

## Validation

```bash
npm test
npx wrangler deploy --dry-run
```
