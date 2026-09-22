/* The scenario, in the shape the real build stores it.

   NJA-3139 / NJA-3152 put this in Directus as four collections. We have no
   Directus, so the same four collections live here as plain objects with the
   same field names. When the content moves, it moves as data — nothing in the
   engine knows where it came from.

     nlt_vocab_items     id, slot_tags, and bare / definite / indefinite
                         in every supported language
     nlt_vocab_patterns  id, and a template per language whose slots are typed:
                         "I want {item:indefinite} and {item#2:indefinite}"
     nlt_slot_tags       the tag vocabulary that joins the two
     activity            actor, coach, background, prompt, and the lists of
                         patterns and items this scenario draws on

   Vocabulary and phrases are NJA-3145's experiment scenario, verbatim apart
   from one spelling fix ("Cervesa" -> "Cerveza") noted back to the ticket. */

window.QUEST = (function () {

  /* Which language the child already has, and which they are here to learn.
     Reversible by design (NJA-3136, multi-language): nothing below assumes
     English is either one. The MVP runs en -> es so Chris can play it; the
     real product runs es/pt/... -> en with the same content. */
  const LANGS = { native: 'en', target: 'es' };

  const slotTags = ['item', 'likeable'];

  /* bare / definite / indefinite, per language — the three forms a slot can
     ask for. English fills all three even where two are identical, because
     the pattern picks the form and the pattern does not know the language. */
  const vocabItems = {
    ticket:   { tags: ['item', 'likeable'],
                en: { bare: 'ticket',   definite: 'the ticket',   indefinite: 'a ticket' },
                es: { bare: 'entrada',  definite: 'la entrada',   indefinite: 'una entrada' } },
    water:    { tags: ['item', 'likeable'],
                en: { bare: 'water',    definite: 'water',        indefinite: 'water' },
                es: { bare: 'agua',     definite: 'el agua',      indefinite: 'agua' } },
    soda:     { tags: ['item', 'likeable'],
                en: { bare: 'soda',     definite: 'the soda',     indefinite: 'a soda' },
                es: { bare: 'refresco', definite: 'el refresco',  indefinite: 'un refresco' } },
    beer:     { tags: ['item', 'likeable'],
                en: { bare: 'beer',     definite: 'the beer',     indefinite: 'a beer' },
                es: { bare: 'cerveza',  definite: 'la cerveza',   indefinite: 'una cerveza' } },
    sandwich: { tags: ['item', 'likeable'],
                en: { bare: 'sandwich', definite: 'the sandwich', indefinite: 'a sandwich' },
                es: { bare: 'bocadillo', definite: 'el bocadillo', indefinite: 'un bocadillo' } },
    record:   { tags: ['item', 'likeable'],
                en: { bare: 'record',   definite: 'the record',   indefinite: 'a record' },
                es: { bare: 'disco',    definite: 'el disco',     indefinite: 'un disco' } },
    tshirt:   { tags: ['item', 'likeable'],
                en: { bare: 't-shirt',  definite: 'the t-shirt',  indefinite: 'a t-shirt' },
                es: { bare: 'camiseta', definite: 'la camiseta',  indefinite: 'una camiseta' } },
    /* A band is not something you can be handed across a counter, so it
       carries `likeable` only and the engine will never pair it with
       "Can I have ___". That tag check is the whole point of NJA-3152's
       slot_tags: adding a noun is a tag, not an edit to seven patterns. */
    band:     { tags: ['likeable'],
                en: { bare: 'band',     definite: 'the band',     indefinite: 'a band' },
                es: { bare: 'grupo',    definite: 'el grupo',     indefinite: 'un grupo' } },
    singer:   { tags: ['likeable'],
                en: { bare: 'singer',   definite: 'the singer',   indefinite: 'a singer' },
                es: { bare: 'cantante', definite: 'el cantante',  indefinite: 'un cantante' } },
  };

  /* Slot syntax is NJA-3152's: {tag#number:article}. The number distinguishes
     two slots drawing on the same tag; the article names which form to fill
     it with. A pattern with no slot is said whole. */
  const vocabPatterns = {
    'excuse-me':    { en: 'Excuse me.',                es: 'Perdona.',                  opensOnly: true },
    'do-you-have':  { en: 'Do you have {item:indefinite}?',        es: '¿Tienes {item:indefinite}?' },
    'can-i-have':   { en: 'Can I have {item:indefinite}, please?', es: '¿Me das {item:indefinite}, por favor?' },
    'i-have':       { en: 'I have {item:indefinite}.',            es: 'Tengo {item:indefinite}.' },
    'i-dont-have':  { en: "I don't have {item:bare}.",            es: 'No tengo {item:bare}.' },
    'there-is-no':  { en: 'There is no {item:bare}.',             es: 'No hay {item:bare}.' },
    'do-you-like':  { en: 'Do you like {likeable:definite}?',     es: '¿Te gusta {likeable:definite}?' },
    'i-like':       { en: 'I like {likeable:definite}.',          es: 'Me gusta {likeable:definite}.' },
    'thank-you':    { en: 'Thank you.',                es: 'Gracias.' },
  };

  /* One activity, standing in for a row of quest_activities_nlt_prototype.
     `order` is what Directus list order gives the real build, and the engine
     uses it exactly as NJA-3136 says: first in list when mastery ties. */
  const activity = {
    id: 'dev_nlt_activity_gig',
    title: 'Axel goes to a gig',
    background: 'venue-bar',
    actor: { id: 'bartender', name: 'Bartender', speaks: 'target' },
    coach: { id: 'axel', name: 'Coach' },
    prompt: 'You are the one person behind the counter at a music venue — you sell the tickets, the drinks and the merch. A kid has come up to you. You are gruff but good-natured, you have seen it all, and there is a queue behind them.',
    objectives: ['get in', 'get something to drink', 'get some merch', 'talk about the band'],
    patterns: ['excuse-me', 'do-you-have', 'can-i-have', 'i-have', 'i-dont-have',
               'there-is-no', 'do-you-like', 'i-like', 'thank-you'],
    items: ['ticket', 'water', 'soda', 'beer', 'sandwich', 'record', 'tshirt', 'band', 'singer'],
  };

  const session = {
    /* NJA-3136 ends a session on mastery, not on a clock. The cap is a
       backstop so a child who cannot get one item right still reaches an
       ending — without it, "repeat until they get it right" has no exit. */
    turnCap: 40,
    masteryBar: 0.8,       // correct / (correct + incorrect) to count as produced
    minExposures: 2,       // ...but not before this many tries, or 1/1 = mastered
    mercyAfterFailedTurns: 4,
  };

  /* ---------- expansion ----------
     NJA-3136, Engine step 1: build the pattern x item pairs and validate them
     by slot tag. Step 2: keep them in the order the lists declare. */
  const SLOT = /\{([a-z_]+)(?:#(\d+))?:([a-z|]+)\}/gi;

  function slotsOf(template) {
    const out = [];
    let m;
    SLOT.lastIndex = 0;
    while ((m = SLOT.exec(template)) !== null) {
      out.push({ raw: m[0], tag: m[1], n: m[2] ? Number(m[2]) : 1, forms: m[3].split('|') });
    }
    return out;
  }

  function expand() {
    const q = {
      id: activity.id, title: activity.title, activity,
      nativeLang: LANGS.native, targetLang: LANGS.target,
      slotTags, vocabItems, vocabPatterns, session,
      glossary: {}, chipGloss: {},
    };

    const pairs = [];
    for (const pid of activity.patterns) {
      const pat = vocabPatterns[pid];
      if (!pat) throw new Error('unknown pattern: ' + pid);
      const slots = slotsOf(pat[LANGS.native]);

      if (!slots.length) {                       // said whole: one pair, no item
        pairs.push(makePair(q, pid, pat, [], []));
        continue;
      }
      if (slots.length > 1) throw new Error('one slot per pattern for now: ' + pid);

      const slot = slots[0];
      const usable = activity.items.filter(id => (vocabItems[id].tags || []).includes(slot.tag));
      if (!usable.length) throw new Error('pattern has no valid vocab items: ' + pid);
      // the article the slot asks for; "a|b" means either is acceptable, first wins
      const form = slot.forms[0];
      for (const iid of usable) pairs.push(makePair(q, pid, pat, [slot], [{ id: iid, form }]));
    }

    q.pairs = pairs;

    /* Every word the child can see, and what it means. Built from the content
       rather than hand-written, so a new item is glossed the moment it is
       added — the whitelist and the tap-to-translate modal both read this. */
    for (const [iid, item] of Object.entries(vocabItems)) {
      for (const form of ['bare', 'definite', 'indefinite']) {
        const t = item[LANGS.target][form], n = item[LANGS.native][form];
        q.chipGloss[t.toLowerCase()] = n;
        for (const tok of t.split(/\s+/)) q.glossary[bare(tok)] = q.glossary[bare(tok)] || n;
      }
    }
    for (const p of pairs) {
      for (const seg of p.frame.target.split(/\s+/)) {
        const k = bare(seg);
        if (k && !q.glossary[k]) q.glossary[k] = '(part of "' + p.frame.native.trim() + '")';
      }
      q.chipGloss[p.frame.target.trim().toLowerCase()] = p.frame.native.trim();
    }
    return q;
  }

  const bare = w => String(w).toLowerCase().replace(/[¿?¡!.,;:"“”]/g, '').trim();

  /* One playable pair. The FRAME is the pattern with its slot removed — the
     part the child learns as a construction — and the ITEM is what drops into
     it. They are tracked separately because the engine flips one or the other
     into the target language (NJA-3136, Engine step 4). */
  function makePair(q, pid, pat, slots, fills) {
    const render = (lang, itemLang) => {
      let s = pat[lang];
      for (let i = 0; i < slots.length; i++) {
        const f = fills[i];
        s = s.replace(slots[i].raw, vocabItems[f.id][itemLang || lang][f.form]);
      }
      return s;
    };
    const fill = fills[0] || null;
    return {
      id: pid + (fill ? '-' + fill.id : ''),
      patternId: pid,
      itemId: fill ? fill.id : null,
      form: fill ? fill.form : null,
      opensOnly: !!pat.opensOnly,
      hasSlot: slots.length > 0,
      // the frame with the slot blanked, for showing the construction alone
      frame: {
        native: slots.length ? pat[LANGS.native].replace(slots[0].raw, '___') : pat[LANGS.native],
        target: slots.length ? pat[LANGS.target].replace(slots[0].raw, '___') : pat[LANGS.target],
      },
      item: fill ? {
        native: vocabItems[fill.id][LANGS.native][fill.form],
        target: vocabItems[fill.id][LANGS.target][fill.form],
      } : null,
      // the four renderings the engine chooses between
      allNative:   render(LANGS.native),
      allTarget:   render(LANGS.target),
      itemTarget:  render(LANGS.native, LANGS.target),   // native frame, target word
      frameTarget: render(LANGS.target, LANGS.native),   // target frame, native word
    };
  }

  return expand();
})();
