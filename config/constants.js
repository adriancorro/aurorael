export const MODEL_PRIMARY = "gpt-4.1-mini";     // estable + barato
export const MODEL_FALLBACK = "gpt-4o-mini";     // barato + muy rápido
export const MAX_HISTORY = 50;
export const MAX_CHARS_USER = 9000;
export const MAX_CHARS_ASSISTANT = 9000;
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 72;
export const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY || "";
export const OPENAI_KEY = process.env.OPENAI_API_KEY;
export const ALLOWED_ORIGINS = [
  "https://aurorael.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
