export const MODEL_PRIMARY = (process.env.AI_MODEL_PRIMARY || "").trim();
export const MODEL_FALLBACK = (process.env.AI_MODEL_FALLBACK || "").trim();
export const AI_API_URL = (process.env.AI_API_URL || "").trim();
export const AI_API_KEY = (process.env.AI_API_KEY || "").trim();
export const SYSTEM_PROMPT = (process.env.AURORAEL_SYSTEM_PROMPT || "").trim();

export const MAX_HISTORY = 50;
export const MAX_CHARS_USER = 9000;
export const MAX_CHARS_ASSISTANT = 9000;
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 72;

export const ALLOWED_ORIGINS = [
  "https://aurorael.vercel.app",
  "https://aurorael.com",
  "https://www.aurorael.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
