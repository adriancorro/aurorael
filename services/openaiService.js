// services/openaiService.js  (reemplaza runModel con esto)
import OpenAI from "openai";
import { MODEL_PRIMARY, MODEL_FALLBACK, OPENAI_KEY } from "../config/constants.js";

const client = new OpenAI({ apiKey: OPENAI_KEY });

const DEFAULT_TIMEOUT_MS = 30_000; // 30s por petición (ajusta si quieres más)
/**
 * Helpers de detección
 */
function extractRetryAfter(err) {
  try {
    // Algunos errores del SDK exponen headers como Map-like
    if (err?.headers && typeof err.headers.get === "function") {
      const h = err.headers.get("Retry-After") || err.headers.get("retry-after");
      if (h) return Number(h);
    }
    // Algunos payloads devuelven retry_after en body
    if (err?.error?.retry_after) return Number(err.error.retry_after);
  } catch (e) { /* ignore */ }
  return null;
}

function isRateLimit(err) {
  const status = err?.status || err?.error?.status || null;
  const type = err?.code || err?.error?.code || err?.error?.type || err?.type || null;
  const msg = (err?.message || "").toLowerCase();
  if (status === 429) return true;
  if (type === "insufficient_quota" || type === "rate_limit" || /rate[_ -]?limit/.test(String(type))) return true;
  if (msg.includes("rate limit") || msg.includes("too many requests")) return true;
  return false;
}

function isInsufficientQuota(err) {
  const type = err?.code || err?.error?.code || err?.error?.type || null;
  return type === "insufficient_quota" || (err?.message || "").toLowerCase().includes("insufficient_quota");
}

function isTransientServerError(status, err) {
  // reintentar para 502/503/504 y timeouts/connection resets
  if ([502, 503, 504].includes(status)) return true;
  const msg = (err?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnreset") || msg.includes("network")) return true;
  return false;
}

/**
 * runModel con AbortController + retries sólo para errores transitorios
 */
export async function runModel(messages, opts = {}) {
  const max_output_tokens = opts.max_output_tokens ?? 350;
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.8;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  // wrapper que realiza la petición con signal (abortable)
  async function singleCall(modelName, attemptSignal) {
    return client.responses.create({
      model: modelName,
      input: messages,
      max_output_tokens,
      temperature,
      // Nota: si tu versión del SDK no soporta `signal`, quita ese parámetro.
      // En la mayoría de versiones modernas se acepta.
      ...(attemptSignal ? { signal: attemptSignal } : {}),
    });
  }

  // intento principal con retries sólo para errores transitorios
  const maxRetries = 3;
  let attempt = 0;
  let lastErr = null;

  while (attempt <= maxRetries) {
    // crear AbortController para este intento
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const resp = await singleCall(MODEL_PRIMARY, controller?.signal);
      if (timeout) clearTimeout(timeout);
      return { ok: true, response: resp, usedFallback: false };
    } catch (err) {
      if (timeout) clearTimeout(timeout);
      lastErr = err;

      // Si es rate limit o insufficient_quota -> devolver inmediatamente info de rate_limit
      if (isRateLimit(err) || isInsufficientQuota(err)) {
        const retryAfter = extractRetryAfter(err) || null;
        return {
          ok: false,
          code: "rate_limit",
          status: 429,
          retryAfter,
          message: err?.message || String(err),
        };
      }

      const status = err?.status || err?.error?.status || null;

      // Si es error transitorio -> reintentar con backoff exponencial
      if (isTransientServerError(status, err) && attempt < maxRetries) {
        const backoff = Math.round(500 * Math.pow(2, attempt)); // 500ms, 1s, 2s...
        await new Promise((r) => setTimeout(r, backoff));
        attempt++;
        continue; // reintento en PRIMARY
      }

      // Si no es transitorio o se acabaron reintentos -> intentar fallback ONCE
      break;
    }
  } // end while

  // Si llegamos aquí, intentar fallback una vez (sin reintentos agresivos)
  try {
    const controller2 = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout2 = controller2 ? setTimeout(() => controller2.abort(), timeoutMs) : null;
    const resp2 = await singleCall(MODEL_FALLBACK, controller2?.signal);
    if (timeout2) clearTimeout(timeout2);
    return { ok: true, response: resp2, usedFallback: true };
  } catch (err2) {
    // Si fallback devuelve rate_limit -> propagar como rate_limit
    if (isRateLimit(err2) || isInsufficientQuota(err2)) {
      const retryAfter2 = extractRetryAfter(err2) || null;
      return {
        ok: false,
        code: "rate_limit",
        status: 429,
        retryAfter: retryAfter2,
        message: err2?.message || String(err2),
      };
    }

    // si fue timeout o transitorio, indicalo como tal (no mapear a rate_limit)
    const status2 = err2?.status || err2?.error?.status || null;
    const msg2 = err2?.message || String(err2);

    return {
      ok: false,
      code: "openai_error",
      status: status2 || 500,
      message: msg2,
    };
  }
}
