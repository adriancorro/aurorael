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
    return resp.output_text;
  }

  if (Array.isArray(resp.output)) {
    for (const block of resp.output) {
      if (!Array.isArray(block?.content)) continue;
      for (const item of block.content) {
        if (typeof item?.text === "string" && item.text.trim()) {
          return item.text;
        }
      }
    }
  }

  const chatText = resp?.choices?.[0]?.message?.content;
  return typeof chatText === "string" ? chatText : "";
}

export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  if (concurrentRequests >= MAX_CONCURRENT) {
    return new Response(
      JSON.stringify({ error: "Server busy — try again later" }),
      { status: 429, headers },
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
        { status: 400, headers },
      );
    }

    if (!SYSTEM_PROMPT) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }

    const clean = normalizeText(prompt);
    const askAuthor = KEYWORDS.some((k) => clean.includes(normalizeText(k)));

    if (askAuthor) {
      const txt = `
Hey. I am Aurorael.
If you wish, I can share a reflective video with you.
What are you thinking about?
¿Dime, de qué te gustaria hablar?
`;

      return new Response(
        JSON.stringify({
          result: txt,
          videoId: "YDRId6QmNTA",
          sessionId: id,
        }),
        { status: 200, headers },
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
      if (modelResult?.status === 429) {
        const rateHeaders = { ...headers };
        if (modelResult.retryAfter) {
          rateHeaders["Retry-After"] = String(modelResult.retryAfter);
        }
        return new Response(
          JSON.stringify({ error: "Rate limit or quota exceeded. Try later." }),
          { status: 429, headers: rateHeaders },
        );
      }

      return new Response(
        JSON.stringify({ error: "Model service error" }),
        { status: modelResult?.status || 500, headers },
      );
    }

    const text = extractTextFromResponse(modelResult.response);

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Empty model response" }),
        { status: 502, headers },
      );
    }

    pushHistory(session, "user", prompt);
    pushHistory(session, "assistant", text);

    return new Response(JSON.stringify({ result: text, sessionId: id }), {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Request processing error:", error?.message || error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers,
    });
  } finally {
    concurrentRequests = Math.max(0, concurrentRequests - 1);
  }
}

export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET() {
  return new Response(JSON.stringify({ status: "OK" }), {
    status: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
