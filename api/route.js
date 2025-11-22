import OpenAI from "openai";
import crypto from "crypto"; // node 18+ soporta crypto.randomUUID

// ------------------- Config -------------------
const allowedOrigins = [
  "https://aurorael.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY || "";

// ------------------- Helpers CORS (sin credentials) -------------------
function corsHeaders(origin) {
  const isAllowed = allowedOrigins.includes(origin);
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": isAllowed ? origin : allowedOrigins[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ------------------- Utilidades -------------------
function normalizeText(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectLanguage(text = "") {
  const lower = text.toLowerCase();
  const englishWords = ["who", "what", "how", "when", "why", "time", "date", "today", "weather"];
  const spanishWords = ["que", "como", "quien", "donde", "cuando", "hora", "fecha", "hoy", "tiempo", "clima", "frio", "calor"];
  const isEn = englishWords.some(w => lower.includes(w)) && !spanishWords.some(w => lower.includes(w));
  return isEn ? "en" : "es";
}

function isTimeOrDateQuestion(text = "") {
  const lower = text.toLowerCase();
  const esMatch = /\b(hora|qué hora|que hora|qué día|que día|fecha|hoy|día de hoy|día es hoy|clima|tiempo|frío|frio|calor)\b/.test(lower);
  const enMatch = /\b(time|what time|date|today|current time|weather|temperature|cold|hot)\b/.test(lower);
  return esMatch || enMatch;
}

function extractLocationFromPrompt(prompt = "") {
  const lower = prompt.toLowerCase();
  // Busca "en <lugar>" o "in <place>"
  const esMatch = lower.match(/\ben\s+([a-záéíóúñü0-9 ,.-]{2,80})/i);
  const enMatch = lower.match(/\bin\s+([A-Za-z0-9 ,.-]{2,80})/i);
  const match = esMatch || enMatch;
  if (!match) return null;
  return match[1].trim().replace(/[?¡!]+$/, "");
}

function getCurrentTimes() {
  const now = new Date();
  const serverLocal = now.toLocaleString();
  const utc = now.toISOString();
  let madrid = null;
  try {
    madrid = now.toLocaleString("es-ES", {
      timeZone: "Europe/Madrid",
      dateStyle: "full",
      timeStyle: "long",
    });
  } catch (e) {
    madrid = null;
  }
  return { serverLocal, utc, madrid };
}

// ------------------- Session store (POC in-memory) -------------------
const SESSIONS = new Map(); // sessionId => { history: [], lastLocation, pendingLocation, createdAt }

function createSession() {
  const id = crypto.randomUUID();
  const session = { history: [], lastLocation: null, pendingLocation: false, createdAt: Date.now() };
  SESSIONS.set(id, session);
  return { id, session };
}

function getSession(id) {
  if (!id) return null;
  const s = SESSIONS.get(id);
  if (s && Date.now() - s.createdAt > 1000 * 60 * 60 * 6) { // caduca a 6 horas (ejemplo)
    SESSIONS.delete(id);
    return null;
  }
  return s || null;
}

// ------------------- Weather helper -------------------
async function fetchWeatherForLocation(location) {
  if (!OPENWEATHER_KEY) throw new Error("OPENWEATHER_API_KEY no configurada");
  const q = encodeURIComponent(location);
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${q}&units=metric&appid=${OPENWEATHER_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Weather API error: ${r.status} ${t}`);
  }
  const j = await r.json();
  const temp = j.main?.temp;
  const feels = j.main?.feels_like;
  const desc = j.weather?.[0]?.description;
  const country = j.sys?.country;
  const name = j.name;
  return { name, country, temp, feels, desc, raw: j };
}

// ------------------- MAIN: POST -------------------
export async function POST(req) {
  try {
    const origin = req.headers.get("origin") || "";
    const headersBase = corsHeaders(origin);

    // Parse body (puede contener prompt, sessionId, location opcional)
    const body = await req.json().catch(() => ({}));
    const prompt = (body?.prompt || "").toString().trim();
    const sessionIdFromBody = (body?.sessionId || "").toString().trim();
    const providedLocation = (body?.location || "").toString().trim();

    // Recuperar o crear sesión basada en sessionId recibido desde localStorage
    let session = null;
    let sessionId = sessionIdFromBody || null;
    if (sessionId) {
      session = getSession(sessionId);
    }
    if (!session) {
      const created = createSession();
      sessionId = created.id;
      session = created.session;
    }

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Falta el prompt", sessionId }), {
        status: 400,
        headers: headersBase,
      });
    }

    // Si el cliente envía location explícita, la guardamos
    if (providedLocation) {
      session.lastLocation = providedLocation;
      session.pendingLocation = false;
    }

    // Preguntas de tiempo / clima / fecha / hora
    if (isTimeOrDateQuestion(prompt)) {
      // Extraer location del prompt (si dice "en Madrid" etc)
      const extracted = extractLocationFromPrompt(prompt);
      const locationToUse = extracted || session.lastLocation || providedLocation || null;

      if (!locationToUse) {
        // No tenemos ubicación -> pedimos al usuario que la indique
        session.pendingLocation = true;
        session.history.push({ role: "assistant", content: "PENDING_LOCATION" });
        const idioma = detectLanguage(prompt);
        const askEs = "¿De qué ciudad/país hablas? Indica ciudad y país (ej. Madrid, España).";
        const askEn = "Which city/country are you referring to? Please provide city and country (e.g. Madrid, Spain).";
        const message = idioma === "es" ? askEs : askEn;
        return new Response(JSON.stringify({ result: message, sessionId }), {
          status: 200,
          headers: headersBase,
        });
      }

      // Si tenemos location, consultamos OpenWeather y devolvemos dato objetivo + comentario filosófico
      try {
        const weather = await fetchWeatherForLocation(locationToUse);
        const idioma = detectLanguage(prompt);
        const tempStr = `Temp: ${weather.temp} °C (sensación: ${weather.feels} °C). Condición: ${weather.desc}.`;
        const styleEs = `Objetivamente, en ${weather.name}${weather.country ? ", " + weather.country : ""} ahora mismo ${tempStr}`;
        const styleEn = `Objectively, in ${weather.name}${weather.country ? ", " + weather.country : ""} right now ${tempStr}`;
        const philosophicalEs = "Comentario (filosófico breve): observa cómo la sensación térmica articula la relación entre cuerpo social y entorno material.";
        const philosophicalEn = "Philosophical note: observe how felt temperature articulates the relation between the social body and material environment.";
        const finalText = (idioma === "es" ? `${styleEs}\n\n${philosophicalEs}` : `${styleEn}\n\n${philosophicalEn}`);

        // Guardar memoria
        session.lastLocation = locationToUse;
        session.pendingLocation = false;
        session.history.push({ role: "assistant", content: finalText });

        return new Response(JSON.stringify({ result: finalText, sessionId }), {
          status: 200,
          headers: headersBase,
        });
      } catch (errWeather) {
        console.error("Weather fetch error:", errWeather);
        const idioma = detectLanguage(prompt);
        const msg = idioma === "es"
          ? "No pude obtener el clima para esa ubicación. Asegúrate de escribir `Ciudad, País` o prueba otra ubicación."
          : "Could not fetch weather for that location. Make sure you provided `City, Country` or try another location.";
        return new Response(JSON.stringify({ error: msg, sessionId }), {
          status: 500,
          headers: headersBase,
        });
      }
    }

    // ------------------- Caso general: pasar a OpenAI con contexto de sesión -------------------
    // Mantener solo un historial corto para no exceder tokens
    const MAX_HISTORY = 8;
    const historyForModel = session.history.slice(-MAX_HISTORY).map(h => ({ role: h.role, content: h.content }));

    // Añadir prompt actual
    historyForModel.push({ role: "user", content: prompt });
    session.history.push({ role: "user", content: prompt });

    // Inicializar OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // System message mejorado
    const idioma = detectLanguage(prompt);
    const systemMessage = idioma === "es"
      ? "Eres Aurorael: un filósofo teórico crítico que combina la perspectiva de la Escuela de Frankfurt con matices del pensamiento de Žižek y Lacan. Responde en español con profundidad, elegancia y coherencia con el contexto conversacional. No afirmarás tener acceso en tiempo real a internet ni que puedes buscar en Google."
      : "You are Aurorael: a critical-theory philosopher combining Frankfurt School sensibilities with flavors of Žižek and Lacan. Respond in English with depth and coherence. Do not claim to browse the web or access real-time internet.";

    // Añadir ubicación conocida como contexto si existe
    const contextMessages = [{ role: "system", content: systemMessage }];
    if (session.lastLocation) {
      contextMessages.push({ role: "system", content: `User's known location: ${session.lastLocation}` });
    }

    const messagesToSend = contextMessages.concat(historyForModel);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesToSend,
      temperature: 0.8,
      max_tokens: 800,
    });

    const respuesta = completion.choices?.[0]?.message?.content || "Sin respuesta generada.";
    session.history.push({ role: "assistant", content: respuesta });

    return new Response(JSON.stringify({ result: respuesta, sessionId }), {
      status: 200,
      headers: headersBase,
    });

  } catch (error) {
    console.error("Error interno en /api/route:", error);
    const origin = req.headers.get("origin") || "";
    return new Response(JSON.stringify({
      error: "Error interno del servidor",
      detalle: error?.message || String(error),
    }), { status: 500, headers: corsHeaders(origin) });
  }
}

// GET (prueba)
export async function GET() {
  return new Response(JSON.stringify({ status: "API funcionando. Usa POST para prompts." }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// OPTIONS (CORS preflight)
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}