/* Make client-record comments explicit, bounded, branch-scoped and audited. */

CREATE OR REPLACE FUNCTION public.admin_add_user_note(p_target_user_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_comment text := btrim(COALESCE(p_note, ''));
  v_note public.user_notes%ROWTYPE;
BEGIN
  PERFORM public.crm_require_target_access(p_target_user_id);
  PERFORM public.crm_require_permission('customers.manage');

  IF v_comment = '' THEN
    RAISE EXCEPTION 'A client comment cannot be empty';
  END IF;
  IF length(v_comment) > 5000 THEN
    RAISE EXCEPTION 'Client comments cannot exceed 5,000 characters';
  END IF;

  INSERT INTO public.user_notes(user_id, admin_id, note)
  VALUES (p_target_user_id, auth.uid(), v_comment)
  RETURNING * INTO v_note;

  INSERT INTO public.admin_action_logs(
    admin_user_id,
    target_user_id,
    action,
    after_data,
    reason
  ) VALUES (
    auth.uid(),
    p_target_user_id,
    'add_client_comment',
    to_jsonb(v_note),
    'Comment added to client record'
  );

  RETURN to_jsonb(v_note);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_user_note(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_user_note(uuid,text) TO authenticated;

