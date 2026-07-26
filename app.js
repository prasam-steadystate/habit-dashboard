const DEFAULT_HABITS = [
  { key: "sleep", name: "Sleep by 9pm", emoji: "😴", type: "boolean", target: null, sort_order: 0 },
  { key: "exercise", name: "Exercise", emoji: "🏋️", type: "boolean", target: null, sort_order: 1 },
  { key: "meals", name: "3 meals", emoji: "🍽️", type: "boolean", target: null, sort_order: 2 },
  { key: "work", name: "Work", emoji: "💼", type: "minutes", target: 300, sort_order: 3 },
];

const STREAK_FETCH_DAYS = 400; // enough history for accurate streaks regardless of view
const MUTE_KEY = "soundMuted";
const RING_CIRCUMFERENCE = 301.6; // 2 * PI * r, r = 48
const DENSE_STRIP_THRESHOLD = 45; // beyond this many days, switch to a 7-row grid
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
const archivedSection = document.getElementById("archived-section");
const archivedList = document.getElementById("archived-list");

let HABITS = []; // active habits for the signed-in user, from the database
let entriesByHabit = {}; // { habitKey: { 'YYYY-MM-DD': { done, value } } }
let currentUserId = null;
let currentRange = "30d";
let customStart = null;
let customEnd = null;
let timerIntervals = {}; // habitKey -> setInterval id
let lastAllGreen = false; // so celebration only fires on the transition

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
      return {
        start: customStart || addDays(end, -29),
        end: customEnd || end,
        label: "CUSTOM RANGE",
      };
    default: return { start: addDays(end, -29), end, label: "LAST 30 DAYS" };
  }
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

function playPop() {
  if (isMuted()) return;
  tone(520, 880, 0, 0.16, 0.16);
}

function playChime() {
  if (isMuted()) return;
  tone(660, 700, 0, 0.22, 0.14);
  tone(990, 1050, 0.12, 0.34, 0.13);
}

function updateSoundButton() {
  soundToggle.textContent = isMuted() ? "🔇" : "🔊";
}

/* ---------- data ---------- */

async function loadHabits() {
  let active = await getHabits();
  if (!active.length) {
    // Only seed for genuinely new users — not for someone who archived everything.
    const all = await getHabits({ includeArchived: true });
    if (!all.length) {
      await seedHabits(DEFAULT_HABITS);
      active = await getHabits();
    }
  }
  HABITS = active;
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
  while (isDone(habitKey, d)) {
    streak++;
    d = addDays(d, -1);
  }
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

// Counts back from today. Today only breaks the streak once it's over —
// an unfinished today shouldn't zero out yesterday's run.
function computeAllGreenStreak() {
  let d = todayStr();
  let streak = computeDayStatus(d) === "green" ? 1 : 0;
  d = addDays(d, -1);
  while (computeDayStatus(d) === "green") {
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

function computeBestStreak() {
  const start = addDays(todayStr(), -STREAK_FETCH_DAYS);
  let best = 0;
  let run = 0;
  for (const d of dateList(start, todayStr())) {
    if (computeDayStatus(d) === "green") {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

function computeRangeStats() {
  const { start, end } = displayRangeBounds();
  const today = todayStr();
  const realEnd = end > today ? today : end;
  const days = dateList(start, realEnd);
  if (!days.length || !HABITS.length) return { greenPct: 0, completionPct: 0 };

  let green = 0;
  let done = 0;
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
  const cells = dates
    .map((d) => `<div class="cell ${classForDate(d)}${d === today ? " today" : ""}" title="${d}"></div>`)
    .join("");
  container.innerHTML = `<div class="strip ${dense ? "grid" : "row"}">${cells}</div>`;
}

/* ---------- tracker ---------- */

function statusCopy(status) {
  const total = HABITS.length;
  if (!total) {
    return { pill: "No habits yet", head: "Nothing to track.", sub: "Add a habit to get started." };
  }
  if (status === "none") {
    return { pill: "Nothing logged yet", head: "Fresh start.", sub: "Log your first habit to get today moving." };
  }
  if (status === "green") {
    return { pill: `All ${total} done`, head: "Day closed green.", sub: "That's the whole board. Nicely done." };
  }
  const remaining = HABITS.filter((h) => !isDone(h.key, todayStr()));
  const names = remaining.map((h) => h.name).join(" and ");
  if (remaining.length === 1) {
    return { pill: "One left to go", head: "Almost there.", sub: `Finish <b>${names}</b> to close the day green.` };
  }
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
  buildStrip(
    document.getElementById("master-strip"),
    dateList(start, end),
    (d) => STATUS_CLASS[computeDayStatus(d)],
    false
  );
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
    s.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.2)`,
          opacity: 0,
        },
      ],
      { duration: 700 + Math.random() * 350, easing: "cubic-bezier(.15,.7,.3,1)" }
    ).onfinish = () => s.remove();
  }

  document.querySelector(".ring").animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
    { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" }
  );
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

function renderCards() {
  const { start, end } = displayRangeBounds();
  const dates = dateList(start, end);

  emptyState.classList.toggle("hidden", HABITS.length > 0);
  habitsEl.classList.toggle("hidden", HABITS.length === 0);

  habitsEl.innerHTML = HABITS.map((h) => {
    const timed = h.type === "minutes";
    return `
      <div class="card" data-habit="${h.key}">
        <div class="chead">
          <div class="icon">${h.emoji}</div>
          <div class="cinfo">
            <div class="cname">${h.name}</div>
            <div class="cmeta"><span class="flame"></span><span class="rate"></span></div>
          </div>
          <button class="tick${timed ? " tick-static" : ""}"${timed ? " disabled" : ""}>✓</button>
        </div>
        ${timed ? `
          <div class="bar"><div class="fill"></div></div>
          <div class="barcap"><span class="barval"></span><span class="barleft"></span></div>
          <div class="timerrow">
            <button class="tbtn"><span class="sq"></span><span class="tbtn-label">Start</span></button>
            <span class="clock">00:00</span>
            <div class="pills">
              <button data-delta="-15">&minus;15</button>
              <button data-delta="15">+15</button>
            </div>
          </div>
        ` : ""}
        <div class="strip-wrap mini"></div>
        <div class="minicap"><span class="cap-start"></span><span>Today</span></div>
      </div>
    `;
  }).join("");

  for (const h of HABITS) {
    const card = cardEl(h.key);
    buildStrip(card.querySelector(".strip-wrap"), dates, (d) => (isDone(h.key, d) ? "g" : ""), true);
    card.querySelector(".cap-start").textContent = `${dates.length} days ago`;
    updateCard(h.key);

    if (h.type === "minutes") {
      card.querySelector(".tbtn").addEventListener("click", () => {
        if (getTimerState(h.key)) stopTimer(h.key);
        else startTimer(h.key);
      });
      card.querySelectorAll(".pills button").forEach((btn) => {
        btn.addEventListener("click", () => adjustMinutes(h.key, parseInt(btn.dataset.delta, 10)));
      });
      if (getTimerState(h.key)) tickTimer(h.key);
    } else {
      card.querySelector(".tick").addEventListener("click", () => onToggle(h.key));
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

  if (h.type === "minutes") {
    const entry = (entriesByHabit[habitKey] && entriesByHabit[habitKey][today]) || { value: 0 };
    const value = entry.value || 0;
    const target = h.target || 1;
    card.querySelector(".fill").style.width = Math.min(100, Math.round((value / target) * 100)) + "%";
    card.querySelector(".barval").innerHTML = `<b>${value}</b> / ${h.target} min`;
    card.querySelector(".barleft").textContent =
      value >= target ? "target hit" : `${target - value} min left`;
    updateTimerUI(habitKey);
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
    { duration: 380, easing: "cubic-bezier(.2,.9,.25,1.2)" }
  );
  card.animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(-4px)" }, { transform: "translateY(0)" }],
    { duration: 420, easing: "ease-out" }
  );
}

/* ---------- timers (one per timed habit, scoped per user) ---------- */

function timerKey(habitKey) {
  return `timer:${currentUserId || "anon"}:${habitKey}`;
}

function getTimerState(habitKey) {
  try {
    const raw = localStorage.getItem(timerKey(habitKey));
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state.date !== todayStr()) {
      localStorage.removeItem(timerKey(habitKey));
      return null;
    }
    return state;
  } catch {
    return null;
  }
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
  ensureAudio(); // unlock audio on this user gesture
  localStorage.setItem(timerKey(habitKey), JSON.stringify({ startTs: Date.now(), date: todayStr() }));
  updateTimerUI(habitKey);
  tickTimer(habitKey);
}

async function stopTimer(habitKey) {
  const state = getTimerState(habitKey);
  if (!state) return;
  const elapsedMinutes = Math.round((Date.now() - state.startTs) / 60000);
  localStorage.removeItem(timerKey(habitKey));
  clearInterval(timerIntervals[habitKey]);
  updateTimerUI(habitKey);
  if (elapsedMinutes > 0) await adjustMinutes(habitKey, elapsedMinutes);
}

function tickTimer(habitKey) {
  clearInterval(timerIntervals[habitKey]);
  const render = () => {
    const state = getTimerState(habitKey);
    const card = cardEl(habitKey);
    const el = card && card.querySelector(".clock");
    if (!state || !el) {
      clearInterval(timerIntervals[habitKey]);
      return;
    }
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
  const nowDone = isDone(habitKey, todayStr());

  if (nowDone && !wasDone) {
    animateTick(habitKey);
    if (nowAllGreen && !lastAllGreen) {
      celebrate();
      playChime();
    } else {
      playPop();
    }
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
  ensureAudio(); // user gesture — safe to unlock audio here
  const today = todayStr();
  const prev = (entriesByHabit[habitKey] && entriesByHabit[habitKey][today]) || { done: false, value: null };
  const wasDone = !!prev.done;

  entriesByHabit[habitKey][today] = { done: !wasDone, value: null }; // optimistic
  afterChange(habitKey, wasDone);

  try {
    await setEntry(habitKey, today, { done: !wasDone });
  } catch (err) {
    console.error(err);
    revert(habitKey, prev);
  }
}

async function adjustMinutes(habitKey, delta) {
  const h = habitByKey(habitKey);
  const today = todayStr();
  const prev = (entriesByHabit[habitKey] && entriesByHabit[habitKey][today]) || { value: 0, done: false };
  const wasDone = !!prev.done;
  const newValue = Math.max(0, (prev.value || 0) + delta);
  const done = newValue >= (h.target || Infinity);

  entriesByHabit[habitKey][today] = { value: newValue, done }; // optimistic
  afterChange(habitKey, wasDone);

  try {
    await setEntry(habitKey, today, { done, value: newValue });
  } catch (err) {
    console.error(err);
    revert(habitKey, prev);
  }
}

/* ---------- settings ---------- */

function newHabitKey() {
  return `h-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function settingsRow(h, archived) {
  if (archived) {
    return `
      <div class="srow archived" data-id="${h.id}">
        <span class="s-emoji-static">${h.emoji}</span>
        <span class="s-name-static">${h.name}</span>
        <button class="ghost s-restore">Restore</button>
      </div>`;
  }
  return `
    <div class="srow" data-id="${h.id}">
      <input class="s-emoji" value="${h.emoji}" maxlength="4" aria-label="Emoji" />
      <input class="s-name" value="${h.name}" aria-label="Habit name" />
      <select class="s-type" aria-label="Type">
        <option value="boolean"${h.type === "boolean" ? " selected" : ""}>Checkbox</option>
        <option value="minutes"${h.type === "minutes" ? " selected" : ""}>Timed</option>
      </select>
      <span class="s-target-wrap${h.type === "minutes" ? "" : " hidden"}">
        <input class="s-target" type="number" min="1" step="5" value="${h.target || 300}" aria-label="Target minutes" />
        <span class="s-unit">min</span>
      </span>
      <div class="srow-actions">
        <button class="ghost s-up" title="Move up">↑</button>
        <button class="ghost s-down" title="Move down">↓</button>
        <button class="ghost s-archive" title="Archive">Archive</button>
      </div>
    </div>`;
}

async function renderSettings() {
  const all = await getHabits({ includeArchived: true });
  const active = all.filter((h) => !h.archived);
  const archived = all.filter((h) => h.archived);

  settingsList.innerHTML = active.map((h) => settingsRow(h, false)).join("")
    || `<p class="modal-note">No active habits.</p>`;
  archivedList.innerHTML = archived.map((h) => settingsRow(h, true)).join("");
  archivedSection.classList.toggle("hidden", archived.length === 0);
}

async function applyHabitChange(id, patch) {
  try {
    await updateHabit(id, patch);
    await refreshAll();
  } catch (err) {
    console.error(err);
    alert("Couldn't save that change.");
  }
  await renderSettings();
}

settingsList.addEventListener("change", (e) => {
  const row = e.target.closest(".srow");
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains("s-emoji")) {
    applyHabitChange(id, { emoji: e.target.value.trim() || "✅" });
  } else if (e.target.classList.contains("s-name")) {
    const name = e.target.value.trim();
    if (name) applyHabitChange(id, { name });
  } else if (e.target.classList.contains("s-type")) {
    const type = e.target.value;
    const targetInput = row.querySelector(".s-target");
    applyHabitChange(id, {
      type,
      target: type === "minutes" ? parseInt(targetInput.value, 10) || 300 : null,
    });
  } else if (e.target.classList.contains("s-target")) {
    const target = parseInt(e.target.value, 10);
    if (target > 0) applyHabitChange(id, { target });
  }
});

settingsList.addEventListener("click", async (e) => {
  const row = e.target.closest(".srow");
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains("s-archive")) {
    await applyHabitChange(id, { archived: true });
    return;
  }

  const dir = e.target.classList.contains("s-up") ? -1
            : e.target.classList.contains("s-down") ? 1 : 0;
  if (!dir) return;

  const all = await getHabits();
  const i = all.findIndex((h) => h.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;

  try {
    await updateHabit(all[i].id, { sort_order: all[j].sort_order });
    await updateHabit(all[j].id, { sort_order: all[i].sort_order });
    await refreshAll();
  } catch (err) {
    console.error(err);
    alert("Couldn't reorder habits.");
  }
  await renderSettings();
});

archivedList.addEventListener("click", (e) => {
  if (!e.target.classList.contains("s-restore")) return;
  applyHabitChange(e.target.closest(".srow").dataset.id, { archived: false });
});

async function createHabit() {
  try {
    const maxOrder = HABITS.reduce((m, h) => Math.max(m, h.sort_order), -1);
    await addHabit({
      key: newHabitKey(),
      name: "New habit",
      emoji: "✅",
      type: "boolean",
      target: null,
      sort_order: maxOrder + 1,
      archived: false,
    });
    await refreshAll();
    await renderSettings();
    const last = settingsList.querySelector(".srow:last-child .s-name");
    if (last) { last.focus(); last.select(); }
  } catch (err) {
    console.error(err);
    alert("Couldn't add that habit.");
  }
}

function openSettings() {
  settingsOverlay.classList.remove("hidden");
  renderSettings();
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
}

settingsBtn.addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("add-habit").addEventListener("click", createHabit);
document.getElementById("empty-add").addEventListener("click", () => { openSettings(); createHabit(); });
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
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
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  updateSoundButton();
  await refreshAll();
}

function showLogin() {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

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
  if (customEnd && customStart > customEnd) {
    customEnd = customStart;
    rangeEndInput.value = customEnd;
  }
  refreshAll();
});

rangeEndInput.addEventListener("change", () => {
  customEnd = rangeEndInput.value;
  if (customStart && customEnd < customStart) {
    customStart = customEnd;
    rangeStartInput.value = customStart;
  }
  refreshAll();
});

onAuthChange((session) => {
  if (session) showApp(session);
  else showLogin();
});

getSession().then((session) => {
  if (session) showApp(session);
});
