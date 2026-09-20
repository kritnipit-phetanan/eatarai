-- The Cloudflare Worker uses Supabase's server-only service_role key.
-- RLS remains enabled; these grants do not expose tables to anon or authenticated users.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.restaurant_items,
  public.google_call_log,
  public.liff_flow_sessions,
  public.liff_map_candidates
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.restaurant_items_id_seq TO service_role;
