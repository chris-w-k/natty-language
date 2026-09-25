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
  /* NJA-3151 fixes the tokenisation: a pill is a whitespace-delimited token,
     punctuation included. "coffee?", "Hello,", "¿Quieres" and "C'est" are each
     one pill. We used to peel the marks off and print them separately, which
     read better on screen but is not the contract the FE consumes, so the
     ticket wins.

     `split` survives for one job only: building decoys out of OTHER sentences,
     where the source word's own punctuation is not wanted. */
  const LEAD = /^[¿¡"“(]+/, TAIL = /[.,;:!?"”)]+$/;
  function split(w) {
    const lead = (LEAD.exec(w) || [''])[0];
    const tail = (TAIL.exec(w) || [''])[0];
    return { lead, tail, word: w.slice(lead.length, w.length - tail.length) };
  }

  /* ---------- pill objects (NJA-3151) ----------
     { id, label, value }. The LABEL is what the child reads. The VALUE is the
     slug, and two pills with the same value are interchangeable — which is the
     whole point of the ticket's "a dog eat dog world" case: which of the two
     "dog" pills they tapped is not something anyone should be able to get
     wrong. The ID is the value plus an increment, so the UI can key on
     something unique without the two copies fighting over one identity. */
  const slug = s => fold(String(s).toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '');

  function makePills(labels) {
    const seen = new Map();
    return labels.map(label => {
      const value = slug(label);
      const n = (seen.get(value) || 0) + 1;
      seen.set(value, n);
      return { id: n === 1 ? value : value + '-' + n, label, value };
    });
  }

  /* ---------- state ----------
     One record per pattern and one per item, holding the counts the epic
     names. Nothing derived is stored: every number the UI shows is computed
     from these, so a session can be replayed from its answers alone. */
  function blank() {
    return { exposures: 0, timesPrompted: 0, timesUnprompted: 0,
             correct: 0, incorrect: 0, introduced: false, lastTurn: -99 };
  }

  /* ---------- the syllabus ----------
     One stage per pattern, in the order the content declares, each carrying
     the FIRST vocabulary item that is valid for it. A stage is taught in two
     steps:

       step 0   the word on its own — the frame stays in the child's language
                and the item is the gap. "Do you have ___" / una entrada.
       step 1   the whole thing — frame and item both crossed over.

     Both right and the stage is done; the next pattern begins. When the last
     stage is done, so is the night.

     This replaces picking by lowest mastery. That rule kept every one of the
     55 pairs in play at once, so a child met nine constructions and nine nouns
     interleaved and finished none of them. A syllabus is a line, not a pool. */
  function syllabus(quest) {
    const byPattern = new Map();
    for (const p of quest.pairs) {
      if (!byPattern.has(p.patternId)) byPattern.set(p.patternId, []);
      byPattern.get(p.patternId).push(p);
    }

    /* Which item each pattern takes. "First matching" read literally gives
       every stage the same noun — `ticket` is valid for all of them — and a
       night of nine constructions all about a ticket teaches one word and
       makes the word-step of every stage after the first a turn with nothing
       new in it. So by default the list is WALKED: each stage takes the first
       valid item nobody has had yet, and falls back to the first valid one
       when the nouns run out. Set session.stageItems to 'first' in content for
       the literal reading. */
    const walk = (quest.session && quest.session.stageItems) !== 'first';
    const used = new Set(), out = [];
    for (const [, list] of byPattern) {
      let pick = list[0];
      if (walk) pick = list.find(p => p.itemId && !used.has(p.itemId)) || list[0];
      if (pick.itemId) used.add(pick.itemId);
      out.push(pick);
    }
    return out;
  }

  /* A no-slot pattern ("Perdona.") has no word to teach first, so it is one
     step rather than two. */
  const stepsIn = pair => (pair && pair.hasSlot ? 2 : 1);

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
      stage: 0,             // which pattern of the syllabus we are on
      step: 0,              // 0 = the word, 1 = the whole construction
      earned: 0,            // quality banked so far, one point per step at best
      /* kept so applying an outcome can move the syllabus on without every
         caller having to remember to pass the quest back in */
      quest,
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
  /* Mastery is measured against what this go actually teaches, not against
     every pair the content could generate. Scored over all 55 it could never
     pass about a sixth however well the child did, which is a number that
     tells them nothing. */
  function overall(state, quest) {
    const stages = syllabus(quest);
    if (!stages.length) return 0;
    const total = stages.reduce((n, p) => n + stepsIn(p), 0);
    return total ? Math.min(1, state.earned / total) : 0;
  }

  /* What a finished step is worth. Distance through the syllabus is not
     mastery: measured that way a child who was shown every single line after
     four failed goes still finished on 100%, because they had reached the end.
     Getting there is not the same as having learnt it. */
  const STEP_SCORE = { clean: 1, hinted: 0.6, mercy: 0 };

  /* Done when the syllabus runs out. */
  function sessionComplete(state, quest) {
    return state.stage >= syllabus(quest).length;
  }

  /* ---------- 3. pick the next pair ----------
     Whichever stage of the syllabus we are on. There is no ranking any more:
     the order is the order the content declares, and nothing jumps it. */
  function pickNext(state, quest) {
    if (state.finished) return null;
    const stages = syllabus(quest);
    return stages[state.stage] || null;
  }

  /* Both steps of this stage are behind us. */
  function stageDone(state, quest) {
    const stages = syllabus(quest);
    return state.stage >= stages.length;
  }

  /* Move on: the next step, or the next pattern when the stage is finished.
     Called for a right answer and for a mercy escape alike — a syllabus that
     only advances on success has no exit for a child who cannot get one word
     out, which is the failure the retry loop already had. */
  function advance(state, quest) {
    const pair = pickNext(state, quest);
    if (!pair) return;
    state.step += 1;
    if (state.step >= stepsIn(pair)) { state.step = 0; state.stage += 1; }
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

    /* The step decides it now, not the mastery reading. Step 0 puts the word
       in the target language inside a frame the child already understands;
       step 1 crosses the frame over too. A pattern with no slot has only the
       second kind of turn. */
    const twoStep = stepsIn(pair) === 2;
    const frameTarget = twoStep ? state.step === 1 : true;
    const itemTarget  = item ? true : false;

    /* And one new thing per exchange, which falls out of the same two steps:
       the word arrives with the word turn, the construction with the
       construction turn. The character hands over vocabulary, the coach hands
       over constructions (NJA-3136). */
    let introducing = null;
    if (item && !item.introduced && (!twoStep || state.step === 0)) introducing = 'item';
    else if (!pattern.introduced && frameTarget) introducing = 'pattern';

    return {
      pair, introducing, stage: state.stage, step: state.step,
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
    const sentence = words(expected(pair, frameTarget, itemTarget));
    const mark = cells => {
      const answer = cells.filter(c => c.gap).map(c => c.w);
      return { answer, cells, expectedAnswerPills: makePills(answer) };
    };

    if (!pair.hasSlot) {
      return mark(sentence.map(w => ({ w, gap: frameTarget })));
    }
    /* The item's words are matched on their bare form, because the sentence
       may have punctuation hanging off the last of them ("una entrada?") while
       the item itself does not. */
    const itemWords = words(itemTarget ? pair.item.target : pair.item.native).map(x => split(x).word);
    const at = indexOfRun(sentence.map(x => split(x).word), itemWords);
    return mark(sentence.map((w, i) => {
      const inItem = at >= 0 && i >= at && i < at + itemWords.length;
      return { w, gap: inItem ? itemTarget : frameTarget };
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

    /* The answer's punctuation, slot by slot. A decoy has to wear the same
       marks as the pill it competes with, or the question mark on "entrada?"
       is a tell — the child picks the one with the punctuation without reading
       any of them. NJA-3151 defers decoys to a later ticket, so this shape is
       ours; the tokenisation it borrows is the ticket's. */
    const dress = i => {
      const a = answer[Math.min(i, answer.length - 1)] || '';
      const { lead, tail } = split(a);
      return w => lead + w + tail;
    };
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
      const dressed = solos.slice(0, count).map((w, i) => dress(i + answer.length)(w));
      return makePills(shuffle([...answer, ...dressed], state));
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

    const dressed = decoys.map((w, i) => dress(i + answer.length)(w));
    return makePills(shuffle([...answer, ...dressed], state));
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
    const want = plan.expectedAnswerPills || makePills(plan.answer || []);
    /* By value, never by id: the ticket's own example is a sentence with "dog"
       in it twice, and "dog-2" in the first dog's slot is right. */
    const val = p => (p && typeof p === 'object') ? p.value : slug(p);
    const marks = want.map((w, i) =>
      placed[i] === undefined || placed[i] === null ? null : (val(placed[i]) === w.value));
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
    state.earned += hinted ? STEP_SCORE.hinted : STEP_SCORE.clean;
    state.turn += 1;
    state.attempts = 0;
    if (state.quest) advance(state, state.quest);
    track(state, 'answer', { pair: plan.pair.id, correct: true, hinted,
                             stage: state.stage, step: state.step });
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
  /* Mercy moves the syllabus on as well. A line the child cannot produce after
     four goes must not be the end of the night — they are shown it, it is not
     credited, and the go continues. */
  function applyMercy(state, plan) {
    const { pattern, item } = recOf(state, plan.pair);
    for (const r of [pattern, item]) { if (r) r.lastTurn = state.turn; }
    state.turn += 1;
    state.attempts = 0;
    state.earned += STEP_SCORE.mercy;
    if (state.quest) advance(state, state.quest);
    track(state, 'mercy', { pair: plan.pair.id, stage: state.stage, step: state.step });
  }

  /* ---------- analytics ----------
     NJA-3136 feature 10: start/end, success/failure, translation clicks. Kept
     in state so a session can be read back whole. */
  function track(state, name, data) {
    state.events.push({ t: Date.now(), turn: state.turn, name, ...data });
    if (typeof window !== 'undefined' && window.__NLT_TRACK) window.__NLT_TRACK(name, data);
  }

  return {
    createState, pickNext, planTurn, pills, check, validate, makePills, slug,
    syllabus, stepsIn, advance, stageDone,
    seen, applyCorrect, applyWrong, mercyDue, applyMercy, track,
    overall, sessionComplete, mastered, progress, phase, ratio, recOf,
    expected, gaps, tagOfPattern, norm, words,
  };
})();
