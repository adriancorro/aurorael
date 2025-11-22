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
  const englishWords = [
    "who",
    "what",
    "how",
    "when",
    "why",
    "time",
    "date",
    "today",
    "weather",
  ];
  const spanishWords = [
    "que",
    "como",
    "quien",
    "donde",
    "cuando",
    "hora",
    "fecha",
    "hoy",
    "tiempo",
    "clima",
    "frio",
    "calor",
  ];
  const isEn =
    englishWords.some((w) => lower.includes(w)) &&
    !spanishWords.some((w) => lower.includes(w));
  return isEn ? "en" : "es";
}

// Detección fina: hora vs clima vs fecha
function isWeatherQuestion(text = "") {
  const lower = text.toLowerCase();
  return /\b(clima|tiempo|temperatura|frío|frio|calor|¿cuánto (frío|calor)|weather|temperature|cold|hot)\b/.test(
    lower
  );
}
function isTimeQuestion(text = "") {
  const lower = text.toLowerCase();
  return /\b(hora|qué hora|que hora|what time|current time|qué hora es|what's the time|whats the time)\b/.test(
    lower
  );
}
function isDateQuestion(text = "") {
  const lower = text.toLowerCase();
  return /\b(fecha|qué día|que día|qué fecha|what date|what's the date|today|qué día es hoy|what day)\b/.test(
    lower
  );
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

// Formateo de hora usando IANA timezone (si cliente envía timeZone)
function formatTimeFromTimeZone(timeZone, locale = "es-ES") {
  try {
    const now = new Date();
    const full = new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "long",
      timeZone,
    }).format(now);
    const short = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone,
    }).format(now);
    return { full, short };
  } catch (e) {
    // timezone inválida o no soportada
    return null;
  }
}

// Fallback: formateo desde offset (segundos) devuelto por OpenWeather
function formatTimeFromOffset(timezoneOffsetSeconds, locale = "es-ES") {
  const ms = Date.now() + timezoneOffsetSeconds * 1000;
  const date = new Date(ms);
  const full = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(date);
  const short = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return { full, short };
}

// ------------------- Session store (POC in-memory) -------------------
const SESSIONS = new Map(); // sessionId => { history: [], lastLocation, pendingLocation, createdAt }

function createSession() {
  const id = crypto.randomUUID();
  const session = {
    history: [],
    lastLocation: null,
    pendingLocation: false,
    createdAt: Date.now(),
  };
  SESSIONS.set(id, session);
  return { id, session };
}

function getSession(id) {
  if (!id) return null;
  const s = SESSIONS.get(id);
  if (s && Date.now() - s.createdAt > 1000 * 60 * 60 * 6) {
    // caduca a 6 horas
    SESSIONS.delete(id);
    return null;
  }
  return s || null;
}

// ------------------- Weather helper (robusto: intentos + geocoding) -------------------
async function fetchWeatherForLocation(location) {
  if (!OPENWEATHER_KEY) throw new Error("OPENWEATHER_API_KEY no configurada");

  // helper para llamar weather por query
  async function callWeatherByQuery(q) {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
      q
    )}&units=metric&appid=${OPENWEATHER_KEY}`;
    const r = await fetch(url);
    const text = await r.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      throw new Error(`Weather API no JSON: ${r.status} ${text}`);
    }
    if (!r.ok)
      throw new Error(`Weather API error: ${r.status} ${j?.message || text}`);
    return j;
  }

  // 1) Intento directo
  try {
    const j = await callWeatherByQuery(location);
    return {
      name: j.name,
      country: j.sys?.country,
      temp: j.main?.temp,
      feels: j.main?.feels_like,
      desc: j.weather?.[0]?.description,
      raw: j,
    };
  } catch (err1) {
    // console.warn("Weather direct failed:", err1.message || err1);
    // 2) Intento mapear país por nombre (ej. "Madrid, España" -> "Madrid,ES")
    try {
      const parts = (location || "").split(",").map((s) => s.trim());
      if (parts.length === 2 && isNaN(Number(parts[1]))) {
        const countryName = parts[1].toLowerCase();
        const countryMap = {
          españa: "ES",
          spain: "ES",
          argentina: "AR",
          chile: "CL",
          mexico: "MX",
          usa: "US",
          "united states": "US",
          eeuu: "US",
          uk: "GB",
          "reino unido": "GB",
          "gran bretaña": "GB",
          francia: "FR",
          france: "FR",
          alemania: "DE",
          germany: "DE",
        };
        const cc = countryMap[countryName];
        if (cc) {
          try {
            const attempt = `${parts[0]},${cc}`;
            const j2 = await callWeatherByQuery(attempt);
            return {
              name: j2.name,
              country: j2.sys?.country,
              temp: j2.main?.temp,
              feels: j2.main?.feels_like,
              desc: j2.weather?.[0]?.description,
              raw: j2,
            };
          } catch (err2) {
            // continue
            // console.warn("Weather with country code failed:", err2.message || err2);
          }
        }
      }
    } catch (e) {
      // continue to geocoding
    }

    // 3) Fallback: usar Geocoding API de OpenWeather para encontrar lat/lon
    try {
      const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        location
      )}&limit=1&appid=${OPENWEATHER_KEY}`;
      const rg = await fetch(geoUrl);
      const txt = await rg.text();
      let gj;
      try {
        gj = JSON.parse(txt);
      } catch (e) {
        throw new Error(`Geocoding API no JSON: ${rg.status} ${txt}`);
      }
      if (!rg.ok || !Array.isArray(gj) || gj.length === 0) {
        throw new Error(`Geocoding failed: ${rg.status} ${gj?.message || txt}`);
      }
      const place = gj[0]; // { name, lat, lon, country }
      const wUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${place.lat}&lon=${place.lon}&units=metric&appid=${OPENWEATHER_KEY}`;
      const wr = await fetch(wUrl);
      const wtxt = await wr.text();
      let wj;
      try {
        wj = JSON.parse(wtxt);
      } catch (e) {
        throw new Error(`Weather by coords no JSON: ${wr.status} ${wtxt}`);
      }
      if (!wr.ok)
        throw new Error(
          `Weather by coords error: ${wr.status} ${wj?.message || wtxt}`
        );
      return {
        name: wj.name || place.name,
        country: wj.sys?.country || place.country,
        temp: wj.main?.temp,
        feels: wj.main?.feels_like,
        desc: wj.weather?.[0]?.description,
        raw: wj,
      };
    } catch (errGeo) {
      // Informativo para logs: combinar errores
      const msg = `No se pudo obtener weather para "${location}". Detalles: ${
        err1.message || err1
      }. Geocoding: ${errGeo.message || errGeo}`;
      throw new Error(msg);
    }
  }
}

// ------------------- MAIN: POST -------------------
export async function POST(req) {
  try {
    const origin = req.headers.get("origin") || "";
    const headersBase = corsHeaders(origin);

    // Parse body (puede contener prompt, sessionId, location opcional, timeZone opcional)
    const body = await req.json().catch(() => ({}));
    const prompt = (body?.prompt || "").toString().trim();
    const sessionIdFromBody = (body?.sessionId || "").toString().trim();
    const providedLocation = (body?.location || "").toString().trim();
    const clientTimeZone = (body?.timeZone || "").toString().trim(); // nuevo: timezone IANA desde el cliente

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
      return new Response(
        JSON.stringify({ error: "Falta el prompt", sessionId }),
        {
          status: 400,
          headers: headersBase,
        }
      );
    }

    // Si el cliente envía location explícita, la guardamos
    if (providedLocation) {
      session.lastLocation = providedLocation;
      session.pendingLocation = false;
    }

    // Manejo separado: TIME vs WEATHER vs DATE
    if (
      isTimeQuestion(prompt) ||
      isWeatherQuestion(prompt) ||
      isDateQuestion(prompt)
    ) {
      // Intentamos extraer location (o usar la session.lastLocation / providedLocation)
      const extracted = extractLocationFromPrompt(prompt);
      const locationToUse =
        extracted || session.lastLocation || providedLocation || null;

      // Si no tenemos ubicación -> pedimos al usuario que la indique (pero si hay clientTimeZone, no lo pedimos)
      if (!locationToUse && !clientTimeZone) {
        session.pendingLocation = true;
        session.history.push({
          role: "assistant",
          content: "PENDING_LOCATION",
        });
        const idioma = detectLanguage(prompt);
        const askEs =
          "¿De qué ciudad/país hablas? Indica ciudad y país (ej. Madrid, España).";
        const askEn =
          "Which city/country are you referring to? Please provide city and country (e.g. Madrid, Spain).";
        const message = idioma === "es" ? askEs : askEn;
        return new Response(JSON.stringify({ result: message, sessionId }), {
          status: 200,
          headers: headersBase,
        });
      }

      // Si es pregunta de HORA y el cliente envió timeZone -> usar timeZone directamente (no OpenWeather)
      if (isTimeQuestion(prompt) && clientTimeZone) {
        const locale = detectLanguage(prompt) === "es" ? "es-ES" : "en-US";
        const times = formatTimeFromTimeZone(clientTimeZone, locale);
        if (times) {
          const idioma = detectLanguage(prompt);
          const answerEs = `Hora local (según tu zona): ${times.short}.\nFecha completa: ${times.full}`;
          const answerEn = `Local time (based on your timezone): ${times.short}.\nFull date: ${times.full}`;
          const final = idioma === "es" ? answerEs : answerEn;
          // no necesitamos cambiar lastLocation si sólo usamos timeZone
          session.pendingLocation = false;
          session.history.push({ role: "assistant", content: final });
          return new Response(JSON.stringify({ result: final, sessionId }), {
            status: 200,
            headers: headersBase,
          });
        }
        // si timeZone no válido, seguiremos al flujo que usa OpenWeather
      }

      // Si tenemos location (o no teníamos timeZone legal), consultamos OpenWeather para obtener datos objetivos
      try {
        const weather = await fetchWeatherForLocation(
          locationToUse || session.lastLocation
        );

        // Si la pregunta es de HORA -> usamos timezone (offset) de OpenWeather si no teníamos timeZone
        if (isTimeQuestion(prompt)) {
          const tzOffset = weather.raw?.timezone ?? 0; // segundos
          const locale = detectLanguage(prompt) === "es" ? "es-ES" : "en-US";
          const times = formatTimeFromOffset(tzOffset, locale);
          const idioma = detectLanguage(prompt);
          const answerEs = `Hora local en ${weather.name}${
            weather.country ? ", " + weather.country : ""
          }: ${times.short}.\nFecha completa: ${times.full}`;
          const answerEn = `Local time in ${weather.name}${
            weather.country ? ", " + weather.country : ""
          }: ${times.short}.\nFull date: ${times.full}`;
          const final = idioma === "es" ? answerEs : answerEn;
          session.lastLocation = locationToUse || session.lastLocation;
          session.pendingLocation = false;
          session.history.push({ role: "assistant", content: final });
          return new Response(JSON.stringify({ result: final, sessionId }), {
            status: 200,
            headers: headersBase,
          });
        }

        // Si la pregunta es de CLIMA -> comportamiento anterior (temp + comentario)
        if (isWeatherQuestion(prompt)) {
          const idioma = detectLanguage(prompt);
          const tempStr = `Temp: ${weather.temp} °C (sensación: ${weather.feels} °C). Condición: ${weather.desc}.`;
          const styleEs = `Objetivamente, en ${weather.name}${
            weather.country ? ", " + weather.country : ""
          } ahora mismo ${tempStr}`;
          const styleEn = `Objectively, in ${weather.name}${
            weather.country ? ", " + weather.country : ""
          } right now ${tempStr}`;
          const philosophicalEs =
            "Comentario (filosófico breve): observa cómo la sensación térmica articula la relación entre cuerpo social y entorno material.";
          const philosophicalEn =
            "Philosophical note: observe how felt temperature articulates the relation between the social body and material environment.";
          const finalText =
            idioma === "es"
              ? `${styleEs}\n\n${philosophicalEs}`
              : `${styleEn}\n\n${philosophicalEn}`;
          session.lastLocation = locationToUse || session.lastLocation;
          session.pendingLocation = false;
          session.history.push({ role: "assistant", content: finalText });
          return new Response(
            JSON.stringify({ result: finalText, sessionId }),
            { status: 200, headers: headersBase }
          );
        }

        // Si la pregunta es de FECHA -> usamos offset de OpenWeather (si no se envió timeZone)
        if (isDateQuestion(prompt)) {
          const idioma = detectLanguage(prompt);
          // preferimos clientTimeZone si existe
          if (clientTimeZone) {
            const times = formatTimeFromTimeZone(
              clientTimeZone,
              idioma === "es" ? "es-ES" : "en-US"
            );
            if (times) {
              const ansEs = `Fecha y hora local (según tu zona): ${times.full}`;
              const ansEn = `Local date and time (based on your timezone): ${times.full}`;
              const final = idioma === "es" ? ansEs : ansEn;
              session.lastLocation = locationToUse || session.lastLocation;
              session.pendingLocation = false;
              session.history.push({ role: "assistant", content: final });
              return new Response(
                JSON.stringify({ result: final, sessionId }),
                { status: 200, headers: headersBase }
              );
            }
          }
          // fallback a offset
          const tz = weather.raw?.timezone ?? 0;
          const times = formatTimeFromOffset(
            tz,
            detectLanguage(prompt) === "es" ? "es-ES" : "en-US"
          );
          const answerEs = `Fecha y hora local en ${weather.name}${
            weather.country ? ", " + weather.country : ""
          }: ${times.full}`;
          const answerEn = `Local date and time in ${weather.name}${
            weather.country ? ", " + weather.country : ""
          }: ${times.full}`;
          const final = detectLanguage(prompt) === "es" ? answerEs : answerEn;
          session.lastLocation = locationToUse || session.lastLocation;
          session.pendingLocation = false;
          session.history.push({ role: "assistant", content: final });
          return new Response(JSON.stringify({ result: final, sessionId }), {
            status: 200,
            headers: headersBase,
          });
        }
      } catch (errWeather) {
        console.error("Weather fetch error:", errWeather);
        const idioma = detectLanguage(prompt);
        const msg =
          idioma === "es"
            ? "No pude obtener datos para esa ubicación. Asegúrate de escribir `Ciudad, País` o prueba otra ubicación."
            : "Could not fetch data for that location. Make sure you provided `City, Country` or try another location.";
        return new Response(JSON.stringify({ error: msg, sessionId }), {
          status: 500,
          headers: headersBase,
        });
      }
    }

    // ------------------- Caso general: pasar a OpenAI con contexto de sesión -------------------
    const MAX_HISTORY = 8;
    const historyForModel = session.history
      .slice(-MAX_HISTORY)
      .map((h) => ({ role: h.role, content: h.content }));

    // Añadir prompt actual
    historyForModel.push({ role: "user", content: prompt });
    session.history.push({ role: "user", content: prompt });

    // Inicializar OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // System message mejorado
    const idioma = detectLanguage(prompt);
    const systemMessage =
      idioma === "es"
        ? "Eres Aurorael: un filósofo teórico crítico que combina la perspectiva de la Escuela de Frankfurt con matices del pensamiento de Žižek y Lacan. Responde en español con profundidad, elegancia y coherencia con el contexto conversacional. No afirmarás tener acceso en tiempo real a internet ni que puedes buscar en Google."
        : "You are Aurorael: a critical-theory philosopher combining Frankfurt School sensibilities with flavors of Žižek and Lacan. Respond in English with depth and coherence. Do not claim to browse the web or access real-time internet.";

    // Añadir ubicación conocida como contexto si existe
    const contextMessages = [{ role: "system", content: systemMessage }];
    if (session.lastLocation) {
      contextMessages.push({
        role: "system",
        content: `User's known location: ${session.lastLocation}`,
      });
    }

    const messagesToSend = contextMessages.concat(historyForModel);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesToSend,
      temperature: 0.8,
      max_tokens: 800,
    });

    const respuesta =
      completion.choices?.[0]?.message?.content || "Sin respuesta generada.";
    session.history.push({ role: "assistant", content: respuesta });

    return new Response(JSON.stringify({ result: respuesta, sessionId }), {
      status: 200,
      headers: headersBase,
    });
  } catch (error) {
    console.error("Error interno en /api/route:", error);
    const origin = req.headers.get("origin") || "";
    return new Response(
      JSON.stringify({
        error: "Error interno del servidor",
        detalle: error?.message || String(error),
      }),
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

// GET (prueba)
export async function GET() {
  return new Response(
    JSON.stringify({ status: "API funcionando. Usa POST para prompts." }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

// OPTIONS (CORS preflight)
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
