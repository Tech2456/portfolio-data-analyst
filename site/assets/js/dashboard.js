/* Tableau de bord de l'étude de cas : lit les exports du pipeline
   (assets/data/*.json) et construit graphiques, tableaux et alertes. */
(() => {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const pct = (v, d = 1) => `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
  const num = v => Number(v).toLocaleString("fr-FR");
  const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const monthLabel = iso => `${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(2, 4)}`;
  const shortChannel = label => label.replace(" (web & WhatsApp)", "").replace("Force de vente terrain", "Terrain");

  // Couleur fixe par canal (l'identité suit le canal, jamais son rang).
  const CHANNEL_SLOT = { TER: 1, BOU: 2, DIS: 3, DIG: 4, TEL: 5 };
  const CHANNEL_BY_LABEL = {
    "Force de vente terrain": "TER", "Boutiques": "BOU", "Distributeurs": "DIS",
    "Digital (web & WhatsApp)": "DIG", "Télévente": "TEL",
  };
  const seriesColor = code => css(`--series-${CHANNEL_SLOT[code]}`);

  const files = ["kpi_ventes_canal", "parc_reabonnement", "alertes", "ruptures", "ruptures_series",
                 "cohortes", "retention_canal", "entonnoir_conversion", "potentiel_zones", "ventes_suspectes"];
  const data = {};
  const charts = {};
  const state = { range: "all", age: "M12" };

  /* ---------- Réglages communs Chart.js ---------- */
  function applyChartDefaults() {
    Chart.defaults.font.family = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--ink-3");
    Chart.defaults.borderColor = css("--grid");
    Chart.defaults.animation.duration = 1200;
    Chart.defaults.animation.easing = "easeOutQuart";
    Chart.defaults.plugins.legend.display = false;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: css("--surface-3"), titleColor: css("--ink"), bodyColor: css("--ink-2"),
      borderColor: css("--line-strong"), borderWidth: 1, padding: 12, cornerRadius: 10,
      boxPadding: 6, usePointStyle: true, titleFont: { weight: "600" },
    });
  }
  const axis = extra => ({
    grid: { color: css("--grid"), drawTicks: false }, border: { display: false },
    ...extra,
    ticks: { padding: 8, color: css("--ink-3"), maxRotation: 0, autoSkipPadding: 14, ...(extra && extra.ticks) },
  });

  // Étiquette directe en bout de courbe (identité jamais portée par la couleur seule).
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx, chartArea } = chart;
      // Positions finales triées puis espacées d'au moins 15 px pour éviter les chevauchements.
      const labels = chart.data.datasets.map((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        const last = meta.data[meta.data.length - 1];
        return ds.noLabel || meta.hidden || !last ? null : { text: ds.shortLabel || ds.label, x: last.x, y: last.y };
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
      const overflow = labels.length ? labels[labels.length - 1].y - chartArea.bottom : 0;
      if (overflow > 0) labels.forEach(l => { l.y -= overflow; });
      ctx.save();
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillStyle = css("--ink-2");
      ctx.textBaseline = "middle";
      labels.forEach(l => ctx.fillText(l.text, l.x + 8, l.y));
      ctx.restore();
    },
  };
  // Ligne verticale qui suit le survol.
  const crosshair = {
    id: "crosshair",
    afterDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.strokeStyle = css("--axis"); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.restore();
    },
  };

  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    // Le graphique s'anime quand il entre à l'écran, pas au chargement.
    const build = () => { charts[id] = new Chart(el, config); };
    if (el.dataset.seen) return build();
    new IntersectionObserver(([entry], obs) => {
      if (!entry.isIntersecting) return;
      el.dataset.seen = "1"; obs.disconnect(); build();
    }, { threshold: 0.25 }).observe(el);
  }

  /* ---------- 1.1 KPIs ---------- */
  function renderKpis() {
    const park = data.parc_reabonnement;
    const last = park[park.length - 1], prev = park[park.length - 2];
    const month = last.month;
    const current = data.kpi_ventes_canal.filter(k => k.month === month);
    const previous = data.kpi_ventes_canal.filter(k => k.month === prev.month);
    const sales = current.reduce((s, k) => s + k.sales, 0);
    const target = current.reduce((s, k) => s + k.target_sales, 0);
    const prevSales = previous.reduce((s, k) => s + k.sales, 0);
    const delta = (v, unit = "") => {
      const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
      const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "■";
      return `<span class="delta ${cls}">${arrow} ${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${unit} vs M-1</span>`;
    };
    const tiles = [
      ["Ventes de septembre", num(sales), `<span class="delta ${sales >= target ? "up" : "down"}">${pct(100 * sales / target)} de l'objectif (${num(target)})</span>`],
      ["Parc actif", num(last.active_park), delta(last.active_park - prev.active_park)],
      ["Réabonnement", pct(last.renewal_rate_pct), delta(+(last.renewal_rate_pct - prev.renewal_rate_pct).toFixed(1), " pt")],
      ["Revenu du mois", `${(last.revenue_fcfa / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`, delta(+(100 * (last.revenue_fcfa / prev.revenue_fcfa - 1)).toFixed(1), " %")],
    ];
    $("#kpiRow").innerHTML = tiles.map(([l, v, d], i) =>
      `<div class="kpi reveal" data-delay="${i}"><small>${l}</small><b>${v}</b>${d}</div>`).join("");
    $$("#kpiRow .kpi").forEach(window.observeReveal);

    $("#attainTable").innerHTML =
      `<thead><tr><th>Canal</th><th class="num">Ventes</th><th class="num">Objectif</th><th class="num">Atteinte</th><th class="num">Contribution</th><th class="num">vs M-1</th><th>Statut</th></tr></thead><tbody>` +
      [...current].sort((a, b) => b.sales - a.sales).map(k => {
        const status = k.attainment_pct >= 100 ? ["good", "Atteint"] : k.attainment_pct >= 95 ? ["warning", "Proche"] : ["critical", "En retard"];
        return `<tr><td>${k.channel}</td><td class="num">${num(k.sales)}</td><td class="num">${num(k.target_sales)}</td>
          <td class="num">${pct(k.attainment_pct)}</td><td class="num">${pct(k.contribution_pct)}</td>
          <td class="num">${k.mom_pct > 0 ? "+" : ""}${pct(k.mom_pct)}</td><td><span class="status ${status[0]}">${status[1]}</span></td></tr>`;
      }).join("") + "</tbody>";

    $("#sheetTable").innerHTML =
      `<thead><tr><th>Canal</th><th class="num">Ventes</th><th class="num">Objectif</th><th class="num">Atteinte</th></tr></thead><tbody>` +
      current.map(k => {
        const bg = k.attainment_pct >= 100 ? "bg-grn" : k.attainment_pct >= 90 ? "bg-amb" : "bg-red";
        return `<tr><td>${shortChannel(k.channel)}</td><td class="num">${k.sales}</td><td class="num">${k.target_sales}</td><td class="num ${bg}">${pct(k.attainment_pct)}</td></tr>`;
      }).join("") + "</tbody>";

    // Sparkline du hero : revenu mensuel.
    const rev = park.map(p => p.revenue_fcfa);
    const max = Math.max(...rev), min = Math.min(...rev);
    const pts = rev.map((v, i) => [i * (300 / (rev.length - 1)), 64 - ((v - min) / (max - min)) * 58]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    $("#sparkLine").setAttribute("d", line);
    $("#sparkArea").setAttribute("d", `${line} L300,70 L0,70 Z`);
  }

  function renderSalesChart() {
    const months = [...new Set(data.kpi_ventes_canal.map(k => k.month))].sort();
    const shown = state.range === "all" ? months : months.slice(-parseInt(state.range, 10));
    const codes = ["TER", "BOU", "DIS", "DIG", "TEL"];
    const datasets = codes.map(code => {
      const rows = data.kpi_ventes_canal.filter(k => k.channel_code === code);
      const byMonth = Object.fromEntries(rows.map(r => [r.month, r.sales]));
      return {
        label: rows[0].channel, shortLabel: shortChannel(rows[0].channel),
        data: shown.map(m => byMonth[m]),
        borderColor: seriesColor(code), backgroundColor: seriesColor(code),
        borderWidth: 2, tension: 0.32, pointRadius: 0, pointHoverRadius: 5,
        pointHoverBorderWidth: 2, pointHoverBorderColor: css("--surface-1"),
      };
    });
    makeChart("salesChart", {
      type: "line",
      data: { labels: shown.map(monthLabel), datasets },
      options: {
        maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        layout: { padding: { right: 96 } },
        scales: { x: axis({ grid: { display: false } }), y: axis({ beginAtZero: true }) },
        plugins: {
          endLabels: { enabled: true },
          tooltip: { itemSort: (a, b) => b.raw - a.raw, callbacks: { label: c => ` ${c.dataset.shortLabel} : ${num(c.raw)} ventes` } },
        },
      },
      plugins: [endLabels, crosshair],
    });
    $("#salesLegend").innerHTML = codes.map(c => {
      const label = data.kpi_ventes_canal.find(k => k.channel_code === c).channel;
      return `<span><i style="background:${seriesColor(c)}"></i>${label}</span>`;
    }).join("");
  }

  /* ---------- 1.2 Alertes ---------- */
  function renderAlerts() {
    const cards = data.alertes.map(a => `
      <div class="alert-card reveal ${a.severity === "CRITIQUE" ? "" : "warning"}">
        <div class="ico" aria-hidden="true">!</div>
        <div><b>${a.channel} · ${a.zone}</b><span class="status ${a.severity === "CRITIQUE" ? "critical" : "warning"}" style="margin-left:10px">${a.severity === "CRITIQUE" ? "Critique" : "Alerte"}</span>
          <p>${a.sales_last_month} ventes en septembre contre ${a.baseline_3m.toLocaleString("fr-FR")} en moyenne sur 3 mois · écart de ${a.sigma.toLocaleString("fr-FR")} σ (SQL)</p></div>
        <div class="big">${a.deviation_pct > 0 ? "+" : ""}${Math.round(a.deviation_pct)} %</div>
      </div>`).concat(data.ruptures.map(r => `
      <div class="alert-card reveal">
        <div class="ico" aria-hidden="true">↘</div>
        <div><b>${r.channel} · ${r.zone}</b><span class="status critical" style="margin-left:10px">Rupture durable</span>
          <p>Part de la zone passée de ${pct(r.share_before_pct)} à ${pct(r.share_after_pct)} · détectée en ${monthLabel(r.detected_month + "-01")} (CUSUM)</p></div>
        <div class="big">${pct(r.share_after_pct - r.share_before_pct, 1).replace(" %", " pt")}</div>
      </div>`));
    $("#alertCards").innerHTML = cards.join("");
    $$("#alertCards .alert-card").forEach(window.observeReveal);

    const series = data.ruptures_series;
    const slots = ["--series-1", "--series-2"];
    const datasets = series.flatMap((s, i) => [
      { label: s.zone, shortLabel: s.zone, data: s.share_pct, borderColor: css(slots[i]), backgroundColor: css(slots[i]),
        borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5 },
      { label: `Référence ${s.zone}`, noLabel: true, data: s.months.map(() => s.reference_pct), borderColor: css(slots[i]),
        borderWidth: 1, borderDash: [5, 5], pointRadius: 0, pointHoverRadius: 0 },
    ]);
    makeChart("ruptureChart", {
      type: "line",
      data: { labels: series[0].months.map(m => monthLabel(m + "-01")), datasets },
      options: {
        maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        layout: { padding: { right: 72 } },
        scales: { x: axis({ grid: { display: false } }), y: axis({ beginAtZero: true, ticks: { callback: v => `${v} %` } }) },
        plugins: { endLabels: { enabled: true }, tooltip: { callbacks: { label: c => ` ${c.dataset.label} : ${pct(c.raw)}` } } },
      },
      plugins: [endLabels, crosshair],
    });
    $("#ruptureLegend").innerHTML = series.map((s, i) =>
      `<span><i style="background:${css(slots[i])}"></i>${s.zone}</span>`).join("") +
      `<span class="muted">- - - part de référence (2025)</span>`;
  }

  /* ---------- 1.3 Cohortes ---------- */
  const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
  function renderHeatmap() {
    const { cohorts, ages, values } = data.cohortes;
    const el = $("#heatmap");
    el.style.gridTemplateColumns = `64px repeat(${ages.length}, minmax(34px, 1fr))`;
    let html = `<div class="h"></div>` + ages.map(a => `<div class="h">M${a}</div>`).join("");
    cohorts.forEach((c, r) => {
      html += `<div class="r">${monthLabel(c + "-01")}</div>`;
      values[r].forEach((v, a) => {
        if (v === null) { html += `<div class="c empty"></div>`; return; }
        const step = Math.min(RAMP.length - 1, Math.round((v / 100) * (RAMP.length - 1)));
        const ink = step >= 6 ? "#fff" : "#0b0b0b";
        html += `<div class="c" style="background:${RAMP[step]};color:${ink};transition-delay:${(r + a) * 18}ms" title="Cohorte ${monthLabel(c + "-01")} · M${ages[a]} : ${pct(v)}">${Math.round(v)}</div>`;
      });
    });
    el.innerHTML = html;
    new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { el.classList.add("in"); obs.disconnect(); } }, { threshold: 0.2 }).observe(el);
  }

  function renderRetention() {
    const rows = [...data.retention_canal].sort((a, b) => b[state.age] - a[state.age]);
    makeChart("retentionChart", {
      type: "bar",
      data: {
        labels: rows.map(r => shortChannel(r.channel)),
        datasets: [{
          data: rows.map(r => r[state.age]),
          backgroundColor: rows.map(r => seriesColor(CHANNEL_BY_LABEL[r.channel])),
          borderRadius: 4, borderSkipped: "start", barPercentage: 0.62, categoryPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: "y", maintainAspectRatio: false,
        scales: { x: axis({ min: 0, max: 100, ticks: { callback: v => `${v} %` } }), y: axis({ grid: { display: false }, ticks: { color: css("--ink-2") } }) },
        plugins: { tooltip: { callbacks: { label: c => ` ${pct(c.raw)} des clients encore actifs à ${state.age.replace("M", "")} mois` } } },
      },
      plugins: [barValueLabels(v => pct(v))],
    });
  }

  // Valeur affichée au bout de chaque barre (étiquette sélective, texte en encre neutre).
  function barValueLabels(format) {
    return {
      id: "barValues",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillStyle = css("--ink-2");
        meta.data.forEach((bar, i) => {
          const v = chart.data.datasets[0].data[i];
          if (chart.options.indexAxis === "y") { ctx.textBaseline = "middle"; ctx.fillText(format(v), bar.x + 8, bar.y); }
          else { ctx.textAlign = "center"; ctx.fillText(format(v), bar.x, bar.y - 8); }
        });
        ctx.restore();
      },
    };
  }

  /* ---------- 1.4 Entonnoir ---------- */
  function renderFunnel() {
    const rows = data.entonnoir_conversion;
    makeChart("funnelChart", {
      type: "bar",
      data: {
        labels: rows.map(r => shortChannel(r.channel)),
        datasets: [{
          data: rows.map(r => r.end_to_end_pct),
          backgroundColor: rows.map(r => seriesColor(CHANNEL_BY_LABEL[r.channel])),
          borderRadius: 4, borderSkipped: "start", barPercentage: 0.62,
        }],
      },
      options: {
        indexAxis: "y", maintainAspectRatio: false, layout: { padding: { right: 50 } },
        scales: { x: axis({ beginAtZero: true, ticks: { callback: v => `${v} %` } }), y: axis({ grid: { display: false }, ticks: { color: css("--ink-2") } }) },
        plugins: { tooltip: { callbacks: { label: c => ` ${pct(c.raw)} des prospects deviennent des clients durables` } } },
      },
      plugins: [barValueLabels(v => pct(v))],
    });
    $("#funnelTable").innerHTML =
      `<thead><tr><th>Canal</th><th class="num">Prospects</th><th class="num">Ventes</th><th class="num">Conversion</th><th class="num">Activation</th><th class="num">Rétention M+3</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${r.channel}</td><td class="num">${num(r.leads)}</td><td class="num">${num(r.sales)}</td>
        <td class="num">${pct(r.conversion_pct)}</td><td class="num">${pct(r.activation_pct)}</td><td class="num">${pct(r.retention_m3_pct)}</td></tr>`).join("") + "</tbody>";
  }

  /* ---------- 1.5 Zones ---------- */
  function renderZones() {
    const rows = data.potentiel_zones;
    makeChart("zoneChart", {
      type: "bar",
      data: {
        labels: rows.map(r => r.zone),
        datasets: [{
          data: rows.map(r => r.priority_score),
          backgroundColor: rows.map(r => (r.priority_rank <= 3 ? css("--series-1") : css("--axis"))),
          borderRadius: 4, borderSkipped: "start", barPercentage: 0.7,
        }],
      },
      options: {
        indexAxis: "y", maintainAspectRatio: false, layout: { padding: { right: 40 } },
        scales: { x: axis({ min: 0, max: 100 }), y: axis({ grid: { display: false }, ticks: { color: css("--ink-2") } }) },
        plugins: {
          tooltip: {
            callbacks: {
              title: c => `${rows[c[0].dataIndex].priority_rank}. ${rows[c[0].dataIndex].zone}`,
              label: c => {
                const r = rows[c.dataIndex];
                return [` Score : ${r.priority_score}/100`, ` Pénétration : ${pct(r.penetration_pct)}`,
                        ` Foyers non abonnés : ${num(r.headroom)}`, ` Réabonnement : ${pct(r.renewal_pct)}`,
                        ` Dynamique 3 mois : ${r.momentum_pct > 0 ? "+" : ""}${pct(r.momentum_pct)}`];
              },
            },
          },
        },
      },
      plugins: [barValueLabels(v => v)],
    });
  }

  /* ---------- 1.6 Ventes suspectes ---------- */
  function renderRisk() {
    const rows = [...data.ventes_suspectes].sort((a, b) => a.agent_id.localeCompare(b.agent_id));
    makeChart("riskChart", {
      type: "bar",
      data: {
        labels: rows.map(r => r.agent_id.replace("AG-0", "")),
        datasets: [{
          data: rows.map(r => r.risk_score),
          backgroundColor: rows.map(r => (r.red_flags >= 2 ? css("--critical") : css("--series-1"))),
          borderRadius: 4, borderSkipped: "start", barPercentage: 0.75, categoryPercentage: 0.9,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: axis({ grid: { display: false }, title: { display: true, text: "Agent (AG-0xx)", color: css("--ink-3") } }), y: axis({ beginAtZero: true }) },
        plugins: {
          tooltip: {
            callbacks: {
              title: c => `${rows[c[0].dataIndex].agent_id} · ${rows[c[0].dataIndex].zone}`,
              label: c => {
                const r = rows[c.dataIndex];
                return [` Score de risque : ${r.risk_score.toLocaleString("fr-FR")}`, ` Jamais activées : ${pct(r.never_activated_pct)}`,
                        ` Clients réutilisés : ${pct(r.recycled_client_pct)}`, ` Fin de mois : ${pct(r.month_end_pct)}`,
                        ` Signaux rouges : ${r.red_flags}/4`];
              },
            },
          },
        },
      },
    });
    const top = data.ventes_suspectes.slice(0, 5);
    $("#riskTable").innerHTML =
      `<thead><tr><th>Agent</th><th>Zone</th><th class="num">Ventes</th><th class="num">Jamais activées</th><th class="num">Clients réutilisés</th><th class="num">Fin de mois</th><th class="num">Score</th><th>Signal</th></tr></thead><tbody>` +
      top.map(r => `<tr class="${r.red_flags >= 2 ? "highlight" : ""}"><td class="mono">${r.agent_id}</td><td>${r.zone}</td><td class="num">${r.sales}</td>
        <td class="num">${pct(r.never_activated_pct)}</td><td class="num">${pct(r.recycled_client_pct)}</td><td class="num">${pct(r.month_end_pct)}</td>
        <td class="num"><b>${r.risk_score.toLocaleString("fr-FR")}</b></td><td>${r.red_flags >= 2 ? '<span class="status critical">À auditer</span>' : '<span class="status good">Normal</span>'}</td></tr>`).join("") + "</tbody>";
  }

  /* ---------- Code source affiché ---------- */
  function loadCode() {
    $$("code[data-src]").forEach(async code => {
      try {
        const res = await fetch(code.dataset.src);
        code.textContent = await res.text();
        if (window.Prism) Prism.highlightElement(code);
      } catch (e) { code.textContent = "-- Fichier disponible sur GitHub : " + code.dataset.src; }
    });
  }

  /* ---------- Filtres ---------- */
  function bindControls() {
    $$("[data-range]").forEach(btn => btn.addEventListener("click", () => {
      state.range = btn.dataset.range;
      $$("[data-range]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      renderSalesChart();
    }));
    $$("[data-age]").forEach(btn => btn.addEventListener("click", () => {
      state.age = btn.dataset.age;
      $$("[data-age]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      renderRetention();
    }));
  }

  function renderCharts() {
    applyChartDefaults();
    renderSalesChart(); renderAlerts(); renderRetention(); renderFunnel(); renderZones(); renderRisk();
  }

  async function init() {
    const loaded = await Promise.all(files.map(f => fetch(`assets/data/${f}.json`).then(r => r.json())));
    files.forEach((f, i) => { data[f] = loaded[i]; });
    renderKpis(); renderHeatmap(); renderCharts(); bindControls(); loadCode();
    document.addEventListener("themechange", renderCharts);
  }

  init().catch(err => console.error("[dashboard] chargement des données impossible", err));
})();
