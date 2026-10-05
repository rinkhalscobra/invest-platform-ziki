/* Atomic card-deposit submission and CRM review workflow. */

ALTER TABLE public.sandbox_payment_transactions
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS credited_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_card_payment_transaction
  ON public.sandbox_payment_transactions(transaction_id)
  WHERE transaction_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'balances'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.balances;
  END IF;
END;
$$;

-- Card requests are created only through the validated SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Users can create own sandbox transactions" ON public.sandbox_payment_transactions;
DROP POLICY IF EXISTS "Users can create pending card requests" ON public.sandbox_payment_transactions;
DROP POLICY IF EXISTS "Users can update own sandbox transactions" ON public.sandbox_payment_transactions;

CREATE OR REPLACE FUNCTION public.protect_card_deposit_review_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.payment_method = 'card'
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.review_note IS DISTINCT FROM OLD.review_note
       OR NEW.credited_at IS DISTINCT FROM OLD.credited_at
     )
     AND current_setting('app.card_deposit_review_id', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'Card deposit decisions must use the CRM review workflow';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_card_deposit_review_fields_trigger ON public.sandbox_payment_transactions;
CREATE TRIGGER protect_card_deposit_review_fields_trigger
BEFORE UPDATE ON public.sandbox_payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.protect_card_deposit_review_fields();

CREATE OR REPLACE FUNCTION public.protect_linked_card_transaction_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    SELECT id INTO v_request_id
    FROM public.sandbox_payment_transactions
    WHERE transaction_id = OLD.id AND payment_method = 'card'
    LIMIT 1;

    IF v_request_id IS NOT NULL
       AND current_setting('app.card_deposit_review_id', true) IS DISTINCT FROM v_request_id::text THEN
      RAISE EXCEPTION 'Linked card deposit transactions must use the CRM review workflow';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_linked_card_transaction_status_trigger ON public.transactions;
CREATE TRIGGER protect_linked_card_transaction_status_trigger
BEFORE UPDATE OF status, amount ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.protect_linked_card_transaction_status();

CREATE OR REPLACE FUNCTION public.create_pending_card_deposit(
  p_amount numeric,
  p_card_last_four text,
  p_card_brand text,
  p_cardholder_name text,
  p_email text,
  p_phone text,
  p_billing_address text,
  p_billing_city text,
  p_billing_region text,
  p_billing_postcode text,
  p_billing_country text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reference text;
  v_request public.sandbox_payment_transactions%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_last_four text := btrim(COALESCE(p_card_last_four, ''));
  v_brand text := left(btrim(COALESCE(p_card_brand, '')), 32);
  v_cardholder text := left(btrim(COALESCE(p_cardholder_name, '')), 120);
  v_email text := lower(left(btrim(COALESCE(p_email, '')), 254));
  v_phone text := left(btrim(COALESCE(p_phone, '')), 40);
  v_address text := left(btrim(COALESCE(p_billing_address, '')), 180);
  v_city text := left(btrim(COALESCE(p_billing_city, '')), 100);
  v_region text := left(btrim(COALESCE(p_billing_region, '')), 100);
  v_postcode text := left(btrim(COALESCE(p_billing_postcode, '')), 24);
  v_country text := left(btrim(COALESCE(p_billing_country, '')), 100);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'User profile is not initialized';
  END IF;
  IF p_amount IS NULL OR p_amount < 10 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Deposit amount must be between 10 and 1,000,000 USDT';
  END IF;
  IF v_last_four !~ '^\d{4}$' OR v_brand = '' OR length(v_cardholder) < 3 THEN
    RAISE EXCEPTION 'Masked card information is incomplete';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(regexp_replace(v_phone, '\D', '', 'g')) < 7 THEN
    RAISE EXCEPTION 'Billing contact information is invalid';
  END IF;
  IF length(v_address) < 4 OR length(v_city) < 2 OR v_region = ''
     OR length(v_postcode) < 3 OR length(v_country) < 2 THEN
    RAISE EXCEPTION 'Complete all billing address fields';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sandbox_payment_transactions s
    WHERE s.user_id = v_user_id
      AND s.payment_method = 'card'
      AND upper(s.status) = 'PENDING'
      AND s.card_number_masked LIKE '%' || v_last_four
      AND s.amount = round(p_amount * 100)::bigint
      AND s.created_at > now() - interval '10 seconds'
  ) THEN
    RAISE EXCEPTION 'This card deposit was already submitted';
  END IF;

  v_reference := 'CARD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.transactions(user_id, type, amount, description, status)
  VALUES (
    v_user_id,
    'deposit',
    round(p_amount, 8),
    'Card deposit **** ' || v_last_four || ' - ' || v_reference,
    'pending'
  )
  RETURNING * INTO v_transaction;

  INSERT INTO public.sandbox_payment_transactions(
    user_id, reference_no, amount, currency, status, payment_method,
    card_number_masked, return_url, requires_3ds, customer_email,
    billing_info, shipping_info, transaction_id
  )
  VALUES (
    v_user_id,
    v_reference,
    round(p_amount * 100)::bigint,
    'USD',
    'PENDING',
    'card',
    '**** **** **** ' || v_last_four,
    'card-deposit://pending',
    false,
    v_email,
    jsonb_build_object(
      'cardholderName', v_cardholder,
      'cardBrand', v_brand,
      'phone', v_phone,
      'address1', v_address,
      'city', v_city,
      'state', v_region,
      'postcode', v_postcode,
      'country', v_country
    ),
    '{}'::jsonb,
    v_transaction.id
  )
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'pending',
    'reference', v_reference,
    'request_id', v_request.id,
    'transaction_id', v_transaction.id,
    'amount', p_amount,
    'currency', 'USDT'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_card_deposit(
  p_target_user_id uuid,
  p_card_request_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.sandbox_payment_transactions%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_decision text := lower(btrim(COALESCE(p_decision, '')));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_amount numeric(20,8);
  v_before jsonb;
  v_after jsonb;
  v_balance numeric(20,8);
BEGIN
  PERFORM public.crm_require_target_access(p_target_user_id);
  IF v_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'An audit reason is required'; END IF;

  SELECT * INTO v_request
  FROM public.sandbox_payment_transactions
  WHERE id = p_card_request_id
    AND user_id = p_target_user_id
    AND payment_method = 'card'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Card deposit request not found for this customer'; END IF;
  v_before := to_jsonb(v_request);
  v_amount := round(v_request.amount::numeric / 100, 8);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Card deposit amount is invalid'; END IF;

  IF upper(v_request.status) = 'APPROVED' AND v_request.credited_at IS NOT NULL THEN
    IF v_decision = 'approve' THEN
      RETURN jsonb_build_object('success', true, 'status', 'approved', 'idempotent', true, 'request_id', v_request.id, 'transaction_id', v_request.transaction_id);
    END IF;
    RAISE EXCEPTION 'This card deposit has already been approved';
  END IF;
  IF upper(v_request.status) IN ('DECLINED', 'REJECTED', 'FAILED') THEN
    IF v_decision = 'reject' THEN
      RETURN jsonb_build_object('success', true, 'status', 'rejected', 'idempotent', true, 'request_id', v_request.id, 'transaction_id', v_request.transaction_id);
    END IF;
    RAISE EXCEPTION 'This card deposit has already been rejected';
  END IF;
  IF upper(v_request.status) NOT IN ('PENDING', 'WAITING', 'APPROVED') THEN
    RAISE EXCEPTION 'This card deposit is not reviewable from its current status: %', v_request.status;
  END IF;

  PERFORM set_config('app.card_deposit_review_id', v_request.id::text, true);

  IF v_request.transaction_id IS NOT NULL THEN
    SELECT * INTO v_transaction
    FROM public.transactions
    WHERE id = v_request.transaction_id AND user_id = p_target_user_id
    FOR UPDATE;
  END IF;

  IF v_transaction.id IS NULL THEN
    SELECT * INTO v_transaction
    FROM public.transactions
    WHERE user_id = p_target_user_id
      AND type = 'deposit'
      AND description LIKE '%' || v_request.reference_no || '%'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_decision = 'approve' THEN
    IF v_transaction.id IS NOT NULL AND v_transaction.status = 'completed' AND v_request.credited_at IS NULL THEN
      RAISE EXCEPTION 'The linked transaction is already completed but this request is not marked credited; reconcile it manually';
    END IF;

    IF v_transaction.id IS NULL THEN
      INSERT INTO public.transactions(user_id, type, amount, description, status)
      VALUES (p_target_user_id, 'deposit', v_amount, 'Card deposit approved - ' || v_request.reference_no, 'pending')
      RETURNING * INTO v_transaction;
    END IF;

    INSERT INTO public.balances(user_id, usdt_balance, btc_balance)
    VALUES (p_target_user_id, v_amount, 0)
    ON CONFLICT (user_id) DO UPDATE
      SET usdt_balance = COALESCE(public.balances.usdt_balance, 0) + EXCLUDED.usdt_balance,
          updated_at = now()
    RETURNING usdt_balance INTO v_balance;

    UPDATE public.transactions
    SET amount = v_amount,
        status = 'completed',
        description = 'Card deposit approved - ' || v_request.reference_no,
        updated_at = now()
    WHERE id = v_transaction.id;

    UPDATE public.sandbox_payment_transactions
    SET status = 'APPROVED',
        transaction_id = v_transaction.id,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_note = v_reason,
        credited_at = now(),
        error_message = NULL
    WHERE id = v_request.id
    RETURNING to_jsonb(sandbox_payment_transactions.*) INTO v_after;

    INSERT INTO public.notifications(user_id, type, message, is_read, data)
    VALUES (
      p_target_user_id,
      'deposit_approved',
      'Your card deposit of ' || trim(to_char(v_amount, 'FM999999999999990.00')) || ' USDT was approved.',
      false,
      jsonb_build_object('reference', v_request.reference_no, 'amount', v_amount, 'currency', 'USDT', 'status', 'approved')
    );
  ELSE
    IF v_transaction.id IS NULL THEN
      INSERT INTO public.transactions(user_id, type, amount, description, status)
      VALUES (p_target_user_id, 'deposit', v_amount, 'Card deposit rejected - ' || v_request.reference_no, 'failed')
      RETURNING * INTO v_transaction;
    ELSIF v_transaction.status = 'completed' THEN
      RAISE EXCEPTION 'A completed deposit cannot be rejected';
    ELSE
      UPDATE public.transactions
      SET amount = v_amount,
          status = 'failed',
          description = 'Card deposit rejected - ' || v_request.reference_no,
          updated_at = now()
      WHERE id = v_transaction.id;
    END IF;

    SELECT COALESCE(usdt_balance, 0) INTO v_balance FROM public.balances WHERE user_id = p_target_user_id;

    UPDATE public.sandbox_payment_transactions
    SET status = 'DECLINED',
        transaction_id = v_transaction.id,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        review_note = v_reason,
        credited_at = NULL,
        error_message = v_reason
    WHERE id = v_request.id
    RETURNING to_jsonb(sandbox_payment_transactions.*) INTO v_after;

    INSERT INTO public.notifications(user_id, type, message, is_read, data)
    VALUES (
      p_target_user_id,
      'deposit_rejected',
      'Your card deposit of ' || trim(to_char(v_amount, 'FM999999999999990.00')) || ' USDT was not approved.',
      false,
      jsonb_build_object('reference', v_request.reference_no, 'amount', v_amount, 'currency', 'USDT', 'status', 'rejected')
    );
  END IF;

  INSERT INTO public.admin_action_logs(admin_user_id, target_user_id, action, before_data, after_data, reason)
  VALUES (
    auth.uid(),
    p_target_user_id,
    'card_deposit_' || CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    v_before,
    v_after || jsonb_build_object('balance_after', v_balance, 'transaction_id', v_transaction.id),
    v_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    'request_id', v_request.id,
    'transaction_id', v_transaction.id,
    'amount', v_amount,
    'balance', v_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_card_deposit(numeric,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_card_deposit(numeric,text,text,text,text,text,text,text,text,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_review_card_deposit(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_card_deposit(uuid,uuid,text,text) TO authenticated;
