/* ui.js — screens, chips, mic, coach, voice cues.
   Holds no scoring logic: every number comes from ENGINE.
   Three stacked layers so the reskin is assets + tokens. */

(function () {
  const Q = window.QUEST;
  const E = window.ENGINE;
  const V = window.VOICE;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pct = m => Math.round(m * 100) + '%';
  const TL = () => Q.targetLang;
  const NL = () => Q.nativeLang;

  let state, current = null, plan = null, hinted = false, attempts = 0;
  /* slot-indexed and sparse; marks[i] is null until judged (NJA-3162) */
  let placed = [], marks = [], submitted = false;
  /* set while a pointer drag is in flight, so the click that ends a drag is
     not also read as a tap (NJA-3161 AC 1.3, NJA-3178 AC 1.4) */
  let dragMoved = false;
  const ACTOR = Q.activity.actor.id;
  const COACH = Q.activity.coach.name;
  let inputLocked = false;
  let turnLine = '', turnAsk = '', turnCoachHtml = '', turnCoachFrags = null;   // this turn's words, for history and the repeat
  let micOn = false, busy = false, recog = null, serverUp = false, health = {};

  /* ---------- character renderer ----------
     Lottie, one rig per character, both clips loaded once and kept. Swapping
     visibility rather than reloading means a character can start and stop
     talking mid-turn with no flash and no refetch.

     The state names are the slots Directus already stores on
     ai_tutor_characters: idle | speak | intro | outro | pose. Only idle and
     speak have art so far; the rest resolve to idle, and a character with no
     entry here falls back to the dashed placeholder box, which is how the
     bartender still renders.

     The clips are 1920x1080 and the slot is portrait, so something always gets
     cropped. What gets cropped is decided in frameRig() below. */
  /* The bouncer became the person behind the counter — he sells the tickets,
     the drinks and the merch now, because one room with one person is what
     gives the generator enough to talk about. The art files keep their old
     names; only who he is changed. */
  const ANIM = {
    axel:      { idle: 'anim/axel-idle.json',    speak: 'anim/axel-talk.json' },
    bartender: { idle: 'anim/bouncer-idle.json', speak: 'anim/bouncer-talk.json' },
  };

  /* ---------- framing ----------
     The design wants the character's top half filling the space the whole
     figure used to: head high, shoulders running off both edges, torso
     continuing down behind the chat and behind the answer sheet. The rig is
     unchanged — this is a crop.

     FIGURE is where the character actually is inside its 1920x1080 clip,
     measured off a render of each one rather than guessed. It matters because
     neither figure is centred in its own frame (the bouncer sits 29px left of
     it, Axel 35px) and both clips of a character are framed alike, so nothing
     shifts when they start talking. Working from these boxes is what lets the
     crop be computed rather than dialled in: the two constants below frame any
     character once its box is known, and the maths re-runs on resize instead
     of assuming a phone. */
  const FIGURE = {
    bartender: { x: 662, y: 128, w: 538, h: 940 },
    axel:      { x: 732, y:  88, w: 386, h: 952 },
  };
  const CLIP_W = 1920, CLIP_H = 1080;
  const CROP = 0.56;        // how far down the figure to show — roughly the waist
  /* Scene left above the head. It is not decoration: the pause button and the
     mastery pill sit in the top 50px, and at 4.5% the hair ran behind them. */
  const SKY  = 0.105;

  /* Place the rig so the head lands just below the top of the stage and the
     waist lands on the bottom of it, with the figure's own centre on the
     stage's centre. Everything outside is cropped by the stage. */
  function frameRig(host, character) {
    const rig = rigs.get(character);
    const f = FIGURE[character];
    if (!rig || !f) return;
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;

    // what the SVG itself does first: cover the box, centred (xMidYMid slice)
    const s = Math.max(W / CLIP_W, H / CLIP_H);
    const left = (W - CLIP_W * s) / 2, top = (H - CLIP_H * s) / 2;

    const cx  = left + (f.x + f.w / 2) * s;          // figure centre, before the crop
    const y0  = top + f.y * s;                        // top of the head
    const y1  = top + (f.y + f.h * CROP) * s;         // where we cut the body

    const want0 = SKY * H, want1 = H;
    const Z = Math.max(1, (want1 - want0) / Math.max(1, y1 - y0));
    let tx = W / 2 - cx * Z;
    const ty = want0 - y0 * Z;

    // never pull the clip's own edge inside the stage — that would show a seam
    const fl = left * Z + tx, fr = fl + CLIP_W * s * Z;
    if (fl > 0) tx -= fl;
    if (fr < W) tx += W - fr;

    rig.root.style.transformOrigin = '0 0';
    rig.root.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${Z.toFixed(4)})`;
  }
  const rigs = new Map();               // character -> { root, clips:{idle,speak} }

  function buildRig(host, character) {
    const src = ANIM[character];
    if (!src || typeof window.lottie === 'undefined') return null;
    const root = document.createElement('div');
    root.className = 'rig';
    root.dataset.character = character;
    host.appendChild(root);
    const clips = {};
    for (const key of ['idle', 'speak']) {
      const box = document.createElement('div');
      box.className = 'clip';
      root.appendChild(box);
      clips[key] = window.lottie.loadAnimation({
        container: box, renderer: 'svg', loop: true, autoplay: false,
        path: src[key],
        /* Centred rather than bottom-anchored: frameRig() does the placing,
           and it needs the SVG's own fit to be predictable. */
        rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
      });
      clips[key].el = box;
    }
    const rig = { root, clips };
    rigs.set(character, rig);
    return rig;
  }

  /* Build every rig while the title screen is up. Each clip is a ~170KB fetch,
     and mounting one on demand left the stage empty for the first second of
     the first turn — the child pressed START and met an empty room. */
  function preloadRigs() {
    const host = $('character');
    for (const name of Object.keys(ANIM)) {
      if (rigs.has(name)) continue;
      const r = buildRig(host, name);
      if (r) r.root.hidden = true;
    }
  }

  function mountCharacter(el, { character, state: st }) {
    el.dataset.character = character;
    el.dataset.state = st;
    el.querySelector('.ch-name').textContent = character.toUpperCase();
    el.querySelector('.ch-state').textContent = st;

    const rig = rigs.get(character) || buildRig(el, character);
    el.classList.toggle('rigged', !!rig);
    for (const [name, r] of rigs) r.root.hidden = name !== character;
    if (!rig) return;
    frameRig(el, character);

    // only speak has its own clip; intro, outro and pose sit on idle for now
    const want = st === 'speak' ? 'speak' : 'idle';
    for (const key of ['idle', 'speak']) {
      const c = rig.clips[key];
      c.el.hidden = key !== want;
      if (key === want) c.play(); else c.pause();
    }
  }
  /* A rotation or a soft-keyboard resize changes the stage, and the crop is
     computed from it, so it has to be recomputed too. */
  let frameTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => {
      const el = $('character');
      if (el && el.dataset.character) frameRig(el, el.dataset.character);
    }, 120);
  });

  function mountBackground(el, key) {
    el.querySelector('.bglabel').textContent = key.replace(/-/g, ' ');
    // el.querySelector('.bgimg').src = ASSETS.backgrounds[key];
  }

  /* ---------- evaluator ---------- */
  async function probeServer() {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1500);
      const r = await fetch('/api/health', { signal: c.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const j = await r.json();
      health = j || {};
      // Locked and no cookie yet means every API call would 401 and silently
      // fall back — browser voice, template coach, local matcher. Gate first.
      if (j && j.locked && !j.unlocked) { serverUp = false; V.setServer(false); return false; }
      serverUp = j && j.ok === true && !j.mock;
      V.setServer(serverUp);
      $('t-mode').textContent = serverUp
        ? 'evaluator: ' + j.model + ' · voice: ' + (j.tts || 'browser')
        : 'evaluator: local · voice: browser';
      return true;
    } catch { serverUp = false; return true; }
  }

  /* ---------- title ----------
     Also the audio gesture: iOS will not play a sound until the user has
     touched something, so START doubles as the unlock and the child never
     meets a silent first turn. */
  function titleScreen() {
    return new Promise(resolve => {
      const sheet = $('title');
      $('title-name').textContent = Q.title || 'Axel goes to a gig';
      sheet.classList.remove('hidden');
      $('title-go').addEventListener('click', () => {
        V.unlock();
        sheet.classList.add('hidden');
        resolve();
      }, { once: true });
    });
  }

  /* ---------- access code ----------
     The token comes back as an HttpOnly cookie, so nothing is stored here and
     nothing is attached to later calls; they just carry it same-origin. */
  function unlockGate() {
    return new Promise(resolve => {
      const sheet = $('gate'), input = $('gate-code'), msg = $('gate-msg');
      sheet.classList.remove('hidden');
      input.focus();
      async function tryCode() {
        const code = input.value.trim();
        if (!code) return;
        msg.textContent = 'checking…';
        try {
          const r = await fetch('/api/unlock', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
          });
          if (!r.ok) { msg.textContent = 'That code is not right.'; input.select(); return; }
          sheet.classList.add('hidden');
          V.unlock();                      // this tap is the gesture iOS wants
          resolve();
        } catch { msg.textContent = 'Could not reach the server.'; }
      }
      $('gate-go').addEventListener('click', tryCode);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') tryCode(); });
    });
  }

  async function evaluateSpoken(text, item) {
    if (serverUp) {
      try {
        const r = await fetch('/api/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            learnerText: text, target: item.target, native: item.native,
            accept: item.accept, nativeLang: NL(), targetLang: TL()
          })
        });
        if (r.ok) {
          const j = await r.json();
          if (typeof j.target_produced === 'boolean') return j;
        }
      } catch { /* fall through */ }
    }
    return E.evaluateLocal(text, item);
  }

  /* ---------- the tutor turn ----------
     The engine has already chosen the phrase and the support level. This asks
     the model to write the words for it, and falls back to the templates in
     content.js when there is no server. Either way the numbers are the same. */
  const F = window.FRAGMENTS;
  const recentActor = [], recentCoach = [];   // so neither agent repeats itself
  const history = [];          // what has actually been said in this scene

  /* ---------- what the child has met ----------
     NJA-3136 feature 8.3: a word is shown in the target language once it has
     been INTRODUCED, and from then on it is highlighted and tappable. Before
     that it does not appear in the target language at all. Both facts come
     from the same place — the engine's `introduced` flags — so the chat, the
     whitelist and the tap-to-translate modal can never disagree. */
  let WHITELIST = null;
  function glossable() {
    if (WHITELIST) return WHITELIST;
    WHITELIST = new Set(Object.keys(Q.glossary).map(bare));
    return WHITELIST;
  }

  /* Target-language words the child has already been introduced to. These are
     the ones the character may use, and the ones that render as blue. */
  function introducedWords() {
    const out = new Set();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    for (const [id, rec] of Object.entries(state.items))
      if (rec.introduced) for (const f of ['bare', 'definite', 'indefinite'])
        add(Q.vocabItems[id][TL()][f]);
    for (const [id, rec] of Object.entries(state.patterns))
      if (rec.introduced) add(Q.vocabPatterns[id][TL()].replace(/\{[^}]+\}/g, ' '));
    return out;
  }

  /* Every word of every introduced vocab item. These belong to both sides —
     "entrada" is the same word whoever says it — so they are never restricted
     by the speaker rule below. */
  function itemWords() {
    const out = new Set();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    for (const [id, rec] of Object.entries(state.items))
      if (rec.introduced) for (const f of ['bare', 'definite', 'indefinite'])
        add(Q.vocabItems[id][TL()][f]);
    return out;
  }

  /* What the CHARACTER may say in the target language: the introduced items,
     plus the introduced constructions that are his to say. A construction
     marked `learner` is the child's line to him — he must not say it back. */
  function actorAllowed() {
    const out = itemWords();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    for (const [id, rec] of Object.entries(state.patterns))
      if (rec.introduced && (Q.vocabPatterns[id].speaker || 'either') !== 'learner')
        add(Q.vocabPatterns[id][TL()].replace(/\{[^}]+\}/g, ' '));
    return out;
  }

  /* The other half: words that are the child's alone. Kept as its own list
     because the guard on a generated line needs to REJECT these, not merely
     fail to permit them — "perdona" is on the introduced list for
     highlighting, so a check that only asks "was this introduced?" lets the
     bartender say it. Item words are subtracted, since they belong to nobody
     in particular. */
  function learnerOnlyWords() {
    const out = new Set();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    for (const [id, rec] of Object.entries(state.patterns))
      if (rec.introduced && Q.vocabPatterns[id].speaker === 'learner')
        add(Q.vocabPatterns[id][TL()].replace(/\{[^}]+\}/g, ' '));
    for (const w of itemWords()) out.delete(w);
    return out;
  }

  function chipMeaning(w) {
    const k = String(w).toLowerCase().trim();
    return Q.chipGloss[k] || gloss(w) || '';
  }

  /* The one new thing this exchange introduces, and what it means. The epic
     allows exactly one — "we don't introduce both a pattern and a word as part
     of the same exchange" — so this is a single value or nothing. */
  function newThing(plan) {
    if (!plan.introducing) return null;
    if (plan.introducing === 'item') {
      const it = Q.vocabItems[plan.pair.itemId];
      return { kind: 'item', by: 'actor',
               target: it[TL()][plan.pair.form], means: it[NL()][plan.pair.form] };
    }
    const pat = Q.vocabPatterns[plan.pair.patternId];
    return { kind: 'pattern', by: 'coach',
             target: pat[TL()].replace(/\{[^}]+\}/g, '___'),
             means: pat[NL()].replace(/\{[^}]+\}/g, '___') };
  }

  /* Does the character's line actually contain the word it is introducing?
     The character's job on a vocab turn is to put that word in front of the
     child; a line that talks around it teaches nothing. */
  function carriesWord(line, word) {
    const stem = bare(String(word).split(/\s+/).pop()).replace(/e?s$/, '');
    if (stem.length < 3) return true;
    return String(line).split(/\s+/).some(t => bare(t).startsWith(stem));
  }

  /* Both of these now come from fragments.js, which the server also loads.
     When the two disagreed about whether "no" was Spanish, the audit and the
     highlighting disagreed with each other — the line passed the guard and
     then rendered a blue English word. */
  const looksForeign = F.looksForeign;
  const AMBIGUOUS = F.AMBIGUOUS;
  const countsAsTarget = (tok, vocab) => {
    const w = bare(tok);
    return looksForeign(tok) || (vocab.has(w) && !AMBIGUOUS.has(w));
  };

  /* Is this line written in the language being taught? Used on the coach's
     side only: a coach who answers in the language the child is learning is
     not a coach. One shared word is coincidence, two is a pattern. */
  function looksTargetLanguage(text, limit = 2) {
    if (/[¿¡]/.test(text) || /[áéíóúñü]/i.test(text)) return true;
    const v = glossable();
    return String(text).split(/\s+/).filter(t => countsAsTarget(t, v)).length >= limit;
  }

  /* The guard on a generated character line. The engine has already decided
     which words have crossed into the target language; a line that reaches
     past that list is teaching vocabulary nobody chose, which is the failure
     the epic names — "the agent adds/takes away too much of the language". */
  function auditLine(text, allowed) {
    let over = 0, unglossable = 0;
    for (const tok of String(text).split(/\s+/)) {
      const w = bare(tok);
      if (!w) continue;
      if (!countsAsTarget(tok, glossable())) continue;
      if (!allowed.has(w)) over += 1;
      if (!glossable().has(w)) unglossable += 1;
    }
    return { over, unglossable };
  }
  /* ---------- the two agents ----------
     NJA-3154: the actor's line and the coach's hint are two Gemini calls, in
     series, because the coach's job is to explain what the actor ACTUALLY
     said. One call writing both lines is writing a reaction to a line it has
     not settled on yet.

     In series does not have to mean twice the wait. The coach's bubble has
     never appeared until the character has finished speaking — posting both at
     once lets a child read the hint before they have heard the question — so
     the second call runs while his audio plays and is almost always back
     before it is wanted. */
  const TURN_DEADLINE_MS = 5000;
  const COACH_DEADLINE_MS = 6000;
  /* Shorter than the other two on purpose. The character's reaction is a
     flourish — the turn is already judged and the banner is already up — so a
     slow one must not hold a child in front of a red rectangle. It gets barely
     longer than the banner's own minimum, and is dropped if it misses. */
  const REACT_DEADLINE_MS = 3500;
  let lastGenMs = 0, lastGenWhy = 'template';
  let lastCoachMs = 0, lastCoachWhy = 'template';

  /* Everything both calls need. All of it is the engine's, none of it is the
     model's to decide — which is why the same object serves both. */
  function turnBody(plan) {
    return {
      prompt: Q.activity.prompt,
      coachPrompt: Q.activity.coach.prompt,
      actorRules: Q.prompts.actorRules,
      coachRules: Q.prompts.coachRules,
      actor: Q.activity.actor.name,
      coach: Q.activity.coach.name,
      objectives: Q.activity.objectives,
      nativeLang: NL(), targetLang: TL(),
      expected: plan.expected,
      expectedNative: plan.pair.allNative,
      // what has crossed over — for highlighting, and for the coach
      introduced: [...introducedWords()],
      // ...and the same list split by whose line it is, for the character
      actorMayUse: [...actorAllowed()],
      learnerOnly: [...learnerOnlyWords()],
      // the ONE new thing, and whose job it is to hand it over
      introducing: newThing(plan),
      history: history.slice(-4),
    };
  }

  async function post(path, body, deadline) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), deadline);
    try {
      const r = await fetch(path, {
        signal: ctl.signal,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { fail: 'http ' + r.status };
      const j = await r.json();
      if (j && j.error) return { fail: 'error' };
      return j || { fail: 'empty' };
    } catch (e) {
      return { fail: (e && e.name === 'AbortError') ? 'timed out' : 'unreachable' };
    } finally { clearTimeout(timer); }
  }

  /* The character's line. The guard is unchanged: the engine's list is the
     whole of what may appear in the target language, and a line reaching past
     it is inventing curriculum — the failure the epic names. */
  async function generateActorLine(plan) {
    if (!serverUp) { lastGenWhy = 'no server'; return null; }
    const t0 = Date.now();
    const intro = newThing(plan);
    const j = await post('/api/turn',
      Object.assign(turnBody(plan), { recentActor: recentActor.slice(-6) }),
      TURN_DEADLINE_MS);
    lastGenMs = Date.now() - t0;
    if (j.fail) { lastGenWhy = j.fail; return null; }
    if (!j.actorText) { lastGenWhy = 'empty'; return null; }

    const allowed = introducedWords();
    if (intro) for (const w of String(intro.target).split(/\s+/)) allowed.add(bare(w));
    const a = auditLine(j.actorText, allowed);
    if (a.unglossable > 0) { lastGenWhy = 'unglossable word'; return null; }
    if (a.over > 0)        { lastGenWhy = 'used words not yet introduced'; return null; }

    /* And the line must not be the CHILD'S line said back at them. Asking the
       prompt nicely is not enough here: "perdona" is on the introduced list,
       so every other check passes it happily, and the bartender opens with
       "Alright, perdona, what can I do for ya?" — the customer's own words,
       in the server's mouth, used as filler. */
    const mine = learnerOnlyWords();
    const stolen = String(j.actorText).split(/\s+/).map(bare).filter(w => w && mine.has(w));
    if (stolen.length) { lastGenWhy = "said the child's own line: " + stolen.join(', '); return null; }
    /* And when the character is the one introducing a word, the word has to be
       in their mouth. */
    if (intro && intro.by === 'actor' && !carriesWord(j.actorText, intro.target)) {
      lastGenWhy = 'new word missing'; return null;
    }
    recentActor.push(j.actorText);
    return j;
  }

  /* The coach's line, asked for only once the character's is settled. */
  async function generateCoachLine(plan, actorLine) {
    if (!serverUp) { lastCoachWhy = 'no server'; return null; }
    const t0 = Date.now();
    const j = await post('/api/coach',
      Object.assign(turnBody(plan), { actorLine, recentCoach: recentCoach.slice(-6) }),
      COACH_DEADLINE_MS);
    lastCoachMs = Date.now() - t0;
    if (j.fail) { lastCoachWhy = j.fail; return null; }
    if (!j.coachText) { lastCoachWhy = 'empty'; return null; }
    /* A coach who answers in the language the child is learning is not a
       coach. The one exception is the construction they are introducing, which
       the audit below already allows for. */
    const intro = newThing(plan);
    const allowed = introducedWords();
    if (intro && intro.by === 'coach') for (const w of String(intro.target).split(/\s+/)) allowed.add(bare(w));
    if (auditLine(j.coachText, allowed).over > 0) { lastCoachWhy = 'wrote in the target language'; return null; }
    lastCoachWhy = 'gemini';
    recentCoach.push(j.coachText);
    return j;
  }

  /* ---------- fragments ----------
     NJA-3149: a message is a role plus a list of {type, text} fragments, and a
     `target` fragment renders highlighted. The server returns them for the two
     generated lines; these build the same shape for everything else — template
     lines, and the child's own answer — so one renderer serves the lot. */
  function toFragments(text, extraAllowed) {
    const allowed = introducedWords();
    for (const w of extraAllowed || []) for (const t of String(w).split(/\s+/)) allowed.add(bare(t));
    return F.fragments(text, allowed);
  }

  /* Render fragments to HTML. A `target` fragment is blue, bold, underlined
     and tappable — the same button `spanishHTML` produced word by word, except
     that what counts as target is now data rather than a guess made at paint
     time. */
  function fragmentsHTML(frags) {
    return (frags || []).map(f => {
      if (f.type !== 'target') return esc(f.text);
      return String(f.text).split(/(\s+)/).map(tok =>
        tok.trim()
          ? '<button type="button" class="w" data-w="' + esc(tok) + '">' + esc(tok) + '</button>'
          : tok
      ).join('');
    }).join('');
  }

  /* What gets said when the model is slow, unreachable or off the rails.
     Written from the engine's own plan, so it is always correct even though it
     is never interesting. */
  function fallbackLines(plan) {
    const intro = newThing(plan);
    const asks = ['What can I get you?', 'Yes? What do you need?',
                  'Right — what will it be?', 'Go on then.'];
    let actor = asks[(state.turn + plan.pair.id.length) % asks.length];
    if (intro && intro.by === 'actor') actor = `We have ${intro.target}. Do you want it?`;

    const coachAsks = ['Tell them.', 'Say it back.', 'Your turn.', 'Answer them.'];
    let coach = `${coachAsks[state.turn % coachAsks.length]} “${plan.pair.allNative}”`;
    if (intro && intro.kind === 'pattern') coach = `Here's how you say it: “${plan.pair.allNative}”`;
    return { actor_line: actor, coach_line: coach };
  }

  function recordTurn(plan, actorLine, coachLine, produced) {
    history.push({
      actor: actorLine, coach: coachLine,
      wanted: plan.expected, got: produced ? 'the child said it' : 'not yet',
    });
    if (history.length > 8) history.shift();
  }

  /* The coach's bubble. Whatever the model wrote, if this exchange introduces
     something the coach is responsible for, the child leaves knowing what it
     means: a construction they have never seen, named and translated. Vocab is
     the character's job, so the coach does not double up on it. */
  function coachCopy(plan, gen) {
    const fb = fallbackLines(plan);
    const ask = gen && gen.coachText ? gen.coachText : fb.coach_line;
    const frags = gen && gen.chatHistory && gen.chatHistory[0]
      ? gen.chatHistory[0].messageFragments
      : toFragments(ask);

    const intro = newThing(plan);
    const owed = intro && intro.by === 'coach' &&
                 !ask.toLowerCase().includes(intro.target.replace(/_+/g, '').trim().toLowerCase());
    const badge = owed
      ? `<span class="newword">${fragmentsHTML(toFragments(intro.target, [intro.target]))} <i>${esc(intro.means)}</i></span>` : '';
    return {
      askText: owed ? `${ask} — ${intro.target} — ${intro.means}` : ask,
      html: fragmentsHTML(frags) + badge,
      fragments: owed ? frags.concat(toFragments(' ' + intro.target, [intro.target]),
                                     [{ type: 'text', text: ' — ' + intro.means }])
                      : frags,
    };
  }

  /* ---------- tappable Spanish ----------
     Every Spanish word on screen can be tapped for its meaning and its sound.
     This is the main way a child reads the bouncer without being taught him. */
  const GLOSS = Q.glossary || {};
  const bare = w => w.toLowerCase().replace(/[¿?¡!.,;:"“”]/g, '').trim();

  function gloss(word) {
    const k = bare(word);
    return GLOSS[k] || GLOSS[k.replace(/[^a-zñáéíóúü ]/g, '')] || null;
  }

  /* Feature 8.3: a target-language word is highlighted and clickable once it
     has been introduced. Before that it is not on screen in that language at
     all, and afterwards it always is — so "blue" and "introduced" are the same
     fact, read from the same place.

     Since NJA-3149 that fact travels as fragments rather than being worked out
     again at paint time, so this is now one line: split the text the same way
     the server does, and render it. Kept as a function because the child's own
     answers and the gloss card still arrive as plain strings. */
  function spanishHTML(text) {
    return fragmentsHTML(toFragments(text));
  }

  /* ---------- the conversation ----------
     One continuous log for the whole night, oldest fading out at the top. Each
     entry is kept as data so the full-screen view can re-render it, and so the
     child's own answers sit in the same history as everything said to them. */
  const chatLog = [];

  /* NJA-3149's three roles. Everyone who is not the coach or the child is
     the actor, whatever the scenario has named them. */
  const ROLE = who => who === 'axel' ? 'coach' : who === 'me' ? 'user' : 'actor';
  const AVATARS = { axel: 'img/axel-avatar.png' };
  const LABEL   = { axel: 'Coach', me: 'You' };
  const label = who => LABEL[who] || (who.charAt(0).toUpperCase() + who.slice(1));

  function avatarEl(who) {
    const a = document.createElement('span');
    a.className = 'av';
    const src = AVATARS[who];
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.alt = '';
      a.appendChild(img);
      return a;
    }
    if (who === 'me') {
      // the child's own avatar: a greyed head until they can choose one
      a.classList.add('me');
      a.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        '<circle cx="12" cy="8.5" r="4" fill="currentColor"></circle>' +
        '<path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor"></path></svg>';
      return a;
    }
    // no art for this character yet: a disc with their initial
    a.textContent = who.charAt(0).toUpperCase();
    return a;
  }

  function messageEl(entry, opts = {}) {
    const row = document.createElement('div');
    row.className = 'msg' + (entry.who === 'me' ? ' mine' : '') +
                    (entry.who === 'axel' ? ' coach' : '') +
                    (entry.verdict ? ' ' + entry.verdict : '') + (opts.enter ? ' enter' : '');
    const av = avatarEl(entry.who);
    if (entry.who === 'axel') {
      const b = document.createElement('button');
      b.className = 'av';
      b.setAttribute('aria-label', 'Ask Axel for help');
      b.innerHTML = av.innerHTML;
      b.addEventListener('click', openCoach);
      row.appendChild(b);
    } else {
      row.appendChild(av);
    }
    const col = document.createElement('div');
    col.className = 'col';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = label(entry.who);
    const bub = document.createElement('span');
    bub.className = 'bubble';
    bub.innerHTML = entry.html;
    col.appendChild(who); col.appendChild(bub);
    row.appendChild(col);
    return row;
  }

  /* NJA-3149's chat history: every entry is a role and a list of fragments.
     `html` is kept alongside for the two places that add their own markup on
     top — the coach's new-word badge — but the fragments are the record, and
     the expanded view and any future renderer read those. */
  function say(who, html, text, frags, verdict) {
    chatLog.push({
      who, html, text: text || '',
      role: ROLE(who),
      messageFragments: frags || toFragments(text || ''),
      /* NJA-3169: the child's own bubble carries the verdict, so it is green
         when they got it right and red when they did not. Actor and coach
         bubbles have no verdict and stay white. */
      verdict: verdict || null,
    });
    const chat = $('chat');
    chat.appendChild(messageEl(chatLog[chatLog.length - 1], { enter: true }));
    // keep the live view short; the whole night lives in the expanded view
    while (chat.children.length > 5) chat.removeChild(chat.firstChild);
    chat.scrollTop = chat.scrollHeight;
  }

  function renderChatFull() {
    const body = $('chat-full-body');
    body.innerHTML = '';
    for (const e of chatLog) body.appendChild(messageEl(e));
    body.scrollTop = body.scrollHeight;
  }

  /* ---------- word gloss ----------
     A blue word opens the card: what it means, and a button to hear it. */
  let glossWord = '';
  function showGloss(word, speak) {
    glossWord = word;
    $('gloss-word').textContent = String(word).replace(/^[¿¡"“]+|[?!.,;:"”]+$/g, '') || word;
    /* chipMeaning before gloss: the glossary is keyed on single words, so
       "una entrada" was a blank card even though the content has known it
       meant "a ticket" all along. */
    $('gloss-mean').textContent = chipMeaning(word) || '—';
    if (state) E.track(state, 'translation_clicked', { word: String(word) });
    $('gloss').classList.remove('hidden');
    if (speak) V.now(word, { speaker: 'axel', lang: TL() });
  }
  function hideGloss() { $('gloss').classList.add('hidden'); }

  /* Reading is never locked — a child can ask what a word means whenever they
     like. Only the SOUND waits: while a character is still speaking, the card
     opens silently rather than talking over them. The card's own speaker
     button always works, because tapping it is asking for the interruption. */
  document.addEventListener('click', ev => {
    const w = ev.target.closest && ev.target.closest('.w');
    if (w) { showGloss(w.dataset.w, !inputLocked); return; }
    // a chip tap is answering, not reading: it leaves an open card alone
    if (ev.target.closest && ev.target.closest('.chip')) return;
    // anywhere else dismisses it, except inside the card itself
    if (!$('gloss').classList.contains('hidden') &&
        !(ev.target.closest && ev.target.closest('#gloss'))) hideGloss();
  });

  /* ---------- input lock ----------
     While a character is delivering the opening of a turn, the lower panel is
     dead: no chips, no CLR, no SAY IT, no mic, no word glosses. Tapping a chip
     mid-line used to start a second voice over the top of the first, and it
     also let a child answer before they had heard the question. */
  function setLocked(on) {
    inputLocked = !!on;
    $('lower').classList.toggle('locked', inputLocked);
    // #controls has not existed since the rebuild; the buttons live in #dock-side,
    // so the mic and the bin stayed live through every lock
    for (const el of document.querySelectorAll('#dock-side .btn')) el.disabled = inputLocked;
    /* A tray pill already sitting in a slot is disabled on its own account, so
       re-enabling every chip on unlock would offer the same word twice. Let
       the tray redraw itself instead of poking its buttons. */
    if (plan) { renderTray(); syncSay(); }
  }

  /* label by how many gaps there actually are, not by the level */
  function slotLabel(p) {
    const n = p.answer.length;
    if (!n) return '';
    if (n >= p.cells.length) return 'Build the whole sentence';
    return n === 1 ? 'Tap the missing word' : 'Tap the ' + n + ' missing words';
  }

  /* ---------- render ---------- */
  /* The number moving is the point of the turn, and it was changing silently
     in the corner. Fired deliberately when the child EARNS it, not whenever
     the reading happens to rise — the passive credit for hearing a phrase
     nudges it up at the start of every turn, and flashing for that would be
     congratulating them for nothing. */
  function pulseMastery() {
    const chip = $('mastery').closest('.mastery-pill'), rail = $('rail');
    chip.classList.remove('gained'); rail.classList.remove('gained');
    void chip.offsetWidth;                         // restart the animation
    chip.classList.add('gained'); rail.classList.add('gained');
    setTimeout(() => { chip.classList.remove('gained'); rail.classList.remove('gained'); }, 1200);
  }

  /* One rail segment per scene. Scenes behind you are full, the one you are in
     fills by how many of its phrases are usable, scenes ahead are empty — a
     scene counter and a progress bar in the same five pixels. */
  /* One room now, so the rail is no longer a map of the night. It shows how
     far through the session the child is — the mastery number in the corner
     already says how they are doing, and two bars saying the same thing told
     them nothing. */
  function buildRail() {
    const rail = $('rail');
    rail.innerHTML = '';
    const seg = document.createElement('span');
    seg.className = 'seg';
    seg.appendChild(document.createElement('i'));
    rail.appendChild(seg);
  }

  /* The session ends on mastery, not on a clock, so the rail shows how much of
     the scenario has been produced rather than how many turns have gone by. */
  function renderRail() {
    const fill = $('rail').firstChild && $('rail').firstChild.firstChild;
    if (!fill) return;
    fill.style.width = (E.overall(state, Q) * 100).toFixed(1) + '%';
  }

  /* A ui_string, in the child's own language, with {0} filled in. A string
     that is a plain string is the same in every language; one that is a map is
     looked up by native language and falls back to English. */
  function t(key, ...args) {
    const raw = Q.uiStrings[key];
    const s = (raw && typeof raw === 'object') ? (raw[NL()] || raw.en || '') : (raw || '');
    return args.reduce((acc, v, i) => acc.split('{' + i + '}').join(String(v)), s);
  }

  function renderHud() {
    renderRail();
    $('mastery').textContent = t('mastery-display-string', Math.round(E.overall(state, Q) * 100));
    $('coins').textContent = String(state.coins);
    $('t-obj').textContent = plan ? plan.pair.id : '—';
    $('t-scaf').textContent = plan
      ? (plan.frameTarget ? 'frame:target' : 'frame:native') +
        ' · ' + (plan.pair.hasSlot ? (plan.itemTarget ? 'word:target' : 'word:native') : 'no slot') +
        (plan.introducing ? ' · NEW ' + plan.introducing : '')
      : '—';
    $('t-turn').textContent = state.turn + '/' + Q.session.turnCap +
      (attempts ? '  attempt ' + (attempts + 1) : '');
  }

  /* Warm the voices for the scene we are about to play. Every clip is a Gemini
     call, so this is the current scene's own words only — not the whole quest
     — and it runs in the background. By the time the child reaches a phrase
     the audio is usually already in the cache and plays instantly. */
  let preloaded = false;
  function preloadScene() {
    if (preloaded) return;
    preloaded = true;
    /* Staggered, not a burst: a scenario's worth of TTS going out at once
       competes with the line the child is waiting to hear. */
    const seen = new Set(), queue = [];
    for (const p of Q.pairs) {
      for (const t of [p.allTarget, p.itemTarget]) {
        if (t && !seen.has(t)) { seen.add(t); queue.push(t); }
      }
    }
    queue.slice(0, 24).forEach((text, i) => setTimeout(() => V.prefetch(text, ACTOR), 1500 + i * 800));
  }

  async function renderTurn() {
    const pair = current;
    plan = E.planTurn(state, pair);
    E.seen(state, plan);
    /* Before the first lock, not after: setLocked redraws the pane, and with
       the new plan in place but last turn's pills still in `placed` it would
       draw one frame of the wrong answer. */
    clearAnswer();
    submitted = false;
    hideBanner();

    setLocked(true);
    $('turn-loading').classList.remove('hidden');
    preloadScene();

    /* Call one: the character. Nothing can be drawn until his line exists,
       because everything else this turn is a reaction to it. */
    const gen = await generateActorLine(plan);
    $('turn-loading').classList.add('hidden');

    const fb = fallbackLines(plan);
    const actorLine = gen ? gen.actorText : fb.actor_line;
    const actorFrags = gen && gen.chatHistory && gen.chatHistory[0]
      ? gen.chatHistory[0].messageFragments
      : toFragments(actorLine, newThing(plan) && newThing(plan).by === 'actor'
          ? [newThing(plan).target] : []);
    turnLine = actorLine;

    /* Call two: the coach, told what the character actually said. Fired now,
       awaited later — it has until his audio finishes, which is when the coach
       has always been allowed to speak. */
    const coachPending = generateCoachLine(plan, actorLine);

    mountBackground($('layer-bg'), Q.activity.background);
    mountCharacter($('character'), { character: ACTOR, state: 'idle' });

    hinted = false;
    attempts = 0;
    $('slot-label').textContent = slotLabel(plan);
    renderSlot();
    renderTray();
    setMic(false);
    $('verdict').textContent = '';
    $('verdict').className = '';
    renderHud();

    /* The order the epic fixes: character asks, coach hints, child answers.
       The coach's bubble waits for the character to finish speaking — posting
       both at once lets a child read the hint before they have heard the
       question. */
    V.stop();
    say(ACTOR, fragmentsHTML(actorFrags), actorLine, actorFrags);
    setLocked(true);
    const characterDone = V.say(actorLine, { speaker: ACTOR, lang: accentOf(ACTOR) });

    let coachShown = false;
    const showCoach = async () => {
      if (coachShown) return;
      coachShown = true;
      /* If the coach call is still out, wait for it — but not past the point
         where the child is staring at a silent screen. Whatever arrives first,
         the engine's own line is always ready as the floor. */
      const cg = await Promise.race([
        coachPending,
        new Promise(r => setTimeout(() => r(null), 2500)),
      ]);
      const coach = coachCopy(plan, cg);
      turnAsk = coach.askText;
      turnCoachHtml = coach.html;
      turnCoachFrags = coach.fragments;
      $('t-gen').textContent =
        (gen ? 'actor: gemini ' + lastGenMs + 'ms' : 'actor: template (' + lastGenWhy + ')') +
        ' · ' +
        (cg ? 'coach: gemini ' + lastCoachMs + 'ms' : 'coach: template (' + lastCoachWhy + ')');
      say('axel', coach.html, coach.askText, coach.fragments);
    };

    /* The retry path reposts the coach's bubble, so it must never be empty
       even if the child answers before the coach has spoken. */
    const floor = coachCopy(plan, null);
    turnAsk = floor.askText;
    turnCoachHtml = floor.html;
    turnCoachFrags = floor.fragments;

    characterDone.then(showCoach, showCoach);
    setTimeout(showCoach, 6000);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      setLocked(false);
      mountCharacter($('character'), { character: ACTOR, state: 'idle' });
    };
    V.say('').then(release);
    setTimeout(release, 12000);
  }

  /* ---------- who sounds like what ----------
     A character has ONE voice. Letting the line's language pick it meant the
     bartender answered in English with an English voice and in Spanish with a
     Spanish one — the same person, two accents, switching mid-conversation
     depending on how much of the sentence had crossed over. A Spaniard
     speaking English still sounds Spanish.

     The accent lives on the character in content, so a scenario set somewhere
     else brings its own. */
  function accentOf(who) {
    if (who === Q.activity.actor.id) return Q.activity.actor.accent || TL();
    if (who === 'axel') return Q.activity.coach.accent || NL();
    if (who === 'learner' || who === 'me') return Q.activity.coach.accent || NL();
    return NL();
  }

  /* The sentence with its gaps. Words already in the child's own language are
     printed; words that have crossed into the target language are theirs to
     supply. */
  /* ---------- the answer pane (NJA-3162) ----------
     `placed` is SLOT-INDEXED and sparse: placed[2] is whatever is sitting in
     the third gap, and a hole is a ghost. It used to be a push-list, which
     made "remove the wrong pill and leave the others where they are" (AC 8.3)
     impossible to express — taking one out shuffled every pill after it along
     by one, so fixing the third word appeared to break the fourth.

     `marks` is the judgement: null until they submit, then true or false per
     slot. A slot marked true is locked (AC 8.1). */
  function slotCount() { return plan && plan.expectedAnswerPills ? plan.expectedAnswerPills.length : 0; }
  function filledCount() { let n = 0; for (let i = 0; i < slotCount(); i++) if (placed[i] !== undefined) n++; return n; }
  function firstFreeSlot() { for (let i = 0; i < slotCount(); i++) if (placed[i] === undefined) return i; return -1; }
  function judged() { return marks.some(m => m !== null && m !== undefined); }

  function clearAnswer() {
    placed = new Array(slotCount());
    marks = new Array(slotCount()).fill(null);
  }

  /* AC 4: enabled only when every ghost slot is filled, disabled the moment it
     is pressed, and enabled again if they change their answer afterwards. The
     `submitted` latch is what makes a double- or triple-tap act once (AC 4.3)
     — `busy` alone unlatches too early, between the judgement and the
     character's reaction. */
  function syncSay() {
    $('btn-say').disabled = inputLocked || submitted || filledCount() !== slotCount() || slotCount() === 0;
  }

  function renderSlot() {
    const slot = $('slot');
    slot.className = '';
    slot.innerHTML = '';
    if (judged()) slot.classList.add(marks.every(m => m === true) ? 'judged-ok' : 'judged-bad');

    let g = 0;
    /* Runs of printed words are one span, not one per word: laid out as
       separate flex children, "Do you have" came out with a gap between every
       word, which reads as three words rather than a phrase. */
    let run = null;
    const flushRun = () => { if (run) { slot.appendChild(run); run = null; } };
    const pushWord = txt => {
      if (!run) { run = document.createElement('span'); run.className = 'frame'; run.textContent = txt; }
      else run.textContent += ' ' + txt;
    };

    for (const cell of plan.cells) {
      if (!cell.gap) { pushWord(cell.w); continue; }
      flushRun();
      const i = g++;
      if (placed[i] === undefined) {
        const e = document.createElement('span');
        e.className = 'gap';
        e.dataset.slot = String(i);
        slot.appendChild(e);
      } else {
        const b = document.createElement('button');
        b.className = 'chip placed' +
          (marks[i] === true ? ' right' : marks[i] === false ? ' wrong' : '');
        b.type = 'button';
        b.textContent = placed[i].label;
        b.dataset.slot = String(i);
        b.dataset.pill = placed[i].id;
        /* A pill judged right stays put. A pill judged wrong, or one not yet
           judged, comes back out and leaves a ghost behind it. */
        if (marks[i] !== true) {
          b.addEventListener('click', () => {
            if (inputLocked || dragMoved) return;
            placed[i] = undefined;
            marks[i] = null;
            submitted = false;           // AC 4.4
            renderSlot(); renderTray(); syncSay();
          });
        } else {
          b.disabled = true;
        }
        slot.appendChild(b);
      }
    }
    flushRun();
    syncSay();
  }

  /* NJA-3136 Engine step 6. The engine builds the list — answer words plus red
     herrings drawn first from items whose tags make them invalid for this slot
     — and shuffles it deterministically. The UI only draws it. */
  function renderTray() {
    const tray = $('tray');
    tray.innerHTML = '';
    /* Keyed on id, not on the word. Two pills reading "dog" are two pills, and
       telling them apart by counting matches was always going to come apart on
       the day a sentence had three of them. */
    const used = new Set();
    for (let i = 0; i < slotCount(); i++) if (placed[i] !== undefined) used.add(placed[i].id);
    for (const p of optionPills()) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = p.label;
      b.dataset.pill = p.id;
      if (used.has(p.id)) b.disabled = true;
      b.addEventListener('click', () => {
        /* NJA-3162 AC 8.4: a TAPPED option pill goes into the first free ghost
           slot. A DRAGGED one goes to the end (NJA-3161 AC 2) — the two
           tickets disagree and both are implemented as written. */
        if (inputLocked || dragMoved) return;
        place(p, firstFreeSlot());
      });
      tray.appendChild(b);
    }
  }

  /* One shuffled list per turn, so a re-render does not move the pill under
     the child's thumb mid-reach. */
  let optionCache = null, optionCacheKey = '';
  function optionPills() {
    const key = plan ? plan.pair.id + ':' + state.turn : '';
    if (optionCache && optionCacheKey === key) return optionCache;
    optionCacheKey = key;
    optionCache = E.pills(Q, state, plan);
    return optionCache;
  }

  function place(pill, at) {
    if (at < 0 || at >= slotCount()) return;
    placed[at] = pill;
    marks[at] = null;
    submitted = false;
    V.now(pill.label, { speaker: 'axel', lang: TL() });
    renderSlot(); renderTray(); syncSay();
  }


  /* ---------- dragging pills (NJA-3161, NJA-3178) ----------
     Pointer events, not HTML5 drag-and-drop: the latter does not fire on touch
     at all, which would leave this working on a laptop and dead on the phones
     the thing is actually for.

     One engine serves both tickets. A press that moves more than a few pixels,
     or is held past a moment, becomes a drag; anything shorter stays a tap, so
     NJA-3161 AC 1.3 and NJA-3178 AC 1.4 are the same rule read from two sides.

     Where a dragged pill lands differs by where it came from, because the two
     tickets say different things and both are the spec:
       from the tray  -> the END of the input (NJA-3161 AC 2)
       from the input -> the receiver under the pointer (NJA-3178 AC 2) */
  const DRAG_SLOP_PX = 6;       // further than this and it is a drag, not a tap
  const DRAG_HOLD_MS = 180;     // ...or longer than this, even without moving

  let drag = null;              // { pill, from, ghost, startX, startY, holdTimer }

  function pillFromEl(el) {
    const id = el.dataset.pill;
    if (!id) return null;
    const slot = el.dataset.slot;
    if (slot !== undefined && placed[Number(slot)]) return placed[Number(slot)];
    return optionPills().find(p => p.id === id) || null;
  }

  /* The floating copy that follows the finger. A clone rather than the pill
     itself, so the layout underneath does not jump the moment a drag starts. */
  function makeGhost(el, x, y) {
    const g = el.cloneNode(true);
    const r = el.getBoundingClientRect();
    g.className = 'chip drag-ghost';
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    g.dataset.dx = String(r.left - x);
    g.dataset.dy = String(r.top - y);
    document.body.appendChild(g);
    moveGhost(g, x, y);
    return g;
  }
  function moveGhost(g, x, y) {
    g.style.left = (x + Number(g.dataset.dx)) + 'px';
    g.style.top  = (y + Number(g.dataset.dy)) + 'px';
  }

  /* NJA-3178: every ghost slot has two receivers, a first half and a second
     half, and they touch — no gap between one slot's second receiver and the
     next slot's first, or a pill dropped on the seam lands nowhere. A final
     receiver takes the rest of the input. Built from the live geometry each
     time a drag starts, so it survives the pane reflowing. */
  function receivers() {
    const slot = $('slot');
    const box = slot.getBoundingClientRect();
    const out = [];
    for (const el of slot.querySelectorAll('[data-slot]')) {
      const i = Number(el.dataset.slot);
      const r = el.getBoundingClientRect();
      out.push({ at: i, half: 0, x1: r.left, x2: r.left + r.width / 2, y1: r.top, y2: r.bottom });
      out.push({ at: i, half: 1, x1: r.left + r.width / 2, x2: r.right, y1: r.top, y2: r.bottom });
    }
    /* ...and the rest of the field, so a drop in the empty space to the right
       is a drop at the end rather than a drop that does nothing. */
    const last = out[out.length - 1];
    if (last) out.push({ at: slotCount(), half: 0, x1: last.x2, x2: box.right, y1: last.y1, y2: last.y2 });
    return out;
  }

  function receiverAt(x, y) {
    const rs = receivers();
    /* Vertical bands first — the field wraps onto two lines on a narrow phone,
       and the nearest receiver by straight-line distance is then the one on
       the wrong row. */
    const onRow = rs.filter(r => y >= r.y1 - 6 && y <= r.y2 + 6);
    const pool = onRow.length ? onRow : rs;
    let best = null, bestD = Infinity;
    for (const r of pool) {
      const dx = x < r.x1 ? r.x1 - x : x > r.x2 ? x - r.x2 : 0;
      const dy = y < r.y1 ? r.y1 - y : y > r.y2 ? y - r.y2 : 0;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  /* Is this slot the child's to move? A pill judged right is settled — NJA-3162
     AC 8.1 says it can no longer be removed — so it neither travels nor gets
     shoved along by something dropped before it. Neither ticket says what
     should happen here; this is the reading that keeps 8.1 true. */
  const movable = i => marks[i] !== true;

  /* The slots a pill may occupy, in order. A locked pill is pinned to its own
     slot and is simply not in this list, so an insertion steps over it rather
     than shoving it along. */
  function movableSlots() {
    const out = [];
    for (let i = 0; i < slotCount(); i++) if (movable(i)) out.push(i);
    return out;
  }

  function applySequence(seq) {
    const ms = movableSlots();
    for (let k = 0; k < ms.length; k++) {
      const i = ms[k];
      const p = seq[k];
      if (placed[i] !== p) { placed[i] = p; marks[i] = null; }
    }
    submitted = false;
    renderSlot(); renderTray(); syncSay();
  }

  function lastFree() {
    for (let i = slotCount() - 1; i >= 0; i--) if (placed[i] === undefined && movable(i)) return i;
    return -1;
  }

  /* Reordering, NJA-3178 AC 3. Expressed as a remove-then-insert on the
     sequence of movable slots rather than as slot arithmetic, because the
     obvious slot version has a trap in it: clearing the pill's own slot first
     makes that slot look like one of AC 3.1's "ghost pills before the
     receiver", so every drag to the right bounced the pill straight back to
     where it started. The slot a pill is leaving is not a gap. */
  function dropInto(pill, rec, fromSlot) {
    const ms = movableSlots();
    const k = ms.indexOf(fromSlot);
    if (k < 0) return;

    /* AC 3.1 — a slot before the receiver that was ALREADY empty wins. */
    for (const i of ms) {
      if (i >= rec.at) break;
      if (i !== fromSlot && placed[i] === undefined) {
        const seq = ms.map(j => placed[j]);
        seq[k] = undefined;
        seq[ms.indexOf(i)] = pill;
        return applySequence(seq);
      }
    }

    /* AC 3.2-3.4 — otherwise take it out and put it back at the receiver,
       everything after it moving over one. */
    const seq = ms.map(j => placed[j]);
    let target = ms.filter(i => i < rec.at).length + (rec.half ? 1 : 0);
    seq.splice(k, 1);
    if (target > k) target -= 1;
    target = Math.max(0, Math.min(target, seq.length));
    seq.splice(target, 0, pill);
    while (seq.length < ms.length) seq.push(undefined);
    applySequence(seq.slice(0, ms.length));
  }

  function endDrag(x, y) {
    if (!drag) return;
    const { pill, from, ghost } = drag;
    if (ghost) ghost.remove();
    document.body.classList.remove('dragging');
    for (const el of document.querySelectorAll('.recv-hot')) el.classList.remove('recv-hot');

    if (drag.moved && pill) {
      if (from === null) {
        /* NJA-3161 AC 2: from the tray, always the end of the input. */
        const at = lastFree();
        if (at >= 0) { placed[at] = pill; marks[at] = null; submitted = false; }
        renderSlot(); renderTray(); syncSay();
        V.now(pill.label, { speaker: 'axel', lang: TL() });
      } else {
        const rec = receiverAt(x, y);
        if (rec) dropInto(pill, rec, from);
        else { renderSlot(); renderTray(); syncSay(); }
      }
    }
    const moved = drag.moved;
    drag = null;
    /* Let the click that follows this pointerup know it was a drag. Cleared on
       the next frame, after the click has been and gone. */
    dragMoved = moved;
    requestAnimationFrame(() => { dragMoved = false; });
  }

  function startDragMaybe(ev, el, from) {
    if (inputLocked) return;
    const pill = pillFromEl(el);
    if (!pill) return;
    if (from !== null && !movable(from)) return;     // a settled pill does not travel
    drag = { pill, from, ghost: null, moved: false, x: ev.clientX, y: ev.clientY,
             startX: ev.clientX, startY: ev.clientY, el };
    drag.holdTimer = setTimeout(() => { if (drag && !drag.moved) beginDrag(); }, DRAG_HOLD_MS);
    try { el.setPointerCapture(ev.pointerId); } catch {}
  }

  function beginDrag() {
    if (!drag || drag.moved) return;
    drag.moved = true;
    drag.ghost = makeGhost(drag.el, drag.x, drag.y);
    document.body.classList.add('dragging');
    if (drag.from !== null) drag.el.classList.add('lifted');
  }

  function onPointerMove(ev) {
    if (!drag) return;
    drag.x = ev.clientX; drag.y = ev.clientY;
    if (!drag.moved) {
      const far = Math.abs(ev.clientX - drag.startX) > DRAG_SLOP_PX ||
                  Math.abs(ev.clientY - drag.startY) > DRAG_SLOP_PX;
      if (!far) return;
      beginDrag();
    }
    ev.preventDefault();
    moveGhost(drag.ghost, ev.clientX, ev.clientY);
    /* Show where it would land, but only for an input drag — a tray drag has
       one destination and highlighting a receiver would be a lie. */
    for (const el of document.querySelectorAll('.recv-hot')) el.classList.remove('recv-hot');
    if (drag.from !== null) {
      const rec = receiverAt(ev.clientX, ev.clientY);
      if (rec) {
        const t = $('slot').querySelector('[data-slot="' + Math.min(rec.at, slotCount() - 1) + '"]');
        if (t) t.classList.add('recv-hot');
      }
    }
  }

  function wireDrag() {
    const onDown = ev => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const chip = ev.target.closest && ev.target.closest('.chip');
      if (!chip || chip.disabled) return;
      const inSlot = chip.closest('#slot');
      startDragMaybe(ev, chip, inSlot ? Number(chip.dataset.slot) : null);
    };
    $('tray').addEventListener('pointerdown', onDown);
    $('slot').addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', ev => {
      if (drag) clearTimeout(drag.holdTimer);
      endDrag(ev.clientX, ev.clientY);
    });
    document.addEventListener('pointercancel', () => {
      if (drag) { clearTimeout(drag.holdTimer); endDrag(-1, -1); }
    });
  }

  /* ---------- the turn loop ---------- */
  function step() {
    if (state.finished) return;
    if (E.sessionComplete(state, Q)) return finish('You got everything.');
    if (state.turn >= Q.session.turnCap) return finish('Time to head home.');
    const pair = E.pickNext(state, Q);
    if (!pair) return finish('You got everything.');
    current = pair;
    renderTurn();
  }

  /* The sentence as it stands, gaps filled with whatever they have tapped.
     This is what goes into the transcript as their message: claiming they said
     the whole target-language sentence when half of it was printed for them
     would be a lie the chat tells. */
  function builtSentence() {
    let g = 0;
    return plan.cells
      .map(c => {
        if (!c.gap) return c.w;
        const p = placed[g++];
        return p === undefined ? '…' : p.label;
      })
      .join(' ');
  }

  /* ---------- the result banner (NJA-3158) ---------- */
  function showBanner(kind) {
    const el = $('banner');
    el.querySelector('span').textContent =
      t(kind === 'good' ? 'answer-pane-correct-text' : 'answer-pane-incorrect-text');
    el.className = kind;
  }
  function hideBanner() { $('banner').className = 'hidden'; }

  /* The banner is a beat, not a status light. It comes down when the character
     has finished reacting — but a fast reply would flash it for 30ms and the
     child would never know their answer had been judged, so it holds for a
     readable minimum however quick the model is. */
  const BANNER_MIN_MS = 1300;
  const atLeast = (p, ms) => Promise.all([p, new Promise(r => setTimeout(r, ms))]);

  /* ---------- the character reacts ----------
     The beat the storyboard has between the answer and the next question: the
     one line in the whole exchange that is a reply to what the child ACTUALLY
     said rather than to what they were meant to say. Guarded like the others —
     it may not reach past the introduced words, and it may not say the child's
     own line back at them. */
  async function reactTo(said, wasCorrect) {
    if (!serverUp) return null;
    const j = await post('/api/react', Object.assign(turnBody(plan), {
      reactRules: Q.prompts.reactRules,
      actorLine: turnLine,
      childSaid: said,
      wasCorrect,
    }), REACT_DEADLINE_MS);
    if (j.fail || !j.actorText) return null;

    const allowed = introducedWords();
    if (auditLine(j.actorText, allowed).over > 0) return null;
    const mine = learnerOnlyWords();
    if (String(j.actorText).split(/\s+/).map(bare).some(w => w && mine.has(w))) return null;
    /* And it must not hand over the answer, which is the one thing a reaction
       to a wrong answer is most tempted to do. */
    if (E.norm(j.actorText).includes(E.norm(plan.expected))) return null;
    recentActor.push(j.actorText);
    return j;
  }

  async function sayReaction(said, wasCorrect) {
    const r = await reactTo(said, wasCorrect);
    if (!r) return;
    const frags = (r.chatHistory && r.chatHistory[0] && r.chatHistory[0].messageFragments)
      || toFragments(r.actorText);
    say(ACTOR, fragmentsHTML(frags), r.actorText, frags);
    await V.say(r.actorText, { speaker: ACTOR, lang: accentOf(ACTOR) });
  }

  async function submit(text, mode) {
    if (busy || !current || submitted) return;
    busy = true;
    submitted = true;
    $('btn-say').disabled = true;

    const said = builtSentence();
    /* The child's own sentence is not read back to them. It is a fresh line
       every time, so it is never cached — a Gemini TTS call, a download and a
       clip to sit through, all to hear words they just chose themselves, and
       all of it in front of the verdict they are actually waiting for. Tapping
       a pill still plays that word, which is the part that teaches. */

    /* The judgement. Per pill for the pane, and the same booleans collapse to
       the verdict for the engine — one source, so the banner and the mastery
       number can never say different things. */
    let v;
    if (mode === 'chips') {
      v = E.validate(placed, plan);
      marks = v.marks;
    } else {
      const ok = E.norm(text) === E.norm(plan.expectedAnswerPills.map(p => p.label).join(' '));
      v = { correct: ok };
      marks = new Array(slotCount()).fill(ok);
    }
    renderSlot();

    if (v.correct) {
      say('me', spanishHTML(said), said, null, 'right');
      const before = E.overall(state, Q);
      const ph = E.applyCorrect(state, plan, { hinted });
      if (E.overall(state, Q) > before + 1e-6) pulseMastery();
      showBanner('good');
      $('verdict').textContent = '';
      $('t-delta').textContent = plan.pair.id + ' · pattern ' + ph.pattern +
        (ph.item ? ' · word ' + ph.item : '');
      mountCharacter($('character'), { character: ACTOR, state: 'pose' });
      renderHud();
      recordTurn(plan, turnLine, turnAsk, true);

      /* No separate reaction bubble on the way out. The bartender served the
         child and then immediately spoke again to open the next turn, which is
         two bubbles for one breath — and because the reaction was in the
         history by then, his next line tended to repeat it word for word
         ("Here's your agua." / "Here's your agua. You also want un refresco?").
         His acknowledgement belongs in the same sentence as what he says next,
         which is what the actor prompt already asks him for. The reaction call
         survives only where there IS no next line: a wrong answer, where the
         turn does not advance. */
      setLocked(true);
      await new Promise(r => setTimeout(r, BANNER_MIN_MS));
      hideBanner();
      busy = false;
      step();
      return;
    }

    /* "Incorrect answer handling - UI goes red, pal repeats phrase and user
       tries again until they get it right." Taken literally that never ends,
       so after a few tries the coach says it for them and the exchange moves
       on — uncredited, so the pair comes back. */
    say('me', spanishHTML(said), said, null, 'wrong');
    const { attempts: n } = E.applyWrong(state, plan);
    attempts = n;
    hinted = true;
    renderHud();

    if (E.mercyDue(state)) {
      recordTurn(plan, turnLine, turnAsk, false);
      hideBanner();
      $('verdict').textContent = '— ' + COACH + ' says it for you: ' + plan.expected;
      await V.say(plan.expected, { speaker: 'axel', lang: accentOf('axel') });
      E.applyMercy(state, plan);
      setTimeout(() => { busy = false; submitted = false; step(); }, 1200);
      return;
    }

    showBanner('bad');
    $('verdict').textContent = '';
    $('verdict').className = 'bad';

    /* The character reacts ONCE, on the first miss. He has nothing new to say
       on the third attempt at the same sentence, and four generated shrugs in
       a row is a worse experience than one plus the coach repeating himself. */
    setLocked(true);
    await atLeast(attempts === 1 ? sayReaction(said, false) : Promise.resolve(), BANNER_MIN_MS);
    hideBanner();

    /* "pal repeats phrase" — the SAME bubble, formatting and all. Re-posting
       the plain text ran the new-word badge back into the sentence as prose,
       so the repeat read worse than the line it was repeating. */
    if (attempts === 1) say('axel', esc(t('coach-retry')), t('coach-retry'));
    say('axel', turnCoachHtml, turnAsk, turnCoachFrags);

    /* Wrong pills stay on screen, marked, and come out when tapped. Clearing
       the whole answer meant a child who got three words of four right had to
       find all four again, which reads as being punished for the near miss. */
    setLocked(false);
    submitted = false;
    renderSlot();
    renderTray();
    syncSay();
    busy = false;
  }

  function finish(msg) {
    state.finished = true;
    E.track(state, 'session_end', { turns: state.turn, overall: E.overall(state, Q) });
    const pats = Object.values(state.patterns).filter(E.mastered).length;
    const its  = Object.values(state.items).filter(E.mastered).length;
    $('end-msg').textContent = msg;
    $('end-score').textContent = pct(E.overall(state, Q));
    $('end-sub').textContent = pats + ' of ' + Object.keys(state.patterns).length +
      ' phrases and ' + its + ' of ' + Object.keys(state.items).length +
      ' words · ' + state.coins + ' coins';
    $('end').classList.remove('hidden');
  }

  /* ---------- mic ---------- */
  const micAvailable = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function setMic(on) {
    micOn = on;
    $('mic-panel').classList.toggle('hidden', !on);
    $('tray').style.display = on ? 'none' : '';
    $('slot').style.display = on ? 'none' : '';
    $('slot-label').style.display = on ? 'none' : '';
    $('btn-mic').classList.toggle('on', on);
    $('btn-say').style.display = on ? 'none' : '';
    $('btn-clear').style.display = on ? 'none' : '';
    if (!on && recog) { try { recog.stop(); } catch {} recog = null; }
  }

  function toggleMic() {
    if (micOn) { setMic(false); return; }
    if (!micAvailable()) { $('verdict').textContent = 'No speech recognition in this browser — keep tapping.'; return; }
    V.stop();
    setMic(true);
    $('mic-heard').textContent = '';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new SR();
    recog.lang = TL() === 'es' ? 'es-ES' : 'en-GB';
    recog.interimResults = true;
    recog.continuous = false;
    recog.onresult = ev => {
      let txt = '';
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      $('mic-heard').textContent = txt;
      if (ev.results[ev.results.length - 1].isFinal) { setMic(false); submit(txt, 'voice'); }
    };
    recog.onerror = () => { setMic(false); $('verdict').textContent = 'Didn’t catch that — try tapping instead.'; };
    recog.onend = () => { if (micOn) setMic(false); };
    try { recog.start(); } catch { setMic(false); }
  }

  /* ---------- sheets ---------- */
  function openCoach() {
    if (!plan) return;
    hinted = true;
    const p = plan.pair;
    const rows = [
      ['WHAT TO SAY', esc(p.allNative)],
      ['RIGHT NOW', '<b>' + esc(plan.expected) + '</b>'],
      ['ALL IN ' + TL().toUpperCase(), esc(p.allTarget)],
    ];
    if (p.hasSlot) rows.push(['THE WORD', esc(p.item.target) + ' &middot; ' + esc(p.item.native)]);
    $('coach-rungs').innerHTML = rows
      .map(([k, v]) => `<div class="rung"><span class="k">${k}</span><span class="v">${v}</span></div>`)
      .join('');
    $('coach-sheet').classList.remove('hidden');
    E.track(state, 'hint_opened', { pair: p.id });
    V.now(plan.expected, { speaker: 'axel', lang: accentOf('axel') });
  }

  /* The session summary, in the epic's own terms: PPP. Everything the child
     has met sits in one of three states — presented, practising, produced —
     and the counts behind each are what the engine actually decided on. */
  function openProgress() {
    const body = $('prog-body');
    body.innerHTML = '';

    const head = t => {
      const h = document.createElement('div');
      h.className = 'scene-h';
      h.innerHTML = `<b>${esc(t)}</b><span></span>`;
      body.appendChild(h);
    };
    const row = (main, sub, rec) => {
      const ph = E.phase(rec);
      const label = { present: 'new', practice: 'practising', produce: 'can use' }[ph];
      const n = rec.correct + rec.incorrect;
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML =
        `<div class="l"><span class="t">${esc(main)}</span><span class="m">${esc(sub)}</span></div>` +
        `<div class="r"><span class="pct">${n ? Math.round(E.ratio(rec) * 100) + '%' : '—'}</span>` +
        `<span class="pill ${label.replace(' ', '')}">${label}</span></div>`;
      body.appendChild(r);
    };

    head('Phrases');
    for (const pid of Q.activity.patterns) {
      const rec = state.patterns[pid];
      if (!rec) continue;
      const pat = Q.vocabPatterns[pid];
      row(pat[TL()].replace(/\{[^}]+\}/g, '___'),
          pat[NL()].replace(/\{[^}]+\}/g, '___') +
          (rec.exposures ? `  ·  seen ${rec.exposures}, right ${rec.correct}, wrong ${rec.incorrect}` : ''),
          rec);
    }

    head('Words');
    for (const iid of Q.activity.items) {
      const rec = state.items[iid];
      if (!rec) continue;
      const it = Q.vocabItems[iid];
      row(it[TL()].indefinite, it[NL()].indefinite +
          (rec.exposures ? `  ·  seen ${rec.exposures}, right ${rec.correct}, wrong ${rec.incorrect}` : ''),
          rec);
    }

    $('prog-overall').textContent = pct(E.overall(state, Q));
    $('prog-sheet').classList.remove('hidden');
  }

  /* ---------- boot ---------- */
  let dragWired = false;

  async function boot() {
    state = E.createState(Q);
    preloaded = false;
    if (!dragWired) { wireDrag(); dragWired = true; }
    E.track(state, 'session_start', { activity: Q.activity.id, native: NL(), target: TL() });
    chatLog.length = 0;
    $('chat').innerHTML = '';
    buildRail();
    hideGloss();
    $('chat-full').classList.add('hidden');
    $('t-mode').textContent = NL() + ' \u2192 ' + TL() + ' · ' + Q.pairs.length + ' pairs';
    preloadRigs();                    // loads behind the title screen
    await titleScreen();
    if (!(await probeServer())) {   // locked: ask for the code, then re-probe
      await unlockGate();
      await probeServer();
    }
    $('btn-mic').style.opacity = micAvailable() ? '' : '.4';
    step();
  }

  $('btn-say').addEventListener('click', () => submit(builtSentence(), 'chips'));
  /* The bin clears what is still in play. A pill already judged right is not
     in play — it is part of the sentence now — so it stays. */
  $('btn-clear').addEventListener('click', () => {
    if (inputLocked) return;
    for (let i = 0; i < slotCount(); i++) if (marks[i] !== true) { placed[i] = undefined; marks[i] = null; }
    submitted = false;
    renderSlot(); renderTray(); syncSay();
  });
  $('btn-mic').addEventListener('click', toggleMic);
  $('btn-pause').addEventListener('click', openProgress);
  $('coach-close').addEventListener('click', () => $('coach-sheet').classList.add('hidden'));
  $('prog-close').addEventListener('click', () => $('prog-sheet').classList.add('hidden'));
  $('btn-restart').addEventListener('click', () => { $('end').classList.add('hidden'); boot(); });

  $('gloss-close').addEventListener('click', hideGloss);
  $('gloss-say').addEventListener('click', () => V.now(glossWord, { speaker: 'axel', lang: TL() }));

  $('btn-expand').addEventListener('click', () => {
    renderChatFull();
    $('chat-full').classList.remove('hidden');
  });
  $('chat-close').addEventListener('click', () => $('chat-full').classList.add('hidden'));

  function syncSound() {
    $('sound-label').textContent = V.isEnabled() ? 'SOUND ON' : 'SOUND OFF';
  }
  $('btn-sound').addEventListener('click', () => { V.setEnabled(!V.isEnabled()); syncSound(); });
  syncSound();

  // diagnostics are not part of the game; ?debug=1 brings them back
  if (/[?&]debug=1/.test(location.search)) $('test-strip').classList.remove('hidden');

  // iOS will not play audio until a gesture; the first touch anywhere opens it
  document.addEventListener('pointerdown', () => V.unlock(), { once: true });

  /* The on-screen character's mouth moves for exactly as long as the line
     plays — server voice or browser fallback, both resolve through the same
     queue. Axel coaching from his bubble does not move the bouncer, and the
     learner echo moves nobody. No attempt to match visemes to words: the ask
     was a talking loop, not lip sync. */
  let mouthTimer = null;
  V.onSpeaking((speaker, on) => {
    if (!current) return;
    const who = ACTOR;
    if (speaker !== who) return;
    clearTimeout(mouthTimer);
    const set = st => mountCharacter($('character'), { character: who, state: st });
    // Back-to-back lines land stop-then-start in the same tick; dropping to
    // idle for one frame between them reads as a twitch, so settling is lazy.
    if (on) set('speak'); else mouthTimer = setTimeout(() => set('idle'), 160);
  });

  // scriptable view of the same numbers the test strip shows
  window.__DEBUG = {
    plan: () => plan, pair: () => current, state: () => state,
    locked: () => inputLocked,
    pills: () => optionPills(),
    introduced: () => [...introducedWords()],
    chatHistory: () => chatLog.map(e => ({ role: e.role, messageFragments: e.messageFragments })),
    events: () => state.events,
    marks: () => marks.slice(),
    accent: who => accentOf(who),
    placed: () => Array.from({ length: slotCount() }, (_, i) => placed[i]),
    banner: () => { const b = document.getElementById('banner'); return b.className === 'hidden' ? null : { kind: b.className, text: b.textContent.trim() }; },
  };

  boot();
})();
