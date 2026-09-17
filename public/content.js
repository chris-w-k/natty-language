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

    /* The constructions. {x} is the slot. A pattern with no {x} is a fixed
       phrase — courtesy words that have nowhere to vary. */
    "patterns": {
      "can-i-have": {
        "native": "Can I have {x}, please?",
        "target": "¿Me das {x}, por favor?",
        "chips": ["¿Me", "das", "{x}", "por", "favor?"],
        "coachLine": "Ask for it."
      },
      "i-love-this": {
        "native": "I love this {x}!",
        "target": "¡Me encanta esta {x}!",
        "chips": ["¡Me", "encanta", "esta", "{x}!"],
        "coachLine": "Tell them what you think."
      },
      "thank-you": {
        "native": "Thank you.",
        "target": "Gracias.",
        "chips": ["Gracias."],
        "coachLine": "Say the polite thing."
      },
      "excuse-me": {
        "native": "Excuse me.",
        "target": "Perdona.",
        "chips": ["Perdona."],
        "coachLine": "Get their attention first."
      },
      "pay-how": {
        "native": "Card.",
        "target": "Tarjeta.",
        "chips": ["Tarjeta."],
        "coachLine": "He's asking how you're paying — cash or card. Either one works.",
        /* Both answers are right — this is a choice, not a drill. checkGaps
           accepts any of these, so the tray can offer both honestly. */
        "acceptAny": ["Tarjeta.", "Efectivo."]
      }
    },

    /* The slot words. `target` is what goes in the gap, article included, so
       the gender is learned with the noun rather than as a separate rule. */
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
        "beats": [
          { "pattern": "i-love-this", "word": "song" }
        ]
      }
    ]
  };

  /* ---------- expansion ----------
     Each beat becomes one item. The item carries `patternId` so the engine can
     keep ONE mastery score for the construction across every word it is met
     with, and `slot` so the cloze knows which chip to take away first: the
     word is what the turn is actually about, and dropping "favor?" before
     "una entrada" would be testing the punctuation. */
  function expand(q) {
    const fill = (s, w) => String(s).replace('{x}', w);

    for (const scene of q.scenes) {
      scene.items = (scene.beats || []).map(beat => {
        const pat = q.patterns[beat.pattern];
        if (!pat) throw new Error('unknown pattern: ' + beat.pattern);
        const word = beat.word ? q.words[beat.word] : null;
        if (beat.word && !word) throw new Error('unknown word: ' + beat.word);

        const slotWord = word ? word.target : '';
        const chips = pat.chips.map(c => fill(c, slotWord));
        const slot = pat.chips.findIndex(c => c.includes('{x}'));

        /* Gap order: the slot first, then the frame peeling in from the end.
           At L0 the child supplies the word and reads the frame; by L4 they
           are building the whole thing. */
        const order = [];
        if (slot >= 0) order.push(slot);
        for (let i = chips.length - 1; i >= 0; i--) if (i !== slot) order.push(i);

        /* The native sentence split around the slot, so L0 can show
           "Can I have ___, please?" in the child's own language and ask for
           one Spanish word in the gap — §6's "meaning carried in the support
           language, the target word appears once". */
        const cut = String(pat.native).indexOf('{x}');
        const nativeFrame = cut >= 0
          ? { before: pat.native.slice(0, cut).trim(), after: pat.native.slice(cut + 3).trim() }
          : { before: pat.native, after: '' };

        const id = beat.pattern + (beat.word ? '-' + beat.word : '');
        return {
          id,
          nativeFrame,
          patternId: beat.pattern,
          slotId: beat.word || null,
          slotTarget: slotWord || null,
          target: fill(pat.target, slotWord),
          native: fill(pat.native, word ? word.native : ''),
          coachLine: pat.coachLine,
          chips,
          gapOrder: order,
          acceptAny: pat.acceptAny || null,
          accept: [fill(pat.target, slotWord).toLowerCase()],
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
