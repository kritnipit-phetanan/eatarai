# เมื่อไรจะไปกิน

LINE bot สำหรับเก็บลิสต์ร้านที่อยากไปกิน แยกรายการตาม LINE group, multi-person room และแชตส่วนตัว

## พฤติกรรมปัจจุบัน

- ทุกคำสั่งต้อง mention บอทจริงใน LINE หรือเริ่มต้นด้วย `@เมื่อไรจะไปกิน` เพื่อป้องกันข้อความทั่วไปถูกตีความเป็นคำสั่ง
- mention บอทเปล่า ๆ จะแสดง Flex menu: ดูรายการ, เพิ่มรายการ, ลดรายการ, เพิ่มแผนที่
- เมื่อกด เพิ่มรายการ, ลดรายการ หรือ เพิ่มแผนที่ บอทจะเปิด keyboard (LINE iOS/Android 12.6+) และรอชื่อร้านจากข้อความถัดไปใน chat เดิมเป็นเวลา 10 นาที
- เพิ่มร้านทันทีโดยไม่เรียก Google Places
- เพิ่มแผนที่เป็น flow แยก: ผู้ใช้ส่งตำแหน่ง แล้วบอทจึงค้น Google Places และให้เลือกสถานที่
- เมื่อเลือกสถานที่ บอทบันทึก `place_id`, ชื่อ และที่อยู่ไว้กับรายการ พร้อมส่ง Google Maps URL
- คำสั่ง `รายการ` แสดงปุ่ม `Map` ข้างร้านที่มีลิงก์แผนที่แล้ว
- รายการและ state เพิ่มแผนที่แยกตาม chat ID เสมอ

## คำสั่ง

```text
@เมื่อไรจะไปกิน
@เมื่อไรจะไปกิน รายการ
@เมื่อไรจะไปกิน เพิ่ม Sushiro
@เมื่อไรจะไปกิน อยากกิน Hotpot Man
@เมื่อไรจะไปกิน เพิ่มแผนที่ Sushiro
@เมื่อไรจะไปกิน ลบ Sushiro
@เมื่อไรจะไปกิน กิน Sushiro มาแล้ว
```

การพิมพ์ `รายการ`, `เพิ่ม ...` หรือชื่อร้านโดยไม่ mention บอทจะไม่ทำให้บอทตอบ

## Google Places และการคุมค่าใช้จ่าย

Google Places ไม่ถูกเรียกขณะเพิ่มร้าน การค้นหาจะเกิดขึ้นเมื่อผู้ใช้เพิ่มลิงก์แผนที่และกดส่งตำแหน่งใน LINE เท่านั้น:

```text
เพิ่มร้าน -> เพิ่มแผนที่ -> ส่งตำแหน่ง -> จองโควต้ารายวัน -> Google Places Text Search -> เลือกสถานที่
```

- `GOOGLE_DAILY_VALIDATION_LIMIT`: เพดาน Google validations รวมทุกแชตต่อวัน
- `GOOGLE_GROUP_DAILY_VALIDATION_LIMIT`: เพดานต่อ group, room หรือแชตส่วนตัวต่อวัน
- การจองโควต้าเป็น atomic ใน Postgres เพื่อไม่ให้หลายแชตทำให้เกินเพดานพร้อมกัน
- Google Text Search ขอผลสูงสุด 3 สถานที่ โดยใช้ตำแหน่งที่ผู้ใช้ส่งเป็น location bias
- Google response ที่ใช้คือ place ID, ชื่อร้าน, ที่อยู่ และประเภทสถานที่
- หลังส่ง location บอทแสดงตัวเลือกสาขาเป็น Flex Message
- ไม่เรียก Place Details, รูปภาพ, rating หรือเวลาเปิดปิด

### Google Maps links

หลังผู้ใช้เลือกสถานที่ บอทจะส่ง Google Maps URL ที่ระบุสถานที่นั้น เช่น:

```text
https://www.google.com/maps/search/?api=1&query=<encoded-name>&query_place_id=<place-id>
```

Maps URLs ไม่ต้องใช้ Google API key เพิ่มเติม และ Place ID ทำให้ลิงก์ชี้ไปยังสถานที่ที่ถูกต้องได้มากกว่าการใช้ชื่อร้านอย่างเดียว. LINE จะขอสิทธิ์ location เฉพาะเมื่อผู้ใช้กด `ส่งตำแหน่ง`; บอทไม่สามารถเปิดตำแหน่งเองได้. ดู [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) และ [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search).

## ข้อมูลที่จัดเก็บ

ข้อมูลถูกแยกตาม LINE chat:

- group: `group:<groupId>`
- multi-person room: `room:<roomId>`
- direct chat: `user:<userId>`

แอปสร้างตารางต่อไปนี้อัตโนมัติเมื่อเริ่มทำงาน:

- `restaurant_items`: รายการร้านต่อ chat
- `google_call_log`: ตัวนับโควต้าการเรียก Google รายวัน
- `pending_command_inputs`: action จาก Flex menu ที่กำลังรอชื่อร้าน
- `pending_map_link_selections`: รายการที่กำลังรอ location เพื่อค้นหาสถานที่
- `pending_map_link_candidates`: สถานที่ที่รอผู้ใช้กดเลือก

## Environment variables

สร้าง `.env` จาก `.env.example` สำหรับ local development ห้าม commit `.env`

```env
PORT=3000
DATABASE_URL=
POSTGRES_SSL=true

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
BOT_DISPLAY_NAME=เมื่อไรจะไปกิน

GOOGLE_MAPS_API_KEY=
GOOGLE_REGION_CODE=TH
GOOGLE_LANGUAGE_CODE=th
GOOGLE_DAILY_VALIDATION_LIMIT=100
GOOGLE_GROUP_DAILY_VALIDATION_LIMIT=30
```

## LINE Messaging API

รับค่าต่อไปนี้จาก LINE Developers Console:

- `LINE_CHANNEL_SECRET`: Messaging API channel > Basic settings > Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`: Messaging API channel > Messaging API > Channel access token

เปิดค่าเหล่านี้ด้วย:

- Use webhook
- Allow bot to join group chats
- Auto-reply messages: Disabled

ตั้ง webhook หลัง deploy:

```text
https://YOUR_RENDER_DOMAIN/line/webhook
```

## Google Places API

1. สร้างหรือเลือก Google Cloud project
2. เปิด Places API
3. สร้าง API key ที่ APIs & Services > Credentials
4. จำกัด key ให้ใช้กับ Places API
5. ตั้ง budget alert และ quota ใน Google Cloud

## Supabase

1. สร้าง Supabase project
2. กด Connect บน project dashboard
3. ใช้ Session pooler connection string (port `5432`) สำหรับ Render
4. ตั้งค่า `DATABASE_URL` และ `POSTGRES_SSL=true` ใน Render

ไม่ต้องสร้างตารางเอง แอปจะ migration schema เมื่อเริ่มทำงาน

## Local development

```bash
npm install
cp .env.example .env
npm test
npm run dev
```

ตรวจ health endpoint:

```text
http://localhost:3000/health
```

## Render deployment

สร้าง Render Web Service จาก GitHub repository:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health`

ตั้ง environment variables ชุดเดียวกับ `.env.example` ใน Render แล้วนำ Render URL ไปตั้งเป็น LINE webhook
