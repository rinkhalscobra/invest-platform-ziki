/* Refresh the shared Twelve Data market cache every 30 seconds. */

CREATE OR REPLACE FUNCTION public.claim_market_data_refresh(
  requested_sync_key text,
  minimum_interval_seconds integer DEFAULT 25
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
      secs => greatest(5, least(COALESCE(minimum_interval_seconds, 25), 3600))
    )
  RETURNING sync_key INTO claimed_key;

  RETURN claimed_key IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_market_data_refresh(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_market_data_refresh(text, integer) TO service_role;

DO $do$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'refresh-twelve-data-market-cache-every-two-minutes',
      'refresh-twelve-data-market-cache-every-30-seconds'
    )
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'refresh-twelve-data-market-cache-every-30-seconds',
    '30 seconds',
    $command$
      SELECT net.http_post(
        url := 'https://cbhjhjsyvabyimyhinrq.supabase.co/functions/v1/scheduled-market-sync',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('source', 'pg_cron', 'requested_at', now()),
        timeout_milliseconds := 30000
      ) AS request_id;
    $command$
  );
END;
$do$;

COMMENT ON FUNCTION public.claim_market_data_refresh(text, integer) IS
  'Atomically limits shared Twelve Data refreshes; default lease is 25 seconds for the 30-second schedule.';
