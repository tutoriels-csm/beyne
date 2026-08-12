import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function toBase64Url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sanitizeHeader(value: string) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const required = ["reference","nom","telephone","email","modele","serie","categorie","priorite","description"];
    for (const key of required) {
      if (!body?.[key] || !String(body[key]).trim()) {
        return new Response(JSON.stringify({ error: `Champ manquant : ${key}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    const clientId = Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
    const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
    const sender = Deno.env.get("GMAIL_SENDER");
    const recipient = Deno.env.get("TICKET_RECIPIENT");

    if (!clientId || !clientSecret || !refreshToken || !sender || !recipient) {
      throw new Error("Secrets Gmail/Supabase incomplets");
    }

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResp.ok) throw new Error(`OAuth Gmail refusé (${tokenResp.status})`);
    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;

    const subject = sanitizeHeader(`Ticket assistance BEYNE - ${body.reference} - ${body.categorie}`);
    const replyTo = sanitizeHeader(body.email);
    const text = [
      "TICKET D'ASSISTANCE BEYNE",
      `Référence : ${body.reference}`,
      `Date : ${body.date || new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
      "",
      `Client : ${body.nom}`,
      `Téléphone : ${body.telephone}`,
      `E-mail : ${body.email}`,
      `Machine : ${body.modele}`,
      `N° de série : ${body.serie}`,
      `Catégorie : ${body.categorie}`,
      `Priorité : ${body.priorite}`,
      "",
      "Description :",
      String(body.description),
    ].join("\r\n");

    const raw = [
      `From: ${sanitizeHeader(sender)}`,
      `To: ${sanitizeHeader(recipient)}`,
      `Reply-To: ${replyTo}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
    ].join("\r\n");

    const gmailResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: toBase64Url(raw) }),
    });
    const gmailJson = await gmailResp.json();
    if (!gmailResp.ok) throw new Error(gmailJson?.error?.message || `Erreur Gmail (${gmailResp.status})`);

    return new Response(JSON.stringify({ ok: true, messageId: gmailJson.id, reference: body.reference }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
