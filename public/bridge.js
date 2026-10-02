/* THE NOVAPALS WEBVIEW BRIDGE

   This page is also opened as a quest activity inside the NovaPals app, in a
   fullscreen portrait webview (NJA-2872). The app covers it with a loading
   overlay and waits for the page to say it is ready; until that message lands
   the child is watching a spinner and nothing else. Two messages, and only
   two:

     NovaPals.Prototype.Start   the game is on screen — lift the overlay
     NovaPals.Prototype.End     the run is finished — complete the quest, award
                                the gems, close the webview

   The names are the app's, not ours: handleWebViewPostMessage is already
   shipped and keyed on them, so this is a contract to meet rather than one to
   design. The shape is the part we guess at. react-native-webview delivers
   every message as a string, and the app's handler is on the other side of a
   boundary this page cannot read — so each message goes twice, once as the
   bare event name and once as JSON carrying that name under type, event AND
   name. A handler keyed on any of those sees it; the others fail to parse and
   are ignored. If the real contract turns out to be something else, this file
   is the only thing to change.

   Start is idempotent — it hides an overlay — so it is repeated, because a
   missed Start strands the child on that spinner for ever. End is not: it
   completes a quest and pays out, so it is only ever sent from an explicit tap
   on FINISH. There is deliberately no End on pagehide: backing out of a quest
   must not complete it.

   Carried over from jailbreak-camera, where QA's first pass found no events
   arriving at all — so none of the belt-and-braces here is theoretical. */
window.BRIDGE = (function () {
  const START = 'NovaPals.Prototype.Start';
  const END = 'NovaPals.Prototype.End';
  let startSends = 0, endSends = 0;

  /** react-native-webview injects this into the page before our scripts run. */
  function host() {
    const rn = window.ReactNativeWebView;
    return rn && typeof rn.postMessage === 'function' ? rn : null;
  }

  function send(name, extra) {
    const rn = host();
    const payloads = [
      name,
      JSON.stringify(Object.assign(
        { type: name, event: name, name, source: 'natty-language' }, extra || {})),
    ];
    for (const payload of payloads) {
      try { if (rn) rn.postMessage(payload); }
      catch (e) { console.warn('[NovaPals] bridge failed:', e && e.message); }
      /* And up to a parent frame, so the same page still works if it is ever
         embedded in an iframe instead of a native webview. Skipped entirely
         when there is no parent, so a plain tab sends nothing at all. */
      try { if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*'); }
      catch { /* cross-origin parent that won't take it; nothing to do */ }
    }
    console.log('[NovaPals] ->', name, rn ? '(webview)' : '(no host — standalone browser)');
  }

  return {
    /** True when we are running inside the app rather than a plain browser. */
    get inApp() { return !!host(); },
    get startSends() { return startSends; },
    get endSends() { return endSends; },

    /**
     * The first screen is painted and the overlay can go. Called as early as
     * possible — before /api/health, which on a cold Render instance can take
     * half a minute — and then twice more, in case the app's listener was not
     * attached when the first one went out.
     */
    ready() {
      if (startSends) return;
      startSends++;
      send(START);
      setTimeout(() => { startSends++; send(START); }, 1200);
      setTimeout(() => { startSends++; send(START); }, 3500);
    },

    /**
     * The child finished and tapped FINISH. Only ever called from that tap.
     * `result` is what the night came to — the app does not need it to pay the
     * gems, but a quest that reports nothing about how it went is a quest the
     * dashboards cannot tell apart from any other.
     */
    finish(result) {
      endSends++;
      send(END, Object.assign({ attempt: endSends }, result || {}));
      return endSends;
    },
  };
})();
