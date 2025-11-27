// js/app.js
// Módulo principal de la UI - ESM
// Asegúrate de referenciar este archivo con: <script type="module" src="js/app.js"></script>

const API_URL = `${window.location.origin}/api/route`; // ajusta si tu ruta es distinta

/* ---------------- PARTICLES BACKGROUND ---------------- */
(function () {
  const canvas = document.getElementById("particlesCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const particles = [];
  const N = Math.max(40, Math.round((innerWidth * innerHeight) / 80000));
  for (let i = 0; i < N; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.8 + 0.6,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const g = ctx.createRadialGradient(
      canvas.width * 0.5,
      canvas.height * 0.3,
      50,
      canvas.width * 0.5,
      canvas.height * 0.3,
      Math.max(canvas.width, canvas.height)
    );
    g.addColorStop(0, "rgba(0,12,30,0)");
    g.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -50) p.x = canvas.width + 50;
      if (p.x > canvas.width + 50) p.x = -50;
      if (p.y < -50) p.y = canvas.height + 50;
      if (p.y > canvas.height + 50) p.y = -50;

      ctx.beginPath();
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 8);
      grad.addColorStop(0, "rgba(0,240,255,0.12)");
      grad.addColorStop(0.6, "rgba(212,92,255,0.04)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.arc(p.x, p.y, p.r * 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "rgba(180,255,255,0.95)";
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  draw();
})();

/* ---------------- Keywords loader (robusto) ---------------- */
let palabrasClave = null;
let keywordsReady = (async function loadKeywordsModule() {
  try {
    const mod = await import("/js/keywords.js");
    if (mod && Array.isArray(mod.KEYWORDS)) {
      palabrasClave = mod.KEYWORDS.map((p) => normalize(String(p)));
      return true;
    }
  } catch (e) {
    try {
      const r = await fetch("/js/keywords.js", { cache: "no-store" });
      if (!r.ok) throw new Error("fetch failed");
      const txt = await r.text();
      // intenta extraer un array si el archivo exporta la constante directamente
      const arrMatch = txt.match(
        /export\s+const\s+(\w+)\s*=\s*(\[[\s\S]*?\]);?/m
      );
      if (arrMatch && arrMatch[2]) {
        const fn = new Function("return " + arrMatch[2]);
        const arr = fn();
        if (Array.isArray(arr)) {
          palabrasClave = arr.map((p) => normalize(String(p)));
          return true;
        }
      }
    } catch (e2) {
      /* ignore */
    }
  }
  palabrasClave = null;
  return false;
})();

function normalize(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .toLowerCase()
    .trim();
}
function matchAnyKeyword(text) {
  if (!text) return false;
  if (!Array.isArray(palabrasClave) || palabrasClave.length === 0) return false;
  const n = normalize(text);
  return palabrasClave.some((k) => n.includes(k));
}

/* ---------------- VIDEO RENDER ---------------- */
export function renderVideo(videoId) {
  const videoContainer = document.getElementById("videoContainer");
  if (!videoContainer) return;
  videoContainer.innerHTML = "";
  if (!videoId) return;

  // Intento fuerte de forzar HD
  const QUALITY = "hd1080";
  // YouTube no siempre garantiza esta calidad (depende de conexión / dispositivo),
  // pero vq=hd1080 es la pista más fuerte que podemos darle desde un embed.
  const baseParams = `rel=0&modestbranding=1&playsinline=1&vq=${QUALITY}`;

  const paramsMuted = `autoplay=1&mute=1&${baseParams}`;
  const paramsUnmuted = `autoplay=1&mute=0&${baseParams}`;

  const wrap = document.createElement("div");
  wrap.className = "video-wrap";
  wrap.style.position = "relative";
  wrap.style.paddingTop = "56.25%";
  wrap.style.height = "0";
  wrap.style.overflow = "hidden";

  const iframe = document.createElement("iframe");
  iframe.frameBorder = "0";
  iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  iframe.title = "Aurorael video";
  iframe.allowFullscreen = true;
  iframe.src = `https://www.youtube.com/embed/${videoId}?${paramsMuted}`;
  iframe.style.position = "absolute";
  iframe.style.left = "0";
  iframe.style.top = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  wrap.appendChild(iframe);

  const overlay = document.createElement("div");
  overlay.className = "big-unmute";

  const instr = document.createElement("div");
  instr.className = "big-text";
  instr.textContent =
    "Pulsa para reproducir con sonido (necesario por políticas del navegador)";

  const bigBtn = document.createElement("button");
  bigBtn.textContent = "Reproducir con sonido";
  bigBtn.className = "big-unmute-btn";
  bigBtn.addEventListener("click", () => {
    // recarga con sonido activado, manteniendo la calidad pedida
    iframe.src = `https://www.youtube.com/embed/${videoId}?${paramsUnmuted}`;
    overlay.remove();
  });

  overlay.appendChild(instr);
  overlay.appendChild(bigBtn);
  wrap.appendChild(overlay);

  // controles adicionales
  const controls = document.createElement("div");
  controls.className = "video-controls";
  const openBtn = document.createElement("a");
  openBtn.href = `https://www.youtube.com/watch?v=${videoId}`;
  openBtn.target = "_blank";
  openBtn.rel = "noreferrer noopener";
  openBtn.textContent = "Abrir en YouTube";
  controls.appendChild(openBtn);
  wrap.appendChild(controls);

  videoContainer.appendChild(wrap);
}

/* ---------- sendPrompt: 3s timeout + 1 retry before assuming 429 ---------- */
async function sendPrompt(prompt, location = "", maxAttempts = 2) {
  const sessionId = getSessionId();
  const tz =
    Intl && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "";
  const body = { prompt, sessionId };
  if (location) body.location = location;
  if (tz) body.timeZone = tz;

  let attempt = 0;
  let backoff = 4500;
  const MAX_TIMEOUT = 90000; // 3s per request

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MAX_TIMEOUT);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 429) {
        const ra = res.headers.get("Retry-After");
        const retryAfter = ra ? Number(ra) : null;
        let detail = null;
        try {
          detail = await res.json().catch(() => null);
        } catch (e) {}
        return { error: "rate_limit", retryAfter, detail, status: 429 };
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => null);
        return {
          error: `Server returned ${res.status}`,
          detalle: txt,
          status: res.status,
        };
      }

      const data = await res
        .json()
        .catch(() => ({ error: "No JSON response from server" }));
      if (data.sessionId) localStorage.setItem("sessionId", data.sessionId);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        // timeout
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, backoff));
          backoff *= 1.6;
          continue;
        }
        // treat as rate limit after two timeouts
        return {
          error: "rate_limit",
          retryAfter: null,
          detail: { message: "Request timed out twice; assuming server busy." },
          status: 429,
        };
      }

      // other network error
      if (attempt >= maxAttempts) {
        return {
          error: "network",
          message: "Error de red al conectar con el servidor.",
        };
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff *= 1.6;
    }
  }
  return { error: "max_retries", message: "Máximo de reintentos alcanzado" };
}

/* ---------- Helpers: session, UI ---------- */
function getSessionId() {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    try {
      id = crypto.randomUUID();
    } catch (e) {
      id = "sess-" + Math.random().toString(36).slice(2, 10);
    }
    localStorage.setItem("sessionId", id);
  }
  return id;
}

function showBanner(msg, timeout = 6000) {
  const banner = document.getElementById("banner");
  if (!banner) return;
  banner.textContent = msg;
  banner.classList.add("show");
  if (timeout) setTimeout(() => banner.classList.remove("show"), timeout);
}

/* ---------- UI wiring (connect to sendPrompt + renderVideo) ---------- */
const btn = document.getElementById("sendBtn");
const resp = document.getElementById("respuesta");
const textarea = document.getElementById("prompt");
let expectingLocation = false;
const DEFAULT_VIDEO_ID = "jOSO3AAIUzM";

if (btn && textarea) {
  btn.addEventListener("click", async () => {
    const raw = textarea.value.trim();
    if (!raw) {
      resp.textContent = "Por favor, escríbele a Aurorael.";
      return;
    }
    try {
      await Promise.race([
        keywordsReady,
        new Promise((res) => setTimeout(res, 1200)),
      ]);
    } catch (e) {}

    const locationToSend = expectingLocation ? raw : "";
    resp.textContent = expectingLocation
      ? "🗺 Enviando ubicación..."
      : "🌀 Consultando a Aurorael...";
    textarea.disabled = true;
    btn.disabled = true;
    showBanner("", 1);

    try {
      const data = await sendPrompt(raw, locationToSend, 2);

      if (data && data.error === "rate_limit") {
        const retryAfter = data.retryAfter ?? null;
        const detailMsg =
          data.detail && (data.detail.message || data.detail.detalle)
            ? data.detail.message || data.detail.detalle
            : "";
        const msg = retryAfter
          ? `Servidor saturado (429). Reintenta en ${retryAfter}s.`
          : `Servidor saturado (429).`;
        showBanner(
          msg + (detailMsg ? " " + detailMsg : ""),
          retryAfter ? retryAfter * 1000 + 2000 : 8000
        );
        resp.textContent = msg;
        textarea.disabled = false;
        btn.disabled = false;
        expectingLocation = false;
        renderVideo(null);
        return;
      }

      if (data && data.error) {
        resp.textContent =
          data.message || data.error || "Error al procesar la solicitud.";
        textarea.disabled = false;
        btn.disabled = false;
        expectingLocation = false;
        renderVideo(null);
        return;
      }

      if (data && data.result) {
        const text = data.result;
        if (serverAsksForLocation(text)) {
          expectingLocation = true;
          textarea.placeholder = "Indica ciudad, país (ej. Madrid, España)";
          textarea.value = "";
          typeText(resp, text, 8);
          renderVideo(null);
        } else {
          expectingLocation = false;
          textarea.placeholder = "Escribe tu pregunta...";
          textarea.value = "";
          typeText(resp, text, 6);
          const keywordsAvailable =
            Array.isArray(palabrasClave) && palabrasClave.length > 0;
          const promptMatches = keywordsAvailable && matchAnyKeyword(raw);
          const resultMatches = keywordsAvailable && matchAnyKeyword(text);
          const keywordTriggered = promptMatches || resultMatches;
          if (data.videoId && (keywordTriggered || !keywordsAvailable))
            renderVideo(data.videoId);
          else if (!data.videoId && keywordTriggered)
            renderVideo(DEFAULT_VIDEO_ID);
          else renderVideo(null);
        }
        textarea.disabled = false;
        btn.disabled = false;
        return;
      }

      resp.textContent = "Respuesta inesperada del servidor.";
      textarea.disabled = false;
      btn.disabled = false;
      expectingLocation = false;
      renderVideo(null);
    } catch (e) {
      console.error(e);
      resp.textContent = "Error al conectar con el servidor.";
      expectingLocation = false;
      renderVideo(null);
      textarea.disabled = false;
      btn.disabled = false;
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      btn.click();
    }
  });
  if (!localStorage.getItem("seenWelcome")) {
    textarea.value = "¿Quién te creó?";
    localStorage.setItem("seenWelcome", "1");
  }
}

/* ---------- small UI helpers ---------- */
function typeText(el, txt, speed = 8) {
  if (!el) return;
  el.textContent = "";
  let i = 0;
  const cursor = document.createElement("span");
  cursor.style.display = "inline-block";
  cursor.style.width = "8px";
  cursor.style.height = "1em";
  cursor.style.background = "linear-gradient(90deg,#00f0ff,#d45cff)";
  cursor.style.marginLeft = "6px";
  cursor.style.borderRadius = "2px";
  el.appendChild(cursor);
  const int = setInterval(() => {
    const ch = document.createTextNode(txt.charAt(i));
    el.insertBefore(ch, cursor);
    i++;
    if (i >= txt.length) {
      clearInterval(int);
      cursor.remove();
    }
  }, speed);
}

function serverAsksForLocation(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return (
    lower.includes("¿de qué ciudad") ||
    lower.includes("indica ciudad y pa\u00eds") ||
    lower.includes("which city/country") ||
    lower.includes("please provide city and country")
  );
}