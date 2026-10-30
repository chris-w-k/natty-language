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

  /* Which marks belong to which language. A token "looks foreign" when it
     carries a mark the TARGET language uses and the NATIVE one does not -
     which is a fact about the pair, not about Spanish.

     This was `/[¿¡]/ || /[aeiounu accents]/`, hard-coded, from when the pair
     was always English and Spanish. With the pair reversible it reads the
     child's OWN language as foreign: every Spanish coach line containing "¿",
     "está" or "inglés" was counted as English, failed the audit, and was
     thrown away. A Spanish child learning English never saw a model-written
     hint - not one, on any turn of any night. */
  const MARKS = {
    en: '',
    es: '¿¡áéíóúñü',
    pt: 'ãõçáéíóúâêô',
    pl: 'ąćęłńóśźż',
    ro: 'ăâîșţțşí',
    tr: 'çğıöşüâî',
  };
  /* The marks that say "target" for this pair: the target's own, less any the
     native language also uses. A pair that shares all its marks - or a target
     with none, like English - gets null, and the decision falls to the
     vocabulary list, which is the honest answer: you cannot tell English from
     Spanish by looking for accents. */
  function marksFor(nativeCode, targetCode) {
    const t = MARKS[targetCode], n = MARKS[nativeCode];
    if (t == null || n == null) return /[¿¡]|[áéíóúñü]/i;   // unknown pair: as before
    const own = [...t].filter(c => n.indexOf(c) < 0);
    if (!own.length) return null;
    return new RegExp('[' + own.join('').replace(/[\]\\^-]/g, '\\$&') + ']', 'i');
  }
  const looksForeign = (tok, marks) =>
    marks === null ? false
      : (marks || /[¿¡]|[áéíóúñü]/i).test(tok);

  /* Is this token one of the target-language words the child has met?
     `allowed` is the engine's introduced list, bare-keyed. */
  /* `allTarget` is set for a line the caller KNOWS is wholly in the target
     language — since NJA-3317 that is every line the character says, because
     it is rendered from an actor pattern rather than written. The ambiguity
     test below exists to stop an English "no" inside an English sentence being
     painted as Spanish, and on a line with no English in it that test only
     costs the child a word they cannot tap: "el", "la", "a" and the rest come
     out as dead text in the middle of a highlighted run. */
  function isTarget(tok, allowed, allTarget, marks) {
    const w = bare(tok);
    if (!w) return false;
    /* A token with no letters in it is not a word in any language: the gap
       marker "___" in a coach's hint is a hole in the sentence, not a piece of
       Spanish, and highlighting it offered a child a translation of a blank. */
    if (!/\p{L}/u.test(w)) return false;
    if (!allowed.has(w)) return false;
    if (allTarget) return true;
    // "no" inside an English sentence is English, however Spanish it also is
    return looksForeign(tok, marks) || !AMBIGUOUS.has(w);
  }

  /* How a phrase is looked up in the table: the same normalisation content
     uses when it builds it. */
  const phraseKey = s => String(s || '').toLowerCase()
    .replace(/[¿?¡!.,;:"“”]/g, ' ').replace(/\s+/g, ' ').trim();

  /* Split a line into fragments.

     A multi-word phrase ("una entrada") is ONE highlighted run rather than
     two, which is what NJA-3149 AC 3.3 means by rendering as a single block.
     Two phrases standing next to each other are NOT merged, though — the
     ticket's own fixture has "Tengo" and "una entrada" as neighbouring target
     fragments, because they are two runs with two different meanings, and a
     merged run could only carry one `translation`.

     So the scan is longest-phrase-first against the content's phrase table,
     falling back to single tokens where nothing matches. `phrases` is
     optional: without it this behaves as before, merging neighbours, which is
     what the fallback lines built in the client did before the table existed. */
  function fragments(text, allowedWords, phrases, opts) {
    const allowed = allowedWords instanceof Set
      ? allowedWords
      : new Set((allowedWords || []).map(bare));
    const table = phrases || null;
    const whole = !!(opts && opts.allTarget);
    /* Which marks say "target" for this pair. Passed in by the caller, who is
       the only one that knows the pair; absent, the old Spanish-shaped guess
       stands, so an existing caller behaves exactly as it did. */
    const marks = opts && 'marks' in opts ? opts.marks
      : (opts && opts.native && opts.target) ? marksFor(opts.native, opts.target)
      : undefined;
    const out = [];
    const push = (type, text, translation) => {
      const last = out[out.length - 1];
      /* Only plain text merges freely. A target run that already carries a
         meaning is closed: whatever follows starts its own fragment. */
      if (last && last.type === type && type === 'text') last.text += text;
      else if (last && last.type === type && !last.translation && !translation) last.text += text;
      else out.push(translation ? { type, text, translation } : { type, text });
    };

    const toks = String(text).split(/(\s+)/).filter(t => t !== '');
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      /* Whitespace rides on whatever came before it, whether or not that
         fragment carries a meaning — otherwise two neighbouring runs lose the
         space between them and plain() no longer rebuilds the line. */
      if (!tok.trim()) {
        if (out.length) out[out.length - 1].text += tok;
        else out.push({ type: 'text', text: tok });
        continue;
      }
      if (!isTarget(tok, allowed, whole, marks)) { push('text', tok); continue; }

      /* The longest run starting here that the content can translate, and
         whose every word has been introduced. */
      let best = null;
      if (table) {
        let run = '';
        for (let j = i; j < toks.length; j++) {
          const t = toks[j];
          run += t;
          if (!t.trim()) continue;
          if (!isTarget(t, allowed, whole, marks)) break;
          const hit = table[phraseKey(run)];
          if (hit) best = { upto: j, text: run, translation: hit };
        }
      }
      if (best) { push('target', best.text, best.translation); i = best.upto; continue; }
      push('target', tok, table ? (table[phraseKey(tok)] || undefined) : undefined);
    }
    /* Trailing/leading whitespace inside a fragment is harmless, but a
       fragment that is only whitespace is noise in the fixtures. */
    return out.filter(f => f.text.trim() || out.length === 1);
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

  return { fragments, plain, targetShare, bare, AMBIGUOUS, looksForeign, isTarget, marksFor, MARKS };
});
