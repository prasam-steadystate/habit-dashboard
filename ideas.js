/* Prasam's idea bank. Reuses config.js + storage.js; shares the dashboard session.

   Coats of paint: a coat is one editing SESSION, not one save. The editor
   autosaves while you type, so counting saves would be meaningless. Your first
   real change starts a coat; further edits join it while the paint is wet; after
   COAT_GAP_MINUTES without an edit it dries, and the next change starts a new
   coat. Opening an idea without changing anything never counts. */

const COAT_GAP_MINUTES = 30;
const AUTOSAVE_DELAY_MS = 900;
const SNIPPET_CHARS = 180;

const loadingView = document.getElementById("loading-view");
const ideasView = document.getElementById("ideas-view");
const listView = document.getElementById("list-view");
const editorView = document.getElementById("editor-view");
const listToolbar = document.getElementById("list-toolbar");
const ideaGrid = document.getElementById("idea-grid");
const ideasEmpty = document.getElementById("ideas-empty");
const sortSelect = document.getElementById("sort-select");
const windowSeg = document.getElementById("window-seg");
const titleInput = document.getElementById("idea-title");
const bodyInput = document.getElementById("idea-body");
const saveStatus = document.getElementById("save-status");

let ideas = [];          // { id, title, body, created_at, last_edited_at, coats: [iso, …] ascending }
let windowDays = null;   // null = all time
let sortMode = "coats";

let current = null;      // idea open in the editor (id is null for an unsaved draft)
let savedSnapshot = { title: "", body: "" };
let pendingCoat = false; // a coat that failed to write and should be retried
let saveTimer = null;
let saveChain = Promise.resolve();
let noteTimer = null;

// Indirection so the wet/dry logic can be tested without waiting 30 minutes.
let clock = () => new Date();

/* ---------- formatting ---------- */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function relTime(iso) {
  const secs = (new Date(iso) - clock()) / 1000;
  const abs = Math.abs(secs);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(secs / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(secs / (86400 * 30)), "month");
  return rtf.format(Math.round(secs / (86400 * 365)), "year");
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function localDay(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// calendar days from first coat to last coat, inclusive
function spanDays(coats) {
  if (!coats.length) return 0;
  return Math.round((localDay(coats[coats.length - 1]) - localDay(coats[0])) / 86400000) + 1;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function wordCount(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/* ---------- coat logic ---------- */

function lastEditMs(idea) {
  return idea.last_edited_at ? new Date(idea.last_edited_at).getTime() : null;
}

// Would an edit made right now start a new coat?
function startsNewCoat(idea, now = clock()) {
  if (!idea.coats.length) return true;
  const last = lastEditMs(idea);
  if (last === null) return true;
  return now.getTime() - last >= COAT_GAP_MINUTES * 60000;
}

function coatsInWindow(idea) {
  if (!windowDays) return idea.coats.length;
  const cutoff = clock().getTime() - windowDays * 86400000;
  return idea.coats.filter((c) => new Date(c).getTime() >= cutoff).length;
}

function windowLabel() {
  return windowDays ? `last ${windowDays} days` : "all time";
}

/* ---------- data ---------- */

async function loadIdeas() {
  const rows = await getIdeas();
  ideas = rows.map((r) => ({
    id: r.id,
    title: r.title || "",
    body: r.body || "",
    created_at: r.created_at,
    last_edited_at: r.last_edited_at,
    coats: (r.idea_coats || []).map((c) => c.created_at).sort(),
  }));
}

/* ---------- list ---------- */

function sortedIdeas() {
  const list = ideas.slice();
  const lastPainted = (i) => (i.coats.length ? i.coats[i.coats.length - 1] : i.created_at);
  if (sortMode === "recent") {
    list.sort((a, b) => lastPainted(b).localeCompare(lastPainted(a)));
  } else if (sortMode === "newest") {
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else {
    list.sort((a, b) =>
      coatsInWindow(b) - coatsInWindow(a) ||
      b.coats.length - a.coats.length ||
      lastPainted(b).localeCompare(lastPainted(a)));
  }
  return list;
}

function trackDots(coats, dotClass) {
  if (!coats.length) return "";
  const first = new Date(coats[0]).getTime();
  const range = Math.max(clock().getTime() - first, 1);
  return coats
    .map((c) => {
      const pct = ((new Date(c).getTime() - first) / range) * 100;
      return `<span class="${dotClass}" style="left:${Math.min(100, Math.max(0, pct))}%" title="${shortDate(c)}"></span>`;
    })
    .join("");
}

function renderSummary() {
  const totalCoats = ideas.reduce((sum, i) => sum + coatsInWindow(i), 0);
  const active = ideas.filter((i) => coatsInWindow(i) > 0).length;
  const top = ideas
    .filter((i) => coatsInWindow(i) > 0)
    .sort((a, b) => coatsInWindow(b) - coatsInWindow(a))[0];

  document.getElementById("sum-ideas").textContent = ideas.length;
  document.getElementById("sum-coats").textContent = totalCoats;
  document.getElementById("sum-coats-k").textContent = `Coats of paint · ${windowLabel()}`;
  document.getElementById("sum-active").textContent = active;
  document.getElementById("sum-active-k").textContent = `Ideas worked on · ${windowLabel()}`;
  document.getElementById("sum-top").innerHTML = top
    ? `${escapeHtml(top.title.trim() || "Untitled idea")} <small>${coatsInWindow(top)}</small>`
    : "—";
  document.getElementById("sum-top-k").textContent = `Most painted · ${windowLabel()}`;
}

function renderList() {
  renderSummary();
  const list = sortedIdeas();
  ideasEmpty.classList.toggle("hidden", list.length > 0);
  ideaGrid.classList.toggle("hidden", list.length === 0);

  ideaGrid.innerHTML = list
    .map((idea) => {
      const n = idea.coats.length;
      const inWin = coatsInWindow(idea);
      const title = idea.title.trim();
      const body = idea.body.trim();
      const snippet = body.length > SNIPPET_CHARS ? body.slice(0, SNIPPET_CHARS).trimEnd() + "…" : body;

      const meta = [];
      if (n > 1) meta.push(`over ${plural(spanDays(idea.coats), "day", "days")}`);
      if (n) meta.push(`last coat ${relTime(idea.coats[n - 1])}`);
      else meta.push(`created ${relTime(idea.created_at)}`);

      return `
        <a class="idea-card" href="#idea=${idea.id}">
          <div class="idea-card-head">
            <h3 class="${title ? "" : "is-untitled"}">${escapeHtml(title || "Untitled idea")}</h3>
            <div class="coat-badge" title="Coats of paint: editing sessions on this idea">
              <span class="brush">🖌️</span><b>${n}</b>
            </div>
          </div>
          <p class="idea-snippet">${snippet ? escapeHtml(snippet) : '<span class="is-untitled">No notes yet</span>'}</p>
          <div class="idea-track">${trackDots(idea.coats, "idea-dot")}</div>
          <div class="idea-meta">
            <span>${meta.join(" · ")}</span>
            ${windowDays && inWin ? `<span class="recent-chip">+${inWin} in ${windowDays}d</span>` : ""}
          </div>
        </a>`;
    })
    .join("");
}

/* ---------- editor ---------- */

function isDirty() {
  return current && (titleInput.value !== savedSnapshot.title || bodyInput.value !== savedSnapshot.body);
}

function setStatus(state) {
  const text = {
    draft: "Not saved yet — start typing",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    error: "Couldn't save — will retry as you type",
  }[state];
  saveStatus.textContent = text || "";
  saveStatus.className = "save-status s-" + state;
}

function autoGrow() {
  bodyInput.style.height = "auto";
  bodyInput.style.height = Math.max(320, bodyInput.scrollHeight) + "px";
}

function renderCoatPanel() {
  const n = current.coats.length;
  document.getElementById("coat-num").textContent = n;
  document.getElementById("coat-unit").textContent = n === 1 ? "coat of paint" : "coats of paint";

  let note;
  if (!n) {
    note = "Start writing to lay down the first coat.";
  } else if (!startsNewCoat(current)) {
    const dryAt = new Date(lastEditMs(current) + COAT_GAP_MINUTES * 60000);
    const time = dryAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    note = `<b>Paint's still wet.</b> Edits until about ${time} add to coat #${n}.`;
  } else {
    note = `<b>Dry.</b> Your next edit lays down coat #${n + 1}.`;
  }
  document.getElementById("coat-note").innerHTML = note;

  document.getElementById("coat-track").innerHTML = trackDots(current.coats, "coat-dot");
  document.getElementById("track-start").textContent = n ? shortDate(current.coats[0]) : "";

  const facts = [];
  if (n) {
    facts.push(["First coat", shortDate(current.coats[0])]);
    facts.push(["Latest coat", relTime(current.coats[n - 1])]);
    facts.push(["Painted over", plural(spanDays(current.coats), "day", "days")]);
    const recent = current.coats.filter((c) => new Date(c) >= clock() - 30 * 86400000).length;
    facts.push(["Last 30 days", plural(recent, "coat", "coats")]);
  }
  if (current.created_at) facts.push(["Created", shortDate(current.created_at)]);
  document.getElementById("coat-facts").innerHTML = facts
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
    .join("");
}

function updateWordCount() {
  document.getElementById("word-count").textContent = plural(wordCount(bodyInput.value), "word", "words");
}

async function doSave() {
  if (!current) return;
  const title = titleInput.value;
  const body = bodyInput.value;
  const changed = title !== savedSnapshot.title || body !== savedSnapshot.body;
  if (!changed && !pendingCoat) return;
  // never create an empty idea just because the editor was opened
  if (!current.id && !title.trim() && !body.trim()) return;

  const idea = current;
  const now = clock();
  const nowIso = now.toISOString();
  const needsCoat = pendingCoat || (changed && startsNewCoat(idea, now));

  setStatus("saving");
  try {
    if (!idea.id) {
      const row = await createIdea({ title, body, last_edited_at: nowIso });
      idea.id = row.id;
      idea.created_at = row.created_at;
      ideas.unshift(idea);
      history.replaceState(null, "", `#idea=${row.id}`);
    } else if (changed) {
      await updateIdea(idea.id, { title, body, last_edited_at: nowIso });
    }

    idea.title = title;
    idea.body = body;
    if (changed) idea.last_edited_at = nowIso;
    if (idea === current) savedSnapshot = { title, body };

    if (needsCoat) {
      try {
        const coat = await addCoat(idea.id);
        idea.coats.push(coat.created_at);
        idea.coats.sort();
        pendingCoat = false;
        if (idea === current) celebrateCoat();
      } catch (err) {
        pendingCoat = true; // content is safe; retry the coat on the next save
        throw err;
      }
    }

    if (idea === current) {
      setStatus(isDirty() ? "dirty" : "saved");
      renderCoatPanel();
    }
  } catch (err) {
    console.error(err);
    if (idea === current) setStatus("error");
  }
}

// Saves run one at a time, so a slow first insert can't produce a duplicate idea.
function queueSave() {
  saveChain = saveChain.then(doSave);
  return saveChain;
}

function scheduleSave() {
  setStatus("dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(queueSave, AUTOSAVE_DELAY_MS);
}

function flushSave() {
  clearTimeout(saveTimer);
  return queueSave();
}

function celebrateCoat() {
  const big = document.querySelector(".coat-big");
  if (big && big.animate) {
    big.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.22)", offset: 0.4 },
        { transform: "scale(1)" },
      ],
      { duration: 480, easing: "cubic-bezier(.2,.9,.25,1.2)" }
    );
  }
}

function openEditor(idea) {
  current = idea || { id: null, title: "", body: "", created_at: null, last_edited_at: null, coats: [] };
  savedSnapshot = { title: current.title, body: current.body };
  pendingCoat = false;

  titleInput.value = current.title;
  bodyInput.value = current.body;

  listView.classList.add("hidden");
  listToolbar.classList.add("hidden");
  editorView.classList.remove("hidden");
  document.getElementById("editor-delete").classList.toggle("hidden", !current.id);
  window.scrollTo(0, 0);

  setStatus(current.id ? "saved" : "draft");
  renderCoatPanel();
  updateWordCount();
  autoGrow();
  if (!current.id) titleInput.focus();

  // wet paint dries on its own — keep the note honest while the page sits open
  clearInterval(noteTimer);
  noteTimer = setInterval(() => { if (current) renderCoatPanel(); }, 30000);
}

function showList() {
  current = null;
  clearInterval(noteTimer);
  editorView.classList.add("hidden");
  listView.classList.remove("hidden");
  listToolbar.classList.remove("hidden");
  renderList();
}

function route() {
  const hash = location.hash;
  if (hash === "#new") return openEditor(null);
  if (hash.startsWith("#idea=")) {
    const idea = ideas.find((i) => i.id === hash.slice(6));
    if (idea) return openEditor(idea);
    history.replaceState(null, "", location.pathname);
  }
  showList();
}

/* ---------- wiring ---------- */

titleInput.addEventListener("input", scheduleSave);
bodyInput.addEventListener("input", () => {
  autoGrow();
  updateWordCount();
  scheduleSave();
});
titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); bodyInput.focus(); }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && current) {
    e.preventDefault();
    flushSave();
  }
});

// Save before any navigation inside the page (back link, browser back, new idea).
window.addEventListener("hashchange", async () => {
  await flushSave();
  route();
});

document.getElementById("editor-delete").addEventListener("click", async () => {
  if (!current || !current.id) return;
  const name = current.title.trim() || "Untitled idea";
  const n = current.coats.length;
  const ok = confirm(`Delete "${name}"?\n\nThis removes the idea and its ${plural(n, "coat", "coats")} of paint. It can't be undone.`);
  if (!ok) return;
  clearTimeout(saveTimer);
  const id = current.id;
  try {
    await saveChain; // let any in-flight save finish first
    await deleteIdea(id);
    ideas = ideas.filter((i) => i.id !== id);
    current = null;
    location.hash = "";
  } catch (err) {
    console.error(err);
    alert("Couldn't delete that idea.");
  }
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  renderList();
});

windowSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-days]");
  if (!btn) return;
  windowSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
  windowDays = btn.dataset.days ? parseInt(btn.dataset.days, 10) : null;
  renderList();
});

// tab hidden or phone locked: save what's there
document.addEventListener("visibilitychange", () => {
  if (document.hidden && isDirty()) flushSave();
});

// closing the tab with unsaved text: ask the browser to warn first
window.addEventListener("beforeunload", (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function init() {
  await loadIdeas();
  loadingView.classList.add("hidden");
  ideasView.classList.remove("hidden");
  route();
}

getSession().then((session) => {
  if (!session) { window.location.href = "index.html"; return; }
  init().catch((err) => {
    console.error(err);
    loadingView.innerHTML =
      `<p class="muted-note">Couldn't load your ideas. If this is the first time, the database tables may not be set up yet.</p>`;
  });
});
