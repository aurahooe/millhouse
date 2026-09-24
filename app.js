const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
function prettyHour(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric" });
}
function remaining() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(60, 0, 0);
  const ms = next - now;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m + "m " + String(s).padStart(2, "0") + "s";
}
async function currentUser() {
  const { data } = await sb.auth.getUser();
  return data.user || null;
}
async function ensureProfile(user) {
  const handle = (user.email || "guest").split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 24) || "guest";
  await sb.from("mill_profiles").upsert({ id: user.id, handle: handle + user.id.slice(0, 4), display_name: handle });
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderNotes(el, rows, mine = false) {
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<p class="empty">' + (mine ? "Nothing on the desk yet." : "The wall is quiet. Be first.") + "</p>";
    return;
  }
  el.innerHTML = rows.map((n, i) => {
    const tilt = ((i % 5) - 2) * 0.45;
    const actions = mine ? '<div class="row"><button class="ghost" data-toggle="' + n.id + '" data-public="' + n.is_public + '">' + (n.is_public ? "Unpublish" : "Publish") + '</button><button class="ghost" data-del="' + n.id + '">Burn</button></div>' : "";
    return '<article class="card" style="--tilt:' + tilt + 'deg;--d:' + (i * 60) + 'ms"><h3>' + escapeHtml(n.title) + "</h3><p>" + escapeHtml(n.body) + '</p><div class="meta">' + (n.is_public ? "public" : "private") + " · " + prettyHour(n.created_at) + "</div>" + actions + "</article>";
  }).join("");
}
async function loadWall() {
  const { data: hours } = await sb.from("mill_hours").select("*").order("created_at", { ascending: false }).limit(12);
  const latest = hours && hours[0];
  if (latest) {
    if ($("headline")) $("headline").textContent = latest.headline;
    if ($("editorial")) $("editorial").textContent = latest.body;
  }
  if ($("hours") && hours) {
    $("hours").innerHTML = hours.map((h) => "<li><time>" + prettyHour(h.hour_key) + "</time><div><strong>" + escapeHtml(h.headline) + "</strong><div>" + escapeHtml(h.body) + "</div></div></li>").join("");
  }
  const { data: notes } = await sb.from("mill_notes").select("id,title,body,is_public,created_at").eq("is_public", true).order("created_at", { ascending: false }).limit(24);
  renderNotes($("notes"), notes);
}
async function loadMine(user) {
  if (!$("mine")) return;
  if (!user) { $("mine").innerHTML = '<p class="empty">Sign in to keep slips.</p>'; return; }
  const { data } = await sb.from("mill_notes").select("*").eq("author_id", user.id).order("created_at", { ascending: false });
  renderNotes($("mine"), data, true);
}
async function refreshAuthUi(user) {
  const btn = $("authBtn");
  if (!btn) return;
  btn.textContent = user ? "Sign out" : "Sign in";
  btn.dataset.mode = user ? "out" : "in";
}
function wireAuth() {
  const modal = $("authModal");
  const form = $("authForm");
  const btn = $("authBtn");
  btn?.addEventListener("click", async () => {
    if (btn.dataset.mode === "out") { await sb.auth.signOut(); location.reload(); return; }
    modal?.showModal();
  });
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || "in";
    const email = form.email.value.trim();
    const password = form.password.value;
    const msg = $("authMsg");
    msg.textContent = "Working…";
    const fn = mode === "up" ? sb.auth.signUp.bind(sb.auth) : sb.auth.signInWithPassword.bind(sb.auth);
    const { data, error } = await fn({ email, password });
    if (error) { msg.textContent = error.message; return; }
    if (data.user) await ensureProfile(data.user);
    msg.textContent = data.session ? "In." : "Check your email if confirmation is on.";
    if (data.session) { modal.close(); location.reload(); }
  });
}
function wireDesk(user) {
  const form = $("noteForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("saveMsg");
    if (!user) { $("authModal")?.showModal(); msg.textContent = "Sign in first."; return; }
    const { error } = await sb.from("mill_notes").insert({ author_id: user.id, title: form.title.value.trim(), body: form.body.value.trim(), is_public: form.is_public.checked });
    if (error) { msg.textContent = error.message; return; }
    const pub = form.is_public.checked;
    form.reset();
    msg.textContent = pub ? "On the wall." : "In the drawer.";
    await loadMine(user);
  });
  $("mine")?.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.dataset.toggle) {
      await sb.from("mill_notes").update({ is_public: t.dataset.public !== "true", updated_at: new Date().toISOString() }).eq("id", t.dataset.toggle);
      await loadMine(user);
    }
    if (t.dataset.del) {
      await sb.from("mill_notes").delete().eq("id", t.dataset.del);
      await loadMine(user);
    }
  });
}
function tickClock() {
  if ($("clock")) $("clock").textContent = prettyHour(new Date());
  if ($("until")) $("until").textContent = "next turn in " + remaining();
}
async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  wireAuth();
  const user = await currentUser();
  await refreshAuthUi(user);
  await loadWall();
  wireDesk(user);
  await loadMine(user);
}
boot();
