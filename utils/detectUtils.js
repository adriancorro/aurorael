export function detectLanguage(text = "") {
  const lower = text.toLowerCase();
  const en = ["who", "what", "how", "why", "time", "weather", "date"];
  const es = ["que", "como", "quien", "hora", "clima", "fecha", "tiempo"];
  const isEn =
    en.some((w) => lower.includes(w)) && !es.some((w) => lower.includes(w));
  return isEn ? "en" : "es";
}

export function extractLocation(prompt = "") {
  const lower = prompt.toLowerCase();
  const e1 = lower.match(/\ben\s+([a-záéíóúñü0-9 ,.-]{2,80})/i);
  const e2 = lower.match(/\bin\s+([A-Za-z0-9 ,.-]{2,80})/i);
  const m = e1 || e2;
  return m ? m[1].trim().replace(/[?¡!]+$/, "") : null;
}

export function isWeatherQuestion(t = "") {
  return /clima|temperatura|frio|frío|weather|cold|hot/.test(t.toLowerCase());
}
export function isTimeQuestion(t = "") {
  return /hora|what time|current time/.test(t.toLowerCase());
}
export function isDateQuestion(t = "") {
  return /fecha|qué día|what date|today/.test(t.toLowerCase());
}
