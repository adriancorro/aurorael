import {
  AI_API_URL,
  AI_API_KEY,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
} from "../config/constants.js";

function missingConfiguration() {
  const missing = [];
  if (!AI_API_URL) missing.push("AI_API_URL");
  if (!AI_API_KEY) missing.push("AI_API_KEY");
  if (!MODEL_PRIMARY) missing.push("AI_MODEL_PRIMARY");
  return missing;
}

function getRetryAfter(headers) {
  const value = headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

async function requestModel(model, messages, opts) {
  let response;

  try {
    response = await fetch(AI_API_URL, {
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
  } catch (error) {
    console.error("[Aurorael] Model network error:", error?.message || error);
    return {
      ok: false,
      status: 502,
      code: "network_error",
    };
  }

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const upstreamCode =
      data?.error?.code ||
      data?.error?.type ||
      `http_${response.status}`;

    // Safe diagnostic: never log the API key or complete request payload.
    console.error("[Aurorael] Model upstream error:", {
      status: response.status,
      code: upstreamCode,
      model,
    });

    return {
      ok: false,
      status: response.status,
      code: upstreamCode,
      retryAfter: getRetryAfter(response.headers),
    };
  }

  if (!data) {
    console.error("[Aurorael] Model returned a non-JSON response.");
    return {
      ok: false,
      status: 502,
      code: "invalid_upstream_response",
    };
  }

  return { ok: true, response: data };
}

export async function runModel(messages, opts = {}) {
  const missing = missingConfiguration();

  if (missing.length) {
    console.error("[Aurorael] Missing environment variables:", missing.join(", "));
    return {
      ok: false,
      status: 500,
      code: "service_not_configured",
      missing,
    };
  }

  const requestOptions = {
    max_output_tokens: opts.max_output_tokens ?? 1000,
    temperature:
      typeof opts.temperature === "number" ? opts.temperature : 0.8,
  };

  const primary = await requestModel(
    MODEL_PRIMARY,
    messages,
    requestOptions,
  );

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
