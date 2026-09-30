import { OPENWEATHER_KEY } from "../config/constants.js";

export async function fetchWeather(location) {
  if (!OPENWEATHER_KEY) throw new Error("OPENWEATHER_API_KEY no configurada");

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
    location
  )}&units=metric&appid=${OPENWEATHER_KEY}`;

  const r = await fetch(url);
  const txt = await r.text();
  let j;

  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`Weather API no JSON: ${r.status}`);
  }

  if (!r.ok) throw new Error(`Weather API error: ${j?.message}`);

  return {
    name: j.name,
    country: j.sys?.country,
    temp: j.main?.temp,
    feels: j.main?.feels_like,
    desc: j.weather?.[0]?.description,
    raw: j,
  };
}
