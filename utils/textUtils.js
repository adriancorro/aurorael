import {
  MAX_CHARS_USER,
  MAX_CHARS_ASSISTANT,
  MAX_HISTORY,
} from "../config/constants.js";

export function normalizeText(t = "") {
  return String(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function adaptiveTruncate(text, maxChars) {
  if (!text) return "";
  const value = String(text);
  return value.length > maxChars ? value.slice(0, maxChars) + "…" : value;
}

export function prepareHistory(history = []) {
  return history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role,
    content:
      m.role === "assistant"
        ? adaptiveTruncate(m.content, MAX_CHARS_ASSISTANT)
        : adaptiveTruncate(m.content, MAX_CHARS_USER),
  }));
}
