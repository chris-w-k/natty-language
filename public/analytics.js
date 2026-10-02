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
  let ready = false, enabled = false, base = {};
  const pending = [];

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

  return { init, event, isOn: () => enabled, isReady: () => ready };
})();
