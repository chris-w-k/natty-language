/* engine.js — the deterministic learner model.
   Pure functions over a cloned state. No DOM, no network, no randomness that
   isn't seeded by the turn number. The evaluator may be a model call; the
   SCORE is always computed here. That invariant is the whole point. */

window.ENGINE = (function () {

  /* ---------- constants ----------
     Tuned so THREE clean productions master an item, which is what makes the
     support ladder visible: one word, then most of the phrase, then all of it.
     Two productions was faster but skipped straight from L0 to L2. */
  /* Mastery modelling v2 §3 keeps two ledgers, and they move at very different
     speeds: the PATTERN (the phrase as a construction) creeps up, while the
     WORDS in it rise fast once produced. That gap is the whole ramp — flat
     per-phrase gains are what made turn three jump to a whole Spanish sentence.

     The source's base pattern gain is +0.10, tuned for a trainer that spaces
     retrieval over many sessions. This is one 24-turn sitting, so at +0.10 no
     phrase would ever reach the bar. Patterns are scaled up to fit the budget;
     the word gain, the passive-exposure gain and the hint damping are the
     source's own numbers, and so is the gap between the two rates, which is
     what actually shapes the ladder. */
  const GAIN = {
    pattern: { voice: 0.25, chips: 0.20 },   // §3: produced the construction
    word:    0.25,                            // §3: +0.25 per produced target word
    heard:   0.05                             // §3: passive exposure, words only
  };
  /* §4 hint damping. Hints reveal the construction more than the words, so
     patterns are damped harder than vocabulary. */
  const HINT_DAMP = { pattern: [1, 0.6, 0.3], word: [1, 0.75, 0.5] };
  const damp = (kind, hints) => HINT_DAMP[kind][Math.min(hints, 2)];

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
    const items = {}, patterns = {};
    for (const it of allItems(quest)) {
      items[it.id] = { id: it.id, sceneId: it.sceneId, patternId: it.patternId,
                       exposures: 0, fails: 0, owed: false, lastTurn: -99,
                       /* the widest cloze this phrase has actually been SHOWN at.
                          The scaffold says what it would be shown at next; this
                          says what the child has really seen, and only that can
                          say whether the ladder has been climbed. */
                       topGaps: 0 };
      const pid = it.patternId || it.id;
      if (!patterns[pid]) patterns[pid] = { id: pid, mastery: 0, exposures: 0 };
    }
    return {
      /* The construction's score, ONE per pattern however many words it is met
         with. "Can I have a ticket" and "Can I have a soda" are the same
         pattern twice: the frame carries over, the word does not. Per-instance
         facts (fails, owed, when it was last seen) stay on the item. */
      patterns,
      // §1: two independent ledgers. A word absent from this map is UNSEEN,
      // which is not the same as mastery 0 and is why it is created lazily.
      words: {},
      turn: 0,
      sceneIndex: 0,
      sceneStartTurn: 0,
      reopened: [],
      carrier: {},        // word -> the construction that last carried it (§8)
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

  /* §2: "Level mastery % shown in the UI = mean pattern mastery and mean word
     mastery, weighted 50/50." Words the learner has not met yet count as 0,
     so the bar reflects the whole curriculum rather than only what was tried. */
  function overall(state, quest) {
    const ids = Object.keys(state.items);
    if (!ids.length) return 0;
    const pids = Object.keys(state.patterns || {});
    const patternMean = pids.length
      ? pids.reduce((s, id) => s + state.patterns[id].mastery, 0) / pids.length : 0;
    // the vocabulary list proper: the words that fill the slots
    const vocab = [...new Set(allItems(quest).map(it => it.slotTarget).filter(Boolean))];
    if (!vocab.length) return patternMean;
    const wordMean = vocab.reduce((s, w) => s + wordMastery(state, w), 0) / vocab.length;
    return clamp((patternMean + wordMean) / 2);
  }

  /* ---------- scaffold ----------
     One number, two visible effects: how much Spanish the coach shows,
     and how many decoy chips are in the tray. */
  function bucket(m) { return m < 0.2 ? 0 : m < 0.4 ? 1 : m < 0.6 ? 2 : m < 0.8 ? 3 : 4; }

  const patternOf = item => (typeof item === 'string' ? item : (item.patternId || item.id));
  function patternMastery(state, item) {
    const st = state.patterns && state.patterns[patternOf(item)];
    return st ? st.mastery : 0;
  }

  /* §2 and §6 aggregate the two ledgers DIFFERENTLY, and conflating them was
     half the problem. The scaffold takes the MINIMUM, so one unseen word keeps
     the support up. Everything else — the bar, "can use", what to practise
     next, the percentage on screen — takes the 50/50 MEAN, so steady progress
     still reads as progress. */
  /* The two halves are the CONSTRUCTION and the WORD IN ITS SLOT — not every
     chip on screen. Averaging the frame words in double-counts the pattern:
     "¿Me das una cerveza, por favor?" shares four of its five chips with a
     phrase already mastered, so an item the child had never once been shown
     read as 88% learned. A phrase with no slot is all frame, so its score is
     the pattern's. */
  function itemScore(state, item) {
    const pattern = patternMastery(state, item);
    if (!item.slotTarget) return pattern;
    return clamp((pattern + wordMastery(state, item.slotTarget)) / 2);
  }

  const wordKey = w => norm(w);
  function wordMastery(state, w) {
    const st = state.words[wordKey(w)];
    return st ? st.mastery : 0;      // unseen reads as 0 — §6
  }
  function wordSeen(state, w) { return !!state.words[wordKey(w)]; }
  function knownWords(state) { return Object.keys(state.words); }

  function creditWord(state, w, gain) {
    const k = wordKey(w);
    if (!k) return null;
    const st = state.words[k] || (state.words[k] = { word: k, mastery: 0, exposures: 0 });
    const before = st.mastery;
    st.mastery = clamp(st.mastery + gain);
    st.exposures += 1;
    return st.mastery === before ? null : { label: w, from: before, to: st.mastery };
  }

  /* §6: "A turn takes the MINIMUM mastery across its target pattern and target
     words (an unseen word counts as 0), so one weak item keeps the support up."
     This is the rule that was missing. Without it a phrase's own average could
     carry the turn to L3 while it still contained words the child had never
     met — exactly the turn-three screenshot. */
  function scaffoldFor(state, item) {
    const pattern = patternMastery(state, item);
    const slot = (item && item.slotTarget) ? wordMastery(state, item.slotTarget) : pattern;
    return bucket(Math.min(pattern, slot));
  }

  /* How many wrong options sit alongside the right one. At L0 the child is
     choosing a single word, so one decoy made it a coin toss; two is a real
     choice without crowding the dock. */
  const DISTRACTORS_AT = [2, 2, 3, 3, 4];

  /* Progressive cloze, the Turkish way: one more word is dropped at each rung
     until the learner is producing the whole phrase. For a four-word phrase:
       L0  "I am going to a ___"     English frame, 1 word
       L1  "Voy a un ___"            Spanish frame, 1 word
       L2  "Voy a ___ ___"           2 words
       L3  "Voy ___ ___ ___"         3 words
       L4  "___ ___ ___ ___"         all of it
     Short phrases collapse rungs rather than repeating them.                  */
  /* One more chunk per rung. The sentence is built from aligned segments now,
     so the count is literal: at L0 one gap, at L1 two, until the whole thing
     is theirs to produce. */
  function gapCount(n, scaffold) {
    return Math.min(n, Math.max(1, scaffold + 1));
  }

  /* Which chips become gaps, and in what order. An item built from a pattern
     says so itself: the slot word goes first, because that is what the turn is
     about, and the frame peels in from the end around it. Dropping "favor?"
     before "una entrada" would be testing the punctuation. Items with no
     gapOrder fall back to the old trailing-first behaviour. */
  function gapIndices(item, gaps) {
    const n = item.chips.length;
    const order = (item.gapOrder && item.gapOrder.length === n)
      ? item.gapOrder
      : Array.from({ length: n }, (_, i) => n - 1 - i);
    return new Set(order.slice(0, gaps));
  }

  /* §6 says the SUPPORT LEVEL comes from the minimum across the pattern and
     its words, and that is right for how MUCH the child produces. It is wrong
     for which language the rest of the sentence is written in. Once the
     construction is known, dropping a brand-new word into it sent the whole
     frame back to English — "Can I have [una camiseta] please?" to a child who
     has been saying "¿Me das ___, por favor?" for ten turns. The frame follows
     the PATTERN's own mastery; the gaps still follow the minimum, so a new
     word is still the only thing they have to produce. */
  const FRAME_TARGET = 0.6;
  function frameFor(state, item) {
    return patternMastery(state, item) >= FRAME_TARGET ? 'target' : 'native';
  }

  function buildPlan(item, scaffold, frame) {
    const segs = item.segments ||
      (item.chips || []).map(c => ({ target: c, native: c, slot: false }));
    const n = segs.length;
    const gaps = Math.min(n, gapCount(n, scaffold));
    const gapAt = gapIndices(item, gaps);

    /* cells are the sentence in order. A gap is theirs to fill in the target
       language; anything else is still shown in their own, which is what makes
       the English drain away one chunk at a time instead of all at once. */
    const inTarget = frame === 'target';
    const cells = segs.map((s, i) => ({
      w: s.target, native: inTarget ? s.target : s.native,
      lead: s.lead || '', gap: gapAt.has(i),
    }));
    const answer = cells.filter(c => c.gap).map(c => c.w);
    const locked = cells.filter(c => !c.gap).map(c => c.w);

    return {
      mode: (gaps >= n || inTarget) ? 'target-frame' : 'native-frame',
      frame: '', cells, locked, answer, gaps,
      tail: item.tail || '',
    };
  }

  /* Called by whoever renders the turn, with the plan it is about to show.
     pickNext reads it back: a phrase that has not yet been shown with every
     chunk missing still has English to lose and keeps the turn. */
  function noteShown(state, item, gaps) {
    const st = state.items[item.id];
    if (st) st.topGaps = Math.max(st.topGaps || 0, gaps);
    return state;
  }

  /* Chips mode is judged on the part the learner supplied; voice mode on the
     whole phrase, because you cannot speak a gap. */
  function checkGaps(placed, plan, item) {
    const a = placed.map(norm).join(' ').trim();
    const b = plan.answer.map(norm).join(' ').trim();
    if (a === b) return { target_produced: true, understandable: true, error_type: 'none', correction: '' };
    /* Some turns are a choice rather than a drill — cash or card, both right.
       Only meaningful once the whole phrase is in play. */
    if (item && item.acceptAny && plan.gaps >= item.chips.length) {
      const alts = item.acceptAny.map(t => String(t).split(/\s+/).map(norm).join(' ').trim());
      if (alts.includes(a)) return { target_produced: true, understandable: true, error_type: 'none', correction: '' };
    }
    if (a.split(' ').slice().sort().join(' ') === b.split(' ').slice().sort().join(' '))
      return { target_produced: false, understandable: true, error_type: 'word_order', correction: plan.answer.join(' ') };
    return { target_produced: false, understandable: false, error_type: 'wrong_word', correction: plan.answer.join(' ') };
  }

  /* ---------- turn picking ----------
     Within the current scene only: the weakest unfinished item, avoiding an
     immediate repeat when there is another one available. */
  function sceneOf(quest, state) { return quest.scenes[state.sceneIndex]; }

  function sceneDone(state, scene, quest) {
    return scene.items.every(it => state.items[it.id].owed || itemScore(state, it) >= BAR(quest));
  }

  function itemById(quest, id) {
    for (const s of quest.scenes) for (const it of s.items) if (it.id === id) return it;
    return null;
  }

  /* §7 — one objective per turn, chosen from the state. The scenario used to
     be three rooms of two or three scripted beats, so "weakest first" was
     enough. It is one room with twenty-nine pattern x word items now, and the
     order they arrive in is the whole curriculum, so this is the doc's phase
     machine.

     Rule zero is not in the doc: a phrase part-way up its own cloze ladder
     keeps the turn. That is the ramp the child actually sees — the English
     draining out of one sentence over consecutive turns — and breaking off
     mid-climb to introduce something new is what made the drill read as a
     shuffle rather than a lesson. Everything below it is §7 order. */
  /* §7 B's floor is "nothing very weak (< 0.35)". That is written for a
     trainer that comes back tomorrow and the day after, where meeting eight
     constructions in one sitting is fine because retrieval is spaced over
     weeks. This is one sitting, and at 0.35 it introduced all eight and left
     only two of them usable — everything met, nothing learned. The floor is
     the "can use" bar instead: a new construction waits until the ones already
     on the table are ones the child can actually use. */
  const INTRODUCED = 0.35;

  function pickNext(state, quest) {
    if (state.finished) return null;
    const scene = sceneOf(quest, state);
    if (!scene) return null;

    const pool = scene.items.slice();
    for (const id of (state.reopened || [])) {
      const it = itemById(quest, id);
      if (it && !pool.some(p => p.id === id)) pool.push(it);
    }
    const open = pool.filter(it => !state.items[it.id].owed && itemScore(state, it) < BAR(quest));
    if (!open.length) return null;

    const seen     = it => state.items[it.id].exposures > 0;
    const rungs    = it => (it.segments && it.segments.length) || (it.chips || []).length;
    const wordOf   = it => it.slotTarget || null;
    const newWord  = it => !!wordOf(it) && !wordSeen(state, wordOf(it));
    const patSeen  = it => !!(state.patterns[patternOf(it)] || {}).exposures;
    const byWeakest = (a, b) => itemScore(state, a) - itemScore(state, b);

    let field, why;

    /* 0 — still climbing. Measured on what has been SHOWN, not on the
       scaffold: the scaffold runs a rung ahead of the screen, so reading it
       dropped a phrase out the turn before its last English chunk was ever
       taken away. */
    const climbing = open.filter(it => seen(it) && (state.items[it.id].topGaps || 0) < rungs(it));
    if (climbing.length) {
      field = climbing.slice().sort(byWeakest);
      why = 'climbing';
    } else {
      const fresh   = open.filter(it => !patSeen(it));
      const veryWeak  = open.filter(it => seen(it) && itemScore(state, it) < INTRODUCED);
      /* Measured on the CONSTRUCTIONS, not on every pattern x word item. A new
         word dropped into a known frame starts at zero and is "weak" by
         definition, so gating on items shut the door on new constructions the
         moment any vocabulary was added. What should hold a new construction
         back is a half-learned construction. */
      const halfTaught = Object.values(state.patterns)
        .filter(p => p.exposures > 0 && p.mastery < FRAME_TARGET);
      const unmet   = open.filter(newWord);

      if (fresh.length && !halfTaught.length) {
        /* §7 B — introduce: teach exactly one construction. In the word the
           child already knows best, so the turn is one new thing and not two,
           and in the curriculum order the scene declares — "excuse me" before
           "I like this" is a conversation; the reverse is a word list. */
        const curriculum = (scene.opens || []).indexOf.bind(scene.opens || []);
        const idx = it => { const i = curriculum(patternOf(it)); return i < 0 ? 99 : i; };
        field = fresh.slice().sort((a, b) =>
          (idx(a) - idx(b)) ||
          (wordMastery(state, wordOf(b) || '') - wordMastery(state, wordOf(a) || '')));
        why = 'introduce pattern';
      } else if (veryWeak.length) {
        field = veryWeak.slice().sort(byWeakest);
        why = 'shaky';
      } else if (unmet.length) {
        /* §7 B2 — vocabulary expansion: a new word inside the STRONGEST known
           pattern, so the only unfamiliar thing on screen is the word. */
        /* Strongest frame first, but §8's rotation applies here too: once more
           than one construction is solid, consecutive new words alternate
           between them instead of pouring six nouns through one frame. */
        const lastPat = state.lastPattern;
        field = unmet.slice().sort((a, b) => {
          const ra = patternOf(a) === lastPat ? 1 : 0, rb = patternOf(b) === lastPat ? 1 : 0;
          return (ra - rb) || (patternMastery(state, b) - patternMastery(state, a));
        });
        why = 'new word';
      } else {
        /* §7 B3 — consolidation, with §8 carrier rotation: the same shaky word
           comes back in a different construction rather than the same one. */
        const last = state.carrier || {};
        field = open.slice().sort((a, b) => {
          const d = byWeakest(a, b);
          if (Math.abs(d) > 1e-6) return d;
          const ra = last[wordOf(a)] === patternOf(a) ? 1 : 0;
          const rb = last[wordOf(b)] === patternOf(b) ? 1 : 0;
          return ra - rb;
        });
        why = 'consolidate';
      }
    }

    /* Repeating an item is right while it is CLIMBING — that is the ladder.
       Once it has been shown whole, repeating it is just the same turn again:
       weakest-first happily asked for "Gracias." four times running.

       The phase's own field comes first and the rest of the open pool behind
       it, so declining a repeat drops to the next thing this phase wanted
       rather than to whatever is weakest in the whole room. */
    const rest = open.filter(it => !field.some(f => f.id === it.id)).sort(byWeakest);
    const order = [...field, ...rest];
    const blocked = why === 'climbing' ? null :
      order.find(it => state.items[it.id].lastTurn === state.turn - 1);
    const item = order.find(it => !blocked || it.id !== blocked.id) || order[0];
    // say what actually happened, not what the phase wanted, so the debug
    // strip can be trusted when a turn is read back
    const fromField = field.some(f => f.id === item.id);
    return { scene, item, why: fromField ? why : why + ' \u2192 rotate' };
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
  /* A flat quarter of the budget per scene let the one-phrase opening scene
     burn six turns while a two-phrase scene got the same allowance. The clock
     is shared out by how many phrases a scene actually holds. */
  function sceneTurnCap(quest, scene) {
    const total = allItems(quest).length || 1;
    const here = (scene && scene.items ? scene.items.length : total / quest.scenes.length);
    return Math.ceil(quest.session.turnBudget * here / total) + 1;
  }

  function sceneOverBudget(state, quest) {
    return (state.turn - state.sceneStartTurn) >= sceneTurnCap(quest, sceneOf(quest, state));
  }

  function oweRemaining(state, scene, quest) {
    const owed = [];
    for (const it of scene.items) {
      const st = state.items[it.id];
      if (!st.owed && itemScore(state, it) < BAR(quest)) { st.owed = true; st.fails = 0; owed.push(it); }
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
  /* §3: hearing the tutor say it is "reading credited far below production"
     — words only, +0.05, and the pattern gets nothing. Seeing a word never
     proves the learner can use it, so this must not move the construction. */
  function creditHeardItem(state, item) {
    const st = state.items[item.id];
    if (!st) return null;
    st.exposures += 1;
    let from = 0, to = 0, moved = 0;
    for (const w of (item.chips || [])) {
      const d = creditWord(state, w, GAIN.heard);
      if (d) { from += d.from; to += d.to; moved += 1; }
    }
    if (!moved) return null;
    return { label: item.target, from: from / moved, to: to / moved, why: 'heard' };
  }

  /* §3: "mastery is earned only for what the learner actually produced".
     Both ledgers move, at their own rates and with their own hint damping, so
     the words they just said race ahead while the construction inches up. */
  function applyCorrect(state, item, { mode, hinted, hints }) {
    const st = state.items[item.id];
    const pat = state.patterns[patternOf(item)];
    const used = typeof hints === 'number' ? hints : (hinted ? 1 : 0);
    const before = pat.mastery;

    const base = mode === 'voice' ? GAIN.pattern.voice : GAIN.pattern.chips;
    pat.mastery = clamp(pat.mastery + base * damp('pattern', used));
    pat.exposures += 1;
    st.exposures += 1;
    st.fails = 0;
    st.lastTurn = state.turn;

    for (const w of (item.chips || [])) {
      const d = creditWord(state, w, GAIN.word * damp('word', used));
      if (d) state.log.push({ turn: state.turn, word: d.label, from: d.from, to: d.to, why: 'produced' });
    }
    // §8 carrier rotation: next time this word is drilled, prefer another frame
    if (item.slotTarget) (state.carrier || (state.carrier = {}))[item.slotTarget] = patternOf(item);
    state.lastPattern = patternOf(item);

    state.turn += 1;
    state.coins += used ? 5 : 10;
    const delta = { label: item.target, from: before, to: pat.mastery, why: used ? 'correct (helped)' : `correct (${mode})` };
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
    const m = patternMastery(state, item);
    return { label: item.target, from: m, to: m, why: 'wrong — no penalty' };
  }

  function mercyDue(state, item, quest) {
    return state.items[item.id].fails >= MERCY(quest);
  }

  function applyMercy(state, item) {
    const st = state.items[item.id];
    st.owed = true;
    st.fails = 0;
    const m = patternMastery(state, item);
    return { label: item.target, from: m, to: m, why: 'Axel covered for you — comes back later' };
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
    for (const id of Object.keys(state.patterns)) {
      state.patterns[id].mastery = clamp(state.patterns[id].mastery - DECAY_PER_WEEK * weeks);
    }
    return state;
  }

  return {
    GAIN, DECAY_PER_WEEK, DISTRACTORS_AT,
    clamp, norm, fold, lev,
    allItems, createState, label, overall,
    bucket, scaffoldFor, frameFor, gapCount, buildPlan, noteShown, checkGaps,
    itemScore, patternMastery, patternOf, wordMastery, wordSeen, knownWords, creditWord, HINT_DAMP,
    sceneOf, sceneDone, pickNext, advanceScene, sceneTurnCap, sceneOverBudget, oweRemaining,
    evaluateLocal,
    creditHeardItem, applyCorrect, applyWrong, mercyDue, applyMercy, reopenOwed, applyDecay,
    BAR, CAN_USE, MERCY
  };
})();
