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

  let state, current = null, plan = null, scaf = 0, placed = [], hinted = false, hints = 0;
  let inputLocked = false;
  let turnLine = '', turnAsk = '';        // this turn's actual words, for the history
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

     xMidYMax slice: the clips are 1920x1080 with the figure centred, and the
     slot is portrait. Anchoring to the bottom keeps the character standing on
     the stage floor and crops the empty sides instead of shrinking them in. */
  const ANIM = {
    axel:    { idle: 'anim/axel-idle.json',    speak: 'anim/axel-talk.json' },
    bouncer: { idle: 'anim/bouncer-idle.json', speak: 'anim/bouncer-talk.json' },
  };
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
        path: src[key], rendererSettings: { preserveAspectRatio: 'xMidYMax slice' },
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

    // only speak has its own clip; intro, outro and pose sit on idle for now
    const want = st === 'speak' ? 'speak' : 'idle';
    for (const key of ['idle', 'speak']) {
      const c = rig.clips[key];
      c.el.hidden = key !== want;
      if (key === want) c.play(); else c.pause();
    }
  }
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
  const recentLines = [];
  const history = [];          // what has actually been said in this scene

  /* §10: the whitelist is absolute and outranks the scaffold, and it has two
     tiers here.

     GLOSSABLE is every word the game can explain — the glossary plus every
     chip in the quest. A word outside it is one the child can tap and get
     nothing back, so it must never reach the screen at all. (This is what the
     hand-written openings are built from, which is why the first version of
     this guard threw them away too.)

     DRILL is the quest's own vocabulary — the words the child is actually
     tested on. §10's "at most two new words per turn" is about these: meeting
     a third drill word in a line you cannot answer yet is load, not exposure.

     Everything else in GLOSSABLE is scene glue (§8: "already-mastered words may
     appear as scene glue only") — sí, qué, hola. It is tappable, never tested,
     and does not count against the cap. Counting it did: the first version of
     this guard threw away the game's own hand-written openings. */
  let GLOSSABLE = null;
  function glossable() {
    if (GLOSSABLE) return GLOSSABLE;
    GLOSSABLE = new Set(Object.keys(Q.glossary || {}).map(bare));
    for (const it of E.allItems(Q)) for (const w of (it.chips || [])) GLOSSABLE.add(bare(w));
    return GLOSSABLE;
  }

  let DRILL = null;
  function drillWords() {
    if (DRILL) return DRILL;
    DRILL = new Set();
    for (const it of E.allItems(Q)) for (const w of (it.chips || [])) DRILL.add(bare(w));
    return DRILL;
  }

  function metWords(item) {
    const out = new Set(item.chips || []);
    for (const it of E.allItems(Q)) for (const w of (it.chips || [])) if (E.wordSeen(state, w)) out.add(w);
    return [...out];
  }

  /* §6, applied to the CHARACTER's line and not only the coach's. The support
     level is a rule about how much of the child's own language the turn leans
     on, and at the bottom of the ladder that means the person in front of them
     is understood in English with one Spanish word in it — "the meaning
     carried in the support language; the target word appears once, glossed".
     A short but fully Spanish line was still a wall to a child on their very
     first turn, which is what this got wrong. */
  const SCENE_RULES = [
    { native: true,  maxTarget: 1 },    // L0: their language, ONE target word
    { native: true,  maxTarget: 3 },    // L1: their language, target words dropped in
    { native: false, maxWords: 8 },     // L2: target language, one short aside
    { native: false, maxWords: 12 },    // L3: target language, framing only
    { native: false, maxWords: 16 },    // L4: no support language at all
  ];
  const sceneRule = n => SCENE_RULES[n] || SCENE_RULES[SCENE_RULES.length - 1];

  // a word spelled like the target language: inverted punctuation or Spanish
  // diacritics. Used to spot invented vocabulary inside an English line.
  const looksForeign = tok => /[¿¡]/.test(tok) || /[áéíóúñü]/i.test(tok);

  /* Spanish words that are also ordinary English words. They are in the
     glossary because the characters use them, but finding one in a line is no
     evidence the line is Spanish: "No entry without an entrada" is English,
     and counting its "no" pushed it over a limit that allows one Spanish word.
     Everywhere the game asks "how much of this line is the target language",
     these are the words that do not answer it. */
  const AMBIGUOUS = new Set(['a', 'no', 'me', 'son', 'solo', 'nada', 'van',
                             'mira', 'pasa', 'o', 'es', 'la', 'el', 'te',
                             'tu', 'mi', 'y', 'en', 'con', 'toma']);
  const countsAsTarget = (tok, vocab) => {
    const w = bare(tok);
    return looksForeign(tok) || (vocab.has(w) && !AMBIGUOUS.has(w));
  };

  function audit(text, met) {
    const known = new Set((met || []).map(bare));
    const can = glossable();
    const drill = drillWords();
    let unglossable = 0, fresh = 0, words = 0, target = 0, targetish = 0, foreign = 0;
    for (const tok of String(text).split(/\s+/)) {
      const w = bare(tok);
      if (!w) continue;
      words += 1;
      if (!can.has(w)) {
        unglossable += 1;
        if (looksForeign(tok)) foreign += 1;
      } else {
        target += 1;
        if (countsAsTarget(tok, can)) targetish += 1;
        if (drill.has(w) && !known.has(w)) fresh += 1;
      }
    }
    return { words, unglossable, fresh, target, targetish, foreign };
  }

  /* How long the child may be made to wait for a generated line. There is a
     hand-written one in content.js that is always correct, so past this point
     the model has nothing to offer that is worth a spinner. */
  const TURN_DEADLINE_MS = 4500;
  let lastGenMs = 0, lastGenWhy = 'template';

  async function generateTurn(scene, item, scaffold) {
    if (!serverUp) { lastGenWhy = 'no server'; return null; }
    const met = metWords(item);
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TURN_DEADLINE_MS);
    try {
      const r = await fetch('/api/turn', {
        signal: ctl.signal,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: scene.onScreen.character,
          characterNote: scene.onScreen.character === 'axel' ? 'a bubbly teenage punk musician, the coach' : '',
          sceneTitle: scene.title, sceneSpeaks: scene.onScreen.speaks,
          sceneGoal: scene.goal || '',
          target: item.target, native: item.native, scaffold,
          sceneMode: sceneRule(scaffold).native ? 'native' : 'target',
          maxSceneWords: sceneRule(scaffold).maxWords || 0,
          maxSceneTargetWords: sceneRule(scaffold).maxTarget || 0,
          nativeLang: NL(), targetLang: TL(),
          allowed: met, glossable: [...glossable()],
          history: history.slice(-4), recent: recentLines.slice(-6)
        })
      });
      if (!r.ok) { lastGenWhy = 'http ' + r.status; return null; }
      const j = await r.json();
      lastGenMs = Date.now() - t0;
      if (!j || !j.coach_ask || !j.scene_line) {
        lastGenWhy = j && j.error ? 'error' : 'empty';
        return null;
      }

      /* The prompt states both rules; a model still drifts, so they are
         enforced here where it costs nothing. A rejected turn falls back to
         the hand-written opening in content.js, which is always safe. */
      if (scene.onScreen.speaks !== 'native') {
        const rule = sceneRule(scaffold);
        const a = audit(j.scene_line, met);
        if (a.fresh > 2) { lastGenWhy = 'too many new words'; return null; }
        if (rule.native) {
          // mostly their own language, with the target word dropped into it
          if (a.targetish > rule.maxTarget) { lastGenWhy = 'too much target language'; return null; }
          if (a.targetish >= a.words)       { lastGenWhy = 'no support language'; return null; }
          if (a.foreign > 0)             { lastGenWhy = 'invented word'; return null; }
        } else {
          if (a.words > rule.maxWords) { lastGenWhy = 'too long'; return null; }
          if (a.unglossable > 0)       { lastGenWhy = 'unglossable word'; return null; }
        }
      } else if (looksTargetLanguage(j.scene_line, 1)) {
        // A character speaking the child's own language gets NO latitude: one
        // Spanish word is one too many. Models love opening on "¡Hola!".
        lastGenWhy = 'wrong language';
        return null;
      }

      recentLines.push(j.coach_ask);
      return j;
    } catch (e) {
      lastGenMs = Date.now() - t0;
      lastGenWhy = (e && e.name === 'AbortError') ? 'timed out' : 'unreachable';
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* What the character says when the generated line was rejected or never
     arrived. One hand-written sentence per scene meant every such turn looked
     identical — three turns of "¿Sí? ¿Tienes entrada?" in a row, which is what
     made the drill read as a loop rather than a conversation. These rotate,
     and never repeat the line that is already on screen. */
  const lastFallback = new Map();
  function fallbackLine(scene, scaffold) {
    const native = sceneRule(scaffold).native;
    const set = (scene.lines && scene.lines[native ? 'native' : 'target']) ||
                [native && scene.openingNative ? scene.openingNative : scene.opening];
    const key = scene.id + '|' + (native ? 'n' : 't');
    const prev = lastFallback.get(key);
    let i = (state.turn + scene.id.length) % set.length;
    if (set.length > 1 && set[i] === prev) i = (i + 1) % set.length;
    lastFallback.set(key, set[i]);
    return set[i];
  }

  function recordTurn(scene, item, line, ask, produced) {
    history.push({
      character: scene.onScreen.character,
      said: line, coached: ask,
      wanted: item.target, got: produced ? 'the child said it' : 'not yet'
    });
    if (history.length > 8) history.shift();
  }

  /* ---------- what the coach says ----------
     The ASK is always present, always in the native language: at no level is
     the learner left guessing what they are supposed to communicate.
     The MODEL is the Spanish, and that is what gets withdrawn as they climb. */
  /* §6 makes the scaffold a rule about SUPPORT LANGUAGE, not just about how
     many chips are blank: L0-L3 all keep the framing in the child's own
     language, and only L4 withdraws it. The generator is told this, but a
     model drifts — it handed back an all-Spanish ask on a rung that should
     have been English, which is what made turn three unreadable. So the ask is
     checked before it is used, and a drifting one falls back to the template. */
  let TL_VOCAB = null;                        // built on first use: bare() is defined below
  function targetVocab() {
    if (TL_VOCAB) return TL_VOCAB;
    TL_VOCAB = new Set();
    for (const sc of Q.scenes) for (const it of sc.items) {
      for (const w of (it.chips || [])) TL_VOCAB.add(bare(w));
      for (const w of (it.distractors || [])) TL_VOCAB.add(bare(w));
    }
    for (const k of Object.keys(Q.glossary || {})) TL_VOCAB.add(bare(k));
    return TL_VOCAB;
  }

  function looksTargetLanguage(text, limit = 2) {
    if (/[¿¡]/.test(text)) return true;                       // inverted punctuation
    if (/[áéíóúñü]/i.test(text)) return true;               // Spanish diacritics
    const v = targetVocab();
    const hits = String(text).split(/\s+/).filter(t => countsAsTarget(t, v));
    return hits.length >= limit;    // in a hint, one shared word ("a") is coincidence
  }

  function coachCopy(item, scaffold, p, gen) {
    /* The same item comes round several turns running while it climbs, and one
       fixed coachLine made those turns read as the same screen repeated. */
    const set = item.coachLines && item.coachLines.length ? item.coachLines : [item.coachLine];
    const template = set[(state.turn + item.id.length) % set.length] + ' “' + item.native + '”';
    let ask = gen && gen.coach_ask ? gen.coach_ask : template;
    if (scaffold <= 3 && looksTargetLanguage(ask)) ask = template;
    /* The coach used to print the Spanish underneath — the answer, in blue,
       next to the box you type it into. With decoys in the tray that is not a
       hint, it is the answer key, and the choice it turns the turn into is
       "copy the words above" rather than "which of these is a ticket".
       The coach says what to say and in which language it is wanted; the
       Spanish itself is one tap away on his avatar, where taking it is priced
       (§4 hint damping) instead of free. */
    return { askText: ask, html: esc(ask) };
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

  /* Only words the game can explain become blue and tappable. Lines are mixed
     now — at the lowest rung a character speaks the child's own language with
     one target word in it — and making "Have" or "you" tappable would offer a
     translation that does not exist. */
  function spanishHTML(text) {
    const can = glossable();
    return String(text).split(/(\s+)/).map(tok => {
      if (!tok.trim()) return tok;
      if (!can.has(bare(tok))) return esc(tok);
      return '<button type="button" class="w" data-w="' + esc(tok) + '">' + esc(tok) + '</button>';
    }).join('');
  }

  /* ---------- the conversation ----------
     One continuous log for the whole night, oldest fading out at the top. Each
     entry is kept as data so the full-screen view can re-render it, and so the
     child's own answers sit in the same history as everything said to them. */
  const chatLog = [];

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
                    (entry.who === 'axel' ? ' coach' : '') + (opts.enter ? ' enter' : '');
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

  function say(who, html, text) {
    chatLog.push({ who, html, text: text || '' });
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
    $('gloss-mean').textContent = gloss(word) || '—';
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
    for (const el of document.querySelectorAll('#tray .chip, #controls .btn')) el.disabled = inputLocked;
    if (!inputLocked) $('btn-say').disabled = placed.length !== plan.gaps;
  }

  /* label by how many gaps there actually are, not by the level */
  function slotLabel(p, n) {
    if (p.gaps >= n) return 'Build the whole sentence';
    return p.gaps === 1 ? 'Tap the missing word' : 'Tap the ' + p.gaps + ' missing words';
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
  function buildRail() {
    const rail = $('rail');
    rail.innerHTML = '';
    for (let i = 0; i < Q.scenes.length; i++) {
      const seg = document.createElement('span');
      seg.className = 'seg';
      seg.appendChild(document.createElement('i'));
      rail.appendChild(seg);
    }
  }

  function renderRail() {
    const segs = $('rail').children;
    for (let i = 0; i < Q.scenes.length; i++) {
      const fill = segs[i] && segs[i].firstChild;
      if (!fill) continue;
      let pctDone = 0;
      if (i < state.sceneIndex) pctDone = 1;
      else if (i === state.sceneIndex) {
        const items = Q.scenes[i].items;
        const done = items.filter(it => E.itemScore(state, it) >= Q.session.canUseBar).length;
        pctDone = items.length ? done / items.length : 0;
      }
      fill.style.width = (pctDone * 100).toFixed(1) + '%';
    }
  }

  function renderHud() {
    const o = E.overall(state, Q);
    renderRail();
    $('mastery').textContent = 'Mastery: ' + pct(o);
    $('coins').textContent = String(state.coins);
    $('t-obj').textContent = current ? current.item.id : '—';
    $('t-scaf').textContent = current ? 'L' + scaf + ' (' + plan.gaps + ' gap' + (plan.gaps > 1 ? 's' : '') + ')' : '—';
    $('t-turn').textContent = state.turn + '/' + Q.session.turnBudget;
  }

  /* Warm the voices for the scene we are about to play. Every clip is a Gemini
     call, so this is the current scene's own words only — not the whole quest
     — and it runs in the background. By the time the child reaches a phrase
     the audio is usually already in the cache and plays instantly. */
  let preloadedScene = -1;
  function preloadScene() {
    const scene = E.sceneOf(Q, state);
    if (!scene || preloadedScene === state.sceneIndex) return;
    preloadedScene = state.sceneIndex;
    /* Staggered, not fired as one burst. A scene's worth of clips going out
       together competes with the lines the child is waiting to hear right now,
       and a rate-limited TTS call backs off for seconds. */
    const queue = [];
    for (const it of scene.items) {
      queue.push([it.target, 'axel']);
      for (const w of (it.chips || [])) queue.push([w, 'axel']);
    }
    queue.forEach(([text, who], i) => setTimeout(() => V.prefetch(text, who), 1200 + i * 700));
  }

  async function renderTurn() {
    const { scene, item } = current;
    const scaffold = scaf = E.scaffoldFor(state, item);
    plan = E.buildPlan(item, scaffold);
    E.noteShown(state, item, plan.gaps);
    const nativeSpeaker = scene.onScreen.speaks === 'native';

    // The generator is a network round trip. Hold the panel and say so, rather
    // than leaving the previous turn live and tappable underneath.
    setLocked(true);
    $('turn-loading').classList.remove('hidden');
    preloadScene();
    const gen = await generateTurn(scene, item, scaffold);
    $('turn-loading').classList.add('hidden');
    $('t-gen').textContent = gen
      ? 'generator: gemini ' + lastGenMs + 'ms'
      : 'generator: template (' + lastGenWhy + (lastGenMs ? ', ' + lastGenMs + 'ms' : '') + ')';
    const coach = coachCopy(item, scaffold, plan, gen);
    const sceneLine = gen ? gen.scene_line : fallbackLine(scene, scaffold);

    mountBackground($('layer-bg'), scene.background);
    /* Mounted idle, not speaking. The mouth is driven by VOICE.onSpeaking,
       which now fires when the audio actually starts — setting 'speak' here
       had the character talking to themselves through the whole fetch. */
    mountCharacter($('character'), { character: scene.onScreen.character, state: 'idle' });

    /* The stage box belongs to whoever is on screen; the coach box below
       belongs to Axel. In the opening scene Axel is both, so he speaks from
       the stage and still coaches from the bottom — one rule, no special
       case for who happens to be standing there. */
    turnLine = sceneLine;
    turnAsk = coach.askText;

    /* §3 passive exposure, +0.05 to the WORDS only. It used to be conditional
       on the coach printing the model, which also made the app's numbers drift
       from the simulation that checks them. The child meets this turn's words
       either way — in the character's line and on the chips — so the credit is
       a property of the turn. */
    {
      const d = E.creditHeardItem(state, item);
      if (d) pushDelta(d);
    }

    placed = [];
    hinted = false;
    hints = 0;
    $('slot-label').textContent = slotLabel(plan, item.chips.length);
    renderSlot();
    renderTray();
    setMic(false);
    $('verdict').textContent = '';
    $('verdict').className = '';
    renderHud();

    // Speak the turn — queued, never awaited. The screen is usable immediately;
    // a child who already knows the answer does not wait for the audio.
    /* One voice per turn: the character's. The coach's line is read, not
       heard — it is a hint sitting next to the answer box, and hearing it
       spoken made the turn a wall of audio the child had to sit through. The
       Spanish in it is still tappable, and SAY IT still reads their sentence
       back, so nothing is lost that they cannot ask for. */
    V.stop();
    say(scene.onScreen.character, nativeSpeaker ? esc(sceneLine) : spanishHTML(sceneLine), sceneLine);
    const characterDone = V.say(sceneLine, {
      speaker: scene.onScreen.character, lang: nativeSpeaker ? NL() : TL()
    });

    /* The coach's message joins the conversation once the character has
       finished speaking. Posting both at once let a child read the hint before
       they had heard the question. */
    let coachShown = false;
    const showCoach = () => {
      if (coachShown) return;
      coachShown = true;
      say('axel', coach.html, coach.askText);
    };
    characterDone.then(showCoach);
    setTimeout(showCoach, 6000);   // a voice that never arrives must not hide the hint

    // V.say('') returns the queue with this turn's lines already on it. The
    // panel unlocks when they have all played — or after a ceiling, because a
    // voice that never arrives must not strand the child behind it.
    setLocked(true);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      setLocked(false);
      mountCharacter($('character'), { character: scene.onScreen.character, state: 'idle' });
    };
    V.say('').then(release);
    setTimeout(release, 12000);
  }

  /* The sentence in order: a gap is theirs to fill in the target language,
     anything else is still shown in their own. That is what makes the English
     drain away one chunk per rung instead of the whole frame flipping to
     Spanish the moment they get one answer right. */
  function renderSlot() {
    const slot = $('slot');
    slot.classList.remove('ok');
    slot.innerHTML = '';

    let g = 0;
    for (const cell of plan.cells) {
      if (cell.lead) {
        const c = document.createElement('span');
        c.className = 'frame hug';
        c.textContent = cell.lead;
        slot.appendChild(c);
      }
      if (!cell.gap) {
        const f = document.createElement('span');
        f.className = 'frame';
        if (/^[,.;:!?]/.test(cell.native)) f.classList.add('hug');
        f.textContent = cell.native;
        slot.appendChild(f);
        continue;
      }
      const i = g++;
      if (placed[i] === undefined) {
        const e = document.createElement('span');
        e.className = 'gap';
        slot.appendChild(e);
        continue;
      }
      const b = document.createElement('button');
      b.className = 'chip placed';
      b.type = 'button';
      b.textContent = placed[i];
      b.addEventListener('click', () => {
        if (inputLocked) return;
        placed.splice(i, 1); renderSlot(); renderTray();
      });
      slot.appendChild(b);
    }
    $('btn-say').disabled = placed.length !== plan.gaps;
  }

  function renderTray() {
    const tray = $('tray');
    tray.innerHTML = '';
    // only the words still needed, plus decoys — never the words already locked in
    const needed = plan.answer.slice();
    /* §8: "already-mastered words may appear as scene glue only", and §10 caps
       new words per turn. A decoy the child has never met is a word they are
       being asked to rule out without ever having been taught it, so the pool
       is everything they have already produced or heard — nothing else. The
       tray is simply shorter early on, which is correct. */
    const rest = (current.item.distractors || []).filter(w => !needed.includes(w));
    /* Words they have already met make the better decoys, so those come first
       — but a tray holding only the right answer is not a question, and turn
       one had exactly that. Unmet words fill up the rest. They are quest
       vocabulary and every one of them is glossed, so a child who does not
       recognise "una bebida" can tap it and find out rather than guess. */
    const pool = [...rest.filter(w => E.wordSeen(state, w)),
                  ...rest.filter(w => !E.wordSeen(state, w))];
    /* The dock wraps now, so every chip is on screen — which also means the
       dock is as tall as the number of chips. Five is what fits in two rows on
       a small phone; past that the panel starts eating the stage. When the
       child is building a whole sentence they already have three chips to
       order, and ordering is the difficulty at that rung, not telling a ticket
       from a beer — so the decoys give way rather than the answer. */
    const MAX_CHIPS = 5;
    const room = Math.max(1, MAX_CHIPS - needed.length);
    const decoys = pool.slice(0, Math.min(E.DISTRACTORS_AT[scaf] ?? 2, room));
    const all = [...needed, ...decoys];
    const words = all
      .map((w, i) => ({ w, k: (i * 7 + state.turn * 13 + w.length * 3) % all.length }))
      .sort((a, b) => a.k - b.k).map(x => x.w);

    const used = placed.slice();
    for (const w of words) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = w;
      const i = used.indexOf(w);
      if (i >= 0) { used.splice(i, 1); b.disabled = true; }
      b.addEventListener('click', () => {
        if (inputLocked || placed.length >= plan.gaps) return;
        placed.push(w);
        V.now(w, { speaker: 'axel', lang: TL() });
        renderSlot(); renderTray();
      });
      tray.appendChild(b);
    }
  }

  function pushDelta(d) {
    const sign = d.to > d.from ? '+' : d.to < d.from ? '−' : '±';
    $('t-delta').textContent = d.label + ' ' + pct(d.from) + '→' + pct(d.to) +
      ' (' + sign + Math.abs(d.to - d.from).toFixed(2) + ', ' + d.why + ')';
  }

  /* ---------- turn loop ---------- */
  function step() {
    if (state.finished) return;
    if (state.turn >= Q.session.turnBudget) return finish('Time to head home.');

    const scene = E.sceneOf(Q, state);
    if (!scene) return finish('That’s the whole night.');

    // the scene clock: slow is not the same as wrong, and everyone sees the gig
    if (!E.sceneDone(state, scene, Q) && E.sceneOverBudget(state, Q)) E.oweRemaining(state, scene, Q);

    if (E.sceneDone(state, scene, Q)) {
      E.advanceScene(state);
      if (state.sceneIndex >= Q.scenes.length) return finish('That’s the whole night.');
      if (state.sceneIndex === Q.scenes.length - 1) E.reopenOwed(state);
      return step();
    }

    const next = E.pickNext(state, Q);
    if (!next) { E.advanceScene(state); return step(); }
    current = next;
    renderTurn();
  }

  /* The sentence as it currently stands in the slot, gaps filled with whatever
     the child has put there. At L0 that is their own language around one
     Spanish chunk, which is the point of the rung — and it is what goes into
     the conversation as their message, because claiming they said the whole
     Spanish sentence on turn one would be a lie the transcript tells. */
  function builtSentence() {
    let g = 0;
    return plan.cells
      .map(c => (c.lead ? c.lead + ' ' : '') + (c.gap ? (placed[g++] || '…') : c.native))
      .join(' ').replace(/\s+([,.!?])/g, '$1');
  }
  const fullSentence = builtSentence;

  /* What gets read aloud on SAY IT: always the complete sentence, never the
     fragment the child tapped. The gaps are always the trailing chips, so the
     words in front of them come from the item whether or not the rung shows
     them — at L0 the slot holds one word and the frame is in English, and the
     child still hears the whole Spanish line. Right answer reads the target
     (so the punctuation and accents are the real ones); a wrong one reads back
     what they actually built, which is the point of hearing it. */
  /* The echo reads back what is IN THE SLOT, in whatever languages that is.
     At L0 that is the child's own language around one Spanish word — "Can I
     have una entrada, please?" — the sentence they actually built. Reading
     them a full Spanish sentence they never wrote was the coach modelling,
     not an echo, and it made the rung feel harder than it is. */
  function spokenSentence() {
    if (plan.mode !== 'native-frame' && E.checkGaps(placed, plan, current.item).target_produced)
      return current.item.target;
    return builtSentence();
  }
  // mixed lines are led by their frame; this only steers the browser fallback
  function spokenLang() { return plan.mode === 'native-frame' ? NL() : TL(); }

  async function submit(text, mode) {
    if (busy || !current) return;
    busy = true;
    $('btn-say').disabled = true;

    const item = current.item;

    // Always the whole sentence, never just the words they filled in — the
    // point is to hear the finished thing, even at the one-word rungs.
    if (mode === 'chips') V.now(spokenSentence(), { speaker: 'learner', lang: spokenLang() });

    const res = mode === 'chips' ? E.checkGaps(placed, plan, item) : await evaluateSpoken(text, item);

    if (res.target_produced) {
      /* Their answer goes into the log as their message — from the right, with
         their own avatar. Only correct ones: the transcript is the
         conversation that actually happened, not a list of attempts. */
      const said = builtSentence();
      say('me', spanishHTML(said), said);

      const before = E.overall(state, Q);
      const d = E.applyCorrect(state, item, { mode, hinted, hints });
      pushDelta(d);
      if (E.overall(state, Q) > before + 1e-6) pulseMastery();
      $('slot').classList.add('ok');
      $('verdict').textContent = '✓ ' + (hinted ? 'nice — that’s it' : 'spot on');
      $('verdict').className = 'good';
      mountCharacter($('character'), { character: current.scene.onScreen.character, state: 'pose' });
      renderHud();
      recordTurn(current.scene, item, turnLine, turnAsk, true);
      setTimeout(() => { busy = false; step(); }, 900);
      return;
    }

    const d = E.applyWrong(state, item);
    pushDelta(d);
    renderHud();

    if (E.mercyDue(state, item, Q)) {
      const m = E.applyMercy(state, item);
      pushDelta(m);
      recordTurn(current.scene, item, turnLine, turnAsk, false);
      $('verdict').textContent = '— Axel says it for you: ' + item.target;
      await V.say(item.target, { speaker: 'axel', lang: TL() });
      setTimeout(() => { busy = false; step(); }, 1200);
      return;
    }

    hinted = true;
    hints += 1;
    const why = {
      word_order: 'Right words, wrong order.', missing_word: 'Something’s missing.',
      wrong_word: 'Not quite.', typo: 'So close.', native_fallback: 'In Spanish this time.', none: 'Almost.'
    }[res.error_type] || 'Almost.';
    $('verdict').textContent = '✗ ' + why + ' Say it like this: ' + item.target;
    $('verdict').className = '';
    V.say(item.target, { speaker: 'axel', lang: TL() });
    placed = [];
    renderSlot();
    renderTray();
    busy = false;
  }

  function finish(msg) {
    state.finished = true;
    // the 50/50 blend, not the pattern ledger alone — §2
    const done = E.allItems(Q).filter(it => E.itemScore(state, it) >= Q.session.canUseBar).length;
    $('end-msg').textContent = msg;
    $('end-score').textContent = pct(E.overall(state, Q));
    $('end-sub').textContent = done + ' of ' + Object.keys(state.items).length +
      ' phrases you can use · ' + state.coins + ' coins';
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
    if (!current) return;
    const item = current.item;
    hinted = true;
    hints += 1;
    const scaffold = scaf;
    $('coach-rungs').innerHTML =
      `<div class="rung"><span class="k">WHAT TO SAY</span><span class="v">${esc(item.native)}</span></div>` +
      `<div class="rung"><span class="k">IN SPANISH</span><span class="v"><b>${esc(item.target)}</b></span></div>` +
      `<div class="rung"><span class="k">WORD BY WORD</span><span class="v">${item.chips.map(esc).join(' &middot; ')}</span></div>` +
      `<div class="rung"><span class="k">SUPPORT LEVEL</span><span class="v">L${scaffold} &mdash; ` +
      `${['one word, English frame', 'one word, Spanish frame', 'fill the gaps', 'whole sentence', 'whole sentence, no model'][scaffold]}</span></div>`;
    $('coach-sheet').classList.remove('hidden');
    V.now(item.target, { speaker: 'axel', lang: TL() });
  }

  function openProgress() {
    const body = $('prog-body');
    body.innerHTML = '';
    Q.scenes.forEach((sc, i) => {
      const status = i < state.sceneIndex ? 'DONE' : i === state.sceneIndex ? 'HERE' : 'LOCKED';
      const h = document.createElement('div');
      h.className = 'scene-h';
      h.innerHTML = `<b>${i + 1} · ${esc(sc.title)}</b><span>${status}</span>`;
      body.appendChild(h);
      sc.items.forEach(it => {
        const st = state.items[it.id];
        const score = E.itemScore(state, it);
        const lb = E.label(score, st.exposures > 0, Q);
        const r = document.createElement('div');
        r.className = 'row' + (i > state.sceneIndex ? ' locked' : '');
        r.innerHTML =
          `<div class="l"><span class="t">${esc(it.target)}</span><span class="m">${esc(it.native)}</span></div>` +
          `<div class="r"><span class="pct">${pct(score)}</span><span class="pill ${lb.replace(' ', '')}">${lb}</span></div>`;
        body.appendChild(r);
      });
    });
    $('prog-overall').textContent = pct(E.overall(state, Q));
    $('prog-sheet').classList.remove('hidden');
  }

  /* ---------- boot ---------- */
  async function boot() {
    state = E.createState(Q);
    preloadedScene = -1;
    chatLog.length = 0;
    $('chat').innerHTML = '';
    buildRail();
    hideGloss();
    $('chat-full').classList.add('hidden');
    $('t-mode').textContent = 'evaluator: local · voice: browser';
    preloadRigs();                    // loads behind the title screen
    await titleScreen();
    if (!(await probeServer())) {   // locked: ask for the code, then re-probe
      await unlockGate();
      await probeServer();
    }
    $('btn-mic').style.opacity = micAvailable() ? '' : '.4';
    step();
  }

  $('btn-say').addEventListener('click', () => submit(fullSentence(), 'chips'));
  $('btn-clear').addEventListener('click', () => { if (!inputLocked) { placed = []; renderSlot(); renderTray(); } });
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
    const who = current.scene.onScreen.character;
    if (speaker !== who) return;
    clearTimeout(mouthTimer);
    const set = st => mountCharacter($('character'), { character: who, state: st });
    // Back-to-back lines land stop-then-start in the same tick; dropping to
    // idle for one frame between them reads as a twitch, so settling is lazy.
    if (on) set('speak'); else mouthTimer = setTimeout(() => set('idle'), 160);
  });

  // scriptable view of the same numbers the test strip shows
  window.__DEBUG = {
    plan: () => plan, item: () => current && current.item, state: () => state,
    audit: (text, item) => audit(text, metWords(item || (current && current.item) || { chips: [] })),
  };

  boot();
})();
