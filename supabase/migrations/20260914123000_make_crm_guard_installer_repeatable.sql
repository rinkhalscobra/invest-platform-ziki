/* Make branch-guard installation safe across repeat runs and older function formatting. */
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

    IF position('crm_require_target_access(p_target_user_id)' IN v_definition) > 0 THEN
      CONTINUE;
    END IF;

    v_updated := replace(v_definition, 'PERFORM public.require_admin()', 'PERFORM public.crm_require_target_access(p_target_user_id)');
    v_updated := replace(v_updated, 'PERFORM require_admin()', 'PERFORM public.crm_require_target_access(p_target_user_id)');

    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'Could not locate the legacy access guard in %', v_function;
    END IF;

    EXECUTE v_updated;
  END LOOP;
END;
$$;

