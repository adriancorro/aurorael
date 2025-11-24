// services/openaiService.js
// Servicio central para llamar a OpenAI Responses API con fallback y manejo correcto de 429/insufficient_quota
// Mejora: evita confundir timeouts/red con 429, añade timeout abortable y reintentos para errores transitorios.

import OpenAI from "openai";
import { MODEL_PRIMARY, MODEL_FALLBACK, OPENAI_KEY } from "../config/constants.js";

if (!OPENAI_KEY) {
  console.warn("Warning: OPENAI_API_KEY no configurada en environment variables.");
}

const client = new OpenAI({ apiKey: OPENAI_KEY });

// ----- Configurables -----
const DEFAULT_TIMEOUT_MS = 30_000; // 30 segundos por petición (ajusta si necesitas más)
const TRANSIENT_MAX_RETRIES = 2; // reintentos solo para 502/503/504/timeout (en PRIMARY)
const DEFAULT_MAX_OUTPUT_TOKENS = 800; // más caracteres por respuesta (aprox 3200 chars)

/**
 * getRetryAfterFromErr(err)
 * Extrae Retry-After de headers o del body si existe.
 */
function getRetryAfterFromErr(err) {
  try {
    if (err?.headers && typeof err.headers.get === "function") {
      const ra = err.headers.get("Retry-After") || err.headers.get("retry-after");
      if (ra) return Number(ra);
    }
    if (err?.error?.retry_after) return Number(err.error.retry_after);
    if (err?.response?.headers) {
      // algunos wrappers exponen headers en response.headers (obj)
      const h = err.response.headers["retry-after"] || err.response.headers["Retry-After"];
      if (h) return Number(h);
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

/**
 * isRateLimit(err)
 * Determina si el error corresponde a rate limit / insufficient quota
 */
function isRateLimit(err) {
  const status = err?.status || err?.error?.status || null;
  const type =
    err?.code ||
    err?.error?.code ||
    err?.error?.type ||
    err?.type ||
    (err?.response?.status ? String(err.response.status) : null);
  const msg = (err?.message || "").toLowerCase();

  if (status === 429) return true;
  if (type === "insufficient_quota" || type === "rate_limit") return true;
  if (/rate[_ -]?limit/.test(String(type))) return true;
  if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("insufficient_quota")) return true;
  return false;
}

/**
 * isTransientServerError(status, err)
 * Errores para los que tiene sentido reintentar: 502/503/504, timeouts, network issues.
 */
function isTransientServerError(status, err) {
  if ([502, 503, 504].includes(status)) return true;
  const msg = (err?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnreset") || msg.includes("network")) return true;
  return false;
}

/**
 * normalizeInputForResponses(raw)
 * Normaliza `messages` para evitar 400: acepta string, array de strings o array de {role, content}
 * Devuelve string | Array<string>
 */
function normalizeInputForResponses(raw) {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "";
    const first = raw[0];
    if (first && typeof first === "object" && ("role" in first || "content" in first || "message" in first)) {
      // convertir cada mensaje a "role: content" — Responses API acepta array de strings también
      return raw.map((m) => {
        const role = m.role ? String(m.role) : "user";
        const content = m.content ?? m.message ?? "";
        return `${role}: ${String(content)}`;
      });
    }
    // array de strings -> asegurar que todos son strings
    return raw.map((x) => String(x));
  }
  // fallback seguro
  try {
    return JSON.stringify(raw);
  } catch (e) {
    return String(raw);
  }
}

/**
 * singleCall(modelName, params)
 * Realiza una llamada abortable a client.responses.create con timeout.
 */
async function singleCall(modelName, params = {}) {
  const { input, max_output_tokens, temperature, timeoutMs } = params;
  const safeInput = normalizeInputForResponses(input);
  const finalTimeout = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_TIMEOUT_MS;

  // Crear AbortController si está disponible
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller ? controller.signal : undefined;
  let timeoutId = null;
  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), finalTimeout);
  }

  try {
    // Log ligero para debug (comentar en producción)
    // console.log("[openai] calling", modelName, { inputPreview: Array.isArray(safeInput) ? safeInput.slice(0,2) : String(safeInput).slice(0,200), max_output_tokens });

    const resp = await client.responses.create({
      model: modelName,
      input: safeInput,
      max_output_tokens,
      temperature,
      ...(signal ? { signal } : {}),
    });

    if (timeoutId) clearTimeout(timeoutId);
    return resp;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    // Re-lanzar el error para que el caller lo procese
    throw err;
  }
}

/**
 * runModel(messages, opts)
 *
 * - messages: array/obj con el contenido que enviarás a Responses API (puede ser array de mensajes o string)
 * - opts: { max_output_tokens, temperature, timeoutMs } opcionales
 *
 * Retorna:
 * - { ok: true, response, usedFallback: false }
 * - { ok: true, response, usedFallback: true }
 * - { ok: false, code: "rate_limit", status: 429, retryAfter: Number|null, message }
 * - { ok: false, code: "openai_error", status, message }
 */
export async function runModel(messages, opts = {}) {
  const max_output_tokens = opts.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.8;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  // Intento en PRIMARY con reintentos limitados SOLO para errores transitorios
  let attempt = 0;
  while (attempt <= TRANSIENT_MAX_RETRIES) {
    try {
      const resp = await singleCall(MODEL_PRIMARY, { input: messages, max_output_tokens, temperature, timeoutMs });
      return { ok: true, response: resp, usedFallback: false };
    } catch (err) {
      // Extraer información del error
      const status = err?.status || err?.error?.status || (err?.response && err.response.status) || null;
      const code = err?.code || err?.error?.code || err?.error?.type || err?.type || null;
      const message = err?.message || (err?.error && err.error.message) || String(err);

      // Si es rate limit / insufficient_quota -> regresar inmediatamente info estructurada
      if (isRateLimit(err) || code === "insufficient_quota") {
        const retryAfter = getRetryAfterFromErr(err) || null;
        return {
          ok: false,
          code: "rate_limit",
          status: 429,
          retryAfter,
          message,
        };
      }

      // Si es un error transitorio (502/503/504/timeout/network) -> reintentar con backoff
      if (isTransientServerError(status, err) && attempt < TRANSIENT_MAX_RETRIES) {
        const backoff = Math.round(300 * Math.pow(2, attempt)); // 300ms, 600ms, ...
        // console.warn(`[openai] transient error on primary (attempt ${attempt}), retrying in ${backoff}ms`, { status, message });
        await new Promise((r) => setTimeout(r, backoff));
        attempt++;
        continue; // reintentar PRIMARY
      }

      // Si no es transitorio o se agotaron reintentos -> intentar fallback UNA vez
      // Guardar último error para referencia si fallback también falla
      var lastPrimaryErr = { status, code, message, original: err };
      break;
    }
  }

  // Intentar fallback (una sola vez)
  try {
    const resp2 = await singleCall(MODEL_FALLBACK, { input: messages, max_output_tokens, temperature, timeoutMs });
    return { ok: true, response: resp2, usedFallback: true };
  } catch (err2) {
    const status2 = err2?.status || err2?.error?.status || (err2?.response && err2.response.status) || null;
    const code2 = err2?.code || err2?.error?.code || err2?.error?.type || err2?.type || null;
    const message2 = err2?.message || (err2?.error && err2.error.message) || String(err2);

    // Si fallback devolvió rate_limit -> propagar como rate_limit
    if (isRateLimit(err2) || code2 === "insufficient_quota") {
      const retryAfter2 = getRetryAfterFromErr(err2) || null;
      return {
        ok: false,
        code: "rate_limit",
        status: 429,
        retryAfter: retryAfter2,
        message: message2,
      };
    }

    // Si todo falla devolver openai_error (mantener estructura para que caller lo transforme en 500)
    return {
      ok: false,
      code: "openai_error",
      status: status2 || (lastPrimaryErr && lastPrimaryErr.status) || 500,
      message: message2 || (lastPrimaryErr && lastPrimaryErr.message) || "Unknown error",
    };
  }
}
