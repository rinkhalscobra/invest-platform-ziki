/*
  One shared Twelve Data cache for the whole application.

  - pg_cron invokes the Supabase worker once every two minutes.
  - the latest quote for every active instrument remains in market_data.
  - historical chart responses are cached by symbol/interval for two minutes.
  - an atomic lease prevents concurrent workers or clients from spending API
    credits for the same refresh window.
*/

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.market_data_sync_state (
  sync_key text PRIMARY KEY,
  last_started_at timestamptz NOT NULL DEFAULT now(),
  last_completed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_data_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_data_sync_state FROM anon, authenticated;
GRANT ALL ON public.market_data_sync_state TO service_role;

CREATE TABLE IF NOT EXISTS public.market_time_series_cache (
  symbol text NOT NULL,
  interval text NOT NULL,
  bars jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_provider text NOT NULL DEFAULT 'twelve_data',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, interval),
  CONSTRAINT market_time_series_cache_provider_check
    CHECK (data_provider = 'twelve_data'),
  CONSTRAINT market_time_series_cache_bars_check
    CHECK (jsonb_typeof(bars) = 'array')
);

ALTER TABLE public.market_time_series_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_time_series_cache FROM anon, authenticated;
GRANT ALL ON public.market_time_series_cache TO service_role;

CREATE OR REPLACE FUNCTION public.claim_market_data_refresh(
  requested_sync_key text,
  minimum_interval_seconds integer DEFAULT 110
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_key text;
BEGIN
  IF requested_sync_key IS NULL OR length(requested_sync_key) = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.market_data_sync_state AS state (
    sync_key,
    last_started_at,
    last_error,
    updated_at
  )
  VALUES (requested_sync_key, now(), NULL, now())
  ON CONFLICT (sync_key) DO UPDATE
    SET last_started_at = EXCLUDED.last_started_at,
        last_error = NULL,
        updated_at = EXCLUDED.updated_at
    WHERE state.last_started_at <= now() - make_interval(
      secs => greatest(5, least(COALESCE(minimum_interval_seconds, 110), 3600))
    )
  RETURNING sync_key INTO claimed_key;

  RETURN claimed_key IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_market_data_refresh(
  requested_sync_key text,
  error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.market_data_sync_state
  SET last_completed_at = CASE WHEN error_message IS NULL THEN now() ELSE last_completed_at END,
      last_error = left(error_message, 1000),
      updated_at = now()
  WHERE sync_key = requested_sync_key;
$$;

REVOKE ALL ON FUNCTION public.claim_market_data_refresh(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_market_data_refresh(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_market_data_refresh(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_market_data_refresh(text, text) TO service_role;

-- Replace an older copy of this named job if the migration is reapplied.
DO $do$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'refresh-twelve-data-market-cache-every-two-minutes'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'refresh-twelve-data-market-cache-every-two-minutes',
    '*/2 * * * *',
    $command$
      SELECT net.http_post(
        url := 'https://cbhjhjsyvabyimyhinrq.supabase.co/functions/v1/scheduled-market-sync',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('source', 'pg_cron', 'requested_at', now()),
        timeout_milliseconds := 60000
      ) AS request_id;
    $command$
  );
END;
$do$;

COMMENT ON TABLE public.market_data_sync_state IS
  'Atomic refresh leases and diagnostics for the shared Twelve Data cache.';
COMMENT ON TABLE public.market_time_series_cache IS
  'Two-minute shared cache of Twelve Data chart bars by symbol and interval.';
