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

// entries: { id, user_id, habit_id, date ('YYYY-MM-DD'), done, value }

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

async function setEntry(habitId, date, { done, value = null }) {
  const session = await getSession();
  const { error } = await _supabase.from("entries").upsert(
    {
      user_id: session.user.id,
      habit_id: habitId,
      date,
      done,
      value,
    },
    { onConflict: "user_id,habit_id,date" }
  );
  if (error) throw error;
}
