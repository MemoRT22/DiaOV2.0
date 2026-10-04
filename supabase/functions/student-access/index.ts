import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const birthDate = typeof body?.birth_date === "string" ? body.birth_date.trim() : "";

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      return json({ error: "INVALID_INPUT" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const emailHash = await sha256(email);
    const { data: lock, error: lockError } = await admin.rpc("access_lock_state", { p_email: email });
    if (lockError) throw lockError;
    if (lock?.locked) return json({ error: "TOO_MANY_ATTEMPTS" }, 429);

    const { data: edition, error: edError } = await admin
      .from("editions").select("id").eq("is_active", true).maybeSingle();
    if (edError) throw edError;
    if (!edition) return json({ error: "NO_ACTIVE_EDITION" }, 503);

    const { data: participant, error: pError } = await admin
      .from("participants")
      .select("id, birth_date, auth_user_id")
      .eq("edition_id", edition.id)
      .eq("email", email)
      .maybeSingle();
    if (pError) throw pError;

    if (!participant || !participant.birth_date || participant.birth_date !== birthDate) {
      await admin.from("access_attempts").insert({ email_hash: emailHash, succeeded: false });
      return json({ error: "INVALID_CREDENTIALS" }, 401);
    }

    // Auth identity uses a synthetic address so the real email never lives in the auth system
    const authEmail = `p.${participant.id}@participantes.diaov.invalid`;
    if (!participant.auth_user_id) {
      const { error: createError } = await admin.auth.admin.createUser({
        email: authEmail,
        email_confirm: true,
        app_metadata: { kind: "participant" },
      });
      if (createError && !/already/i.test(createError.message)) throw createError;
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: authEmail });
    if (linkError || !link?.properties?.hashed_token || !link.user) throw linkError ?? new Error("link generation failed");

    if (participant.auth_user_id !== link.user.id) {
      const { error: updError } = await admin
        .from("participants").update({ auth_user_id: link.user.id }).eq("id", participant.id);
      if (updError) throw updError;
    }

    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "email",
    });
    if (verifyError || !verified.session) throw verifyError ?? new Error("no session");

    await admin.from("access_attempts").insert({ email_hash: emailHash, succeeded: true });

    return json({
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    });
  } catch (err) {
    console.error("student-access failed", err);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
