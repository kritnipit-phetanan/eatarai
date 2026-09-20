-- Harden LIFF map search against quota abuse and retain expired private-flow data for 30 days only.

CREATE TABLE IF NOT EXISTS public.liff_map_search_rate_limits (
  chat_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  last_search_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chat_id, owner_user_id)
);

CREATE OR REPLACE FUNCTION public.bot_reserve_liff_map_search(
  p_session_id UUID,
  p_owner_user_id TEXT,
  p_chat_id TEXT,
  p_global_limit INTEGER,
  p_group_limit INTEGER,
  p_cooldown_seconds INTEGER DEFAULT 15
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Bangkok')::DATE;
  v_global_calls INTEGER;
  v_group_calls INTEGER;
  v_last_search_at TIMESTAMPTZ;
BEGIN
  -- This is shared with bot_reserve_google_call, so global and per-group quotas stay atomic.
  PERFORM pg_advisory_xact_lock(20260720);

  PERFORM 1
    FROM liff_flow_sessions
   WHERE id = p_session_id
     AND owner_user_id = p_owner_user_id
     AND chat_id = p_chat_id
     AND used_at IS NULL
     AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'invalid_session';
  END IF;

  SELECT last_search_at
    INTO v_last_search_at
    FROM liff_map_search_rate_limits
   WHERE chat_id = p_chat_id
     AND owner_user_id = p_owner_user_id;
  IF FOUND AND v_last_search_at > now() - make_interval(secs => GREATEST(p_cooldown_seconds, 1)) THEN
    RETURN 'rate_limited';
  END IF;

  SELECT COALESCE(SUM(call_count), 0)::INTEGER
    INTO v_global_calls
    FROM google_call_log
   WHERE day = v_today;
  SELECT COALESCE(call_count, 0)
    INTO v_group_calls
    FROM google_call_log
   WHERE chat_id = p_chat_id AND day = v_today;
  IF v_global_calls >= p_global_limit OR v_group_calls >= p_group_limit THEN
    RETURN 'google_quota_reached';
  END IF;

  INSERT INTO liff_map_search_rate_limits (chat_id, owner_user_id, last_search_at)
  VALUES (p_chat_id, p_owner_user_id, now())
  ON CONFLICT (chat_id, owner_user_id) DO UPDATE SET last_search_at = EXCLUDED.last_search_at;

  INSERT INTO google_call_log (chat_id, day, call_count, created_at, updated_at)
  VALUES (p_chat_id, v_today, 1, now(), now())
  ON CONFLICT (chat_id, day) DO UPDATE SET
    call_count = google_call_log.call_count + 1,
    updated_at = now();

  RETURN 'reserved';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bot_reserve_liff_map_search(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_reserve_liff_map_search(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.liff_map_search_rate_limits TO service_role;
