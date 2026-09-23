/* messageFragments — NJA-3149's chat-history shape, built deterministically.

   A message is no longer a string. It is a role plus a list of fragments:

     { role: 'actor', messageFragments: [
         { type: 'text',   text: 'Do you have' },
         { type: 'target', text: 'una entrada' } ] }

   and a `target` fragment renders blue, bold and underlined (NJA-3149 AC 3.2).

   The split is NOT asked of the model. A model asked to mark up its own line
   gets it wrong in both directions — it marks words it merely thinks are
   foreign, and misses ones it used without noticing — and the whole point of
   the epic's engine is that nothing about which words have crossed into the
   target language is left to a model. So the caller passes the list the engine
   already maintains (`introduced`), and the split is a scan against it.

   Shared by the server, which returns the fragments, and by the client, which
   needs the same function for its own fallback lines and for the child's
   answers. One copy, so the two can never disagree about what is highlighted. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FRAGMENTS = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const bare = w => String(w).toLowerCase().replace(/[¿?¡!.,;:"“”'’]/g, '').trim();

  /* Words that are spelled the same in both languages. Seeing one is no
     evidence of anything, and highlighting it offers a child a translation of
     a word they already own. Kept here rather than in the UI because the
     server does the splitting now. */
  const AMBIGUOUS = new Set(['a', 'no', 'me', 'son', 'solo', 'nada', 'van',
                             'mira', 'pasa', 'o', 'es', 'la', 'el', 'te',
                             'tu', 'mi', 'y', 'en', 'con', 'toma']);

  const looksForeign = tok => /[¿¡]/.test(tok) || /[áéíóúñü]/i.test(tok);

  /* Is this token one of the target-language words the child has met?
     `allowed` is the engine's introduced list, bare-keyed. */
  function isTarget(tok, allowed) {
    const w = bare(tok);
    if (!w) return false;
    if (!allowed.has(w)) return false;
    // "no" inside an English sentence is English, however Spanish it also is
    return looksForeign(tok) || !AMBIGUOUS.has(w);
  }

  /* Split a line into fragments, merging neighbours of the same type so a
     multi-word phrase ("una entrada") is one highlighted run rather than two,
     which is what NJA-3149 AC 3.3 means by rendering as a single block. */
  function fragments(text, allowedWords) {
    const allowed = allowedWords instanceof Set
      ? allowedWords
      : new Set((allowedWords || []).map(bare));
    const out = [];
    const push = (type, text) => {
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += text;
      else out.push({ type, text });
    };
    for (const tok of String(text).split(/(\s+)/)) {
      if (!tok) continue;
      if (!tok.trim()) { push(out.length ? out[out.length - 1].type : 'text', tok); continue; }
      push(isTarget(tok, allowed) ? 'target' : 'text', tok);
    }
    /* Trailing/leading whitespace inside a fragment is harmless, but a
       fragment that is only whitespace is noise in the fixtures. */
    return out.map(f => ({ type: f.type, text: f.text })).filter(f => f.text.trim() || out.length === 1);
  }

  /* The inverse: fragments back to the plain line, for TTS and for anything
     that wants the sentence rather than its markup. */
  const plain = frags => (frags || []).map(f => f.text).join('');

  /* How much of a line is in the target language — the voice follows the
     majority, since a mixed line read entirely in one accent sounds wrong. */
  function targetShare(frags) {
    const words = f => f.text.split(/\s+/).filter(Boolean).length;
    let t = 0, n = 0;
    for (const f of frags || []) (f.type === 'target' ? (t += words(f)) : (n += words(f)));
    return t + n ? t / (t + n) : 0;
  }

  return { fragments, plain, targetShare, bare, AMBIGUOUS, looksForeign, isTarget };
});
