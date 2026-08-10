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
const noNumericEl = document.getElementById("no-habits");
const cardDaily = document.getElementById("card-daily");
const cardGrid = document.getElementById("card-grid");

let allHabits = [];
let currentHabit = null;
let currentRange = "30d";
let customStart = null;
let customEnd = null;
let valuesByDate = {}; // 'YYYY-MM-DD' -> minutes/count (measurable habits)
let doneByDate = {};   // 'YYYY-MM-DD' -> true (yes/no habits)

function isMeasurable(h) { return h && (h.type === "duration" || h.type === "count"); }

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
  allHabits = await getHabits();

  if (!allHabits.length) {
    chartsEl.classList.add("hidden");
    noNumericEl.classList.remove("hidden");
    habitSelect.classList.add("hidden");
    return false;
  }

  habitSelect.innerHTML = allHabits
    .map((h) => `<option value="${h.key}">${h.emoji} ${h.name}</option>`)
    .join("");

  // default to Work when it's on, otherwise the first habit
  currentHabit = allHabits.find((h) => h.key === "work") || allHabits[0];
  habitSelect.value = currentHabit.key;
  return true;
}

async function loadValues() {
  const { start, end } = rangeBounds();
  const rows = await getEntries(start, end);
  valuesByDate = {};
  doneByDate = {};
  for (const r of rows) {
    if (r.habit_id !== currentHabit.key) continue;
    valuesByDate[r.date] = r.value || 0;
    if (r.done) doneByDate[r.date] = true;
  }
}

// Days actually in play: never count days before this habit's first entry,
// so a wide range doesn't dilute rates with pre-tracking days.
function activeDates() {
  const { start, end } = rangeBounds();
  const today = todayStr();
  const realEnd = end > today ? today : end;
  // a yes/no habit only ever writes a row when it's touched, so consider both maps
  const logged = Object.keys(
    Object.assign({}, valuesByDate, doneByDate)
  ).sort();
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

/* ---------- completion calendar (yes/no habits) ---------- */

function renderGrid() {
  const h = currentHabit;
  const dates = activeDates();
  const holder = document.getElementById("grid-holder");

  document.getElementById("grid-title").textContent = `${h.name} calendar`;

  if (!dates.length) {
    holder.innerHTML = `<p class="muted-note">Nothing logged in this range yet.</p>`;
    document.getElementById("grid-sub").textContent = "";
    return;
  }

  const done = dates.filter((d) => doneByDate[d]).length;
  document.getElementById("grid-sub").textContent =
    `${done} of ${dates.length} days · ${Math.round((done / dates.length) * 100)}%`;

  buildCalendarGrid(holder, dates, (d) => (doneByDate[d] ? "g" : ""), {
    showLabels: true,
    showMonths: true,
    todayDate: todayStr(),
  });
}

/* ---------- day-of-week: miss rate (yes/no habits) ---------- */

function renderDowMissRate() {
  const h = currentHabit;
  const dates = activeDates();
  const barsEl = document.getElementById("dow-bars");
  const tip = document.getElementById("dow-tip");
  const wrap = barsEl.parentElement;

  document.getElementById("dow-title").textContent = "Miss rate by day of week";

  if (!dates.length) {
    barsEl.innerHTML = `<p class="muted-note">Nothing logged in this range yet.</p>`;
    document.getElementById("dow-y").innerHTML = "";
    document.getElementById("dow-grid").innerHTML = "";
    document.getElementById("dow-x").innerHTML = "";
    document.getElementById("dow-sub").textContent = "";
    return;
  }

  const buckets = {};
  for (const dow of DOW_ORDER) buckets[dow] = { days: 0, missed: 0 };
  for (const d of dates) {
    const b = buckets[dowOf(d)];
    b.days++;
    if (!doneByDate[d]) b.missed++;
  }

  const rates = DOW_ORDER.map((dow) => {
    const b = buckets[dow];
    return { dow, rate: b.days ? (b.missed / b.days) * 100 : 0, ...b };
  });

  // always scale 0-100 so the percentages read honestly
  const ticks = [100, 75, 50, 25, 0];
  document.getElementById("dow-y").innerHTML = ticks.map((t) => `<span>${t}%</span>`).join("");
  document.getElementById("dow-grid").innerHTML = ticks.map(() => `<div class="gridline"></div>`).join("");

  const worst = rates.reduce((m, a) => (a.rate > m.rate ? a : m), rates[0]);
  document.getElementById("dow-sub").textContent =
    worst.rate > 0 ? `Most missed: ${DOW_FULL[worst.dow]}` : "No misses in this range";

  barsEl.innerHTML = "";
  rates.forEach((a) => {
    const bar = document.createElement("div");
    const isWorst = a.dow === worst.dow && a.rate > 0;
    bar.className = "bar miss" + (isWorst ? " worst" : "") + (a.rate === 0 ? " zero" : "");
    bar.style.height = Math.max(a.rate > 0 ? 2 : 1, a.rate) + "%";
    barsEl.appendChild(bar);

    attachTip(bar, tip, wrap, `
      <div class="tip-date">${DOW_FULL[a.dow]}</div>
      <div class="tip-val">${Math.round(a.rate)}% missed</div>
      <div class="tip-meta">missed ${a.missed} of ${a.days} ${a.days === 1 ? "day" : "days"}</div>
    `);
  });

  document.getElementById("dow-x").innerHTML =
    DOW_ORDER.map((dow) => `<span>${DOW_LABEL[dow]}</span>`).join("");
}

/* ---------- day-of-week chart ---------- */

function renderDow() {
  const h = currentHabit;
  const dates = activeDates();
  const barsEl = document.getElementById("dow-bars");
  const tip = document.getElementById("dow-tip");
  const wrap = barsEl.parentElement;

  document.getElementById("dow-title").textContent = "Average by day of week";

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

function setStat(slot, value, label) {
  document.getElementById(`stat-${slot}`).innerHTML = value;
  document.getElementById(`stat-${slot}-k`).textContent = label;
}

// longest run of consecutive completed days, and the run ending most recently
function streaksFor(dates) {
  let best = 0, run = 0;
  for (const d of dates) {
    if (doneByDate[d]) { run++; if (run > best) best = run; }
    else run = 0;
  }
  let current = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (doneByDate[dates[i]]) current++;
    else if (i === dates.length - 1) continue; // today unfinished doesn't break it
    else break;
  }
  return { best, current };
}

function renderSummary() {
  const h = currentHabit;
  const dates = activeDates();

  if (!dates.length) {
    [1, 2, 3, 4].forEach((s) => document.getElementById(`stat-${s}`).textContent = "—");
    return;
  }

  if (isMeasurable(h)) {
    const vals = dates.map((d) => valuesByDate[d] || 0);
    const total = vals.reduce((a, b) => a + b, 0);
    const best = Math.max(...vals);
    const hit = h.target ? vals.filter((v) => v >= h.target).length : 0;
    const unit = unitLabel(h);
    const num = (stored) => {
      const v = toDisplay(h, stored);
      return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
    };
    setStat(1, `${num(total)}<small>${unit}</small>`, "Total");
    setStat(2, `${num(total / dates.length)}<small>${unit}</small>`, "Daily average");
    setStat(3, `${num(best)}<small>${unit}</small>`, "Best day");
    setStat(4, h.target ? `${hit}<small>/${dates.length}</small>` : "—", "Days target hit");
    return;
  }

  const done = dates.filter((d) => doneByDate[d]).length;
  const { best, current } = streaksFor(dates);
  setStat(1, `${done}<small>/${dates.length}</small>`, "Days completed");
  setStat(2, `${Math.round((done / dates.length) * 100)}<small>%</small>`, "Completion rate");
  setStat(3, `${current}<small>d</small>`, "Current streak");
  setStat(4, `${best}<small>d</small>`, "Best streak");
}

/* ---------- wiring ---------- */

async function refresh() {
  await loadValues();
  const measurable = isMeasurable(currentHabit);

  cardDaily.classList.toggle("hidden", !measurable);
  cardGrid.classList.toggle("hidden", measurable);

  renderSummary();
  if (measurable) {
    renderDaily();
    renderDow();
  } else {
    renderGrid();
    renderDowMissRate();
  }
}

habitSelect.addEventListener("change", () => {
  currentHabit = allHabits.find((h) => h.key === habitSelect.value);
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
