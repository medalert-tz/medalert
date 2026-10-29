"use strict";
// MediAlert clinician dashboard. Plain JS, no build step.

const TZ = "Africa/Dar_es_Salaam";
const $ = (s) => document.querySelector(s);
const state = { key: "", patients: [], selected: null };

const store = {
  get(k) { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// API returns naive UTC timestamps.
const asDate = (iso) => new Date(iso.endsWith("Z") ? iso : iso + "Z");
const fmtTime = (iso) => asDate(iso).toLocaleTimeString([], { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = (iso) => asDate(iso).toLocaleDateString([], { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const fmtDateTime = (iso) => `${fmtDay(iso)} ${fmtTime(iso)}`;

function say(msg) { $("#status").textContent = msg; }

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-API-Key": state.key, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = Array.isArray(data?.detail) ? data.detail.map((d) => d.msg).join("; ") : data?.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

function badge(risk) {
  if (!risk) return `<span class="badge none">No score</span>`;
  const label = { high: "High risk", medium: "Medium", low: "Low risk" }[risk.level];
  return `<span class="badge ${risk.level}" title="Score ${risk.score}">${label} · ${Math.round(risk.score * 100)}</span>`;
}

// ---------- Queue & patient list ----------

async function loadQueue() {
  const items = await api("/api/v1/interventions?status=open");
  const ol = $("#queue");
  if (!items.length) { ol.innerHTML = `<li class="queue-empty" style="background:none;border:0;padding:0">No patients need follow-up right now.</li>`; return; }
  ol.innerHTML = items.map((iv) => `
    <li>
      <div class="row-between"><span class="who">${esc(iv.patient_name)}</span>
        <span class="badge high">${Math.round(iv.score * 100)}</span></div>
      <div class="why">${esc(iv.reason)}</div>
      <div class="row-between">
        <button class="ghost" type="button" data-open="${iv.patient_id}">View</button>
      </div>
      <form data-resolve="${iv.id}">
        <input name="note" required aria-label="Outcome note for ${esc(iv.patient_name)}" placeholder="Outcome, e.g. called; restarted doses">
        <button type="submit">Resolve</button>
      </form>
    </li>`).join("");
}

async function loadPatients() {
  state.patients = await api("/api/v1/patients");
  $("#patients").innerHTML = state.patients.map((p) => `
    <li><button type="button" data-open="${p.id}" aria-current="${p.id === state.selected}">
      <span>${esc(p.display_name)}<span class="meta">${esc(p.condition || "—")}${p.facility ? " · " + esc(p.facility) : ""}</span></span>
      ${badge(p.risk)}
    </button></li>`).join("") || `<li class="muted">No patients yet.</li>`;
}

async function refreshAll() {
  await Promise.all([loadQueue(), loadPatients()]);
  if (state.selected) await openPatient(state.selected);
}

// ---------- Patient detail ----------

async function openPatient(id) {
  const switching = state.selected !== id || $("#detail").hidden;
  state.selected = id;
  document.querySelectorAll("#patients button").forEach((b) => b.setAttribute("aria-current", String(Number(b.dataset.open) === id)));
  const [p, rxs, doses] = await Promise.all([
    api(`/api/v1/patients/${id}`),
    api(`/api/v1/patients/${id}/prescriptions`),
    api(`/api/v1/patients/${id}/doses?days=7`),
  ]);
  $("#empty-detail").hidden = true;
  $("#detail").hidden = false;
  $("#detail-h").textContent = p.display_name;
  $("#detail-meta").textContent = [p.condition, p.facility, p.phone].filter(Boolean).join(" · ") || "No details";
  $("#detail-risk").innerHTML = badge(p.risk);
  $("#detail-factors").innerHTML = (p.risk?.factors || []).map((f) => `<li>${esc(f)}</li>`).join("");

  // Doses grouped by local day
  const byDay = new Map();
  [...doses].reverse().forEach((d) => {
    const k = fmtDay(d.scheduled_at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(d);
  });
  $("#doses").innerHTML = [...byDay].map(([day, ds]) => `
    <div class="day" role="listitem"><b>${esc(day)}</b>
      ${ds.map((d) => `<div class="slot"><span class="dot ${d.status}" aria-hidden="true"></span>${fmtTime(d.scheduled_at)}
        <span class="sr-only">${d.status === "pending" ? "upcoming" : d.status}</span></div>`).join("")}
    </div>`).join("") || `<p class="muted">No doses scheduled.</p>`;

  $("#rx-list").innerHTML = rxs.map((rx) => `
    <div class="card rx">
      <div>
        <strong>${esc(rx.drug_name)}</strong> <span class="muted">${esc(rx.status)}</span>
        <div class="muted small">${esc(rx.times.join(", "))} · ${rx.duration_days ? rx.duration_days + "-day course" : "ongoing"}${rx.dose_instructions ? " · " + esc(rx.dose_instructions) : ""}</div>
        <div class="small">${supplyText(rx.supply)}</div>
      </div>
      ${rx.status === "active" ? `
      <div class="row">
        <form data-dispense="${rx.id}">
          <label>Doses<input name="doses_supplied" type="number" min="1" required></label>
          <button type="submit">Dispense</button>
        </form>
        <button class="ghost" type="button" data-stop="${rx.id}">Stop</button>
      </div>` : ""}
    </div>`).join("") || `<p class="muted">No prescriptions yet.</p>`;

  const d = p.device;
  $("#device-info").innerHTML = `
    ${d ? `<p>Serial <strong>${esc(d.serial)}</strong> · last sync ${d.last_seen_at ? fmtDateTime(d.last_seen_at) : "never"}${d.battery_pct != null ? ` · battery ${d.battery_pct}%` : ""}</p>`
        : `<p class="muted">No wearable paired.</p>`}
    <form id="pair-form" class="row" style="align-items:end">
      <label style="flex:1">Device serial<input name="serial" required maxlength="64" placeholder="MA-0001"></label>
      <button type="submit">${d ? "Re-pair" : "Pair"}</button>
    </form>
    <div id="token-out"></div>`;

  const tok = store.get(`tok:${id}`);
  if (switching) $("#sim-out").textContent = tok ? "Ready." : "No device token in this tab. Pair a device first, or paste one below.";
  if (!tok && !$("#tok-paste")) {
    $("#sim-out").insertAdjacentHTML("afterend",
      `<form id="tok-paste" class="row" style="margin-top:8px;align-items:end"><label style="flex:1">Device token<input name="t" required></label><button type="submit">Use</button></form>`);
  } else if (tok) { $("#tok-paste")?.remove(); }
}

function supplyText(s) {
  if (!s || !s.doses_supplied) return `<span class="muted">Not dispensed yet</span>`;
  const days = s.days_remaining != null ? `${s.days_remaining.toFixed(1)} days left` : "";
  return `${s.doses_remaining} of ${s.doses_supplied} doses left${days ? " · " + days : ""}${s.refill_due ? ` · <span class="badge medium">Refill due</span>` : ""}`;
}

// ---------- Device simulator ----------

async function device(path) {
  const tok = store.get(`tok:${state.selected}`);
  if (!tok) { $("#sim-out").textContent = "Pair a device first."; return; }
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Token": tok }, body: JSON.stringify({}) });
  const data = await res.json();
  const lines = [];
  if (path.endsWith("sync")) {
    lines.push(`Alert: ${data.alert === "dose" ? "BUZZ — take your dose" : data.alert === "refill" ? "BEEP — refill soon" : "none"}`);
    if (data.next_dose_at) lines.push(`Next: ${data.next_dose_label} at ${fmtDateTime(data.next_dose_at)}`);
    if (data.refill_in_days != null) lines.push(`Supply: ${data.refill_in_days} days`);
  } else {
    lines.push(data.message ?? data.detail);
  }
  $("#sim-out").textContent = lines.join("\n");
  await refreshAll();
}

// ---------- Wiring ----------

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  try {
    if (t.dataset.open) await openPatient(Number(t.dataset.open));
    else if (t.dataset.stop && confirm("Stop this prescription? Future reminders are cancelled.")) {
      await api(`/api/v1/prescriptions/${t.dataset.stop}/stop`, { method: "POST" });
      say("Prescription stopped."); await refreshAll();
    } else if (t.id === "run-monitor") {
      const r = await api("/api/v1/monitor/run", { method: "POST" });
      say(`Checked ${r.patients_assessed} patient(s); ${r.doses_marked_missed} missed dose(s); ${r.interventions_opened} new alert(s).`);
      await refreshAll();
    } else if (t.id === "new-patient-btn") {
      const f = $("#new-patient"); f.hidden = !f.hidden; t.setAttribute("aria-expanded", String(!f.hidden));
      if (!f.hidden) f.querySelector("input").focus();
    } else if (t.id === "sim-sync") await device("/api/device/v1/sync");
    else if (t.id === "sim-press") await device("/api/device/v1/ack");
  } catch (err) { say(err.message); }
});

document.addEventListener("submit", async (e) => {
  const f = e.target;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  try {
    if (f.id === "key-form") {
      state.key = $("#api-key").value.trim();
      await api("/api/v1/patients");
      store.set("apiKey", state.key);
      $("#main").hidden = false; say("Connected.");
      await refreshAll();
    } else if (f.id === "new-patient") {
      const p = await api("/api/v1/patients", { method: "POST", body: clean(v) });
      f.reset(); f.hidden = true; say(`Registered ${p.display_name}.`);
      await loadPatients(); await openPatient(p.id);
    } else if (f.id === "rx-form") {
      const body = clean({ ...v, times: v.times.split(",").map((s) => s.trim()).filter(Boolean),
        duration_days: v.duration_days ? Number(v.duration_days) : null });
      await api(`/api/v1/patients/${state.selected}/prescriptions`, { method: "POST", body });
      f.reset(); setToday(); say("Prescription saved; reminders scheduled."); await refreshAll();
    } else if (f.dataset.dispense) {
      await api(`/api/v1/prescriptions/${f.dataset.dispense}/dispense`, { method: "POST", body: { doses_supplied: Number(v.doses_supplied) } });
      say("Dispensing recorded."); await refreshAll();
    } else if (f.dataset.resolve) {
      const who = prompt("Your name (for the record):");
      if (!who) return;
      await api(`/api/v1/interventions/${f.dataset.resolve}/resolve`, { method: "POST", body: { resolved_by: who, note: v.note } });
      say("Follow-up recorded."); await refreshAll();
    } else if (f.id === "pair-form") {
      const r = await api(`/api/v1/patients/${state.selected}/device`, { method: "POST", body: v });
      store.set(`tok:${state.selected}`, r.device_token);
      await openPatient(state.selected);
      $("#token-out").innerHTML = `<p class="small">Device token (shown once — load it onto the wearable):</p><div class="token">${esc(r.device_token)}</div>`;
      say("Device paired.");
    } else if (f.id === "tok-paste") {
      store.set(`tok:${state.selected}`, v.t.trim()); f.remove(); $("#sim-out").textContent = "Ready.";
    }
  } catch (err) { say(err.message); }
});

function clean(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null)); }
function setToday() {
  const d = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const el = document.querySelector('#rx-form [name="start_date"]'); if (el) el.value = d;
}

setToday();
const saved = store.get("apiKey");
if (saved) { $("#api-key").value = saved; $("#key-form").requestSubmit(); }
setInterval(() => { if (!$("#main").hidden) refreshAll().catch(() => {}); }, 60000);
