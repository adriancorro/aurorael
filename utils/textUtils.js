import {
  MAX_CHARS_USER,
  MAX_CHARS_ASSISTANT,
  MAX_HISTORY,
} from "../config/constants.js";

export function normalizeText(t = "") {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-\u036f]/g, "");
}

export function adaptiveTruncate(text, maxChars) {
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

export function prepareHistory(history) {
  return history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role,
    content:
      m.role === "assistant"
        ? adaptiveTruncate(m.content, MAX_CHARS_ASSISTANT)
        : adaptiveTruncate(m.content, MAX_CHARS_USER),
  }));
}
