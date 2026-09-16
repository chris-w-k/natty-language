/* voice.js — everything the learner hears.
   Server path: Gemini TTS via /api/tts (the jailbreak-camera call, one model,
   one voice per speaker). Fallback: the browser's own speech synthesis, so the
   prototype is never silent even with no key and no network.
   iOS will not play audio until a user gesture, so unlock() runs on first tap. */

window.VOICE = (function () {
  const cache = new Map();          // "speaker|text" -> objectURL
  let unlocked = false;
  let serverTTS = false;
  let current = null;
  let enabled = true;

  const LANG = { es: 'es-ES', en: 'en-GB' };

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

  async function serverSay(text, speaker) {
    const key = speaker + '|' + text;
    let url = cache.get(key);
    if (!url) {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speaker })
      });
      if (!r.ok) throw new Error('tts ' + r.status);
      const { audio } = await r.json();
      if (!audio) throw new Error('no audio');
      const bin = atob(audio);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      cache.set(key, url);
    }
    return new Promise(resolve => {
      const a = new Audio(url);
      current = a;
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
  }

  /* say(text, {speaker, lang}) — queued, so a sequence of lines plays in order
     and a caller never has to await one line before showing the next screen.
     say.now() interrupts whatever is playing (used when the mic opens). */
  let chain = Promise.resolve();

  function say(text, opts = {}) {
    if (!enabled || !text) return chain;
    const { speaker = 'axel', lang = 'es' } = opts;
    chain = chain.then(async () => {
      if (!enabled) return;
      unlock();
      if (serverTTS) {
        try { if (await serverSay(text, speaker)) return; } catch { /* fall through */ }
      }
      await browserSay(text, LANG[lang] || lang);
    }).catch(() => {});
    return chain;
  }

  /* prime the voice list — Chrome populates it asynchronously */
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => {}; } catch {}
  }

  return { say, stop, unlock, setServer, setEnabled, isEnabled };
})();
