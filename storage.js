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
