/* Atomic bank/crypto withdrawal submission and CRM review workflow. */

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_transactions_pending_withdrawals
  ON public.transactions(user_id, created_at DESC)
  WHERE type = 'withdrawal' AND status = 'pending';

-- Customers can keep using other transaction-producing modules, but withdrawal
-- records can only be created and changed by the validated workflow below.
DROP POLICY IF EXISTS "Users can manage own transactions" ON public.transactions;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions"
  ON public.transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own non-deposit transactions" ON public.transactions;
CREATE POLICY "Users can create own non-deposit transactions"
  ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND type NOT IN ('deposit', 'withdrawal'));

DROP POLICY IF EXISTS "Users can update own non-deposit transactions" ON public.transactions;
CREATE POLICY "Users can update own non-deposit transactions"
  ON public.transactions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND type NOT IN ('deposit', 'withdrawal'))
  WITH CHECK (auth.uid() = user_id AND type NOT IN ('deposit', 'withdrawal'));

DROP POLICY IF EXISTS "Users can delete own non-deposit transactions" ON public.transactions;
CREATE POLICY "Users can delete own non-deposit transactions"
  ON public.transactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND type NOT IN ('deposit', 'withdrawal'));

CREATE OR REPLACE FUNCTION public.protect_withdrawal_records()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_type text := CASE WHEN TG_OP = 'DELETE' THEN OLD.type ELSE NEW.type END;
BEGIN
  IF (v_type = 'withdrawal' OR (TG_OP = 'UPDATE' AND OLD.type = 'withdrawal'))
     AND current_setting('app.withdrawal_workflow_id', true) IS DISTINCT FROM v_id::text THEN
    RAISE EXCEPTION 'Withdrawal records must use the secure withdrawal workflow';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_withdrawal_records_trigger ON public.transactions;
CREATE TRIGGER protect_withdrawal_records_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.protect_withdrawal_records();

CREATE OR REPLACE FUNCTION public.create_pending_withdrawal(
  p_method text,
  p_currency text,
  p_amount numeric,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_method text := lower(btrim(COALESCE(p_method, '')));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_amount numeric(20,8) := round(COALESCE(p_amount, 0), 8);
  v_input jsonb := COALESCE(p_details, '{}'::jsonb);
  v_details jsonb;
  v_reference text;
  v_transaction_id uuid := gen_random_uuid();
  v_transaction public.transactions%ROWTYPE;
  v_balance public.balances%ROWTYPE;
  v_available numeric(20,8);
  v_fee numeric(20,8);
  v_net numeric(20,8);
  v_address text;
  v_network text;
  v_bank_name text;
  v_account_number text;
  v_routing_number text;
  v_beneficiary_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_method NOT IN ('bank', 'crypto') THEN RAISE EXCEPTION 'Withdrawal method must be bank or crypto'; END IF;
  IF v_currency NOT IN ('USDT', 'BTC') THEN RAISE EXCEPTION 'Withdrawal currency must be USDT or BTC'; END IF;
  IF v_method = 'bank' AND v_currency <> 'USDT' THEN RAISE EXCEPTION 'Bank withdrawals support USDT only'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Withdrawal amount must be greater than zero'; END IF;

  IF v_method = 'bank' AND v_amount < 100 THEN
    RAISE EXCEPTION 'Minimum bank withdrawal is 100 USDT';
  ELSIF v_method = 'crypto' AND v_currency = 'USDT' AND v_amount < 10 THEN
    RAISE EXCEPTION 'Minimum crypto withdrawal is 10 USDT';
  ELSIF v_method = 'crypto' AND v_currency = 'BTC' AND v_amount < 0.001 THEN
    RAISE EXCEPTION 'Minimum crypto withdrawal is 0.001 BTC';
  END IF;
  IF (v_currency = 'USDT' AND v_amount > 1000000) OR (v_currency = 'BTC' AND v_amount > 100) THEN
    RAISE EXCEPTION 'Withdrawal amount exceeds the allowed maximum';
  END IF;

  IF v_method = 'crypto' THEN
    v_address := left(btrim(COALESCE(v_input->>'recipient_address', '')), 180);
    v_network := upper(left(btrim(COALESCE(v_input->>'network', '')), 24));
    IF length(v_address) < 10 OR v_address ~ '[[:space:]]' THEN
      RAISE EXCEPTION 'Enter a valid recipient wallet address';
    END IF;
    IF (v_currency = 'USDT' AND v_network NOT IN ('ERC20', 'TRC20', 'BEP20'))
       OR (v_currency = 'BTC' AND v_network NOT IN ('BTC', 'LIGHTNING')) THEN
      RAISE EXCEPTION 'The selected network is not valid for this currency';
    END IF;
    v_fee := CASE WHEN v_currency = 'USDT' THEN round(v_amount * 0.001, 8) ELSE 0.00050000 END;
    IF v_amount <= v_fee THEN RAISE EXCEPTION 'Withdrawal amount must be greater than the network fee'; END IF;
    v_details := jsonb_build_object('recipient_address', v_address, 'network', v_network);
  ELSE
    v_bank_name := left(btrim(COALESCE(v_input->>'bank_name', '')), 120);
    v_account_number := left(btrim(COALESCE(v_input->>'account_number', '')), 80);
    v_routing_number := left(btrim(COALESCE(v_input->>'routing_number', '')), 80);
    v_beneficiary_name := left(btrim(COALESCE(v_input->>'beneficiary_name', '')), 120);
    IF length(v_bank_name) < 2 OR length(v_account_number) < 4
       OR length(v_routing_number) < 3 OR length(v_beneficiary_name) < 2 THEN
      RAISE EXCEPTION 'Complete all bank withdrawal details';
    END IF;
    v_fee := round(v_amount * 0.005, 8);
    v_details := jsonb_build_object(
      'bank_name', v_bank_name,
      'account_number', v_account_number,
      'routing_number', v_routing_number,
      'beneficiary_name', v_beneficiary_name
    );
  END IF;

  v_net := round(v_amount - v_fee, 8);
  v_reference := 'WD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_transaction_id::text, '-', ''), 1, 8));

  SELECT * INTO v_balance
  FROM public.balances
  WHERE user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet balance is not initialized'; END IF;

  v_available := CASE WHEN v_currency = 'BTC'
    THEN COALESCE(v_balance.btc_balance, 0)
    ELSE COALESCE(v_balance.usdt_balance, 0)
  END;
  IF v_available < v_amount THEN
    RAISE EXCEPTION 'Insufficient % balance. Available: %', v_currency, trim(to_char(v_available, 'FM999999999999990.00000000'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = v_user_id
      AND t.type = 'withdrawal'
      AND t.status = 'pending'
      AND abs(t.amount) = v_amount
      AND upper(COALESCE(t.withdrawal_details->>'currency', 'USDT')) = v_currency
      AND lower(COALESCE(t.withdrawal_details->>'withdrawal_type', '')) = v_method
      AND t.created_at > now() - interval '10 seconds'
  ) THEN
    RAISE EXCEPTION 'This withdrawal was already submitted';
  END IF;

  IF v_currency = 'BTC' THEN
    UPDATE public.balances
    SET btc_balance = btc_balance - v_amount, updated_at = now()
    WHERE user_id = v_user_id;
  ELSE
    UPDATE public.balances
    SET usdt_balance = usdt_balance - v_amount, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  v_details := v_details || jsonb_build_object(
    'withdrawal_type', v_method,
    'currency', v_currency,
    'amount', v_amount,
    'fee', v_fee,
    'net_amount', v_net,
    'reference', v_reference,
    'funds_reserved', true,
    'funds_settled', false,
    'funds_refunded', false,
    'created_at', now()
  );

  PERFORM set_config('app.withdrawal_workflow_id', v_transaction_id::text, true);
  INSERT INTO public.transactions(
    id, user_id, type, amount, description, status, withdrawal_details, reserved_at
  ) VALUES (
    v_transaction_id,
    v_user_id,
    'withdrawal',
    v_amount,
    CASE WHEN v_method = 'crypto'
      THEN v_currency || ' crypto withdrawal to ' || left(v_address, 8) || '...' || right(v_address, 6)
      ELSE 'Bank withdrawal to ' || v_bank_name || ' (Account ****' || right(v_account_number, 4) || ')'
    END,
    'pending',
    v_details,
    now()
  ) RETURNING * INTO v_transaction;

  INSERT INTO public.notifications(user_id, type, message, is_read, data)
  VALUES (
    v_user_id,
    'withdrawal_pending',
    'Your withdrawal of ' || trim(to_char(v_amount, 'FM999999999999990.00000000')) || ' ' || v_currency || ' is pending review.',
    false,
    jsonb_build_object('transaction_id', v_transaction.id, 'reference', v_reference, 'amount', v_amount, 'currency', v_currency, 'status', 'pending')
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'pending',
    'transaction_id', v_transaction.id,
    'reference', v_reference,
    'amount', v_amount,
    'fee', v_fee,
    'net_amount', v_net,
    'currency', v_currency,
    'balance_after', v_available - v_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(
  p_target_user_id uuid,
  p_transaction_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transaction public.transactions%ROWTYPE;
  v_decision text := lower(btrim(COALESCE(p_decision, '')));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_details jsonb;
  v_currency text;
  v_amount numeric(20,8);
  v_reserved boolean;
  v_balance public.balances%ROWTYPE;
  v_balance_after numeric(20,8);
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public.crm_require_target_access(p_target_user_id);
  IF v_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'An audit reason is required'; END IF;

  SELECT * INTO v_transaction
  FROM public.transactions
  WHERE id = p_transaction_id
    AND user_id = p_target_user_id
    AND type = 'withdrawal'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found for this customer'; END IF;

  IF v_transaction.status = 'completed' THEN
    IF v_decision = 'approve' THEN
      RETURN jsonb_build_object('success', true, 'status', 'approved', 'idempotent', true, 'transaction_id', v_transaction.id);
    END IF;
    RAISE EXCEPTION 'This withdrawal has already been approved';
  ELSIF v_transaction.status = 'failed' THEN
    IF v_decision = 'reject' THEN
      RETURN jsonb_build_object('success', true, 'status', 'rejected', 'idempotent', true, 'transaction_id', v_transaction.id);
    END IF;
    RAISE EXCEPTION 'This withdrawal has already been rejected';
  ELSIF v_transaction.status <> 'pending' THEN
    RAISE EXCEPTION 'This withdrawal is not reviewable from status: %', v_transaction.status;
  END IF;

  v_before := to_jsonb(v_transaction);
  v_details := COALESCE(v_transaction.withdrawal_details, '{}'::jsonb);
  v_currency := upper(COALESCE(NULLIF(v_details->>'currency', ''), 'USDT'));
  v_amount := round(abs(v_transaction.amount), 8);
  v_reserved := lower(COALESCE(v_details->>'funds_reserved', 'false')) = 'true';
  IF v_currency NOT IN ('USDT', 'BTC') OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal currency or amount is invalid';
  END IF;

  SELECT * INTO v_balance
  FROM public.balances
  WHERE user_id = p_target_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet balance is not initialized'; END IF;

  -- Legacy pending withdrawals were not reserved when submitted. Reserve them
  -- at approval so old requests can still be reviewed safely.
  IF v_decision = 'approve' AND NOT v_reserved THEN
    IF (v_currency = 'BTC' AND COALESCE(v_balance.btc_balance, 0) < v_amount)
       OR (v_currency = 'USDT' AND COALESCE(v_balance.usdt_balance, 0) < v_amount) THEN
      RAISE EXCEPTION 'Insufficient % balance to approve this legacy withdrawal', v_currency;
    END IF;
    IF v_currency = 'BTC' THEN
      UPDATE public.balances SET btc_balance = btc_balance - v_amount, updated_at = now() WHERE user_id = p_target_user_id;
    ELSE
      UPDATE public.balances SET usdt_balance = usdt_balance - v_amount, updated_at = now() WHERE user_id = p_target_user_id;
    END IF;
  ELSIF v_decision = 'reject' AND v_reserved THEN
    IF v_currency = 'BTC' THEN
      UPDATE public.balances SET btc_balance = btc_balance + v_amount, updated_at = now() WHERE user_id = p_target_user_id;
    ELSE
      UPDATE public.balances SET usdt_balance = usdt_balance + v_amount, updated_at = now() WHERE user_id = p_target_user_id;
    END IF;
  END IF;

  IF v_decision = 'approve' THEN
    v_details := v_details || jsonb_build_object(
      'funds_reserved', false,
      'funds_settled', true,
      'funds_refunded', false,
      'review_status', 'approved'
    );
  ELSE
    v_details := v_details || jsonb_build_object(
      'funds_reserved', false,
      'funds_settled', false,
      'funds_refunded', v_reserved,
      'review_status', 'rejected'
    );
  END IF;

  PERFORM set_config('app.withdrawal_workflow_id', v_transaction.id::text, true);
  UPDATE public.transactions
  SET amount = v_amount,
      status = CASE WHEN v_decision = 'approve' THEN 'completed' ELSE 'failed' END,
      withdrawal_details = v_details,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = v_reason,
      settled_at = CASE WHEN v_decision = 'approve' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = v_transaction.id
  RETURNING to_jsonb(transactions.*) INTO v_after;

  SELECT CASE WHEN v_currency = 'BTC' THEN btc_balance ELSE usdt_balance END
  INTO v_balance_after
  FROM public.balances
  WHERE user_id = p_target_user_id;

  INSERT INTO public.notifications(user_id, type, message, is_read, data)
  VALUES (
    p_target_user_id,
    CASE WHEN v_decision = 'approve' THEN 'withdrawal_approved' ELSE 'withdrawal_rejected' END,
    'Your withdrawal of ' || trim(to_char(v_amount, 'FM999999999999990.00000000')) || ' ' || v_currency
      || CASE WHEN v_decision = 'approve' THEN ' was approved.' ELSE ' was rejected and any reserved funds were returned.' END,
    false,
    jsonb_build_object('transaction_id', v_transaction.id, 'amount', v_amount, 'currency', v_currency, 'status', CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END)
  );

  INSERT INTO public.admin_action_logs(admin_user_id, target_user_id, action, before_data, after_data, reason)
  VALUES (
    auth.uid(),
    p_target_user_id,
    'withdrawal_' || CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    v_before,
    v_after || jsonb_build_object('balance_after', v_balance_after),
    v_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    'transaction_id', v_transaction.id,
    'amount', v_amount,
    'currency', v_currency,
    'balance', v_balance_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.protect_withdrawal_records() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_pending_withdrawal(text,text,numeric,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_withdrawal(text,text,numeric,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_review_withdrawal(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_withdrawal(uuid,uuid,text,text) TO authenticated;
