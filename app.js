const HABITS = [
  { id: "sleep", label: "Sleep by 9pm", emoji: "😴", type: "boolean" },
  { id: "exercise", label: "Exercise", emoji: "🏋️", type: "boolean" },
  { id: "meals", label: "3 meals", emoji: "🍽️", type: "boolean" },
  { id: "work", label: "Work", emoji: "💼", type: "minutes", target: 300 },
];

const STREAK_FETCH_DAYS = 400; // enough history for accurate streaks regardless of view
const TIMER_KEY = "workTimerState";
const MUTE_KEY = "soundMuted";
const RING_CIRCUMFERENCE = 301.6; // 2 * PI * r, r = 48
const DENSE_STRIP_THRESHOLD = 45; // beyond this many days, switch to a 7-row grid

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const habitsEl = document.getElementById("habits");
const signOutBtn = document.getElementById("sign-out");
const todayLabel = document.getElementById("today-label");
const rangeSeg = document.getElementById("range-seg");
const customRangeEl = document.getElementById("custom-range");
const rangeStartInput = document.getElementById("range-start");
const rangeEndInput = document.getElementById("range-end");
const soundToggle = document.getElementById("sound-toggle");

let entriesByHabit = {}; // { habitId: { 'YYYY-MM-DD': { done, value } } }
let currentRange = "30d";
let customStart = null;
let customEnd = null;
let timerInterval = null;
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

async function loadEntries() {
  const display = displayRangeBounds();
  const streakStart = addDays(todayStr(), -STREAK_FETCH_DAYS);
  const fetchStart = display.start < streakStart ? display.start : streakStart;
  const fetchEnd = display.end > todayStr() ? display.end : todayStr();
  const rows = await getEntries(fetchStart, fetchEnd);
  entriesByHabit = {};
  for (const h of HABITS) entriesByHabit[h.id] = {};
  for (const row of rows) {
    if (!entriesByHabit[row.habit_id]) entriesByHabit[row.habit_id] = {};
    entriesByHabit[row.habit_id][row.date] = { done: row.done, value: row.value };
  }
}

function isDone(habitId, date) {
  const e = entriesByHabit[habitId] && entriesByHabit[habitId][date];
  return !!(e && e.done);
}

function computeStreak(habitId) {
  let streak = 0;
  let d = todayStr();
  while (isDone(habitId, d)) {
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

function completedToday() {
  return HABITS.filter((h) => isDone(h.id, todayStr())).length;
}

function computeDayStatus(date) {
  let hasData = false;
  let missed = 0;
  for (const h of HABITS) {
    const e = entriesByHabit[h.id] && entriesByHabit[h.id][date];
    if (e) hasData = true;
    if (!(e && e.done)) missed++;
  }
  if (!hasData) return "none";
  if (missed === 0) return "green";
  if (missed === 1) return "yellow";
  return "red";
}

// Counts back from today. Today only breaks the streak once it's over —
// an unfinished today shouldn't zero out yesterday's run.
function computeAllGreenStreak() {
  let d = todayStr();
  let streak = 0;
  if (computeDayStatus(d) === "green") {
    streak = 1;
  }
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
  if (!days.length) return { greenPct: 0, completionPct: 0 };

  let green = 0;
  let done = 0;
  for (const d of days) {
    if (computeDayStatus(d) === "green") green++;
    for (const h of HABITS) if (isDone(h.id, d)) done++;
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
    .map((d) => {
      const cls = classForDate(d);
      const isToday = d === today ? " today" : "";
      return `<div class="cell ${cls}${isToday}" title="${d}"></div>`;
    })
    .join("");
  container.innerHTML = `<div class="strip ${dense ? "grid" : "row"}">${cells}</div>`;
}

/* ---------- tracker ---------- */

function statusCopy(count, status) {
  if (status === "none") {
    return { pill: "Nothing logged yet", head: "Fresh start.", sub: "Log your first habit to get today moving." };
  }
  if (status === "green") {
    return { pill: "All 4 done", head: "Day closed green.", sub: "That's the whole board. Nicely done." };
  }
  const remaining = HABITS.filter((h) => !isDone(h.id, todayStr()));
  const names = remaining.map((h) => h.label).join(" and ");
  if (status === "yellow") {
    return { pill: "One left to go", head: "Almost there.", sub: `Finish <b>${names}</b> to close the day green.` };
  }
  return {
    pill: `${remaining.length} left`,
    head: "Still in play.",
    sub: `<b>${names}</b> remaining today.`,
  };
}

function updateTracker() {
  const count = completedToday();
  const status = computeDayStatus(todayStr());
  const { start, end, label } = displayRangeBounds();

  document.querySelector(".ring-fg").style.strokeDashoffset =
    RING_CIRCUMFERENCE * (1 - count / HABITS.length);
  document.getElementById("ring-count").textContent = count;

  const copy = statusCopy(count, status);
  const pill = document.getElementById("status-pill");
  pill.className = "status s-" + status;
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

  const ring = document.querySelector(".ring");
  ring.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
    { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" }
  );
}

/* ---------- habit cards ---------- */

function cardEl(habitId) {
  return habitsEl.querySelector(`.card[data-habit="${habitId}"]`);
}

function metaText(h) {
  const streak = computeStreak(h.id);
  const { start, end } = displayRangeBounds();
  const today = todayStr();
  const days = dateList(start, end > today ? today : end);
  const hit = days.filter((d) => isDone(h.id, d)).length;
  return { streak, hit, total: days.length };
}

function renderCards() {
  const { start, end } = displayRangeBounds();
  const dates = dateList(start, end);

  habitsEl.innerHTML = HABITS.map((h) => {
    const isWork = h.type === "minutes";
    return `
      <div class="card" data-habit="${h.id}">
        <div class="chead">
          <div class="icon">${h.emoji}</div>
          <div class="cinfo">
            <div class="cname">${h.label}</div>
            <div class="cmeta">
              <span class="flame"></span>
              <span class="rate"></span>
            </div>
          </div>
          <button class="tick${isWork ? " tick-static" : ""}"${isWork ? " disabled" : ""}>✓</button>
        </div>
        ${isWork ? `
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
    const card = cardEl(h.id);
    buildStrip(card.querySelector(".strip-wrap"), dates, (d) => (isDone(h.id, d) ? "g" : ""), true);
    card.querySelector(".cap-start").textContent = `${dates.length} days ago`;
    updateCard(h.id);
  }

  habitsEl.querySelectorAll('.card:not([data-habit="work"]) .tick').forEach((btn) => {
    btn.addEventListener("click", () => onToggle(btn.closest(".card").dataset.habit));
  });

  const workCard = cardEl("work");
  workCard.querySelector(".tbtn").addEventListener("click", () => {
    if (getTimerState()) stopTimer();
    else startTimer();
  });
  workCard.querySelectorAll(".pills button").forEach((btn) => {
    btn.addEventListener("click", () => adjustWorkMinutes(parseInt(btn.dataset.delta, 10)));
  });

  if (getTimerState()) tickTimer();
}

function updateCard(habitId) {
  const h = HABITS.find((x) => x.id === habitId);
  const card = cardEl(habitId);
  if (!card) return;

  const today = todayStr();
  const done = isDone(habitId, today);
  const { streak, hit, total } = metaText(h);

  card.classList.toggle("done", done);
  card.querySelector(".flame").textContent = `🔥 ${streak} day streak`;

  if (h.type === "minutes") {
    const entry = (entriesByHabit[habitId] && entriesByHabit[habitId][today]) || { value: 0 };
    const value = entry.value || 0;
    const pct = Math.min(100, Math.round((value / h.target) * 100));
    card.querySelector(".rate").textContent = `· ${hit}/${total} days`;
    card.querySelector(".fill").style.width = pct + "%";
    card.querySelector(".barval").innerHTML = `<b>${value}</b> / ${h.target} min`;
    card.querySelector(".barleft").textContent =
      value >= h.target ? "target hit" : `${h.target - value} min left`;
    updateTimerUI();
  } else {
    card.querySelector(".rate").textContent = `· ${hit}/${total} days`;
  }

  const cells = card.querySelectorAll(".cell");
  const last = cells[cells.length - 1];
  if (last && last.title === today) last.className = "cell" + (done ? " g" : "") + " today";
}

function animateTick(habitId) {
  const tick = cardEl(habitId).querySelector(".tick");
  tick.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.35)", offset: 0.45 },
      { transform: "scale(1)" },
    ],
    { duration: 380, easing: "cubic-bezier(.2,.9,.25,1.2)" }
  );
  cardEl(habitId).animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(-4px)" }, { transform: "translateY(0)" }],
    { duration: 420, easing: "ease-out" }
  );
}

/* ---------- work timer ---------- */

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

function updateTimerUI() {
  const card = cardEl("work");
  if (!card) return;
  const running = !!getTimerState();
  const btn = card.querySelector(".tbtn");
  btn.classList.toggle("running", running);
  card.querySelector(".tbtn-label").textContent = running ? "Stop" : "Start";
  card.querySelector(".clock").classList.toggle("live", running);
  if (!running) card.querySelector(".clock").textContent = "00:00";
}

function startTimer() {
  ensureAudio(); // unlock audio on this user gesture
  localStorage.setItem(TIMER_KEY, JSON.stringify({ startTs: Date.now(), date: todayStr() }));
  updateTimerUI();
  tickTimer();
}

async function stopTimer() {
  const state = getTimerState();
  if (!state) return;
  const elapsedMinutes = Math.round((Date.now() - state.startTs) / 60000);
  localStorage.removeItem(TIMER_KEY);
  clearInterval(timerInterval);
  updateTimerUI();
  if (elapsedMinutes > 0) await adjustWorkMinutes(elapsedMinutes);
}

function tickTimer() {
  clearInterval(timerInterval);
  const render = () => {
    const state = getTimerState();
    const el = cardEl("work") && cardEl("work").querySelector(".clock");
    if (!state || !el) {
      clearInterval(timerInterval);
      return;
    }
    const secs = Math.floor((Date.now() - state.startTs) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
  };
  render();
  timerInterval = setInterval(render, 1000);
}

/* ---------- mutations ---------- */

function afterChange(habitId, wasDone) {
  updateCard(habitId);
  updateTracker();

  const nowAllGreen = computeDayStatus(todayStr()) === "green";
  const nowDone = isDone(habitId, todayStr());

  if (nowDone && !wasDone) {
    animateTick(habitId);
    if (nowAllGreen && !lastAllGreen) {
      celebrate();
      playChime();
    } else {
      playPop();
    }
  }
  lastAllGreen = nowAllGreen;
}

async function onToggle(habitId) {
  ensureAudio(); // user gesture — safe to unlock audio here
  const today = todayStr();
  const prev = (entriesByHabit[habitId] && entriesByHabit[habitId][today]) || { done: false, value: null };
  const wasDone = !!prev.done;

  entriesByHabit[habitId][today] = { done: !wasDone, value: null }; // optimistic
  afterChange(habitId, wasDone);

  try {
    await setEntry(habitId, today, { done: !wasDone });
  } catch (err) {
    entriesByHabit[habitId][today] = prev;
    updateCard(habitId);
    updateTracker();
    lastAllGreen = computeDayStatus(today) === "green";
    alert("Couldn't save that — check your connection and try again.");
    console.error(err);
  }
}

async function adjustWorkMinutes(delta) {
  const today = todayStr();
  const target = HABITS.find((h) => h.id === "work").target;
  const prev = (entriesByHabit.work && entriesByHabit.work[today]) || { value: 0, done: false };
  const wasDone = !!prev.done;
  const newValue = Math.max(0, (prev.value || 0) + delta);
  const done = newValue >= target;

  entriesByHabit.work[today] = { value: newValue, done }; // optimistic
  afterChange("work", wasDone);

  try {
    await setEntry("work", today, { done, value: newValue });
  } catch (err) {
    entriesByHabit.work[today] = prev;
    updateCard("work");
    updateTracker();
    lastAllGreen = computeDayStatus(today) === "green";
    alert("Couldn't save that — check your connection and try again.");
    console.error(err);
  }
}

/* ---------- view wiring ---------- */

async function refreshAll() {
  await loadEntries();
  lastAllGreen = computeDayStatus(todayStr()) === "green";
  updateTracker();
  renderCards();
}

async function showApp() {
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
  if (session) showApp();
  else showLogin();
});

getSession().then((session) => {
  if (session) showApp();
});
