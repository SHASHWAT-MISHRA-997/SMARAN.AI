/**
 * Conversations kept on the device.
 *
 * With no backend there is no database, and a chat that vanishes when the app
 * is closed is not a chat. These live in local storage, per session, on the
 * phone only - nothing is uploaded anywhere.
 *
 * Bounded on purpose. Local storage is a few megabytes and shared with
 * everything else the app keeps; an unbounded transcript would eventually
 * start throwing quota errors in the middle of a reply, which is a far worse
 * failure than an old message being dropped.
 */

const KEY = (sessionId) => `sm_local_msgs_${sessionId}`;
const INDEX = 'sm_local_sessions';

const MAX_MESSAGES = 400;

export const loadMessages = (sessionId) => {
  if (!sessionId) return [];
  try {
    const raw = localStorage.getItem(KEY(sessionId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveMessages = (sessionId, messages) => {
  if (!sessionId) return;
  try {
    const kept = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES);
    localStorage.setItem(KEY(sessionId), JSON.stringify(kept));
  } catch {
    // Full, or storage is unavailable. Losing the write is better than
    // losing the reply that is still being read on screen.
  }
};

export const clearMessages = (sessionId) => {
  try {
    localStorage.removeItem(KEY(sessionId));
  } catch { /* nothing to do */ }
};

/* ── the session list ──────────────────────────────────────────────────── */

export const loadSessions = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveSessions = (sessions) => {
  try {
    localStorage.setItem(INDEX, JSON.stringify(Array.isArray(sessions) ? sessions : []));
  } catch { /* nothing to do */ }
};

/** Give a session the name of what was actually asked in it. */
export const titleFrom = (text) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New Conversation';
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
};

/* ── remembered facts ──────────────────────────────────────────────────── */

/**
 * Facts the assistant should keep in mind, on this device.
 *
 * The memory panel said "remembers across sessions" and, on a phone, did not:
 * adding a fact posted it to a backend that is not there, the row was drawn
 * anyway, and it was gone on the next launch. Kept here instead - and, more
 * to the point, actually put in front of the model, because storing a fact
 * nothing reads would be the same lie with extra steps.
 */
const FACTS = 'sm_local_facts';
const MAX_FACTS = 100;

export const loadFacts = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FACTS) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveFacts = (facts) => {
  try {
    localStorage.setItem(FACTS, JSON.stringify((facts || []).slice(-MAX_FACTS)));
  } catch { /* storage full or unavailable */ }
};

export const addFact = (text) => {
  const clean = String(text || '').trim();
  if (!clean) return loadFacts();
  const all = [...loadFacts(), { id: `f-${Date.now()}`, content: clean }];
  saveFacts(all);
  return loadFacts();
};

export const removeFact = (id) => {
  const all = loadFacts().filter((f) => f.id !== id);
  saveFacts(all);
  return all;
};

/* ── merging what the other device wrote ───────────────────────────────── */

/**
 * Fold messages from the paired computer into what is stored here.
 *
 * Matched on role, content and the minute they were written, because the two
 * sides generate ids independently while apart - the desktop's id for a
 * message is not the phone's, so ids cannot be compared. The minute is enough:
 * the same person does not send the same text twice in the same minute, and
 * being slightly conservative here duplicates nothing.
 */
export const mergeRemote = (incoming = []) => {
  const touched = new Set();
  const sessions = loadSessions();
  const known = new Map(sessions.map((s) => [s.id, s]));

  for (const item of incoming) {
    if (!item?.session_id || !item?.content) continue;
    const id = item.session_id;

    if (!known.has(id)) {
      const created = { id, title: item.session_title || 'Conversation', created_at: item.created_at };
      known.set(id, created);
    }

    const mine = loadMessages(id);
    const minute = String(item.created_at || '').slice(0, 16);
    const already = mine.some((m) => m.role === item.role
      && m.content === item.content
      && String(m.created_at || '').slice(0, 16) === minute);
    if (already) continue;

    mine.push({
      id: `remote-${item.created_at}-${mine.length}`,
      role: item.role,
      content: item.content,
      model_used: item.model_used || undefined,
      created_at: item.created_at,
    });
    mine.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    saveMessages(id, mine);
    touched.add(id);
  }

  if (touched.size) saveSessions([...known.values()]);
  return touched;
};
