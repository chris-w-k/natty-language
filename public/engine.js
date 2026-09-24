/* engine.js — the deterministic session engine.

   NJA-3136 specifies this as six steps, and they are the six functions below.
   No model is consulted by any of them: the engine decides what is practised,
   how much of it is in the target language, and what the right answer is. The
   agent is told the outcome and writes dialogue around it. That split is the
   whole reason this file exists, and it is what stops the agent "adding or
   taking away too much of the language" — the failure the epic itself names.

     1  build pattern x item pairs, validated by slot tag      (in content.js)
     2  order them by the list order the content declares      (in content.js)
     3  pick the next pair: lowest mastery, else first in list
     4  pick which half flips to the target language
     5  build the expected answer as a native/target mix
     6  split it into pills, with red herrings

   Mastery is counts, not a score: exposures, timesPrompted, timesUnprompted,
   correct and incorrect, per pattern and per item, exactly as the epic lists
   them. */

window.ENGINE = (function () {

  const S = window.QUEST.session;

  /* ---------- text ---------- */
  const fold = s => s
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u')
    .replace(/ñ/g, 'n').replace(/ç/g, 'c');
  const norm = s => fold(String(s || '').toLowerCase())
    .replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = s => String(s).trim().split(/\s+/).filter(Boolean);
  /* A pill is a word, not a word plus the sentence's punctuation: "entrada?"
     and "agua," are not things a child recognises. The marks are peeled off
     here and put back when the sentence is rendered. */
  const LEAD = /^[¿¡"“(]+/, TAIL = /[.,;:!?"”)]+$/;
  function split(w) {
    const lead = (LEAD.exec(w) || [''])[0];
    const tail = (TAIL.exec(w) || [''])[0];
    return { lead, tail, word: w.slice(lead.length, w.length - tail.length) };
  }

  /* ---------- state ----------
     One record per pattern and one per item, holding the counts the epic
     names. Nothing derived is stored: every number the UI shows is computed
     from these, so a session can be replayed from its answers alone. */
  function blank() {
    return { exposures: 0, timesPrompted: 0, timesUnprompted: 0,
             correct: 0, incorrect: 0, introduced: false, lastTurn: -99 };
  }

  function createState(quest) {
    const patterns = {}, items = {};
    for (const p of quest.pairs) {
      patterns[p.patternId] = patterns[p.patternId] || blank();
      if (p.itemId) items[p.itemId] = items[p.itemId] || blank();
    }
    return {
      patterns, items,
      turn: 0, coins: 0, finished: false,
      attempts: 0,          // tries at the CURRENT pair, for the retry loop
      log: [], events: [],
    };
  }

  const recOf = (state, pair) => ({
    pattern: state.patterns[pair.patternId],
    item: pair.itemId ? state.items[pair.itemId] : null,
  });

  /* ---------- mastery ----------
     "has responded correctly with this word/phrase versus the number of times
     they have got it wrong as a percentage. If this is over a threshold it is
     done." Plus a floor: one right answer out of one is 100%, and mastering a
     word on a single lucky tap is not mastery. The epic's own PPP has
     "exposed to each word once" as a separate gate, so the floor is that gate
     made into a number. */
  function ratio(r) {
    const n = r.correct + r.incorrect;
    return n ? r.correct / n : 0;
  }
  function mastered(r) {
    return r.exposures >= S.minExposures && ratio(r) >= S.masteryBar;
  }
  /* The ordering number. Deliberately NOT the ratio alone: an item answered
     right once would sit at 1.00 and never come back until everything else
     had, which starves the exposure floor it still has to clear. */
  function progress(r) {
    if (!r.exposures) return 0;
    return Math.min(ratio(r), r.exposures / S.minExposures);
  }

  /* PPP, as the epic frames it. */
  function phase(r) {
    if (!r.exposures) return 'present';
    return mastered(r) ? 'produce' : 'practice';
  }

  function pairMastered(state, pair) {
    const { pattern, item } = recOf(state, pair);
    return mastered(pattern) && (!item || mastered(item));
  }
  function pairProgress(state, pair) {
    const { pattern, item } = recOf(state, pair);
    return item ? (progress(pattern) + progress(item)) / 2 : progress(pattern);
  }

  /* What the UI shows as a percentage: how much of this scenario's vocabulary
     and constructions the child can now produce. */
  function overall(state, quest) {
    const rs = [...Object.values(state.patterns), ...Object.values(state.items)];
    if (!rs.length) return 0;
    return rs.reduce((s, r) => s + (mastered(r) ? 1 : progress(r) * 0.5), 0) / rs.length;
  }

  /* Done when everything still reachable has been produced. An opener is
     sayable on the first turn and never again, so leaving it in this check
     would mean no session could ever end. */
  function sessionComplete(state, quest) {
    return quest.pairs.every(p => p.opensOnly || pairMastered(state, p));
  }

  /* ---------- 3. pick the next pair ----------
     "Picks next pattern + vocab pair - either lowest mastery OR first in list
     if mastery matches." The list order is the order the content declares, so
     a scenario author controls the opening of the session by ordering their
     patterns. */
  function pickNext(state, quest) {
    if (state.finished) return null;

    const open = quest.pairs.filter((p, i) =>
      !pairMastered(state, p) && (!p.opensOnly || state.turn === 0));
    if (!open.length) return null;

    const order = new Map(quest.pairs.map((p, i) => [p.id, i]));
    const ranked = open.slice().sort((a, b) => {
      const d = pairProgress(state, a) - pairProgress(state, b);
      if (Math.abs(d) > 1e-9) return d;
      return order.get(a.id) - order.get(b.id);
    });

    /* Not the same pair twice running while another is available — the retry
       loop already repeats a pair the child got wrong, and repeating one they
       got RIGHT is just the same turn again. */
    const top = ranked[0];
    if (state.items && ranked.length > 1) {
      const rec = recOf(state, top);
      const justDone = rec.pattern.lastTurn === state.turn - 1 &&
                       (!rec.item || rec.item.lastTurn === state.turn - 1);
      if (justDone) return ranked[1];
    }
    return top;
  }

  /* ---------- 4. which half flips to the target language ----------
     The sentence starts wholly in the language the child already has, and one
     half at a time crosses over: first the word, then the construction, or the
     other way round if the construction is the weaker of the two.

     Two rules from the epic hold it together. "New patterns/words are
     introduced one at a time, i.e. we don't introduce both a pattern and a
     word as part of the same exchange." And once introduced, a thing stays in
     the target language for the rest of the session — so the crossing is a
     ratchet, never a flicker. */
  function planTurn(state, pair) {
    const { pattern, item } = recOf(state, pair);

    let introducing = null;                       // the ONE new thing this turn
    if (!pattern.introduced && (!item || !item.introduced)) {
      /* Nothing crossed yet. "pick lowest mastery, else prefer vocab" — a word
         is the gentler thing to meet first, and it is what the character can
         hand over naturally in conversation. */
      if (!item) introducing = 'pattern';
      else introducing = progress(pattern) < progress(item) ? 'pattern' : 'item';
    } else if (item && !item.introduced) {
      introducing = 'item';
    } else if (!pattern.introduced) {
      introducing = 'pattern';
    }

    const frameTarget = pattern.introduced || introducing === 'pattern';
    const itemTarget  = !item ? false : (item.introduced || introducing === 'item');

    return {
      pair, introducing,
      // who says it first: vocab comes from the character, patterns from the coach
      introducedBy: introducing === 'item' ? 'actor' : introducing === 'pattern' ? 'coach' : null,
      frameTarget, itemTarget,
      expected: expected(pair, frameTarget, itemTarget),
      ...gaps(pair, frameTarget, itemTarget),
    };
  }

  /* ---------- 5. the expected answer ----------
     "Evaluate expected answer (with native + target mix) - e.g. Quiero un
     coffee". One string, built here, never by the model. */
  function expected(pair, frameTarget, itemTarget) {
    if (!pair.hasSlot) return frameTarget ? pair.allTarget : pair.allNative;
    if (frameTarget && itemTarget) return pair.allTarget;
    if (frameTarget) return pair.frameTarget;
    if (itemTarget) return pair.itemTarget;
    return pair.allNative;
  }

  /* Which words of that sentence the child has to supply. Anything already in
     the target language is theirs to produce; anything still in their own
     language is scene-setting and stays on the page. On the turn everything
     has crossed, they build the whole sentence. */
  function gaps(pair, frameTarget, itemTarget) {
    const sentence = words(expected(pair, frameTarget, itemTarget)).map(split);
    const mark = cells => ({ answer: cells.filter(c => c.gap).map(c => c.w), cells });

    if (!pair.hasSlot) {
      return mark(sentence.map(s => ({ w: s.word, lead: s.lead, tail: s.tail, gap: frameTarget })));
    }
    const itemWords = words(itemTarget ? pair.item.target : pair.item.native).map(x => split(x).word);
    const at = indexOfRun(sentence.map(s => s.word), itemWords);
    return mark(sentence.map((s, i) => {
      const inItem = at >= 0 && i >= at && i < at + itemWords.length;
      return { w: s.word, lead: s.lead, tail: s.tail, gap: inItem ? itemTarget : frameTarget };
    }));
  }

  function indexOfRun(hay, needle) {
    for (let i = 0; i + needle.length <= hay.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++)
        if (norm(hay[i + j]) !== norm(needle[j])) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  /* ---------- 6. answer pills ----------
     "split expected answer by word, introduce red herrings i.e. words that
     don't work in a valid combination". The red herrings are drawn from items
     whose tags make them INVALID for this slot first — a band is a wrong
     answer to "Can I have ___" in a way a beer is not — and rendered in the
     same form and language as the real answer, so the choice is about meaning
     rather than about spotting the odd shape out. */
  function pills(quest, state, plan, count = 3) {
    const plan_ = plan;
    const answer = plan_.answer.slice();
    if (!answer.length) return [];

    const taken = new Set(answer.map(norm));
    /* Decoys in the same language as the answer. A phrase said whole — no slot
       — is answered in whichever language the frame is in, so its wrong
       answers have to be too: offering "ticket" and "water" against "Perdona"
       is not a choice, it is a spot-the-odd-one-out. */
    const lang = plan_.pair.hasSlot
      ? (plan_.itemTarget ? quest.targetLang : quest.nativeLang)
      : (plan_.frameTarget ? quest.targetLang : quest.nativeLang);
    const form = plan_.pair.form || 'indefinite';
    const slotTag = tagOfPattern(quest, plan_.pair.patternId);

    /* And a whole phrase competes with other whole phrases. */
    if (!plan_.pair.hasSlot) {
      const solos = [];
      for (const p of quest.pairs) {
        if (p.hasSlot || p.id === plan_.pair.id) continue;
        for (const raw of words(plan_.frameTarget ? p.allTarget : p.allNative)) {
          const w = split(raw).word;
          if (w && !taken.has(norm(w)) && !solos.some(x => norm(x) === norm(w))) solos.push(w);
        }
      }
      return shuffle([...answer, ...solos.slice(0, count)], state);
    }

    const invalid = [], valid = [], frames = [];
    for (const [iid, item] of Object.entries(quest.vocabItems)) {
      if (iid === plan_.pair.itemId) continue;
      /* Word by word, like the answer: "un refresco" offers "un" and
         "refresco". The article half is not padding — "un" against "una" is
         the gender distinction, which is exactly the kind of wrong answer
         worth being able to make. */
      const bucket = slotTag && !(item.tags || []).includes(slotTag) ? invalid : valid;
      for (const raw of words(item[lang][form])) {
        const w = split(raw).word;
        if (!w || taken.has(norm(w)) || bucket.some(x => norm(x) === norm(w))) continue;
        bucket.push(w);
      }
    }
    for (const p of quest.pairs) {
      if (p.patternId === plan_.pair.patternId || !p.hasSlot) continue;
      for (const raw of words(plan_.frameTarget ? p.frame.target : p.frame.native)) {
        const w = split(raw).word;
        if (!w || w === '___' || taken.has(norm(w))) continue;
        if (!frames.includes(w)) frames.push(w);
      }
    }

    const pool = [...invalid, ...valid, ...(answer.length > 1 ? frames : [])];
    const decoys = [];
    for (const w of pool) {
      if (decoys.length >= count) break;
      if (!decoys.some(d => norm(d) === norm(w))) decoys.push(w);
    }

    return shuffle([...answer, ...decoys], state);
  }

  /* "pills are displayed in a randomised order" — but the same order every
     time the same turn is drawn, so a re-render while the child is choosing
     does not move the pill under their thumb. */
  function shuffle(all, state) {
    return all
      .map((w, i) => ({ w, k: (i * 7 + state.turn * 13 + w.length * 3) % (all.length || 1) }))
      .sort((a, b) => a.k - b.k).map(x => x.w);
  }

  function tagOfPattern(quest, patternId) {
    const m = /\{([a-z_]+)(?:#\d+)?:/i.exec(quest.vocabPatterns[patternId][quest.nativeLang] || '');
    return m ? m[1] : null;
  }

  /* ---------- checking ---------- */
  /* ---------- per-pill validation (NJA-3162) ----------
     "A pill is counted as correct if its position in the input list matches
     the position in the expectedAnswerPills list", and incorrect if it is not
     in that list or not in the right place. Both of those reduce to the same
     test — is the right value in this slot — which is why there is one
     comparison here and not two.

     Comparison is by VALUE, normalised, never by identity: the ticket's fourth
     case is a sentence with "dog" in it twice, and which of the two the child
     tapped is not a thing anyone should be able to get wrong.

     `placed` is slot-indexed and sparse. A hole is an unfilled slot, which is
     neither right nor wrong yet — it is not an answer. */
  function validate(placed, plan) {
    const want = plan.answer || [];
    const marks = want.map((w, i) =>
      placed[i] === undefined ? null : (norm(placed[i]) === norm(w)));
    const filled = marks.filter(m => m !== null).length;
    return {
      marks,
      filled,
      complete: filled === want.length,
      correct: want.length > 0 && marks.every(m => m === true),
      wrongAt: marks.map((m, i) => (m === false ? i : -1)).filter(i => i >= 0),
    };
  }

  function check(placed, plan) {
    const a = placed.map(norm).join(' ').trim();
    const b = plan.answer.map(norm).join(' ').trim();
    if (a === b) return { correct: true, why: 'none' };
    if (a.split(' ').sort().join(' ') === b.split(' ').sort().join(' '))
      return { correct: false, why: 'word_order' };
    return { correct: false, why: 'wrong_word' };
  }

  /* ---------- applying outcomes ----------
     Exposure is counted once per turn, on the first attempt, so retrying does
     not inflate it. timesPrompted is a correct answer given with the pills in
     front of them; timesUnprompted is one given without a hint being taken. */
  function seen(state, plan) {
    const { pattern, item } = recOf(state, plan.pair);
    if (state.attempts === 0) {
      pattern.exposures += 1;
      if (item) item.exposures += 1;
      if (plan.introducing === 'pattern') pattern.introduced = true;
      if (plan.introducing === 'item' && item) item.introduced = true;
      track(state, 'exchange_start', { pair: plan.pair.id, introducing: plan.introducing });
    }
  }

  function applyCorrect(state, plan, { hinted }) {
    const { pattern, item } = recOf(state, plan.pair);
    for (const r of [pattern, item]) {
      if (!r) continue;
      r.correct += 1;
      r.lastTurn = state.turn;
      if (hinted) r.timesPrompted += 1; else r.timesUnprompted += 1;
    }
    state.coins += hinted ? 5 : 10;
    state.turn += 1;
    state.attempts = 0;
    track(state, 'answer', { pair: plan.pair.id, correct: true, hinted });
    return { pattern: phase(pattern), item: item ? phase(item) : null };
  }

  /* A TURN is right or wrong, once. Counting every retry would mean a single
     fumbled turn buries the item: with a 0.8 bar and a retry loop that keeps
     asking until they get it, three wrong taps and a right one reads as 25%
     and needs a dozen clean turns to climb out. The epic counts "incorrect
     reproductions", and a reproduction is a turn. */
  function applyWrong(state, plan) {
    const { pattern, item } = recOf(state, plan.pair);
    if (state.attempts === 0) for (const r of [pattern, item]) { if (r) r.incorrect += 1; }
    state.attempts += 1;
    track(state, 'answer', { pair: plan.pair.id, correct: false, attempt: state.attempts });
    return { attempts: state.attempts };
  }

  /* "UI goes red, pal repeats phrase and user tries again until they get it
     right." Taken literally that has no exit, so after this many tries the
     coach says it for them and the turn moves on — the item is not credited,
     so it comes back. */
  const mercyDue = state => state.attempts >= S.mercyAfterFailedTurns;
  function applyMercy(state, plan) {
    const { pattern, item } = recOf(state, plan.pair);
    for (const r of [pattern, item]) { if (r) r.lastTurn = state.turn; }
    state.turn += 1;
    state.attempts = 0;
    track(state, 'mercy', { pair: plan.pair.id });
  }

  /* ---------- analytics ----------
     NJA-3136 feature 10: start/end, success/failure, translation clicks. Kept
     in state so a session can be read back whole. */
  function track(state, name, data) {
    state.events.push({ t: Date.now(), turn: state.turn, name, ...data });
    if (typeof window !== 'undefined' && window.__NLT_TRACK) window.__NLT_TRACK(name, data);
  }

  return {
    createState, pickNext, planTurn, pills, check, validate,
    seen, applyCorrect, applyWrong, mercyDue, applyMercy, track,
    overall, sessionComplete, mastered, progress, phase, ratio, recOf,
    expected, gaps, tagOfPattern, norm, words,
  };
})();
