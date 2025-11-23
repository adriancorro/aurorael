// =============================================
// FULL route.js — VERSION ESTABLE Y FUNCIONAL
// Arquitectura profesional + weather + hora/fecha
// Optimizado y con fallback gpt-4o
// =============================================

import { corsHeaders } from "../utils/cors.js";
import {
  normalizeText,
  adaptiveTruncate,
  prepareHistory,
} from "../utils/textUtils.js";
import {
  detectLanguage,
  extractLocation,
  isWeatherQuestion,
  isTimeQuestion,
  isDateQuestion,
} from "../utils/detectUtils.js";
import { getOrCreateSession, pushHistory } from "../services/sessionService.js";
import { fetchWeather } from "../services/weatherService.js";
import { runModel } from "../services/openaiService.js";
import { KEYWORDS } from "../config/keywords.js";

// =============================================
// POST
// =============================================
export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  const body = await req.json().catch(() => ({}));
  const prompt = (body.prompt || "").trim();
  const sessionId = (body.sessionId || "").trim();

  const { id, session } = getOrCreateSession(sessionId);
  if (!prompt)
    return new Response(
      JSON.stringify({ error: "Prompt vacío", sessionId: id }),
      { status: 400, headers }
    );

  const clean = normalizeText(prompt);
  const lang = detectLanguage(prompt);

  // =============================================
  // KEYWORDS → autor
  // =============================================
  const askAuthor = KEYWORDS.some((k) => clean.includes(normalizeText(k)));
  if (askAuthor) {
    const txt =
      "AURORAEL fue creada por **Adrian Corro** en un proyecto filosófico-crítico. Si deseas ver su origen metafísico, te muestro un video.";

    return new Response(
      JSON.stringify({ result: txt, videoId: "jOSO3AAIUzM", sessionId: id }),
      { status: 200, headers }
    );
  }

  // =============================================
  // WEATHER / TIME / DATE
  // =============================================
  if (
    isWeatherQuestion(prompt) ||
    isTimeQuestion(prompt) ||
    isDateQuestion(prompt)
  ) {
    const loc = extractLocation(prompt) || session.lastLocation;

    if (!loc) {
      return new Response(
        JSON.stringify({
          result: "¿De qué ciudad hablas? (Ciudad, País)",
          sessionId: id,
        }),
        { status: 200, headers }
      );
    }

    session.lastLocation = loc;

    try {
      const w = await fetchWeather(loc);

      // ---------- WEATHER ----------
      if (isWeatherQuestion(prompt)) {
        const res =
          lang === "es"
            ? `En ${w.name}, ${w.country}: Temp ${w.temp}°C, sensación ${w.feels}°C. ${w.desc}.`
            : `In ${w.name}, ${w.country}: Temp ${w.temp}°C, feels like ${w.feels}°C. ${w.desc}.`;

        return new Response(JSON.stringify({ result: res, sessionId: id }), {
          status: 200,
          headers,
        });
      }

      // ---------- TIME / DATE ----------
      const tz = w.raw.timezone;
      const local = new Date(Date.now() + tz * 1000);

      if (isTimeQuestion(prompt)) {
        const res =
          lang === "es"
            ? `Hora local en ${w.name}: ${local.toLocaleTimeString()}`
            : `Local time in ${w.name}: ${local.toLocaleTimeString()}`;

        return new Response(JSON.stringify({ result: res, sessionId: id }), {
          status: 200,
          headers,
        });
      }

      if (isDateQuestion(prompt)) {
        const res =
          lang === "es"
            ? `Fecha local en ${w.name}: ${local.toLocaleString()}`
            : `Local date in ${w.name}: ${local.toLocaleString()}`;

        return new Response(JSON.stringify({ result: res, sessionId: id }), {
          status: 200,
          headers,
        });
      }
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message, sessionId: id }),
        { status: 500, headers }
      );
    }
  }

  // =============================================
  // GENERAL LLM
  // =============================================

  const systemMsg =
    lang === "es"
      ? "Eres AURORAEL, una IA filósofa crítico-teórica (Frankfurt + Žižek + Lacan). Responde con precisión, profundidad y claridad."
      : "You are AURORAEL, a critical-theory philosophical system. Respond with depth and precision.";

  const history = prepareHistory(session.history);

  const messages = [
    { role: "system", content: systemMsg },
    {
      role: "system",
      content: session.lastLocation
        ? `Ubicación conocida del usuario: ${session.lastLocation}`
        : "",
    },
    ...history,
    { role: "user", content: adaptiveTruncate(prompt, 1600) },
  ];

  const result = await runModel(messages);
  const text = result.output[0].content[0].text || "";

  pushHistory(session, "user", prompt);
  pushHistory(session, "assistant", text);

  return new Response(JSON.stringify({ result: text, sessionId: id }), {
    status: 200,
    headers,
  });
}

// =============================================
// OPTIONS
// =============================================
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// =============================================
// GET
// =============================================
export async function GET() {
  return new Response(JSON.stringify({ status: "OK" }), {
    status: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
