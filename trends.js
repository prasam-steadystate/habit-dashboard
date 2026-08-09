/* Trends page. Reuses config.js + storage.js; shares the session with the dashboard. */

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
const DOW_LABEL = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
const DOW_FULL = { 0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };

const loadingView = document.getElementById("loading-view");
const trendsView = document.getElementById("trends-view");
const habitSelect = document.getElementById("habit-select");
const rangeSeg = document.getElementById("range-seg");
const customRangeEl = document.getElementById("custom-range");
const rangeStartInput = document.getElementById("range-start");
const rangeEndInput = document.getElementById("range-end");
const chartsEl = document.getElementById("charts");
const noNumericEl = document.getElementById("no-numeric");

let numericHabits = [];
let currentHabit = null;
let currentRange = "30d";
let customStart = null;
let customEnd = null;
let valuesByDate = {}; // 'YYYY-MM-DD' -> minutes/count

/* ---------- dates ---------- */

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateList(start, end) {
  const list = [];
  let cur = start;
  while (cur <= end) { list.push(cur); cur = addDays(cur, 1); }
  return list;
}

function dowOf(dateStr) {
  return new Date(dateStr + "T00:00:00").getDay();
}

function shortDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function rangeBounds() {
  const end = todayStr();
  switch (currentRange) {
    case "30d": return { start: addDays(end, -29), end };
    case "90d": return { start: addDays(end, -89), end };
    case "6m": return { start: addDays(end, -181), end };
    case "12m": return { start: addDays(end, -364), end };
    case "ytd": return { start: `${new Date().getFullYear()}-01-01`, end };
    case "custom": return { start: customStart || addDays(end, -29), end: customEnd || end };
    default: return { start: addDays(end, -29), end };
  }
}

/* ---------- units ---------- */

function isHourly(h) { return h.type === "duration" && h.unit === "hr"; }

function toDisplay(h, stored) {
  if (isHourly(h)) return Math.round((stored / 60) * 10) / 10;
  return stored;
}

function unitLabel(h) {
  if (h.type === "duration") return h.unit === "hr" ? "hr" : "min";
  return h.unit || "";
}

function fmt(h, stored) {
  const v = toDisplay(h, stored);
  const rounded = Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  return `${rounded} ${unitLabel(h)}`;
}

/* ---------- data ---------- */

async function loadHabitList() {
  const habits = await getHabits();
  numericHabits = habits.filter((h) => h.type === "duration" || h.type === "count");

  if (!numericHabits.length) {
    chartsEl.classList.add("hidden");
    noNumericEl.classList.remove("hidden");
    habitSelect.classList.add("hidden");
    return false;
  }

  habitSelect.innerHTML = numericHabits
    .map((h) => `<option value="${h.key}">${h.emoji} ${h.name}</option>`)
    .join("");

  // default to Work when it's on, otherwise the first numeric habit
  currentHabit = numericHabits.find((h) => h.key === "work") || numericHabits[0];
  habitSelect.value = currentHabit.key;
  return true;
}

async function loadValues() {
  const { start, end } = rangeBounds();
  const rows = await getEntries(start, end);
  valuesByDate = {};
  for (const r of rows) {
    if (r.habit_id !== currentHabit.key) continue;
    valuesByDate[r.date] = r.value || 0;
  }
}

// Days actually in play: never count days before this habit's first entry,
// so a wide range doesn't dilute averages with pre-tracking days.
function activeDates() {
  const { start, end } = rangeBounds();
  const today = todayStr();
  const realEnd = end > today ? today : end;
  const logged = Object.keys(valuesByDate).sort();
  if (!logged.length) return []; // nothing recorded for this habit at all
  const firstLogged = logged[0];
  const effStart = firstLogged > start ? firstLogged : start;
  if (effStart > realEnd) return [];
  return dateList(effStart, realEnd);
}

/* ---------- chart helpers ---------- */

function niceMax(value) {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function renderAxis(yEl, gridEl, maxDisplay, h) {
  const ticks = [maxDisplay, maxDisplay * 0.75, maxDisplay * 0.5, maxDisplay * 0.25, 0];
  yEl.innerHTML = ticks
    .map((t) => `<span>${Number.isInteger(t) ? t : Math.round(t * 10) / 10}</span>`)
    .join("");
  gridEl.innerHTML = ticks.map(() => `<div class="gridline"></div>`).join("");
}

function positionTip(tip, bar, wrap) {
  const wrapRect = wrap.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  tip.classList.remove("hidden");
  const tipW = tip.offsetWidth;
  let left = barRect.left - wrapRect.left + barRect.width / 2 - tipW / 2;
  left = Math.max(0, Math.min(left, wrapRect.width - tipW));
  tip.style.left = left + "px";
}

function attachTip(bar, tip, wrap, html) {
  const show = () => { tip.innerHTML = html; positionTip(tip, bar, wrap); };
  const hide = () => tip.classList.add("hidden");
  bar.addEventListener("mouseenter", show);
  bar.addEventListener("mouseleave", hide);
  bar.addEventListener("click", (e) => { e.stopPropagation(); show(); }); // touch
}

/* ---------- daily chart ---------- */

function renderDaily() {
  const h = currentHabit;
  const dates = activeDates();
  const barsEl = document.getElementById("daily-bars");
  const tip = document.getElementById("daily-tip");
  const wrap = barsEl.parentElement;

  document.getElementById("daily-title").textContent = `Daily ${h.name.toLowerCase()}`;
  document.getElementById("daily-sub").textContent =
    dates.length ? `${dates.length} days · hover a bar for detail` : "";

  if (!dates.length) {
    barsEl.innerHTML = `<p class="muted-note">Nothing logged in this range yet.</p>`;
    document.getElementById("daily-y").innerHTML = "";
    document.getElementById("daily-grid").innerHTML = "";
    document.getElementById("daily-x").innerHTML = "";
    return;
  }

  const displayVals = dates.map((d) => toDisplay(h, valuesByDate[d] || 0));
  const maxDisplay = niceMax(Math.max(...displayVals, toDisplay(h, h.target || 0)));
  renderAxis(document.getElementById("daily-y"), document.getElementById("daily-grid"), maxDisplay, h);

  barsEl.innerHTML = "";
  barsEl.classList.toggle("dense", dates.length > 120);

  dates.forEach((d, i) => {
    const stored = valuesByDate[d] || 0;
    const disp = displayVals[i];
    const hit = h.target && stored >= h.target;
    const bar = document.createElement("div");
    bar.className = "bar" + (hit ? " hit" : "") + (stored === 0 ? " zero" : "");
    bar.style.height = Math.max(stored > 0 ? 2 : 1, (disp / maxDisplay) * 100) + "%";
    barsEl.appendChild(bar);

    attachTip(bar, tip, wrap, `
      <div class="tip-date">${fullDate(d)}</div>
      <div class="tip-val">${fmt(h, stored)}</div>
      ${h.target ? `<div class="tip-meta">${hit ? "target hit" : `target ${fmt(h, h.target)}`}</div>` : ""}
    `);
  });

  // sparse x labels so they never collide
  const xEl = document.getElementById("daily-x");
  const labelCount = Math.min(6, dates.length);
  const stepIdx = Math.max(1, Math.floor(dates.length / labelCount));
  xEl.innerHTML = dates
    .map((d, i) => (i % stepIdx === 0 || i === dates.length - 1)
      ? `<span style="left:${(i / (dates.length - 1 || 1)) * 100}%">${shortDate(d)}</span>` : "")
    .join("");
}

/* ---------- day-of-week chart ---------- */

function renderDow() {
  const h = currentHabit;
  const dates = activeDates();
  const barsEl = document.getElementById("dow-bars");
  const tip = document.getElementById("dow-tip");
  const wrap = barsEl.parentElement;

  if (!dates.length) {
    barsEl.innerHTML = `<p class="muted-note">Nothing logged in this range yet.</p>`;
    document.getElementById("dow-y").innerHTML = "";
    document.getElementById("dow-grid").innerHTML = "";
    document.getElementById("dow-x").innerHTML = "";
    document.getElementById("dow-sub").textContent = "";
    return;
  }

  const buckets = {};
  for (const dow of DOW_ORDER) buckets[dow] = { sum: 0, days: 0, logged: 0, hit: 0 };
  for (const d of dates) {
    const stored = valuesByDate[d] || 0;
    const b = buckets[dowOf(d)];
    b.sum += stored;
    b.days++;
    if (stored > 0) b.logged++;
    if (h.target && stored >= h.target) b.hit++;
  }

  const averages = DOW_ORDER.map((dow) => {
    const b = buckets[dow];
    return { dow, avg: b.days ? b.sum / b.days : 0, ...b };
  });

  const maxDisplay = niceMax(Math.max(...averages.map((a) => toDisplay(h, a.avg)), 0.1));
  renderAxis(document.getElementById("dow-y"), document.getElementById("dow-grid"), maxDisplay, h);

  const best = averages.reduce((m, a) => (a.avg > m.avg ? a : m), averages[0]);
  document.getElementById("dow-sub").textContent =
    best.avg > 0 ? `Strongest: ${DOW_FULL[best.dow]}` : "";

  barsEl.innerHTML = "";
  averages.forEach((a) => {
    const disp = toDisplay(h, a.avg);
    const bar = document.createElement("div");
    bar.className = "bar" + (a.dow === best.dow && a.avg > 0 ? " best" : "");
    bar.style.height = Math.max(a.avg > 0 ? 2 : 1, (disp / maxDisplay) * 100) + "%";
    barsEl.appendChild(bar);

    attachTip(bar, tip, wrap, `
      <div class="tip-date">${DOW_FULL[a.dow]}</div>
      <div class="tip-val">${fmt(h, a.avg)} avg</div>
      <div class="tip-meta">${a.logged} of ${a.days} ${a.days === 1 ? "day" : "days"} logged${
        h.target ? ` · ${a.hit} hit target` : ""
      }</div>
    `);
  });

  document.getElementById("dow-x").innerHTML =
    DOW_ORDER.map((dow) => `<span>${DOW_LABEL[dow]}</span>`).join("");
}

/* ---------- summary ---------- */

function renderSummary() {
  const h = currentHabit;
  const dates = activeDates();
  const vals = dates.map((d) => valuesByDate[d] || 0);
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = dates.length ? total / dates.length : 0;
  const best = vals.length ? Math.max(...vals) : 0;
  const hit = h.target ? vals.filter((v) => v >= h.target).length : 0;

  const unit = unitLabel(h);
  const num = (stored) => {
    const v = toDisplay(h, stored);
    return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  };

  if (!dates.length) {
    ["stat-total", "stat-avg", "stat-best", "stat-hit"].forEach((id) => {
      document.getElementById(id).textContent = "—";
    });
    return;
  }

  document.getElementById("stat-total").innerHTML = `${num(total)}<small>${unit}</small>`;
  document.getElementById("stat-avg").innerHTML = `${num(avg)}<small>${unit}</small>`;
  document.getElementById("stat-best").innerHTML = `${num(best)}<small>${unit}</small>`;
  document.getElementById("stat-hit").innerHTML = h.target
    ? `${hit}<small>/${dates.length}</small>`
    : `—`;
}

/* ---------- wiring ---------- */

async function refresh() {
  await loadValues();
  renderSummary();
  renderDaily();
  renderDow();
}

habitSelect.addEventListener("change", () => {
  currentHabit = numericHabits.find((h) => h.key === habitSelect.value);
  refresh();
});

rangeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  rangeSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
  currentRange = btn.dataset.range;
  if (currentRange === "custom") {
    customStart = customStart || addDays(todayStr(), -29);
    customEnd = customEnd || todayStr();
    rangeStartInput.value = customStart;
    rangeEndInput.value = customEnd;
    rangeStartInput.max = todayStr();
    rangeEndInput.max = todayStr();
    customRangeEl.classList.remove("hidden");
  } else {
    customRangeEl.classList.add("hidden");
  }
  refresh();
});

rangeStartInput.addEventListener("change", () => {
  customStart = rangeStartInput.value;
  if (customEnd && customStart > customEnd) { customEnd = customStart; rangeEndInput.value = customEnd; }
  refresh();
});

rangeEndInput.addEventListener("change", () => {
  customEnd = rangeEndInput.value;
  if (customStart && customEnd < customStart) { customStart = customEnd; rangeStartInput.value = customStart; }
  refresh();
});

// tapping anywhere clears a tooltip opened by touch
document.addEventListener("click", () => {
  document.querySelectorAll(".tooltip").forEach((t) => t.classList.add("hidden"));
});

window.addEventListener("resize", () => {
  document.querySelectorAll(".tooltip").forEach((t) => t.classList.add("hidden"));
});

async function init() {
  loadingView.classList.add("hidden");
  trendsView.classList.remove("hidden");
  const hasNumeric = await loadHabitList();
  if (hasNumeric) await refresh();
}

getSession().then((session) => {
  if (!session) { window.location.href = "index.html"; return; }
  init().catch((err) => {
    console.error(err);
    alert("Couldn't load your trends.");
  });
});
