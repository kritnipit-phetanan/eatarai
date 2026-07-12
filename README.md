# เมื่อไรจะไปกิน

LINE group bot that keeps a restaurant wish list, validates restaurant names with Google Places Text Search (New), and caches validation results in Postgres to control cost.

## Data model

The bot stores data per LINE chat. LINE group events become `chat_id = group:<groupId>`, rooms become `room:<roomId>`, and direct chats become `user:<userId>`.

Postgres tables are created automatically on startup:

- `restaurant_items`: restaurant/food wish list items per chat
- `place_validation_cache`: Google Places validation cache
- `google_call_log`: daily Google Places call counters

## Required credentials

### LINE Messaging API

Get these from LINE Developers Console:

- `LINE_CHANNEL_SECRET`: Messaging API channel > Basic settings > Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`: Messaging API channel > Messaging API > Channel access token

Also enable:

- Use webhook
- Allow bot to join group chats
- Webhook URL: `https://YOUR_RENDER_DOMAIN/line/webhook`

### Google Places API

Get `GOOGLE_MAPS_API_KEY` from Google Cloud Console:

1. Create/select a Google Cloud project.
2. Enable **Places API**.
3. Create an API key under **APIs & Services > Credentials**.
4. Restrict the key to Places API.
5. Set quota and budget alerts.

`GOOGLE_LOCATION_BIAS` is optional. Leave it blank for Thailand-wide search. If needed, set it to the JSON body accepted by Google Places Text Search, for example:

```json
{"circle":{"center":{"latitude":13.7563,"longitude":100.5018},"radius":50000}}
```

## Supabase / Postgres

Create a Supabase project, then copy the Postgres connection string into:

```env
DATABASE_URL=postgresql://postgres.PROJECT_ID:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
POSTGRES_SSL=true
```

Use Supabase's pooled connection string for Render. The app auto-creates tables on startup.

## Local setup

```bash
npm install
cp .env.example .env
npm run build
npm test
npm start
```

## Render deploy

Create a Render Web Service:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: Node

Set env vars in Render:

```env
DATABASE_URL=
POSTGRES_SSL=true
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
BOT_DISPLAY_NAME=เมื่อไรจะไปกิน
GOOGLE_MAPS_API_KEY=
GOOGLE_REGION_CODE=TH
GOOGLE_LANGUAGE_CODE=th
GOOGLE_LOCATION_BIAS=
GOOGLE_DAILY_VALIDATION_LIMIT=500
GOOGLE_GROUP_DAILY_VALIDATION_LIMIT=30
```

After deploy, test:

```text
https://YOUR_RENDER_DOMAIN/health
```

Then set LINE webhook URL:

```text
https://YOUR_RENDER_DOMAIN/line/webhook
```

## Commands

- `เพิ่ม Sukishi`
- `อยากกิน Hotpot Man`
- `@เมื่อไรจะไปกิน Sukishi`
- `รายการ`
- `กิน Sukishi แล้ว`
- `ลบ Sukishi`
- `ยืนยัน Some Custom Place`

Standalone text without a bot mention is ignored to avoid unnecessary Google Places calls.
