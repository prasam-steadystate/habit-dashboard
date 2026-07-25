const HABITS = [
  { id: "sleep", label: "Sleep by 9pm", emoji: "😴" },
  { id: "exercise", label: "Exercise", emoji: "🏋️" },
  { id: "meals", label: "3 meals", emoji: "🍽️" },
  { id: "work", label: "Work ≥4hrs", emoji: "💼" },
];

const DAYS_BACK = 56; // 8 weeks of heatmap history

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const habitsEl = document.getElementById("habits");
const signOutBtn = document.getElementById("sign-out");
const todayLabel = document.getElementById("today-label");

let entriesByHabit = {}; // { habitId: { 'YYYY-MM-DD': true } }

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function loadEntries() {
  const since = dateStr(DAYS_BACK);
  const rows = await getEntries(since);
  entriesByHabit = {};
  for (const h of HABITS) entriesByHabit[h.id] = {};
  for (const row of rows) {
    if (!entriesByHabit[row.habit_id]) entriesByHabit[row.habit_id] = {};
    entriesByHabit[row.habit_id][row.date] = row.done;
  }
}

function computeStreak(habitId) {
  let streak = 0;
  for (let i = 0; i < DAYS_BACK; i++) {
    const d = dateStr(i);
    if (entriesByHabit[habitId][d]) streak++;
    else break;
  }
  return streak;
}

function renderHeatmap(habitId) {
  const cells = [];
  for (let i = DAYS_BACK - 1; i >= 0; i--) {
    const d = dateStr(i);
    const done = !!entriesByHabit[habitId][d];
    cells.push(`<div class="cell ${done ? "done" : ""}" title="${d}"></div>`);
  }
  return `<div class="heatmap">${cells.join("")}</div>`;
}

function renderHabits() {
  habitsEl.innerHTML = HABITS.map((h) => {
    const done = !!entriesByHabit[h.id][todayStr()];
    const streak = computeStreak(h.id);
    return `
      <div class="habit-card">
        <div class="habit-row">
          <button class="toggle ${done ? "done" : ""}" data-habit="${h.id}">
            <span class="emoji">${h.emoji}</span>
          </button>
          <div class="habit-info">
            <div class="habit-name">${h.label}</div>
            <div class="habit-streak">${streak} day streak</div>
          </div>
        </div>
        ${renderHeatmap(h.id)}
      </div>
    `;
  }).join("");

  habitsEl.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", () => onToggle(btn.dataset.habit));
  });
}

async function onToggle(habitId) {
  const today = todayStr();
  const wasDone = !!entriesByHabit[habitId][today];
  const nowDone = !wasDone;

  entriesByHabit[habitId][today] = nowDone; // optimistic
  renderHabits();

  try {
    await setEntry(habitId, today, nowDone);
  } catch (err) {
    entriesByHabit[habitId][today] = wasDone; // revert on failure
    renderHabits();
    alert("Couldn't save that — check your connection and try again.");
    console.error(err);
  }
}

async function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  await loadEntries();
  renderHabits();
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

onAuthChange((session) => {
  if (session) showApp();
  else showLogin();
});

getSession().then((session) => {
  if (session) showApp();
});

if ("serviceWorker" in navigator) {
  // registered later once we add offline support — no-op for now
}
