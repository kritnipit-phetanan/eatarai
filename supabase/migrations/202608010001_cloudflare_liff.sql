-- Supabase schema for the Cloudflare Worker and LIFF private flow.
-- It is safe to run on the existing Render-backed project.

CREATE TABLE IF NOT EXISTS restaurant_items (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source TEXT NOT NULL,
  google_place_id TEXT,
  matched_name TEXT,
  matched_address TEXT,
  matched_types_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_items_chat_name_idx
  ON restaurant_items(chat_id, normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_items_chat_place_idx
  ON restaurant_items(chat_id, google_place_id)
  WHERE google_place_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS google_call_log (
  chat_id TEXT NOT NULL,
  day DATE NOT NULL,
  call_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, day)
);

CREATE TABLE IF NOT EXISTS liff_flow_sessions (
  id UUID PRIMARY KEY,
  chat_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('add', 'remove', 'show', 'map_link')),
  item_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS liff_flow_sessions_owner_idx
  ON liff_flow_sessions(chat_id, owner_user_id, expires_at);

CREATE TABLE IF NOT EXISTS liff_map_candidates (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES liff_flow_sessions(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES restaurant_items(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  display_name TEXT,
  formatted_address TEXT,
  primary_type TEXT,
  types_json TEXT NOT NULL DEFAULT '[]',
  expires_at TIMESTAMPTZ NOT NULL,
  selected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION bot_reserve_google_call(
  p_chat_id TEXT,
  p_global_limit INTEGER,
  p_group_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Bangkok')::DATE;
  v_global_calls INTEGER;
  v_group_calls INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(20260720);

  SELECT COALESCE(SUM(call_count), 0)::INTEGER
    INTO v_global_calls
    FROM google_call_log
   WHERE day = v_today;

  SELECT COALESCE(call_count, 0)
    INTO v_group_calls
    FROM google_call_log
   WHERE chat_id = p_chat_id AND day = v_today;

  IF v_global_calls >= p_global_limit OR v_group_calls >= p_group_limit THEN
    RETURN FALSE;
  END IF;

  INSERT INTO google_call_log (chat_id, day, call_count, created_at, updated_at)
  VALUES (p_chat_id, v_today, 1, now(), now())
  ON CONFLICT (chat_id, day) DO UPDATE SET
    call_count = google_call_log.call_count + 1,
    updated_at = now();

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION bot_take_liff_flow_session(
  p_session_id UUID,
  p_owner_user_id TEXT
)
RETURNS TABLE (
  id UUID,
  chat_id TEXT,
  owner_user_id TEXT,
  action TEXT,
  item_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE liff_flow_sessions
     SET used_at = now()
   WHERE liff_flow_sessions.id = p_session_id
     AND liff_flow_sessions.owner_user_id = p_owner_user_id
     AND liff_flow_sessions.expires_at > now()
     AND liff_flow_sessions.used_at IS NULL
  RETURNING
    liff_flow_sessions.id,
    liff_flow_sessions.chat_id,
    liff_flow_sessions.owner_user_id,
    liff_flow_sessions.action,
    liff_flow_sessions.item_name;
END;
$$;

-- SECURITY DEFINER RPCs must never be callable from the public Data API roles.
REVOKE EXECUTE ON FUNCTION bot_reserve_google_call(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION bot_take_liff_flow_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bot_reserve_google_call(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION bot_take_liff_flow_session(UUID, TEXT) TO service_role;

ALTER TABLE restaurant_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE liff_flow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE liff_map_candidates ENABLE ROW LEVEL SECURITY;
