/* The quest content.

   Two patterns and a handful of words, which is how the source models a
   scenario and how Chris specified this one. A PATTERN is a construction with
   one slot; a WORD drops into that slot. "Can I have a ticket" and "Can I have
   a soda" are the same pattern met twice, not two unrelated things to learn —
   so the pattern's mastery carries across the venue while each new word starts
   from nothing, which is exactly what keeps the support up for the word and
   not for the frame.

   expand() below turns patterns x words into the flat item list the engine
   plays. Nothing outside this file needs to know the difference. */

window.QUEST = (function () {

  const quest = {
    "id": "axel-gig",
    "title": "Axel goes to a gig",
    "coach": "axel",
    "nativeLang": "en",
    "targetLang": "es",

    "session": {
      "turnBudget": 32,   /* 8 items; below ~32 the final scene never really happens */
      "masteryBar": 0.85,
      "canUseBar": 0.75,
      "mercyAfterFailedTurns": 4
    },

    /* Word-level glosses. Every Spanish word a child can see on screen is
       tappable, and this is what the tooltip shows. It is also the whitelist:
       the generator may not use a target-language word that is not in here or
       in a pattern's own chips, because a word with no gloss is a dead end.
       Keys are lowercase and stripped of punctuation. */
    "glossary": {
      "me": "me", "das": "will you give", "pones": "will you put",
      "por": "for", "favor": "please", "por favor": "please",
      "gracias": "thank you", "muchas": "many", "muchas gracias": "thanks a lot",
      "perdona": "excuse me", "perdone": "excuse me",
      "una": "a", "un": "a", "el": "the", "la": "the",
      "entrada": "ticket", "una entrada": "a ticket",
      "bebida": "drink", "una bebida": "a drink",
      "cerveza": "beer", "una cerveza": "a beer",
      "refresco": "soft drink", "un refresco": "a soda",
      "encanta": "I love", "esta": "this", "este": "this",
      "canción": "song", "canción!": "song",
      "efectivo": "cash", "tarjeta": "card",
      "hola": "hello", "sí": "yes", "no": "no", "qué": "what",
      "quieres": "do you want", "te": "you", "pongo": "shall I get you",
      "tienes": "do you have", "son": "that's", "euros": "euros",
      "cuánto": "how much", "es": "is", "cuesta": "does it cost",
      "o": "or", "aquí": "here", "tienes aquí": "here you go",
      "pasa": "go through", "adelante": "go ahead", "vale": "okay",
      "están": "they are", "tocando": "playing", "mira": "look",
      "buena": "good", "noche": "night", "adiós": "bye"
    },

    /* The constructions, declared as SEGMENTS that line up across the two
       languages. Each segment has the child's version and the target version,
       and one carries the slot. Aligning them is what lets the sentence start
       mostly in English and lose an English chunk per rung:

         L0   Can I have [una entrada] please?
         L1   Can I have [una entrada] [por favor?]
         L2   [\u00bfMe das] [una entrada] [por favor?]

       Cloze over bare words could not do that \u2014 there is no English word that
       "por" replaces. */
    "patterns": {
      "can-i-have": {
        "segments": [
          { "native": "Can I have", "target": "\u00bfMe das" },
          { "native": "{x}", "target": "{x}", "slot": true },
          /* `lead` is punctuation that belongs to the JOIN, not to the chip.
             "una entrada, por favor?" needs the comma; a chip reading
             ", por favor?" would be nonsense to tap. */
          { "native": "please?", "target": "por favor?", "lead": "," }
        ],
        "coachLine": "Ask for it."
      },
      "i-love-this": {
        "segments": [
          { "native": "I love this", "target": "\u00a1Me encanta esta" },
          { "native": "{x}!", "target": "{x}!", "slot": true }
        ],
        "coachLine": "Tell them what you think."
      },
      "thank-you": {
        "segments": [{ "native": "Thank you.", "target": "Gracias." }],
        "coachLine": "Say the polite thing."
      },
      "excuse-me": {
        "segments": [{ "native": "Excuse me.", "target": "Perdona." }],
        "coachLine": "Get their attention first."
      },
      "pay-how": {
        "segments": [{ "native": "Card.", "target": "Tarjeta." }],
        "coachLine": "He's asking how you're paying \u2014 cash or card. Either one works.",
        /* Both answers are right \u2014 this is a choice, not a drill. */
        "acceptAny": ["Tarjeta.", "Efectivo."]
      }
    },

    "words": {
      "ticket": { "target": "una entrada",  "native": "a ticket" },
      "drink":  { "target": "una bebida",   "native": "a drink" },
      "beer":   { "target": "una cerveza",  "native": "a beer" },
      "soda":   { "target": "un refresco",  "native": "a soda" },
      "song":   { "target": "canción",      "native": "song" }
    },

    "scenes": [
      {
        "id": "s1-the-door",
        "title": "The door",
        "background": "venue-front-door",
        "goal": "get past the bouncer with a ticket",
        "onScreen": { "character": "bouncer", "role": "npc", "speaks": "target" },
        "opening": "¿Sí? ¿Tienes entrada?",
        /* §6 L0-L1: meaning in the child's own language, the target word
           appearing once. The generator normally writes these; this is what
           the game falls back to. */
        "openingNative": "Hold up. You got an entrada?",
        "beats": [
          { "pattern": "can-i-have", "word": "ticket" },
          { "pattern": "thank-you" }
        ]
      },

      {
        "id": "s2-the-bar",
        "title": "The bar",
        "background": "venue-bar",
        "goal": "order a drink and pay for it",
        "onScreen": { "character": "bartender", "role": "npc", "speaks": "target" },
        "opening": "¡Hola! ¿Qué te pongo?",
        "openingNative": "Hey! What can I get you — a bebida?",
        "beats": [
          { "pattern": "excuse-me" },
          { "pattern": "can-i-have", "word": "drink" },
          { "pattern": "can-i-have", "word": "soda" },
          { "pattern": "can-i-have", "word": "beer" },
          { "pattern": "pay-how" }
        ]
      },

      {
        "id": "s3-the-gig",
        "title": "In the venue",
        "background": "venue-stage",
        "goal": "enjoy the band with Axel",
        "onScreen": { "character": "fan", "role": "npc", "speaks": "target" },
        "opening": "¡Mira! ¡Están tocando!",
        "openingNative": "Listen to them go! What do you make of this canción?",
        "beats": [
          { "pattern": "i-love-this", "word": "song" }
        ]
      }
    ]
  };

  /* ---------- expansion ----------
     Each beat becomes one item. `patternId` lets the engine keep ONE mastery
     score for the construction across every word it is met with, and the
     aligned segments give the cloze something to peel: the slot goes first
     because that is what the turn is about, then the English chunks are
     replaced by their target counterparts from the end inwards. */
  function expand(q) {
    const fill = (s, w) => String(s).replace('{x}', w);
    const join = parts => parts.join(' ').replace(/\s+([,.!?])/g, '$1').trim();

    for (const scene of q.scenes) {
      scene.items = (scene.beats || []).map(beat => {
        const pat = q.patterns[beat.pattern];
        if (!pat) throw new Error('unknown pattern: ' + beat.pattern);
        const word = beat.word ? q.words[beat.word] : null;
        if (beat.word && !word) throw new Error('unknown word: ' + beat.word);

        const slotTarget = word ? word.target : '';
        const slotNative = word ? word.native : '';

        const segments = pat.segments.map(seg => ({
          slot:   !!seg.slot,
          lead:   seg.lead || '',
          target: fill(seg.target, slotTarget),
          native: fill(seg.native, slotNative),
        }));
        // the chip stays clean; the punctuation only shows up in the sentence
        const lead = (s, k) => (s.lead ? s.lead + ' ' : '') + s[k];

        const chips = segments.map(s => s.target);
        const slot = segments.findIndex(s => s.slot);

        /* Gap order: the slot, then the remaining chunks from the end inwards.
           "Can I have [___] please?" becomes "Can I have [___] [___]" becomes
           "[___] [___] [___]" \u2014 one English chunk leaving per rung. */
        const order = [];
        if (slot >= 0) order.push(slot);
        for (let i = segments.length - 1; i >= 0; i--) if (i !== slot) order.push(i);

        const id = beat.pattern + (beat.word ? '-' + beat.word : '');
        const target = join(segments.map(s => lead(s, 'target')));
        return {
          id,
          patternId: beat.pattern,
          slotId: beat.word || null,
          slotTarget: slotTarget || null,
          segments,
          target,
          native: join(segments.map(s => lead(s, 'native'))),
          coachLine: pat.coachLine,
          chips,
          gapOrder: order,
          acceptAny: pat.acceptAny || null,
          accept: [target.toLowerCase()],
          distractors: []
        };
      });
    }

    /* A decoy has to be a plausible wrong answer, not just another word on the
       board. When the turn is asking for the SLOT, the other slot words are
       the real competition — a ticket, a drink, a beer all fit "¿Me das ___"
       and telling them apart is the point. Frame words only come in once the
       child is building whole sentences, where word order is what is being
       tested. Everything here is real quest vocabulary; the engine filters it
       again to what the child has actually met. */
    const slotWords = [...new Set(Object.values(q.words).map(w => w.target))];
    const frameChips = [];
    for (const scene of q.scenes) for (const it of scene.items)
      for (const c of it.chips) if (!slotWords.includes(c)) frameChips.push(c);

    // "canción" must not be offered as a decoy against the chip "canción!"
    const key = w => String(w).toLowerCase().replace(/[¿?¡!.,;:]/g, '').trim();
    for (const scene of q.scenes) for (const it of scene.items) {
      const own = new Set(it.chips.map(key));
      const near = slotWords.filter(w => !own.has(key(w)));
      const far  = [...new Set(frameChips.filter(c => !own.has(key(c))))];
      it.distractors = [...near, ...far];
      if (it.acceptAny) for (const alt of it.acceptAny) if (!own.has(key(alt))) it.distractors.unshift(alt);
    }
    return q;
  }

  return expand(quest);
})();
