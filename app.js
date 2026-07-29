/* The fixed library of habits people can switch on. `key` is permanent —
   entries.habit_id points at it, so renaming or reconfiguring never orphans history. */
const HABIT_PRESETS = [
  {
    key: "sleep", name: "Sleep by", emoji: "😴", type: "time",
    time_of_day: "21:00", target: null, unit: null, defaultOn: true,
  },
  {
    key: "exercise", name: "Exercise", emoji: "🏋️", type: "boolean",
    target: null, unit: null, defaultOn: true,
  },
  {
    key: "work", name: "Work", emoji: "💼", type: "duration",
    target: 300, unit: "min", unitOptions: ["min", "hr"], defaultOn: true,
  },
  {
    key: "meals", name: "Meals", emoji: "🍽️", type: "count",
    target: 3, unit: "meals", defaultOn: true,
  },
  {
    key: "water", name: "Water intake", emoji: "💧", type: "count",
    target: 8, unit: "glasses", unitOptions: ["glasses", "oz", "ml", "L"], defaultOn: false,
  },
  {
    key: "journaling", name: "Journaling", emoji: "✍️", type: "boolean",
    target: null, unit: null, defaultOn: false,
  },
  {
    key: "mindfulness", name: "Mindfulness", emoji: "🧘", type: "duration",
    target: 15, unit: "min", unitOptions: ["min", "hr"], defaultOn: false,
  },
];

const STREAK_FETCH_DAYS = 400;
const MUTE_KEY = "soundMuted";
const RING_CIRCUMFERENCE = 301.6;
const DENSE_STRIP_THRESHOLD = 45;
const YELLOW_MIN_HABITS = 3; // below this, missing one habit is too big to call "yellow"

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const habitsEl = document.getElementById("habits");
const emptyState = document.getElementById("empty-state");
const signOutBtn = document.getElementById("sign-out");
const todayLabel = document.getElementById("today-label");
const rangeSeg = document.getElementById("range-seg");
const customRangeEl = document.getElementById("custom-range");
const rangeStartInput = document.getElementById("range-start");
const rangeEndInput = document.getElementById("range-end");
const soundToggle = document.getElementById("sound-toggle");
const settingsBtn = document.getElementById("settings-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsList = document.getElementById("settings-list");
const dayOverlay = document.getElementById("day-overlay");
const dayList = document.getElementById("day-list");
const dayDateInput = document.getElementById("day-date");
const dayPrevBtn = document.getElementById("day-prev");
const dayNextBtn = document.getElementById("day-next");

let HABITS = [];       // active habits, from the database
let allHabitRows = []; // including archived, so toggles know what already exists
let entriesByHabit = {};
let currentUserId = null;
let currentRange = "30d";
let customStart = null;
let customEnd = null;
let timerIntervals = {};
let lastAllGreen = false;
let editorDate = null;      // day currently open in the editor
let editorEntries = {};     // { habitKey: { done, value } } for that day

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
  while (cur <= end) {
    list.push(cur);
    cur = addDays(cur, 1);
  }
  return list;
}

function displayRangeBounds() {
  const end = todayStr();
  switch (currentRange) {
    case "30d": return { start: addDays(end, -29), end, label: "LAST 30 DAYS" };
    case "90d": return { start: addDays(end, -89), end, label: "LAST 90 DAYS" };
    case "6m": return { start: addDays(end, -181), end, label: "LAST 6 MONTHS" };
    case "12m": return { start: addDays(end, -364), end, label: "LAST 12 MONTHS" };
    case "ytd": return { start: `${new Date().getFullYear()}-01-01`, end, label: "YEAR TO DATE" };
    case "custom":
      return { start: customStart || addDays(end, -29), end: customEnd || end, label: "CUSTOM RANGE" };
    default: return { start: addDays(end, -29), end, label: "LAST 30 DAYS" };
  }
}

function formatTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

/* ---------- habit value formatting ----------
   Duration targets are ALWAYS stored in minutes; `unit` only changes display,
   so switching min↔hr never rewrites stored data. */

function presetFor(key) {
  return HABIT_PRESETS.find((p) => p.key === key) || {};
}

function displayValue(h, minutesOrCount) {
  if (h.type === "duration" && h.unit === "hr") {
    return (minutesOrCount / 60).toFixed(1).replace(/\.0$/, "");
  }
  return String(minutesOrCount);
}

function displayTarget(h) {
  return displayValue(h, h.target || 0);
}

function unitLabel(h) {
  if (h.type === "duration") return h.unit === "hr" ? "hr" : "min";
  return h.unit || "";
}

// Step size for the +/- buttons, in stored units.
function stepFor(h) {
  if (h.type === "duration") return h.unit === "hr" ? 30 : 15;
  if (h.unit === "oz") return 8;
  if (h.unit === "ml") return 250;
  return 1;
}

function habitTitle(h) {
  return h.type === "time" ? `${h.name} ${formatTime(h.time_of_day)}` : h.name;
}

/* ---------- sound ---------- */

let audioCtx = null;

function isMuted() {
  return localStorage.getItem(MUTE_KEY) === "1";
}

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone(freqFrom, freqTo, startAt, duration, peak) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + startAt;
  osc.type = "sine";
  osc.frequency.setValueAtTime(freqFrom, t);
  osc.frequency.exponentialRampToValueAtTime(freqTo, t + duration * 0.7);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function playPop() { if (!isMuted()) tone(520, 880, 0, 0.16, 0.16); }
function playChime() {
  if (isMuted()) return;
  tone(660, 700, 0, 0.22, 0.14);
  tone(990, 1050, 0.12, 0.34, 0.13);
}
function updateSoundButton() { soundToggle.textContent = isMuted() ? "🔇" : "🔊"; }

/* ---------- data ---------- */

function presetToRow(p, sortOrder) {
  return {
    key: p.key, name: p.name, emoji: p.emoji, type: p.type,
    target: p.target, unit: p.unit, time_of_day: p.time_of_day || null,
    sort_order: sortOrder, archived: false,
  };
}

async function loadHabits() {
  allHabitRows = await getHabits({ includeArchived: true });

  if (!allHabitRows.length) {
    // Brand-new user: switch on the sensible defaults.
    const seed = HABIT_PRESETS
      .filter((p) => p.defaultOn)
      .map((p, i) => presetToRow(p, HABIT_PRESETS.indexOf(p)));
    await seedHabits(seed);
    allHabitRows = await getHabits({ includeArchived: true });
  }

  HABITS = allHabitRows
    .filter((h) => !h.archived)
    .sort((a, b) => a.sort_order - b.sort_order);
}

async function loadEntries() {
  const display = displayRangeBounds();
  const streakStart = addDays(todayStr(), -STREAK_FETCH_DAYS);
  const fetchStart = display.start < streakStart ? display.start : streakStart;
  const fetchEnd = display.end > todayStr() ? display.end : todayStr();
  const rows = await getEntries(fetchStart, fetchEnd);
  entriesByHabit = {};
  for (const h of HABITS) entriesByHabit[h.key] = {};
  for (const row of rows) {
    if (!entriesByHabit[row.habit_id]) entriesByHabit[row.habit_id] = {};
    entriesByHabit[row.habit_id][row.date] = { done: row.done, value: row.value };
  }
}

function isDone(habitKey, date) {
  const e = entriesByHabit[habitKey] && entriesByHabit[habitKey][date];
  return !!(e && e.done);
}

function computeStreak(habitKey) {
  let streak = 0;
  let d = todayStr();
  while (isDone(habitKey, d)) { streak++; d = addDays(d, -1); }
  return streak;
}

function completedToday() {
  return HABITS.filter((h) => isDone(h.key, todayStr())).length;
}

function computeDayStatus(date) {
  if (!HABITS.length) return "none";
  let hasData = false;
  let missed = 0;
  for (const h of HABITS) {
    const e = entriesByHabit[h.key] && entriesByHabit[h.key][date];
    if (e) hasData = true;
    if (!(e && e.done)) missed++;
  }
  if (!hasData) return "none";
  if (missed === 0) return "green";
  // With only 1-2 habits, missing one is too much of the day to call "yellow".
  if (missed === 1 && HABITS.length >= YELLOW_MIN_HABITS) return "yellow";
  return "red";
}

// Today only breaks the streak once it's over — an unfinished today
// shouldn't zero out yesterday's run.
function computeAllGreenStreak() {
  let d = todayStr();
  let streak = computeDayStatus(d) === "green" ? 1 : 0;
  d = addDays(d, -1);
  while (computeDayStatus(d) === "green") { streak++; d = addDays(d, -1); }
  return streak;
}

function computeBestStreak() {
  let best = 0, run = 0;
  for (const d of dateList(addDays(todayStr(), -STREAK_FETCH_DAYS), todayStr())) {
    if (computeDayStatus(d) === "green") { run++; if (run > best) best = run; }
    else run = 0;
  }
  return best;
}

function computeRangeStats() {
  const { start, end } = displayRangeBounds();
  const today = todayStr();
  const days = dateList(start, end > today ? today : end);
  if (!days.length || !HABITS.length) return { greenPct: 0, completionPct: 0 };
  let green = 0, done = 0;
  for (const d of days) {
    if (computeDayStatus(d) === "green") green++;
    for (const h of HABITS) if (isDone(h.key, d)) done++;
  }
  return {
    greenPct: Math.round((green / days.length) * 100),
    completionPct: Math.round((done / (days.length * HABITS.length)) * 100),
  };
}

/* ---------- strips ---------- */

const STATUS_CLASS = { green: "g", yellow: "y", red: "r", none: "" };

function buildStrip(container, dates, classForDate, mini) {
  const dense = dates.length > DENSE_STRIP_THRESHOLD;
  container.className = "strip-wrap" + (mini ? " mini" : "");
  const today = todayStr();
  container.innerHTML = `<div class="strip ${dense ? "grid" : "row"}">${
    dates.map((d) => `<div class="cell ${classForDate(d)}${d === today ? " today" : ""}" title="${d}"></div>`).join("")
  }</div>`;
}

/* ---------- tracker ---------- */

function statusCopy(status) {
  const total = HABITS.length;
  if (!total) return { pill: "No habits on", head: "Nothing to track.", sub: "Open settings to switch some habits on." };
  if (status === "none") return { pill: "Nothing logged yet", head: "Fresh start.", sub: "Log your first habit to get today moving." };
  if (status === "green") return { pill: `All ${total} done`, head: "Day closed green.", sub: "That's the whole board. Nicely done." };
  const remaining = HABITS.filter((h) => !isDone(h.key, todayStr()));
  const names = remaining.map((h) => h.name).join(" and ");
  if (remaining.length === 1) return { pill: "One left to go", head: "Almost there.", sub: `Finish <b>${names}</b> to close the day green.` };
  return { pill: `${remaining.length} left`, head: "Still in play.", sub: `<b>${names}</b> remaining today.` };
}

function updateTracker() {
  const count = completedToday();
  const total = HABITS.length;
  const status = computeDayStatus(todayStr());
  const { start, end, label } = displayRangeBounds();

  document.querySelector(".ring-fg").style.strokeDashoffset =
    total ? RING_CIRCUMFERENCE * (1 - count / total) : RING_CIRCUMFERENCE;
  document.getElementById("ring-count").textContent = count;
  document.querySelector(".ring-den").textContent = `/${total}`;

  const copy = statusCopy(status);
  document.getElementById("status-pill").className = "status s-" + status;
  document.getElementById("status-text").textContent = copy.pill;
  document.getElementById("status-headline").textContent = copy.head;
  document.getElementById("status-sub").innerHTML = copy.sub;

  const stats = computeRangeStats();
  document.getElementById("stat-streak").innerHTML = `${computeAllGreenStreak()}<small>d</small>`;
  document.getElementById("stat-rate").innerHTML = `${stats.greenPct}<small>%</small>`;
  document.getElementById("stat-best").innerHTML = `${computeBestStreak()}<small>d</small>`;
  document.getElementById("stat-completion").innerHTML = `${stats.completionPct}<small>%</small>`;

  document.getElementById("strip-label").textContent = label;
  buildStrip(document.getElementById("master-strip"), dateList(start, end),
    (d) => STATUS_CLASS[computeDayStatus(d)], false);
}

function celebrate() {
  const host = document.getElementById("confetti");
  const colors = ["#46E09B", "#3ECF8E", "#F0B429", "#7FE3B6", "#2FB5D6"];
  for (let i = 0; i < 22; i++) {
    const s = document.createElement("span");
    const size = 4 + Math.random() * 5;
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.background = colors[i % colors.length];
    host.appendChild(s);
    const angle = (Math.PI * 2 * i) / 22 + Math.random() * 0.4;
    const dist = 55 + Math.random() * 45;
    s.animate([
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.2)`, opacity: 0 },
    ], { duration: 700 + Math.random() * 350, easing: "cubic-bezier(.15,.7,.3,1)" }).onfinish = () => s.remove();
  }
  document.querySelector(".ring").animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
    { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" });
}

/* ---------- habit cards ---------- */

function cardEl(habitKey) {
  return habitsEl.querySelector(`.card[data-habit="${CSS.escape(habitKey)}"]`);
}

function habitByKey(habitKey) {
  return HABITS.find((h) => h.key === habitKey);
}

function rangeHitCount(habitKey) {
  const { start, end } = displayRangeBounds();
  const today = todayStr();
  const days = dateList(start, end > today ? today : end);
  return { hit: days.filter((d) => isDone(habitKey, d)).length, total: days.length };
}

function isTappable(h) { return h.type === "boolean" || h.type === "time"; }
function isNumeric(h) { return h.type === "duration" || h.type === "count"; }

function renderCards() {
  const { start, end } = displayRangeBounds();
  const dates = dateList(start, end);

  emptyState.classList.toggle("hidden", HABITS.length > 0);
  habitsEl.classList.toggle("hidden", HABITS.length === 0);

  habitsEl.innerHTML = HABITS.map((h) => {
    const step = stepFor(h);
    return `
      <div class="card" data-habit="${h.key}">
        <div class="chead">
          <div class="icon">${h.emoji}</div>
          <div class="cinfo">
            <div class="cname">${habitTitle(h)}</div>
            <div class="cmeta"><span class="flame"></span><span class="rate"></span></div>
          </div>
          <button class="tick${isTappable(h) ? "" : " tick-static"}"${isTappable(h) ? "" : " disabled"}>✓</button>
        </div>
        ${isNumeric(h) ? `
          <div class="bar"><div class="fill"></div></div>
          <div class="barcap"><span class="barval"></span><span class="barleft"></span></div>
          <div class="timerrow">
            ${h.type === "duration" ? `
              <button class="tbtn"><span class="sq"></span><span class="tbtn-label">Start</span></button>
              <span class="clock">00:00</span>` : ""}
            <div class="pills">
              <button data-delta="-${step}">&minus;${step}</button>
              <button data-delta="${step}">+${step}</button>
            </div>
          </div>` : ""}
        <div class="strip-wrap mini"></div>
        <div class="minicap"><span class="cap-start"></span><span>Today</span></div>
      </div>`;
  }).join("");

  for (const h of HABITS) {
    const card = cardEl(h.key);
    buildStrip(card.querySelector(".strip-wrap"), dates, (d) => (isDone(h.key, d) ? "g" : ""), true);
    card.querySelector(".cap-start").textContent = `${dates.length} days ago`;
    updateCard(h.key);

    if (isTappable(h)) {
      card.querySelector(".tick").addEventListener("click", () => onToggle(h.key));
    } else {
      card.querySelectorAll(".pills button").forEach((btn) => {
        btn.addEventListener("click", () => adjustValue(h.key, parseInt(btn.dataset.delta, 10)));
      });
      if (h.type === "duration") {
        card.querySelector(".tbtn").addEventListener("click", () => {
          if (getTimerState(h.key)) stopTimer(h.key); else startTimer(h.key);
        });
        if (getTimerState(h.key)) tickTimer(h.key);
      }
    }
  }
}

function updateCard(habitKey) {
  const h = habitByKey(habitKey);
  const card = cardEl(habitKey);
  if (!h || !card) return;

  const today = todayStr();
  const done = isDone(habitKey, today);
  const { hit, total } = rangeHitCount(habitKey);

  card.classList.toggle("done", done);
  card.querySelector(".flame").textContent = `🔥 ${computeStreak(habitKey)} day streak`;
  card.querySelector(".rate").textContent = `· ${hit}/${total} days`;

  if (isNumeric(h)) {
    const entry = (entriesByHabit[habitKey] && entriesByHabit[habitKey][today]) || { value: 0 };
    const value = entry.value || 0;
    const target = h.target || 1;
    card.querySelector(".fill").style.width = Math.min(100, Math.round((value / target) * 100)) + "%";
    card.querySelector(".barval").innerHTML =
      `<b>${displayValue(h, value)}</b> / ${displayTarget(h)} ${unitLabel(h)}`;
    card.querySelector(".barleft").textContent = value >= target
      ? "target hit"
      : `${displayValue(h, target - value)} ${unitLabel(h)} left`;
    if (h.type === "duration") updateTimerUI(habitKey);
  }

  const cells = card.querySelectorAll(".cell");
  const last = cells[cells.length - 1];
  if (last && last.title === today) last.className = "cell" + (done ? " g" : "") + " today";
}

function animateTick(habitKey) {
  const card = cardEl(habitKey);
  if (!card) return;
  card.querySelector(".tick").animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.35)", offset: 0.45 }, { transform: "scale(1)" }],
    { duration: 380, easing: "cubic-bezier(.2,.9,.25,1.2)" });
  card.animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(-4px)" }, { transform: "translateY(0)" }],
    { duration: 420, easing: "ease-out" });
}

/* ---------- timers (duration habits only, scoped per user) ---------- */

function timerKey(habitKey) { return `timer:${currentUserId || "anon"}:${habitKey}`; }

function getTimerState(habitKey) {
  try {
    const raw = localStorage.getItem(timerKey(habitKey));
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state.date !== todayStr()) { localStorage.removeItem(timerKey(habitKey)); return null; }
    return state;
  } catch { return null; }
}

function updateTimerUI(habitKey) {
  const card = cardEl(habitKey);
  if (!card || !card.querySelector(".tbtn")) return;
  const running = !!getTimerState(habitKey);
  card.querySelector(".tbtn").classList.toggle("running", running);
  card.querySelector(".tbtn-label").textContent = running ? "Stop" : "Start";
  const clock = card.querySelector(".clock");
  clock.classList.toggle("live", running);
  if (!running) clock.textContent = "00:00";
}

function startTimer(habitKey) {
  ensureAudio();
  localStorage.setItem(timerKey(habitKey), JSON.stringify({ startTs: Date.now(), date: todayStr() }));
  updateTimerUI(habitKey);
  tickTimer(habitKey);
}

async function stopTimer(habitKey) {
  const state = getTimerState(habitKey);
  if (!state) return;
  const elapsed = Math.round((Date.now() - state.startTs) / 60000);
  localStorage.removeItem(timerKey(habitKey));
  clearInterval(timerIntervals[habitKey]);
  updateTimerUI(habitKey);
  if (elapsed > 0) await adjustValue(habitKey, elapsed);
}

function tickTimer(habitKey) {
  clearInterval(timerIntervals[habitKey]);
  const render = () => {
    const state = getTimerState(habitKey);
    const card = cardEl(habitKey);
    const el = card && card.querySelector(".clock");
    if (!state || !el) { clearInterval(timerIntervals[habitKey]); return; }
    const secs = Math.floor((Date.now() - state.startTs) / 1000);
    el.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  };
  render();
  timerIntervals[habitKey] = setInterval(render, 1000);
}

/* ---------- mutations ---------- */

function afterChange(habitKey, wasDone) {
  updateCard(habitKey);
  updateTracker();
  const nowAllGreen = computeDayStatus(todayStr()) === "green";
  if (isDone(habitKey, todayStr()) && !wasDone) {
    animateTick(habitKey);
    if (nowAllGreen && !lastAllGreen) { celebrate(); playChime(); }
    else playPop();
  }
  lastAllGreen = nowAllGreen;
}

function revert(habitKey, prev) {
  entriesByHabit[habitKey][todayStr()] = prev;
  updateCard(habitKey);
  updateTracker();
  lastAllGreen = computeDayStatus(todayStr()) === "green";
  alert("Couldn't save that — check your connection and try again.");
}

async function onToggle(habitKey) {
  ensureAudio();
  const today = todayStr();
  const prev = (entriesByHabit[habitKey] && entriesByHabit[habitKey][today]) || { done: false, value: null };
  const wasDone = !!prev.done;
  entriesByHabit[habitKey][today] = { done: !wasDone, value: null };
  afterChange(habitKey, wasDone);
  try {
    await setEntry(habitKey, today, { done: !wasDone });
  } catch (err) { console.error(err); revert(habitKey, prev); }
}

async function adjustValue(habitKey, delta) {
  ensureAudio();
  const h = habitByKey(habitKey);
  const today = todayStr();
  const prev = (entriesByHabit[habitKey] && entriesByHabit[habitKey][today]) || { value: 0, done: false };
  const wasDone = !!prev.done;
  const newValue = Math.max(0, (prev.value || 0) + delta);
  const done = newValue >= (h.target || Infinity);
  entriesByHabit[habitKey][today] = { value: newValue, done };
  afterChange(habitKey, wasDone);
  try {
    await setEntry(habitKey, today, { done, value: newValue });
  } catch (err) { console.error(err); revert(habitKey, prev); }
}

/* ---------- settings ---------- */

function rowFor(key) { return allHabitRows.find((h) => h.key === key); }

function configControls(p, row) {
  const on = row && !row.archived;
  if (!on) return "";
  const h = row;

  if (p.type === "time") {
    return `<label class="cfg">Time
      <input type="time" class="p-time" value="${h.time_of_day || p.time_of_day}" />
    </label>`;
  }
  if (p.type === "duration") {
    return `<label class="cfg">Target
      <input type="number" class="p-target" min="1" step="${h.unit === "hr" ? "0.5" : "5"}"
             value="${displayTarget(h)}" />
    </label>
    <label class="cfg">Show as
      <select class="p-unit">
        ${p.unitOptions.map((u) => `<option value="${u}"${h.unit === u ? " selected" : ""}>${u}</option>`).join("")}
      </select>
    </label>`;
  }
  if (p.type === "count") {
    const unitPart = p.unitOptions
      ? `<label class="cfg">Unit
          <select class="p-unit">
            ${p.unitOptions.map((u) => `<option value="${u}"${h.unit === u ? " selected" : ""}>${u}</option>`).join("")}
          </select>
        </label>`
      : `<span class="cfg-static">${h.unit || p.unit}</span>`;
    return `<label class="cfg">Target
      <input type="number" class="p-target" min="1" step="1" value="${h.target}" />
    </label>${unitPart}`;
  }
  return "";
}

function renderSettings() {
  settingsList.innerHTML = HABIT_PRESETS.map((p) => {
    const row = rowFor(p.key);
    const on = !!(row && !row.archived);
    return `
      <div class="prow${on ? " on" : ""}" data-key="${p.key}">
        <div class="prow-main">
          <label class="switch">
            <input type="checkbox" class="p-toggle"${on ? " checked" : ""} />
            <span class="slider"></span>
          </label>
          <span class="p-emoji">${p.emoji}</span>
          <span class="p-name">${p.name}</span>
        </div>
        <div class="prow-config">${configControls(p, row)}</div>
      </div>`;
  }).join("");
}

async function withSettingsRefresh(fn) {
  try {
    await fn();
    await refreshAll();
  } catch (err) {
    console.error(err);
    alert("Couldn't save that change. If this keeps happening, the database policies may not be applied yet.");
  }
  renderSettings();
}

settingsList.addEventListener("change", (e) => {
  const prow = e.target.closest(".prow");
  if (!prow) return;
  const key = prow.dataset.key;
  const p = presetFor(key);
  const row = rowFor(key);

  if (e.target.classList.contains("p-toggle")) {
    const turningOn = e.target.checked;
    withSettingsRefresh(async () => {
      if (row) {
        await updateHabit(row.id, { archived: !turningOn });
      } else {
        await addHabit(presetToRow(p, HABIT_PRESETS.indexOf(p)));
      }
    });
    return;
  }

  if (!row) return;

  if (e.target.classList.contains("p-time")) {
    withSettingsRefresh(() => updateHabit(row.id, { time_of_day: e.target.value }));
  } else if (e.target.classList.contains("p-target")) {
    const raw = parseFloat(e.target.value);
    if (!(raw > 0)) return;
    // duration targets are stored in minutes regardless of display unit
    const stored = p.type === "duration" && row.unit === "hr" ? Math.round(raw * 60) : Math.round(raw);
    withSettingsRefresh(() => updateHabit(row.id, { target: stored }));
  } else if (e.target.classList.contains("p-unit")) {
    withSettingsRefresh(() => updateHabit(row.id, { unit: e.target.value }));
  }
});

function openSettings() { settingsOverlay.classList.remove("hidden"); renderSettings(); }
function closeSettings() { settingsOverlay.classList.add("hidden"); }

settingsBtn.addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("empty-add").addEventListener("click", openSettings);
settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettings(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!dayOverlay.classList.contains("hidden")) closeDayEditor();
  else if (!settingsOverlay.classList.contains("hidden")) closeSettings();
});

/* ---------- day editor (backfilling past days) ---------- */

function prettyDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = todayStr();
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// Status of the day currently open in the editor, using editorEntries.
function editorDayStatus() {
  if (!HABITS.length) return "none";
  let hasData = false;
  let missed = 0;
  for (const h of HABITS) {
    const e = editorEntries[h.key];
    if (e) hasData = true;
    if (!(e && e.done)) missed++;
  }
  if (!hasData) return "none";
  if (missed === 0) return "green";
  if (missed === 1 && HABITS.length >= YELLOW_MIN_HABITS) return "yellow";
  return "red";
}

async function loadEditorDay() {
  const rows = await getEntries(editorDate, editorDate);
  editorEntries = {};
  for (const r of rows) editorEntries[r.habit_id] = { done: r.done, value: r.value };
}

function renderDayEditor() {
  document.querySelector("#day-overlay .modal-head h2").textContent = prettyDate(editorDate);
  dayDateInput.value = editorDate;
  dayDateInput.max = todayStr();
  dayNextBtn.disabled = editorDate >= todayStr();

  const status = editorDayStatus();
  document.getElementById("day-pill").className = "status s-" + status;
  const done = HABITS.filter((h) => editorEntries[h.key] && editorEntries[h.key].done).length;
  document.getElementById("day-pill-text").textContent =
    status === "none" ? "Nothing logged" : `${done} of ${HABITS.length} done`;

  dayList.innerHTML = HABITS.map((h) => {
    const e = editorEntries[h.key] || { done: false, value: null };
    const numeric = isNumeric(h);
    return `
      <div class="drow${e.done ? " done" : ""}" data-habit="${h.key}">
        <span class="d-emoji">${h.emoji}</span>
        <span class="d-name">${habitTitle(h)}</span>
        ${numeric ? `
          <input type="number" class="d-value" min="0"
                 step="${h.type === "duration" && h.unit === "hr" ? "0.5" : "1"}"
                 value="${e.value != null ? displayValue(h, e.value) : ""}" placeholder="0" />
          <span class="d-unit">${unitLabel(h)}</span>
        ` : `
          <button class="d-tick">✓</button>
        `}
      </div>`;
  }).join("");
}

async function saveEditorEntry(habitKey, payload) {
  const prev = editorEntries[habitKey];
  editorEntries[habitKey] = { done: payload.done, value: payload.value ?? null };
  renderDayEditor();

  try {
    await setEntry(habitKey, editorDate, payload);
    // keep the dashboard in sync without a full refetch
    if (entriesByHabit[habitKey]) {
      entriesByHabit[habitKey][editorDate] = { done: payload.done, value: payload.value ?? null };
    }
    updateTracker();
    renderCards();
  } catch (err) {
    console.error(err);
    if (prev) editorEntries[habitKey] = prev; else delete editorEntries[habitKey];
    renderDayEditor();
    alert("Couldn't save that day — check your connection and try again.");
  }
}

dayList.addEventListener("click", (e) => {
  if (!e.target.classList.contains("d-tick")) return;
  const key = e.target.closest(".drow").dataset.habit;
  const wasDone = !!(editorEntries[key] && editorEntries[key].done);
  saveEditorEntry(key, { done: !wasDone, value: null });
});

dayList.addEventListener("change", (e) => {
  if (!e.target.classList.contains("d-value")) return;
  const key = e.target.closest(".drow").dataset.habit;
  const h = habitByKey(key);
  const raw = e.target.value === "" ? 0 : parseFloat(e.target.value);
  if (isNaN(raw) || raw < 0) return renderDayEditor();
  // duration is stored in minutes no matter which unit is displayed
  const stored = h.type === "duration" && h.unit === "hr" ? Math.round(raw * 60) : Math.round(raw);
  saveEditorEntry(key, { done: stored >= (h.target || Infinity), value: stored });
});

async function openDayEditor(date) {
  if (!date || date > todayStr() || !HABITS.length) return;
  editorDate = date;
  try {
    await loadEditorDay();
  } catch (err) {
    console.error(err);
    alert("Couldn't load that day.");
    return;
  }
  renderDayEditor();
  dayOverlay.classList.remove("hidden");
}

function closeDayEditor() { dayOverlay.classList.add("hidden"); }

async function stepDay(delta) {
  const next = addDays(editorDate, delta);
  if (next > todayStr()) return;
  await openDayEditor(next);
}

dayPrevBtn.addEventListener("click", () => stepDay(-1));
dayNextBtn.addEventListener("click", () => stepDay(1));
dayDateInput.addEventListener("change", () => openDayEditor(dayDateInput.value));
document.getElementById("day-close").addEventListener("click", closeDayEditor);
dayOverlay.addEventListener("click", (e) => { if (e.target === dayOverlay) closeDayEditor(); });

// any heatmap cell opens that day
function cellClickHandler(e) {
  const cell = e.target.closest(".cell");
  if (cell && cell.title) openDayEditor(cell.title);
}
document.getElementById("master-strip").addEventListener("click", cellClickHandler);
habitsEl.addEventListener("click", cellClickHandler);

// Heatmap cells are only a few pixels wide on a phone, so the editor also
// needs a real button. Opens on yesterday, the day you most likely forgot.
document.getElementById("edit-day-btn").addEventListener("click", () => {
  openDayEditor(addDays(todayStr(), -1));
});

/* ---------- view wiring ---------- */

async function refreshAll() {
  await loadHabits();
  await loadEntries();
  lastAllGreen = computeDayStatus(todayStr()) === "green";
  updateTracker();
  renderCards();
}

async function showApp(session) {
  currentUserId = session && session.user ? session.user.id : null;
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  updateSoundButton();
  try {
    await refreshAll();
  } catch (err) {
    console.error(err);
    alert("Couldn't load your habits. The database setup may still need to be applied.");
  }
}

function showLogin() { appView.classList.add("hidden"); loginView.classList.remove("hidden"); }

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  loginStatus.textContent = "Sending link...";
  try {
    await signInWithMagicLink(email);
    loginStatus.textContent = `Check ${email} for a sign-in link.`;
  } catch (err) {
    loginStatus.textContent = "Something went wrong. Try again.";
    console.error(err);
  }
});

signOutBtn.addEventListener("click", async () => {
  await signOut();
  currentUserId = null;
  showLogin();
});

soundToggle.addEventListener("click", () => {
  localStorage.setItem(MUTE_KEY, isMuted() ? "0" : "1");
  updateSoundButton();
  if (!isMuted()) playPop();
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
    customRangeEl.classList.remove("hidden");
  } else {
    customRangeEl.classList.add("hidden");
  }
  refreshAll();
});

rangeStartInput.addEventListener("change", () => {
  customStart = rangeStartInput.value;
  if (customEnd && customStart > customEnd) { customEnd = customStart; rangeEndInput.value = customEnd; }
  refreshAll();
});

rangeEndInput.addEventListener("change", () => {
  customEnd = rangeEndInput.value;
  if (customStart && customEnd < customStart) { customStart = customEnd; rangeStartInput.value = customStart; }
  refreshAll();
});

onAuthChange((session) => { if (session) showApp(session); else showLogin(); });
getSession().then((session) => { if (session) showApp(session); });
