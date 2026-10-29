/* ---------- the learner, across nights ----------

   Everything else in this prototype forgets the child the moment they close
   it. That was fine while a night was a one-off. It is not fine for the thing
   we are now testing, which is whether a child comes BACK to the same
   scenario tomorrow and gets further into it — a question you cannot ask
   without knowing who they are.

   WE HAVE NO CHILD ID. `bridge.js` is outbound only: the app sends this page
   nothing, not the language, not the quest, not the child. So this is the
   only identity there is — a random id of our own, in this origin's
   localStorage. It survives as long as the webview's storage survives, which
   is not always and not forever.

   That limitation is not a reason to fake it. It is the first thing to
   MEASURE, which is why `storage` rides on every event: a child who did not
   come back and a child we could not recognise look identical in the numbers
   and need completely different fixes.

   THE ARM LIVES HERE TOO, and that is the point of putting it here rather
   than behind a feature flag. A child assigned the mastery engine tonight has
   to meet the mastery engine tomorrow, or the come-back-tomorrow test
   measures a different child's first night. Arm and mastery share one store
   so they share one lifetime: when the storage goes, both go, and the session
   says so rather than quietly becoming a fresh learner in the other arm. */
window.STORE = (function () {
  const KEY = 'nlt.learner.v1';
  const DAY = 86400000;
  /* 'scenarios' is the night as it stands: a fixed ladder of five groups,
     done once. 'mastery' is the Deniz & Pip engine — the same scenario until
     the words stick, and an invitation to come back. */
  const ARMS = ['scenarios', 'mastery'];
  /* How many distinct days to keep. Enough to see a habit, short enough that
     the record cannot grow without bound in a store we do not control. */
  const DAYS_KEPT = 30;

  const q = new URLSearchParams(location.search);
  const today = () => new Date().toISOString().slice(0, 10);

  /* Every read and write, wrapped. Webview storage is refused outright in
     some configurations and throws rather than returning null, and a throw
     at boot would take the night down with it. */
  let available = true;
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { available = false; return null; }
  }
  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; }
    catch { available = false; return false; }
  }

  /* A learner id we make up, because nobody hands us one. */
  function newId() {
    try {
      const a = new Uint8Array(8);
      crypto.getRandomValues(a);
      return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
  }

  /* The arm is decided ONCE, from the id, and never recomputed. Hashing the
     id rather than tossing a coin means the assignment is reproducible: the
     same learner is always in the same arm, and a test can force an arm by
     choosing an id. */
  function armFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ARMS[Math.abs(h) % ARMS.length];
  }

  function fresh() {
    const id = newId();
    return { v: 1, id, arm: armFor(id), born: Date.now(), plays: 0, lastPlay: 0, days: [], mastery: {} };
  }

  let state = null;

  /* Called once at boot, before anything is drawn. Returns what the session
     needs to know about who just arrived. */
  function begin() {
    state = read() || fresh();
    /* A store we could not read is a store we cannot write either, so the
       session runs on a learner who exists only in memory. `storage: false`
       on every event is what separates "did not come back" from "came back
       and we had no way of knowing". */
    if (!available) state = fresh();

    /* ?arm= forces the engine for a tester without disturbing a real
       learner's assignment, which is why it is not written back. */
    const forced = q.get('arm');
    const arm = ARMS.indexOf(forced) >= 0 ? forced : state.arm;

    const prevPlay = state.lastPlay || 0;
    const prevDays = (state.days || []).length;
    state.plays = (state.plays || 0) + 1;
    state.lastPlay = Date.now();
    const d = today();
    if (!state.days) state.days = [];
    if (state.days[state.days.length - 1] !== d) state.days.push(d);
    if (state.days.length > DAYS_KEPT) state.days = state.days.slice(-DAYS_KEPT);
    write(state);

    return {
      id: state.id,
      arm,
      armForced: arm !== state.arm,
      storage: available,
      plays: state.plays,
      /* Not "has played before" — "has played before ON ANOTHER DAY". Two
         goes in one sitting is a replay; coming back after a night's sleep is
         the thing under test, and they should never be counted together. */
      returning: prevDays > 0 && state.days[state.days.length - 1] !== state.days[0] && prevPlay > 0,
      daysSeen: state.days.length,
      daysSince: prevPlay ? Math.floor((Date.now() - prevPlay) / DAY) : null,
      /* The record this holds is MASTERY's, not a flat word-to-score map:
         { patterns, words, turn, sessionIndex, ... }. Reading it the other
         way counts zero for ever and the welcome-back line never fires. */
      mastered: countWords(state.mastery, w => w && w.mastery >= 0.85),
      known: countWords(state.mastery, () => true),
    };
  }

  const countWords = (rec, ok) => {
    const ws = (rec && rec.words) || {};
    let n = 0;
    for (const id of Object.keys(ws)) if (ok(ws[id])) n += 1;
    return n;
  };

  /* The mastery map, for the engine that uses it. Arm A never touches it. */
  const mastery = () => (state && state.mastery) || {};
  function setMastery(map) {
    if (!state) return false;
    state.mastery = map || {};
    return write(state);
  }

  /* For a tester, and for the harness: start again as a brand new child. */
  function reset() {
    try { localStorage.removeItem(KEY); } catch {}
    state = null;
    available = true;
    return begin();
  }

  return { begin, mastery, setMastery, reset,
           get state() { return state; },
           get available() { return available; },
           ARMS };
})();
