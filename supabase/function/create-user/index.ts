// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.1";

serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      return new Response("Missing server env", { status: 500 });
    }
    const supabase = createClient(url, serviceKey);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const callerRes = await supabase.auth.getUser(jwt);
    if (callerRes.error || !callerRes.data?.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    const callerId = callerRes.data.user.id;

    const callerRoleRes = await supabase
      .from("users")
      .select("role")
      .eq("id", callerId)
      .single();
    if (callerRoleRes.error || callerRoleRes.data?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }

    const body = await req.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "cashier");
    if (!name || !email || !password) {
      return new Response("Missing fields", { status: 400 });
    }

    const created = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, role },
    });
    if (created.error || !created.data?.user) {
      return new Response("Create failed", { status: 400 });
    }

    const newUser = created.data.user;
    const insertRes = await supabase.from("users").insert({
      id: newUser.id,
      name,
      email,
      role,
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString(),
      created_by: callerId,
    });
    if (insertRes.error) {
      return new Response("Insert failed", { status: 400 });
    }

    return new Response(JSON.stringify({ id: newUser.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (_e) {
    return new Response("Server error", { status: 500 });
  }
});
