import OpenAI from "openai";

//  Lista de dominios permitidos
const allowedOrigins = [
  "https://www.hegel2052.com",
  "https://hegel2052.com",
  "https://hegel2052.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

//  Helper CORS
function corsHeaders(origin) {
  const isAllowed = allowedOrigins.includes(origin);
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": isAllowed ? origin : allowedOrigins[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

//  Normalizador universal (quita tildes, mayúsculas, etc.)
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

//  Detección básica del idioma del prompt
function detectLanguage(text) {
  const englishRegex = /[a-z]/;
  const spanishWords = ["que", "como", "quien", "donde", "por", "cuando", "app", "pagina", "inteligencia"];
  const englishWords = ["who", "what", "how", "when", "why", "app", "website", "ai"];
  const lower = text.toLowerCase();

  const isEnglish = englishWords.some((w) => lower.includes(w)) && !spanishWords.some((w) => lower.includes(w));
  return isEnglish ? "en" : "es";
}

//  Endpoint principal (POST)
export async function POST(req) {
  try {
    const origin = req.headers.get("origin") || "";
    const { prompt } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Falta el prompt" }), {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    //  Cargar palabras clave dinámicamente
    const { palabrasClave } = await import(`${process.cwd()}/api/keywords.js`);

    //  Normalizar todas las palabras clave
    const normalizedKeywords = palabrasClave.map((f) => normalizeText(f));
    const normalizedPrompt = normalizeText(prompt);

    //  Detectar si pregunta por el autor
    const preguntaAutor = normalizedKeywords.some((frase) =>
      normalizedPrompt.includes(frase)
    );

    if (preguntaAutor) {
      const respuestaAutor =
        "Esta aplicación fue creada por **Adrian Corro** ([GitHub](https://github.com/adriancorro)) con la tecnología de **OpenAI.";
      return new Response(JSON.stringify({ result: respuestaAutor }), {
        status: 200,
        headers: corsHeaders(origin),
      });
    }

    //  Detectar idioma del usuario
    const idioma = detectLanguage(prompt);

    //  Inicializar cliente OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    //  Configurar prompt base según idioma
    const systemMessage =
      idioma === "es"
        ? "Respóndeme como si fueras Hegel viviendo en el siglo XXI, reflexionando sobre la sociedad contemporánea y la dialéctica del espíritu. Responde en español, con profundidad y elegancia filosófica."
        : "Answer as if you were Hegel living in the 21st century, reflecting on contemporary society and the dialectic of spirit. Respond in English, with philosophical depth and clarity.";

    //  Llamada a la API de OpenAI
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 800,
    });

    const respuesta =
      completion.choices?.[0]?.message?.content || "Sin respuesta generada.";

    //  Responder correctamente
    return new Response(JSON.stringify({ result: respuesta }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (error) {
    console.error(" Error interno en /api/route:", error);
    return new Response(
      JSON.stringify({
        error: "Error interno del servidor",
        detalle: error.message,
      }),
      { status: 500, headers: corsHeaders("") }
    );
  }
}

//  GET (prueba)
export async function GET() {
  return new Response(
    JSON.stringify({
      status:
        " API funcionando correctamente. Usa método POST para enviar prompts.",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

//  OPTIONS (CORS preflight)
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
