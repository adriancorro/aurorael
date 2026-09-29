import {
  AI_API_URL,
  AI_API_KEY,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
} from "../config/constants.js";

function configurationReady() {
  return Boolean(AI_API_URL && AI_API_KEY && MODEL_PRIMARY);
}

function getRetryAfter(headers) {
  const value = headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

async function requestModel(model, messages, opts) {
  const response = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: messages,
      max_output_tokens: opts.max_output_tokens,
      temperature: opts.temperature,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: data?.error?.code || data?.error?.type || "upstream_error",
      retryAfter: getRetryAfter(response.headers),
    };
  }

  return { ok: true, response: data };
}

export async function runModel(messages, opts = {}) {
  if (!configurationReady()) {
    return { ok: false, status: 500, code: "service_not_configured" };
  }

  const requestOptions = {
    max_output_tokens: opts.max_output_tokens ?? 1000,
    temperature:
      typeof opts.temperature === "number" ? opts.temperature : 0.8,
  };

  const primary = await requestModel(MODEL_PRIMARY, messages, requestOptions);
  if (primary.ok) {
    return { ...primary, usedFallback: false };
  }

  if (primary.status === 429) {
    return primary;
  }

  if (MODEL_FALLBACK && MODEL_FALLBACK !== MODEL_PRIMARY) {
    const fallback = await requestModel(
      MODEL_FALLBACK,
      messages,
      requestOptions,
    );
    if (fallback.ok) {
      return { ...fallback, usedFallback: true };
    }
    return fallback;
  }

  return primary;
}
