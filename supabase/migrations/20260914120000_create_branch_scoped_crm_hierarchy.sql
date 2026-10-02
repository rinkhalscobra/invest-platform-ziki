/*
  Point2Wealth CRM hierarchy

  Access always flows upward through one branch:
  admin -> superior_manager -> manager -> agent -> client

  CRM operators may read and manage records strictly below themselves. Only an
  administrator may change roles or reporting lines.
*/

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS crm_role text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS crm_parent_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_crm_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_crm_role_check
  CHECK (crm_role IN ('admin', 'superior_manager', 'manager', 'agent', 'client'));

CREATE INDEX IF NOT EXISTS idx_users_crm_parent_id ON public.users(crm_parent_id);
CREATE INDEX IF NOT EXISTS idx_users_crm_role ON public.users(crm_role);

-- Preserve existing hierarchy assignments on repeat runs. New columns already
-- default ordinary accounts to client, so only legacy administrator accounts
-- need a one-time promotion.
UPDATE public.users
SET crm_role = 'admin',
    crm_parent_id = NULL
WHERE is_admin = true
  AND crm_role <> 'admin';

CREATE OR REPLACE FUNCTION public.crm_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'admin' THEN 0
    WHEN 'superior_manager' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'agent' THEN 3
    WHEN 'client' THEN 4
    ELSE 99
  END;
$$;

CREATE OR REPLACE FUNCTION public.crm_can_access(p_actor_user_id uuid, p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE lineage AS (
    SELECT u.id, u.crm_parent_id
    FROM public.users u
    WHERE u.id = p_target_user_id

    UNION ALL

    SELECT parent.id, parent.crm_parent_id
    FROM public.users parent
    JOIN lineage child ON child.crm_parent_id = parent.id
  )
  SELECT COALESCE(
    EXISTS (
      SELECT 1 FROM public.users actor
      WHERE actor.id = p_actor_user_id AND actor.crm_role = 'admin'
    )
    OR EXISTS (SELECT 1 FROM lineage WHERE id = p_actor_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.crm_has_workspace_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.crm_role IN ('admin', 'superior_manager', 'manager', 'agent')
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.crm_require_workspace_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.crm_has_workspace_access(auth.uid()) THEN
    RAISE EXCEPTION 'CRM workspace access required';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_require_target_access(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_role text;
BEGIN
  SELECT crm_role INTO v_actor_role FROM public.users WHERE id = auth.uid();

  IF v_actor_role IS NULL OR v_actor_role = 'client' THEN
    RAISE EXCEPTION 'CRM workspace access required';
  END IF;

  IF v_actor_role <> 'admin' AND p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'CRM access is limited to users below you';
  END IF;

  IF NOT public.crm_can_access(auth.uid(), p_target_user_id) THEN
    RAISE EXCEPTION 'This user is outside your hierarchy branch';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_crm_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_role text;
  v_expected_parent_role text;
  v_admin_count integer;
BEGIN
  -- Keep the legacy flag synchronized for old application and policy checks.
  IF NEW.is_admin = true THEN
    NEW.crm_role := 'admin';
    NEW.crm_parent_id := NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_admin = true AND NEW.is_admin = false AND NEW.crm_role = 'admin' THEN
    NEW.crm_role := 'client';
    NEW.crm_parent_id := NULL;
  ELSE
    NEW.is_admin := NEW.crm_role = 'admin';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (OLD.crm_role IS DISTINCT FROM NEW.crm_role OR OLD.crm_parent_id IS DISTINCT FROM NEW.crm_parent_id)
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.check_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'Only an administrator may change CRM roles or reporting lines';
  END IF;

  IF NEW.crm_role = 'admin' THEN
    IF NEW.crm_parent_id IS NOT NULL THEN RAISE EXCEPTION 'Administrators cannot report to another user'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.crm_role = 'client' AND NEW.crm_parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.crm_parent_id IS NULL THEN
    RAISE EXCEPTION '% must have a reporting manager', replace(NEW.crm_role, '_', ' ');
  END IF;
  IF NEW.crm_parent_id = NEW.id THEN RAISE EXCEPTION 'A user cannot report to themselves'; END IF;

  SELECT crm_role INTO v_parent_role FROM public.users WHERE id = NEW.crm_parent_id;
  IF v_parent_role IS NULL THEN RAISE EXCEPTION 'Reporting manager not found'; END IF;

  v_expected_parent_role := CASE NEW.crm_role
    WHEN 'superior_manager' THEN 'admin'
    WHEN 'manager' THEN 'superior_manager'
    WHEN 'agent' THEN 'manager'
    WHEN 'client' THEN 'agent'
  END;

  IF v_parent_role <> v_expected_parent_role THEN
    RAISE EXCEPTION '% must report to a %', replace(NEW.crm_role, '_', ' '), replace(v_expected_parent_role, '_', ' ');
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.crm_role = 'admin' AND NEW.crm_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count FROM public.users WHERE crm_role = 'admin' AND id <> OLD.id;
    IF v_admin_count = 0 THEN RAISE EXCEPTION 'The CRM must retain at least one administrator'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_crm_hierarchy_fields ON public.users;
CREATE TRIGGER validate_crm_hierarchy_fields
BEFORE INSERT OR UPDATE OF crm_role, crm_parent_id, is_admin ON public.users
FOR EACH ROW EXECUTE FUNCTION public.validate_crm_hierarchy();

CREATE OR REPLACE FUNCTION public.crm_get_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'actor_id', u.id,
    'actor_role', u.crm_role,
    'actor_name', COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email),
    'can_manage_hierarchy', u.crm_role = 'admin',
    'has_workspace_access', u.crm_role IN ('admin', 'superior_manager', 'manager', 'agent')
  )
  FROM public.users u
  WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.crm_get_hierarchy()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM public.crm_require_workspace_access();
  SELECT crm_role INTO v_role FROM public.users WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'users', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(u) || jsonb_build_object(
          'direct_reports', (SELECT count(*) FROM public.users child WHERE child.crm_parent_id = u.id),
          'branch_size', (SELECT count(*) FROM public.users branch WHERE branch.id <> u.id AND public.crm_can_access(u.id, branch.id))
        )
        ORDER BY public.crm_role_rank(u.crm_role), u.first_name NULLS LAST, u.email
      )
      FROM public.users u
      WHERE v_role = 'admin' OR public.crm_can_access(auth.uid(), u.id)
    ), '[]'::jsonb),
    'role_counts', (
      SELECT jsonb_build_object(
        'admin', count(*) FILTER (WHERE u.crm_role = 'admin'),
        'superior_manager', count(*) FILTER (WHERE u.crm_role = 'superior_manager'),
        'manager', count(*) FILTER (WHERE u.crm_role = 'manager'),
        'agent', count(*) FILTER (WHERE u.crm_role = 'agent'),
        'client', count(*) FILTER (WHERE u.crm_role = 'client')
      )
      FROM public.users u
      WHERE v_role = 'admin' OR public.crm_can_access(auth.uid(), u.id)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_update_hierarchy(
  p_target_user_id uuid,
  p_role text,
  p_parent_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public.require_admin();
  IF p_role NOT IN ('admin', 'superior_manager', 'manager', 'agent', 'client') THEN
    RAISE EXCEPTION 'Invalid CRM role';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  SELECT to_jsonb(u) INTO v_before FROM public.users u WHERE u.id = p_target_user_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF (v_before->>'crm_role') IS DISTINCT FROM p_role
     AND EXISTS (SELECT 1 FROM public.users child WHERE child.crm_parent_id = p_target_user_id) THEN
    RAISE EXCEPTION 'Reassign this user''s direct reports before changing their role';
  END IF;

  UPDATE public.users
  SET crm_role = p_role,
      crm_parent_id = CASE WHEN p_role = 'admin' THEN NULL ELSE p_parent_user_id END,
      is_admin = p_role = 'admin',
      updated_at = now()
  WHERE id = p_target_user_id
  RETURNING to_jsonb(users.*) INTO v_after;

  INSERT INTO public.admin_action_logs(admin_user_id, target_user_id, action, before_data, after_data, reason)
  VALUES (auth.uid(), p_target_user_id, 'update_crm_hierarchy', v_before, v_after, p_reason);
  RETURN v_after;
END;
$$;

-- The user directory is branch-scoped. Admin statistics remain global while
-- every other role receives statistics for only its own descendants.
CREATE OR REPLACE FUNCTION public.admin_get_users(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_role text;
  v_result jsonb;
BEGIN
  PERFORM public.crm_require_workspace_access();
  SELECT crm_role INTO v_actor_role FROM public.users WHERE id = auth.uid();

  WITH visible AS (
    SELECT u.*
    FROM public.users u
    WHERE v_actor_role = 'admin'
       OR (u.id <> auth.uid() AND public.crm_can_access(auth.uid(), u.id))
  ), filtered AS (
    SELECT u.* FROM visible u
    WHERE p_search IS NULL
       OR btrim(p_search) = ''
       OR u.email ILIKE '%' || btrim(p_search) || '%'
       OR COALESCE(u.first_name, '') ILIKE '%' || btrim(p_search) || '%'
       OR COALESCE(u.last_name, '') ILIKE '%' || btrim(p_search) || '%'
       OR u.id::text ILIKE '%' || btrim(p_search) || '%'
       OR replace(u.crm_role, '_', ' ') ILIKE '%' || btrim(p_search) || '%'
  ), page AS (
    SELECT f.* FROM filtered f
    ORDER BY public.crm_role_rank(f.crm_role), f.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 250)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'users', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'usdt_balance', COALESCE(b.usdt_balance, 0),
          'btc_balance', COALESCE(b.btc_balance, 0),
          'robot_allocated_balance', COALESCE(r.allocated_balance, 0),
          'robot_active', COALESCE(r.is_active, false)
        ) ORDER BY public.crm_role_rank(p.crm_role), p.created_at DESC
      )
      FROM page p
      LEFT JOIN public.balances b ON b.user_id = p.id
      LEFT JOIN public.robot_states r ON r.user_id = p.id
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'stats', jsonb_build_object(
      'total_users', (SELECT count(*) FROM visible),
      'pending_kyc', (SELECT count(*) FROM visible WHERE kyc_status = 'pending'),
      'active_robots', (SELECT count(*) FROM public.robot_states r JOIN visible v ON v.id = r.user_id WHERE r.is_active = true),
      'total_usdt', (SELECT COALESCE(sum(b.usdt_balance), 0) FROM public.balances b JOIN visible v ON v.id = b.user_id),
      'total_robot_allocated', (SELECT COALESCE(sum(r.allocated_balance), 0) FROM public.robot_states r JOIN visible v ON v.id = r.user_id)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Replace the full-admin check in every target-based CRM RPC with the branch
-- authorization guard. Keeping the existing function bodies avoids two data
-- APIs drifting apart as CRM modules evolve.
DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.admin_get_user_workspace(uuid)'::regprocedure,
    'public.admin_update_user_profile(uuid,jsonb,text)'::regprocedure,
    'public.admin_set_user_balances(uuid,numeric,numeric,text)'::regprocedure,
    'public.admin_update_robot_state(uuid,jsonb,text)'::regprocedure,
    'public.admin_credit_robot_profit(uuid,numeric,text)'::regprocedure,
    'public.admin_set_user_asset_balance(uuid,text,numeric,text)'::regprocedure,
    'public.admin_add_user_note(uuid,text)'::regprocedure,
    'public.admin_send_notification(uuid,text,text)'::regprocedure,
    'public.admin_update_module_record(uuid,text,uuid,jsonb,text)'::regprocedure,
    'public.admin_delete_module_record(uuid,text,uuid,text)'::regprocedure,
    'public.admin_send_support_message(uuid,uuid,text)'::regprocedure
  ]
  LOOP
    v_definition := pg_get_functiondef(v_function);
    -- A manual SQL-editor rerun may encounter functions that were already
    -- secured by a previous successful execution. That is a valid no-op.
    IF position('PERFORM public.crm_require_target_access(p_target_user_id)' IN v_definition) > 0 THEN
      CONTINUE;
    END IF;
    v_updated := replace(v_definition, 'PERFORM public.require_admin()', 'PERFORM public.crm_require_target_access(p_target_user_id)');
    v_updated := replace(v_updated, 'PERFORM require_admin()', 'PERFORM public.crm_require_target_access(p_target_user_id)');
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'Could not install hierarchy guard in %', v_function;
    END IF;
    EXECUTE v_updated;
  END LOOP;
END;
$$;

-- Recreate the profile writer explicitly. The legacy two_factor_required field
-- was removed before the integrated CRM was added and must not be referenced.
CREATE OR REPLACE FUNCTION public.admin_update_user_profile(
  p_target_user_id uuid,
  p_changes jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_kyc text;
BEGIN
  PERFORM public.crm_require_target_access(p_target_user_id);
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT to_jsonb(u) INTO v_before FROM public.users u WHERE u.id = p_target_user_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  IF p_changes ? 'kyc_status' THEN
    v_kyc := p_changes->>'kyc_status';
    IF v_kyc NOT IN ('not_verified', 'pending', 'verified') THEN RAISE EXCEPTION 'Invalid KYC status'; END IF;
  END IF;
  IF p_changes ? 'is_admin' AND NOT public.check_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'Only an administrator may change administrator access';
  END IF;
  IF p_changes ? 'is_admin'
     AND p_target_user_id = auth.uid()
     AND (p_changes->>'is_admin')::boolean IS DISTINCT FROM (v_before->>'is_admin')::boolean THEN
    RAISE EXCEPTION 'You cannot change your own administrator status';
  END IF;
  IF COALESCE(NULLIF(p_changes->>'referral_count', '')::integer, 0) < 0 THEN RAISE EXCEPTION 'Referral count cannot be negative'; END IF;
  IF COALESCE(NULLIF(p_changes->>'referral_commission_rate', '')::numeric, 0) NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'Referral commission rate must be between 0 and 1'; END IF;

  UPDATE public.users
  SET first_name = CASE WHEN p_changes ? 'first_name' THEN NULLIF(btrim(p_changes->>'first_name'), '') ELSE first_name END,
      last_name = CASE WHEN p_changes ? 'last_name' THEN NULLIF(btrim(p_changes->>'last_name'), '') ELSE last_name END,
      country = CASE WHEN p_changes ? 'country' THEN NULLIF(btrim(p_changes->>'country'), '') ELSE country END,
      phone_number = CASE WHEN p_changes ? 'phone_number' THEN NULLIF(btrim(p_changes->>'phone_number'), '') ELSE phone_number END,
      kyc_status = CASE WHEN p_changes ? 'kyc_status' THEN p_changes->>'kyc_status' ELSE kyc_status END,
      is_demo = CASE WHEN p_changes ? 'is_demo' THEN (p_changes->>'is_demo')::boolean ELSE is_demo END,
      is_admin = CASE WHEN p_changes ? 'is_admin' THEN (p_changes->>'is_admin')::boolean ELSE is_admin END,
      document_id_url = CASE WHEN p_changes ? 'document_id_url' THEN NULLIF(btrim(p_changes->>'document_id_url'), '') ELSE document_id_url END,
      document_selfie_url = CASE WHEN p_changes ? 'document_selfie_url' THEN NULLIF(btrim(p_changes->>'document_selfie_url'), '') ELSE document_selfie_url END,
      referral_code = CASE WHEN p_changes ? 'referral_code' THEN NULLIF(upper(btrim(p_changes->>'referral_code')), '') ELSE referral_code END,
      referred_by = CASE WHEN p_changes ? 'referred_by' THEN NULLIF(p_changes->>'referred_by', '')::uuid ELSE referred_by END,
      referral_count = CASE WHEN p_changes ? 'referral_count' THEN COALESCE(NULLIF(p_changes->>'referral_count', '')::integer, 0) ELSE referral_count END,
      total_referral_earnings = CASE WHEN p_changes ? 'total_referral_earnings' THEN COALESCE(NULLIF(p_changes->>'total_referral_earnings', '')::numeric, 0) ELSE total_referral_earnings END,
      referral_commission_rate = CASE WHEN p_changes ? 'referral_commission_rate' THEN COALESCE(NULLIF(p_changes->>'referral_commission_rate', '')::numeric, 0) ELSE referral_commission_rate END,
      max_leverage_forex = CASE WHEN p_changes ? 'max_leverage_forex' THEN NULLIF(p_changes->>'max_leverage_forex', '')::integer ELSE max_leverage_forex END,
      min_leverage_forex = CASE WHEN p_changes ? 'min_leverage_forex' THEN NULLIF(p_changes->>'min_leverage_forex', '')::integer ELSE min_leverage_forex END,
      max_leverage_commodities = CASE WHEN p_changes ? 'max_leverage_commodities' THEN NULLIF(p_changes->>'max_leverage_commodities', '')::integer ELSE max_leverage_commodities END,
      min_leverage_commodities = CASE WHEN p_changes ? 'min_leverage_commodities' THEN NULLIF(p_changes->>'min_leverage_commodities', '')::integer ELSE min_leverage_commodities END,
      max_leverage_stocks = CASE WHEN p_changes ? 'max_leverage_stocks' THEN NULLIF(p_changes->>'max_leverage_stocks', '')::integer ELSE max_leverage_stocks END,
      min_leverage_stocks = CASE WHEN p_changes ? 'min_leverage_stocks' THEN NULLIF(p_changes->>'min_leverage_stocks', '')::integer ELSE min_leverage_stocks END,
      max_leverage_futures = CASE WHEN p_changes ? 'max_leverage_futures' THEN NULLIF(p_changes->>'max_leverage_futures', '')::integer ELSE max_leverage_futures END,
      min_leverage_futures = CASE WHEN p_changes ? 'min_leverage_futures' THEN NULLIF(p_changes->>'min_leverage_futures', '')::integer ELSE min_leverage_futures END,
      updated_at = now()
  WHERE id = p_target_user_id
  RETURNING to_jsonb(users.*) INTO v_after;

  INSERT INTO public.admin_action_logs(admin_user_id, target_user_id, action, before_data, after_data, reason)
  VALUES (auth.uid(), p_target_user_id, 'update_profile', v_before, v_after, p_reason);
  RETURN v_after;
END;
$$;

-- Hierarchy fields are visible only through the guarded RPCs. The trigger above
-- blocks self-promotion even if a broad legacy users UPDATE policy exists.
REVOKE ALL ON FUNCTION public.crm_role_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_can_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_has_workspace_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_require_workspace_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_require_target_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_get_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_get_hierarchy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_update_hierarchy(uuid, text, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crm_get_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_get_hierarchy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_hierarchy(uuid, text, uuid, text) TO authenticated;
