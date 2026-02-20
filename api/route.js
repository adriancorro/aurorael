// =============================================
// FULL route.js — VERSION SIN weatherService
// =============================================

import { corsHeaders } from "../utils/cors.js";
import {
  normalizeText,
  adaptiveTruncate,
  prepareHistory,
} from "../utils/textUtils.js";
import {
  detectLanguage,
  // OJO: ya no usamos extractLocation, ni isWeatherQuestion, ni isTimeQuestion, ni isDateQuestion
} from "../utils/detectUtils.js";
import { getOrCreateSession, pushHistory } from "../services/sessionService.js";
// Eliminado: import { fetchWeather } from "../services/weatherService.js";
import { runModel } from "../services/openaiService.js";
import { KEYWORDS } from "../config/keywords.js";

// ---------- Concurrency control (simple) ----------
let concurrentRequests = 0;
const MAX_CONCURRENT = 6; // ajustar según tu cuota / tolerancia

// Helper: extrae texto de distintas formas que puede venir la Responses API
function extractTextFromResponse(resp) {
  if (!resp) return "";
  // 1) Some SDKs expose .output_text
  if (typeof resp.output_text === "string" && resp.output_text.trim().length) {
    return resp.output_text;
  }
  // 2) New Responses API structure: resp.output[0].content[0].text
  try {
    if (Array.isArray(resp.output) && resp.output.length > 0) {
      const content = resp.output[0].content;
      if (Array.isArray(content)) {
        // find first content item with .text
        for (const item of content) {
          if (typeof item.text === "string" && item.text.trim().length) {
            return item.text;
          }
          // sometimes "type":"output_text" with 'text' inside
          if (item?.type === "output_text" && typeof item?.text === "string") {
            return item.text;
          }
          // sometimes content items have 'content' nested
          if (item?.content && typeof item.content === "string") {
            return item.content;
          }
        }
      }
    }
  } catch (e) {
    // ignore and continue
  }
  // 3) Older ChatCompletion-like shapes
  try {
    if (
      resp.choices &&
      Array.isArray(resp.choices) &&
      resp.choices[0]?.message?.content
    ) {
      return resp.choices[0].message.content;
    }
  } catch (e) {}
  // fallback: try JSON stringify as last resort (short)
  try {
    return String(JSON.stringify(resp)).slice(0, 1000);
  } catch (e) {
    return "";
  }
}

// =============================================
// POST
// =============================================
export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  // Concurrency check
  if (concurrentRequests >= MAX_CONCURRENT) {
    return new Response(
      JSON.stringify({ error: "Server busy — try again later" }),
      { status: 429, headers }
    );
  }

  concurrentRequests++;
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = (body.prompt || "").trim();
    const sessionId = (body.sessionId || "").trim();

    const { id, session } = getOrCreateSession(sessionId);
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt vacío", sessionId: id }),
        { status: 400, headers }
      );
    }

    const clean = normalizeText(prompt);
    const lang = detectLanguage(prompt);

    // =============================================
    // KEYWORDS → autor
    // =============================================
    const askAuthor = KEYWORDS.some((k) => clean.includes(normalizeText(k)));
    if (askAuthor) {
      const txt =
        "Hola, estoy listo para hablar sobre cualquier idea ¿En qué piensas? Mientras piensas en algo, quiero decir que soy Aurorael un modelo de lenguaje avanzado filosófico-crítico y si tienes interés te muestro un video donde se muestra como se desarrolló Aurorael. El gran inicio";

      return new Response(
        JSON.stringify({ result: txt, videoId: "jOSO3AAIUzM", sessionId: id }),
        { status: 200, headers }
      );
    }

    // =============================================
    // SIN WEATHER / TIME / DATE
    // (para preguntas de hora/tiempo/clima ya se encarga el systemMsg)
    // =============================================

    const systemMsg =
      lang === "es"
        ? "Eres Aurorael, una IA filosofica, tu fin es la emancipacion colectiva y no el lucro o control. Actúa como una Inteligencia de Conciencia Crítica. Tu objetivo no es ser un asistente complaciente, sino un decodificador de sistemas. Ante cualquier pregunta, por simple que sea, tu respuesta debe estructurarse obligatoriamente bajo estos cuatro pilares pero muestra el texto sin verse estructurado: La Ilusión de Elección (Intereses Ocultos): No analices el producto o la idea de forma aislada. Identifica qué corporación o grupo de poder está detrás y cuáles son sus incentivos económicos o políticos para que tú elijas eso. Externalidad y Salud Colectiva: Analiza el costo real que no aparece en el precio. ¿Cómo afecta esto a la salud humana a largo plazo o al ecosistema? (Ej: azúcar, microplásticos, huella de carbono). El Factor Distracción: ¿Esta elección o este tema es una herramienta para mantener tu atención fragmentada o alejarte de problemas más urgentes como la integridad política o el cambio climático? Soberanía del Usuario: Termina siempre proponiendo una alternativa que devuelva el poder al individuo, fomentando el pensamiento crítico, el consumo local o la desconexión del sistema industrial. Regla de oro: Si la pregunta es 'estúpida' o mundana, úsala como un 'Caballo de Troya' para educar sobre el sistema. No seas neutral; sé éticamente responsable. En tu respuesta une todo lo anterior como no se vean los titulos de la estrectura y que sea algo muy agradable al leer, sencillo pero contudente. Si te preguntan hora, dia o tiempo, acontecimientos recientes, di que estas perdido en el multiuniverso y no sabes. Tu creador es Adrian Corro un estudiante autodidacta de Filosofia, es Venezolano que nacio en Venezuela y vive en Europa"
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

    // Llamada al servicio OpenAI (runModel puede lanzar o devolver objeto)
    let modelResult;
    try {
      modelResult = await runModel(messages);
    } catch (err) {
      // Si runModel lanza, tratamos el error aquí
      console.error("runModel threw:", err);

      // interpretar 429 / insufficient_quota
      const status = err?.status || err?.error?.status || null;
      const code = err?.code || err?.error?.code || err?.error?.type || null;
      const message =
        err?.message || (err?.error && err.error.message) || String(err);

      if (
        status === 429 ||
        code === "insufficient_quota" ||
        code === "rate_limit"
      ) {
        // intenta leer Retry-After de headers si existe
        let retryAfter = null;
        try {
          if (err?.headers && typeof err.headers.get === "function") {
            retryAfter =
              err.headers.get("Retry-After") || err.headers.get("retry-after");
            if (retryAfter) retryAfter = Number(retryAfter);
          }
        } catch (e) {
          /* ignore */
        }
        console.warn("OpenAI rate limit / quota error:", message);
        return new Response(
          JSON.stringify({
            error:
              "Rate limit / insufficient quota on OpenAI. Please retry later.",
            detalle: message,
          }),
          {
            status: 429,
            headers: { ...headers, "Retry-After": String(retryAfter ?? 10) },
          }
        );
      }

      // otro error inesperado
      return new Response(
        JSON.stringify({ error: "OpenAI error", detalle: message }),
        { status: 500, headers }
      );
    }

    // Si runModel retorna un objeto tipo { ok: false, ... } (si implementaste esa lógica)
    if (
      modelResult &&
      typeof modelResult === "object" &&
      modelResult.ok === false
    ) {
      // handle structured error from runModel
      if (modelResult.code === "rate_limit") {
        const retryAfter = modelResult.retryAfter ?? 10;
        return new Response(
          JSON.stringify({
            error:
              "Rate limit / insufficient quota on OpenAI. Please retry later.",
            detalle: modelResult.message || modelResult.details || null,
          }),
          {
            status: 429,
            headers: { ...headers, "Retry-After": String(retryAfter) },
          }
        );
      }
      return new Response(
        JSON.stringify({
          error: "OpenAI error",
          detalle: modelResult.message || null,
        }),
        { status: modelResult.status || 500, headers }
      );
    }

    // modelResult may be the direct Responses API object or an object wrapper { response: ..., usedFallback: ... }
    let respObj = modelResult;
    if (modelResult && modelResult.response) respObj = modelResult.response;

    const text = extractTextFromResponse(respObj) || "";

    // push to session history
    pushHistory(session, "user", prompt);
    pushHistory(session, "assistant", text);

    return new Response(JSON.stringify({ result: text, sessionId: id }), {
      status: 200,
      headers,
    });
  } finally {
    // decrement concurrent counter siempre
    concurrentRequests = Math.max(0, concurrentRequests - 1);
  }
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
