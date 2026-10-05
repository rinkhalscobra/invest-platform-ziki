import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete" }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const accessToken = authorization.slice("Bearer ".length);
    const { data: actorResult, error: actorError } = await admin.auth.getUser(accessToken);
    if (actorError || !actorResult.user) return json({ error: "Invalid or expired administrator session" }, 401);

    const actorId = actorResult.user.id;
    const { data: actorProfile, error: actorProfileError } = await admin
      .from("users")
      .select("id, is_admin, crm_role, crm_permissions")
      .eq("id", actorId)
      .single();
    const actorPermissions = actorProfile?.crm_permissions && typeof actorProfile.crm_permissions === "object"
      ? actorProfile.crm_permissions as Record<string, unknown>
      : {};
    const canManageUsers = actorProfile?.is_admin === true || actorPermissions["users.manage"] === true;
    if (actorProfileError || !canManageUsers) return json({ error: "User-management permission required" }, 403);

    const body = await request.json().catch(() => ({})) as {
      action?: string;
      target_user_id?: string;
      email?: string;
      password?: string;
      first_name?: string;
      last_name?: string;
      role?: string;
      parent_user_id?: string | null;
      permissions?: Record<string, boolean>;
      confirmation_email?: string;
      reason?: string;
    };
    const reason = body.reason?.trim();
    if (!reason) return json({ error: "An audit reason is required" }, 400);

    if (body.action === "create_user") {
      const email = body.email?.trim().toLowerCase() || "";
      const password = body.password || "";
      const firstName = body.first_name?.trim().slice(0, 100) || "";
      const lastName = body.last_name?.trim().slice(0, 100) || "";
      const role = body.role?.trim() || "client";
      const parentUserId = body.parent_user_id?.trim() || null;
      const allowedRoles = ["admin", "retention", "manager", "agent", "client"];
      const permissionKeys = [
        "crm.view", "customers.manage", "wallet.manage", "trading.manage", "robot.manage",
        "deposits.review", "support.manage", "notifications.send", "audit.view",
        "hierarchy.manage", "users.manage",
      ];

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address" }, 400);
      if (password.length < 8) return json({ error: "Password must contain at least 8 characters" }, 400);
      if (!firstName || !lastName) return json({ error: "First name and last name are required" }, 400);
      if (!allowedRoles.includes(role)) return json({ error: "Invalid CRM role" }, 400);
      if (role !== "admin" && role !== "client" && !parentUserId) return json({ error: "A reporting manager is required for this role" }, 400);
      if (actorProfile?.crm_role !== "admin" && role === "admin") return json({ error: "Only an administrator may create another administrator" }, 403);

      const suppliedPermissions = body.permissions || {};
      const invalidPermission = Object.entries(suppliedPermissions).find(
        ([key, value]) => !permissionKeys.includes(key) || typeof value !== "boolean",
      );
      if (invalidPermission) return json({ error: `Invalid CRM permission: ${invalidPermission[0]}` }, 400);

      const { data: defaultPermissions, error: defaultPermissionsError } = await admin.rpc("crm_default_permissions", { p_role: role });
      if (defaultPermissionsError) return json({ error: `Could not load role permissions: ${defaultPermissionsError.message}` }, 500);
      const permissions = role === "admin"
        ? defaultPermissions
        : { ...(defaultPermissions as Record<string, boolean>), ...suppliedPermissions };

      if (actorProfile?.crm_role !== "admin") {
        const disallowedGrant = Object.entries(permissions as Record<string, boolean>).find(
          ([key, value]) => value === true && actorPermissions[key] !== true,
        );
        if (disallowedGrant) return json({ error: `You cannot grant a permission you do not have: ${disallowedGrant[0]}` }, 403);
      }

      if (parentUserId) {
        const { data: parent, error: parentError } = await admin
          .from("users")
          .select("id, crm_role")
          .eq("id", parentUserId)
          .single();
        if (parentError || !parent) return json({ error: "Reporting manager was not found" }, 400);
        const validParent = (role === "retention" && parent.crm_role === "admin")
          || (role === "manager" && parent.crm_role === "retention")
          || (role === "agent" && parent.crm_role === "manager")
          || (role === "client" && parent.crm_role === "agent");
        if (!validParent) return json({ error: "The selected reporting manager is not valid for this role" }, 400);
        if (actorProfile?.crm_role !== "admin") {
          const { data: parentAccessible, error: accessError } = await admin.rpc("crm_can_access", {
            p_actor_user_id: actorId,
            p_target_user_id: parentUserId,
          });
          if (accessError || parentAccessible !== true) return json({ error: "The reporting manager is outside your hierarchy branch" }, 403);
        }
      }

      const { data: createdAuth, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName },
      });
      if (createError || !createdAuth.user) return json({ error: createError?.message || "Could not create the Auth user" }, 400);

      const createdUserId = createdAuth.user.id;
      const { data: createdProfile, error: profileError } = await admin
        .from("users")
        .update({
          email,
          first_name: firstName,
          last_name: lastName,
          crm_role: role,
          crm_parent_id: role === "admin" ? null : parentUserId,
          crm_permissions: permissions,
          is_admin: role === "admin",
        })
        .eq("id", createdUserId)
        .select("id, email, first_name, last_name, crm_role, crm_parent_id, crm_permissions")
        .maybeSingle();

      if (profileError || !createdProfile) {
        await admin.auth.admin.deleteUser(createdUserId, false);
        return json({ error: `Auth user rollback completed because CRM profile setup failed: ${profileError?.message || "profile not initialized"}` }, 500);
      }

      const { error: auditError } = await admin.from("admin_action_logs").insert({
        admin_user_id: actorId,
        target_user_id: createdUserId,
        action: "auth_user_created",
        after_data: createdProfile,
        reason,
      });
      if (auditError) console.error("User creation audit error", auditError);
      return json({ success: true, message: "User created", user: createdProfile }, 201);
    }

    const targetUserId = body.target_user_id?.trim();
    if (!targetUserId) return json({ error: "Target user is required" }, 400);

    const { data: targetProfile, error: targetError } = await admin
      .from("users")
      .select("*")
      .eq("id", targetUserId)
      .single();
    if (targetError || !targetProfile) return json({ error: "Target user was not found" }, 404);

    if (body.action === "set_password") {
      const password = body.password || "";
      if (password.length < 8) return json({ error: "Password must contain at least 8 characters" }, 400);

      const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
      if (error) return json({ error: error.message }, 400);

      const { error: auditError } = await admin.from("admin_action_logs").insert({
        admin_user_id: actorId,
        target_user_id: targetUserId,
        action: "auth_password_reset",
        before_data: { email: targetProfile.email, user_id: targetUserId },
        after_data: { password_changed: true },
        reason,
      });
      if (auditError) console.error("Password reset audit error", auditError);
      return json({ success: true, message: "Password changed" });
    }

    if (body.action === "delete_user") {
      if (targetUserId === actorId) return json({ error: "You cannot delete your own administrator account" }, 400);
      if (body.confirmation_email?.trim().toLowerCase() !== String(targetProfile.email).toLowerCase()) {
        return json({ error: "Enter the customer's exact email address to confirm deletion" }, 400);
      }

      // Keep shared market events intact so deleting their original creator cannot
      // cascade-delete bets belonging to other customers.
      const { data: detachedEvents, error: eventDetachError } = await admin
        .from("events")
        .update({ user_id: null })
        .eq("user_id", targetUserId)
        .select("id");
      if (eventDetachError) return json({ error: `Could not prepare shared records for deletion: ${eventDetachError.message}` }, 500);

      const { error } = await admin.auth.admin.deleteUser(targetUserId, false);
      if (error) {
        const detachedEventIds = (detachedEvents || []).map((event: { id: string }) => event.id);
        if (detachedEventIds.length > 0) {
          await admin.from("events").update({ user_id: targetUserId }).in("id", detachedEventIds);
        }
        return json({ error: error.message }, 400);
      }

      // Older installations created public.users before its auth.users foreign key,
      // so explicitly remove the public profile as well. Its cascading foreign keys
      // clean balances, orders, positions, robot data, support records and the rest.
      const { error: profileDeleteError } = await admin.from("users").delete().eq("id", targetUserId);
      if (profileDeleteError) {
        console.error("Public profile cleanup error", profileDeleteError);
        return json({ error: `Auth user was deleted, but database cleanup failed: ${profileDeleteError.message}` }, 500);
      }

      const { error: auditError } = await admin.from("admin_action_logs").insert({
        admin_user_id: actorId,
        target_user_id: null,
        action: "auth_user_deleted",
        before_data: targetProfile,
        after_data: { deleted_user_id: targetUserId, database_cleanup: "cascade" },
        reason,
      });
      if (auditError) console.error("User deletion audit error", auditError);
      return json({ success: true, message: "User and related account data deleted" });
    }

    return json({ error: "Unsupported administrator action" }, 400);
  } catch (error) {
    console.error("Admin user management error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
});
