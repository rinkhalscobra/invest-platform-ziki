/* Ensure the primary administrator has CRM access even when the account was
   created after the original CRM bootstrap migrations were applied. */

DO $$
BEGIN
  -- The hierarchy protection triggers trust service-role requests. Migrations
  -- run outside PostgREST, so provide the equivalent local claim explicitly.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  UPDATE public.users
  SET is_admin = true,
      crm_role = 'admin',
      crm_parent_id = NULL,
      updated_at = now()
  WHERE lower(email) = 'admin@gmail.com'
    AND (
      is_admin IS DISTINCT FROM true
      OR crm_role IS DISTINCT FROM 'admin'
      OR crm_parent_id IS NOT NULL
    );
END;
$$;
