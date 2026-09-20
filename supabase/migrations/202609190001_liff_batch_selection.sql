-- Allow add-flow search results to exist before a restaurant item is created.
ALTER TABLE public.liff_map_candidates
  ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.liff_map_candidates
  ADD COLUMN IF NOT EXISTS requested_name TEXT;
