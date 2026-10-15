import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { operationalFetch } from "../_shared/operations.ts";
import { handleRequest } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: operationalFetch },
});
Deno.serve((req: Request) => handleRequest(req, admin, () => console.error("staff-accounts failed")));

