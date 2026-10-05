/* Correct the CRM reporting chain to Admin -> Retention -> Manager -> Agent -> Client. */

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_crm_role_check;
DROP TRIGGER IF EXISTS validate_crm_hierarchy_fields ON public.users;

UPDATE public.users
SET crm_role = 'retention'
WHERE crm_role = 'superior_manager';

-- Retention users belong directly below an administrator. This also repairs any
-- retention account created while the temporary Manager -> Retention rule existed.
UPDATE public.users retention_user
SET crm_parent_id = (
  SELECT admin_user.id
  FROM public.users admin_user
  WHERE admin_user.crm_role = 'admin'
  ORDER BY admin_user.created_at, admin_user.id
  LIMIT 1
)
WHERE retention_user.crm_role = 'retention'
  AND NOT EXISTS (
    SELECT 1
    FROM public.users current_parent
    WHERE current_parent.id = retention_user.crm_parent_id
      AND current_parent.crm_role = 'admin'
  );

-- Clients may stay unassigned, but assigned clients must sit below an Agent.
UPDATE public.users client_user
SET crm_parent_id = NULL
WHERE client_user.crm_role = 'client'
  AND client_user.crm_parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.users current_parent
    WHERE current_parent.id = client_user.crm_parent_id
      AND current_parent.crm_role = 'agent'
  );

ALTER TABLE public.users ADD CONSTRAINT users_crm_role_check
  CHECK (crm_role IN ('admin', 'retention', 'manager', 'agent', 'client'));

CREATE OR REPLACE FUNCTION public.crm_default_permissions(p_role text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'admin' THEN jsonb_build_object(
      'crm.view', true, 'customers.manage', true, 'wallet.manage', true,
      'trading.manage', true, 'robot.manage', true, 'deposits.review', true,
      'support.manage', true, 'notifications.send', true, 'audit.view', true,
      'hierarchy.manage', true, 'users.manage', true
    )
    WHEN 'retention' THEN jsonb_build_object(
      'crm.view', true, 'customers.manage', true, 'wallet.manage', true,
      'trading.manage', true, 'robot.manage', true, 'deposits.review', true,
      'support.manage', true, 'notifications.send', true, 'audit.view', true,
      'hierarchy.manage', false, 'users.manage', false
    )
    WHEN 'manager' THEN jsonb_build_object(
      'crm.view', true, 'customers.manage', true, 'wallet.manage', true,
      'trading.manage', true, 'robot.manage', true, 'deposits.review', true,
      'support.manage', true, 'notifications.send', true, 'audit.view', false,
      'hierarchy.manage', false, 'users.manage', false
    )
    WHEN 'agent' THEN jsonb_build_object(
      'crm.view', true, 'customers.manage', true, 'wallet.manage', true,
      'trading.manage', true, 'robot.manage', false, 'deposits.review', false,
      'support.manage', true, 'notifications.send', true, 'audit.view', false,
      'hierarchy.manage', false, 'users.manage', false
    )
    ELSE jsonb_build_object(
      'crm.view', false, 'customers.manage', false, 'wallet.manage', false,
      'trading.manage', false, 'robot.manage', false, 'deposits.review', false,
      'support.manage', false, 'notifications.send', false, 'audit.view', false,
      'hierarchy.manage', false, 'users.manage', false
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.crm_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'admin' THEN 0
    WHEN 'retention' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'agent' THEN 3
    WHEN 'client' THEN 4
    ELSE 99
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
  v_admin_count integer;
BEGIN
  IF NEW.is_admin = true THEN
    NEW.crm_role := 'admin';
    NEW.crm_parent_id := NULL;
    NEW.crm_permissions := public.crm_default_permissions('admin');
  ELSIF TG_OP = 'UPDATE' AND OLD.is_admin = true AND NEW.is_admin = false AND NEW.crm_role = 'admin' THEN
    NEW.crm_role := 'client';
    NEW.crm_parent_id := NULL;
  ELSE
    NEW.is_admin := NEW.crm_role = 'admin';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       OLD.crm_role IS DISTINCT FROM NEW.crm_role
       OR OLD.crm_parent_id IS DISTINCT FROM NEW.crm_parent_id
       OR OLD.crm_permissions IS DISTINCT FROM NEW.crm_permissions
     )
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.crm_has_permission(auth.uid(), 'hierarchy.manage') THEN
    RAISE EXCEPTION 'Hierarchy management permission required';
  END IF;

  IF NEW.crm_role = 'admin' THEN
    IF NEW.crm_parent_id IS NOT NULL THEN RAISE EXCEPTION 'Administrators cannot report to another user'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.crm_role = 'client' AND NEW.crm_parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.crm_parent_id IS NULL THEN RAISE EXCEPTION '% must have a reporting manager', replace(NEW.crm_role, '_', ' '); END IF;
  IF NEW.crm_parent_id = NEW.id THEN RAISE EXCEPTION 'A user cannot report to themselves'; END IF;

  SELECT crm_role INTO v_parent_role FROM public.users WHERE id = NEW.crm_parent_id;
  IF v_parent_role IS NULL THEN RAISE EXCEPTION 'Reporting manager not found'; END IF;
  IF (NEW.crm_role = 'retention' AND v_parent_role <> 'admin')
     OR (NEW.crm_role = 'manager' AND v_parent_role <> 'retention')
     OR (NEW.crm_role = 'agent' AND v_parent_role <> 'manager')
     OR (NEW.crm_role = 'client' AND v_parent_role <> 'agent') THEN
    RAISE EXCEPTION 'Invalid reporting line from % to %', replace(NEW.crm_role, '_', ' '), replace(v_parent_role, '_', ' ');
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.crm_role = 'admin' AND NEW.crm_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count FROM public.users WHERE crm_role = 'admin' AND id <> OLD.id;
    IF v_admin_count = 0 THEN RAISE EXCEPTION 'The CRM must retain at least one administrator'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_crm_hierarchy_fields
BEFORE INSERT OR UPDATE OF crm_role, crm_parent_id, crm_permissions, is_admin ON public.users
FOR EACH ROW EXECUTE FUNCTION public.validate_crm_hierarchy();

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
        'retention', count(*) FILTER (WHERE u.crm_role = 'retention'),
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

CREATE OR REPLACE FUNCTION public.crm_update_user_access(
  p_target_user_id uuid,
  p_role text,
  p_parent_user_id uuid,
  p_permissions jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_permissions jsonb := COALESCE(p_permissions, public.crm_default_permissions(p_role));
  v_invalid_key text;
  v_actor_role text;
  v_permission_entry record;
BEGIN
  PERFORM public.crm_require_permission('hierarchy.manage');
  PERFORM public.crm_require_target_access(p_target_user_id);
  SELECT crm_role INTO v_actor_role FROM public.users WHERE id = auth.uid();
  IF p_role NOT IN ('admin', 'retention', 'manager', 'agent', 'client') THEN RAISE EXCEPTION 'Invalid CRM role'; END IF;
  IF jsonb_typeof(v_permissions) <> 'object' THEN RAISE EXCEPTION 'Permissions must be an object'; END IF;
  SELECT key INTO v_invalid_key
  FROM jsonb_each(v_permissions)
  WHERE key NOT IN (
    'crm.view', 'customers.manage', 'wallet.manage', 'trading.manage', 'robot.manage',
    'deposits.review', 'support.manage', 'notifications.send', 'audit.view',
    'hierarchy.manage', 'users.manage'
  ) OR jsonb_typeof(value) <> 'boolean'
  LIMIT 1;
  IF v_invalid_key IS NOT NULL THEN RAISE EXCEPTION 'Invalid CRM permission: %', v_invalid_key; END IF;
  IF p_role = 'admin' THEN v_permissions := public.crm_default_permissions('admin'); END IF;
  IF v_actor_role <> 'admin' THEN
    IF p_role = 'admin' THEN RAISE EXCEPTION 'Only an administrator may grant the administrator role'; END IF;
    FOR v_permission_entry IN SELECT key, value FROM jsonb_each(v_permissions)
    LOOP
      IF v_permission_entry.value = 'true'::jsonb
         AND NOT public.crm_has_permission(auth.uid(), v_permission_entry.key) THEN
        RAISE EXCEPTION 'You cannot grant a permission you do not have: %', v_permission_entry.key;
      END IF;
    END LOOP;
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
      crm_permissions = v_permissions,
      is_admin = p_role = 'admin',
      updated_at = now()
  WHERE id = p_target_user_id
  RETURNING to_jsonb(users.*) INTO v_after;

  INSERT INTO public.admin_action_logs(admin_user_id, target_user_id, action, before_data, after_data, reason)
  VALUES (auth.uid(), p_target_user_id, 'update_crm_access', v_before, v_after, p_reason);
  RETURN v_after;
END;
$$;
