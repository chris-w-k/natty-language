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
  /* ---------- NJA-3317 v2: a stage is a question-answer group ----------
     A stage used to be one construction and its rungs were "how much of this
     sentence is in the target language". Both still exist, but they are no
     longer the whole ladder: the CHARACTER'S question crosses too, and it
     crosses last.

     So a group of three words is five exchanges — one per word, then the
     child's sentence, then her question — and a step is "which one thing is
     new". A group with no words (the book-ends) is one exchange.

     The last exchange of a group is the only one that asks nothing new of the
     child: they answer with a sentence they can already build. What is new is
     that they understood the question, which is the thing the ticket wanted
     exposing and the thing this engine had no way to express before. */
  function qaStages(quest) {
    const out = [];
    let index = 0;
    for (const g of quest.qa || []) {
      const grp = (quest.groups || []).find(x => x.id === g.answerId);
      if (!grp) continue;
      const slotKey = (grp.slotKeys || [])[0] || null;
      const pairOf = id => quest.pairFor(g.answerId, slotKey && id ? { [slotKey]: id } : {});

      const steps = [];
      /* One exchange per word. Her question is in the child's language with
         the word in the target one; so is their answer. */
      for (const id of g.vocab) steps.push({ fill: id, frameTarget: false, askTarget: false, want: 'item' });
      if (g.vocab.length) {
        /* Their sentence crosses, on the first word they met. */
        steps.push({ fill: g.vocab[0], frameTarget: true, askTarget: false, want: 'pattern' });
        /* Her question crosses, on a different word — so the exchange is not
           the previous one with a new coat of paint. */
        steps.push({ fill: g.vocab[1] || g.vocab[0], frameTarget: true, askTarget: true, want: 'question' });
      } else {
        steps.push({ fill: null, frameTarget: true, askTarget: true, want: 'pattern' });
      }
      for (const st of steps) { st.pair = pairOf(st.fill); st.slotKey = slotKey; }
      /* Where each exchange sits in the night, 0..16, fixed at build time.
         `state.at` cannot answer this: it is the engine's position in the
         CURRENT plan, and the revision round replaces that plan and resets it
         to 0 — so without this every revision exchange would report itself as
         one of the first five questions of the night. */
      for (const st of steps) st.index = index++;

      out.push({
        id: g.id, askId: g.askId, askItem: g.askItem || null, answerId: g.answerId,
        /* NJA-3341's first beat: why this exchange is happening. Carried from
           content so the coach is told it rather than left to infer it from
           the venue prompt, which describes the night and not the turn. */
        goal: g.goal || null,
        /* The learner construction her question IS, when it is one of
           theirs under another id. */
        twin: ((quest.vocabPatterns || {})[g.askId] || {}).twin || null,
        vocab: g.vocab.slice(), steps,
        /* What the results screen names this group by: the sentence with all
           of it across, which is where the group was always heading. */
        pair: steps[steps.length - 1].pair,
      });
    }
    return out;
  }

  /* The pre-group ladder, for a venue that declares no groups. Football and
     the cinema still run it, which is what makes the gig's new shape readable
     against something. */
  function syllabus(quest) {
    if ((quest.qa || []).length) return qaStages(quest);
    return legacySyllabus(quest);
  }

  function legacySyllabus(quest) {
    /* Which noun each slot of each stage gets. "First matching" read literally
       gives every stage the same one — `ticket` is valid everywhere — and a
       night of nine constructions all about a ticket teaches one word and
       makes the word-step of every stage after the first a turn with nothing
       new in it. So by default the list is WALKED: each slot takes the first
       valid item nobody has had yet, and falls back to the first valid one
       when the nouns run out. Set session.stageItems to 'first' in content for
       the literal reading. */
    const walk = (quest.session && quest.session.stageItems) !== 'first';
    const used = new Set();
    const out = [];

    for (const g of quest.groups) {
      const fill = {};
      for (const key of g.slotKeys) {
        const valid = g.slots[key];
        let pick = valid[0];
        if (walk) pick = valid.find(id => !used.has(id) && !Object.values(fill).includes(id))
                      || valid.find(id => !Object.values(fill).includes(id))
                      || valid[0];
        fill[key] = pick;
        used.add(pick);
      }
      out.push(quest.pairFor ? quest.pairFor(g.id, fill) : quest.pairs.find(p => p.patternId === g.id));
    }
    return out;
  }

  /* The syllabus is rebuilt on every call and pairs are fresh objects, so a
     plan cannot be compared by identity across calls. Cached per quest, which
     is also what stops pickNext churning through nine pair constructions on
     every render. */
  const syllabusCache = new WeakMap();
  function stages(quest) {
    if (!syllabusCache.has(quest)) syllabusCache.set(quest, syllabus(quest));
    return syllabusCache.get(quest);
  }

  /* How many turns a stage takes. NJA-3166: a pattern with more than one word
     in it hands them over one at a time — "return the next target vocab item
     INSTEAD of translating the current pattern" — and only when every slot has
     crossed does the frame itself cross. So a two-slot pattern is three turns,
     not two, and a pattern with no slot at all ("Perdona.") is one. */
  const stepsIn = stage => stage
    ? (stage.steps ? stage.steps.length : (stage.slotCount || 0) + 1)
    : 1;

  /* Which slots are in the target language at a given step. Step 0 crosses the
     first, step 1 the first two, and the last step crosses the frame with all
     of them already across. */
  function slotsAtStep(pair, step) {
    const keys = pair.slotKeys || [];
    return keys.slice(0, Math.min(step + 1, keys.length));
  }
  const frameAtStep = (pair, step) => step >= (pair.slotKeys || []).length;

  function createState(quest) {
    const patterns = {}, items = {}, asks = {};
    for (const g of quest.groups || []) {
      patterns[g.id] = patterns[g.id] || blank();
      for (const key of g.slotKeys)
        for (const id of g.slots[key]) items[id] = items[id] || blank();
    }
    /* The character's questions get a ledger of their own. They are never
       drilled — nothing can select one as a question to answer — but they are
       introduced exactly once, and without somewhere to record that, a makeup
       loop would hand the child the same translation twice. */
    for (const g of quest.qa || []) if (g.askId) asks[g.askId] = asks[g.askId] || blank();
    const plan = allSteps(quest).map(s => ({ stage: s.stage, step: s.step, key: s.key }));
    return {
      patterns, items, asks,
      turn: 0, coins: 0, finished: false,
      attempts: 0,          // tries at the CURRENT pair, for the retry loop
      stage: plan.length ? plan[0].stage : 0,   // which pattern of the syllabus we are on
      step: plan.length ? plan[0].step : 0,     // 0 = the first word, last = the whole construction
      /* The steps this go will drill, in order, and where we are in them. A
         first go holds every step; a replay holds only what did not stick. */
      plan, at: 0, go: 1,
      /* The BEST each step has been answered, 0..1, keyed stage:step. Mastery
         is the sum of these over every step the syllabus has — so redrilling
         a step can raise the score but never lower it, which is what makes
         NJA-3196's "the minimum they will get is always 85%" reachable. */
      best: {},
      drills: {},           // how many times each step has come round
      /* Steps handed over after three failed tries. They are not drilled again
         this go: a child who has been shown a line and still cannot say it
         needs the night to move, not that same line a fourth time. */
      released: {},
      /* Steps they did not have first time. The revision round is made of
         these, and nothing else. */
      missed: {},
      revised: false,       // the revision round has been offered and taken
      revision: false,      // ...and we are in it now
      makeup: false,        // past the syllabus, drilling to reach the pass mark
      done: false,
      /* kept so applying an outcome can move the syllabus on without every
         caller having to remember to pass the quest back in */
      quest,
      log: [], events: [],
    };
  }

  /* ---------- the steps of a go ----------
     A step is one turn's worth of ladder: (which stage, which rung). Written
     out flat because everything about finishing a go — the score, what to
     redrill, what a replay carries — is per step rather than per pattern. */
  const stepKey = (stage, step) => stage + ':' + step;
  function allSteps(quest) {
    const out = [];
    stages(quest).forEach((st, stage) => {
      for (let step = 0; step < stepsIn(st); step++)
        out.push({
          stage, step, key: stepKey(stage, step),
          /* Each exchange of a group is about a different word, so the pair is
             the step's rather than the stage's. Everything that reads
             `s.pair` — the replay filter, the venue switch, the results — wants
             the one the child actually answered. */
          pair: st.steps ? st.steps[step].pair : st,
        });
    });
    return out;
  }
  const bank = (state, score) => {
    const k = stepKey(state.stage, state.step);
    state.best[k] = Math.max(state.best[k] || 0, score);
  };

  const recOf = (state, pair) => ({
    pattern: state.patterns[pair.patternId],
    item: pair.itemId ? state.items[pair.itemId] : null,
    /* every slot's record, for a pattern that holds more than one word */
    slotItems: (pair.items || []).map(i => state.items[i.id]).filter(Boolean),
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
    const all = allSteps(quest);
    if (!all.length) return 0;
    let sum = 0;
    for (const s of all) sum += state.best[s.key] || 0;
    return Math.min(1, sum / all.length);
  }

  /* NJA-3196 Q2: the go ends on a total mastery over a threshold, not on
     reaching the end of the list. Anything short of it sends the weakest step
     round again, so the score a child leaves with is the pass mark or better
     — unless the turn cap stops them first, which is the backstop for Q1's
     "would take them ages" case and is reported honestly rather than papered
     over. */
  const passMark = quest => {
    const v = quest.session && quest.session.passMark;
    return typeof v === 'number' ? v : 0.85;
  };
  /* What counts as stuck, and so as carried into a replay rather than drilled
     again. A clean answer by default: anything less is worth another go. */
  const keepMark = quest => {
    const v = quest.session && quest.session.keepMark;
    return typeof v === 'number' ? v : 1;
  };
  const passed = (state, quest) => overall(state, quest) >= passMark(quest);

  /* What a finished step is worth. Distance through the syllabus is not
     mastery: measured that way a child who was shown every single line after
     four failed goes still finished on 100%, because they had reached the end.
     Getting there is not the same as having learnt it. */
  const STEP_SCORE = { clean: 1, hinted: 0.6, mercy: 0 };

  /* Done when the pass mark is reached, or when nothing is left that could
     raise it. Not "when the list runs out" — that was distance, not mastery. */
  function sessionComplete(state, quest) {
    return !!state.done || state.stage >= stages(quest).length;
  }

  /* ---------- 3. pick the next pair ----------
     Whichever stage of the syllabus we are on. There is no ranking any more:
     the order is the order the content declares, and nothing jumps it. */
  function pickNext(state, quest) {
    if (state.finished) return null;
    return stages(quest)[state.stage] || null;
  }

  /* Both steps of this stage are behind us. */
  function stageDone(state, quest) {
    return state.stage >= stages(quest).length;
  }

  /* Move on: the next step, or the next pattern when the stage is finished.
     Called for a right answer and for a mercy escape alike — a syllabus that
     only advances on success has no exit for a child who cannot get one word
     out, which is the failure the retry loop already had. */
  function advance(state, quest) {
    state.drills[stepKey(state.stage, state.step)] =
      (state.drills[stepKey(state.stage, state.step)] || 0) + 1;
    if (state.makeup) return retarget(state, quest);
    state.at += 1;
    const next = state.plan[state.at];
    if (next) { state.stage = next.stage; state.step = next.step; return; }
    retarget(state, quest);
  }

  /* The planned steps are behind us. Either the pass mark is in hand and the
     night is over, or the weakest step comes round again. */
  /* How many of them. Brief is the point: this is a last look at the things
     that did not land, not a second night. Five is about forty seconds. */
  const REVISION_MAX = 5;

  function retarget(state, quest) {
    /* ---------- the revision round ----------
       The planned exchanges are behind them. Before the night can end, one
       short round of whatever they got wrong the first time — whether or not
       they cleared the pass mark, which is the difference between this and
       the makeup loop below. A child who scraped through at 86% has still got
       three things they could not do, and the old ending congratulated them
       and showed them the door.

       It runs once. `revised` is set even when there is nothing to revise, so
       a night where everything landed first time ends exactly as it did. */
    if (!state.revised) {
      state.revised = true;
      const again = allSteps(quest)
        .filter(st => state.missed[st.key] && !state.released[st.key])
        .slice(0, REVISION_MAX);
      if (again.length) {
        state.revision = true;
        state.makeup = false;
        state.plan = again.map(st => ({ stage: st.stage, step: st.step, key: st.key }));
        state.at = 0;
        state.stage = again[0].stage;
        state.step = again[0].step;
        track(state, 'revision_start', { steps: again.length });
        return;
      }
    }
    state.revision = false;
    if (passed(state, quest)) { state.makeup = false; state.done = true; return; }
    const w = weakest(state, quest);
    if (!w) { state.makeup = false; state.done = true; return; }
    state.makeup = true;
    state.stage = w.stage;
    state.step = w.step;
  }

  /* The step with the most to gain. Ties go to whichever has come round least
     — otherwise a child who cannot get one line out would meet that same line
     for the rest of the night instead of the several they are weakest at. */
  function weakest(state, quest) {
    const open = allSteps(quest).filter(s =>
      (state.best[s.key] || 0) < 1 && !state.released[s.key]);
    if (!open.length) return null;
    const rank = s => [state.best[s.key] || 0, state.drills[s.key] || 0, s.stage, s.step];
    return open.reduce((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? a : b;
      return a;
    });
  }

  /* ---------- a second go ----------
     "They can replay to try to get a higher mastery" (NJA-3196 Q2). The steps
     that stuck are carried at their score and not drilled again, so a replay
     is the material that did not land — and mastery can only go up. */
  function replay(state, quest) {
    const next = createState(quest);
    const bar = keepMark(quest);
    for (const s of allSteps(quest))
      if ((state.best[s.key] || 0) >= bar) next.best[s.key] = state.best[s.key];
    next.plan = allSteps(quest)
      .filter(s => (next.best[s.key] || 0) < bar)
      .map(s => ({ stage: s.stage, step: s.step, key: s.key }));
    next.go = (state.go || 1) + 1;
    next.coins = state.coins;
    /* A replay earns its own revision round, from its own mistakes. */
    next.revised = false;
    /* Everything already met stays met: a replay must not re-introduce a word
       the child has already been given. */
    for (const k of Object.keys(next.patterns))
      if (state.patterns[k]) next.patterns[k].introduced = state.patterns[k].introduced;
    for (const k of Object.keys(next.items))
      if (state.items[k]) next.items[k].introduced = state.items[k].introduced;
    for (const k of Object.keys(next.asks || {}))
      if (state.asks && state.asks[k]) next.asks[k].introduced = state.asks[k].introduced;
    if (next.plan.length) { next.stage = next.plan[0].stage; next.step = next.plan[0].step; }
    else retarget(next, quest);
    return next;
  }

  /* ---------- a different night out (NJA-3207) ----------
     The venue choice offers the same nine constructions somewhere else, with a
     new set of nouns in them. So what carries over is exactly the steps with
     no noun in them: "Excuse me." and "Thank you." are the same sentence at a
     gig, a match and a cinema, and a child who has them should not be made to
     earn them twice.

     Everything else resets, which is the point. replay() above carries every
     banked step, and every venue shares the same seventeen step keys — so
     reusing it for a venue switch would hand the second night fifteen free
     steps and end it in two turns. The child would have "played the cinema"
     without meeting a single cinema word.

     Patterns stay INTRODUCED and items do not: they know "Can I have ___?"
     and should not have it handed over again, but `popcorn` is a word they
     have never seen and the coach has to give it to them. */
  function switchVenue(state, quest) {
    const next = createState(quest);
    const bar = keepMark(quest);
    for (const s of allSteps(quest)) {
      if (s.pair.hasSlot) continue;
      if ((state.best[s.key] || 0) >= bar) next.best[s.key] = state.best[s.key];
    }
    next.plan = allSteps(quest)
      .filter(s => (next.best[s.key] || 0) < bar)
      .map(s => ({ stage: s.stage, step: s.step, key: s.key }));
    next.go = (state.go || 1) + 1;
    next.coins = state.coins;
    for (const k of Object.keys(next.patterns))
      if (state.patterns[k]) next.patterns[k].introduced = state.patterns[k].introduced;
    /* Her questions carry over for the same reason her constructions do: the
       child has understood "¿Tienes...?" and a second venue must not pretend
       otherwise. The WORDS behind them do not — that is the whole point of a
       second venue. */
    for (const k of Object.keys(next.asks || {}))
      if (state.asks && state.asks[k]) next.asks[k].introduced = state.asks[k].introduced;
    if (next.plan.length) { next.stage = next.plan[0].stage; next.step = next.plan[0].step; }
    else retarget(next, quest);
    return next;
  }

  /* How each pattern of the syllabus came out, for the results screen: the
     mean of its steps' best scores. */
  function report(state, quest) {
    return stages(quest).map((st, stage) => {
      const pair = st.steps ? st.pair : st;
      const mine = allSteps(quest).filter(s => s.stage === stage);
      const score = mine.reduce((n, s) => n + (state.best[s.key] || 0), 0) / (mine.length || 1);
      return {
        stage, pair, score,
        verdict: score >= 1 ? 'stuck' : score > 0 ? 'shaky' : 'missed',
        native: pair.allNative, target: pair.allTarget,
      };
    });
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
  function planTurn(state, stage) {
    if (stage && stage.steps) return planGroupTurn(state, stage);
    return planLegacyTurn(state, stage);
  }

  /* One exchange of a question-answer group. Which thing is new is read off
     the step rather than worked out from mastery, exactly as before — there
     are just three kinds of new thing now instead of two. */
  function planGroupTurn(state, stage) {
    const st = stage.steps[Math.min(state.step, stage.steps.length - 1)];
    const pair = st.pair;
    const { pattern } = recOf(state, pair);
    const targetSlots = st.slotKey ? [st.slotKey] : [];

    let introducing = null, introKey = null, introducedBy = null;
    if (st.want === 'item' && st.fill) {
      introKey = st.slotKey;
      const rec = state.items[st.fill];
      /* Vocabulary is hers, and under this ladder she can always carry it:
         every group's question has a slot, so the word is in her mouth on the
         exchange that introduces it. */
      if (rec && !rec.introduced) { introducing = 'item'; introducedBy = 'actor'; }
    } else if (st.want === 'pattern') {
      if (!pattern.introduced) { introducing = 'pattern'; introducedBy = 'coach'; }
    } else if (st.want === 'question') {
      const ask = state.asks[stage.askId];
      /* Hers to say and the coach's to translate — she cannot tell them what
         her own question means without stepping out of the scene.

         Unless it is a construction they already own. `twin` names the
         learner pattern her question is, and when the child has been taught
         that one already, her saying it is RECOGNITION rather than a new
         thing — which is the whole reason for her saying it. Re-translating
         it would undo the point. */
      const twin = stage.twin;
      const known = twin && state.patterns[twin] && state.patterns[twin].introduced;
      if (ask && !ask.introduced && !known) { introducing = 'question'; introducedBy = 'coach'; }
      if (ask && known) ask.introduced = true;
    }

    return {
      pair, introducing, introKey, introducedBy,
      stage: state.stage, step: state.step,
      group: stage.id,
      /* What she says this exchange, and whether her frame has crossed. */
      askId: stage.askId,
      askItem: st.fill || stage.askItem || null,
      goal: stage.goal || null,
      askTarget: !!st.askTarget,
      revision: !!state.revision,
      /* For the analytics, which cannot otherwise tell the three phases
         apart: the planned night, the revision round, and the makeup loop
         all report positions in whatever plan is current. */
      phase: state.revision ? 'revision' : state.makeup ? 'makeup' : 'night',
      nightIndex: st.index,
      stepKey: stepKey(state.stage, state.step),
      /* The words this group is about, for the tray. A decoy drawn from the
         whole venue put `tarjetas` and `entradas` — door words, in plural
         forms that never appeared — next to a merch answer, which is a wrong
         answer the child had no way of knowing was wrong AND a reminder of a
         part of the night that is over. */
      pool: stage.vocab.length ? stage.vocab.slice() : null,
      frameTarget: st.frameTarget, targetSlots,
      itemTarget: targetSlots.length > 0,
      expected: expected(pair, st.frameTarget, targetSlots),
      ...gaps(pair, st.frameTarget, targetSlots),
    };
  }

  function planLegacyTurn(state, pair) {
    const { pattern } = recOf(state, pair);
    const keys = pair.slotKeys || [];

    /* The step decides it, not a mastery reading: each step puts one more word
       in the target language, and the last one crosses the frame too. */
    const frameTarget = pair.hasSlot ? frameAtStep(pair, state.step) : true;
    const targetSlots = slotsAtStep(pair, state.step);

    /* One new thing per exchange, which falls out of the same ladder: the word
       that has just crossed on a word step, the construction on the frame
       step. The character hands over vocabulary, the coach hands over
       constructions (NJA-3136). */
    let introducing = null;
    let introKey = null;
    if (pair.hasSlot && !frameTarget) {
      introKey = keys[Math.min(state.step, keys.length - 1)];
      const it = pair.items.find(i => i.key === introKey);
      const rec = it ? state.items[it.id] : null;
      if (rec && !rec.introduced) introducing = 'item';
    } else if (!pattern.introduced) {
      introducing = 'pattern';
    }

    return {
      pair, introducing, introKey, stage: state.stage, step: state.step,
      // who says it first: vocab comes from the character, patterns from the coach
      introducedBy: introducing === 'item' ? 'actor' : introducing === 'pattern' ? 'coach' : null,
      /* No group, so no question of hers to cross: the UI falls back to the
         cue map, which is what the other two venues still run on. */
      group: null, askId: null, askItem: null, askTarget: true, pool: null,
      revision: !!state.revision,
      phase: state.revision ? 'revision' : state.makeup ? 'makeup' : 'night',
      nightIndex: null,
      stepKey: stepKey(state.stage, state.step),
      frameTarget, targetSlots,
      // kept for everything that still thinks in terms of one word
      itemTarget: targetSlots.length > 0,
      expected: expected(pair, frameTarget, targetSlots),
      ...gaps(pair, frameTarget, targetSlots),
    };
  }

  function expected(pair, frameTarget, targetSlots) {
    return pair.say(frameTarget, targetSlots || []);
  }

  /* Which words of that sentence the child has to supply. Anything already in
     the target language is theirs to produce; anything still in their own
     language is scene-setting and stays on the page.

     With more than one slot this can no longer be done by finding the item's
     words in the finished sentence and marking the run — two slots can hold
     the same word, and "the first match" is then the wrong one half the time.
     The sentence is built chunk by chunk instead, and each chunk knows whether
     it came from the frame or from a slot, so a gap is a fact rather than a
     search result. */
  function gaps(pair, frameTarget, targetSlots) {
    const want = new Set(targetSlots || []);
    const frames = frameTarget ? pair.group.targetFrames : pair.group.nativeFrames;
    const cells = [];

    for (const f of frames) {
      if (f.type === 'text') {
        for (const w of words(f.text)) cells.push({ w, gap: frameTarget, from: 'frame' });
        continue;
      }
      const inTarget = want.has(f.key);
      const item = pair.items.find(i => i.key === f.key);
      const text = item ? (inTarget ? item.target : item.native) : '___';
      /* A slot marked `^` hands its leading word back to the sentence: "Do
         you have a ___?" rather than "Do you have ___ ___?". The article is
         still the vocabulary's own, so this costs nothing in the languages
         that inflect instead ("biletu") or in the words that take no article
         ("water") — there is no leading word to give, and the gap is the
         whole form as before. */
      const ws = words(text);
      const lead = (inTarget && f.givenLead && ws.length > 1) ? 1 : 0;
      ws.forEach((w, i) => cells.push({
        w, gap: inTarget && i >= lead, given: inTarget && i < lead, from: f.key,
      }));
    }

    /* The sentence is rebuilt from the finished string so a token that spans
       two chunks is still one token — "entrada?" has its "?" in the next text
       chunk, and a word split across a chunk boundary would otherwise come out
       as two.

       Punctuation is then held on the CELL rather than welded into the word. A
       pill is a word: "ticket?" as a thing to tap is noise, and dressing the
       decoys to match it so the "?" was not a tell made every pill on screen
       read "water?", "band?", "a?". The marks belong to the sentence, so they
       stay in the sentence — printed either side of the gap, where they also
       show the child the shape of what they are building. */
    const joined = words(expected(pair, frameTarget, targetSlots));
    const merged = [];
    let ci = 0;
    for (const token of joined) {
      const cell = cells[ci];
      const at = cell || { gap: frameTarget, from: 'frame' };
      if (at.gap) {
        const { lead, tail, word } = split(token);
        merged.push({ w: word, lead, tail, gap: true, from: at.from });
      } else {
        /* `given` marks a word the frame is handing over that BELONGS to the
           gap's phrase — today the article of a `^` slot. It prints like any
           other frame word, and the only thing that reads it is the spoken
           answer, where "a ticket" has to be as acceptable as "ticket". */
        merged.push({ w: token, lead: '', tail: '', gap: false, given: !!at.given, from: at.from });
      }
      if (!cell) continue;
      // a token can span several cells when a chunk boundary falls mid-word
      let acc = cell.w;
      ci += 1;
      while (acc.length < token.length && cells[ci]) { acc += cells[ci].w; ci += 1; }
    }

    const answer = merged.filter(c => c.gap).map(c => c.w);
    return { answer, cells: merged, expectedAnswerPills: makePills(answer) };
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

  /* The very first turn of the first go. Not of a replay: by then they know
     how this works, and a free pass would only inflate the second score. */
  function isOpener(state) {
    if (state.noOpener) return false;   // the test door, see ?opener=0
    return state.go === 1 && state.turn === 0 && !state.makeup;
  }

  /* The nouns a scenario actually teaches. Falls back to the whole table so a
     content object without an item list still produces decoys rather than
     none. */
  function venueItems(quest) {
    const list = quest.activity && quest.activity.items;
    return (list && list.length) ? list : Object.keys(quest.vocabItems);
  }

  /* Where a decoy may come from. The group's own words first — those are the
     ones this exchange is actually choosing between, and they are the only
     ones on screen a child can reason about. Then everything they have
     already met, so a group of three words still fills a tray. The venue's
     whole list is the floor, for the two venues that have no groups. */
  function decoyItems(quest, state, plan) {
    const all = venueItems(quest);
    if (!plan.pool || !plan.pool.length) return all;
    const met = all.filter(id => state.items[id] && state.items[id].introduced);
    /* Deliberately NOT falling back to the rest of the venue when those two
       run out. A decoy the child has never seen is rejected for the wrong
       reason — they do not know what it means, so it is not a choice about
       meaning — and a three-word group always has two real decoys in it,
       which is a choice. Fewer pills beats a free one. */
    const out = [], seen = new Set();
    for (const id of plan.pool.concat(met)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  /* ---------- 6. answer pills ----------
     "split expected answer by word, introduce red herrings i.e. words that
     don't work in a valid combination". The red herrings are drawn from items
     whose tags make them INVALID for this slot first — a band is a wrong
     answer to "Can I have ___" in a way a beer is not — and rendered in the
     same form and language as the real answer, so the choice is about meaning
     rather than about spotting the odd shape out. */
  function pills(quest, state, plan, count = 3) {
    const pair = plan.pair;
    const answer = plan.answer.slice();
    if (!answer.length) return [];

    /* The opening turn carries no decoys. A child meets the language and the
       tap-to-build mechanic in the same moment, and the data says the mechanic
       is what costs them: the first two steps have the WORST accuracy of the
       night (62% and 54%) on the simplest content there is, while the last is
       93% on the hardest — accuracy climbing as the grammar gets harder is
       survivorship, not learning. And a child who gets the opener wrong
       finishes at 23% against 38%.

       So the first turn is a lesson, not a test. There is still a task — the
       words have to go in the right order — but it cannot be failed, and the
       night starts scoring once they know what they are doing. */
    if (isOpener(state)) return makePills(answer.slice());

    const taken = new Set(answer.map(norm));

    /* No dressing. The answer words arrive here bare — gaps() keeps the
       sentence's punctuation on the cell — so a decoy is already wearing
       exactly what the pill it competes with wears, which is nothing. The
       version that dressed decoys to match took its marks from the LAST
       answer word and put them on everything, which is where "singer?" and
       "a?" came from. */

    /* And a whole phrase competes with other whole phrases: offering "ticket"
       and "water" against "Perdona" is not a choice, it is a spot-the-odd-one
       -out. */
    if (!pair.hasSlot) {
      const solos = [];
      for (const p of quest.pairs) {
        if (p.hasSlot || p.id === pair.id) continue;
        for (const raw of words(plan.frameTarget ? p.allTarget : p.allNative)) {
          const w = split(raw).word;
          if (w && !taken.has(norm(w)) && !solos.some(x => norm(x) === norm(w))) solos.push(w);
        }
      }
      return makePills(shuffle([...answer, ...solos.slice(0, count)], state));
    }

    /* Decoys are drawn PER SLOT now. With two slots the wrong answers have to
       be wrong for a particular slot — a word that is invalid for the first
       slot may be perfectly valid for the second, and offering it as a decoy
       for both is offering a right answer as a wrong one.

       Within a slot the order is the epic's: items whose tags make them
       invalid there first (a band is a wrong answer to "Can I have ___" in a
       way a beer is not), then valid ones, then frame words. */
    const want = new Set(plan.targetSlots || []);
    const invalid = [], valid = [], frames = [];
    const seen = new Set();
    const add = (bucket, w) => {
      if (!w || taken.has(norm(w)) || seen.has(norm(w))) return;
      seen.add(norm(w));
      bucket.push(w);
    };

    for (const key of pair.slotKeys) {
      const sl = pair.group.nativeFrames.find(f => f.type === 'slot' && f.key === key);
      if (!sl) continue;
      const lang = want.has(key) ? quest.targetLang : quest.nativeLang;
      const form = sl.forms[0];
      const mine = pair.fill[key];
      /* Only the nouns THIS venue teaches. The vocabulary table is shared
         across all three — one `ticket`, one `water` — so drawing decoys from
         the whole of it put a band and a singer on the tray at a football
         match, and offered the child a wrong answer they had no way of
         knowing was wrong. The activity's own list is the scenario's
         vocabulary, which is what a decoy has to come from to be a fair
         mistake. */
      for (const iid of decoyItems(quest, state, plan)) {
        const item = quest.vocabItems[iid];
        if (!item || iid === mine) continue;
        const bucket = (item.tags || []).includes(sl.tag) ? valid : invalid;
        /* Word by word, like the answer: "un refresco" offers "un" and
           "refresco". The article half is not padding — "un" against "una" is
           the gender distinction, which is exactly the kind of wrong answer
           worth being able to make.

           Unless the frame is giving the article away (`^`), in which case it
           is not a choice the child is being asked to make, and a loose "un"
           on the tray is a pill that cannot be right — and in English, where
           every indefinite starts "a", it would be on the tray every turn. */
        const forms0 = words(item[lang][form]);
        const offer = (sl.givenLead && forms0.length > 1) ? forms0.slice(1) : forms0;
        for (const raw of offer) add(bucket, split(raw).word);
      }
    }

    for (const p of quest.pairs) {
      if (p.patternId === pair.patternId || !p.hasSlot) continue;
      for (const raw of words(plan.frameTarget ? p.frame.target : p.frame.native)) {
        const w = split(raw).word;
        if (w !== '___') add(frames, w);
      }
    }

    const pool = [...invalid, ...valid, ...(answer.length > 1 ? frames : [])];
    const decoys = pool.slice(0, count);

    return makePills(shuffle([...answer, ...decoys], state));
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
  /* The record for the word this step is about — not always the first slot's,
     once a pattern holds two. */
  function stepItem(state, plan) {
    if (!plan.introKey) return null;
    const it = (plan.pair.items || []).find(i => i.key === plan.introKey);
    return it ? state.items[it.id] : null;
  }

  function seen(state, plan) {
    const { pattern } = recOf(state, plan.pair);
    const item = stepItem(state, plan) || recOf(state, plan.pair).item;
    if (state.attempts === 0) {
      pattern.exposures += 1;
      if (item) item.exposures += 1;
      if (plan.introducing === 'pattern') pattern.introduced = true;
      if (plan.introducing === 'item' && item) item.introduced = true;
      /* A question is introduced once and stays introduced — the same ratchet
         the other two run on, so a makeup loop never translates it twice. */
      if (plan.introducing === 'question' && plan.askId && state.asks[plan.askId])
        state.asks[plan.askId].introduced = true;
      track(state, 'exchange_start', { pair: plan.pair.id, introducing: plan.introducing });
    }
  }

  function applyCorrect(state, plan, { hinted }) {
    const { pattern } = recOf(state, plan.pair);
    const item = stepItem(state, plan) || recOf(state, plan.pair).item;
    for (const r of [pattern, item]) {
      if (!r) continue;
      r.correct += 1;
      r.lastTurn = state.turn;
      if (hinted) r.timesPrompted += 1; else r.timesUnprompted += 1;
    }
    state.coins += hinted ? 5 : 10;
    bank(state, hinted ? STEP_SCORE.hinted : STEP_SCORE.clean);
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
    /* The first wrong answer at a step marks it for the revision round, and
       only the first: what matters is whether they had it when it was new,
       not how many goes it took afterwards. A step they later get right still
       comes back — getting it right on the second attempt with the words in
       front of you is not the same as knowing it. */
    if (state.attempts === 0) state.missed[stepKey(state.stage, state.step)] = true;
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
    /* Retired from the makeup pool. Without this the two halves of the design
       fight each other: mercy scores 0, 0 keeps the child under the pass mark,
       and the pass mark sends the WEAKEST step round again — which is the one
       they have just been shown and still could not produce. A child who gets
       nothing right gave 160 answers across 40 turns and was handed the answer
       40 times, and the engine never ended the go; the turn cap did.

       A step they have been shown and still cannot say is not the one with the
       most to gain. It is the one they have proved they cannot do today. */
    state.released[stepKey(state.stage, state.step)] = true;
    state.missed[stepKey(state.stage, state.step)] = true;
    state.turn += 1;
    state.attempts = 0;
    bank(state, STEP_SCORE.mercy);
    if (state.quest) advance(state, state.quest);
    track(state, 'mercy', { pair: plan.pair.id, stage: state.stage, step: state.step });
  }

  /* ---------- the mastery arm ----------
     Arm A walks a fixed ladder and forgets it. This asks the learner's record
     what to do next, which is the whole of the difference: a second night is
     not the same night again, it is whatever did not stick.

     The plan it returns has THE SAME SHAPE as arm A's. That is deliberate and
     it is what keeps actor -> coach -> child intact: `renderTurn` does not
     know which arm it is drawing, so she still asks, he still hints, and the
     child still answers. Only the choosing changed.

     The scaffold is the join. Max derives support from mastery where we
     hard-coded it by position, and his five levels land on machinery we
     already have: L0 and L1 are her line in the child's language with the
     target word in it, L2 and L3 cross the frames, L4 is the whole thing
     across with the coach saying least. */
  function masteryTurn(state, quest) {
    const M = window.MASTERY;
    const rec = state.mastery || (state.mastery = M.blank());
    const patternIds = (quest.groups || []).map(g => g.id);
    if (!patternIds.length) return null;

    /* Section 7's PHASE, decided over EVERY word the activity has rather than
       over the pool of whichever construction happens to win the ranking.
       Scoped per pattern it does nothing: each construction keeps expanding
       its own pool, a new word arrives every turn, fifty-nine words share the
       credit, nothing is produced the four times it takes to reach the bar,
       and a perfect learner tops out around 80% for ever. "Nothing is very
       weak" is a statement about the LEARNER, not about one slot. */
    const allWords = (quest.activity.items || []);
    const phase = masteryPhase(rec, patternIds, allWords);

    /* Section 8, carrier rotation. On a word phase the WORD is chosen first
       and then a construction that can carry it, because a drill aimed at the
       weakest word is wasted if the pattern that won the ranking has no slot
       it fits. On a pattern phase it is the other way round. */
    let pid = null, itemId = null, priority = 0;
    if (phase === 'consolidate' || phase === 'expand') {
      itemId = phaseWords(M, rec, allWords, phase)[0] || null;
      const carriers = itemId
        ? patternIds.filter(id => slotPoolOf(quest, id).indexOf(itemId) >= 0)
        : [];
      const rankedC = M.rank(rec, carriers.length ? carriers : patternIds);
      pid = rankedC[0].id; priority = rankedC[0].priority;
      if (!carriers.length) itemId = null;
    } else {
      const ranked = M.rank(rec, patternIds);
      pid = ranked[0].id; priority = ranked[0].priority;
      itemId = phaseWords(M, rec, slotPoolOf(quest, pid), phase)[0] || null;
    }

    const group = quest.groups.find(g => g.id === pid);
    const slotKey = (group.slotKeys || [])[0] || null;
    const valid = slotKey ? (group.slots[slotKey] || []) : [];
    if (!slotKey) itemId = null;
    else if (!itemId || valid.indexOf(itemId) < 0)
      itemId = phaseWords(M, rec, valid, phase)[0] || valid[0] || null;
    const fill = (slotKey && itemId) ? { [slotKey]: itemId } : {};
    const pair = quest.pairFor(pid, fill);
    if (!pair) return null;

    const words = itemId ? [itemId] : [];
    const level = M.scaffold(rec, pid, words);
    const targetSlots = slotKey ? [slotKey] : [];
    /* L2 is where the child's own sentence crosses; L3 is where hers does. */
    const frameTarget = level >= 2;
    const askTarget = level >= 3;

    const prec = rec.patterns[pid];
    const wrec = itemId ? rec.words[itemId] : null;
    /* One new thing a turn, same rule as arm A, but read off the record
       rather than off a step. A word nobody has met is hers to hand over; a
       construction is the coach's. The word goes first, because a child
       cannot build a sentence out of a word they have never seen. */
    let introducing = null, introducedBy = null;
    if (itemId && (!wrec || !wrec.seen)) { introducing = 'item'; introducedBy = 'actor'; }
    else if (!prec || !prec.introduced) { introducing = 'pattern'; introducedBy = 'coach'; }

    return Object.assign({
      pair, introducing, introducedBy,
      introKey: introducing === 'item' ? slotKey : null,
      arm: 'mastery',
      /* No stage or step: there is no list to be at a position in. The
         analytics key is what the turn was ABOUT, which is the only thing
         stable across nights. */
      stage: 0, step: 0,
      group: pid,
      patternId: pid,
      itemId: itemId,
      stepKey: pid + (itemId ? '/' + itemId : ''),
      nightIndex: undefined,
      kind: 'production',
      phase: 'night',
      revision: false,
      /* Max's L0 to L4, on the event, because it is the thing his model
         decides and ours used to hard-code. */
      level: level,
      phaseKind: phase,
      priority: priority,
      masteryPattern: (prec && prec.mastery) || 0,
      masteryWord: (wrec && wrec.mastery) || 0,
      askId: null,
      askItem: itemId,
      askTarget,
      pool: valid.length ? valid.slice() : null,
      frameTarget, targetSlots,
      itemTarget: targetSlots.length > 0,
      expected: expected(pair, frameTarget, targetSlots),
    }, gaps(pair, frameTarget, targetSlots));
  }

  /* Section 7's phase table, in the order it resolves. "Very weak" is his
     0.35: below it a word is not learned, it has merely been seen, and
     putting a second new word next to it buys nothing. */
  const VERY_WEAK = 0.35;
  /* Every word some construction can actually ASK FOR.

     A pack can carry words no pattern has a slot for - Max's list has
     nineteen, the function words and the money words, which live inside his
     frames or in a quest rather than in a slot. They are real vocabulary and
     they are glossed, but they cannot be PRODUCED, so they cannot reach the
     bar, so a scenario scored over all of them can never be finished. Mastery
     is measured over what the child can be asked to say. */
  function reachableWords(quest) {
    const out = [];
    for (const g of quest.groups || [])
      for (const id of slotPoolOf(quest, g.id)) if (out.indexOf(id) < 0) out.push(id);
    return out;
  }

  /* The words a construction's slot will actually accept. */
  function slotPoolOf(quest, pid) {
    const g = (quest.groups || []).find(x => x.id === pid);
    if (!g) return [];
    const k = (g.slotKeys || [])[0];
    return k ? (g.slots[k] || []) : [];
  }
  function masteryPhase(rec, patternIds, wordIds) {
    const M = window.MASTERY;
    const w = id => rec.words[id];
    const veryWeak = wordIds.filter(id => w(id) && w(id).seen && w(id).mastery < VERY_WEAK);
    /* B3 first when something met has not landed. This is the inversion of
       the naive reading and it is the whole fix. */
    if (veryWeak.length) return 'consolidate';
    /* B - teach a construction, on a word they already have, so the turn
       still carries exactly one new thing. */
    if (patternIds.some(id => !(rec.patterns[id] || {}).introduced)) return 'introduce';
    /* B2 - vocabulary expansion, once nothing is floundering. */
    if (wordIds.some(id => !w(id) || !w(id).seen)) return 'expand';
    /* B3 again, for the merely shaky. */
    if (wordIds.some(id => w(id) && !M.atBar(w(id).mastery))) return 'consolidate';
    /* F - the scenario is done; anything valid is scene glue now. */
    return 'free';
  }

  function phaseWords(M, rec, valid, phase) {
    const w = id => rec.words[id];
    const seen = valid.filter(id => w(id) && w(id).seen);
    if (phase === 'expand') {
      const unseen = valid.filter(id => !w(id) || !w(id).seen);
      /* Rotated so a pack is not always met in declaration order. */
      if (unseen.length) return [unseen[(rec.turn || 0) % unseen.length]];
    }
    if (phase === 'introduce') {
      /* The strongest word they have, so the construction is the only new
         thing in the turn. Falls through to an unseen one if they have none
         yet, because a first construction has to be about something. */
      const strong = seen.slice().sort((a, b) => w(b).mastery - w(a).mastery);
      if (strong.length) return [strong[0]];
    }
    /* consolidate and free: section 2 says a word at the bar is never a
       target, section 8 says weakest first from a rotating offset.

       SEEN ONLY, and this is the trap. `targetWords` ranks by mastery and an
       unseen word scores 0, which is weaker than anything already met - so
       asked for "the weakest" it hands back a word the child has never been
       shown, and consolidation silently becomes expansion. Consolidating
       means drilling what they HAVE met and not landed. */
    const below = seen.filter(id => !M.atBar(w(id).mastery))
                      .sort((a, b) => w(a).mastery - w(b).mastery || (a < b ? -1 : 1));
    if (below.length) return [below[(rec.turn || 0) % below.length]];
    return seen.length ? [seen[(rec.turn || 0) % seen.length]] : [];
  }

  /* The outcome of a turn, folded back into the record. The UI says what
     happened; every number is decided in MASTERY and nowhere else, which is
     the invariant Max's own stack document states. */
  function masteryApply(state, plan, outcome) {
    const M = window.MASTERY;
    const rec = state.mastery || (state.mastery = M.blank());
    const ev = {
      patternId: plan.patternId,
      words: plan.itemId ? [plan.itemId] : [],
      hints: outcome.hints || 0,
      attempt: outcome.attempt || 0,
      typo: !!outcome.typo,
      phase: outcome.phase || 'base',
    };
    if (outcome.correct) {
      ev.kind = outcome.offPattern ? 'offPattern' : 'produced';
      ev.produced = plan.itemId ? [plan.itemId] : [];
    } else {
      ev.kind = 'wrong';
    }
    const out = M.apply(rec, ev);
    state.mastery = M.nextTurn(out.state);
    return out.moved;
  }

  /* Her words, read rather than said, which Max credits at a fifth of
     production. Called when her line lands, not when the child answers. */
  function masteryHeard(state, wordIds) {
    const M = window.MASTERY;
    const rec = state.mastery || (state.mastery = M.blank());
    if (!wordIds || !wordIds.length) return [];
    const out = M.apply(rec, { kind: 'read', readWords: wordIds });
    state.mastery = out.state;
    return out.moved;
  }

  /* When a night ends. Max runs 15 to 20 blocks; the scenario being finished
     ends it early, which is the point of a mastery session and the thing a
     fixed ladder could never do. */
  const MASTERY_TURNS = 16;
  function masteryDone(state, quest) {
    const M = window.MASTERY;
    const rec = state.mastery || M.blank();
    const patternIds = (quest.groups || []).map(g => g.id);
    if (M.scenarioMastered(rec, patternIds, reachableWords(quest))) return 'mastered';
    if ((rec.turn || 0) >= MASTERY_TURNS) return 'turns';
    return null;
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
    syllabus: stages, stepsIn, advance, stageDone, slotsAtStep, frameAtStep,
    seen, applyCorrect, applyWrong, mercyDue, applyMercy, track, isOpener,
    masteryTurn, masteryApply, masteryHeard, masteryDone, MASTERY_TURNS, reachableWords,
    overall, sessionComplete, mastered, progress, phase, ratio, recOf,
    passMark, keepMark, passed, replay, switchVenue, report, allSteps, stepKey, weakest,
    expected, gaps, tagOfPattern, norm, words,
  };
})();
