/*
  Complete CRM hierarchy management.

  A user may report to any higher role, so intermediate levels can be skipped:
  Admin -> Retention/Manager/Agent/Client
  Retention -> Manager/Agent/Client
  Manager -> Agent/Client
  Agent -> Client
*/

CREATE OR REPLACE FUNCTION public.validate_crm_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_role text;
  v_admin_count integer;
  v_conflicting_reports integer;
BEGIN
  -- Keep the legacy administrator flag synchronized with the CRM role.
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

  IF TG_OP = 'UPDATE' AND OLD.crm_role = 'admin' AND NEW.crm_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.users
    WHERE crm_role = 'admin' AND id <> OLD.id;
    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'The CRM must retain at least one administrator';
    END IF;
  END IF;

  -- A changed role must remain above every existing direct report. Valid reports
  -- stay attached, so promotions and safe role changes no longer need a teardown.
  IF TG_OP = 'UPDATE' AND OLD.crm_role IS DISTINCT FROM NEW.crm_role THEN
    SELECT count(*) INTO v_conflicting_reports
    FROM public.users child
    WHERE child.crm_parent_id = NEW.id
      AND public.crm_role_rank(child.crm_role) <= public.crm_role_rank(NEW.crm_role);
    IF v_conflicting_reports > 0 THEN
      RAISE EXCEPTION 'Reassign % incompatible direct report(s) before changing this role', v_conflicting_reports;
    END IF;
  END IF;

  IF NEW.crm_role = 'admin' THEN
    IF NEW.crm_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Administrators cannot report to another user';
    END IF;
    RETURN NEW;
  END IF;

  -- Clients may exist in the unassigned pool. CRM staff must belong to a branch.
  IF NEW.crm_role = 'client' AND NEW.crm_parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.crm_parent_id IS NULL THEN
    RAISE EXCEPTION '% must have a reporting manager', replace(NEW.crm_role, '_', ' ');
  END IF;
  IF NEW.crm_parent_id = NEW.id THEN
    RAISE EXCEPTION 'A user cannot report to themselves';
  END IF;

  SELECT crm_role INTO v_parent_role
  FROM public.users
  WHERE id = NEW.crm_parent_id;
  IF v_parent_role IS NULL THEN
    RAISE EXCEPTION 'Reporting manager not found';
  END IF;
  IF public.crm_role_rank(v_parent_role) >= public.crm_role_rank(NEW.crm_role) THEN
    RAISE EXCEPTION '% must report to a higher-level role', replace(NEW.crm_role, '_', ' ');
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT child.id
      FROM public.users child
      WHERE child.crm_parent_id = NEW.id
      UNION
      SELECT child.id
      FROM public.users child
      JOIN descendants parent ON child.crm_parent_id = parent.id
    )
    SELECT 1 FROM descendants WHERE id = NEW.crm_parent_id
  ) THEN
    RAISE EXCEPTION 'A user cannot report to anyone inside their own branch';
  END IF;

  RETURN NEW;
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
  v_parent_role text;
  v_permission_entry record;
BEGIN
  PERFORM public.crm_require_permission('hierarchy.manage');
  PERFORM public.crm_require_target_access(p_target_user_id);
  SELECT crm_role INTO v_actor_role FROM public.users WHERE id = auth.uid();

  IF p_role NOT IN ('admin', 'retention', 'manager', 'agent', 'client') THEN
    RAISE EXCEPTION 'Invalid CRM role';
  END IF;
  IF jsonb_typeof(v_permissions) <> 'object' THEN
    RAISE EXCEPTION 'Permissions must be an object';
  END IF;
  SELECT key INTO v_invalid_key
  FROM jsonb_each(v_permissions)
  WHERE key NOT IN (
    'crm.view', 'customers.manage', 'wallet.manage', 'trading.manage', 'robot.manage',
    'deposits.review', 'support.manage', 'notifications.send', 'audit.view',
    'hierarchy.manage', 'users.manage'
  ) OR jsonb_typeof(value) <> 'boolean'
  LIMIT 1;
  IF v_invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid CRM permission: %', v_invalid_key;
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(u) INTO v_before
  FROM public.users u
  WHERE u.id = p_target_user_id
  FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF p_role = 'admin' THEN
    v_permissions := public.crm_default_permissions('admin');
  ELSE
    IF p_role <> 'client' AND p_parent_user_id IS NULL THEN
      RAISE EXCEPTION '% must have a reporting manager', replace(p_role, '_', ' ');
    END IF;
    IF p_parent_user_id IS NOT NULL THEN
      SELECT crm_role INTO v_parent_role FROM public.users WHERE id = p_parent_user_id;
      IF v_parent_role IS NULL THEN
        RAISE EXCEPTION 'Reporting manager not found';
      END IF;
      IF public.crm_role_rank(v_parent_role) >= public.crm_role_rank(p_role) THEN
        RAISE EXCEPTION '% must report to a higher-level role', replace(p_role, '_', ' ');
      END IF;
    END IF;
  END IF;

  IF v_actor_role <> 'admin' THEN
    IF public.crm_role_rank(p_role) <= public.crm_role_rank(v_actor_role) THEN
      RAISE EXCEPTION 'You cannot grant your own role or a higher role';
    END IF;
    IF p_parent_user_id IS NOT NULL
       AND p_parent_user_id <> auth.uid()
       AND NOT public.crm_can_access(auth.uid(), p_parent_user_id) THEN
      RAISE EXCEPTION 'The reporting manager is outside your hierarchy branch';
    END IF;
    FOR v_permission_entry IN SELECT key, value FROM jsonb_each(v_permissions)
    LOOP
      IF v_permission_entry.value = 'true'::jsonb
         AND NOT public.crm_has_permission(auth.uid(), v_permission_entry.key) THEN
        RAISE EXCEPTION 'You cannot grant a permission you do not have: %', v_permission_entry.key;
      END IF;
    END LOOP;
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

REVOKE ALL ON FUNCTION public.crm_update_user_access(uuid,text,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_update_user_access(uuid,text,uuid,jsonb,text) TO authenticated;

