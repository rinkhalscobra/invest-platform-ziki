/* Global, durable profit/loss notifications for every customer-facing module. */

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_profit_loss_source
  ON public.notifications (user_id, ((data->>'source_key')))
  WHERE type IN ('profit', 'loss') AND data ? 'source_key';

CREATE OR REPLACE FUNCTION public.create_profit_loss_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_user_id uuid;
  v_amount numeric;
  v_module text;
  v_symbol text;
  v_source_key text;
  v_type text;
  v_message text;
  v_transaction_type text;
BEGIN
  v_source_key := TG_TABLE_NAME || ':' || COALESCE(v_row->>'id', gen_random_uuid()::text);

  CASE TG_TABLE_NAME
    WHEN 'futures_position_history' THEN
      v_user_id := NULLIF(v_row->>'user_id', '')::uuid;
      v_amount := COALESCE(NULLIF(v_row->>'pnl', '')::numeric, 0);
      v_symbol := NULLIF(v_row->>'symbol', '');
      v_module := CASE WHEN upper(COALESCE(v_symbol, '')) LIKE '%USDT' THEN 'Futures' ELSE 'CFD' END;

    WHEN 'prop_position_history' THEN
      v_user_id := NULLIF(v_row->>'user_id', '')::uuid;
      v_amount := COALESCE(NULLIF(v_row->>'pnl', '')::numeric, 0);
      v_symbol := NULLIF(v_row->>'symbol', '');
      v_module := 'Prop Trading';

    WHEN 'binary_trades' THEN
      v_user_id := NULLIF(v_row->>'user_id', '')::uuid;
      v_amount := COALESCE(NULLIF(v_row->>'pnl', '')::numeric, 0);
      v_symbol := COALESCE(NULLIF(v_row->>'pair', ''), NULLIF(v_row->>'symbol', ''));
      v_module := 'Event Trading';

    WHEN 'referral_earnings' THEN
      v_user_id := NULLIF(v_row->>'referrer_id', '')::uuid;
      v_amount := COALESCE(
        NULLIF(v_row->>'commission_amount', '')::numeric,
        NULLIF(v_row->>'amount', '')::numeric,
        0
      );
      v_symbol := NULLIF(v_row->>'position_symbol', '');
      v_module := 'Referrals';

    WHEN 'transactions' THEN
      IF COALESCE(v_row->>'status', 'completed') <> 'completed' THEN RETURN NEW; END IF;
      v_transaction_type := COALESCE(v_row->>'type', '');
      IF v_transaction_type NOT IN (
        'robot_profit', 'staking_profit', 'challenge_reward', 'giveaway_prize',
        'wheel_bonus', 'swap_refund', 'swap_fee'
      ) THEN
        RETURN NEW;
      END IF;

      v_user_id := NULLIF(v_row->>'user_id', '')::uuid;
      v_amount := COALESCE(NULLIF(v_row->>'amount', '')::numeric, 0);
      v_module := CASE v_transaction_type
        WHEN 'robot_profit' THEN 'AI Robot'
        WHEN 'staking_profit' THEN 'Staking'
        WHEN 'challenge_reward' THEN 'Prop Challenge'
        WHEN 'giveaway_prize' THEN 'Giveaway'
        WHEN 'wheel_bonus' THEN 'Spin Wheel'
        WHEN 'swap_refund' THEN 'Swap'
        WHEN 'swap_fee' THEN 'Swap'
        ELSE 'Account'
      END;

      -- A fee is always an account loss, even in legacy rows where it was
      -- stored as a positive absolute amount.
      IF v_transaction_type = 'swap_fee' THEN v_amount := -abs(v_amount); END IF;

    ELSE
      RETURN NEW;
  END CASE;

  IF v_user_id IS NULL OR v_amount = 0 THEN RETURN NEW; END IF;

  v_type := CASE WHEN v_amount > 0 THEN 'profit' ELSE 'loss' END;
  v_message := format(
    '%s %s%s: %s%s USDT',
    v_module,
    CASE WHEN v_symbol IS NOT NULL THEN v_symbol || ' ' ELSE '' END,
    CASE WHEN v_amount > 0 THEN 'profit' ELSE 'loss' END,
    CASE WHEN v_amount > 0 THEN '+' ELSE '-' END,
    trim(to_char(abs(v_amount), 'FM999999999999990.00'))
  );

  INSERT INTO public.notifications (user_id, type, message, is_read, data)
  VALUES (
    v_user_id,
    v_type,
    v_message,
    false,
    jsonb_build_object(
      'amount', v_amount,
      'currency', 'USDT',
      'module', v_module,
      'symbol', v_symbol,
      'source_table', TG_TABLE_NAME,
      'source_id', v_row->>'id',
      'source_key', v_source_key,
      'transaction_type', v_transaction_type
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_futures_position_result ON public.futures_position_history;
CREATE TRIGGER notify_futures_position_result
AFTER INSERT ON public.futures_position_history
FOR EACH ROW EXECUTE FUNCTION public.create_profit_loss_notification();

DROP TRIGGER IF EXISTS notify_prop_position_result ON public.prop_position_history;
CREATE TRIGGER notify_prop_position_result
AFTER INSERT ON public.prop_position_history
FOR EACH ROW EXECUTE FUNCTION public.create_profit_loss_notification();

DROP TRIGGER IF EXISTS notify_binary_trade_result ON public.binary_trades;
CREATE TRIGGER notify_binary_trade_result
AFTER INSERT ON public.binary_trades
FOR EACH ROW EXECUTE FUNCTION public.create_profit_loss_notification();

DROP TRIGGER IF EXISTS notify_referral_earning_result ON public.referral_earnings;
CREATE TRIGGER notify_referral_earning_result
AFTER INSERT ON public.referral_earnings
FOR EACH ROW EXECUTE FUNCTION public.create_profit_loss_notification();

DROP TRIGGER IF EXISTS notify_transaction_result ON public.transactions;
CREATE TRIGGER notify_transaction_result
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.create_profit_loss_notification();

REVOKE ALL ON FUNCTION public.create_profit_loss_notification() FROM PUBLIC;

-- Supabase Realtime delivers inserts immediately; the client also polls as a
-- fallback when a websocket cannot be established.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;

