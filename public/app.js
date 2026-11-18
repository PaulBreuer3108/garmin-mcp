"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const API = "api/";
  const STORE = "dashboard-cache-v1";
  const SPORTS = [
    { key: "swim", label: "Schwimmen", color: "var(--swim)" },
    { key: "bike", label: "Rad", color: "var(--bike)" },
    { key: "run", label: "Laufen", color: "var(--run)" },
    { key: "strength", label: "Kraft", color: "var(--strength)" },
  ];
  const NS = "http://www.w3.org/2000/svg";

  const fmtH = (min) => {
    const m = Math.round(min);
    const h = Math.floor(m / 60);
    return h ? `${h}:${String(m % 60).padStart(2, "0")} h` : `${m} min`;
  };
  const num = (x, d = 1) => (x == null ? "–" : x.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y.slice(2)}`; };
  const dm = (iso) => { const [, m, d] = iso.split("-"); return `${d}.${m}.`; };
  const weekday = (iso) => ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(iso + "T12:00:00Z").getUTCDay()];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  // ---------- storage (best effort) ----------
  const saveLocal = (d) => { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch {} };
  const loadLocal = () => { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; } };
  const clearLocal = () => { try { localStorage.removeItem(STORE); } catch {} };

  // ---------- tooltip ----------
  const tip = $("tip");
  let tipOwner = null;
  function showTip(html, evt, owner) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = (evt.touches?.[0] ?? evt);
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.clientX - tip.offsetWidth / 2));
    const y = r.clientY - tip.offsetHeight - 14;
    tip.style.left = x + "px";
    tip.style.top = (y < 8 ? r.clientY + 18 : y) + "px";
    if (tipOwner && tipOwner !== owner) tipOwner.classList.remove("on");
    tipOwner = owner;
    owner?.classList.add("on");
  }
  function hideTip() { tip.hidden = true; tipOwner?.classList.remove("on"); tipOwner = null; }
  document.addEventListener("click", (e) => { if (!e.target.closest?.(".hit")) hideTip(); });
  window.addEventListener("scroll", hideTip, { passive: true });
  function bindTip(node, html) {
    node.addEventListener("mousemove", (e) => showTip(html(), e, node));
    node.addEventListener("mouseleave", hideTip);
    node.addEventListener("click", (e) => { e.stopPropagation(); showTip(html(), e, node); });
  }

  // ---------- charts ----------
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function frame(container, W, H, pad, yMax, ticks, yFmt) {
    container.innerHTML = "";
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, container);
    for (let i = 0; i <= ticks; i++) {
      const v = (yMax / ticks) * i;
      const y = H - pad.b - (v / yMax) * (H - pad.t - pad.b);
      el("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: "gridline" }, svg);
      const t = el("text", { x: pad.l - 6, y: y + 3, "text-anchor": "end" }, svg);
      t.textContent = yFmt(v);
    }
    return svg;
  }
  /** Rounded top only, anchored to the baseline. */
  function barPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    if (h <= 0) return "";
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function weeksChart(container, weeks, plan, current) {
    const future = plan.filter((p) => p.week > Math.max(current, 1) && p.week <= Math.max(current, 1) + 6);
    const cols = [
      ...weeks.map((w) => ({ week: w.week, start: w.start, actual: w, plan: w.plan })),
      ...future.map((p) => ({ week: p.week, start: p.start, actual: null, plan: p })),
    ];
    const W = Math.max(280, container.clientWidth || 640), H = 220, pad = { l: 34, r: 6, t: 10, b: 26 };
    const maxV = Math.max(1, ...cols.map((c) => Math.max(c.actual ? c.actual.totalMin / 60 : 0, c.plan ? c.plan.hours : 0)));
    const yMax = niceMax(maxV);
    const svg = frame(container, W, H, pad, yMax, 4, (v) => num(v) + "h");
    const ih = H - pad.t - pad.b;
    const step = (W - pad.l - pad.r) / cols.length;
    const bw = Math.max(4, Math.min(22, step * 0.62));
    const y = (h) => H - pad.b - (h / yMax) * ih;
    cols.forEach((c, i) => {
      const cx = pad.l + step * i + step / 2;
      const x = cx - bw / 2;
      if (c.actual) {
        // stacked segments with a 2px surface gap
        let acc = 0;
        const segs = SPORTS.map((s) => ({ s, h: c.actual.min[s.key] / 60 })).filter((g) => g.h > 0);
        segs.forEach((g, j) => {
          const y0 = y(acc), y1 = y(acc + g.h);
          const top = j === segs.length - 1;
          const hgt = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
          const yy = y1;
          if (top) el("path", { d: barPath(x, yy, bw, hgt, 4), fill: g.s.color }, svg);
          else el("rect", { x, y: yy, width: bw, height: hgt, fill: g.s.color }, svg);
          acc += g.h;
        });
      }
      if (c.plan) {
        const py = y(c.plan.hours);
        el("line", { x1: cx - step / 2 + 2, x2: cx + step / 2 - 2, y1: py, y2: py, stroke: "var(--plan)", "stroke-width": 2, "stroke-dasharray": c.actual ? "0" : "3 3", "stroke-linecap": "round", opacity: c.actual ? 0.9 : 0.5 }, svg);
      }
      // Labels anchored at the current week, at least ~44px apart.
      const every = Math.max(1, Math.ceil(44 / step));
      const ci = Math.max(0, cols.findIndex((k) => k.week === current));
      if ((i - ci) % every === 0) {
        const t = el("text", { x: cx, y: H - pad.b + 14, "text-anchor": "middle", class: c.week === current ? "now" : "" }, svg);
        t.textContent = c.week >= 1 ? "W" + c.week : dm(c.start);
      }
      const hit = el("rect", { x: cx - step / 2, y: pad.t, width: step, height: ih, class: "hit" }, svg);
      bindTip(hit, () => {
        const head = `<b>${c.week >= 1 ? "Woche " + c.week + " · " : ""}ab ${dmy(c.start)}</b>`;
        const pl = c.plan ? `<div>Plan: ${num(c.plan.hours)} h${c.plan.deload ? " (Entlastung)" : ""}</div>` : "";
        if (!c.actual) return head + pl + `<div class="muted">noch offen</div>`;
        const rows = SPORTS.filter((s) => c.actual.min[s.key] > 0)
          .map((s) => `<div class="row"><span class="dot" style="background:${s.color}"></span>${s.label}: ${fmtH(c.actual.min[s.key])}</div>`).join("");
        return head + `<div>Ist: ${fmtH(c.actual.totalMin)}</div>` + pl + rows;
      });
    });
    const lg = $("legend-weeks");
    lg.innerHTML = SPORTS.map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join("") + `<span><i class="planmark"></i>Plan</span>`;
  }

  function simpleBars(container, weeks, get, color, fmt, unit) {
    const vals = weeks.map(get);
    if (!vals.some((v) => v > 0)) { container.innerHTML = `<div class="empty">Noch keine Einheiten in diesem Zeitraum.</div>`; return; }
    const W = Math.max(240, container.clientWidth || 320), H = 140, pad = { l: 34, r: 6, t: 8, b: 20 };
    const yMax = niceMax(Math.max(...vals));
    const svg = frame(container, W, H, pad, yMax, 2, (v) => num(v, 1));
    const ih = H - pad.t - pad.b;
    const step = (W - pad.l - pad.r) / weeks.length;
    const bw = Math.max(3, Math.min(16, step * 0.6));
    weeks.forEach((w, i) => {
      const cx = pad.l + step * i + step / 2;
      const h = (vals[i] / yMax) * ih;
      if (h > 0) el("path", { d: barPath(cx - bw / 2, H - pad.b - h, bw, h, 3), fill: color }, svg);
      if (i === 0 || i === weeks.length - 1) {
        const t = el("text", { x: cx, y: H - pad.b + 13, "text-anchor": i === 0 ? "start" : "end" }, svg);
        t.textContent = w.week >= 1 ? "W" + w.week : dm(w.start);
      }
      const hit = el("rect", { x: cx - step / 2, y: pad.t, width: step, height: ih, class: "hit" }, svg);
      bindTip(hit, () => `<b>ab ${dmy(w.start)}</b>${fmt(vals[i])} ${unit}`);
    });
  }

  function lineChart(container, days, key, color, unit) {
    const pts = days.filter((d) => d[key] != null);
    if (pts.length < 2) { container.innerHTML = `<div class="empty">Zu wenige Messwerte.</div>`; return; }
    const W = Math.max(240, container.clientWidth || 320), H = 140, pad = { l: 34, r: 6, t: 8, b: 20 };
    const vals = pts.map((d) => d[key]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const spread = Math.max(4, hi - lo);
    lo = Math.floor((lo - spread * 0.15) / 5) * 5; hi = Math.ceil((hi + spread * 0.15) / 5) * 5;
    container.innerHTML = "";
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, container);
    const ih = H - pad.t - pad.b, iw = W - pad.l - pad.r;
    const t0 = Date.parse(days[0].date), t1 = Date.parse(days[days.length - 1].date) || t0 + 1;
    const X = (d) => pad.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * iw;
    const Y = (v) => H - pad.b - ((v - lo) / (hi - lo)) * ih;
    for (const v of [lo, (lo + hi) / 2, hi]) {
      el("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: "gridline" }, svg);
      el("text", { x: pad.l - 6, y: Y(v) + 3, "text-anchor": "end" }, svg).textContent = num(v, 0);
    }
    // daily values faint, 7-day average strong
    const avg = pts.map((p, i) => {
      const win = pts.filter((q) => Date.parse(q.date) <= Date.parse(p.date) && Date.parse(q.date) > Date.parse(p.date) - 7 * 864e5);
      return { date: p.date, v: win.reduce((a, b) => a + b[key], 0) / win.length };
    });
    el("polyline", { points: pts.map((p) => `${X(p.date)},${Y(p[key])}`).join(" "), fill: "none", stroke: color, "stroke-width": 1, opacity: 0.35, "stroke-linejoin": "round" }, svg);
    el("polyline", { points: avg.map((p) => `${X(p.date)},${Y(p.v)}`).join(" "), fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    const last = avg[avg.length - 1];
    el("circle", { cx: X(last.date), cy: Y(last.v), r: 4, fill: color, stroke: "var(--surface)", "stroke-width": 2 }, svg);
    el("text", { x: pad.l, y: H - pad.b + 13, "text-anchor": "start" }, svg).textContent = dm(days[0].date);
    el("text", { x: W - pad.r, y: H - pad.b + 13, "text-anchor": "end" }, svg).textContent = dm(days[days.length - 1].date);
    // crosshair hover
    const cross = el("line", { y1: pad.t, y2: H - pad.b, stroke: "var(--muted)", "stroke-width": 1, opacity: 0 }, svg);
    const hit = el("rect", { x: pad.l, y: pad.t, width: iw, height: ih, class: "hit" }, svg);
    const near = (evt) => {
      const r = svg.getBoundingClientRect();
      const cx = ((evt.touches?.[0] ?? evt).clientX - r.left) * (W / r.width);
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(X(p.date) - cx) < Math.abs(X(pts[best].date) - cx)) best = i; });
      return best;
    };
    const show = (evt) => {
      const i = near(evt);
      cross.setAttribute("x1", X(pts[i].date)); cross.setAttribute("x2", X(pts[i].date)); cross.setAttribute("opacity", 0.6);
      const st = pts[i].hrvStatus && key === "hrv" ? ` · ${statusDe(pts[i].hrvStatus)}` : "";
      showTip(`<b>${weekday(pts[i].date)}, ${dmy(pts[i].date)}</b>${pts[i][key]} ${unit}${st}<div class="muted">7-Tage-Schnitt: ${num(avg[i].v, 0)} ${unit}</div>`, evt, hit);
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("click", (e) => { e.stopPropagation(); show(e); });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
  }
  const statusDe = (s) => ({ BALANCED: "ausgeglichen", UNBALANCED: "unausgeglichen", LOW: "niedrig", POOR: "schlecht" })[s] ?? s.toLowerCase();

  // ---------- render ----------
  function render(d) {
    lastData = d;
    $("days-left").textContent = d.race.daysLeft;
    $("race-name").textContent = d.race.name;
    const weeksLeft = Math.floor(d.race.daysLeft / 7);
    const sub = d.currentWeek < 1
      ? `Planstart Mo, ${dmy(d.plan[0].start)} · noch ${weeksLeft} Wochen bis ${dmy(d.race.date)}`
      : `Woche ${Math.min(d.currentWeek, d.planWeeks)} von ${d.planWeeks} · noch ${weeksLeft} Wochen und ${d.race.daysLeft % 7} Tage`;
    $("race-sub").textContent = sub;

    const fw = d.focusWeek;
    const p = fw.plan;
    $("week-title").textContent = d.currentWeek < 1 ? `Nächste Woche: Woche 1` : `Woche ${fw.week} · ab ${dmy(fw.start)}`;
    $("week-phase").textContent = p ? p.phase + (p.deload ? " · Entlastung" : "") : "";
    const rows = [
      ...SPORTS.slice(0, 3).map((s) => ({ ...s, ist: fw.min[s.key], soll: p ? p[s.key + "Min"] : 0 })),
      { key: "total", label: "Gesamt", color: "var(--text)", ist: fw.totalMin, soll: p ? p.hours * 60 : 0 },
    ];
    $("week-bars").innerHTML = rows.map((r) => {
      const pct = r.soll ? Math.min(100, (r.ist / r.soll) * 100) : r.ist ? 100 : 0;
      const extra = r.key === "run" && fw.runKm ? ` · ${num(fw.runKm)} km` : r.key === "bike" && fw.bikeKm ? ` · ${num(fw.bikeKm)} km` : r.key === "swim" && fw.swimM ? ` · ${num(fw.swimM, 0)} m` : "";
      return `<div class="bar-row ${r.key === "total" ? "total" : ""}">
        <div class="bar-label">${r.key === "total" ? "" : `<i class="dot" style="background:${r.color}"></i>`}${r.label}</div>
        <div class="bar-track" role="img" aria-label="${r.label}: ${fmtH(r.ist)} von ${fmtH(r.soll)}"><div class="bar-fill" style="width:${pct}%;background:${r.color}"></div></div>
        <div class="bar-val">${fmtH(r.ist)} von ca. ${fmtH(r.soll)}${extra}</div>
      </div>`;
    }).join("");
    $("week-plan").innerHTML = p ? [
      ["Schwerpunkt", p.focus], ["Schwimmen", p.swim], ["Langes Rad", p.longBike], ["Langer Lauf", p.longRun],
      ["Dazu", "Mi Kickr 45 bis 60 min, Do Lauf 40 bis 50 min + 15 min Kraft"],
    ].map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join("") : "";

    weeksChart($("chart-weeks"), d.weeks, d.plan, d.currentWeek);
    simpleBars($("chart-run"), d.weeks, (w) => w.runKm, "var(--run)", (v) => num(v), "km");
    simpleBars($("chart-bike"), d.weeks, (w) => Math.round((w.min.bike / 60) * 10) / 10, "var(--bike)", (v) => num(v), "h");
    simpleBars($("chart-swim"), d.weeks, (w) => w.swimM, "var(--swim)", (v) => num(v, 0), "m");
    lineChart($("chart-hrv"), d.days, "hrv", "var(--accent)", "ms");
    lineChart($("chart-rhr"), d.days, "restingHr", "var(--bike)", "bpm");

    const color = Object.fromEntries(SPORTS.map((s) => [s.key, s.color]));
    $("recent").innerHTML = d.recent.length ? d.recent.map((a) => `<li>
      <i class="dot" style="background:${color[a.sport] ?? "var(--muted)"}"></i>
      <div><div class="name">${esc(a.name)}</div><div class="meta">${weekday(a.date)}, ${dmy(a.date)} · ${a.time}${a.avgHr ? ` · Ø ${a.avgHr} bpm` : ""}</div></div>
      <div class="num">${fmtH(a.durationMin)}${a.distanceKm >= 0.1 ? `<br>${a.sport === "swim" ? num(a.distanceKm * 1000, 0) + " m" : num(a.distanceKm) + " km"}` : ""}</div>
    </li>`).join("") : `<li class="empty">Keine Einheiten.</li>`;

    const t = new Date(d.generatedAt);
    $("stamp").textContent = "Stand: " + t.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  // ---------- data flow ----------
  const status = (msg, warn) => { const s = $("status"); s.textContent = msg || ""; s.classList.toggle("warn", !!warn); };
  function showLogin() { $("main").hidden = true; $("login").hidden = false; $("pw").focus(); }
  function showMain() { $("login").hidden = true; $("main").hidden = false; }

  let busy = false;
  async function load(force) {
    if (busy) return;
    busy = true;
    const btn = $("refresh");
    btn.disabled = true; btn.classList.add("busy");
    status(force ? "Hole neue Daten von Garmin …" : "Lade …");
    const slow = setTimeout(() => status("Der Server wacht gerade auf, das kann bis zu einer Minute dauern …"), 6000);
    try {
      const res = await fetch(API + "dashboard" + (force ? "?refresh=1" : ""), { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) { clearLocal(); showLogin(); status(""); return; }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.stale) render(body.stale);
        status((body?.error || "Fehler beim Laden.") + " Angezeigt wird der letzte Stand.", true);
        return;
      }
      showMain();
      render(body);
      saveLocal(body);
      status("");
    } catch {
      status("Keine Verbindung. Angezeigt wird der letzte Stand.", true);
    } finally {
      clearTimeout(slow);
      busy = false;
      btn.disabled = false; btn.classList.remove("busy");
    }
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    const res = await fetch(API + "login", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ password: $("pw").value }),
    }).catch(() => null);
    if (!res) { $("login-error").textContent = "Keine Verbindung."; return; }
    if (!res.ok) { $("login-error").textContent = (await res.json().catch(() => ({}))).error || "Anmeldung fehlgeschlagen."; return; }
    $("pw").value = "";
    showMain();
    load(false);
  });
  $("refresh").addEventListener("click", () => load(true));
  $("logout").addEventListener("click", async () => {
    await fetch(API + "logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
    clearLocal();
    showLogin();
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("main").hidden) load(false); });

  let lastData = null;
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => lastData && render(lastData), 150); });

  const cached = loadLocal();
  showMain();
  if (cached) render(cached);
  load(false);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
