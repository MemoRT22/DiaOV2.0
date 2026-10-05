import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ROLES = ["coordinacion", "staff", "sorteo"] as const;
type Role = (typeof ROLES)[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class Fail extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) throw new Fail("INVALID_ROLES");
  const roles = [...new Set(value)].filter((r): r is Role => ROLES.includes(r as Role));
  if (roles.length !== value.length || roles.length === 0) throw new Fail("INVALID_ROLES");
  return roles;
}

function primaryRole(roles: Role[]): Role {
  return ROLES.find((r) => roles.includes(r))!;
}

function checkPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 72) throw new Fail("WEAK_PASSWORD");
  return value;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller?.user) return json({ error: "NOT_AUTHORIZED" }, 401);
    const callerId = caller.user.id;

    const { data: callerRow, error: crError } = await admin
      .from("staff_members").select("is_active, staff_roles(role)").eq("user_id", callerId).maybeSingle();
    if (crError) throw crError;
    const isCoord = !!callerRow?.is_active &&
      (callerRow.staff_roles as { role: string }[] | null ?? []).some((r) => r.role === "coordinacion");
    if (!isCoord) return json({ error: "NOT_AUTHORIZED" }, 403);

    const body = await req.json().catch(() => null);
    const action = body?.action;

    const audit = (act: string, detail: Record<string, unknown>) =>
      admin.rpc("active_edition_id").then(({ data: edition }) =>
        admin.from("audit_log").insert({ edition_id: edition ?? null, actor_user_id: callerId, action: act, detail })
      );

    const activeCoordinators = async (excluding: string) => {
      const { data, error } = await admin
        .from("staff_roles").select("user_id, staff_members!inner(is_active)")
        .eq("role", "coordinacion").eq("staff_members.is_active", true).neq("user_id", excluding);
      if (error) throw error;
      return data?.length ?? 0;
    };

    if (action === "list") {
      const { data, error } = await admin
        .from("staff_members")
        .select("user_id, full_name, email, is_active, is_demo, created_at, staff_roles(role)")
        .order("full_name");
      if (error) throw error;
      const accounts = (data ?? []).map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name,
        email: m.email,
        is_active: m.is_active,
        is_demo: m.is_demo,
        created_at: m.created_at,
        roles: ((m.staff_roles as { role: string }[] | null) ?? []).map((r) => r.role),
      }));
      return json({ accounts });
    }

    if (action === "create") {
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Fail("INVALID_EMAIL");
      if (fullName.length < 3 || fullName.length > 120) throw new Fail("INVALID_NAME");
      const roles = parseRoles(body?.roles);
      const password = checkPassword(body?.password);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { kind: "staff" },
      });
      if (createError || !created.user) {
        if (createError && /already|registered|exists/i.test(createError.message)) throw new Fail("EMAIL_EXISTS");
        throw createError ?? new Error("create failed");
      }
      const userId = created.user.id;
      const { error: memberError } = await admin.from("staff_members").insert({
        user_id: userId, full_name: fullName, email, role: primaryRole(roles), is_active: true,
      });
      if (memberError) {
        await admin.auth.admin.deleteUser(userId);
        throw memberError;
      }
      const { error: rolesError } = await admin.from("staff_roles")
        .insert(roles.map((role) => ({ user_id: userId, role, granted_by: callerId })));
      if (rolesError) throw rolesError;
      await audit("staff.created", { user_id: userId, roles });
      return json({ user_id: userId });
    }

    const userId = typeof body?.user_id === "string" ? body.user_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Fail("INVALID_INPUT");
    const { data: target, error: targetError } = await admin
      .from("staff_members").select("user_id, is_active, staff_roles(role)").eq("user_id", userId).maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new Fail("NOT_FOUND", 404);
    const targetRoles = ((target.staff_roles as { role: string }[] | null) ?? []).map((r) => r.role);

    if (action === "update") {
      const roles = parseRoles(body?.roles);
      const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
      const isActive = body?.is_active === true;
      if (fullName.length < 3 || fullName.length > 120) throw new Fail("INVALID_NAME");
      if (userId === callerId && !isActive) throw new Fail("CANNOT_DEACTIVATE_SELF");
      const losesCoord = targetRoles.includes("coordinacion") && target.is_active && (!roles.includes("coordinacion") || !isActive);
      if (losesCoord && (await activeCoordinators(userId)) === 0) throw new Fail("LAST_COORDINATOR");

      const { error: updError } = await admin.from("staff_members")
        .update({ full_name: fullName, is_active: isActive, role: primaryRole(roles) }).eq("user_id", userId);
      if (updError) throw updError;
      const removed = targetRoles.filter((r) => !roles.includes(r as Role));
      const added = roles.filter((r) => !targetRoles.includes(r));
      if (removed.length) {
        const { error } = await admin.from("staff_roles").delete().eq("user_id", userId).in("role", removed);
        if (error) throw error;
      }
      if (added.length) {
        const { error } = await admin.from("staff_roles")
          .insert(added.map((role) => ({ user_id: userId, role, granted_by: callerId })));
        if (error) throw error;
      }
      if (isActive !== target.is_active) {
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: isActive ? "none" : "876000h" });
        if (error) throw error;
      }
      await audit("staff.updated", { user_id: userId, roles, is_active: isActive, added, removed });
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const password = checkPassword(body?.password);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      await audit("staff.password_reset", { user_id: userId });
      return json({ ok: true });
    }

    throw new Fail("INVALID_INPUT");
  } catch (err) {
    if (err instanceof Fail) return json({ error: err.code }, err.status);
    console.error("staff-accounts failed", err);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

