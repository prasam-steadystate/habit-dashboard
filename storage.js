// The only file that knows where data lives. Everything else in the app
// calls these functions and doesn't care that it's Supabase underneath.

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data } = await _supabase.auth.getSession();
  return data.session;
}

function onAuthChange(callback) {
  _supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

async function signInWithMagicLink(email) {
  const { error } = await _supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

async function signOut() {
  await _supabase.auth.signOut();
}

/* ---------- habits ----------
   { id, user_id, key, name, emoji, sort_order, archived,
     type: 'boolean' | 'time' | 'duration' | 'count',
     target,        -- duration: always MINUTES. count: raw count.
     unit,          -- display unit ('min'|'hr'|'glasses'|'oz'|'ml'|'L'|'meals')
     time_of_day }  -- 'HH:MM' for type 'time'
   `key` is immutable once created — entries.habit_id points at it. */

async function getHabits({ includeArchived = false } = {}) {
  let query = _supabase.from("habits").select("*").order("sort_order", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function seedHabits(rows) {
  const session = await getSession();
  const payload = rows.map((r) => ({ ...r, user_id: session.user.id }));
  const { error } = await _supabase
    .from("habits")
    .upsert(payload, { onConflict: "user_id,key", ignoreDuplicates: true });
  if (error) throw error;
}

async function addHabit(habit) {
  const session = await getSession();
  const { data, error } = await _supabase
    .from("habits")
    .insert({ ...habit, user_id: session.user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateHabit(id, patch) {
  const { error } = await _supabase.from("habits").update(patch).eq("id", id);
  if (error) throw error;
}

/* ---------- entries ----------
   { id, user_id, habit_id, date ('YYYY-MM-DD'), done, value } */

async function getEntries(sinceDate, untilDate) {
  let query = _supabase
    .from("entries")
    .select("habit_id, date, done, value")
    .gte("date", sinceDate);
  if (untilDate) query = query.lte("date", untilDate);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function setEntry(habitKey, date, { done, value = null }) {
  const session = await getSession();
  const { error } = await _supabase.from("entries").upsert(
    {
      user_id: session.user.id,
      habit_id: habitKey,
      date,
      done,
      value,
    },
    { onConflict: "user_id,habit_id,date" }
  );
  if (error) throw error;
}

/* ---------- ideas ----------
   ideas:      { id, user_id, title, body, created_at, last_edited_at }
   idea_coats: { id, user_id, idea_id, created_at } — one row per editing
               session. Append-only: the database has no update/delete policy
               for it, so the counter can't be rewritten. */

async function getIdeas() {
  const { data, error } = await _supabase
    .from("ideas")
    .select("id, title, body, created_at, last_edited_at, idea_coats(created_at)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function createIdea({ title, body, last_edited_at }) {
  const session = await getSession();
  const { data, error } = await _supabase
    .from("ideas")
    .insert({ user_id: session.user.id, title, body, last_edited_at })
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data;
}

async function updateIdea(id, patch) {
  const { error } = await _supabase.from("ideas").update(patch).eq("id", id);
  if (error) throw error;
}

async function deleteIdea(id) {
  const { error } = await _supabase.from("ideas").delete().eq("id", id);
  if (error) throw error;
}

async function addCoat(ideaId) {
  const session = await getSession();
  const { data, error } = await _supabase
    .from("idea_coats")
    .insert({ user_id: session.user.id, idea_id: ideaId })
    .select("created_at")
    .single();
  if (error) throw error;
  return data;
}
