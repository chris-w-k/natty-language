/* engine.js — the deterministic learner model.
   Pure functions over a cloned state. No DOM, no network, no randomness that
   isn't seeded by the turn number. The evaluator may be a model call; the
   SCORE is always computed here. That invariant is the whole point. */

window.ENGINE = (function () {

  /* ---------- constants ----------
     Tuned so THREE clean productions master an item, which is what makes the
     support ladder visible: one word, then most of the phrase, then all of it.
     Two productions was faster but skipped straight from L0 to L2. */
  const GAIN = {
    voice:  0.35,   // said the whole phrase aloud, no help
    chips:  0.30,   // filled the gaps, no help
    hinted: 0.20,   // correct after the coach modelled it
    heard:  0.05    // appeared in a character's line
  };
  const DECAY_PER_WEEK = 0.05;  // written for the real system; inert here (no persistence)

  const clamp = v => Math.round(Math.max(0, Math.min(1, v)) * 1e4) / 1e4;

  /* ---------- text ---------- */
  const fold = s => s
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u')
    .replace(/ñ/g, 'n').replace(/ç/g, 'c');
  const norm = s => fold(String(s || '').toLowerCase())
    .replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  /* ---------- state ---------- */
  function allItems(quest) {
    return quest.scenes.flatMap(s => s.items.map(it => ({ ...it, sceneId: s.id })));
  }

  function createState(quest) {
    const items = {};
    for (const it of allItems(quest)) {
      items[it.id] = { id: it.id, sceneId: it.sceneId, mastery: 0, exposures: 0, fails: 0, owed: false, lastTurn: -99 };
    }
    return {
      turn: 0,
      sceneIndex: 0,
      sceneStartTurn: 0,
      reopened: [],
      items,
      coins: 0,
      finished: false,
      log: []
    };
  }

  const BAR     = q => q.session.masteryBar;
  const CAN_USE = q => q.session.canUseBar;
  const MERCY   = q => q.session.mercyAfterFailedTurns;

  function label(mastery, seen, quest) {
    if (!seen) return 'new';
    return mastery >= CAN_USE(quest) ? 'can use' : 'practising';
  }

  function overall(state, quest) {
    const ids = Object.keys(state.items);
    if (!ids.length) return 0;
    return ids.reduce((s, id) => s + state.items[id].mastery, 0) / ids.length;
  }

  /* ---------- scaffold ----------
     One number, two visible effects: how much Spanish the coach shows,
     and how many decoy chips are in the tray. */
  function bucket(m) { return m < 0.2 ? 0 : m < 0.4 ? 1 : m < 0.6 ? 2 : m < 0.8 ? 3 : 4; }

  function scaffoldFor(state, itemId) {
    const st = state.items[itemId];
    return bucket(st ? st.mastery : 0);
  }

  const DISTRACTORS_AT = [1, 2, 2, 3, 4];

  /* Progressive cloze, the Turkish way: one more word is dropped at each rung
     until the learner is producing the whole phrase. For a four-word phrase:
       L0  "I am going to a ___"     English frame, 1 word
       L1  "Voy a un ___"            Spanish frame, 1 word
       L2  "Voy a ___ ___"           2 words
       L3  "Voy ___ ___ ___"         3 words
       L4  "___ ___ ___ ___"         all of it
     Short phrases collapse rungs rather than repeating them.                  */
  function gapCount(n, scaffold) {
    return Math.min(n, Math.max(1, Math.ceil(n * (scaffold + 1) / 5)));
  }

  function buildPlan(item, scaffold) {
    const chips = item.chips.slice();
    const n = chips.length;
    const gaps = Math.min(n, gapCount(n, scaffold));
    const answer = chips.slice(n - gaps);
    if (scaffold === 0) {
      const nat = String(item.native).replace(/[?!.]+$/, '').split(' ');
      const frame = nat.slice(0, Math.max(1, nat.length - 1)).join(' ');
      return { mode: 'native-frame', frame, locked: [], answer, gaps };
    }
    return { mode: 'target-frame', frame: '', locked: chips.slice(0, n - gaps), answer, gaps };
  }

  /* Chips mode is judged on the part the learner supplied; voice mode on the
     whole phrase, because you cannot speak a gap. */
  function checkGaps(placed, plan) {
    const a = placed.map(norm).join(' ').trim();
    const b = plan.answer.map(norm).join(' ').trim();
    if (a === b) return { target_produced: true, understandable: true, error_type: 'none', correction: '' };
    if (a.split(' ').slice().sort().join(' ') === b.split(' ').slice().sort().join(' '))
      return { target_produced: false, understandable: true, error_type: 'word_order', correction: plan.answer.join(' ') };
    return { target_produced: false, understandable: false, error_type: 'wrong_word', correction: plan.answer.join(' ') };
  }

  /* ---------- turn picking ----------
     Within the current scene only: the weakest unfinished item, avoiding an
     immediate repeat when there is another one available. */
  function sceneOf(quest, state) { return quest.scenes[state.sceneIndex]; }

  function sceneDone(state, scene, quest) {
    return scene.items.every(it => {
      const st = state.items[it.id];
      return st.owed || st.mastery >= BAR(quest);
    });
  }

  function itemById(quest, id) {
    for (const s of quest.scenes) for (const it of s.items) if (it.id === id) return it;
    return null;
  }

  function pickNext(state, quest) {
    if (state.finished) return null;
    const scene = sceneOf(quest, state);
    if (!scene) return null;
    const isLast = state.sceneIndex === quest.scenes.length - 1;
    const pool = scene.items.slice();
    // items Axel covered for earlier come back in the final scene as bonus turns
    if (isLast) for (const id of (state.reopened || [])) {
      const it = itemById(quest, id);
      if (it && !pool.some(p => p.id === id)) pool.push(it);
    }
    const open = pool.filter(it => {
      const st = state.items[it.id];
      return !st.owed && st.mastery < BAR(quest);
    });
    if (!open.length) return null;
    const sorted = open.slice().sort((a, b) => {
      const A = state.items[a.id], B = state.items[b.id];
      if (Math.abs(A.mastery - B.mastery) > 1e-6) return A.mastery - B.mastery;
      return A.lastTurn - B.lastTurn;
    });
    // avoid drilling the same item twice running when a sibling is available
    if (sorted.length > 1 && sorted[0].lastTurn === state.turn - 1 &&
        state.items[sorted[0].id].mastery === state.items[sorted[1].id].mastery) {
      return { scene, item: sorted[1] };
    }
    return { scene, item: sorted[0] };
  }

  function advanceScene(state) {
    state.sceneIndex += 1;
    state.sceneStartTurn = state.turn;
    return state;
  }

  /* The scene clock. Mastery gates the door, but a child who is slow rather
     than wrong must still get to see the gig — so a scene also has a ceiling.
     When it is hit, whatever is unfinished is marked owed and comes back in
     the final scene. This is the other half of "hybrid with a mercy rule". */
  function sceneTurnCap(quest) {
    return Math.ceil(quest.session.turnBudget / quest.scenes.length) + 1;
  }

  function sceneOverBudget(state, quest) {
    return (state.turn - state.sceneStartTurn) >= sceneTurnCap(quest);
  }

  function oweRemaining(state, scene, quest) {
    const owed = [];
    for (const it of scene.items) {
      const st = state.items[it.id];
      if (!st.owed && st.mastery < BAR(quest)) { st.owed = true; st.fails = 0; owed.push(it); }
    }
    return owed;
  }

  /* ---------- evaluation ----------
     Local/deterministic path. The server path returns the same shape, so the
     rest of the engine never knows which answered. */
  function evaluateLocal(text, item) {
    const said = norm(text);
    const accept = (item.accept || []).map(norm);
    const target = norm(item.target);

    if (!said) return { target_produced: false, understandable: false, error_type: 'missing_word', correction: item.target };
    if (accept.includes(said) || said === target) {
      return { target_produced: true, understandable: true, error_type: 'none', correction: '' };
    }
    // same words, wrong order
    const a = said.split(' ').slice().sort().join(' ');
    const b = target.split(' ').slice().sort().join(' ');
    if (a === b) return { target_produced: false, understandable: true, error_type: 'word_order', correction: item.target };
    // near miss
    const d = lev(said, target);
    if (d > 0 && d <= 2) return { target_produced: true, understandable: true, error_type: 'typo', correction: item.target };
    const missing = target.split(' ').filter(w => !said.split(' ').includes(w));
    return {
      target_produced: false,
      understandable: false,
      error_type: missing.length ? 'missing_word' : 'wrong_word',
      correction: item.target
    };
  }

  /* ---------- applying outcomes ---------- */
  function creditHeardItem(state, item) {
    const st = state.items[item.id];
    if (!st) return null;
    const before = st.mastery;
    st.exposures += 1;
    st.mastery = clamp(st.mastery + GAIN.heard);
    return st.mastery === before ? null
      : { label: item.target, from: before, to: st.mastery, why: 'heard' };
  }

  function applyCorrect(state, item, { mode, hinted }) {
    const st = state.items[item.id];
    const before = st.mastery;
    const gain = hinted ? GAIN.hinted : (mode === 'voice' ? GAIN.voice : GAIN.chips);
    st.mastery = clamp(st.mastery + gain);
    st.exposures += 1;
    st.fails = 0;
    st.lastTurn = state.turn;
    state.turn += 1;
    state.coins += hinted ? 5 : 10;
    const delta = { label: item.target, from: before, to: st.mastery, why: hinted ? 'correct (helped)' : `correct (${mode})` };
    state.log.push({ turn: state.turn, item: item.id, ...delta });
    return delta;
  }

  function applyWrong(state, item) {
    // No penalty and no turn spent, by design. Retries inside a turn are free —
    // the same rule the Turkish model uses. The cost of being stuck is the
    // scene clock below, not the score.
    const st = state.items[item.id];
    st.fails += 1;
    st.exposures += 1;
    return { label: item.target, from: st.mastery, to: st.mastery, why: 'wrong — no penalty' };
  }

  function mercyDue(state, item, quest) {
    return state.items[item.id].fails >= MERCY(quest);
  }

  function applyMercy(state, item) {
    const st = state.items[item.id];
    st.owed = true;
    st.fails = 0;
    return { label: item.target, from: st.mastery, to: st.mastery, why: 'Axel covered for you — comes back later' };
  }

  /* Owed items are re-opened once the child reaches the final scene, so the
     phrase genuinely resurfaces rather than quietly vanishing. */
  function reopenOwed(state) {
    const reopened = [];
    for (const id of Object.keys(state.items)) {
      const st = state.items[id];
      if (st.owed) { st.owed = false; st.fails = 0; reopened.push(id); }
    }
    state.reopened = (state.reopened || []).concat(reopened);
    return reopened;
  }

  /* ---------- decay (inert in this build) ----------
     No persistence means nothing is ever loaded with an age, so this never
     runs. It is here so the rule exists when state does. */
  function applyDecay(state, daysSinceSeen) {
    const weeks = Math.floor(daysSinceSeen / 7);
    if (weeks < 1) return state;
    for (const id of Object.keys(state.items)) {
      state.items[id].mastery = clamp(state.items[id].mastery - DECAY_PER_WEEK * weeks);
    }
    return state;
  }

  return {
    GAIN, DECAY_PER_WEEK, DISTRACTORS_AT,
    clamp, norm, fold, lev,
    allItems, createState, label, overall,
    bucket, scaffoldFor, gapCount, buildPlan, checkGaps,
    sceneOf, sceneDone, pickNext, advanceScene, sceneTurnCap, sceneOverBudget, oweRemaining,
    evaluateLocal,
    creditHeardItem, applyCorrect, applyWrong, mercyDue, applyMercy, reopenOwed, applyDecay,
    BAR, CAN_USE, MERCY
  };
})();
