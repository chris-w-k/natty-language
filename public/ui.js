/* ui.js — screens, chips, mic, coach, voice cues.
   Holds no scoring logic: every number comes from ENGINE.
   Three stacked layers so the reskin is assets + tokens. */

(function () {
  /* The language pair is chosen on the first screen (NJA-3204: it is a
     session input, not a constant), so the whole content object is rebuilt
     when it changes. Everything below reads Q at call time rather than
     capturing bits of it. */
  let Q = window.QUEST;
  const C = window.CONTENT;
  function setPair(nativeCode, targetCode) {
    Q = C.build(nativeCode, targetCode);
    window.QUEST = Q;
    return Q;
  }
  const E = window.ENGINE;
  const V = window.VOICE;
  /* The NovaPals app, when there is one on the other side of the webview.
     Inert in a plain browser, so nothing below has to ask which it is in. */
  const B = window.BRIDGE;
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
  const COACH = Q.activity.coach.name;   // the activity itself does not change with the pair
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
    /* The room is chosen by data attribute rather than by a class list, so the
       CSS reads as "this is what venue-bar looks like" and a scenario with a
       background nobody has drawn yet simply shows none. */
    el.dataset.bg = key;
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
      voiceWatch();
      /* NJA-3172. The key comes from the server, so a checkout or a stub run
         has none and sends nothing — which is the ticket's "fixtures should
         not fire analytics events" for a prototype with no fixtures. */
      if (!analyticsStarted) {
        analyticsStarted = true;
        window.ANALYTICS.init(Object.assign(
          { activityId: Q.activity.id }, (j && j.analytics) || {}));
        /* Which side of the webview this is. Set once, as a super-property, so
           every event — the NovaPals.* ones and the $screen ones alike — can be
           split by it without each call site having to remember. */
        window.ANALYTICS.register({ in_webview: B.inApp });
      }
      return true;
    } catch { serverUp = false; return true; }
  }

  /* ---------- title ----------
     Also the audio gesture: iOS will not play a sound until the user has
     touched something, so START doubles as the unlock and the child never
     meets a silent first turn. */
  /* ---------- the intro ----------
     Title, Axel, taxi, then the night itself. Three panels on one backdrop,
     and one continuous piece of audio across them: the street bed comes up on
     the title, carries through Axel, and crosses over to the room tone during
     the taxi ride — which is also, quietly, where the server gets probed, so
     the five seconds is doing something real rather than only counting. */
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function tapAnywhere(el) {
    return new Promise(resolve => {
      const go = () => { SFX.play('tap'); el.removeEventListener('pointerdown', go); resolve(); };
      el.addEventListener('pointerdown', go);
    });
  }

  /* Axel on the intro gets his OWN lottie rather than the game's rig. The
     game's mountCharacter expects the scene's label elements, keeps one rig
     per character in a shared map and crops to the top half — all correct in
     the venue and all wrong on a title card, where he is the whole picture and
     nothing else is on stage. */
  let introRig = null;
  function introAxel() {
    const host = $('intro-axel');
    if (introRig || typeof window.lottie === 'undefined') return;
    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'rig';
    host.appendChild(root);
    /* Both clips, the way the scene builds a character: his mouth has to move
       while he talks, and one idle loop cannot do that. They sit on top of
       each other and only one is ever shown. */
    const clips = {};
    try {
      for (const key of ['idle', 'speak']) {
        const box = document.createElement('div');
        box.className = 'clip';
        root.appendChild(box);
        clips[key] = window.lottie.loadAnimation({
          container: box, renderer: 'svg', loop: true, autoplay: false,
          path: ANIM.axel[key],
          rendererSettings: { preserveAspectRatio: 'xMidYMax slice' },
        });
        clips[key].el = box;
      }
      introRig = { root, clips };
      introMouth(false);
    } catch { introRig = null; }
  }

  /* Swap the clip. Settling back to idle is lazy for the same reason it is in
     the scene: two lines back to back stop and start in the same tick, and
     dropping to idle for one frame between them reads as a twitch. */
  let introMouthTimer = null;
  function introMouth(speaking) {
    if (!introRig) return;
    const want = speaking ? 'speak' : 'idle';
    for (const key of ['idle', 'speak']) {
      const c = introRig.clips[key];
      if (!c) continue;
      c.el.hidden = key !== want;
      if (key === want) c.play(); else c.pause();
    }
  }

  function dropIntroAxel() {
    clearTimeout(introMouthTimer);
    try { for (const k of ['idle', 'speak']) introRig && introRig.clips[k] && introRig.clips[k].destroy(); } catch {}
    introRig = null;
    $('intro-axel').innerHTML = '';
  }

  function showPanel(id) {
    for (const p of document.querySelectorAll('#intro .intro-panel')) p.classList.add('hidden');
    $(id).classList.remove('hidden');
  }

  /* ---------- picking the pair (NJA-3204) ----------
     startSession takes nativeLanguage and targetLanguage, so the direction is
     a choice rather than a build-time constant. The screen offers every
     language the content names, with the ones it has no words for disabled —
     a language going live is a content edit and nothing here changes.

     ?native= / ?target= set it without the screen, which is how the headless
     tests run both directions. */
  /* ?lang= is the app's spelling: the NovaPals webview host knows which
     language the child speaks, and that is the HINT language here — what the
     scenario teaches follows from it. ?native=/?target= stay as the explicit
     pair, for walkthroughs and the headless tests. Neither one skips the
     picker any more; they decide which chip it opens on. */
  function paramPair() {
    const q = new URLSearchParams(location.search);
    const lang = (q.get('lang') || '').slice(0, 5).toLowerCase();
    const n = q.get('native') || (lang && C.covered.includes(lang) ? lang : '');
    const t = q.get('target') || (n && !q.get('target') && lang === n ? C.learns() : '');
    if (!n && !t) return null;
    return { native: n || Q.nativeLang, target: t || Q.targetLang };
  }

  /* The language the phone is set to, if this scenario can teach out of it.
     navigator.languages is the ordered list the child's device reports — a
     phone set to Spanish with English second gives ['es-US','en-US'], so the
     first match in order is the one they actually read in. Region is dropped:
     es-US, es-419 and es-ES are all Spanish to us.

     This was always meant to be here — the note on lang-pick-* has said "in
     the real build it follows the device locale" since the picker was written.
     It matters more than it looked: of the children arriving on a non-English
     phone, 30% were choosing English on that screen, which hands them hints in
     a language they do not read and teaches them Spanish instead. They
     finished at a quarter the rate of the ones who got it right. */
  function deviceLang() {
    const list = (navigator.languages && navigator.languages.length
      ? navigator.languages : [navigator.language || '']);
    /* Hintable, not covered: a phone set to English cannot answer this
       question, because English is what the scenario teaches. It is also weak
       evidence — of the children on an English phone, more than one in five
       went and chose something else, which is a device language that is not
       the language they read in. Those get asked rather than assumed. */
    const can = C.hintable();
    for (const tag of list) {
      const code = String(tag).slice(0, 2).toLowerCase();
      if (can.includes(code)) return code;
    }
    return null;
  }

  /* Where the pair came from, in order of authority: the URL (a walkthrough,
     or the app passing ?lang=), then the phone, then the content's default.
     The SOURCE is kept, not just the answer — it decides whether the picker is
     shown at all, and it goes out with the analytics so the next read of this
     screen is about something other than guesswork. */
  let langSource = 'default';
  function startingPair() {
    const p = paramPair();
    if (p && C.covered.includes(p.native) && C.covered.includes(p.target) && p.native !== p.target) {
      langSource = 'url';
      return p;
    }
    const device = deviceLang();
    if (device) {
      langSource = 'device';
      return { native: device, target: C.learns() };
    }
    langSource = 'default';
    return C.defaultPair();
  }

  /* One question, not two. The learner picks the language their hints are in
     — the one they already speak — and what the scenario teaches follows from
     it, because a scenario teaches one thing and does not need picking.
     Asking twice made the second answer a formality with one possible value,
     and made it possible to pick a pair the content could not teach. */
  function pickLanguages() {
    const opening = startingPair();
    let hint = opening.native;

    /* Asked only when nothing else can answer it. The screen was shown to
       everyone so a child in the wrong language could put it right — and the
       numbers say it did the opposite: on a non-English phone, three in ten
       were choosing English, which is this screen being read as "which
       language do you want to learn" rather than "which do you already
       speak". It is asked in English, before a language is known, so that
       reading is a fair one.

       So when the URL or the phone already answers it, it is not asked. The
       picker stays for the case it was built for: a device in a language this
       scenario cannot teach out of, where there is a real question and no
       default worth trusting. */
    if (langSource !== 'default') {
      apply(opening);
      return Promise.resolve();
    }

    $('lang-title').textContent = t('lang-pick-title') || 'HINT LANGUAGE';
    $('lang-sub').textContent = t('lang-pick-sub') || '';
    /* The hint language opens on something real rather than nothing: a device
       we could not use still tells us the content's own default. */
    if (!C.hintable().includes(hint)) hint = C.defaultPair().native;
    $('lang-go').querySelector('span').textContent = t('lang-pick-go') || 'START';

    return new Promise(resolve => {
      draw();
      $('lang-go').addEventListener('click', () => {
        if (!C.covered.includes(hint)) return;
        langSource = 'picker';
        apply({ native: hint, target: C.learns() });
        /* This click is the gesture the browser wants before any audio. */
        V.unlock(); SFX.unlock();
        resolve();
      });

      function draw() {
        const row = $('lang-native');
        row.innerHTML = '';
        /* Only the languages a child can take hints in. English is not among
           them: it is what the scenario teaches, and offering it here was
           offering the one answer that inverts the whole night. */
        const offer = C.languages.filter(l => C.hintable().includes(l.code));
        for (const lang of offer) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'lang-chip';
          b.dataset.code = lang.code;
          b.setAttribute('aria-pressed', String(hint === lang.code));
          /* The flag is what a child recognises before they can read the
             name, so it leads and the name confirms it. */
          b.innerHTML = '<span class="fl" aria-hidden="true">' + esc(lang.flag || '') + '</span>' +
                        '<span class="nm">' + esc(lang.name) + '</span>';
          b.addEventListener('click', () => { hint = lang.code; draw(); });
          row.appendChild(b);
        }
        /* The direction, drawn rather than described: the chosen language, an
           arrow, English. This screen is in English and is shown to children
           who may not read it, so the sentence under the heading is the part
           they are least likely to get — the arrow is not. */
        const chosen = offer.find(l => l.code === hint);
        $('lang-way').innerHTML = chosen
          ? '<span class="from">' + esc(chosen.flag || '') + ' ' + esc(chosen.name) + '</span>' +
            '<span class="arrow" aria-hidden="true">→</span>' +
            '<span class="to">🇬🇧 ' + esc(C.name(C.learns())) + '</span>'
          : '';
        const missing = C.languages.filter(l =>
          l.code !== C.learns() && !C.covered.includes(l.code));
        $('lang-note').textContent = missing.length
          ? (t('lang-pick-missing') || 'No words yet for {0}.')
              .split('{0}').join(missing.map(l => l.name).join(', '))
          : '';
        $('lang-go').disabled = !C.hintable().includes(hint);
      }
    });

    function apply(p) {
      setPair(p.native, p.target);
      $('t-mode').textContent = p.native + ' \u2192 ' + p.target + ' \u00b7 ' + Q.pairs.length + ' pairs';
    }
  }

  /* Returns whatever probeServer() resolved to, because boot needs it and the
     taxi ride is the natural place to have found out. */
  async function intro() {
    const el = $('intro');
    /* The app's loading overlay is up until this lands, and everything below
       — the probe, a cold Render instance, the content build — can take long
       enough that a child would be looking at a spinner with no end. So it
       goes out first, before anything slow or fallible, and repeats. */
    B.ready();
    /* Deliberately a function, not a value: the copy belongs to the hint
       language, and the hint language is not known until pickLanguages() has
       run and setPair() has rebuilt Q. Reading it once at the top of intro()
       gave every child the English screen. */
    const copyOf = () => (Q.activity.intro || {});

    /* ?intro=0 goes straight to the night. Five seconds of taxi is right once
       and tiresome on the fortieth run, so anyone working on the game itself —
       or a headless test that is not about the intro — can skip it. The room
       tone still starts, because that is part of the game rather than part of
       the intro. */
    if (/[?&]intro=0/.test(location.search)) {
      /* No screen, but ?native=/?target= still decide the direction — that is
         how the headless tests play the night both ways round. */
      const p = paramPair();
      if (p && p.native !== p.target &&
          C.covered.includes(p.native) && C.covered.includes(p.target)) {
        setPair(p.native, p.target);
      }
      const ok = await probeServer();
      SFX.bed('room', 'audio/loading.mp3', { volume: 0.12, fade: 1200 });
      return ok;
    }

    el.classList.remove('hidden');

    /* First screen: which way round is this session? The whole content object
       is rebuilt from the answer (NJA-3204), so it comes before the title
       card and before anything that reads a pattern. */
    showPanel('intro-langs');
    SCREEN.at('Hint Language');
    await pickLanguages();

    /* Now the hint language is settled, so the screens can be written. */
    const copy = copyOf();
    $('intro-title-text').textContent = copy.title || Q.title || '';
    $('intro-sub').textContent = copy.sub || '';
    $('intro-tap-1').textContent = copy.tap || 'Tap to continue';
    $('intro-tap-2').textContent = copy.tap || 'Tap to continue';
    $('intro-bubble').textContent = copy.coach || '';

    showPanel('intro-title');
    SCREEN.at('Title');

    /* The street bed starts with the title card, not after the tap. Autoplay
       rules may refuse it before any gesture — SFX.unlock() below retries every
       bed on the first pointerdown — but where the browser allows it the music
       is already there when the title appears, which is the point of a title
       card. */
    SFX.bed('street', 'audio/title.mp3', { volume: 0.55, fade: 1400 });

    /* The probe starts NOW, under the title card, not on the taxi ride. Until
       it answers, VOICE has not been told the server is there and falls back
       to the browser's own synthesis — so Axel's first line, the one that
       introduces him, came out in a stock system voice instead of his. The
       title screen is a second or two of human time; that is where this
       belongs. */
    const probe = probeServer();

    /* The gesture that starts the audio is the same tap that opens the title,
       so the bed is asked for after it rather than before — a bed requested
       before any gesture is a paused element and a silent first screen. */
    await tapAnywhere(el);
    V.unlock(); SFX.unlock();

    showPanel('intro-coach');
    SCREEN.at('Coach Intro');
    /* The room tone begins its climb here, under Axel, rather than waiting for
       the taxi. By the time the ride starts it is already present, so the
       cross on the loading screen finishes a fade rather than starting one —
       the club is somewhere you are arriving at, not somewhere that switches
       on when you get there. */
    SFX.bed('room', 'audio/loading.mp3', { volume: 0.30, fade: 6000 });
    introAxel();
    /* ...and his line waits for the probe, so it is his voice that says it.
       Nothing else waits: the child can tap straight through, and V.stop()
       below cuts him off mid-sentence the way a real person gets cut off. */
    probe.then(() => V.say(copy.coach || '', { speaker: 'axel', lang: accentOf('axel') }));
    await tapAnywhere(el);
    V.stop();

    /* No taxi ride. Five seconds of travelling was a nice beat once and a toll
       on every session after it, and in a quest it is five seconds of a child's
       attention spent on a progress bar. Axel's screen hands straight over to
       the night, with the street fading under the room rather than across a
       screen of its own.

       The probe is still waited on here rather than raced: until it answers,
       VOICE has not been told the server is there and the bartender's first
       line comes out in a stock system voice. It has had the title card and
       the whole of Axel's line to resolve, so on a warm instance this is
       already settled, and on a cold one Axel's screen is a better place to
       wait than a loading bar. */
    SFX.level('street', 0, 900);
    SFX.level('room', 0.5, 900);
    const ok = await probe;
    SFX.fadeOut('street', 300);
    /* ...and the room tone stays, well under the talking. */
    SFX.level('room', 0.12, 1800);

    el.classList.add('hidden');
    dropIntroAxel();
    return ok;
  }

  /* ---------- access code ----------
     The token comes back as an HttpOnly cookie, so nothing is stored here and
     nothing is attached to later calls; they just carry it same-origin. */
  function unlockGate() {
    return new Promise(resolve => {
      const sheet = $('gate'), input = $('gate-code'), msg = $('gate-msg');
      /* The gate is the error screen this prototype has: the night cannot
         start, and the child is looking at a wall instead of a bar. */
      SCREEN.at('Access Gate');
      AN('NovaPals.Activity.Error', { reason: 'locked' });
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

  /* The mirror of the above: every word this scenario can say in the CHILD'S
     language. Used to spot a sentence that is half one language and half the
     other, which is a thing only a model writes and never a thing anyone
     says. Rebuilt with the pair, like everything else keyed on a language. */
  let NATIVE_WORDS = null, nativeWordsFor = null;
  function nativeWords() {
    if (NATIVE_WORDS && nativeWordsFor === Q) return NATIVE_WORDS;
    nativeWordsFor = Q;
    const out = new Set();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    for (const id of Q.activity.items)
      for (const f of Q.forms) add(Q.vocabItems[id][NL()][f]);
    for (const id of Q.activity.patterns)
      if (Q.vocabPatterns[id][NL()]) add(Q.vocabPatterns[id][NL()].replace(/\{[^}]+\}/g, ' '));
    NATIVE_WORDS = out;
    return out;
  }

  /* A quoted sentence that mixes the two languages. The coach is allowed to
     quote the child's own language (that is the meaning) and allowed to quote
     the target (that is the answer, when it is introducing it) — but
     "Di: «¿Me das water?»" is neither: it is the native frame with a target
     word dropped in, told to a child as a thing to say. Copying it teaches
     them a sentence that is wrong in both languages. Cheaper to catch here
     than to trust a prompt not to do it. */
  function mixedQuote(text) {
    const quotes = String(text).match(/[“"«]([^”"»]{2,})[”"»]/g) || [];
    for (const q of quotes) {
      let target = 0, native = 0;
      for (const tok of q.split(/\s+/)) {
        const w = bare(tok);
        if (!w || AMBIGUOUS.has(w)) continue;
        /* Deliberately NOT countsAsTarget: that one also counts a token as
           target because it LOOKS foreign — an inverted question mark or an
           accent — which was written when the target was always Spanish. Here
           that reads "¿Tienes una entrada?" as a target sentence and flags the
           child's own language as a mix. Membership of the two vocabularies is
           the only test that survives the pair being reversed. */
        if (glossable().has(w)) target += 1;
        else if (nativeWords().has(w)) native += 1;
      }
      if (target && native) return q;
    }
    return null;
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
  /* Which words of a line are the child's own, said back at them. Uses the
     same ambiguity test as everything else that decides whether a token is
     really in the target language: "¿Me das" puts "me" on the learner-only
     list, and without this the bartender could never again say "run that by
     me" — an English word thrown away for colliding with a Spanish one. */
  function stolenWords(text) {
    const mine = learnerOnlyWords();
    return String(text).split(/\s+/)
      .filter(tok => {
        const w = bare(tok);
        if (!w || !mine.has(w)) return false;
        return looksForeign(tok) || !AMBIGUOUS.has(w);
      })
      .map(bare);
  }

  function learnerOnlyWords() {
    const out = new Set();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    for (const [id, rec] of Object.entries(state.patterns))
      if (rec.introduced && Q.vocabPatterns[id].speaker === 'learner')
        add(Q.vocabPatterns[id][TL()].replace(/\{[^}]+\}/g, ' '));
    /* ...and whatever the child is being asked to produce RIGHT NOW. A
       construction marked `either` is fair game for the character on any other
       turn, but not on the turn the child has to say it: the bartender asking
       "¿Tienes una entrada?" has just said the answer out loud, and the child
       is left repeating him rather than producing anything. He sets the
       exchange up and stops; the coach supplies the hint.

       The ITEM is not covered, deliberately. Vocabulary comes from the
       character (NJA-3136) — "una entrada" is his to hand over. It is the
       FRAME that is the child's to produce this turn. */
    for (const w of thisTurnsFrame()) out.add(w);
    for (const w of itemWords()) out.delete(w);
    return out;
  }

  /* The target-language words of the construction this turn is asking for,
     empty on a turn that is only asking for a word. */
  function thisTurnsFrame() {
    const out = new Set();
    if (!plan || !plan.frameTarget || !plan.pair) return out;
    const frame = String((plan.pair.frame && plan.pair.frame.target) || '');
    for (const w of frame.replace(/___/g, ' ').split(/\s+/)) {
      const k = bare(w);
      if (k) out.add(k);
    }
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
      /* The word for THIS step's slot, which with two slots is not always the
         first one — the plan names the key it is teaching. */
      const it = (plan.pair.items || []).find(i => i.key === plan.introKey)
              || (plan.pair.items || [])[0];
      if (!it) return null;
      return { kind: 'item', by: 'actor', target: it.target, means: it.native };
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

  /* ---------- are the target-language words put together correctly? ----------
     Auditing word by word is not enough. "un" and "una" are both on the
     allowed list the moment two items have been met, and "refresco" is too —
     so "una refresco" passes a per-word check and is still wrong, and a child
     is being taught a gender agreement that does not exist.

     The content holds every phrase it can teach. So a run of target-language
     words in a character's line has to decompose into phrases the content
     actually contains: "¿Tienes una entrada?" is the frame part plus the item,
     both real; "una refresco" is neither, and no segmentation of it exists.

     This is the deterministic invariant applied one level up. The model writes
     the dialogue; it does not get to assemble the target language. */
  const phraseKeyOf = t => String(t || '').toLowerCase()
    .replace(/[¿?¡!.,;:"“”]/g, ' ').replace(/\s+/g, ' ').trim();

  function badPhrases(text) {
    const table = Q.phrases || {};
    const toks = String(text).split(/\s+/).filter(Boolean);
    const vocab = glossable();
    const bad = [];
    let run = [];
    const flush = () => {
      if (run.length && !segments(run, table)) bad.push(run.join(' '));
      run = [];
    };
    for (const tok of toks) {
      if (countsAsTarget(tok, vocab)) run.push(tok);
      else flush();
    }
    flush();
    return bad;
  }

  /* Can this run be read as one known phrase after another? Longest match
     first, falling back to shorter ones, so "¿Tienes una entrada" finds
     "¿Tienes" + "una entrada" rather than stopping at a greedy dead end. */
  function segments(toks, table) {
    const n = toks.length;
    const seen = new Array(n + 1).fill(null);
    const walk = i => {
      if (i === n) return true;
      if (seen[i] !== null) return seen[i];
      seen[i] = false;
      for (let j = n; j > i; j--) {
        if (!table[phraseKeyOf(toks.slice(i, j).join(' '))]) continue;
        if (walk(j)) { seen[i] = true; return true; }
      }
      return seen[i];
    };
    return walk(0);
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
      /* ...and what each run of it MEANS, so the fragments the server returns
         carry NJA-3149's `translation`. The table is the content's, and the
         server has no content of its own. */
      phrases: Q.phrases,
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
  /* The one turn of the night that is the same every time, so nothing has to
     be decided and nothing has to be waited for. Two model calls and their
     retries were being spent on it at the worst possible moment — cold
     instance, cold model, no clip cached, and a child with nothing invested
     yet. The lines are in content, in their own language, and the call that
     used to produce them is skipped rather than raced. */
  function openingLines(plan) {
    const target = plan.pair.allTarget;
    return {
      actor_line: t('open-actor'),
      coach_line: t('open-coach', target),
    };
  }

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
    const wrong = badPhrases(j.actorText);
    if (wrong.length) { lastGenWhy = 'target language put together wrong: ' + wrong.join(' / '); return null; }

    /* And the line must not be the CHILD'S line said back at them. Asking the
       prompt nicely is not enough here: "perdona" is on the introduced list,
       so every other check passes it happily, and the bartender opens with
       "Alright, perdona, what can I do for ya?" — the customer's own words,
       in the server's mouth, used as filler. */
    const stolen = stolenWords(j.actorText);
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
    const mixed = mixedQuote(j.coachText);
    if (mixed) { lastCoachWhy = 'quoted a half-translated sentence: ' + mixed; return null; }
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
    return F.fragments(text, allowed, Q.phrases);
  }

  /* Render fragments to HTML. A `target` fragment is blue, bold, underlined
     and tappable — the same button `spanishHTML` produced word by word, except
     that what counts as target is now data rather than a guess made at paint
     time. */
  function fragmentsHTML(frags) {
    return (frags || []).map(f => {
      if (f.type !== 'target') return esc(f.text);
      /* A run that knows what it means is tapped as a RUN: "una entrada" is
         one thing with one meaning, and splitting it into two buttons offered
         a child the meaning of "una". A run with no translation still falls
         back to per-word buttons, because a single word is the most the
         glossary can answer for. */
      if (f.translation) {
        const body = f.text.replace(/\s+$/, ''), tail = f.text.slice(body.length);
        return '<button type="button" class="w" data-w="' + esc(body) +
               '" data-t="' + esc(f.translation) + '">' + esc(body) + '</button>' + tail;
      }
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
    /* The opening turn's lines live here rather than beside the call that
       skips the model, so every reader of them — the bubble, the retry floor,
       the transcript — gets the same pair without having to know it is the
       opener. */
    if (E.isOpener(state)) return openingLines(plan);
    const intro = newThing(plan);
    const asks = tList('fb-actor-ask');
    let actor = asks[(state.turn + plan.pair.id.length) % asks.length];
    if (intro && intro.by === 'actor') actor = t('fb-actor-offer', intro.target);

    /* The native sentence is the MEANING, and the line says so by naming the
       language it has to come out in. Quoting it after a bare "repeat it" told
       a Spanish child to repeat Spanish. */
    const coachAsks = tList('fb-coach-ask');
    const ask = coachAsks[state.turn % coachAsks.length];
    let coach = ask
      .split('{0}').join(plan.pair.allNative)
      .split('{1}').join(Q.languageNames.target);
    /* The TARGET phrase, not the native one. "Here's how you say it" promises
       the language the child is about to produce, and it was being handed the
       language they already speak — so a Spanish child learning English was
       told "Así se dice: «Perdona.»", which teaches them nothing and teaches
       it in the wrong direction. Wrong both ways round; only visible once the
       pair could be reversed. */
    if (intro && intro.kind === 'pattern') coach = t('fb-coach-new', plan.pair.allTarget);
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
  /* Rebuilt with the pair: the glossary is target-language words and their
     native meanings, so reversing the direction reverses every entry. */
  const GLOSS = () => Q.glossary || {};
  const bare = w => w.toLowerCase().replace(/[¿?¡!.,;:"“”]/g, '').trim();

  function gloss(word) {
    const k = bare(word);
    const g = GLOSS();
    return g[k] || g[k.replace(/[^a-zñáéíóúü ]/g, '')] || null;
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
  function showGloss(word, speak, meaning) {
    glossWord = word;
    $('gloss-word').textContent = String(word).replace(/^[¿¡"“]+|[?!.,;:"”]+$/g, '') || word;
    /* The fragment's own `translation` first (NJA-3149), then chipMeaning,
       then the single-word glossary: the glossary is keyed on single words, so
       "una entrada" was a blank card even though the content has known it
       meant "a ticket" all along. */
    const means = meaning || chipMeaning(word) || '';
    $('gloss-mean').textContent = means || '—';
    if (state) E.track(state, 'translation_clicked', { word: String(word) });
    AN('NovaPals.Nlt.HighlightTapped', { targetText: String(word), nativeText: means });
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
    if (w) { showGloss(w.dataset.w, !inputLocked, w.dataset.t); return; }
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
    if (n >= p.cells.length) return t('slot-hint-all');
    return n === 1 ? t('slot-hint-one') : t('slot-hint-many', n);
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
    const got = (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? (raw[NL()] || raw.en || '') : (raw || '');
    const s = Array.isArray(got) ? (got[0] || '') : got;
    return args.reduce((acc, v, i) => acc.split('{' + i + '}').join(String(v)), s);
  }

  /* The same lookup for a ui_string that is a LIST — the written fallbacks,
     which rotate so the stand-in line is not the same one every turn. */
  function tList(key) {
    const raw = Q.uiStrings[key];
    const got = (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? (raw[NL()] || raw.en || []) : raw;
    return Array.isArray(got) ? got : [String(got || '')];
  }

  function renderHud() {
    renderRail();
    $('mastery').textContent = t('mastery-display-string', Math.round(E.overall(state, Q) * 100));
    $('coins').textContent = String(state.coins);
    $('t-obj').textContent = plan ? plan.pair.id : '—';
    $('t-scaf').textContent = plan
      ? (plan.frameTarget ? 'frame:target' : 'frame:native') +
        ' · ' + (plan.pair.hasSlot
          ? 'slots:' + (plan.targetSlots || []).length + '/' + plan.pair.slotCount
          : 'no slot') +
        (plan.introducing ? ' · NEW ' + plan.introducing : '')
      : '—';
    /* Which half of the go we are in matters once a step can come round again:
       "turn 24" says nothing about whether this is the syllabus or the climb
       to the pass mark. */
    $('t-turn').textContent = state.turn + '/' + Q.session.turnCap +
      ' · ' + (state.makeup ? 'makeup' : 'step ' + (state.at + 1) + '/' + state.plan.length) +
      (state.go > 1 ? ' · go ' + state.go : '') +
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
      for (const t of [p.allTarget, p.say(false, p.slotKeys)]) {
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

    /* The opening turn is written, so neither call is made and there is
       nothing to wait for: the bartender is on screen as fast as his voice can
       be fetched. */
    const written = E.isOpener(state);

    /* Call one: the character. Nothing can be drawn until his line exists,
       because everything else this turn is a reaction to it. */
    const gen = written ? null : await generateActorLine(plan);
    $('turn-loading').classList.add('hidden');
    if (written) { lastGenWhy = 'written opening'; lastCoachWhy = 'written opening'; }

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
    const coachPending = written ? Promise.resolve(null) : generateCoachLine(plan, actorLine);

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
      /* Fired here rather than at the top of the turn: until the coach has
         spoken there is no hintText to report, and a QuestionStart without
         one is a row that cannot be read next to its QuestionEnd. */
      AN('NovaPals.Nlt.QuestionStart', questionProps(plan));
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
  /* 'target' and 'native' resolve against the pair chosen for this session,
     so reversing the direction swaps the two voices rather than leaving the
     bartender with a Spanish accent in a session that teaches English. A
     literal language code still wins, for a character who is from somewhere
     specific whichever way round the session runs. */
  function accentOf(who) {
    const pin = v => v === 'target' ? TL() : v === 'native' ? NL() : v;
    if (who === Q.activity.actor.id) return pin(Q.activity.actor.accent) || TL();
    if (who === 'axel') return pin(Q.activity.coach.accent) || NL();
    if (who === 'learner' || who === 'me') return pin(Q.activity.coach.accent) || NL();
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
    /* A blank is as wide as it can afford to be. Five of them at the old fixed
       62px did not fit a phone, so "Can I have a ticket?" wrapped into a
       scrolling box. They are uniform within a turn — a blank sized to its own
       word would be telling the child the answer's length. */
    const gaps = plan ? plan.cells.filter(c => c.gap).length : 0;
    slot.style.setProperty('--gap-w', (gaps >= 5 ? 38 : gaps === 4 ? 46 : 62) + 'px');
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

    /* The punctuation that belongs to a gap, printed beside it rather than
       welded into the pill. It also tells the child what they are building:
       a blank followed by "?" is a question before they have tapped anything. */
    const mark = (txt, where) => {
      if (!txt) return;
      const m = document.createElement('span');
      m.className = 'frame mark ' + where;
      m.textContent = txt;
      slot.appendChild(m);
    };

    for (const cell of plan.cells) {
      if (!cell.gap) { pushWord(cell.w); continue; }
      flushRun();
      const i = g++;
      mark(cell.lead, 'lead');
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
            SFX.play('lift');
            renderSlot(); renderTray(); syncSay();
          });
        } else {
          b.disabled = true;
        }
        slot.appendChild(b);
      }
      mark(cell.tail, 'tail');
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
  let optionCache = null, optionCacheFor = null;
  function optionPills() {
    /* Keyed on the PLAN ITSELF, not on the pair and the turn. Those two agree
       for most of a turn and come apart at the worst moment: applyCorrect
       increments the turn, and the redraws that happen between then and the
       next plan being built cache the old plan's pills under the new turn's
       key. The next turn then finds a matching key and reuses them — so the
       construction turn was offered the word turn's pills and the first word
       of the sentence was missing from the tray. */
    if (optionCache && optionCacheFor === plan) return optionCache;
    optionCacheFor = plan;
    optionCache = plan ? E.pills(Q, state, plan) : [];
    return optionCache;
  }

  function place(pill, at) {
    if (at < 0 || at >= slotCount()) return;
    placed[at] = pill;
    marks[at] = null;
    submitted = false;
    SFX.play('place');
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
        SFX.play('place');
        renderSlot(); renderTray(); syncSay();
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

  /* ---------- is the model actually doing the voices? ----------
     A TTS failure used to be invisible: the line came out in the browser's
     synthesiser and nothing anywhere said why. It no longer falls back, so a
     failure is silence — which needs to be legible, or it reads as the sound
     being broken. The strip carries the reason. */
  let analyticsStarted = false;
  let voiceTimer = null;
  function voiceWatch() {
    if (voiceTimer) return;
    voiceTimer = setInterval(() => {
      const err = V.lastVoiceError && V.lastVoiceError();
      const el = $('t-voice');
      if (!el) return;
      el.textContent = !serverUp ? 'voice: browser (no server)'
                     : err ? 'VOICE FAILED: ' + err
                     : 'voice: model';
      el.className = err && serverUp ? 'bad' : '';
    }, 1000);
  }

  /* ---------- analytics (NJA-3172) ----------
     Names written out in full rather than assembled, so grepping for
     "NovaPals.Nlt.QuestionEnd" finds the one place it is sent. The ticket
     mixes snake_case on the type properties with camelCase on the NLT ones;
     that is the ticket's spelling and it is followed exactly, because the
     dashboards are built against it.

     questionIndex is the step of the go, not the turn: a retry is the same
     question asked again, and counting it twice would make a child who
     struggled look like a child who was asked more. */
  const AN = (name, props) => { try { window.ANALYTICS.event(name, props); } catch {} };
  /* $screen and the super-properties, both never allowed to throw: losing a
     turn to a blocked analytics script would be absurd. */
  const SCREEN = {
    at: name => { try { window.ANALYTICS.screen(name); } catch {} },
    register: props => { try { window.ANALYTICS.register(props); } catch {} },
  };
  /* NovaPals.Activity.Skip has no trigger here. The skip button is NJA-3164's
     and is behind a flag this prototype does not have, and the mercy escape is
     not a skip — the child did not choose it and the engine does not treat it
     as one. Wiring it to the nearest thing would put a number in the dashboard
     that means something else. */
  const questionProps = pl => ({
    patternId: pl.pair.patternId,
    questionText: turnLine || '',
    hintText: turnAsk || '',
    questionIndex: state ? state.at : 0,
  });

  /* ---------- the turn loop ---------- */
  function step() {
    if (state.finished) return;
    if (E.sessionComplete(state, Q)) return finish('complete');
    if (state.turn >= Q.session.turnCap) return finish('turn-cap');
    const pair = E.pickNext(state, Q);
    /* Nothing left to ask with the go unfinished is a fault, not an ending. */
    if (!pair) { AN('NovaPals.Activity.Error', { reason: 'no-pair' }); return finish('no-pair'); }
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
        /* The marks live on the cell now, so they are put back here — the
           transcript should read "Do you have a ticket?", not "... ticket". */
        return (c.lead || '') + (p === undefined ? '…' : p.label) + (c.tail || '');
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
    if (stolenWords(j.actorText).length) return null;
    if (badPhrases(j.actorText).length) return null;
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

    /* What the child actually produced. A tapped answer is the sentence as the
       tray built it; a spoken one is the transcript, because on that path the
       tray is empty and builtSentence() returns "Do you have a …?" — a row of
       ellipses in the chat bubble, in the line the bartender reacts to, and in
       the analytics, where it made every spoken answer look identical and left
       no way to tell a mishearing from a wrong answer. */
    const said = mode === 'chips' ? builtSentence() : String(text || '').trim();
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

    /* answerMode separates the two input paths in the dashboard. Without it a
       spoken answer and a tapped one are the same row, and the speech funnel
       cannot be read at all. */
    AN('NovaPals.Nlt.QuestionEnd',
      Object.assign(questionProps(plan), {
        answerText: said,
        answerMode: mode === 'chips' ? 'tap' : 'voice',
        isCorrect: !!v.correct,
      }));

    if (v.correct) {
      say('me', spanishHTML(said), said, null, 'right');
      const before = E.overall(state, Q);
      const ph = E.applyCorrect(state, plan, { hinted });
      if (E.overall(state, Q) > before + 1e-6) pulseMastery();
      showBanner('good');
      SFX.play('right');
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
      $('verdict').textContent = t('coach-says-it', COACH, plan.expected);
      /* Written, not spoken. The bartender is the only one who talks out loud
         without being asked; the coach's voice is available on a tap — the
         hint sheet has a button, and every highlighted word reads itself. */
      await new Promise(r => setTimeout(r, 900));
      E.applyMercy(state, plan);
      setTimeout(() => { busy = false; submitted = false; step(); }, 1200);
      return;
    }

    showBanner('bad');
    SFX.play('wrong');
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

  /* The end of a go (NJA-3196 Q2). Two things the old screen did not say: did
     they clear the pass mark, and which phrases actually stuck. A single
     percentage answers neither — and "you got everything" was printed even for
     a child who had got nothing, because reaching the end of the list was the
     only thing it measured. */
  function finish(reason) {
    state.finished = true;
    const score = E.overall(state, Q);
    const mark = E.passMark(Q);
    const ok = score >= mark;
    const rows = E.report(state, Q);
    const left = rows.filter(r => r.verdict !== 'stuck');

    E.track(state, 'session_end', {
      turns: state.turn, overall: score, passed: ok, go: state.go, reason,
    });
    AN('NovaPals.Activity.End', {
      turns: state.turn, mastery: Math.round(score * 100), passed: ok,
      go: state.go, reason,
    });
    AN('NovaPals.Quest.End', { mastery: Math.round(score * 100), passed: ok });

    $('end-msg').textContent = t(ok ? 'end-passed-title' : 'end-short-title');
    $('end-score').textContent = t('mastery-display-string', Math.round(score * 100));
    $('end-sub').textContent = t(ok ? 'end-passed-sub' : 'end-short-sub', Math.round(mark * 100));

    /* The bar exists so the number has somewhere to be: the tick is the pass
       mark, and whether the fill reaches it is the result. */
    $('end-fill').style.width = Math.round(score * 100) + '%';
    $('end-fill').classList.toggle('pass', ok);
    $('end-mark').style.left = 'calc(' + Math.round(mark * 100) + '% - 1px)';

    const label = { stuck: 'end-stuck-label', shaky: 'end-shaky-label', missed: 'end-missed-label' };
    $('end-list').innerHTML = rows.map(r =>
      '<div class="end-row ' + r.verdict + '">' +
        '<span class="ph">' + esc(r.target) + '<small>' + esc(r.native) + '</small></span>' +
        '<span class="vd">' + esc(t(label[r.verdict])) + '</span>' +
      '</div>').join('');

    /* Two ways back in, and they are not the same offer: one redrills only
       what did not stick, the other starts the night over. */
    const some = $('btn-again'), all = $('btn-restart');
    some.querySelector('span').textContent = t('end-replay-some');
    all.querySelector('span').textContent = t('end-replay-all');
    some.classList.toggle('hidden', left.length === 0);

    /* In a quest, finishing means completing the quest rather than looping, so
       FINISH leads and the two replays drop to secondary. Outside the app
       there is no quest to complete and no button. */
    const fin = $('btn-finish');
    fin.querySelector('span').textContent = t('end-finish');
    fin.classList.toggle('hidden', !B.inApp);
    fin.disabled = false;
    $('end-note').classList.add('hidden');
    some.classList.toggle('primary', !B.inApp);
    all.classList.toggle('hidden', B.inApp && left.length > 0);

    $('end-eyebrow').textContent = t('end-eyebrow');
    SCREEN.at(ok ? 'End — Passed' : 'End — Short');
    $('end').classList.remove('hidden');
  }

  /* A second go at the material that did not land. The engine carries the
     steps that stuck at their score, so this cannot cost the child mastery. */
  function replayLeftovers() {
    const next = E.replay(state, Q);
    $('end').classList.add('hidden');
    state = next;
    state.finished = false;
    E.track(state, 'session_start', { activity: Q.activity.id, replay: true, go: state.go });
    chatLog.length = 0;
    $('chat').innerHTML = '';
    buildRail();
    hideGloss();
    $('chat-full').classList.add('hidden');
    renderHud();
    step();
  }

  /* ---------- mic ----------
     The browser's own speech recognition does not exist in an iOS webview and
     is unreliable in Safari, which is most of the children this is for — so a
     mic that only ever used it was a button that did nothing on half the
     devices. The microphone records and the server's model transcribes, the
     same way the voices are the model's rather than the browser's.

     SpeechRecognition stays as the fallback for the case the recorder cannot
     cover: no server. It is never the first choice, because the two disagree
     about what a seven-year-old just said and only one of them is the same on
     every phone. */
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
                             window.MediaRecorder);
  const canListen = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const micAvailable = () => canRecord() || canListen();

  /* iOS records mp4/aac and everything else records webm/opus. Asked for one
     it does not have, MediaRecorder either throws or silently gives a format
     the model cannot read, so the type is chosen rather than assumed. */
  const MIC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
  function micType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return MIC_TYPES.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
  }

  /* Long enough for "Can I have a soda, please?" said slowly by a child who is
     thinking, short enough that a pocketed phone does not record the room. */
  const MIC_MAX_MS = 9000;
  let media = null, micStream = null, micChunks = [], micTimer = null, micSending = false;

  function micLabels() {
    $('mic-state').textContent = micSending ? t('mic-thinking') : t('mic-open');
    $('mic-hidden').textContent = t('mic-hidden-words');
  }

  function setMic(on) {
    micOn = on;
    $('mic-panel').classList.toggle('hidden', !on);
    $('tray').style.display = on ? 'none' : '';
    $('slot').style.display = on ? 'none' : '';
    $('slot-label').style.display = on ? 'none' : '';
    $('btn-mic').classList.toggle('on', on);
    $('btn-say').style.display = on ? 'none' : '';
    $('btn-clear').style.display = on ? 'none' : '';
    if (on) micLabels();
    if (!on) {
      micSending = false;
      if (recog) { try { recog.stop(); } catch {} recog = null; }
      stopRecorder(true);
    }
  }

  /* Releases the microphone as well as stopping the recorder: a stream left
     running leaves the recording indicator up, which to a parent looking over
     a shoulder is an app still listening. */
  function stopRecorder(discard) {
    if (micTimer) { clearTimeout(micTimer); micTimer = null; }
    const m = media;
    media = null;
    if (m && discard) m.onstop = null;
    try { if (m && m.state !== 'inactive') m.stop(); } catch {}
    if (micStream) { for (const tr of micStream.getTracks()) { try { tr.stop(); } catch {} } micStream = null; }
  }

  async function toggleMic() {
    if (micSending) return;                       // already on its way
    if (micOn) { finishRecording(); return; }
    if (!micAvailable()) { $('verdict').textContent = t('mic-unavailable'); return; }
    V.stop();
    $('mic-heard').textContent = '';
    if (!(canRecord() && serverUp)) { startListening(); return; }
    /* The reason before the prompt. Only the first time, and not at all if the
       permission is already there. */
    if (await micAgreed()) { startRecording(); return; }
    askForMic();
  }

  /* ---------- asking for the microphone ----------
     The browser's own prompt is a box with no reason in it, fired the instant
     a child taps a button they may have tapped by accident — and on iOS a "no"
     is sticky and can only be undone in Settings, so a cold prompt spends the
     one chance there is. The reason goes first, in the child's own language,
     and the button inside the card is what fires the real prompt. The tap on
     that button is also the gesture iOS requires, so nothing is lost by
     waiting.

     This is the camera prototype's primer, shrunk to a card: speaking is an
     alternative here rather than the whole game, so asking about it must not
     look like the night has stopped. */
  let micOkThisSession = false;

  async function micAgreed() {
    if (micOkThisSession) return true;
    /* Chrome and Android answer this; Safari does not implement it for the
       microphone, which is exactly the platform that matters — hence the
       remembered flag below as well. */
    try {
      const st = await navigator.permissions.query({ name: 'microphone' });
      if (st && st.state === 'granted') { micOkThisSession = true; return true; }
      if (st && st.state === 'denied') return false;
    } catch { /* not supported; fall through */ }
    try { if (localStorage.getItem('np-mic-ok') === '1') { micOkThisSession = true; return true; } }
    catch { /* private mode, or storage refused; ask again, which is harmless */ }
    return false;
  }

  function askForMic(denied) {
    const card = $('mic-ask');
    $('mic-ask-title').textContent = t('mic-ask-title');
    $('mic-ask-why').textContent = denied ? t('mic-ask-denied') : t('mic-ask-why');
    $('mic-ask-privacy').textContent = denied ? '' : t('mic-ask-privacy');
    $('mic-ask-go').classList.toggle('hidden', !!denied);
    $('mic-ask-go').querySelector('span').textContent = t('mic-ask-go');
    $('mic-ask-no').querySelector('span').textContent = t(denied ? 'mic-ask-ok' : 'mic-ask-no');
    card.classList.remove('hidden');
    AN('NovaPals.Nlt.MicAsked', { denied: !!denied });
  }

  const closeMicAsk = () => $('mic-ask').classList.add('hidden');

  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      /* Denied, or the host never asked for the permission at all — which is
         what a webview does unless the app grants it. Either way the child
         taps instead, and is told why rather than left with a dead button. */
      AN('NovaPals.Activity.Error', { reason: 'mic-denied', detail: (e && e.name) || 'unknown' });
      $('btn-mic').style.opacity = '.4';
      askForMic(true);
      return;
    }
    /* They said yes. Remembered so the card is a once-ever thing rather than a
       toll on every answer they want to speak. */
    micOkThisSession = true;
    try { localStorage.setItem('np-mic-ok', '1'); } catch {}
    micStream = stream;
    micChunks = [];
    const type = micType();
    try {
      media = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      media = new MediaRecorder(stream);
    }
    media.ondataavailable = e => { if (e.data && e.data.size) micChunks.push(e.data); };
    media.onstop = () => transcribe(media && media.mimeType || type || 'audio/webm');
    setMic(true);
    try { media.start(); } catch { setMic(false); $('verdict').textContent = t('mic-failed'); return; }
    micTimer = setTimeout(() => { if (micOn) finishRecording(); }, MIC_MAX_MS);
  }

  function finishRecording() {
    if (!media) { setMic(false); return; }
    micSending = true;
    micLabels();
    const m = media;
    const type = m.mimeType || micType() || 'audio/webm';
    media = null;
    if (micTimer) { clearTimeout(micTimer); micTimer = null; }
    m.onstop = () => transcribe(type);
    try { m.stop(); } catch { transcribe(type); }
  }

  async function transcribe(type) {
    if (micStream) { for (const tr of micStream.getTracks()) { try { tr.stop(); } catch {} } micStream = null; }
    const blob = new Blob(micChunks, { type });
    micChunks = [];
    if (!blob.size) { setMic(false); $('verdict').textContent = t('mic-nothing'); return; }
    const j = await post('/api/listen',
      { audio: await toBase64(blob), mime: type, language: TL() }, 15000);
    setMic(false);
    const said = String((j && j.text) || '').trim();
    if (!said) {
      $('verdict').textContent = t(j && j.fail ? 'mic-failed' : 'mic-nothing');
      return;
    }
    $('mic-heard').textContent = said;
    submit(said, 'voice');
  }

  /* In chunks, because String.fromCharCode on a whole clip is an argument list
     long enough to blow the stack on the devices this most needs to work on. */
  async function toBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  /* The fallback. Only reached with no server to transcribe for us. */
  function startListening() {
    if (!canListen()) { $('verdict').textContent = t('mic-unavailable'); return; }
    setMic(true);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new SR();
    /* The target language, whichever of the six it is — this used to read
       "es-ES unless Spanish, otherwise en-GB", written when the pair could
       only face one way. */
    recog.lang = { en: 'en-GB', es: 'es-ES', pt: 'pt-PT',
                   tr: 'tr-TR', pl: 'pl-PL', ro: 'ro-RO' }[TL()] || 'en-GB';
    recog.interimResults = true;
    recog.continuous = false;
    recog.onresult = ev => {
      let txt = '';
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      $('mic-heard').textContent = txt;
      if (ev.results[ev.results.length - 1].isFinal) { setMic(false); submit(txt, 'voice'); }
    };
    recog.onerror = () => { setMic(false); $('verdict').textContent = t('mic-failed'); };
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
    for (const it of (p.items || []))
      rows.push([p.slotCount > 1 ? 'WORD ' + (p.items.indexOf(it) + 1) : 'THE WORD',
                 esc(it.target) + ' &middot; ' + esc(it.native)]);
    $('coach-rungs').innerHTML = rows
      .map(([k, v]) => `<div class="rung"><span class="k">${k}</span><span class="v">${v}</span></div>`)
      .join('');
    $('coach-eyebrow').textContent = t('coach-sheet-eyebrow');
    $('coach-title').textContent = t('coach-sheet-title');
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

    const head = text => {
      const h = document.createElement('div');
      h.className = 'scene-h';
      h.innerHTML = `<b>${esc(text)}</b><span></span>`;
      body.appendChild(h);
    };
    const row = (main, sub, rec) => {
      const ph = E.phase(rec);
      /* The class is the phase, the text is the translation — the two were
         the same string before, so localising the pill restyled it. */
      const cls = { present: 'new', practice: 'practising', produce: 'canuse' }[ph];
      const label = t('prog-phase-' + ph);
      const n = rec.correct + rec.incorrect;
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML =
        `<div class="l"><span class="t">${esc(main)}</span><span class="m">${esc(sub)}</span></div>` +
        `<div class="r"><span class="pct">${n ? Math.round(E.ratio(rec) * 100) + '%' : '—'}</span>` +
        `<span class="pill ${cls}">${esc(label)}</span></div>`;
      body.appendChild(r);
    };

    $('prog-eyebrow').textContent = t('pause-title');
    /* The night's name, in the child's language: the intro title is the one
       the scenario already carries in all six. */
    $('prog-name').textContent = (Q.activity.intro || {}).title || Q.title;
    syncSound();
    head(t('prog-head-phrases'));
    for (const pid of Q.activity.patterns) {
      const rec = state.patterns[pid];
      if (!rec) continue;
      const pat = Q.vocabPatterns[pid];
      row(pat[TL()].replace(/\{[^}]+\}/g, '___'),
          pat[NL()].replace(/\{[^}]+\}/g, '___') +
          (rec.exposures ? '  ·  ' + t('prog-counts', rec.exposures, rec.correct, rec.incorrect) : ''),
          rec);
    }

    head(t('prog-head-words'));
    for (const iid of Q.activity.items) {
      const rec = state.items[iid];
      if (!rec) continue;
      const it = Q.vocabItems[iid];
      row(it[TL()].indefinite, it[NL()].indefinite +
          (rec.exposures ? '  ·  ' + t('prog-counts', rec.exposures, rec.correct, rec.incorrect) : ''),
          rec);
    }

    $('prog-overall').textContent = pct(E.overall(state, Q));
    $('prog-sheet').classList.remove('hidden');
  }

  /* ---------- boot ---------- */
  let dragWired = false;

  async function boot() {
    preloaded = false;
    if (!dragWired) { wireDrag(); dragWired = true; }
    chatLog.length = 0;
    $('chat').innerHTML = '';
    hideGloss();
    $('chat-full').classList.add('hidden');
    preloadRigs();                    // loads behind the intro

    /* The intro picks the language pair, which rebuilds Q — so nothing that
       reads a pattern may happen before it. The session state and the
       progress rail are both built FROM the syllabus, so they wait. */
    const unlocked = await intro();
    if (!unlocked) {                // locked: ask for the code, then re-probe
      await unlockGate();
      await probeServer();
    }

    state = E.createState(Q);
    /* ?opener=0 turns off the taught first turn, so a harness about generated
       lines or wrong answers can reach one without playing through a turn that
       has neither. Same door as ?intro=0, and the same reason. */
    if (/[?&]opener=0/.test(location.search)) state.noOpener = true;
    E.track(state, 'session_start', { activity: Q.activity.id, native: NL(), target: TL() });
    /* Quest then Activity, in that order: the quest is the thing the child
       picked and the activity is this run of it, and the rest of the app
       reports them as a pair. */
    /* The pair is only settled once the picker has been answered, so the
       language super-properties are registered here rather than at init. */
    /* ...and HOW the pair was decided, so the next read of this screen is
       about something other than guesswork: 'url' when a walkthrough or the
       app named it, 'device' when the phone did, 'picker' when the child
       answered, 'default' when nothing could. */
    SCREEN.register({ native_language: NL(), target_language: TL(),
                      language_source: langSource });
    AN('NovaPals.Quest.Start', { nativeLanguage: NL(), targetLanguage: TL(),
                                 languageSource: langSource });
    AN('NovaPals.Activity.Start', { nativeLanguage: NL(), targetLanguage: TL(),
                                    stages: E.syllabus(Q).length, steps: E.allSteps(Q).length });
    buildRail();
    $('t-mode').textContent = NL() + ' \u2192 ' + TL() + ' · ' + Q.pairs.length + ' pairs';
    $('btn-mic').style.opacity = micAvailable() ? '' : '.4';
    SCREEN.at('Night');
    step();
  }

  $('btn-say').addEventListener('click', () => { SFX.play('submit'); submit(builtSentence(), 'chips'); });
  /* The bin clears what is still in play. A pill already judged right is not
     in play — it is part of the sentence now — so it stays. */
  $('btn-clear').addEventListener('click', () => {
    if (inputLocked) return;
    for (let i = 0; i < slotCount(); i++) if (marks[i] !== true) { placed[i] = undefined; marks[i] = null; }
    submitted = false;
    renderSlot(); renderTray(); syncSay();
  });
  /* FINISH — the only thing in the prototype that completes the quest. The app
     closes the webview when it gets the message, so normally this button's own
     state is never seen again. If it IS still here four seconds later the
     message did not land, and saying so beats leaving a dead button: a second
     tap sends another, which cannot double-pay, because a webview that
     received the first one would have closed before the child could tap. */
  $('btn-finish').addEventListener('click', () => {
    const btn = $('btn-finish');
    if (btn.disabled) return;
    btn.disabled = true;
    V.stop();
    const score = Math.round(E.overall(state, Q) * 100);
    AN('NovaPals.Activity.Finished', {
      mastery: score, passed: score >= Math.round(E.passMark(Q) * 100),
      turns: state.turn, go: state.go, attempt: B.endSends + 1,
    });
    B.finish({
      mastery: score,
      passed: score >= Math.round(E.passMark(Q) * 100),
      turns: state.turn,
      go: state.go,
      native: Q.nativeLang,
      target: Q.targetLang,
    });
    setTimeout(() => {
      btn.disabled = false;
      const note = $('end-note');
      note.textContent = t('end-finish-wait');
      note.classList.remove('hidden');
    }, 4000);
  });
  $('btn-mic').addEventListener('click', toggleMic);
  /* The card's own two buttons. "Turn on the mic" is the gesture that fires the
     real browser prompt, so the recording starts from inside the handler and
     iOS counts it as a tap. */
  $('mic-ask-go').addEventListener('click', () => { closeMicAsk(); startRecording(); });
  $('mic-ask-no').addEventListener('click', closeMicAsk);
  /* The pause sheet IS the pause: opening it stops the night, closing it
     starts it again, so those are the two events rather than a button that
     does not exist. */
  $('btn-pause').addEventListener('click', () => {
    SCREEN.at('Paused');
    AN('NovaPals.Activity.Paused', { turn: state ? state.turn : 0 });
    openProgress();
  });
  $('coach-close').addEventListener('click', () => $('coach-sheet').classList.add('hidden'));
  $('prog-close').addEventListener('click', () => {
    AN('NovaPals.Activity.Resume', { turn: state ? state.turn : 0 });
    $('prog-sheet').classList.add('hidden');
  });
  $('btn-restart').addEventListener('click', () => { $('end').classList.add('hidden'); boot(); });
  $('btn-again').addEventListener('click', replayLeftovers);

  $('gloss-close').addEventListener('click', hideGloss);
  $('gloss-say').addEventListener('click', () => V.now(glossWord, { speaker: 'axel', lang: TL() }));

  $('btn-expand').addEventListener('click', () => {
    renderChatFull();
    $('chat-full').classList.remove('hidden');
  });
  $('chat-close').addEventListener('click', () => $('chat-full').classList.add('hidden'));

  function syncSound() {
    $('sound-label').textContent = t(V.isEnabled() ? 'sound-on' : 'sound-off');
  }
  $('btn-sound').addEventListener('click', () => {
    const on = !V.isEnabled();
    V.setEnabled(on);
    SFX.setEnabled(on);    // one switch: speech, beds and taps go together
    syncSound();
  });
  syncSound();

  // diagnostics are not part of the game; ?debug=1 brings them back
  if (/[?&]debug=1/.test(location.search)) {
    $('test-strip').classList.remove('hidden');
    document.body.classList.add('debug');
  }

  // iOS will not play audio until a gesture; the first touch anywhere opens it
  document.addEventListener('pointerdown', () => { V.unlock(); SFX.unlock(); }, { once: true });

  /* Tap sounds, delegated once rather than wired per control — a button added
     later gets its click for free, and nothing has to remember to ask.
     Pills are handled where they are placed and lifted, because those are two
     different sounds and only the handler knows which just happened. */
  document.addEventListener('pointerdown', ev => {
    const t = ev.target.closest && ev.target.closest('.btn, .w, .intro-panel');
    if (!t || t.disabled) return;
    if (t.id === 'btn-say') return;            // submit has its own
    SFX.play('tap');
  }, true);

  /* The on-screen character's mouth moves for exactly as long as the line
     plays — server voice or browser fallback, both resolve through the same
     queue. Axel coaching from his bubble does not move the bouncer, and the
     learner echo moves nobody. No attempt to match visemes to words: the ask
     was a talking loop, not lip sync. */
  let mouthTimer = null;
  /* Axel on the intro moves his mouth for exactly as long as his line plays —
     the same signal the scene uses for the bartender, read before the `current`
     guard below, because during the intro there is no turn in progress. */
  V.onSpeaking((speaker, on) => {
    if (speaker !== 'axel' || !introRig) return;
    clearTimeout(introMouthTimer);
    if (on) introMouth(true);
    else introMouthTimer = setTimeout(() => introMouth(false), 160);
  });

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
    /* the end of a go, so a test can read the result rather than the pixels */
    report: () => E.report(state, Q),
    overall: () => E.overall(state, Q),
    finish: reason => finish(reason || 'debug'),
    replay: () => replayLeftovers(),
    /* so a test can put a line to the guard without waiting for the model to
       write a bad one */
    mixedQuote: txt => mixedQuote(txt),
    langSource: () => langSource,
    deviceLang: () => deviceLang(),
  };

  boot();
})();
