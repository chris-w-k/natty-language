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

  let state, current = null, plan = null, scaf = 0, placed = [], hinted = false;
  let micOn = false, busy = false, recog = null, serverUp = false;

  /* ---------- character renderer (STUB) ----------
     Swap the body for lottie-web at reskin time. The five state names are the
     slots Directus already stores on ai_tutor_characters:
     idle | speak | intro | outro | pose                                      */
  function mountCharacter(el, { character, state: st }) {
    el.dataset.character = character;
    el.dataset.state = st;
    el.querySelector('.ch-name').textContent = character.toUpperCase();
    el.querySelector('.ch-state').textContent = st;
    // lottie.loadAnimation({ container: el, renderer: 'svg', loop: true,
    //   autoplay: true, path: ASSETS[character][st] });
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
      serverUp = j && j.ok === true && !j.mock;
      V.setServer(serverUp);
      $('t-mode').textContent = serverUp
        ? 'evaluator: ' + j.model + ' · voice: ' + (j.tts || 'browser')
        : 'evaluator: local · voice: browser';
    } catch { serverUp = false; }
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

  async function generateTurn(scene, item, scaffold) {
    if (!serverUp) return null;
    try {
      const allowed = [...new Set(E.allItems(Q).flatMap(i => i.chips))];
      const r = await fetch('/api/turn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: scene.onScreen.character,
          characterNote: scene.onScreen.character === 'axel' ? 'a bubbly teenage punk musician, the coach' : '',
          sceneTitle: scene.title, sceneSpeaks: scene.onScreen.speaks,
          target: item.target, native: item.native, scaffold,
          nativeLang: NL(), targetLang: TL(), allowed, recent: recentLines.slice(-6)
        })
      });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.coach_ask) return null;
      recentLines.push(j.coach_ask);
      return j;
    } catch { return null; }
  }

  /* ---------- what the coach says ----------
     The ASK is always present, always in the native language: at no level is
     the learner left guessing what they are supposed to communicate.
     The MODEL is the Spanish, and that is what gets withdrawn as they climb. */
  function coachCopy(item, scaffold, p, gen) {
    const ask = gen && gen.coach_ask
      ? gen.coach_ask
      : item.coachLine + ' “' + item.native + '”';
    let model = '', spoken = '';
    if (scaffold === 0) {
      const w = p.answer.join(' ');
      model = '<mark>' + spanishHTML(w) + '</mark>';
      spoken = w;
    } else if (scaffold === 1) {
      model = '<mark>' + spanishHTML(item.target) + '</mark>';
      spoken = item.target;
    } else if (scaffold === 2) {
      const c = item.chips.slice();
      c.pop();
      model = '<mark>' + spanishHTML(c.join(' ')) + ' <span class="blank"></span></mark>';
      spoken = '';
    }
    return { askText: ask, html: esc(ask) + (model ? ' ' + model : ''), spoken };
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

  function spanishHTML(text) {
    return String(text).split(/(\s+)/).map(tok => {
      if (!tok.trim()) return tok;
      return '<button type="button" class="w" data-w="' + esc(tok) + '">' + esc(tok) + '</button>';
    }).join('');
  }

  let tipTimer = null;
  function showTip(el, word) {
    const g = gloss(word);
    const tip = $('tip');
    tip.textContent = g ? word + ' — ' + g : word;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const host = $('app').getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(host.width - tip.offsetWidth - 8,
      r.left - host.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
    tip.style.top = (r.top - host.top - tip.offsetHeight - 8) + 'px';
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.add('hidden'), 2600);
  }

  document.addEventListener('click', ev => {
    const w = ev.target.closest && ev.target.closest('.w');
    if (!w) { $('tip').classList.add('hidden'); return; }
    showTip(w, w.dataset.w);
    V.say(w.dataset.w, { speaker: 'axel', lang: TL() });
  });

  /* label by how many gaps there actually are, not by the level */
  function slotLabel(p, n) {
    if (p.gaps >= n) return 'BUILD THE WHOLE SENTENCE';
    return p.gaps === 1 ? 'TAP THE MISSING WORD' : 'TAP THE ' + p.gaps + ' MISSING WORDS';
  }

  /* ---------- render ---------- */
  function renderHud() {
    const o = E.overall(state, Q);
    $('rail-fill').style.width = (o * 100).toFixed(1) + '%';
    $('mastery').textContent = 'MASTERY ' + pct(o);
    $('scenechip').textContent = 'SCENE ' + Math.min(state.sceneIndex + 1, Q.scenes.length) + ' / ' + Q.scenes.length;
    $('coins').textContent = String(state.coins);
    $('t-obj').textContent = current ? current.item.id : '—';
    $('t-scaf').textContent = current ? 'L' + scaf + ' (' + plan.gaps + ' gap' + (plan.gaps > 1 ? 's' : '') + ')' : '—';
    $('t-turn').textContent = state.turn + '/' + Q.session.turnBudget;
  }

  async function renderTurn() {
    const { scene, item } = current;
    const scaffold = scaf = E.scaffoldFor(state, item.id);
    plan = E.buildPlan(item, scaffold);
    const nativeSpeaker = scene.onScreen.speaks === 'native';
    const gen = await generateTurn(scene, item, scaffold);
    $('t-gen').textContent = gen ? 'generator: gemini' : 'generator: template';
    const coach = coachCopy(item, scaffold, plan, gen);
    const sceneLine = gen ? gen.scene_line : scene.opening;

    mountBackground($('layer-bg'), scene.background);
    mountCharacter($('character'), { character: scene.onScreen.character, state: 'speak' });

    if (nativeSpeaker) {
      $('speech').classList.add('onbar');
      $('sp-who').textContent = 'AXEL · COACH';
      $('sp-line').innerHTML = coach.html;
      $('coach').classList.add('hidden');
    } else {
      $('speech').classList.remove('onbar');
      $('sp-who').textContent = scene.onScreen.character.toUpperCase() + ' · ' + TL().toUpperCase();
      $('sp-line').innerHTML = spanishHTML(sceneLine);
      $('coach').classList.remove('hidden');
      $('coach').classList.remove('silent');
      $('coach-say').innerHTML = coach.html;
      $('coach-hint').textContent = 'TAP AXEL FOR HELP';
    }

    if (coach.spoken) {
      const d = E.creditHeardItem(state, item);
      if (d) pushDelta(d);
    }

    placed = [];
    hinted = false;
    $('slot-label').textContent = slotLabel(plan, item.chips.length);
    renderSlot();
    renderTray();
    setMic(false);
    $('verdict').textContent = '';
    $('verdict').className = '';
    renderHud();

    // Speak the turn — queued, never awaited. The screen is usable immediately;
    // a child who already knows the answer does not wait for the audio.
    V.stop();
    if (!nativeSpeaker) V.say(sceneLine, { speaker: scene.onScreen.character, lang: TL() });
    V.say(coach.askText, { speaker: 'axel', lang: NL() });
    if (coach.spoken) V.say(coach.spoken, { speaker: 'axel', lang: TL() });
    V.say('').then(() => mountCharacter($('character'), { character: scene.onScreen.character, state: 'idle' }));
  }

  function renderSlot() {
    const slot = $('slot');
    slot.classList.remove('ok');
    slot.innerHTML = '';

    if (plan.mode === 'native-frame') {
      const f = document.createElement('span');
      f.className = 'frame';
      f.textContent = plan.frame;
      slot.appendChild(f);
    } else {
      for (const w of plan.locked) {
        const s = document.createElement('span');
        s.className = 'chip locked';
        s.textContent = w;
        slot.appendChild(s);
      }
    }

    for (let i = 0; i < plan.gaps; i++) {
      if (placed[i] !== undefined) {
        const b = document.createElement('button');
        b.className = 'chip placed';
        b.type = 'button';
        b.textContent = placed[i];
        b.addEventListener('click', () => { placed.splice(i, 1); renderSlot(); renderTray(); });
        slot.appendChild(b);
      } else {
        const g = document.createElement('span');
        g.className = 'gap';
        slot.appendChild(g);
      }
    }
    $('btn-say').disabled = placed.length !== plan.gaps;
  }

  function renderTray() {
    const tray = $('tray');
    tray.innerHTML = '';
    // only the words still needed, plus decoys — never the words already locked in
    const needed = plan.answer.slice();
    const decoys = (current.item.distractors || []).slice(0, E.DISTRACTORS_AT[scaf] ?? 2);
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
        if (placed.length >= plan.gaps) return;
        placed.push(w);
        V.say(w, { speaker: 'axel', lang: TL() });
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

  function fullSentence() {
    return plan.mode === 'native-frame'
      ? placed.join(' ')
      : [...plan.locked, ...placed].join(' ');
  }

  /* What gets read aloud on SAY IT: the complete target sentence. At L0 the
     slot only holds one word, but the child should still hear all of it. */
  function spokenSentence() {
    const right = E.checkGaps(placed, plan).target_produced;
    return right ? current.item.target : fullSentence();
  }

  async function submit(text, mode) {
    if (busy || !current) return;
    busy = true;
    $('btn-say').disabled = true;

    const item = current.item;

    // Always the whole sentence, never just the words they filled in — the
    // point is to hear the finished thing, even at the one-word rungs.
    if (mode === 'chips') V.say(spokenSentence(), { speaker: 'learner', lang: TL() });

    const res = mode === 'chips' ? E.checkGaps(placed, plan) : await evaluateSpoken(text, item);

    if (res.target_produced) {
      const d = E.applyCorrect(state, item, { mode, hinted });
      pushDelta(d);
      $('slot').classList.add('ok');
      $('verdict').textContent = '✓ ' + (hinted ? 'nice — that’s it' : 'spot on');
      $('verdict').className = 'good';
      mountCharacter($('character'), { character: current.scene.onScreen.character, state: 'pose' });
      renderHud();
      setTimeout(() => { busy = false; step(); }, 900);
      return;
    }

    const d = E.applyWrong(state, item);
    pushDelta(d);
    renderHud();

    if (E.mercyDue(state, item, Q)) {
      const m = E.applyMercy(state, item);
      pushDelta(m);
      $('verdict').textContent = '— Axel says it for you: ' + item.target;
      await V.say(item.target, { speaker: 'axel', lang: TL() });
      setTimeout(() => { busy = false; step(); }, 1200);
      return;
    }

    hinted = true;
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
    const done = Object.values(state.items).filter(s => s.mastery >= Q.session.canUseBar).length;
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
    const scaffold = scaf;
    $('coach-rungs').innerHTML =
      `<div class="rung"><span class="k">WHAT TO SAY</span><span class="v">${esc(item.native)}</span></div>` +
      `<div class="rung"><span class="k">IN SPANISH</span><span class="v"><b>${esc(item.target)}</b></span></div>` +
      `<div class="rung"><span class="k">WORD BY WORD</span><span class="v">${item.chips.map(esc).join(' &middot; ')}</span></div>` +
      `<div class="rung"><span class="k">SUPPORT LEVEL</span><span class="v">L${scaffold} &mdash; ` +
      `${['one word, English frame', 'one word, Spanish frame', 'fill the gaps', 'whole sentence', 'whole sentence, no model'][scaffold]}</span></div>`;
    $('coach-sheet').classList.remove('hidden');
    V.say(item.target, { speaker: 'axel', lang: TL() });
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
        const lb = E.label(st.mastery, st.exposures > 0, Q);
        const r = document.createElement('div');
        r.className = 'row' + (i > state.sceneIndex ? ' locked' : '');
        r.innerHTML =
          `<div class="l"><span class="t">${esc(it.target)}</span><span class="m">${esc(it.native)}</span></div>` +
          `<div class="r"><span class="pct">${pct(st.mastery)}</span><span class="pill ${lb.replace(' ', '')}">${lb}</span></div>`;
        body.appendChild(r);
      });
    });
    $('prog-overall').textContent = pct(E.overall(state, Q));
    $('prog-sheet').classList.remove('hidden');
  }

  /* ---------- boot ---------- */
  async function boot() {
    state = E.createState(Q);
    $('t-mode').textContent = 'evaluator: local · voice: browser';
    await probeServer();
    $('btn-mic').style.opacity = micAvailable() ? '' : '.4';
    step();
  }

  $('btn-say').addEventListener('click', () => submit(fullSentence(), 'chips'));
  $('btn-clear').addEventListener('click', () => { placed = []; renderSlot(); renderTray(); });
  $('btn-mic').addEventListener('click', toggleMic);
  $('coach-face').addEventListener('click', openCoach);
  $('btn-progress').addEventListener('click', openProgress);
  $('btn-pause').addEventListener('click', openProgress);
  $('coach-close').addEventListener('click', () => $('coach-sheet').classList.add('hidden'));
  $('prog-close').addEventListener('click', () => $('prog-sheet').classList.add('hidden'));
  $('btn-restart').addEventListener('click', () => { $('end').classList.add('hidden'); boot(); });
  $('btn-sound').addEventListener('click', () => {
    V.setEnabled(!V.isEnabled());
    $('btn-sound').classList.toggle('off', !V.isEnabled());
  });

  // iOS will not play audio until a gesture; the first touch anywhere opens it
  document.addEventListener('pointerdown', () => V.unlock(), { once: true });

  // scriptable view of the same numbers the test strip shows
  window.__DEBUG = { plan: () => plan, item: () => current && current.item, state: () => state };

  boot();
})();
