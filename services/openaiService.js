// services/openaiService.js
// Servicio central para llamar a OpenAI Responses API con fallback y manejo de 429/insufficient_quota

import OpenAI from "openai";
import { MODEL_PRIMARY, MODEL_FALLBACK, OPENAI_KEY } from "../config/constants.js";

if (!OPENAI_KEY) {
  console.warn("Warning: OPENAI_API_KEY no configurada en environment variables.");
}

const client = new OpenAI({ apiKey: OPENAI_KEY });

/**
 * runModel(messages, opts)
 *
 * - messages: array/obj con el contenido que enviarás a Responses API (puede ser array de mensajes o cualquier input aceptado)
 * - opts: { max_output_tokens, temperature } opcionales
 *
 * Retorna un objeto estructurado en lugar de lanzar en caso de rate-limit:
 * - { ok: true, response, usedFallback: false }
 * - { ok: true, response, usedFallback: true }  (si se usó fallback)
 * - { ok: false, code: "rate_limit", status: 429, retryAfter: Number|null, message }
 * - { ok: false, code: "openai_error", status, message }
 */
export async function runModel(messages, opts = {}) {
  const max_output_tokens = opts.max_output_tokens ?? 350;
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.8;

  // Helper para extraer Retry-After de headers si existe
  function getRetryAfterFromErr(err) {
    try {
      if (err?.headers && typeof err.headers.get === "function") {
        const ra = err.headers.get("Retry-After") || err.headers.get("retry-after");
        if (ra) return Number(ra);
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  // Intento principal con MODEL_PRIMARY
  try {
    const resp = await client.responses.create({
      model: MODEL_PRIMARY,
      input: messages,
      max_output_tokens,
      temperature,
    });
    return { ok: true, response: resp, usedFallback: false };
  } catch (err) {
    // Detectar rate-limit / insufficient_quota
    const status = err?.status || err?.error?.status || null;
    const code = err?.code || err?.error?.code || err?.error?.type || null;
    const message = err?.message || (err?.error && err.error.message) || String(err);

    // Si es rate limit / cuota insuficiente -> devolver info estructurada para que el caller devuelva 429
    if (status === 429 || code === "insufficient_quota" || code === "rate_limit") {
      const retryAfter = getRetryAfterFromErr(err) || null;
      return {
        ok: false,
        code: "rate_limit",
        status: 429,
        retryAfter,
        message,
      };
    }

    // Para otros errores intentamos una vez con fallback (MODEL_FALLBACK)
    try {
      const resp2 = await client.responses.create({
        model: MODEL_FALLBACK,
        input: messages,
        max_output_tokens,
        temperature,
      });
      return { ok: true, response: resp2, usedFallback: true };
    } catch (err2) {
      // Si el fallback falla, intentar detectar si fue rate-limit también y devolver info
      const status2 = err2?.status || err2?.error?.status || null;
      const code2 = err2?.code || err2?.error?.code || err2?.error?.type || null;
      const message2 = err2?.message || (err2?.error && err2.error.message) || String(err2);

      if (status2 === 429 || code2 === "insufficient_quota" || code2 === "rate_limit") {
        const retryAfter2 = getRetryAfterFromErr(err2) || null;
        return {
          ok: false,
          code: "rate_limit",
          status: 429,
         retryAfter: retryAfter2,
          message: message2,
        };
      }

      // Si todo falla, devolver error estructurado para que el caller lo transforme en 500
      return {
        ok: false,
        code: "openai_error",
        status: status2 || 500,
        message: message2,
      };
    }
  }
}
