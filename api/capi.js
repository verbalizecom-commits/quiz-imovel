// /api/capi.js — Conversions API (server-side) — Quiz Imóvel Jéssica Araújo
// Recebe o lead do quiz e reporta o evento ao Meta pelo servidor.
// Usa o MESMO event_id do pixel do navegador => o Meta deduplica sozinho.

const PIXEL_ID = "2505251923246474";
const API_VERSION = "v21.0";

const crypto = require("crypto");

function sha256(v) {
  if (!v) return undefined;
  return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
}

// Telefone BR -> E.164 sem "+" (ex: 5583999998888)
function normalizaTelefone(tel) {
  if (!tel) return undefined;
  let d = String(tel).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;   // adiciona DDI
  if (d.length < 12) return undefined;
  return d;
}

function primeiroNome(nome) {
  if (!nome) return undefined;
  return String(nome).trim().split(/\s+/)[0];
}

module.exports = async function handler(req, res) {
  // CORS (o quiz e a função vivem no mesmo domínio, mas garante preflight)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const TOKEN = process.env.META_CAPI_TOKEN;
  if (!TOKEN) {
    console.error("[CAPI] META_CAPI_TOKEN ausente");
    return res.status(200).json({ ok: false, reason: "token_ausente" }); // nunca quebra o quiz
  }

  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const eventId = b.event_id;
    if (!eventId) return res.status(200).json({ ok: false, reason: "sem_event_id" });

    // IP real do usuário (Vercel entrega em x-forwarded-for)
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || undefined;
    const ua = req.headers["user-agent"] || undefined;

    // Cookies do Meta melhoram MUITO a qualidade da correspondência
    const cookies = req.headers.cookie || "";
    const fbp = (cookies.match(/_fbp=([^;]+)/) || [])[1];
    const fbc = (cookies.match(/_fbc=([^;]+)/) || [])[1] || b.fbc || undefined;

    const user_data = {
      ph: [sha256(normalizaTelefone(b.whatsapp))].filter(Boolean),
      fn: [sha256(primeiroNome(b.nome))].filter(Boolean),
      country: [sha256("br")],
      client_ip_address: ip,
      client_user_agent: ua,
      fbp: fbp,
      fbc: fbc
    };
    // remove chaves vazias
    Object.keys(user_data).forEach(k => {
      const v = user_data[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete user_data[k];
    });

    const eventos = [{
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,                       // <<< dedup com o pixel do navegador
      action_source: "website",
      event_source_url: b.source_url || "https://quiz-imovel.vercel.app/",
      user_data,
      custom_data: {
        content_name: "quiz_imovel_v2",
        perfil: b.perfil,
        regiao: b.regiao,
        faixa: b.faixa,
        tipo: b.tipo,
        prazo: b.prazo,
        campanha: b.campanha,
        anuncio: b.anuncio
      }
    }];

    // Evento extra de lead qualificado (mesma lógica do navegador)
    if (b.qualificado) {
      eventos.push({
        event_name: "LeadQualificado",
        event_time: Math.floor(Date.now() / 1000),
        event_id: "q-" + eventId,
        action_source: "website",
        event_source_url: b.source_url || "https://quiz-imovel.vercel.app/",
        user_data,
        custom_data: { faixa: b.faixa, tipo: b.tipo }
      });
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: eventos })
    });

    const out = await resp.json();
    if (!resp.ok) {
      console.error("[CAPI] erro Meta:", JSON.stringify(out));
      return res.status(200).json({ ok: false, meta: out });
    }

    console.log("[CAPI] enviado:", eventId, JSON.stringify(out));
    return res.status(200).json({ ok: true, event_id: eventId, meta: out });

  } catch (e) {
    console.error("[CAPI] exception:", e && e.message);
    return res.status(200).json({ ok: false, reason: "exception" }); // nunca quebra o quiz
  }
};
