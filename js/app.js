const API_URL = `${window.location.origin}/api/route`;

(function particlesBackground() {
  const canvas = document.getElementById("particlesCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  }

  resize();
  addEventListener("resize", resize);

  const particles = Array.from(
    { length: Math.max(40, Math.round((innerWidth * innerHeight) / 80000)) },
    () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.8 + 0.6,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
    }),
  );

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -20) p.x = canvas.width + 20;
      if (p.x > canvas.width + 20) p.x = -20;
      if (p.y < -20) p.y = canvas.height + 20;
      if (p.y > canvas.height + 20) p.y = -20;
      ctx.beginPath();
      ctx.fillStyle = "rgba(180,255,255,.75)";
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  draw();
})();

function getSessionId() {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    id = crypto?.randomUUID?.() || `sess-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("sessionId", id);
  }
  return id;
}

function showBanner(message, timeout = 6000) {
  const banner = document.getElementById("banner");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.add("show");
  if (timeout) setTimeout(() => banner.classList.remove("show"), timeout);
}

export function renderVideo(videoId) {
  const container = document.getElementById("videoContainer");
  if (!container) return;
  container.innerHTML = "";
  if (!videoId) return;

  const wrap = document.createElement("div");
  wrap.className = "video-wrap";

  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1&playsinline=1`;
  iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  iframe.allowFullscreen = true;
  iframe.title = "Aurorael video";
  wrap.appendChild(iframe);
  container.appendChild(wrap);
}

async function sendPrompt(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, sessionId: getSessionId() }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (data.sessionId) localStorage.setItem("sessionId", data.sessionId);

    if (!response.ok) {
      return {
        error: data.error || `Server returned ${response.status}`,
        status: response.status,
      };
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      return { error: "La solicitud tardó demasiado.", status: 408 };
    }
    return { error: "Error de red al conectar con el servidor." };
  } finally {
    clearTimeout(timeout);
  }
}

function typeText(element, text, speed = 6) {
  if (!element) return;
  element.textContent = "";
  let i = 0;
  const timer = setInterval(() => {
    element.textContent += text.charAt(i++);
    if (i >= text.length) clearInterval(timer);
  }, speed);
}

const button = document.getElementById("sendBtn");
const textarea = document.getElementById("prompt");
const responseBox = document.getElementById("respuesta");

async function submit() {
  const prompt = textarea?.value?.trim();
  if (!prompt) {
    responseBox.textContent = "I'm here to talk to you";
    return;
  }

  textarea.disabled = true;
  button.disabled = true;
  responseBox.textContent = "🌀...";
  renderVideo(null);

  const data = await sendPrompt(prompt);

  if (data?.error) {
    responseBox.textContent = data.error;
    if (data.status === 429) showBanner("Servidor saturado. Inténtalo de nuevo en un momento.");
  } else if (data?.result) {
    textarea.value = "";
    typeText(responseBox, data.result);
    if (data.videoId) renderVideo(data.videoId);
  } else {
    responseBox.textContent = "Respuesta inesperada del servidor.";
  }

  textarea.disabled = false;
  button.disabled = false;
  textarea.focus();
}

button?.addEventListener("click", submit);
textarea?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
});

if (textarea && !localStorage.getItem("seenWelcome")) {
  textarea.value = "777";
  localStorage.setItem("seenWelcome", "1");
}
