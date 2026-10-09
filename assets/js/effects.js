/* Animations et interactions de la page (hors graphiques). */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const fmt = new Intl.NumberFormat("fr-FR");

  /* ---------- Thème ---------- */
  const themeToggle = $("#themeToggle");
  const currentTheme = () =>
    document.documentElement.dataset.theme ||
    (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  themeToggle.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) { /* stockage indisponible */ }
    document.dispatchEvent(new CustomEvent("themechange"));
  });
  if (!document.documentElement.dataset.theme) document.documentElement.dataset.theme = currentTheme();

  /* ---------- Navigation : fond au défilement, barre de progression, lien actif ---------- */
  const nav = $("#nav");
  const progress = $(".progress");
  const sections = $$("main section[id]");
  const navLinks = $$(".nav__links a");
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 20);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    let active = null;
    for (const s of sections) if (s.getBoundingClientRect().top < window.innerHeight * 0.35) active = s.id;
    navLinks.forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#${active}`));
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Compteurs ---------- */
  const countUp = el => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    const render = v => {
      el.textContent = prefix + v.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    };
    if (reduceMotion) return render(target);
    const duration = 1800;
    const start = performance.now();
    const tick = now => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      render(target * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  window.countUp = countUp;

  /* ---------- Révélations au défilement ---------- */
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      el.classList.add("in");
      $$("[data-count]", el).forEach(countUp);
      if (el.matches("[data-count]")) countUp(el);
      if (el.matches(".skill-bar")) $(".fill", el).style.width = `${el.dataset.level}%`;
      if (el.id === "pipeline") animatePipeline(el);
      io.unobserve(el);
    }
  }, { threshold: 0.18, rootMargin: "0px 0px -40px 0px" });
  $$(".reveal, .skill-bar, #pipeline, .stat").forEach(el => io.observe(el));
  window.observeReveal = el => io.observe(el);

  function animatePipeline(el) {
    el.classList.add("in");
    $$(".pipeline__step", el).forEach((step, i) => setTimeout(() => step.classList.add("on"), 250 + i * 420));
  }

  /* ---------- Hero : titre mot par mot, texte tapé, requête « live » ---------- */
  const hero = $("#hero");
  $$(".hero h1 .word").forEach((w, i) => { w.style.animationDelay = `${0.08 * i + 0.15}s`; });
  requestAnimationFrame(() => hero.classList.add("ready"));
  $$(".live [data-count]").forEach(el => setTimeout(() => countUp(el), 600));

  const phrases = [
    "repérer une alerte avant qu'elle coûte.",
    "savoir quel canal crée vraiment de la valeur.",
    "prioriser les bons quartiers.",
    "détecter les ventes suspectes.",
  ];
  const typed = $("#typed");
  if (!reduceMotion && typed) {
    let p = 0, i = phrases[0].length, deleting = true;
    const loop = () => {
      const word = phrases[p];
      typed.textContent = word.slice(0, i);
      if (deleting) {
        i--;
        if (i === 0) { deleting = false; p = (p + 1) % phrases.length; }
        setTimeout(loop, 28);
      } else {
        i++;
        if (i > phrases[p].length) { deleting = true; setTimeout(loop, 2600); return; }
        setTimeout(loop, 55);
      }
    };
    setTimeout(loop, 4200);
  }

  const query = [
    ["kw", "SELECT "], ["", "zone, canal,\n  "], ["fn", "AVG"], ["", "(ventes) "], ["kw", "OVER "],
    ["", "(\n    "], ["kw", "ROWS BETWEEN "], ["", "3 "], ["kw", "PRECEDING"], ["", " …) "], ["kw", "AS "], ["", "ref\n"],
    ["kw", "WHERE "], ["", "sigma <= -2;"],
  ];
  const liveQuery = $("#liveQuery");
  if (liveQuery) {
    const full = query.map(([cls, text]) => ({ cls, text }));
    if (reduceMotion) {
      liveQuery.innerHTML = full.map(t => `<span class="${t.cls}">${t.text}</span>`).join("");
    } else {
      let part = 0, ch = 0;
      const type = () => {
        if (part >= full.length) { liveQuery.insertAdjacentHTML("beforeend", '<span class="caret"></span>'); return; }
        const t = full[part];
        let span = liveQuery.lastElementChild;
        if (ch === 0) { span = document.createElement("span"); span.className = t.cls; liveQuery.appendChild(span); }
        span.textContent += t.text[ch++];
        if (ch >= t.text.length) { part++; ch = 0; }
        setTimeout(type, 22);
      };
      setTimeout(type, 900);
    }
  }

  /* ---------- Fond animé du hero : nuage de points de données reliés ---------- */
  const canvas = $("#heroCanvas");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d");
    let w, h, points = [], mouse = { x: -999, y: -999 };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(90, (w * h) / 16000));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      }));
    };
    const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#39d0ff";
    let color = accent();
    document.addEventListener("themechange", () => { color = accent(); });
    hero.addEventListener("pointermove", e => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    hero.addEventListener("pointerleave", () => { mouse = { x: -999, y: -999 }; });
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
    const frame = () => {
      if (visible) {
        ctx.clearRect(0, 0, w, h);
        for (const p of points) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y);
          if (dm < 140) { p.x += (p.x - mouse.x) / dm; p.y += (p.y - mouse.y) / dm; }
        }
        ctx.strokeStyle = color; ctx.fillStyle = color;
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const a = points[i], b = points[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 130) {
              ctx.globalAlpha = (1 - d / 130) * 0.35;
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
          }
          ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.arc(points[i].x, points[i].y, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    };
    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(frame);
  }

  /* ---------- Halo qui suit le curseur & reflet des cartes chiffres ---------- */
  const glow = $(".cursor-glow");
  if (glow && !reduceMotion && window.matchMedia("(hover: hover)").matches) {
    window.addEventListener("pointermove", e => {
      glow.style.left = `${e.clientX}px`; glow.style.top = `${e.clientY}px`;
    }, { passive: true });
  } else if (glow) glow.remove();
  $$(".stat").forEach(card => card.addEventListener("pointermove", e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  }));

  window.fmtNumber = v => fmt.format(v);
})();
