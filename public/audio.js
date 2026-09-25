/* audio.js — everything the learner hears that ISN'T speech.

   Two jobs, kept apart from voice.js because they behave nothing alike:

   BEDS are long looping tracks — the street outside the venue, the room tone
   inside it. They fade in, fade out and cross over each other, so they run
   through a Web Audio gain node rather than an <audio> element's `volume`
   property: a gain node ramps on the audio clock, and setInterval nudging
   .volume gives you a staircase you can hear.

   TAPS are tiny and synthesised. There is no click asset yet (NJA-3170 is
   literally "[REQUIRES ASSET]"), and a prototype should not wait on one —
   a shaped oscillator burst is a few lines, weighs nothing, and can be tuned
   by ear in the file. When the real sounds land, swap `blip` for a buffer.

   Everything degrades: no AudioContext, no Web Audio, blocked autoplay — the
   game is quieter, never broken. */

window.SFX = (function () {

  let ctx = null;            // the AudioContext, made on first use
  let master = null;         // one gain everything hangs off, for the mute
  let enabled = true;
  const beds = new Map();    // name -> { el, gain, target }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 1 : 0;
      master.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  }

  /* iOS and every desktop browser since about 2018 refuse to start an
     AudioContext until a gesture. Called from the first pointerdown. */
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    // a bed that was asked for before the gesture is still paused; nudge it
    for (const b of beds.values()) { try { b.el.play().catch(() => {}); } catch {} }
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  /* Ramp a gain to a value over ms, from wherever it actually is right now —
     not from where it was last told to go, or a fade interrupted halfway
     jumps before it moves. */
  function ramp(gain, to, ms) {
    if (!ctx) return;
    const t = now();
    const from = gain.gain.value;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(from, t);
    gain.gain.linearRampToValueAtTime(to, t + Math.max(ms, 1) / 1000);
  }

  /* ---------- beds ---------- */

  /* Start a looping track, fading up from silence. Calling it again for a bed
     that is already playing just re-aims the fade, so the caller can be naive
     about whether a screen has been seen before. */
  function bed(name, url, opts = {}) {
    const { volume = 0.5, fade = 800, loop = true } = opts;
    const c = ensure();
    let b = beds.get(name);

    if (!b) {
      const el = new Audio(url);
      el.loop = loop;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      b = { el, gain: null, target: volume };
      if (c) {
        try {
          const src = c.createMediaElementSource(el);
          b.gain = c.createGain();
          b.gain.gain.value = 0;
          src.connect(b.gain).connect(master);
        } catch { b.gain = null; }
      }
      if (!b.gain) el.volume = 0;      // no Web Audio: ramp the element instead
      beds.set(name, b);
      try { el.play().catch(() => {}); } catch {}
    }

    b.target = volume;
    if (b.gain) ramp(b.gain, volume, fade);
    else elementRamp(b, volume, fade);
    return b;
  }

  /* The fallback ramp, for a browser with <audio> but no Web Audio. Coarse,
     but it is a volume change over a second, not a musical instrument. */
  function elementRamp(b, to, ms) {
    if (b.timer) clearInterval(b.timer);
    const from = b.el.volume, steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    b.timer = setInterval(() => {
      i += 1;
      const v = from + (to - from) * (i / steps);
      try { b.el.volume = Math.max(0, Math.min(1, v)); } catch {}
      if (i >= steps) { clearInterval(b.timer); b.timer = null; }
    }, 50);
  }

  /* Take a bed to a new level without stopping it — how the loading track
     settles to a murmur once the conversation starts. */
  function level(name, to, ms = 1000) {
    const b = beds.get(name);
    if (!b) return;
    b.target = to;
    if (b.gain) ramp(b.gain, to, ms);
    else elementRamp(b, to, ms);
  }

  /* Fade out and stop. The element is kept, so the same bed can be brought
     back later without re-downloading it. */
  function fadeOut(name, ms = 1000) {
    const b = beds.get(name);
    if (!b) return Promise.resolve();
    level(name, 0, ms);
    return new Promise(r => setTimeout(() => {
      try { b.el.pause(); b.el.currentTime = 0; } catch {}
      r();
    }, ms + 60));
  }

  function stopAll() {
    for (const name of beds.keys()) fadeOut(name, 200);
  }

  /* ---------- taps ---------- */

  /* One shaped burst. `f` is the pitch, `d` the length; the envelope is an
     exponential fall, which is what stops a short tone sounding like a beep
     from a microwave. */
  function blip(f, d, gain, type = 'triangle') {
    const c = ensure();
    if (!c || !enabled) return;
    if (c.state === 'suspended') return;          // before the first gesture
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(f * 0.6, 40), c.currentTime + d);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(gain, c.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g).connect(master);
      o.start();
      o.stop(c.currentTime + d + 0.02);
    } catch {}
  }

  const sounds = {
    tap:    () => blip(520, 0.07, 0.10),                 // a button, a screen
    place:  () => blip(760, 0.06, 0.09),                 // a pill going in
    lift:   () => blip(320, 0.07, 0.08, 'sine'),         // a pill coming out
    submit: () => { blip(620, 0.06, 0.10); setTimeout(() => blip(880, 0.08, 0.09), 60); },
    right:  () => { blip(660, 0.08, 0.11); setTimeout(() => blip(990, 0.16, 0.10), 90); },
    wrong:  () => blip(220, 0.16, 0.10, 'sine'),
  };
  function play(name) { (sounds[name] || sounds.tap)(); }

  function setEnabled(on) {
    enabled = !!on;
    if (master && ctx) ramp(master, enabled ? 1 : 0, 180);
    if (!ctx) for (const b of beds.values()) { try { b.el.muted = !enabled; } catch {} }
  }
  function isEnabled() { return enabled; }

  /* What is actually playing. The <audio> elements are detached — `new Audio`
     never touches the DOM — so there is nothing to inspect without this. */
  function state() {
    const out = {};
    for (const [name, b] of beds) {
      out[name] = {
        playing: !b.el.paused,
        t: Number((b.el.currentTime || 0).toFixed(2)),
        gain: b.gain ? Number(b.gain.gain.value.toFixed(3)) : Number((b.el.volume || 0).toFixed(3)),
        target: b.target,
      };
    }
    return out;
  }

  return { unlock, bed, level, fadeOut, stopAll, play, setEnabled, isEnabled, state };
})();
