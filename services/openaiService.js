// services/openaiService.js
// Versión minimalista, robusta y compatible: timeout por Promise.race, normalización de input,
// un intento en primary y un intento en fallback, sin reintentos automáticos.

import OpenAI from "openai";
import { MODEL_PRIMARY, MODEL_FALLBACK, OPENAI_KEY } from "../config/constants.js";

if (!OPENAI_KEY) {
  console.warn("Warning: OPENAI_API_KEY no configurada en environment variables.");
}

const client = new OpenAI({ apiKey: OPENAI_KEY });

// Config
const DEFAULT_TIMEOUT_MS = 30_000; // 30s
const DEFAULT_MAX_OUTPUT_TOKENS = 350;

// Helpers
function normalizeInputForResponses(raw) {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "";
    const first = raw[0];
    if (first && typeof first === "object" && ("role" in first || "content" in first || "message" in first)) {
      return raw.map((m) => {
        const role = m.role ? String(m.role) : "user";
        const content = m.content ?? m.message ?? "";
        return `${role}: ${String(content)}`;
      });
    }
    return raw.map((x) => String(x));
  }
  try {
    return JSON.stringify(raw);
  } catch (e) {
    return String(raw);
  }
}

function extractRetryAfterFromErr(err) {
  try {
    if (err?.headers && typeof err.headers.get === "function") {
      const ra = err.headers.get("Retry-After") || err.headers.get("retry-after");
      if (ra) return Number(ra);
    }
    if (err?.error?.retry_after) return Number(err.error.retry_after);
    if (err?.response?.headers) {
      const h = err.response.headers["retry-after"] || err.response.headers["Retry-After"];
      if (h) return Number(h);
    }
  } catch (e) {}
  return null;
}

function isRateLimit(err) {
  const status = err?.status || err?.error?.status || (err?.response && err.response.status) || null;
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

// timeout wrapper using Promise.race for maximum compatibility
function withTimeout(promise, ms) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeoutPromise]);
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
 * - { ok: false, code: "openai_error", status, message, raw }
 */
export async function runModel(messages, opts = {}) {
  const max_output_tokens = opts.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.8;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const safeInput = normalizeInputForResponses(messages);

  // Wrapper para hacer la llamada con timeout
  async function callModelOnce(modelName) {
    try {
      const promise = client.responses.create({
        model: modelName,
        input: safeInput,
        max_output_tokens,
        temperature,
      });
      const res = await withTimeout(promise, timeoutMs);
      return { ok: true, response: res };
    } catch (err) {
      // extraer info útil
      const status = err?.status || err?.error?.status || (err?.response && err.response.status) || null;
      let raw = null;
      try {
        if (err?.response && typeof err.response.text === "function") {
          raw = await err.response.text();
        } else if (err?.error) {
          raw = JSON.stringify(err.error);
        } else {
          raw = String(err);
        }
      } catch (e) {
        raw = String(err);
      }
      return { ok: false, error: err, status, raw };
    }
  }

  // 1) Intento PRIMARY una vez
  const primary = await callModelOnce(MODEL_PRIMARY);
  if (primary.ok) {
    return { ok: true, response: primary.response, usedFallback: false };
  }

  // Si PRIMARY falló y es rate limit -> devolver rate_limit
  if (isRateLimit(primary.error)) {
    const retryAfter = extractRetryAfterFromErr(primary.error) || null;
    return {
      ok: false,
      code: "rate_limit",
      status: 429,
      retryAfter,
      message: primary.error?.message || String(primary.error),
    };
  }

  // 2) Intento FALLBACK una vez
  const fallback = await callModelOnce(MODEL_FALLBACK);
  if (fallback.ok) {
    return { ok: true, response: fallback.response, usedFallback: true };
  }

  // Si FALLBACK devolvió rate_limit -> propagar como rate_limit
  if (isRateLimit(fallback.error)) {
    const retryAfter2 = extractRetryAfterFromErr(fallback.error) || null;
    return {
      ok: false,
      code: "rate_limit",
      status: 429,
      retryAfter: retryAfter2,
      message: fallback.error?.message || String(fallback.error),
    };
  }

  // Si ambos fallaron por otras razones -> devolver openai_error con detalles
  return {
    ok: false,
    code: "openai_error",
    status: fallback.status || primary.status || 500,
    message: fallback.error?.message || primary.error?.message || "Unknown error",
    raw: fallback.raw || primary.raw || null,
  };
}
