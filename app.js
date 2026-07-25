const HABITS = [
  { id: "sleep", label: "Sleep by 9pm", emoji: "😴", type: "boolean" },
  { id: "exercise", label: "Exercise", emoji: "🏋️", type: "boolean" },
  { id: "meals", label: "3 meals", emoji: "🍽️", type: "boolean" },
  { id: "work", label: "Work", emoji: "💼", type: "minutes", target: 300 },
];

const STREAK_FETCH_DAYS = 400; // always have enough history for accurate streaks
const TIMER_KEY = "workTimerState";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const trackerEl = document.getElementById("tracker");
const habitsEl = document.getElementById("habits");
const signOutBtn = document.getElementById("sign-out");
const todayLabel = document.getElementById("today-label");
const rangeSelect = document.getElementById("range-select");
const customRangeEl = document.getElementById("custom-range");
const rangeStartInput = document.getElementById("range-start");
const rangeEndInput = document.getElementById("range-end");

let entriesByHabit = {}; // { habitId: { 'YYYY-MM-DD': { done, value } } }
let currentRange = "30d";
let customStart = null;
let customEnd = null;
let timerInterval = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
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
    case "30d":
      return { start: addDays(end, -29), end };
    case "90d":
      return { start: addDays(end, -89), end };
    case "6m":
      return { start: addDays(end, -181), end };
    case "12m":
      return { start: addDays(end, -364), end };
    case "ytd":
      return { start: `${new Date().getFullYear()}-01-01`, end };
    case "custom":
      return { start: customStart || addDays(end, -29), end: customEnd || end };
    default:
      return { start: addDays(end, -29), end };
  }
}

async function loadEntries() {
  const display = displayRangeBounds();
  const streakStart = addDays(todayStr(), -STREAK_FETCH_DAYS);
  const fetchStart = display.start < streakStart ? display.start : streakStart;
  const rows = await getEntries(fetchStart, display.end);
  entriesByHabit = {};
  for (const h of HABITS) entriesByHabit[h.id] = {};
  for (const row of rows) {
    entriesByHabit[row.habit_id][row.date] = { done: row.done, value: row.value };
  }
}

function computeStreak(habitId) {
  let streak = 0;
  let d = todayStr();
  while (true) {
    const entry = entriesByHabit[habitId][d];
    if (entry && entry.done) {
      streak++;
      d = addDays(d, -1);
    } else break;
  }
  return streak;
}

function renderHeatmap(habitId, start, end) {
  const cells = dateList(start, end).map((d) => {
    const entry = entriesByHabit[habitId][d];
    const done = !!(entry && entry.done);
    return `<div class="cell ${done ? "done" : ""}" title="${d}"></div>`;
  });
  return `<div class="heatmap">${cells.join("")}</div>`;
}

function computeDayStatus(date) {
  let hasData = false;
  let missed = 0;
  for (const h of HABITS) {
    const entry = entriesByHabit[h.id][date];
    if (entry) hasData = true;
    if (!(entry && entry.done)) missed++;
  }
  if (!hasData) return "none";
  if (missed === 0) return "green";
  if (missed === 1) return "yellow";
  return "red";
}

function renderTracker() {
  const { start, end } = displayRangeBounds();
  const today = todayStr();
  const todayStatus = computeDayStatus(today);
  const missedToday = HABITS.filter((h) => !(entriesByHabit[h.id][today] && entriesByHabit[h.id][today].done)).length;

  const label =
    todayStatus === "none"
      ? "Nothing logged yet today"
      : todayStatus === "green"
      ? "All 4 habits done today"
      : todayStatus === "yellow"
      ? "1 habit missed today"
      : `${missedToday} habits missed today`;

  const cells = dateList(start, end)
    .map((d) => `<div class="cell status-${computeDayStatus(d)}" title="${d}"></div>`)
    .join("");

  trackerEl.innerHTML = `
    <div class="tracker-card">
      <div class="tracker-today status-${todayStatus}">
        <span class="tracker-dot"></span>
        <span>${label}</span>
      </div>
      <div class="heatmap">${cells}</div>
    </div>
  `;
}

function getTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state.date !== todayStr()) {
      localStorage.removeItem(TIMER_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function startTimer() {
  localStorage.setItem(TIMER_KEY, JSON.stringify({ startTs: Date.now(), date: todayStr() }));
  renderHabits();
}

async function stopTimer() {
  const state = getTimerState();
  if (!state) return;
  const elapsedMinutes = Math.round((Date.now() - state.startTs) / 60000);
  localStorage.removeItem(TIMER_KEY);
  clearInterval(timerInterval);
  await adjustWorkMinutes(elapsedMinutes);
}

function tickTimer() {
  clearInterval(timerInterval);
  const state = getTimerState();
  if (!state) return;
  timerInterval = setInterval(() => {
    const el = document.getElementById("timer-live");
    if (!el) {
      clearInterval(timerInterval);
      return;
    }
    const secs = Math.floor((Date.now() - state.startTs) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
  }, 1000);
}

async function adjustWorkMinutes(delta) {
  const today = todayStr();
  const target = HABITS.find((h) => h.id === "work").target;
  const prev = entriesByHabit.work[today] || { value: 0, done: false };
  const newValue = Math.max(0, (prev.value || 0) + delta);
  const done = newValue >= target;

  entriesByHabit.work[today] = { value: newValue, done }; // optimistic
  renderTracker();
  renderHabits();

  try {
    await setEntry("work", today, { done, value: newValue });
  } catch (err) {
    entriesByHabit.work[today] = prev;
    renderTracker();
    renderHabits();
    alert("Couldn't save that — check your connection and try again.");
    console.error(err);
  }
}

function renderBooleanCard(h, start, end) {
  const today = todayStr();
  const entry = entriesByHabit[h.id][today];
  const done = !!(entry && entry.done);
  const streak = computeStreak(h.id);
  return `
    <div class="habit-card">
      <button class="habit-toggle ${done ? "done" : ""}" data-habit="${h.id}">
        <span class="emoji">${h.emoji}</span>
        <span class="habit-info">
          <span class="habit-name">${h.label}</span>
          <span class="habit-streak">${streak} day streak</span>
        </span>
        <span class="check">${done ? "✓" : ""}</span>
      </button>
      ${renderHeatmap(h.id, start, end)}
    </div>
  `;
}

function renderMinutesCard(h, start, end) {
  const today = todayStr();
  const entry = entriesByHabit[h.id][today] || { value: 0, done: false };
  const value = entry.value || 0;
  const done = value >= h.target;
  const streak = computeStreak(h.id);
  const pct = Math.min(100, Math.round((value / h.target) * 100));
  const running = !!getTimerState();

  return `
    <div class="habit-card">
      <div class="habit-row">
        <div class="toggle-static ${done ? "done" : ""}">
          <span class="emoji">${h.emoji}</span>
        </div>
        <div class="habit-info">
          <div class="habit-name">${h.label}</div>
          <div class="habit-streak">${streak} day streak · ${value} / ${h.target} min</div>
        </div>
        <span class="check">${done ? "✓" : ""}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="timer-row">
        <button class="timer-btn ${running ? "running" : ""}" id="timer-toggle">
          ${running ? "Stop timer" : "Start timer"}
        </button>
        <span id="timer-live" class="timer-live"></span>
        <div class="adjust-buttons">
          <button class="adjust-btn" data-delta="-15">−15</button>
          <button class="adjust-btn" data-delta="15">+15</button>
        </div>
      </div>
      ${renderHeatmap(h.id, start, end)}
    </div>
  `;
}

function renderHabits() {
  const { start, end } = displayRangeBounds();

  habitsEl.innerHTML = HABITS.map((h) =>
    h.type === "minutes" ? renderMinutesCard(h, start, end) : renderBooleanCard(h, start, end)
  ).join("");

  habitsEl.querySelectorAll(".habit-toggle").forEach((btn) => {
    btn.addEventListener("click", () => onToggle(btn.dataset.habit));
  });

  habitsEl.querySelectorAll(".adjust-btn").forEach((btn) => {
    btn.addEventListener("click", () => adjustWorkMinutes(parseInt(btn.dataset.delta, 10)));
  });

  const timerToggle = document.getElementById("timer-toggle");
  if (timerToggle) {
    timerToggle.addEventListener("click", () => {
      if (getTimerState()) stopTimer();
      else startTimer();
    });
  }

  if (getTimerState()) tickTimer();
}

async function onToggle(habitId) {
  const today = todayStr();
  const prev = entriesByHabit[habitId][today] || { done: false, value: null };
  const nowDone = !prev.done;

  entriesByHabit[habitId][today] = { done: nowDone, value: null }; // optimistic
  renderTracker();
  renderHabits();

  try {
    await setEntry(habitId, today, { done: nowDone });
  } catch (err) {
    entriesByHabit[habitId][today] = prev;
    renderTracker();
    renderHabits();
    alert("Couldn't save that — check your connection and try again.");
    console.error(err);
  }
}

async function refreshAndRender() {
  await loadEntries();
  renderTracker();
  renderHabits();
}

async function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  await refreshAndRender();
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
  showLogin();
});

rangeSelect.addEventListener("change", () => {
  currentRange = rangeSelect.value;
  if (currentRange === "custom") {
    customStart = customStart || addDays(todayStr(), -29);
    customEnd = customEnd || todayStr();
    rangeStartInput.value = customStart;
    rangeEndInput.value = customEnd;
    customRangeEl.classList.remove("hidden");
  } else {
    customRangeEl.classList.add("hidden");
  }
  refreshAndRender();
});

rangeStartInput.addEventListener("change", () => {
  customStart = rangeStartInput.value;
  if (customEnd && customStart > customEnd) customEnd = customStart;
  rangeEndInput.value = customEnd;
  refreshAndRender();
});

rangeEndInput.addEventListener("change", () => {
  customEnd = rangeEndInput.value;
  if (customStart && customEnd < customStart) customStart = customEnd;
  rangeStartInput.value = customStart;
  refreshAndRender();
});

onAuthChange((session) => {
  if (session) showApp();
  else showLogin();
});

getSession().then((session) => {
  if (session) showApp();
});
