import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function publicEmail(email: string | undefined) {
  return email && !email.endsWith("@nexobalance.app") ? email : null;
}

function countryFromPhone(phone: string | null | undefined) {
  const value = (phone || "").replace(/\D/g, "");
  if (value.startsWith("598")) return "UY";
  if (value.startsWith("54")) return "AR";
  if (value.startsWith("55")) return "BR";
  if (value.startsWith("56")) return "CL";
  if (value.startsWith("57")) return "CO";
  if (value.startsWith("51")) return "PE";
  if (value.startsWith("52")) return "MX";
  return "UY";
}

async function requestCentral(endpoint: string, productKey: string, body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jmt-product-key": productKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || !result?.ok || !result?.data) {
    throw new Error(result?.error || "LICENSE_CHECK_FAILED");
  }
  return result.data;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const platformUrl = Deno.env.get("PLATFORM_LICENSE_URL") || "";
  const productKey = Deno.env.get("PLATFORM_PRODUCT_KEY") || "";
  if (!url || !serviceKey || !platformUrl || !productKey) {
    return json({ ok: false, error: "LICENSE_INTEGRATION_NOT_CONFIGURED" }, 503);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  try {
    const user = userData.user;
    const phone = "+" + String(user.email || "").split("@")[0].replace(/\D/g, "");
    const displayName = typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";

    await admin.schema("nb").from("profiles").upsert({
      id: user.id,
      phone,
      display_name: displayName || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id", ignoreDuplicates: true });

    const { data: profile, error: profileError } = await admin
      .schema("nb")
      .from("profiles")
      .select("id,phone,display_name,is_admin")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) throw profileError || new Error("PROFILE_REQUIRED");

    // La cuenta de Josielis conserva acceso administrativo a cualquier producto.
    if (profile.is_admin) {
      const bypass = {
        valid: true,
        status: "superadmin",
        valid_until: null,
        trial_ends_at: null,
        paid_through: null,
        grace_until: null,
        plan: { code: "admin", name: "Administrador JosmaTech" },
        pricing: { daily_price: 0, currency: "UYU", amount_due: 0 },
      };
      await admin.schema("nb").from("license_cache").upsert({
        user_id: user.id,
        platform_license_id: null,
        status: bypass.status,
        valid: true,
        plan_code: bypass.plan.code,
        plan_name: bypass.plan.name,
        valid_until: null,
        checked_at: new Date().toISOString(),
        raw: bypass,
      });
      return json({ ok: true, bypass: true, license: bypass });
    }

    const externalRef = `nexobalance:${user.id}`;
    const baseBody = {
      app_code: "nexobalance",
      external_ref: externalRef,
      customer_ref: externalRef,
      customer_name: profile.display_name || "Usuario de NexoBalance",
      customer_email: publicEmail(user.email),
      customer_whatsapp: profile.phone || phone,
      country: countryFromPhone(profile.phone || phone),
      plan_code: "mensual",
    };

    let license: Record<string, any>;
    try {
      license = await requestCentral(platformUrl, productKey, { action: "license-status", ...baseBody });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "LICENSE_NOT_FOUND") throw error;
      try {
        license = await requestCentral(platformUrl, productKey, { action: "provision-trial", ...baseBody });
      } catch (provisionError) {
        // El centro puede crear la prueba y agotar la primera respuesta. Si eso
        // ocurre, una segunda consulta recupera la licencia recién creada sin
        // obligar a la persona a registrarse otra vez.
        try {
          license = await requestCentral(platformUrl, productKey, { action: "license-status", ...baseBody });
        } catch {
          throw provisionError;
        }
      }
    }

    const { error: cacheError } = await admin.schema("nb").from("license_cache").upsert({
      user_id: user.id,
      platform_license_id: license.license_id || null,
      status: license.status || "error",
      valid: license.valid === true,
      plan_code: license.plan?.code || null,
      plan_name: license.plan?.name || null,
      trial_ends_at: license.trial_ends_at || null,
      paid_through: license.paid_through || null,
      grace_until: license.grace_until || null,
      valid_until: license.valid_until || null,
      daily_price: Number(license.pricing?.daily_price || 0),
      currency: license.pricing?.currency || "UYU",
      amount_due: Number(license.pricing?.amount_due || 0),
      checked_at: new Date().toISOString(),
      raw: license,
    });
    if (cacheError) throw cacheError;
    return json({ ok: true, license });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LICENSE_CHECK_FAILED";
    console.error("sync-license", message);
    return json({ ok: false, error: message }, 503);
  }
});
