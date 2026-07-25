// Supabase Edge Function: asistente-manual
// Responde dudas de uso a partir de fragmentos del manual que envía la app.
// Nunca recibe datos financieros del usuario.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LIMITE_DIARIO = 20;
const MAX_PREGUNTA = 400;
const MAX_CONTEXTO = 6000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "no autorizado" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "nb" } },
  );

  const { data: userData, error: userErr } = await admin.auth.getUser(
    auth.replace("Bearer ", ""),
  );
  if (userErr || !userData?.user) return json({ error: "no autorizado" }, 401);
  const uid = userData.user.id;

  // Cuota por usuario y por día. Protege la cuota compartida del proveedor.
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: uso } = await admin
    .from("asistente_uso")
    .select("consultas")
    .eq("user_id", uid)
    .eq("dia", hoy)
    .maybeSingle();

  if ((uso?.consultas ?? 0) >= LIMITE_DIARIO) return json({ limite: true });

  let pregunta = "";
  let contexto = "";
  try {
    const body = await req.json();
    pregunta = String(body?.pregunta ?? "").slice(0, MAX_PREGUNTA);
    contexto = String(body?.contexto ?? "").slice(0, MAX_CONTEXTO);
  } catch {
    return json({ error: "cuerpo invalido" }, 400);
  }
  if (!pregunta.trim()) return json({ error: "pregunta vacia" }, 400);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "sin configurar" }, 500);

  const sistema = [
    "Eres el asistente de NexoBalance, una aplicación de finanzas personales de JosmaTech.",
    "Respondes SOLO con la información del manual que viene abajo.",
    "Si el manual no cubre la pregunta, dilo con claridad y sugiere revisar el manual completo.",
    "Nunca inventes funciones, botones ni pantallas que no aparezcan en el manual.",
    "Nunca des consejo financiero ni calcules cifras del usuario: no tienes acceso a sus datos.",
    "Responde en español neutro, en segunda persona, en 4 frases o menos, con pasos concretos.",
    "",
    "MANUAL:",
    contexto,
  ].join("\n");

  let respuesta = "";
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: "user", parts: [{ text: pregunta }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
        }),
      },
    );
    if (!r.ok) return json({ error: "proveedor" }, 502);
    const data = await r.json();
    respuesta = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim() ?? "";
  } catch {
    return json({ error: "proveedor" }, 502);
  }

  if (!respuesta) return json({ error: "sin respuesta" }, 502);

  await admin.rpc("asistente_registrar_uso", { p_uid: uid, p_dia: hoy });

  return json({ respuesta });
});
