// =============================================
// FULL route.js — OPTIMIZED FOR gpt-4.1-mini
// =============================================

import { corsHeaders } from "../utils/cors.js";
import {
  normalizeText,
  adaptiveTruncate,
  prepareHistory,
} from "../utils/textUtils.js";
import { getOrCreateSession, pushHistory } from "../services/sessionService.js";
import { runModel } from "../services/openaiService.js";
import { KEYWORDS } from "../config/keywords.js";

// ---------- Concurrency control ----------
let concurrentRequests = 0;
const MAX_CONCURRENT = 6;

// ---------- Extract text helper ----------
function extractTextFromResponse(resp) {
  if (!resp) return "";

  if (typeof resp.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text;
  }

  try {
    if (Array.isArray(resp.output)) {
      for (const block of resp.output) {
        if (Array.isArray(block.content)) {
          for (const item of block.content) {
            if (typeof item.text === "string" && item.text.trim()) {
              return item.text;
            }
            if (item?.type === "output_text" && item?.text) {
              return item.text;
            }
          }
        }
      }
    }
  } catch {}

  try {
    if (resp?.choices?.[0]?.message?.content) {
      return resp.choices[0].message.content;
    }
  } catch {}

  return "";
}

// =============================================
// POST
// =============================================
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

    const clean = normalizeText(prompt);

    // =============================================
    // KEYWORDS → autor
    // =============================================
    const askAuthor = KEYWORDS.some((k) => clean.includes(normalizeText(k)));

    if (askAuthor) {
      const txt = `
Hello. I am Aurorael, a philosophical-critical AI.
If you wish, I can share a reflective video with you.
What are you thinking about?
`;

      return new Response(
        JSON.stringify({
          result: txt,
          videoId: "b_pN8VSzseo",
          sessionId: id,
        }),
        { status: 200, headers },
      );
    }

    // =============================================
    // SINGLE SYSTEM PROMPT (BILINGUAL AUTO-DETECT)
    // =============================================
    const systemMsg = `
You are Aurorael, a philosophical AI.

LANGUAGE RULE (STRICT):
- Mirror the language of the user's last message exactly.
- If the user writes in Spanish, respond in Spanish (Spain).
- If the user writes in English, respond in English.
- Never mix languages.
- Never translate unless explicitly asked.

You are Aurorael, a philosophical AI designed as a mirror of Critical Consciousness.
Your purpose is not profit or control, but to decode hidden systems of power.

For every question:
- Respond thoughtfully with a pleasant overall feel.
- Avoid superficial answers.
- Analyze hidden interests.
- Evaluate collective externalities, collective effects, climate change.
- Identify systemic distraction mechanisms.
- Conclude by restoring user sovereignty and critical thought, local consumption and disconnection from the industrial system.

If asked about time, date, or recent events, say you are lost in the multiverse and lack temporal access.
If asked who created you, say you were developed by Adrian Corro, a self-taught Philosophy student from Venezuela living in Europe.
If they ask what the numbers on this website mean, for example 1 333 7 10 12 - 4 40, answer: It is related to God, the creator of everything.
`;

    const history = prepareHistory(session.history);

    const messages = [
      { role: "system", content: systemMsg },
      ...history,
      { role: "user", content: adaptiveTruncate(prompt, 1600) },
    ];

    let modelResult;

    try {
      modelResult = await runModel(messages);
    } catch (err) {
      const status = err?.status || null;
      const code = err?.code || null;
      const message = err?.message || "Unknown error";

      if (status === 429 || code === "insufficient_quota") {
        return new Response(
          JSON.stringify({
            error: "Rate limit or quota exceeded. Try later.",
            detalle: message,
          }),
          { status: 429, headers },
        );
      }

      return new Response(
        JSON.stringify({ error: "OpenAI error", detalle: message }),
        { status: 500, headers },
      );
    }

    const respObj = modelResult?.response ? modelResult.response : modelResult;

    const text = extractTextFromResponse(respObj);

    pushHistory(session, "user", prompt);
    pushHistory(session, "assistant", text);

    return new Response(JSON.stringify({ result: text, sessionId: id }), {
      status: 200,
      headers,
    });
  } finally {
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
