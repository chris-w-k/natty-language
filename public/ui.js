/* ui.js — screens, chips, mic, coach, voice cues.
   Holds no scoring logic: every number comes from ENGINE.
   Three stacked layers so the reskin is assets + tokens. */

(function () {
  /* The language pair is chosen on the first screen (NJA-3204: it is a
     session input, not a constant), so the whole content object is rebuilt
     when it changes. Everything below reads Q at call time rather than
     capturing bits of it. */
  let Q = window.QUEST;

  /* Who this is, and which engine they get. Read once, at the top, before
     anything is drawn — the arm decides what the night looks like, and the
     mastery it carries decides where the night starts. See store.js for why
     the arm lives in the same store as the mastery rather than behind a
     feature flag. */
  const LEARNER = window.STORE.begin();
  const ARM = LEARNER.arm;
  const MASTERY_ARM = ARM === 'mastery';

  /* The number on screen. Arm A averages its fixed steps; arm B has no steps,
     so it reads Max's level mastery - patterns and words, fifty-fifty, over
     the words some construction can actually ask for. */
  function overall() {
    if (!MASTERY_ARM) return E.overall(state, Q);
    const M = window.MASTERY, rec = state && state.mastery;
    if (!rec) return 0;
    return M.levelMastery(rec, (Q.groups || []).map(g => g.id), E.reachableWords(Q));
  }

  /* The record outlives the session, which is the entire point of the arm. */
  function saveMastery() {
    if (!MASTERY_ARM || !state || !state.mastery) return;
    try { window.STORE.setMastery(state.mastery); } catch {}
  }
  const C = window.CONTENT;
  /* Which night this is. Set before the quest starts and never changed inside
     a go — a venue switch rebuilds the whole content object through here. */
  /* Arm B runs Max's cafe, because that is the content his model was tuned
     against. Arm A stays in the night club. */
  let venue = (MASTERY_ARM && C.venues.indexOf('cafe') >= 0) ? 'cafe' : C.defaultVenue;
  const played = [];
  function setPair(nativeCode, targetCode, venueId) {
    if (venueId) venue = venueId;
    Q = C.build(nativeCode, targetCode, venue);
    window.QUEST = Q;
    ACTOR = Q.activity.actor.id;
    COACH = Q.activity.coach.name;
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
  /* one free go per turn when the microphone, rather than the child, is what
     got it wrong — see submit() */
  let misheardOnce = false;
  /* slot-indexed and sparse; marks[i] is null until judged (NJA-3162) */
  let placed = [], marks = [], submitted = false;
  /* set while a pointer drag is in flight, so the click that ends a drag is
     not also read as a tap (NJA-3161 AC 1.3, NJA-3178 AC 1.4) */
  let dragMoved = false;
  /* These used to be const, on the grounds that the activity did not change
     with the pair. The venue choice changes the activity — a different room
     with a different person behind the counter — so they are reassigned every
     time the content is rebuilt. Left as plain bindings rather than getters so
     the forty call sites that read them stay unchanged. */
  let ACTOR = Q.activity.actor.id;
  let COACH = Q.activity.coach.name;
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
  /* One person behind the counter per venue — she sells the tickets, the
     drinks and the merch, because one room with one person is what gives the
     generator enough to talk about. Three rooms now, so three of her. */
  const ANIM = {
    axel:           { idle: 'anim/axel-idle.json',            speak: 'anim/axel-talk.json' },
    /* The gig's bartender wears the cinema worker's rig. Her id is
       unchanged, so her name, her voice, her accent and every event already
       filed under `bartender` stay where they are — this is the animation and
       nothing else. */
    bartender:      { idle: 'anim/cinema-worker-idle.json',   speak: 'anim/cinema-worker-talk.json' },
    stadium_worker: { idle: 'anim/stadium-worker-idle.json',  speak: 'anim/stadium-worker-talk.json' },
    cinema_worker:  { idle: 'anim/cinema-worker-idle.json',   speak: 'anim/cinema-worker-talk.json' },
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
  /* x and w describe only the part of the figure the crop actually shows,
     which is not the same as the whole figure: the stadium worker has a
     football at her feet and the bartender's hands sit wide and low, and
     measuring those in would drag the centring sideways by up to 60px. y and
     h stay whole-figure, because that is what the crop line is computed from.
     All six were measured off renders at 1920x1080; idle and talk frame
     identically for every character, so nothing shifts when she starts
     speaking. */
  const FIGURE = {
    bartender:      { x: 749, y: 150, w: 409, h: 920 },
    stadium_worker: { x: 741, y: 214, w: 358, h: 856 },
    cinema_worker:  { x: 702, y: 176, w: 452, h: 893 },
    axel:           { x: 732, y:  88, w: 386, h: 952 },
  };
  const CLIP_W = 1920, CLIP_H = 1080;
  /* How far down the figure to show. It is per character because the three
     people behind the counters are drawn with much larger heads than Axel is:
     56% of one of them lands at the chest rather than the waist, which crops
     the top of the hair off and fills the stage with a face. Measured by
     rendering the stage at 0.56 / 0.68 / 0.78 / 0.88 and picking the one that
     gives the composition the rest of this block describes — hair clear of the
     pause button, shoulders running off both edges, torso continuing down
     behind the chat. */
  const CROP_DEFAULT = 0.56;
  const CROP_BY = { bartender: 0.635, stadium_worker: 0.635, cinema_worker: 0.635 };
  const cropOf = character => CROP_BY[character] || CROP_DEFAULT;
  /* Scene left above the head. It is not decoration: the pause button and the
     mastery pill sit in the top 50px, and at 4.5% the hair ran behind them.

     NJA-3211. The three people behind a counter get far more of it than that.
     The design stands them BACK in the room rather than pressing them against
     the glass: a third of the stage is the room above their head — the lights,
     the shelves, the screen — and the figure sits lower and reads bigger,
     because the crop line moves up the body at the same time. Head high under
     the HUD with no room above it was the old frame; it filled the stage with
     a face and left nowhere for the venue to be. Axel keeps the old sky: he
     has no room to stand in and is only ever a bust. */
  const SKY_DEFAULT = 0.105;
  const SKY_BY = { bartender: 0.34, stadium_worker: 0.34, cinema_worker: 0.34 };
  const skyOf = character => SKY_BY[character] !== undefined ? SKY_BY[character] : SKY_DEFAULT;

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
    const y1  = top + (f.y + f.h * cropOf(character)) * s;   // where we cut the body

    const want0 = skyOf(character) * H, want1 = H;
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

  /* ---------- the room, heard ----------
     NJA-3212. Each venue brings its own looping bed, and there is no longer a
     shared one behind them. `loading.mp3` is gone: it was the club's room tone
     wearing the name of the screen it happened to debut on, and once the gig
     had that recording under its own name there was nothing general left for
     a fallback to be. The sound of loading is the chosen venue fading in —
     which is the same thing as arriving somewhere, and the reason the fade is
     long.

     A venue with no bed is therefore silent rather than borrowing someone
     else's room, and says so in the console. Read through Q rather than
     captured, because a venue switch rebuilds Q and the second night must not
     keep the first one's room. */
  const bedUrl = () => (Q.activity && Q.activity.bed) || '';
  function roomBed(volume, fade) {
    const url = bedUrl();
    if (!url) return;
    SFX.bed('room', url, { volume, fade });
  }

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
        /* The build tag rides with every event, so one release can be read
           against the one before it. It goes through init rather than
           register() because init folds it into the props applied to events
           queued during boot — Quest.Start among them. */
        window.ANALYTICS.init(Object.assign(
          { activityId: Q.activity.id, build: (j && j.build) || 'unknown' },
          (j && j.analytics) || {}));
        /* Which side of the webview this is. Set once, as a super-property, so
           every event — the NovaPals.* ones and the $screen ones alike — can be
           split by it without each call site having to remember. */
        window.ANALYTICS.register({
          in_webview: B.inApp,
          /* The split, on every event. 'scenarios' is the night as it stands;
             'mastery' is the one that keeps the scenario and drills it. */
          arm: LEARNER.arm,
          /* How many nights this child has started, and whether tonight is a
             RETURN rather than a second go in one sitting. */
          plays: LEARNER.plays,
          returning: LEARNER.returning,
          /* Whether we could remember them at all. Without this a child who
             did not come back and a child whose storage was wiped are the
             same row, and they need opposite fixes. */
          storage: LEARNER.storage,
        });
        /* Fired only on a later DAY, never on a second go in one sitting. It
           is the event the whole pivot is judged on, so it carries what the
           child brought back with them. */
        if (LEARNER.returning) {
          AN('NovaPals.Nlt.Returning', {
            plays: LEARNER.plays, daysSeen: LEARNER.daysSeen,
            daysSince: LEARNER.daysSince,
            mastered: LEARNER.mastered, known: LEARNER.known,
          });
        }
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

  /* ?venue=cinema names the night, the way ?lang= names the pair — for a
     walkthrough, and for a headless test that needs a particular room. An
     unknown name is ignored rather than fatal. */
  /* ---------- which door we came through (NJA-3216) ----------
     The app tells this page nothing: no quest, no slug, no child, no language.
     The one thing it CAN say without an app change is which URL it opened, so
     each quest tile points at its own path and the path is the message.

     `/` is the night as it has always been. Anything else is a pack name, kept
     as-is and reported on every event, so a quest can be split out in PostHog
     from the day the tiles are configured — before any content differs between
     them, which is the point: the plumbing lands first and is proved by real
     traffic, then the content behind each door can change one at a time. */
  function packSlug() {
    const raw = String(location.pathname || '/').replace(/^\/+|\/+$/g, '');
    /* Defensive: a path is a label, not a lookup, and it ends up in analytics
       and in a content key. Anything exotic is treated as the default night
       rather than trusted. */
    return /^[a-z0-9][a-z0-9-]{0,39}$/i.test(raw) ? raw.toLowerCase() : '';
  }

  function paramVenue() {
    const v = (new URLSearchParams(location.search).get('venue') || '').toLowerCase();
    return C.venues.includes(v) ? v : '';
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

    /* The heading and the sub are set in draw(), not here: they are a
       statement about which way round the pair is, and since the arrow can
       reverse that they have to be able to change with it. */
    /* The hint language opens on something real rather than nothing: a device
       we could not use still tells us the content's own default. */
    if (!C.hintable().includes(hint)) hint = C.defaultPair().native;

    /* ---------- the other direction ----------
       The picker asks which language you already speak, and English is not
       among the answers — English is what the scenario teaches. That is right
       for the children this is for, and useless for us: there is no way to sit
       down at a desk in London and see the night in Spanish.

       So the arrow between the two flags is a button. It does not add a
       language or a screen; it decides which side of the arrow English sits
       on, and the same five chips mean "the language you speak" one way round
       and "the language you want to learn" the other.

       It is reachable only from this screen, and this screen is only shown
       when nothing could answer the question — not ?lang=, not the device. A
       child on a Spanish phone never sees it. An English machine does, which
       is us. The choice rides out as its own `language_source`, so a flipped
       session is never pooled with a real one in PostHog. */
    let flipped = false;
    $('lang-go').querySelector('span').textContent = t('lang-pick-go') || 'START';

    return new Promise(resolve => {
      draw();
      $('lang-go').addEventListener('click', () => {
        if (!C.covered.includes(hint)) return;
        langSource = flipped ? 'picker-flipped' : 'picker';
        apply(flipped
          ? { native: C.learns(), target: hint }
          : { native: hint, target: C.learns() });
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
        const teaches = C.languages.find(l => l.code === C.learns()) || { name: 'English', flag: '🇬🇧' };
        /* `from` is always the language you speak and `to` always the one you
           are learning, whichever way round they are — the colours carry that
           and would be lying if the two ends swapped meaning with the flip. */
        const from = flipped ? teaches : chosen;
        const to   = flipped ? chosen  : teaches;
        $('lang-way').innerHTML = chosen
          ? '<span class="from">' + esc(from.flag || '') + ' ' + esc(from.name) + '</span>' +
            '<button type="button" class="arrow" id="lang-flip" title="' + esc(t('lang-pick-flip') || 'Swap') +
              '" aria-label="' + esc(t('lang-pick-flip') || 'Swap') + '">⇄</button>' +
            '<span class="to">' + esc(to.flag || '') + ' ' + esc(to.name) + '</span>'
          : '';
        const flip = $('lang-flip');
        if (flip) flip.addEventListener('click', () => { flipped = !flipped; draw(); });

        $('lang-title').textContent =
          (flipped ? t('lang-pick-title-x') : t('lang-pick-title')) || 'WHICH LANGUAGE DO YOU SPEAK?';
        $('lang-sub').textContent =
          (flipped ? t('lang-pick-sub-x') : t('lang-pick-sub')) || '';
        const missing = C.languages.filter(l =>
          l.code !== C.learns() && !C.covered.includes(l.code));
        $('lang-note').textContent = missing.length
          ? (t('lang-pick-missing') || 'No words yet for {0}.')
              .split('{0}').join(missing.map(l => l.name).join(', '))
          : '';
        /* Flipped, the chip is the TARGET rather than the hint, so what it
           has to be is covered — `hintable` would be the wrong list, and is
           the same five anyway until English is teachable out of itself. */
        $('lang-go').disabled = flipped
          ? !C.covered.includes(hint)
          : !C.hintable().includes(hint);
      }
    });

    function apply(p) {
      setPair(p.native, p.target);
      $('t-mode').textContent = p.native + ' \u2192 ' + p.target + ' \u00b7 ' + Q.pairs.length + ' pairs';
    }
  }

  /* ---------- picking the night (NJA-3207) ----------
     Three venues, the same nine constructions in each, a different set of
     nouns. Asked after the hint language so it can be asked in the child's own
     words, and before the quest starts so the venue rides on every event.

     "Surprise me" is an answer, not an escape hatch. It is recorded as one —
     `how: 'random'` — because a venue split that pools the children who chose
     with the children who could not be bothered is not a preference, it is a
     shrug with a bar chart on it. */
  /* There is one night out now, so there is nothing to ask. What is left of
     this is the work the chooser's tap used to do on the way past: name the
     room, unlock the audio, and bring the room's own tone up under the street.

     `NovaPals.Nlt.VenueChosen` still fires, with `how: 'only'`. The event is
     load-bearing in PostHog — it is what says a session reached the night —
     and an event that stops arriving looks exactly like a funnel falling off
     a cliff. One value in a property is a thing you can read; a missing event
     is not. */
  function pickVenue() {
    const forced = paramVenue();
    /* `venue` already holds the arm's room - the cafe for arm B, the night
       club for arm A - and this read `C.defaultVenue` instead, which threw
       that away and put every arm B session in the night club. Arm B then ran
       Max's engine over the gig's words: a mastery arm asking a child in a
       cafe for a ticket to the show. */
    const id = forced || venue;
    setPair(Q.nativeLang, Q.targetLang, id);
    V.unlock(); SFX.unlock();
    roomBed(0.30, 4000);
    AN('NovaPals.Nlt.VenueChosen', { venue: id, how: forced ? 'url' : 'only', msToChoose: 0 });
    return Promise.resolve({ venue: id, how: forced ? 'url' : 'only' });
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
      const v = paramVenue();
      if (p && p.native !== p.target &&
          C.covered.includes(p.native) && C.covered.includes(p.target)) {
        setPair(p.native, p.target, v || undefined);
      } else if (v) {
        setPair(Q.nativeLang, Q.targetLang, v);
      }
      const ok = await probeServer();
      roomBed(0.12, 1200);
      return ok;
    }

    el.classList.remove('hidden');

    /* First screen: which way round is this session? The whole content object
       is rebuilt from the answer (NJA-3204), so it comes before the title
       card and before anything that reads a pattern. */
    showPanel('intro-langs');
    SCREEN.at('Hint Language');
    await pickLanguages();

    /* Now the hint language is settled, so the screens can be written.

       NJA-3211. The title card is the SCENARIO's, not the venue's — it is
       shown before the venue is chosen, so it cannot name a place. Axel's
       line is the scenario's too: he asks what the child wants to do, which
       is a question only he can ask before the answer is known.

       The per-venue coach lines are gone with it. They were written to be
       said once the place was known — "the band's English, the bar's
       English, and the woman on the door doesn't do Spanish" — and there is
       no longer a moment between knowing the place and being in it. Only
       `copy.tap` is still read from the venue's intro block. */
    const copy = copyOf();
    $('intro-title-text').textContent = t('scenario-title') || 'A big night out!';
    $('intro-sub').textContent = t('scenario-sub') || '';
    $('intro-tap-1').textContent = copy.tap || 'Tap to continue';
    $('intro-tap-2').textContent = copy.tap || 'Tap to continue';
    $('intro-bubble').textContent = t('axel-open') || '';

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
    introAxel();
    /* The room tone does NOT start here any more. Until the venue is picked
       there is no room to be the tone of, and this screen is a street-level
       conversation with the street bed already under it. pickVenue() brings
       the chosen room up on the tap.

       His line waits for the probe, so it is his voice that says it. */
    const said = probe.then(() =>
      V.say(t('axel-open') || '', { speaker: 'axel', lang: accentOf('axel') }));

    /* The buttons arrive when he has finished asking — or when the child taps
       through him, or after a backstop, because a voice that never resolves
       (no server, muted tab, a synth that drops its onend) must not leave the
       night with no way out of it. */
    const openedAt = Date.now();
    let tapped = false;
    const tap = tapAnywhere(el).then(() => { tapped = true; });
    await Promise.race([said, tap, wait(11000)]);

    /* A device with no voice at all answers say() in the same tick, which put
       the buttons on screen in the same frame as the question and made the
       line look like a label on a menu. A floor under the wait is not a delay
       for its own sake: it is the time the question takes to be a question.
       Skipped when the child tapped, because a tap means get on with it. */
    const floor = 1300 - (Date.now() - openedAt);
    if (!tapped && floor > 0) await wait(floor);
    V.stop();

    /* The tap that starts the night. It used to be a button on a menu of
       three places; with one night out there is nothing to choose, so the
       gesture is the same one every other intro screen takes. It still has to
       BE a gesture: it is what the browser wants before any audio, and
       without it the bartender's first line arrives silent. */
    $('intro-tap-2').textContent = copy.tap || 'Tap to continue';
    await tapAnywhere(el);
    await pickVenue();

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

  /* ---------- judging a spoken answer ----------
     A tapped answer is exact by construction: the pills are the words, and
     which slot each went in is the whole question. A spoken one cannot be
     judged that way. The transcript is one model's reading of a seven-year-old
     in a room with other people in it, and the child may say the gap words on
     their own ("a ticket") or the whole line as it is printed in front of them
     ("¿Tienes a ticket?"). Both are correct answers to what was asked.

     What was here compared the transcript letter for letter against the gap
     words alone, so everything but one of those readings came out wrong: 598
     of 613 spoken answers in the last run were marked incorrect, which is not
     a measure of how the children spoke.

     Three things now count as having said it, and an exact match against any
     of them is settled here with no model and no wait. Only an inexact answer
     costs a call, and the call returns FLAGS — the engine still owns every
     number, as it does for the pills. */
  const JUDGE_DEADLINE_MS = 6000;

  /* The two readings that say the microphone, not the child, is what got it
     wrong: a transcript the judge could only call garbled, and an answer given
     in their own language. One source for both the free go and the flag the
     dashboard counts them by. */
  const freeGo = j => !!j && (j.error_type === 'typo' || j.error_type === 'native_fallback');

  function spokenTargets(pl) {
    const gaps = (pl.expectedAnswerPills || []).map(p => p.label).join(' ').trim();
    /* The gap words with any word the frame gave them back — the article of a
       `^` slot. The screen reads "Do you have a ___?", and a child who says
       "a ticket" has produced the thing being asked for exactly as much as one
       who says "ticket". */
    const phrase = (pl.cells || []).filter(c => c.gap || c.given)
      .map(c => c.w).join(' ').trim();
    /* the gap words; the line as printed, which is usually mixed; and the line
       wholly in the language they are learning, which is what a child who has
       run ahead will say */
    return [gaps, phrase, pl.expected, pl.pair && pl.pair.allTarget]
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  /* The fallback, for no server and for a call that does not come back. It is
     deliberately strict: it can only recognise the shapes it is given, and a
     generous guess here would hand out passes the engine would then count. */
  function localVerdict(text, pl) {
    const want = spokenTargets(pl);
    const words = v => E.norm(v).split(' ').filter(Boolean);
    if (want.some(w => E.norm(text) === E.norm(w)))
      return { target_produced: true, understandable: true, error_type: 'none' };
    if (want.some(w => words(text).sort().join(' ') === words(w).sort().join(' ')))
      return { target_produced: false, understandable: true, error_type: 'word_order' };
    return { target_produced: false, understandable: false, error_type: 'wrong_word' };
  }

  async function judgeSpoken(text, pl) {
    const want = spokenTargets(pl);
    if (want.some(w => E.norm(text) === E.norm(w)))
      return { target_produced: true, understandable: true, error_type: 'none', judged: 'exact' };
    if (!serverUp) return Object.assign(localVerdict(text, pl), { judged: 'local' });

    const j = await post('/api/evaluate', {
      learnerText: text,
      target: want[0],
      accept: want.slice(1),
      native: (pl.pair && pl.pair.allNative) || '',
      nativeLang: NL(), targetLang: TL(),
    }, JUDGE_DEADLINE_MS);
    if (j && typeof j.target_produced === 'boolean') return Object.assign(j, { judged: 'model' });
    return Object.assign(localVerdict(text, pl), { judged: 'local' });
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
      /* Vocabulary is the character's to hand over (NJA-3136) — and it used
         to be, unconditionally, because her line was written and the guard on
         it threw away any line that left the word out.

         Since NJA-3317 her line is a rendered pattern, and the pattern that
         sets up a QUESTION about a thing cannot name the thing first:
         "¿Qué quieres?" is exactly what makes "¿Tienes una entrada?" the
         natural reply, and it does not contain "entrada". The word was then
         introduced by nobody, and the child was left guessing which of four
         Spanish words meant ticket.

         So the job follows the line rather than being fixed: hers when she
         says the word, the coach's when she does not. */
      return { kind: 'item', by: cueCarries(it.id) ? 'actor' : 'coach',
               target: it.target, means: it.native };
    }
    /* NJA-3317 v2's third kind. The child is never asked to SAY her
       question — nothing can select it — so what is new is that they
       understood it, and the only person who can tell them what it meant is
       the coach. She cannot translate herself without stepping out of the
       scene. */
    if (plan.introducing === 'question') {
      const q = plan.askId && Q.vocabPatterns[plan.askId];
      if (!q || !q[TL()] || !q[NL()]) return null;
      return { kind: 'question', by: 'coach',
               target: q[TL()].replace(/\{[^}]+\}/g, '___'),
               means: q[NL()].replace(/\{[^}]+\}/g, '___') };
    }
    const pat = Q.vocabPatterns[plan.pair.patternId];
    return { kind: 'pattern', by: 'coach',
             target: pat[TL()].replace(/\{[^}]+\}/g, '___'),
             means: pat[NL()].replace(/\{[^}]+\}/g, '___') };
  }

  /* Any form of this item, anywhere in the line she is saying this turn. Any
     form, because the slot she says it in is not the slot the child answers in
     — she offers "una entrada" and they are asked for "la entrada", and both
     are the child meeting the word. */
  function cueCarries(itemId) {
    if (!lastCue || !itemId) return false;
    const rec = Q.vocabItems[itemId];
    const forms = rec && rec[TL()];
    if (!forms) return false;
    const line = E.norm(lastCue.line);
    return Q.forms.some(f => forms[f] && line.includes(E.norm(forms[f])));
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
  const AMBIGUOUS = F.AMBIGUOUS;
  /* Which marks mean "target language" in THIS pair, recomputed whenever the
     pair changes. Null for a target that has no marks of its own - English
     next to Spanish - and then a word is target-language only if the
     vocabulary says so, which is the only honest test there is. */
  let MARKS = null, marksFor = null;
  function targetMarks() {
    if (marksFor === Q) return MARKS;
    marksFor = Q; MARKS = F.marksFor(NL(), TL());
    return MARKS;
  }
  const looksForeign = tok => F.looksForeign(tok, targetMarks());
  const countsAsTarget = (tok, vocab) => {
    const w = bare(tok);
    return looksForeign(tok) || (vocab.has(w) && !AMBIGUOUS.has(w));
  };

  /* Is this line written in the language being taught? Used on the coach's
     side only: a coach who answers in the language the child is learning is
     not a coach. One shared word is coincidence, two is a pattern. */
  function looksTargetLanguage(text, limit = 2) {
    /* Same correction as `looksForeign`: a bare test for Spanish marks said
       YES to every Spanish sentence, including the ones written for a Spanish
       child in their own language. */
    const m = targetMarks();
    if (m && m.test(text)) return true;
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
      /* Arm B opens the block with the coach, so it needs the prompt written
         for a coach who speaks FIRST - no {{actor_line}} in it, because she
         has not said anything yet. */
      coachRules: (MASTERY_ARM && Q.prompts.coachOpenRules) || Q.prompts.coachRules,
      /* Max's section 6. The server turns it into the rule the coach is told;
         it is derived from the record and is never the model's to choose. */
      level: plan.level == null ? undefined : plan.level,
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
      /* NJA-3341 part one, and NJA-3325's greeting exception. The goal is the
         group's own reason for the exchange; `firstTurn` is the only turn all
         night on which the coach may open with a hello. */
      goal: plan.goal || '',
      /* The turn's speech act and its word, so the coach is told what the
         sentence does and which thing it is about rather than inferring both
         from a cafe. */
      act: plan.act || '',
      turnWord: plan.turnWord || null,
      firstTurn: plan.nightIndex === 0 && !plan.revision && !plan.makeup,
      /* NJA-3317. The character's line is in the target language now, so the
         coach is told what it meant and which of its words are new — he is
         the only one who can say either, and he cannot say what he is not
         told. Filled in at the call site, where the line exists. */
      actorLineNative: '',
      newTargetWords: [],
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
    /* Turn one asks neither model, so both lines here are the whole of it.
       Hers is an actor pattern like every other line of hers (NJA-3317), and
       his therefore has to do what every other coach line does: say what she
       just said before saying what to do about it. It used to quote the
       child's own sentence back at them in their own language — "you want
       «Excuse me»" — which was doing work only while the coach also handed
       over the Spanish, and has been a tautology since it stopped. What the
       construction is FOR is the useful half. */
    const cue = Q.actorSay ? Q.actorSay('in-a-minute', {}) : null;
    return {
      actor_line: cue ? cue.line : t('open-actor'),
      coach_line: cue ? t('open-coach', unstop(cue.line), unstop(cue.native))
                      : t('open-coach-bare'),
    };
  }

  /* ---------- NJA-3317: the character's line ----------
     It is rendered from an actor pattern rather than asked for. What that
     buys, in order of how much it matters:

       - she speaks the language the child came here to learn, which is the
         whole ticket
       - the seven actor acceptance criteria hold by construction instead of
         on average, so the test the ticket asks for is a test of the renderer
         rather than of a model's mood
       - the first model call of every turn is gone. It sat on the critical
         path — nothing could be drawn until it landed, cold instance, cold
         model, child staring at a spinner — and it is now a string lookup.

     `avoid` is last turn's pattern so the same question is not asked twice
     running; `itemId` carries the previous turn's noun into a line that has a
     slot but no answer of its own to take it from ("Here's the t-shirt." then
     "Thank you."). */
  /* What the last answer moved, largest first. Max's section 9 feeds this to
     a per-answer popup; for now it rides on the event so the dashboard can
     see whether a turn was worth anything. */
  let lastMoved = [];
  let revisionSaid = false;
  let lastCue = null, lastItemId = null, lastPatternId = null;
  function cueFor(plan) {
    /* NJA-3317 v2. On a venue that runs question-answer groups the engine
       names her line: which question, about which word, and whether her frame
       has crossed yet. There is nothing to choose — the group IS the choice —
       so the cue map below is only the path the other two venues still take. */
    if (plan.askId) {
      const g = Q.actorSay(plan.askId, {
        itemId: plan.askItem,
        frameTarget: plan.askTarget,
        expected: [plan.expected, plan.pair.allTarget],
      })
      /* A question that contains the child's own answer is a content mistake,
         not a reason to leave her silent: render it anyway so the mistake is
         on screen where somebody will see it. */
      || Q.actorSay(plan.askId, { itemId: plan.askItem, frameTarget: plan.askTarget });
      if (g) {
        lastCue = g;
        lastPatternId = plan.pair.patternId;
        if (g.itemId) lastItemId = g.itemId;
        /* Her frame is the child's own language until the group's last
           exchange, so only the word in the slot has been MET in the target
           one — marking the frame would turn "Do you have" blue and offer a
           child a Spanish translation of English. */
        for (const w of askTargetWords(plan, g))
          for (const t of String(w).split(/\s+/)) { const k = bare(t); if (k) metWords.add(k); }
        return g;
      }
    }
    return cueFromMap(plan);
  }

  function cueFromMap(plan) {
    const want = plan.pair.itemId || lastItemId;
    /* The two or three steps of one construction are ONE exchange, seen again
       with more of it in the target language each go. So she asks once and
       stands there: the same line, word for word, until the construction
       changes. Re-choosing between steps would tell the child she had asked
       them something new when all that moved was how much of the answer they
       now have to find themselves.

       The repeat guard therefore only fires on the turn the construction
       changes, and it compares the LINE rather than the pattern — two
       constructions running can both want `would-you-like-x` and still be two
       different questions about two different things. */
    const changed = plan.pair.patternId !== lastPatternId;
    lastPatternId = plan.pair.patternId;
    if (!changed && lastCue) return lastCue;
    const c = Q.cue(plan.pair.patternId, {
      itemId: want,
      avoid: lastCue ? lastCue.line : null,
      expected: [plan.expected, plan.pair.allTarget],
    });
    if (c) {
      lastCue = c;
      if (c.itemId) lastItemId = c.itemId;
      for (const w of String(c.line).split(/\s+/)) { const k = bare(w); if (k) metWords.add(k); }
    }
    return c;
  }

  /* Her words, once said, stay blue and tappable wherever they turn up again
     — in the coach's bubble, in the transcript. Before NJA-3317 that fell out
     of the engine's `introduced` flags, because everything she said in the
     target language had been introduced by the engine. Now she introduces
     things herself. */
  const metWords = new Set();

  /* Which of her words the child has been told the meaning of. Coach AC 1 is
     "translate anything new, don't re-translate", and this is what "new" is
     measured against: a word is new exactly once, the first time she says it. */
  const translated = new Set();
  /* This turn's answer from `newTargetWords`, kept because asking twice would
     answer no the second time — it marks as it reads. The floor needs the same
     answer the model gets. */
  let turnFresh = [];
  /* A sentence about to be dropped inside quotation marks inside another
     sentence. Its own full stop then lands next to the outer one —
     “in a minute.”. — and reads as a typo. A question mark stays: it is part
     of the Spanish and part of what the Spanish means. */
  const unstop = str => String(str == null ? '' : str).replace(/\.\s*$/, '');
  /* Which words of her line are in the TARGET language. Before NJA-3317 v2
     that was all of them; now her question starts in the child's own language
     with one word of the target in it, so the two halves have to be told
     apart — "Do you have una entrada?" must not paint "Do you have" blue, and
     the coach must not be told that "have" is a Spanish word he owes the
     child a translation of. */
  function askTargetWords(plan, cue) {
    if (!cue) return [];
    if (cue.frameTarget !== false) return String(cue.line).split(/\s+/);
    const rec = plan.askItem && Q.vocabItems[plan.askItem];
    const forms = rec && rec[TL()];
    if (!forms) return [];
    return (Q.forms || []).map(f => forms[f]).filter(Boolean);
  }

  /* On a mixed exchange the new thing is exactly one word, and the engine
     already knows which — so take it from the engine rather than reading it
     back out of her sentence. Reading it back picks up whatever punctuation
     stood next to it and drops any article the ambiguity test will not vouch
     for, which is how "el disco" came out as “disco?”. */
  function newItemWord(plan) {
    const it = (plan.pair.items || []).find(i => i.id === plan.askItem)
            || (plan.pair.items || [])[0];
    if (!it || !it.target) return [];
    const key = bare(it.target);
    if (!key || translated.has(key)) return [];
    translated.add(key);
    for (const t of String(it.target).split(/\s+/)) { const k = bare(t); if (k) translated.add(k); }
    return [{ text: it.target, means: it.native }];
  }

  function newTargetWords(line, targetWords) {
    const all = new Set();
    for (const w of (targetWords || String(line).split(/\s+/)))
      for (const t of String(w).split(/\s+/)) { const k = bare(t); if (k) all.add(k); }
    const out = [];
    /* `allTarget` only where the whole line IS the target language; on a mixed
       line the ambiguity test still has a job, because "a" in "a ticket" is a
       Spanish word in one direction and an English one in the other. */
    const whole = !targetWords;
    for (const f of F.fragments(String(line), all, Q.phrases, { allTarget: whole })) {
      if (f.type !== 'target') continue;
      const text = String(f.text).trim();
      const key = bare(text);
      if (!key || translated.has(key)) continue;
      translated.add(key);
      const m = f.translation || gloss(text);
      if (m && !/^\(part of/.test(m)) out.push({ text, means: m });
    }
    return out;
  }

  /* NJA-3317 removed `generateActorLine`. The character's line is rendered
     from an actor pattern by `cueFor` above, which is why the guards that used
     to sit here — the introduced-word audit, the stolen-line check, the
     half-translated-phrase check — are gone with it: a rendered line cannot
     reach past the vocabulary it was rendered from, and cannot say the child's
     own line back at them because `q.cue` refuses one that contains it.
     `auditLine`, `stolenWords` and `badPhrases` stay; the coach still runs on
     a model and still needs watching. */

  /* What the coach may legitimately write in the target language, in arm B.
     `introducedWords` reads arm A's exposure ratchet - `state.items`,
     `state.patterns` - and arm B never touches it: it ratchets through
     MASTERY.apply instead. So the set came back EMPTY on every turn, and the
     audit below threw away every coach line that contained a single English
     word. It threw away 100% of them. The child read the written floor all
     night and we were paying for a model call a turn to produce lines nobody
     ever saw - including good ones: "La leche es milk en inglés" is exactly
     what the prompt asks for.

     Same rule as arm A, read from the record that arm B actually keeps: every
     word they have met, every construction they have been taught, and the
     words this turn is handing over - which the prompt orders the coach to
     write, so refusing them is asking for a line and rejecting it for being
     the line we asked for. */
  function masteryAllowed(fresh) {
    const out = new Set();
    const add = str => { for (const w of String(str).split(/\s+/)) { const k = bare(w); if (k) out.add(k); } };
    const rec = (state && state.mastery) || { words: {}, patterns: {} };
    for (const [id, w] of Object.entries(rec.words || {})) {
      const it = w && w.seen && Q.vocabItems[id] && Q.vocabItems[id][TL()];
      if (it) for (const f of (Q.forms || ['bare', 'definite', 'indefinite'])) if (it[f]) add(it[f]);
    }
    for (const [id, pt] of Object.entries(rec.patterns || {}))
      if (pt && pt.introduced && Q.vocabPatterns[id] && Q.vocabPatterns[id][TL()])
        add(String(Q.vocabPatterns[id][TL()]).replace(/\{[^}]+\}/g, ' '));
    for (const f of (fresh || [])) add(f.text);
    return out;
  }

  /* The coach's line, asked for only once the character's is settled. */
  async function generateCoachLine(plan, actorLine, actorNative, fresh) {
    if (!serverUp) { lastCoachWhy = 'no server'; return null; }
    const t0 = Date.now();
    const j = await post('/api/coach',
      Object.assign(turnBody(plan), {
        actorLine,
        /* NJA-3317. He is the only one who can say what she meant. */
        actorLineNative: actorNative || '',
        newTargetWords: (fresh || []).map(f => f.text + ' = ' + f.means),
        recentCoach: recentCoach.slice(-6),
      }),
      COACH_DEADLINE_MS);
    lastCoachMs = Date.now() - t0;
    if (j.fail) { lastCoachWhy = j.fail; return null; }
    if (!j.coachText) { lastCoachWhy = 'empty'; return null; }
    /* A coach who answers in the language the child is learning is not a
       coach. The one exception is the construction they are introducing, which
       the audit below already allows for. */
    const intro = newThing(plan);
    const allowed = MASTERY_ARM ? masteryAllowed(fresh) : introducedWords();
    if (intro && intro.by === 'coach') for (const w of String(intro.target).split(/\s+/)) allowed.add(bare(w));
    /* NJA-3317 coach AC 1 asks him to say what her words mean, which he cannot
       do without writing them. So the line she just said is allowed through
       the audit — and nothing else is, which is the same rule as before with
       one more source of legitimate target-language words in it. */
    for (const w of String(actorLine || '').split(/\s+/)) { const k = bare(w); if (k) allowed.add(k); }
    if (auditLine(j.coachText, allowed).over > 0) { lastCoachWhy = 'wrote in the target language'; return null; }
    /* On target, or not at all. Told to teach `milk` with no situation to put
       it in, the model wrote a situation of its own and offered the child a
       juice, a coffee and a tea on three turns running - all in the child's
       own language, so the audit above waved them through. A hint that names
       a thing this turn is not about is worse than the written floor, because
       the floor at least names the right one. The construction's `goal` now
       carries the word, so this should be rare; it is the backstop. */
    if (MASTERY_ARM && plan.itemId) {
      const it = Q.vocabItems[plan.itemId] || {};
      const nat = String((it[NL()] || {}).bare || '').toLowerCase();
      const tgt = String((it[TL()] || {}).bare || '').toLowerCase();
      const line = String(j.coachText).toLowerCase();
      if (nat && tgt && line.indexOf(nat) < 0 && line.indexOf(tgt) < 0) {
        lastCoachWhy = 'named something the turn is not about';
        return null;
      }
    }
    const mixed = mixedQuote(j.coachText);
    if (mixed) { lastCoachWhy = 'quoted a half-translated sentence: ' + mixed; return null; }
    /* Coach AC 3, and the reason the prompt alone was never going to be
       enough: the single most tempting thing for a coach to write is the
       sentence the child is about to be marked on. Checked against both the
       step's expected answer and the construction said whole, so wrapping it
       in a native frame does not get it past. */
    const answer = [plan.expected, plan.pair.allTarget].filter(Boolean);
    if (answer.some(a => E.norm(j.coachText).includes(E.norm(a)))) {
      lastCoachWhy = 'gave the answer away'; return null;
    }
    lastCoachWhy = 'gemini';
    recentCoach.push(j.coachText);
    return j;
  }

  /* ---------- fragments ----------
     NJA-3149: a message is a role plus a list of {type, text} fragments, and a
     `target` fragment renders highlighted. The server returns them for the two
     generated lines; these build the same shape for everything else — template
     lines, and the child's own answer — so one renderer serves the lot. */
  /* `opts.allTarget` for a line that is wholly in the target language — the
     character's, since NJA-3317. */
  function toFragments(text, extraAllowed, opts) {
    const allowed = introducedWords();
    /* ...plus everything the character has actually said this session. Since
       NJA-3317 she introduces target-language words herself, and a word she
       has said is a word the child can tap. */
    for (const w of metWords) allowed.add(w);
    for (const w of extraAllowed || []) for (const t of String(w).split(/\s+/)) allowed.add(bare(t));
    return F.fragments(text, allowed, Q.phrases, opts);
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
    /* Arm B's floor. She has not spoken, so there is nothing of hers to
       translate and nothing for `heard` to say - the whole first half of this
       function is about her line. What is left is the instruction, plus the
       new word, which `coachCopy` badges on afterwards. */
    if (MASTERY_ARM) {
      const asks = tList('fb-coach-ask');
      const line = asks[state.turn % asks.length]
        .split('{0}').join(plan.pair.allNative)
        .split('{1}').join(Q.languageNames.target);
      return { actor_line: '', coach_line: line };
    }
    /* Arm A's scripted opening beat, and arm A's alone: it is the bartender
       not looking up, which is a night-club demo rather than a first block.
       Checked AFTER arm B above, because arm B's turn one is a block like
       every other block of Max's order. */
    if (E.isOpener(state)) return openingLines(plan);
    const intro = newThing(plan);
    /* Only reached by a construction with no entry in ACTOR_CUES at all, which
       is a content gap rather than a runtime failure. The floor under it is
       still an actor pattern, so even the gap speaks the right language; the
       hint-language strings below it are the floor under the floor. */
    const asks = tList('fb-actor-ask');
    let actor = ((Q.actorSay && Q.actorSay('what-would-you-like', {})) || {}).line
             || asks[(state.turn + plan.pair.id.length) % asks.length];

    /* The native sentence is the MEANING, and the line says so by naming the
       language it has to come out in. Quoting it after a bare "repeat it" told
       a Spanish child to repeat Spanish. */
    const coachAsks = tList('fb-coach-ask');
    const ask = coachAsks[state.turn % coachAsks.length];
    /* What she said, before what to do about it. The model is told to do this
       and does; the written floor could not, because it was written when she
       spoke the child's own language and had nothing to translate. A child who
       hits the floor on a slow turn was being handed a hint about a sentence
       they cannot read.

       Only when there is something new in her line — `turnFresh` is the same
       list the coach is sent, so this falls silent on the second and third
       step of a construction, where she repeats herself word for word. */
    /* On the exchange where her QUESTION crosses, the thing to translate is
       the question. On every other exchange her frame is already in the
       child's language and the only new thing in it is the word — so
       translating the whole line would be translating English into English.
       NJA-3324's desired behaviour is the second one: "Una entrada means
       ticket." */
    const heard = !(lastCue && turnFresh.length) ? ''
      : (lastCue.frameTarget !== false)
        ? t('fb-coach-heard', unstop(lastCue.line), unstop(lastCue.native)) + ' '
        : t('fb-coach-heard', unstop(turnFresh[0].text), unstop(turnFresh[0].means)) + ' ';
    let coach = heard + ask
      .split('{0}').join(plan.pair.allNative)
      .split('{1}').join(Q.languageNames.target);
    /* The TARGET phrase, not the native one. "Here's how you say it" promises
       the language the child is about to produce, and it was being handed the
       language they already speak — so a Spanish child learning English was
       told "Así se dice: «Perdona.»", which teaches them nothing and teaches
       it in the wrong direction. Wrong both ways round; only visible once the
       pair could be reversed. */
    /* The MEANING, not the answer — NJA-3317 coach AC 3. */
    if (intro && intro.kind === 'pattern') coach = heard + t('fb-coach-new', plan.pair.allNative);
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
    /* NJA-3317 coach AC 3. The badge shows the construction with its slots
       still blank — "¿Tienes ___?" is a shape, not an answer, and seeing it
       is how a child learns there is a shape at all. But a construction with
       no slot in it (`excuse-me`, `thank-you`) blanks to the whole sentence,
       and printing that IS handing over the answer. For those the badge keeps
       the meaning and drops the words: they are on the one pill in front of
       the child, which taps for the gloss and the sound. */
    /* ...and not at all when the line above already carries that meaning,
       which it does on the turn a zero-slot construction is introduced: the
       written floor names it, and the badge would say it twice. */
    /* ...and `whole` is about a CONSTRUCTION said end to end. A word is not a
       construction: "una entrada" is not an answer to anything, it is the
       vocabulary the child is owed, and handing it over spelled out is the
       whole point of owing it. */
    const whole = owed && intro.kind === 'pattern' && intro.target.indexOf('___') < 0;
    if (whole && ask.toLowerCase().includes(String(intro.means).toLowerCase().replace(/[.?!]+$/, ''))) {
      return { askText: ask, html: fragmentsHTML(frags), fragments: frags };
    }
    const badge = !owed ? ''
      : whole
        ? `<span class="newword"><i>${esc(intro.means)}</i></span>`
        : `<span class="newword">${fragmentsHTML(toFragments(intro.target, [intro.target]))} <i>${esc(intro.means)}</i></span>`;
    /* Only when something IS owed. This was computed unconditionally and
       read `intro.target` off a null the moment an exchange had nothing new
       in it — which no exchange did until her question could be a
       construction the child already owns. */
    const tail = !owed ? ''
      : whole ? ' — ' + intro.means
      : ' — ' + intro.target + ' — ' + intro.means;
    return {
      askText: owed ? ask + tail : ask,
      html: fragmentsHTML(frags) + badge,
      fragments: !owed ? frags
        : whole ? frags.concat([{ type: 'text', text: ' — ' + intro.means }])
        : frags.concat(toFragments(' ' + intro.target, [intro.target]),
                       [{ type: 'text', text: ' — ' + intro.means }]),
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
  const LABEL   = { me: 'You' };
  /* The person behind the counter is named by the venue she works in, in the
     child's own language. This used to title-case the actor's id, which read
     fine while the id was the English word "bartender" and became
     "Cinema_worker" the moment there were three of her. */
  const label = who =>
    who === ACTOR ? (Q.activity.actor.name || who) :
    who === 'axel' ? (Q.activity.coach.name || 'Coach') :
    LABEL[who] || (who.charAt(0).toUpperCase() + who.slice(1));

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
    fill.style.width = (overall() * 100).toFixed(1) + '%';
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
    $('mastery').textContent = t('mastery-display-string', Math.round(overall() * 100));
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
    plan = MASTERY_ARM ? E.masteryTurn(state, Q) : E.planTurn(state, pair);
    if (!plan) { AN('NovaPals.Activity.Error', { reason: 'no-plan' }); return finish('no-plan'); }
    /* `current` is arm A's idea of what is being asked, and `submit` guards on
       it: with it null every answer returned silently and the night sat on
       turn one for ever. Arm B has no stage to point at, so it points at the
       pair the planner chose. */
    if (MASTERY_ARM) current = plan.pair;
    /* `seen` is arm A's exposure ratchet, keyed on its steps. Arm B's record
       is ratcheted by MASTERY.apply instead, where every number lives. */
    if (!MASTERY_ARM) E.seen(state, plan);
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
    const written = !MASTERY_ARM && E.isOpener(state);

    /* The character's line, rendered rather than asked for (NJA-3317). This
       used to be the first of three model calls and the only one on the
       critical path: nothing could be drawn until it landed. It is now a
       lookup, so the spinner above comes down in the same frame it went up. */
    /* Arm B asks for no cue. She does not open the block in Max's order, so
       rendering a line nobody shows is not merely wasted: `cueFor` sets
       `lastCue` and marks her words as MET, and that line then leaked into
       the coach's written floor and into the badge, telling a child what a
       sentence meant that they had never been shown. */
    const cue = MASTERY_ARM ? null : cueFor(plan);
    $('turn-loading').classList.add('hidden');

    /* The revision round, announced once and by Axel rather than by a banner.
       Five exchanges that look like the night starting over, with nothing
       said, read as a bug; one line from him makes them the point. */
    if (plan.revision && !revisionSaid) {
      revisionSaid = true;
      const line = t('revision-axel') || '';
      if (line) {
        const rf = toFragments(line);
        say('axel', fragmentsHTML(rf), line, rf);
        AN('NovaPals.Nlt.RevisionStart', { steps: (state.plan || []).length, venue });
      }
    }
    lastGenMs  = 0;
    lastGenWhy = MASTERY_ARM ? 'arm B: she does not open'
      : cue ? 'cue ' + cue.id : 'no cue for ' + plan.pair.patternId;

    /* Worked out HERE and nowhere else, because it has a side effect: a word
       counts as new exactly once, and asking twice would answer no the second
       time. Before `fallbackLines`, because the written floor reads it — a
       turn's hint must not translate her line against last turn's answer. */
    /* The target-language half of her line, and what is new in it. Both are
       worked out HERE and nowhere else, because `newTargetWords` marks as it
       reads: asking twice would answer no the second time. */
    const askWords = askTargetWords(plan, cue);
    const mixed = !!cue && cue.frameTarget === false;
    /* Arm B has no line of hers to read the new word out of, because she has
       not spoken. It comes off the engine's own item instead, which is where
       it was always truer anyway - `newItemWord` exists because parsing it
       back out of her sentence once produced `"disco?" means "record"`. */
    const fresh = turnFresh = MASTERY_ARM ? newItemWord(plan)
      : !cue ? []
      : mixed ? newItemWord(plan)
      : newTargetWords(cue.line, null);

    const fb = fallbackLines(plan);
    const actorLine   = cue ? cue.line   : fb.actor_line;
    const actorNative = cue ? cue.native : plan.pair.allNative;
    const actorFrags = mixed
      ? toFragments(actorLine, askWords)
      : toFragments(actorLine, [actorLine], { allTarget: true });
    turnLine = MASTERY_ARM ? '' : actorLine;

    /* The one model call left: the coach, told what she said, what it meant,
       and which of its words the child is meeting for the first time. Fired
       now, awaited later — it has until her audio finishes, which is when the
       coach has always been allowed to speak. */
    if (written) lastCoachWhy = 'written opening';
    const coachPending = written
      ? Promise.resolve(null)
      : generateCoachLine(plan, actorLine, actorNative, fresh);

    mountBackground($('layer-bg'), Q.activity.background);
    mountCharacter($('character'), { character: ACTOR, state: 'idle' });

    hinted = false;
    attempts = 0;
    misheardOnce = false;
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
    setLocked(true);
    /* ---------- who speaks first ----------
       Arm A: she asks, he hints, they answer. Arm B runs Max's order - the
       coach opens the block, they produce, and SHE reacts afterwards, which
       is `sayReaction` on the way out of `submit`.

       His order is why his content works and ours went vague. A character who
       opens has to ask something the child's line answers, and there is no
       question a server asks that draws out "Where is the hotel?". A coach who
       opens just says to ask her. */
    const characterDone = MASTERY_ARM
      ? Promise.resolve()
      : (say(ACTOR, fragmentsHTML(actorFrags), actorLine, actorFrags),
         V.say(actorLine, { speaker: ACTOR, lang: accentOf(ACTOR) }));

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
        'actor: ' + lastGenWhy + ' · ' +
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
    /* The engine's position in the CURRENT plan. Kept as it was so the old
       dashboards still read, but it is no longer a position in the night:
       the revision round replaces the plan and starts again at 0, so an
       index of 2 can be the third question or the third thing they are being
       shown again. The three below are what a report should group on. */
    questionIndex: state ? state.at : 0,
    /* 'night' | 'revision' | 'makeup' — which of the three parts this
       exchange belongs to. */
    phase: pl.phase || 'night',
    /* 0..16, this exchange's fixed place in the night, whatever phase it is
       being met in. Null on a venue with no groups. */
    nightIndex: pl.nightIndex == null ? undefined : pl.nightIndex,
    /* "1:3" — the canonical identity of an exchange: which group, which rung.
       Stable across phases, across replays and across venues. */
    stepKey: pl.stepKey || '',
    /* open | door | drinks | order | close, or the construction's own id on
       the mastery arm, which has no groups. */
    groupId: pl.group || '',
    /* ---------- the mastery arm ---------- */
    /* Which engine drew this turn. On every event already, as a super
       property, but repeated here so a question can be read on its own. */
    arm: ARM,
    /* Max's L0 to L4, derived from mastery rather than chosen. The thing to
       watch: if it never climbs, the child is not learning; if it climbs and
       then falls, the model is right and the content is too hard. */
    level: pl.level == null ? undefined : pl.level,
    /* Which of his section 7 phases picked this turn. */
    masteryPhase: pl.phaseKind,
    /* Where the two items stood BEFORE the answer, so a move can be read
       without joining to the turn before. */
    masteryPattern: pl.masteryPattern == null ? undefined : pl.masteryPattern,
    masteryWord: pl.masteryWord == null ? undefined : pl.masteryWord,
    patternId2: pl.patternId,
    wordId: pl.itemId || undefined,
  });

  /* ---------- the turn loop ---------- */
  function step() {
    if (state.finished) return;
    /* Arm B has no list to be at the end of. It stops when the scenario is
       finished or when the night has run its length, which is Max's 15 to 20
       blocks and the reason a mastered scenario can end early. */
    if (MASTERY_ARM) {
      const why = E.masteryDone(state, Q);
      if (why) return finish(why);
      current = null;
      return renderTurn();
    }
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
  /* NJA-3317. The reaction used to be a third model call, and it was by
     construction a line in the child's OWN language — which is the one thing
     the ticket's first actor criterion forbids. Two zero-slot actor patterns
     cover what it was for: she takes the order, or she did not catch that.
     Short on purpose; the banner is already up and the next cue is the real
     reply to what they said. */
  function reactionLine(wasCorrect) {
    const map = Q.actorReactions || { right: 'ok-then', wrong: 'say-again' };
    /* What she says back depends on what was SAID to her, where the scenario
       has written her an answer for it. A wrong answer is still "Sorry?" -
       she did not understand, and that is not per-construction. */
    const own = wasCorrect && Q.actorReplies && plan &&
                Q.actorReplies[plan.patternId];
    const out = Q.actorSay(own || map[wasCorrect ? 'right' : 'wrong'], {
      expected: [plan && plan.expected, plan && plan.pair && plan.pair.allTarget],
    });
    /* A construction with no answer written for it falls back rather than
       standing there silent. */
    const fb = out || (own ? Q.actorSay(map[wasCorrect ? 'right' : 'wrong'], {}) : null);
    return fb ? fb.line : null;
  }

  async function sayReaction(said, wasCorrect) {
    const line = reactionLine(wasCorrect);
    if (!line) return;
    for (const w of String(line).split(/\s+/)) { const k = bare(w); if (k) metWords.add(k); }
    const frags = toFragments(line, [line], { allTarget: true });
    say(ACTOR, fragmentsHTML(frags), line, frags);
    await V.say(line, { speaker: ACTOR, lang: accentOf(ACTOR) });
  }

  async function submit(text, mode) {
    if (busy || !current || submitted) return;
    busy = true;
    submitted = true;
    /* The challenge is for a child who did the night on the pills. One spoken
       answer and it is not a challenge any more, it is a repeat. */
    if (mode === 'voice') voiceAnswers += 1;
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
    let v, spoken = null;
    if (mode === 'chips') {
      v = E.validate(placed, plan);
      marks = v.marks;
    } else {
      /* An inexact answer costs a model call, so the wait is named rather
         than left as a dead second between speaking and being told. */
      $('verdict').textContent = t('checking');
      spoken = await judgeSpoken(said, plan);
      $('verdict').textContent = '';
      v = { correct: !!spoken.target_produced };
      marks = new Array(slotCount()).fill(v.correct);
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
        /* only on the spoken path, and only ever flags: judgedBy says whether
           a model was needed at all, errorType what it made of the answer.
           Together they are what tells a mishearing from a wrong answer. */
        judgedBy: spoken ? spoken.judged : undefined,
        errorType: spoken ? spoken.error_type : undefined,
        /* true where the answer was not counted against them because the
           transcript, not the child, is what went wrong */
        misheard: spoken ? (!v.correct && !misheardOnce && freeGo(spoken)) : undefined,
      }));

    /* ---------- a mishearing is not a wrong answer ----------
       The transcript is a model's reading of a child in a room with a band in
       it, and sometimes it is a reading of something they did not say.
       Charging that to one of their three attempts spends the turn on the
       microphone's mistake, and the mastery number then records a phrase they
       could not say when what happened is that nobody heard them.

       Two of the judge's readings get a free go. A transcript it could only
       call garbled, and an answer given in their own language — which is a
       thing to be told, not a thing to be marked. One per turn, so it cannot
       be farmed, and it is still sent to the dashboard, because how often this
       happens is the number the speech funnel turns on. */
    if (!v.correct && spoken && !misheardOnce && freeGo(spoken)) {
      misheardOnce = true;
      say('me', esc(said), said, null, 'wrong');
      const again = spoken.error_type === 'native_fallback'
        /* already written, already translated, and it names the language,
           which is the whole of what they need told */
        ? t('fb-coach-ask', plan.pair.allNative, Q.languageNames.target)
        : t('misheard', said);
      say('axel', esc(again), again);
      /* the pane goes back to how it was before they spoke: nothing marked,
         nothing spent */
      marks = new Array(slotCount()).fill(null);
      submitted = false;
      renderSlot();
      renderTray();
      syncSay();
      busy = false;
      return;
    }

    if (v.correct) {
      say('me', spanishHTML(said), said, null, 'right');
      const before = overall();
      let ph = { pattern: null, item: null };
      if (MASTERY_ARM) {
        /* Every number is decided in MASTERY and nowhere else. This says what
           happened; the model says what it is worth. */
        lastMoved = E.masteryApply(state, plan, { correct: true, hints: hinted ? 1 : 0, attempt: 0 });
        saveMastery();
      } else {
        ph = E.applyCorrect(state, plan, { hinted });
      }
      if (overall() > before + 1e-6) pulseMastery();
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
      /* Arm A folds her acknowledgement into the line that opens the next
         turn, so a separate reaction bubble said the same thing twice. Arm B
         has no next line of hers - the coach opens - so the reaction IS her
         turn in the block, and it is the only target language she speaks. */
      await atLeast(MASTERY_ARM ? sayReaction(said, true) : Promise.resolve(), BANNER_MIN_MS);
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
    let n;
    if (MASTERY_ARM) {
      /* Only the first miss of a turn is charged, which is the model's rule
         and not this file's: retries inside one turn are free. */
      lastMoved = E.masteryApply(state, plan, { correct: false, hints: hinted ? 1 : 0, attempt: attempts });
      saveMastery();
      n = attempts + 1;
    } else {
      n = E.applyWrong(state, plan).attempts;
    }
    attempts = n;
    hinted = true;
    renderHud();

    if (MASTERY_ARM ? attempts >= 3 : E.mercyDue(state)) {
      recordTurn(plan, turnLine, turnAsk, false);
      hideBanner();
      $('verdict').textContent = t('coach-says-it', COACH, plan.expected);
      /* Written, not spoken. The bartender is the only one who talks out loud
         without being asked; the coach's voice is available on a tap — the
         hint sheet has a button, and every highlighted word reads itself. */
      await new Promise(r => setTimeout(r, 900));
      if (MASTERY_ARM) saveMastery(); else E.applyMercy(state, plan);
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
  /* The per-phrase list on the end screen. `said` is the set of patternIds a
     child has since spoken out loud, which the challenge hands back so the
     list can show what it cost them to earn. */
  function renderEndList(rows, said) {
    const label = { stuck: 'end-stuck-label', shaky: 'end-shaky-label', missed: 'end-missed-label' };
    $('end-list').innerHTML = (rows || []).map(r =>
      '<div class="end-row ' + r.verdict + '">' +
        '<span class="ph">' + esc(r.target) + '<small>' + esc(r.native) + '</small></span>' +
        '<span class="vd">' + esc(t(label[r.verdict])) +
          (said && said.has(r.pair.patternId) ? ' \u2713' : '') + '</span>' +
      '</div>').join('');
  }

  function finish(reason) {
    state.finished = true;
    const score = overall();
    const mark = E.passMark(Q);
    if (MASTERY_ARM) saveMastery();
    const ok = score >= mark;
    const rows = MASTERY_ARM ? E.masteryReport(state, Q) : E.report(state, Q);
    const left = rows.filter(r => r.verdict !== 'stuck');

    E.track(state, 'session_end', {
      turns: state.turn, overall: score, passed: ok, go: state.go, reason,
    });
    AN('NovaPals.Activity.End', Object.assign({
      turns: state.turn, mastery: Math.round(score * 100), passed: ok,
      go: state.go, reason,
    }, MASTERY_ARM ? {
      /* What the night was worth, which is the only reading that survives to
         tomorrow. `mastered` means the scenario is finished and there is
         nothing to come back for, which is a result and not a failure. */
      masteredWords: Object.values(state.mastery.words || {}).filter(w => w.mastery >= window.MASTERY.BAR).length,
      knownWords: Object.keys(state.mastery.words || {}).length,
      introducedPatterns: Object.values(state.mastery.patterns || {}).filter(p => p.introduced).length,
      sessionIndex: state.mastery.sessionIndex,
      finishedScenario: reason === 'mastered',
    } : {}));
    AN('NovaPals.Quest.End', { mastery: Math.round(score * 100), passed: ok });

    /* Arm B does not pass or fail a night. It stops, keeps the record, and
       asks them back - which is the behaviour under test, so it gets its own
       ending rather than being squeezed into a pass mark it has no use for. */
    if (MASTERY_ARM) {
      const done = reason === 'mastered';
      $('end-msg').textContent = t(done ? 'again-done-title' : 'again-title');
      $('end-score').textContent = t('mastery-display-string', Math.round(score * 100));
      $('end-sub').textContent = done ? t('again-done-sub') : t('again-sub', Math.round(score * 100));
    } else {
      $('end-msg').textContent = t(ok ? 'end-passed-title' : 'end-short-title');
      $('end-score').textContent = t('mastery-display-string', Math.round(score * 100));
      $('end-sub').textContent = t(ok ? 'end-passed-sub' : 'end-short-sub', Math.round(mark * 100));
    }

    /* The bar exists so the number has somewhere to be: the tick is the pass
       mark, and whether the fill reaches it is the result. */
    $('end-fill').style.width = Math.round(score * 100) + '%';
    $('end-fill').classList.toggle('pass', ok);
    $('end-mark').style.left = 'calc(' + Math.round(mark * 100) + '% - 1px)';

    endRows = rows;
    renderEndList(rows, null);

    /* Three ways back in, and they are not the same offer: one goes somewhere
       new, one redrills only what did not stick, the other starts this night
       over. */
    const some = $('btn-again'), all = $('btn-restart'), other = $('btn-another');
    some.querySelector('span').textContent = t('end-replay-some');
    all.querySelector('span').textContent = t('end-replay-all');

    /* ---------- the spoken challenge (NJA-3213) ----------
       Offered to a child who finished the night, passed it, and did the whole
       thing by tapping — someone with nothing left to prove on the pills. The
       recorder and the server are both required: the browser's own speech
       recognition does not exist in an iOS webview, and a dare that cannot be
       answered is worse than no dare. Once a session, however many venues. */
    const lines = speakLines(rows);
    const dare = reason === 'complete' && ok && voiceAnswers === 0 && !speakOffered &&
                 canRecord() && serverUp && lines.length >= 2;
    const say = $('btn-speak');
    say.classList.toggle('hidden', !dare);
    $('end-axel').classList.toggle('hidden', !dare);
    $('end-spoken').classList.add('hidden');
    if (dare) {
      speakOffered = true;
      say.querySelector('span').textContent = t('speak-offer');
      $('end-axel').textContent = t('speak-axel-dare');
      say.onclick = () => openSpeak(lines);
      AN('NovaPals.Nlt.SpeakChallengeOffered', {
        venue, go: state.go, mastery: Math.round(score * 100), lines: lines.length,
      });
    }
    /* It stands IN THE PLACE OF practise-what-is-left rather than beside it. */
    some.classList.toggle('hidden', left.length === 0 || dare);

    /* Somewhere they have not been yet, by preference — a child who has done
       the gig twice is offered the cinema rather than a third gig. */
    /* Arm B is the same scenario, every night, until it is mastered. "Try
       somewhere else" is the opposite of the thing being tested. */
    const list = MASTERY_ARM ? [] : C.venueList(NL());
    const nextVenue = list.find(v => played.indexOf(v.id) < 0) ||
                      list.find(v => v.id !== venue) || null;
    other.classList.toggle('hidden', !nextVenue);
    $('end-ask').classList.toggle('hidden', !nextVenue);
    if (nextVenue) {
      $('end-ask').textContent = t('end-another-ask');
      other.querySelector('span').textContent = t('end-another-go', nextVenue.name);
      other.onclick = () => goToVenue(nextVenue.id);
      AN('NovaPals.Nlt.AnotherPlaceOffered',
         { from: venue, to: nextVenue.id, passed: ok, go: state.go });
    }

    /* In a quest, finishing means completing the quest rather than looping, so
       FINISH leads and the two replays drop to secondary. Outside the app
       there is no quest to complete and no button. */
    const fin = $('btn-finish');
    fin.querySelector('span').textContent = t('end-finish');
    fin.classList.toggle('hidden', !B.inApp);
    fin.disabled = false;
    $('end-note').classList.add('hidden');
    /* Who leads. In a quest FINISH always leads, because leaving without it
       is leaving without the gems. Outside one, a child who PASSED is offered
       somewhere new — there is nothing left here for them — and a child who
       did not is offered the thing they did not get. */
    other.classList.toggle('primary', !B.inApp && ok);
    some.classList.toggle('primary', !B.inApp && !ok);
    all.classList.toggle('hidden', B.inApp && left.length > 0);

    $('end-eyebrow').textContent = t('end-eyebrow');
    SCREEN.at(ok ? 'End — Passed' : 'End — Short');
    $('end').classList.remove('hidden');
  }

  /* A second go at the material that did not land. The engine carries the
     steps that stuck at their score, so this cannot cost the child mastery. */
  /* ---------- a different night (NJA-3207) ----------
     The same nine constructions somewhere else. The content object is rebuilt
     for the new venue, which swaps the room, the person behind the counter and
     every noun, and the engine carries over only the two steps that have no
     noun in them (see switchVenue). The venue super-property is re-registered
     first, so the events of the second night are filed under the second
     venue rather than the first. */
  async function goToVenue(id) {
    voiceAnswers = 0;
    const from = venue;
    setPair(Q.nativeLang, Q.targetLang, id);
    if (played.indexOf(id) < 0) played.push(id);
    SCREEN.register({ venue: id });
    AN('NovaPals.Nlt.AnotherPlaceTaken', { from, to: id, go: (state.go || 1) + 1 });

    state = E.switchVenue(state, Q);
    revisionSaid = false;
    state.finished = false;
    $('end').classList.add('hidden');
    E.track(state, 'session_start', { activity: Q.activity.id, venue: id, go: state.go });
    AN('NovaPals.Activity.Start', { nativeLanguage: NL(), targetLanguage: TL(),
                                    stages: E.syllabus(Q).length, steps: E.allSteps(Q).length,
                                    venue: id, go: state.go });
    chatLog.length = 0;
    $('chat').innerHTML = '';
    buildRail();
    hideGloss();
    $('chat-full').classList.add('hidden');
    mountBackground($('layer-bg'), Q.activity.background);
    /* ...and the room it sounds like. SFX.bed() rebuilds on a changed url, so
       this is a cross into the new venue's tone rather than the old one
       playing on under a new picture. */
    roomBed(0.12, 1400);
    mountCharacter($('character'), { character: ACTOR, state: 'idle' });
    renderHud();
    SCREEN.at('Night');
    step();
  }

  function replayLeftovers() {
    const next = E.replay(state, Q);
    voiceAnswers = 0;
    /* A second go earns its own revision round, so the line that announces it
       has to be sayable again. */
    revisionSaid = false;
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

  /* ---------- the spoken challenge (NJA-3213) ----------
     A child who finished the night by tapping, and passed, is dared to say
     the same lines out loud. It is deliberately NOT a replay: the night is
     five and a half minutes and nobody plays it again for a change of input
     method. This is the handful of lines that stuck, spoken, in about a
     minute.

     Three rules hold it together:

       It cannot cost them anything. They have already passed, and an offer
       that can take a mark away is not an offer. Nothing here writes to
       `best`, to mastery, to `passed`, or to anything Activity.End reported —
       the score on the screen behind this card is final before it opens.

       It cannot come between a child and FINISH. In a quest FINISH is what
       pays the gems, so this is a modal over the end sheet and never a screen
       that replaces it. Quitting, failing or crashing puts them back on the
       end screen with that button exactly where it was.

       It replaces an offer rather than joining them. The end screen already
       carries FINISH, another venue, practise-what-is-left and start-over;
       a fifth button makes all five quieter. This stands in the place of
       practise-what-is-left, which a child who passed has least use for. */
  const SPEAK_MAX = 6;        // about a minute; the night itself is five
  let speak = null;           // the challenge in flight, or null
  let endRows = [];           // the last report(), so the list can be redrawn
  let voiceAnswers = 0;       // answers given by voice THIS go
  let speakOffered = false;   // once a session, however many venues they do

  /* Only what actually stuck. Challenging a child on a line they never got is
     not a challenge, it is the thing they already failed, with the pills
     taken away. */
  const speakLines = rows => rows
    .filter(r => r.verdict === 'stuck' && r.target)
    .map(r => ({ patternId: r.pair.patternId, target: r.target, native: r.native }))
    .slice(0, SPEAK_MAX);

  /* judgeSpoken() reads a turn plan. There is no turn here, so this is the
     smallest shape that answers the same questions: no pills and no cells, so
     spokenTargets() falls through to the whole sentence, which is exactly what
     is being asked for. */
  const speakPlan = line => ({
    expectedAnswerPills: [], cells: [], expected: line.target,
    pair: { allTarget: line.target, allNative: line.native },
  });

  function renderSpeakDots() {
    $('speak-dots').innerHTML = speak.lines.map((l, i) => {
      const r = speak.results[i];
      const cls = r === 'right' ? 'done' : r ? 'miss' : i === speak.at ? 'now' : '';
      return '<i class="' + cls + '"></i>';
    }).join('');
  }

  function renderSpeak() {
    const line = speak.lines[speak.at];
    $('speak-target').textContent = line.target;
    $('speak-native').textContent = line.native || '';
    $('speak-state').textContent = '';
    $('speak-state').classList.remove('good');
    renderSpeakDots();
    speakMicLabel();
    /* Axel says it before they do. Hearing the line once is not a hint here —
       they built it themselves ten minutes ago — and it is what makes the
       microphone feel answerable rather than blank. */
    V.now(line.target, { speaker: 'actor', lang: TL() });
  }

  function speakMicLabel() {
    const b = $('speak-mic');
    b.querySelector('span').textContent =
      micSending ? t('speak-thinking') : micOn ? t('speak-stop') : t('speak-tap');
    b.classList.toggle('listening', !!micOn);
    b.disabled = !!micSending;
  }

  function openSpeak(lines) {
    speak = { lines, at: 0, open: true, right: 0, tries: 0, misheard: 0, results: [] };
    AN('NovaPals.Nlt.SpeakChallengeTaken',
       { venue, go: state.go, lines: lines.length });
    SCREEN.at('Speak challenge');
    $('speak-eyebrow').textContent = t('speak-eyebrow');
    $('speak-title').textContent = t('speak-title');
    $('speak-skip').querySelector('span').textContent = t('speak-skip');
    $('speak-quit').querySelector('span').textContent = t('speak-quit');
    $('speak-heard').textContent = '';
    $('speak').classList.remove('hidden');
    renderSpeak();
  }

  /* The microphone, on this card. It is the same recorder the night uses —
     the same permission, the same primer card, the same transcriber — routed
     to a different reader. */
  async function speakMic() {
    if (micSending) return;
    if (micOn) { finishRecording(); return; }
    V.stop();
    $('speak-heard').textContent = '';
    $('speak-state').textContent = '';
    $('speak-state').classList.remove('good');
    if (await micAgreed()) { startRecording(); return; }
    askForMic();
  }

  async function speakHeard(said) {
    if (!speak || !speak.open) return;
    const line = speak.lines[speak.at];
    speak.tries += 1;
    $('speak-state').textContent = t('speak-thinking');
    const j = await judgeSpoken(said, speakPlan(line));
    if (!speak || !speak.open) return;           // they quit while it thought
    /* A mishearing is not a wrong answer here either, and in a challenge there
       is no attempt to spend — so it costs nothing at all, twice, before the
       line is let go. A room with a band in it should not be able to tell a
       child they cannot say a sentence they can say. */
    const free = !j.target_produced && freeGo(j) && speak.misheard < 2;
    AN('NovaPals.Nlt.SpeakAttempt', {
      venue, go: state.go, patternId: line.patternId, index: speak.at,
      attempt: speak.tries,
      result: j.target_produced ? 'correct' : free ? 'misheard' : 'wrong',
      judgedBy: j.judged, errorType: j.error_type,
    });
    if (j.target_produced) return speakAdvance('right');
    if (free) {
      speak.misheard += 1;
      speak.tries -= 1;                          // the go was never theirs
      $('speak-state').textContent = t('speak-again');
      speakMicLabel();
      return;
    }
    if (speak.tries < 2) {
      $('speak-state').textContent = t('speak-wrong');
      speakMicLabel();
      return;
    }
    speakAdvance('wrong');
  }

  function speakAdvance(how) {
    speak.results[speak.at] = how;
    if (how === 'right') {
      speak.right += 1;
      $('speak-state').textContent = t('speak-right');
      $('speak-state').classList.add('good');
      SFX.play('right');
    }
    renderSpeakDots();
    speakMicLabel();
    setTimeout(() => {
      if (!speak || !speak.open) return;
      speak.at += 1; speak.tries = 0; speak.misheard = 0;
      $('speak-heard').textContent = '';
      if (speak.at >= speak.lines.length) return closeSpeak('complete');
      renderSpeak();
    }, how === 'right' ? 750 : 450);
  }

  function skipSpeakLine() {
    if (!speak || !speak.open) return;
    AN('NovaPals.Nlt.SpeakAttempt', {
      venue, go: state.go, patternId: speak.lines[speak.at].patternId,
      index: speak.at, attempt: speak.tries, result: 'skipped',
    });
    speakAdvance('skip');
  }

  function closeSpeak(reason) {
    const done = speak || { lines: [], right: 0, at: 0 };
    AN('NovaPals.Nlt.SpeakChallengeEnd', {
      venue, go: state.go, lines: done.lines.length,
      attempted: Math.min(done.at, done.lines.length), spoken: done.right, reason,
    });
    if (speak) speak.open = false;
    if (micOn) setMic(false);
    micSending = false;
    $('speak').classList.add('hidden');
    /* The tally, and a tick against every line they said. The end list is
       redrawn rather than patched so there is one place that knows how a row
       looks. */
    const said = new Set(done.lines.filter((l, i) => done.results && done.results[i] === 'right')
                                   .map(l => l.patternId));
    renderEndList(endRows, said);
    const note = $('end-spoken');
    note.textContent = t('speak-result', done.right, done.lines.length);
    note.classList.remove('hidden');
    $('btn-speak').classList.add('hidden');
    $('end-axel').classList.add('hidden');
    SCREEN.at('End — Passed');
    speak = null;
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
    /* During the challenge the night is over and its dock is behind a card.
       Touching the tray and the slot there would be rearranging furniture in
       a room nobody is in, so the card shows its own state instead. */
    if (speak && speak.open) { speakMicLabel(); }
    else {
      $('mic-panel').classList.toggle('hidden', !on);
      $('tray').style.display = on ? 'none' : '';
      $('slot').style.display = on ? 'none' : '';
      $('slot-label').style.display = on ? 'none' : '';
      $('btn-mic').classList.toggle('on', on);
      $('btn-say').style.display = on ? 'none' : '';
      $('btn-clear').style.display = on ? 'none' : '';
      if (on) micLabels();
    }
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
    if (speak && speak.open) speakMicLabel(); else micLabels();
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
    if (!blob.size) {
      setMic(false);
      if (speak && speak.open) { $('speak-state').textContent = t('mic-nothing'); speakMicLabel(); }
      else $('verdict').textContent = t('mic-nothing');
      return;
    }
    /* Both languages: what the line asks them to produce, and the one the
       rest of the line is in. The transcriber needs both to write down a
       mixed sentence as it was actually said. */
    const j = await post('/api/listen',
      { audio: await toBase64(blob), mime: type, language: TL(), nativeLanguage: NL() }, 15000);
    setMic(false);
    const said = String((j && j.text) || '').trim();
    if (!said) {
      const why = t(j && j.fail ? 'mic-failed' : 'mic-nothing');
      if (speak && speak.open) { $('speak-state').textContent = why; speakMicLabel(); }
      else $('verdict').textContent = why;
      return;
    }
    if (speak && speak.open) { $('speak-heard').textContent = said; speakHeard(said); return; }
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
    /* ---------- yesterday, carried in ----------
       The one line that makes a second night mean anything. Without it every
       night is a first night wearing a welcome-back message.

       `nextSession` counts the session up, clears the turn and empties the
       per-session summary, and leaves the mastery alone - which is the whole
       asymmetry the arm is built on. */
    if (MASTERY_ARM) {
      const M = window.MASTERY;
      const held = window.STORE.mastery();
      const carried = held && Object.keys(held).length ? held : null;
      state.mastery = carried
        ? M.nextSession(Object.assign(M.blank(), carried))
        : M.blank();
      /* Said once, and only to somebody who actually left something behind.
         A child whose storage was wiped is a new learner and is not greeted
         as a returning one. */
      if (carried && LEARNER.returning) {
        const pct = Math.round(overall() * 100);
        const line = t('again-welcome', pct);
        if (line) { const f = toFragments(line); say('axel', fragmentsHTML(f), line, f); }
      }
    }
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
    /* The venue is a super-property for the same reason the build tag is:
       every existing measure then splits by it without a single call site
       having to remember, and a question nobody thought to ask on the day can
       still be asked of the data afterwards. */
    /* `pack` rides as a super-property for the same reason `build` and `venue`
       do: every existing measure then splits by which tile the child came in
       through, without a single call site having to remember. */
    SCREEN.register({ native_language: NL(), target_language: TL(),
                      language_source: langSource, venue, pack: packSlug() || 'default' });
    if (played.indexOf(venue) < 0) played.push(venue);
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
  /* The spoken challenge. "That is enough" is a way out, not a failure: a
     child who stops halfway keeps whatever they said, and the end screen is
     still behind this card with FINISH where they left it. */
  $('speak-mic').addEventListener('click', speakMic);
  $('speak-skip').addEventListener('click', skipSpeakLine);
  $('speak-quit').addEventListener('click', () => closeSpeak('quit'));
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
    /* Who the store thinks this is, so a test can read the arm and the
       mastery without reaching into localStorage itself. */
    learner: () => LEARNER,
    store: () => window.STORE.state,
    /* What kind of beat is on screen. The scenarios arm only ever builds a
       sentence; the mastery arm will have more kinds, and a test that walks
       the night should not have to know which arm it is in. */
    rung: () => (plan && plan.kind) || 'production',
    introduced: () => [...introducedWords()],
    /* What the coach is allowed to say in the target language this turn. It
       was empty all night in arm B, which is why every coach line was thrown
       away, so a test can now watch it fill. */
    coachAllowed: () => [...(MASTERY_ARM ? masteryAllowed(turnFresh) : introducedWords())],
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
    /* the spoken challenge, so a test can open it and read it without having
       to hold a microphone up to a headless browser */
    speak: () => speak,
    /* why the dare did or did not appear, which is four booleans and saves
       guessing at a hidden button */
    speakWhy: () => ({ voiceAnswers, speakOffered, serverUp, canRecord: canRecord(),
                       lines: state ? speakLines(E.report(state, Q)).length : 0 }),
    speakOpen: () => openSpeak(speakLines(E.report(state, Q))),
    speakHeard: said => speakHeard(said),
    speakSkip: () => skipSpeakLine(),
    /* so a test can put a line to the guard without waiting for the model to
       write a bad one */
    mixedQuote: txt => mixedQuote(txt),
    langSource: () => langSource,
    deviceLang: () => deviceLang(),
  };

  boot();
})();
