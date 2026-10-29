/* ---------- the learner mastery model ----------

   A port of Max's Turkish trainer, spec in `docs/mastery-model.md`. That
   document is the authority: where this file and it disagree, this file is
   wrong. Every number below is quoted from it and the section it comes from
   is named, so a reader can check one against the other without guessing.

   WHAT THIS IS FOR. The night as it stands walks a fixed ladder once and
   forgets it. This replaces the ladder's fixed positions with per-item
   mastery, which is the whole of the difference: on a second night the
   engine asks what is weak rather than replaying a list, and "come back
   tomorrow" has something to come back TO.

   THE ONE INVARIANT, from the stack document: "Mastery numbers never touch
   the AI — the deterministic learner model owns all scoring; the AI only
   reads whitelisted vocabulary and writes natural language." Nothing in this
   file calls a model and nothing a model returns is allowed to set a score.
   The coach writes prose; the numbers are decided here.

   WHAT IS DELIBERATELY NOT PORTED. His section 5, the Turkish inflection
   search, solves a problem we do not have: our child taps pills, so a token
   either is the pill or is not. If free typing ever lands, that section is
   the thing to come back for.

   And his turn order is tutor -> user -> character. Ours stays
   actor -> coach -> child. The mastery model is state and does not care; the
   order is a rendering decision and it is ours. */
window.MASTERY = (function () {

  /* ---------- section 2: the bar ---------- */
  const BAR = 0.85;
  /* The tolerance is not decoration. Section 1: repeated +0.15 / +0.05
     additions land on 0.8499999999999999, which is 85% on screen and below
     the gate in the code. Scores are rounded to 4 decimals on the way in and
     the gate is checked with slack on top of that. */
  const EPS = 1e-6;
  const round4 = v => Math.round(v * 10000) / 10000;
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const score = v => round4(clamp(v));
  const atBar = m => (m || 0) >= BAR - EPS;
  /* Section 2's softer display threshold: 0.75 turns "practising" into "can
     use" and puts the item in the session's acquired list. */
  const CAN_USE = 0.75;

  /* ---------- section 4: hint damping ---------- */
  /* Hints reveal the construction more than the words, so patterns are damped
     harder than vocabulary. Applied to GAINS only — the penalties in section
     3 carry their own hint rule and are not multiplied again. */
  function damp(hints) {
    const h = hints || 0;
    if (h <= 0) return { pattern: 1.0, vocab: 1.0 };
    if (h === 1) return { pattern: 0.6, vocab: 0.75 };
    return { pattern: 0.3, vocab: 0.5 };
  }
  /* "Two retries per turn are penalty-free; the trainer moves on after the
     third." */
  const FREE_RETRIES = 2;

  /* ---------- section 3: how mastery changes ---------- */
  /* The pattern gain depends on how hard the retrieval was. A word produced
     in the open is worth more than the same word read off the screen. */
  const PATTERN_GAIN = { base: 0.10, warm: 0.15, contrast: 0.15, transfer: 0.20, oneshot: 0.25 };
  const WORD_PRODUCED = 0.25;   // per produced target word
  const WORD_READ     = 0.05;   // the actor's target-language words, passive
  const WORD_EXCHANGE = 0.20;   // valid but unexpected answer, times damping
  const WRONG_PATTERN = -0.10;  // first failure of the turn
  const WRONG_HINTED  = -0.15;  // ...if two hints were used
  const HINT2_DROP    = -0.15;  // charged when the SECOND hint is shown

  /* ---------- section 9: spaced retrieval ---------- */
  /* "~5 turns, next session, +3 sessions, then +7 sessions; a failure resets
     the interval to 3 turns." The streak indexes this ladder. */
  const TURN_GAP = 5, FAIL_GAP = 3;
  const SESSION_GAPS = [0, 1, 3, 7];

  /* ---------- the record ---------- */
  function blankPattern() {
    return { mastery: 0, introduced: false, exposures: 0, lastSeenTurn: -99,
             retrievalStreak: 0, dueTurn: 0, dueSession: 0,
             oneShotCandidate: false, oneShotSuccess: false };
  }
  const blankWord = () => ({ mastery: 0, exposures: 0, seen: false });

  function blank() {
    return { patterns: {}, words: {}, turn: 0, sessionIndex: 0,
             /* "errors (last 20)" — kept short on purpose; it feeds error
                mining and the priority term, not a permanent record. */
             errors: [], acquired: [], newVocab: [], hintsUsedThisTurn: 0 };
  }

  /* Section 3: "pure functions over an immutable clone of the state, so every
     turn is replayable and diffable". The clone is the reason the diff in
     section 9 can exist at all. */
  const clone = s => JSON.parse(JSON.stringify(s));
  const pat = (s, id) => (s.patterns[id] = s.patterns[id] || blankPattern());
  const wrd = (s, id) => (s.words[id] = s.words[id] || blankWord());

  /* ---------- section 2: readings ---------- */
  /* "mean pattern mastery and mean word mastery, weighted 50/50" — NOT the
     mean of everything pooled, which would let a scenario with twenty words
     and three patterns report mostly vocabulary. */
  function levelMastery(s, patternIds, wordIds) {
    const mean = (ids, map) => {
      if (!ids || !ids.length) return 0;
      let t = 0;
      for (const id of ids) t += (map[id] && map[id].mastery) || 0;
      return t / ids.length;
    };
    return round4(0.5 * mean(patternIds, s.patterns) + 0.5 * mean(wordIds, s.words));
  }

  /* "every pattern is introduced and above the bar, no word is unseen, and no
     word is below the bar (minimum two patterns introduced)". */
  function scenarioMastered(s, patternIds, wordIds) {
    const ps = (patternIds || []).map(id => s.patterns[id]).filter(Boolean);
    if (ps.length < 2) return false;
    if (ps.length !== (patternIds || []).length) return false;
    if (!ps.every(p => p.introduced && atBar(p.mastery))) return false;
    for (const id of wordIds || []) {
      const w = s.words[id];
      if (!w || !w.seen) return false;
      if (!atBar(w.mastery)) return false;
    }
    return true;
  }

  /* ---------- section 6: mastery drives the scaffold ---------- */
  /* "A turn takes the MINIMUM mastery across its target pattern and target
     words (an unseen word counts as 0), so one weak item keeps the support
     up." The thresholds are exclusive upper bounds, L4 is the open top. */
  function scaffold(s, patternId, wordIds) {
    let m = patternId ? ((s.patterns[patternId] || blankPattern()).mastery || 0) : 1;
    for (const id of wordIds || []) {
      const w = s.words[id];
      m = Math.min(m, (w && w.seen) ? (w.mastery || 0) : 0);
    }
    if (m < 0.20) return 0;
    if (m < 0.40) return 1;
    if (m < 0.60) return 2;
    if (m < 0.80) return 3;
    return 4;
  }

  /* ---------- section 7: what is practised next ---------- */
  /* Weakness as a WEIGHT, not the yes/no check. Section 2 is explicit that
     the word means two things; this is the weight. */
  function weakness(m) {
    const v = m || 0;
    return atBar(v) ? (1 - v) * 0.25 : (1 - v);
  }
  /* 0-2: one for each elapsed due date. */
  function dueness(p, turn, session) {
    if (!p) return 0;
    let d = 0;
    if ((p.dueSession || 0) > 0 && session >= p.dueSession) d += 1;
    if ((p.dueTurn || 0) > 0 && turn >= p.dueTurn) d += 1;
    return d;
  }
  /* "1.2 if used on the previous turn, decaying as 1.2 / turns since use up
     to 4 turns back; zero beyond that." */
  function fatigue(p, turn) {
    if (!p) return 0;
    const since = turn - (p.lastSeenTurn == null ? -99 : p.lastSeenTurn);
    if (since <= 0) return 1.2;
    if (since > 4) return 0;
    return 1.2 / since;
  }
  /* A deterministic tiebreaker in [0, 0.1). Small enough that it only ever
     separates exact ties, and turn-indexed so the same pattern does not win
     every tie for the whole night. */
  function rotation(index, turn, count) {
    if (!count) return 0;
    return ((index + turn) % count) / count * 0.1;
  }
  /* Unresolved: logged against this pattern and not followed by a correct
     use of it. Uncapped at weight 1, which is the spec's choice — a pattern
     the child keeps getting wrong should out-shout everything else. */
  function unresolved(s, patternId) {
    let n = 0;
    for (const e of s.errors || []) if (e.patternId === patternId && !e.resolved) n += 1;
    return n;
  }

  function priority(s, patternId, index, count) {
    const p = s.patterns[patternId] || blankPattern();
    return round4(
      weakness(p.mastery) * 2
      + dueness(p, s.turn, s.sessionIndex) * 1.5
      + unresolved(s, patternId)
      - fatigue(p, s.turn)
      + rotation(index, s.turn, count)
    );
  }

  /* The whole list, strongest claim first. The caller decides what to do with
     the winner; the model only ranks. */
  function rank(s, patternIds) {
    const n = (patternIds || []).length;
    return (patternIds || [])
      .map((id, i) => ({ id, priority: priority(s, id, i, n) }))
      .sort((a, b) => b.priority - a.priority);
  }

  /* Section 2: "words at or above the bar are never selected as targets."
     Section 8: weakest first, but read from a turn-dependent offset so a word
     the child just failed is not immediately re-served. */
  function targetWords(s, wordIds, want) {
    const below = (wordIds || [])
      .map(id => ({ id, m: (s.words[id] && s.words[id].mastery) || 0, seen: !!(s.words[id] && s.words[id].seen) }))
      .filter(w => !atBar(w.m))
      .sort((a, b) => a.m - b.m || (a.id < b.id ? -1 : 1));
    if (!below.length) return [];
    const off = s.turn % below.length;
    const out = [];
    for (let i = 0; i < Math.min(want || 1, below.length); i++) out.push(below[(off + i) % below.length].id);
    return out;
  }

  /* ---------- section 9: scheduling ---------- */
  function schedule(p, ok, turn, session) {
    if (!ok) {
      p.retrievalStreak = 0;
      p.dueTurn = turn + FAIL_GAP;
      p.dueSession = session;
      return;
    }
    p.retrievalStreak = (p.retrievalStreak || 0) + 1;
    const step = Math.min(p.retrievalStreak, SESSION_GAPS.length - 1);
    p.dueTurn = turn + TURN_GAP;
    p.dueSession = session + SESSION_GAPS[step];
  }

  /* ---------- section 3: applying a turn ----------
     One entry point, so there is one place where a number can change and one
     place to read when a number looks wrong. Returns the next state and the
     diff section 9 asks for: only what moved, largest first. */
  function apply(state, ev) {
    const s = clone(state);
    const before = { patterns: {}, words: {} };
    const note = (kind, id) => {
      if (kind === 'pattern' && !(id in before.patterns)) before.patterns[id] = pat(s, id).mastery;
      if (kind === 'word' && !(id in before.words)) before.words[id] = wrd(s, id).mastery;
    };

    const hints = ev.hints || 0;
    const d = damp(hints);
    const pid = ev.patternId || null;
    const targets = ev.words || [];
    const produced = ev.produced || [];

    if (pid) { note('pattern', pid); pat(s, pid).exposures += 1; }
    for (const id of targets) { note('word', id); const w = wrd(s, id); w.exposures += 1; w.seen = true; }

    switch (ev.kind) {
      /* The actor's target-language words, read rather than produced.
         "Reading is credited far below production." */
      case 'read':
        for (const id of (ev.readWords || [])) {
          note('word', id); const w = wrd(s, id);
          w.exposures += 1; w.seen = true;
          w.mastery = score(w.mastery + WORD_READ * d.vocab);
        }
        break;

      /* "Tutor reaction / correction text: exposure only, no mastery. Seeing
         a word never proves the learner can use it." */
      case 'reaction':
        for (const id of (ev.readWords || [])) { note('word', id); const w = wrd(s, id); w.exposures += 1; w.seen = true; }
        break;

      /* The hit. Pattern gain scales with how hard the retrieval was; each
         word the child actually produced is worth 0.25 before damping. */
      case 'produced': {
        if (pid) {
          const p = pat(s, pid);
          /* Whether this hit TAUGHT the construction or TESTED it, which is
             the difference between setting the one-shot candidate and
             satisfying it. The engine has no separate teach event - the first
             correct answer is the teach - so this cleared a candidate it had
             set one line earlier, and the one-shot phase could never see one.
             A construction was therefore taught and never retested. */
          const taught = !p.introduced;
          p.mastery = score(p.mastery + (PATTERN_GAIN[ev.phase] || PATTERN_GAIN.base) * d.pattern);
          p.introduced = true;
          p.lastSeenTurn = s.turn;
          if (taught) p.oneShotCandidate = true;
          else if (p.oneShotCandidate) { p.oneShotSuccess = true; p.oneShotCandidate = false; }
          schedule(p, true, s.turn, s.sessionIndex);
          /* "not yet resolved by a later correct use" — this is that use. */
          for (const e of s.errors) if (e.patternId === pid) e.resolved = true;
        }
        for (const id of produced) {
          note('word', id); const w = wrd(s, id);
          w.seen = true;
          w.mastery = score(w.mastery + WORD_PRODUCED * d.vocab);
        }
        break;
      }

      /* Valid, but not with the construction the turn was about. The pattern
         gets nothing; the words still count, because they were still said. */
      case 'offPattern':
        for (const id of produced) {
          note('word', id); const w = wrd(s, id);
          w.seen = true;
          w.mastery = score(w.mastery + WORD_EXCHANGE * d.vocab);
        }
        break;

      /* The miss. Only the FIRST failure of a turn is charged: "retries in
         the same turn are penalty-free", and a typo is not an error at all. */
      case 'wrong': {
        if (ev.typo) break;
        if ((ev.attempt || 0) > 0) break;
        const drop = hints >= 2 ? WRONG_HINTED : WRONG_PATTERN;
        if (pid) {
          const p = pat(s, pid);
          p.mastery = score(p.mastery + drop);
          p.lastSeenTurn = s.turn;
          schedule(p, false, s.turn, s.sessionIndex);
          s.errors.push({ patternId: pid, turn: s.turn, type: ev.errorType || 'pattern', resolved: false });
          if (s.errors.length > 20) s.errors = s.errors.slice(-20);
        }
        /* "same drop mirrored onto the turn's target words" */
        for (const id of targets) { note('word', id); const w = wrd(s, id); w.mastery = score(w.mastery + drop); }
        break;
      }

      /* "Charged when the second hint is shown, not when the answer
         arrives." So it is its own event, not a modifier on the answer. */
      case 'hint2': {
        if (pid) { const p = pat(s, pid); p.mastery = score(p.mastery + HINT2_DROP); }
        for (const id of targets) { note('word', id); const w = wrd(s, id); w.mastery = score(w.mastery + HINT2_DROP); }
        break;
      }

      /* A construction put in front of the child for the first time. */
      case 'introduce':
        if (pid) { const p = pat(s, pid); p.introduced = true; p.oneShotCandidate = true; p.lastSeenTurn = s.turn; }
        break;

      default: break;
    }

    /* Section 2's softer threshold, collected as the session goes so the
       summary has something to say that is not a percentage. */
    for (const [id, m] of Object.entries(before.patterns))
      if (m < CAN_USE && s.patterns[id].mastery >= CAN_USE && s.acquired.indexOf(id) < 0) s.acquired.push(id);
    for (const [id, m] of Object.entries(before.words))
      if (m === 0 && s.words[id].mastery > 0 && s.newVocab.indexOf(id) < 0) s.newVocab.push(id);

    /* Section 9: "reports only the items that moved, largest change first". */
    const moved = [];
    for (const [id, m] of Object.entries(before.patterns))
      if (s.patterns[id].mastery !== m) moved.push({ kind: 'pattern', id, from: m, to: s.patterns[id].mastery, by: round4(s.patterns[id].mastery - m) });
    for (const [id, m] of Object.entries(before.words))
      if (s.words[id].mastery !== m) moved.push({ kind: 'word', id, from: m, to: s.words[id].mastery, by: round4(s.words[id].mastery - m) });
    moved.sort((a, b) => Math.abs(b.by) - Math.abs(a.by));

    return { state: s, moved };
  }

  /* Turn and session bookkeeping, kept here so nothing else has to know the
     shape of the record. */
  function nextTurn(state) { const s = clone(state); s.turn += 1; s.hintsUsedThisTurn = 0; return s; }
  function nextSession(state) {
    const s = clone(state);
    s.sessionIndex += 1; s.turn = 0; s.hintsUsedThisTurn = 0;
    s.acquired = []; s.newVocab = [];
    return s;
  }

  return { BAR, EPS, CAN_USE, FREE_RETRIES, PATTERN_GAIN, SESSION_GAPS,
           blank, blankPattern, apply, nextTurn, nextSession,
           scaffold, levelMastery, scenarioMastered,
           weakness, dueness, fatigue, rotation, unresolved, priority, rank,
           targetWords, schedule, damp, atBar, round4 };
})();
