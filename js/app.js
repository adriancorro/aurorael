const API_URL = `${window.location.origin}/api/route`;

function getSessionId() {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    try {
      id = crypto.randomUUID();
    } catch {
      id = "sess-" + Math.random().toString(36).slice(2, 12);
    }
    localStorage.setItem("sessionId", id);
  }
  return id;
}

function showBanner(message, timeout = 6000) {
  const banner = document.getElementById("banner");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.toggle("show", Boolean(message));
  if (message && timeout) {
    setTimeout(() => banner.classList.remove("show"), timeout);
  }
}

function renderVideo(videoId) {
  const container = document.getElementById("videoContainer");
  if (!container) return;
  container.innerHTML = "";
  if (!videoId) return;

  const frame = document.createElement("iframe");
  frame.src =
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` +
    "?rel=0&modestbranding=1&playsinline=1";
  frame.title = "Aurorael video";
  frame.loading = "lazy";
  frame.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
  frame.allowFullscreen = true;
  container.appendChild(frame);
}

async function sendPrompt(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        sessionId: getSessionId(),
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({
      error: `Server returned ${response.status}`,
    }));

    if (!response.ok) {
      return {
        ...data,
        status: response.status,
      };
    }

    if (data.sessionId) {
      localStorage.setItem("sessionId", data.sessionId);
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      return { error: "Request timed out", status: 504 };
    }
    return { error: "Network error", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function setupParticles() {
  const canvas = document.getElementById("particlesCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const count = Math.max(
      35,
      Math.round((canvas.width * canvas.height) / 70000),
    );
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.4,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.fillStyle = "rgba(190,255,255,.7)";
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

setupParticles();

const button = document.getElementById("sendBtn");
const textarea = document.getElementById("prompt");
const responseBox = document.getElementById("respuesta");

async function submit() {
  const prompt = textarea?.value?.trim() || "";

  if (!prompt) {
    responseBox.textContent = "I'm here to talk to you.";
    return;
  }

  textarea.disabled = true;
  button.disabled = true;
  responseBox.textContent = "🌀...";
  showBanner("", 0);

  const data = await sendPrompt(prompt);

  if (data?.error) {
    const suffix = data?.code ? ` (${data.code})` : "";
    responseBox.textContent = `${data.error}${suffix}`;
    showBanner(
      data.status === 429
        ? "Server busy or quota exceeded. Try again later."
        : "The model service could not answer.",
    );
  } else {
    responseBox.textContent = data?.result || "No response.";
    renderVideo(data?.videoId);
    textarea.value = "";
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
