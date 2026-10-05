/* PostHog, as the rest of NovaPals does it (NJA-3172).

   The app's taxonomy is `NovaPals.<Area>.<Thing>` — NovaPals.Quest.Start,
   NovaPals.Activity.End, NovaPals.Coin.Earned — and the ticket says the
   prefix "should happen automatically but is worth checking". Nothing here
   adds it automatically, so it is added here and the names are written out in
   full at the call sites, which is also what makes them greppable.

   Nothing is sent unless the server hands over a project key. No key means no
   analytics: that is what keeps the headless tests, the stub server and
   anyone running this locally out of the production project, which is the
   ticket's "fixtures should not fire analytics events" applied to a prototype
   that has no fixtures of its own. ?analytics=0 turns it off as well.

   Autocapture is off. A prototype that also reported every click and pageview
   would bury nine deliberate events under thousands of incidental ones. */
window.ANALYTICS = (function () {
  /* $app_name is autocaptured by the mobile SDKs but not on the web, and it is
     what makes this prototype selectable as its own app in PostHog rather than
     a smear of extra events across NovaPals. Registered as a super-property,
     so it rides on every event including the $screen ones below — the same
     arrangement the jailbreak-camera prototype used, which is what made its
     numbers readable. The event NAMES stay NovaPals.<Area>.<Thing> per
     NJA-3172: the taxonomy is shared on purpose, the app name is what
     separates us within it. */
  const APP = 'NattyLanguage';
  let ready = false, enabled = false, base = {};
  const pending = [];
  /* Super-properties asked for before init has finished. init() is async and
     its callers do not await it, so every register() made during boot — the
     webview flag, the language pair, how that pair was decided — arrived while
     `enabled` was still false and was dropped on the floor. They are held here
     and applied the moment there is a posthog to apply them to. */
  let supers = {};

  const off = () => /[?&]analytics=0/.test(location.search);

  /* The snippet posthog-js ships, trimmed to the parts we use. It stubs the
     methods, so a capture made before the script lands is replayed rather
     than lost — which matters because Quest.Start happens at boot. */
  function load(host) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.async = true;
      s.src = host.replace(/\/$/, '') + '/static/array.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('posthog script blocked'));
      document.head.appendChild(s);
    });
  }

  /* `props` on every event: the ticket wants activity_type on the Activity
     ones, quest_activity_type on the Quest ones and activityId on the Nlt
     ones. Sending all three on all of them is simpler to reason about and
     makes any of the events filterable by the prototype, which is the point
     of the type properties in the first place. */
  async function init(cfg) {
    base = {
      activity_type: cfg.activityType || 'nlt_prototype',
      quest_activity_type: cfg.questActivityType || 'nlt_prototype',
      activityId: cfg.activityId,
    };
    if (off() || !cfg.key || !cfg.host) { ready = true; flush(); return false; }
    try {
      await load(cfg.host);
      window.posthog.init(cfg.key, {
        api_host: cfg.host,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'identified_only',
      });
      enabled = true;
      /* In its own try: a posthog build without register must cost us the
         super-properties, not every event. Inside the outer try it set
         enabled=false and silently turned the whole thing off. */
      try { window.posthog.register(Object.assign({ $app_name: APP }, base, supers)); } catch {}
    } catch { enabled = false; }
    ready = true;
    flush();
    return enabled;
  }

  function flush() {
    while (pending.length) {
      const [name, props] = pending.shift();
      send(name, props);
    }
  }

  function send(name, props) {
    if (!enabled) return;
    try { window.posthog.capture(name, Object.assign({}, base, props || {})); } catch {}
  }

  /* Queued until init has answered, so an event fired during boot is not lost
     to a race with a script tag. */
  function event(name, props) {
    if (!ready) { pending.push([name, props]); return; }
    send(name, props);
  }

  /* Super-properties set after init — the webview flag and the language pair,
     neither of which is known when init runs. */
  function register(props) {
    Object.assign(supers, props || {});
    if (!enabled) return;
    try { window.posthog.register(props || {}); } catch {}
  }

  /* $screen is PostHog's own screen-view event, the one the mobile SDKs send
     automatically on every screen change, kept as its literal unprefixed name
     so it rolls up the way a native screen view does. $app_name is what keeps
     ours separable. */
  function screen(name) {
    if (!ready) { pending.push(['$screen', { $screen_name: name }]); return; }
    send('$screen', { $screen_name: name });
  }

  return { init, event, register, screen, isOn: () => enabled, isReady: () => ready };
})();
