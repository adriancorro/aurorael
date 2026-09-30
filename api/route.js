import { corsHeaders } from "../utils/cors.js";
import {
  normalizeText,
  adaptiveTruncate,
  prepareHistory,
} from "../utils/textUtils.js";
import { getOrCreateSession, pushHistory } from "../services/sessionService.js";
import { runModel } from "../services/modelService.js";
import { KEYWORDS } from "../config/keywords.js";
import { SYSTEM_PROMPT } from "../config/constants.js";

let concurrentRequests = 0;
const MAX_CONCURRENT = 6;



function extractTextFromResponse(resp) {
  if (!resp) return "";

  if (typeof resp.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text.trim();
  }

  if (Array.isArray(resp.output)) {
    for (const block of resp.output) {
      if (!Array.isArray(block?.content)) continue;
      for (const item of block.content) {
        if (typeof item?.text === "string" && item.text.trim()) {
          return item.text.trim();
        }
      }
    }
  }

  const chatText = resp?.choices?.[0]?.message?.content;
  return typeof chatText === "string" ? chatText.trim() : "";
}

function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  if (concurrentRequests >= MAX_CONCURRENT) {
    return jsonResponse(
      { error: "Server busy — try again later" },
      429,
      headers,
    );
  }

  concurrentRequests++;

  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    const sessionId = String(body.sessionId || "").trim();
    const { id, session } = getOrCreateSession(sessionId);

    if (!prompt) {
      return jsonResponse({ error: "Prompt vacío", sessionId: id }, 400, headers);
    }

    if (!SYSTEM_PROMPT) {
      console.error("[Aurorael] Missing environment variable: AURORAEL_SYSTEM_PROMPT");
      return jsonResponse(
        { error: "Server configuration error" },
        500,
        headers,
      );
    }

    const clean = normalizeText(prompt);
    const askAuthor = KEYWORDS.some((k) =>
      clean.includes(normalizeText(k)),
    );

    if (askAuthor) {
      return jsonResponse(
        {
          result:
            "Hey. I am Aurorael.\nIf you wish, I can share a reflective video with you.\nWhat are you thinking about?\n¿Dime, de qué te gustaría hablar?",
          videoId: "YDRId6QmNTA",
          sessionId: id,
        },
        200,
        headers,
      );
    }

    const history = prepareHistory(session.history);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: adaptiveTruncate(prompt, 1600) },
    ];

    const modelResult = await runModel(messages);

    if (!modelResult?.ok) {
      console.error("[Aurorael] Model request failed:", {
        status: modelResult?.status || 500,
        code: modelResult?.code || "unknown",
        missing: modelResult?.missing || undefined,
      });

      if (modelResult?.status === 429) {
        const rateHeaders = { ...headers };
        if (modelResult.retryAfter) {
          rateHeaders["Retry-After"] = String(modelResult.retryAfter);
        }
        return jsonResponse(
          { error: "Rate limit or quota exceeded. Try later." },
          429,
          rateHeaders,
        );
      }

     return jsonResponse(
       {
         error: "Model service error",
         code: modelResult?.code || "unknown_model_error",
         missing: modelResult?.missing || [],
       },
       modelResult?.status || 500,
       headers,
     );
    }

    const text = extractTextFromResponse(modelResult.response);

    if (!text) {
      console.error("[Aurorael] Empty model response.");
      return jsonResponse({ error: "Empty model response" }, 502, headers);
    }

    pushHistory(session, "user", prompt);
    pushHistory(session, "assistant", text);

    return jsonResponse(
      { result: text, sessionId: id },
      200,
      headers,
    );
  } catch (error) {
    console.error("[Aurorael] Request processing error:", error?.message || error);
    return jsonResponse({ error: "Internal server error" }, 500, headers);
  } finally {
    concurrentRequests = Math.max(0, concurrentRequests - 1);
  }
}

export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      status: "OK",
      service: "aurorael",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    },
  );
}

console.log("ENV CHECK", {
  urlExists: !!process.env.AI_API_URL,
  keyExists: !!process.env.AI_API_KEY,
  modelExists: !!process.env.AI_MODEL_PRIMARY,
});
