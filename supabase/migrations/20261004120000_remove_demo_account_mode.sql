/*
  Remove the demo/live account mode.

  Existing balances and history are intentionally preserved. All existing and
  future users are standard accounts, and new users no longer receive a
  simulated starting balance.
*/

DROP TRIGGER IF EXISTS reset_demo_account_on_deposit_trigger ON public.transactions;
DROP FUNCTION IF EXISTS public.handle_demo_user_deposit();
DROP FUNCTION IF EXISTS public.reset_demo_user_account(uuid, numeric);

UPDATE public.users
SET is_demo = false
WHERE is_demo IS DISTINCT FROM false;

ALTER TABLE public.users
  ALTER COLUMN is_demo SET DEFAULT false,
  ALTER COLUMN is_demo SET NOT NULL;

DROP INDEX IF EXISTS public.idx_users_is_demo;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_standard_account_only;

ALTER TABLE public.users
  ADD CONSTRAINT users_standard_account_only CHECK (is_demo = false);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_code text;
  referrer_id uuid;
BEGIN
  LOOP
    new_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = new_code);
  END LOOP;

  INSERT INTO public.users (
    id, email, first_name, last_name, country, kyc_status, referral_code, is_admin
  )
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'last_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'country'), ''),
    'not_verified',
    new_code,
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    first_name = COALESCE(EXCLUDED.first_name, public.users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.users.last_name),
    country = COALESCE(EXCLUDED.country, public.users.country),
    is_demo = false;

  INSERT INTO public.balances (user_id, usdt_balance, btc_balance)
  VALUES (NEW.id, 0.00000000, 0.00000000)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.robot_states (
    user_id, is_active, strategy, min_profit_threshold, max_trade_amount,
    allocated_balance, todays_profit, total_trades, successful_trades,
    active_challenge_id, challenge_account_balance, challenge_profit_target,
    challenge_max_drawdown, challenge_time_limit
  )
  VALUES (NEW.id, false, 'triangular', 0.5, 1000, 0, 0, 0, 0, NULL, 0, 0, 0, 30)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_assets (user_id, asset_symbol, balance)
  VALUES (NEW.id, 'USDT', 0.00000000), (NEW.id, 'BTC', 0.00000000)
  ON CONFLICT (user_id, asset_symbol) DO NOTHING;

  INSERT INTO public.portfolio_snapshots (
    user_id, snapshot_date, total_value, usdt_balance, btc_balance, btc_price
  )
  VALUES (
    NEW.id, CURRENT_DATE, 0.00000000, 0.00000000, 0.00000000,
    COALESCE((
      SELECT price FROM public.market_data
      WHERE symbol = 'BTCUSDT'
      ORDER BY timestamp DESC LIMIT 1
    ), 0)
  )
  ON CONFLICT (user_id, snapshot_date) DO NOTHING;

  IF NULLIF(trim(NEW.raw_user_meta_data->>'referral_code'), '') IS NOT NULL THEN
    SELECT id INTO referrer_id
    FROM public.users
    WHERE referral_code = upper(trim(NEW.raw_user_meta_data->>'referral_code'))
      AND id <> NEW.id;

    IF referrer_id IS NOT NULL THEN
      UPDATE public.users SET referred_by = referrer_id WHERE id = NEW.id;
      UPDATE public.users
      SET referral_count = COALESCE(referral_count, 0) + 1
      WHERE id = referrer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_new_user(
  referral_code_param text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_referrer_id uuid;
  v_new_code text;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id) THEN
    RETURN json_build_object('success', true, 'message', 'User already initialized');
  END IF;

  v_new_code := public.generate_referral_code();

  INSERT INTO public.users (id, email, kyc_status, referral_code, is_admin)
  VALUES (v_user_id, v_user_email, 'not_verified', v_new_code, false);

  INSERT INTO public.balances (user_id, usdt_balance, btc_balance)
  VALUES (v_user_id, 0.00000000, 0.00000000)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.robot_states (
    user_id, is_active, strategy, min_profit_threshold, max_trade_amount,
    allocated_balance, todays_profit, total_trades, successful_trades
  )
  VALUES (v_user_id, false, 'triangular', 0.5, 1000, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_assets (user_id, asset_symbol, balance)
  VALUES (v_user_id, 'USDT', 0.00000000), (v_user_id, 'BTC', 0.00000000)
  ON CONFLICT (user_id, asset_symbol) DO NOTHING;

  IF NULLIF(trim(referral_code_param), '') IS NOT NULL THEN
    SELECT id INTO v_referrer_id
    FROM public.users
    WHERE referral_code = upper(trim(referral_code_param))
      AND id <> v_user_id;

    IF v_referrer_id IS NOT NULL THEN
      UPDATE public.users SET referred_by = v_referrer_id WHERE id = v_user_id;
      UPDATE public.users
      SET referral_count = COALESCE(referral_count, 0) + 1
      WHERE id = v_referrer_id;
    END IF;
  END IF;

  INSERT INTO public.portfolio_snapshots (
    user_id, snapshot_date, total_value, usdt_balance, btc_balance, btc_price
  )
  VALUES (
    v_user_id, CURRENT_DATE, 0.00000000, 0.00000000, 0.00000000,
    COALESCE((
      SELECT price FROM public.market_data
      WHERE symbol = 'BTCUSDT'
      ORDER BY timestamp DESC LIMIT 1
    ), 0)
  )
  ON CONFLICT (user_id, snapshot_date) DO NOTHING;

  RETURN json_build_object('success', true, 'message', 'User initialized successfully');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.initialize_new_user(text) TO authenticated;
