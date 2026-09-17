/* voice.js — everything the learner hears.
   Server path: Gemini TTS via /api/tts (the jailbreak-camera call shape, one
   prebuilt voice and one delivery style per speaker). Fallback: the browser's
   own speech synthesis, so the prototype is never silent with no key.

   Two things matter for how this feels:
   1. Lines are FETCHED in parallel and PLAYED in order. Gemini takes a second
      or two per line; fetching them serially inside the queue left audible
      holes between Axel and the character.
   2. A tap must be heard immediately. say(..., {interrupt:true}) drops
      whatever is queued and speaks now — that is what chip taps and SAY IT
      use, so the child never waits out a sentence they have stopped listening
      to.
   iOS will not play audio until a user gesture, so unlock() runs on first tap. */

window.VOICE = (function () {
  const cache = new Map();          // "speaker|text" -> Promise<objectURL>
  let unlocked = false;
  let serverTTS = false;
  let current = null;
  let enabled = true;
  let chain = Promise.resolve();

  const LANG = { es: 'es-ES', en: 'en-GB' };

  /* Who is talking right now. The UI listens so a character's mouth moves for
     the length of the line — both on the server voice and on the browser
     fallback, since both resolve through the same queue. Nothing here knows
     about animation; it just reports the speaker. */
  const listeners = [];
  let talking = null;
  function onSpeaking(fn) { listeners.push(fn); }
  function emit(speaker, on) {
    if (on && talking === speaker) return;
    if (!on && talking !== speaker) return;
    talking = on ? speaker : null;
    for (const fn of listeners) { try { fn(speaker, on); } catch {} }
  }

  function setServer(on) { serverTTS = !!on; }
  function setEnabled(on) { enabled = !!on; if (!on) stop(); }
  function isEnabled() { return enabled; }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      // a silent utterance is enough to open the audio channel on iOS
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch { /* no synthesis here; server audio still works after a gesture */ }
  }

  function stop() {
    if (talking) emit(talking, false);
    chain = Promise.resolve();
    try { window.speechSynthesis.cancel(); } catch {}
    if (current) { try { current.pause(); } catch {} current = null; }
  }

  /* A device with no installed voices, or with audio blocked, never fires
     onend. Nothing may ever wait forever on a voice, so every utterance races
     a timeout sized to the text. */
  function budget(text) { return Math.min(8000, 900 + text.length * 70); }

  function browserSay(text, lang) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) return resolve(false);
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const timer = setTimeout(() => done(false), budget(text));
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = 0.95;
        const voices = window.speechSynthesis.getVoices() || [];
        const match = voices.find(v => v.lang && v.lang.startsWith(lang.slice(0, 2)));
        if (match) u.voice = match;
        u.onend = () => { clearTimeout(timer); done(true); };
        u.onerror = () => { clearTimeout(timer); done(false); };
        window.speechSynthesis.speak(u);
      } catch { clearTimeout(timer); done(false); }
    });
  }

  /* Start the download without waiting for it. Returns a promise for an
     object URL. Kept in the cache so the same line is only ever fetched once,
     and so a line queued behind two others is already in flight by the time
     its turn comes. The access-code token rides in an HttpOnly cookie, so
     there is nothing to attach here. */
  function fetchClip(text, speaker) {
    const key = speaker + '|' + text;
    let p = cache.get(key);
    if (p) return p;
    p = fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker })
    }).then(r => {
      if (!r.ok) throw new Error('tts ' + r.status);
      return r.json();
    }).then(({ audio }) => {
      if (!audio) throw new Error('no audio');
      const bin = atob(audio);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }).catch(e => { cache.delete(key); throw e; });   // a failure must not be cached
    if (cache.size < 400) cache.set(key, p);
    return p;
  }

  function prefetch(text, speaker = 'axel') {
    if (!serverTTS || !text) return;
    try { fetchClip(text, speaker).catch(() => {}); } catch {}
  }

  function play(url) {
    return new Promise(resolve => {
      const a = new Audio(url);
      current = a;
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
  }

  /* say(text, {speaker, lang, interrupt}) — queued, so a sequence of lines
     plays in order and a caller never has to await one line before showing
     the next screen. interrupt:true clears the queue and speaks now. */
  function say(text, opts = {}) {
    if (!enabled || !text) return chain;
    const { speaker = 'axel', lang = 'es', interrupt = false } = opts;
    if (interrupt) stop();
    prefetch(text, speaker);          // start the download before we queue
    chain = chain.then(async () => {
      if (!enabled) return;
      unlock();
      emit(speaker, true);
      try {
        if (serverTTS) {
          try {
            const url = await fetchClip(text, speaker);
            if (await play(url)) return;
          } catch { /* fall through to the browser */ }
        }
        await browserSay(text, LANG[lang] || lang);
      } finally {
        emit(speaker, false);
      }
    }).catch(() => {});
    return chain;
  }

  const now = (text, opts = {}) => say(text, Object.assign({}, opts, { interrupt: true }));

  /* prime the voice list — Chrome populates it asynchronously */
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => {}; } catch {}
  }

  return { say, now, prefetch, stop, unlock, onSpeaking, setServer, setEnabled, isEnabled };
})();
