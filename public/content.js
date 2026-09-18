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
      /* Drill vocabulary — the words the game is actually teaching. */
      "me": "me", "das": "will you give", "pones": "will you put",
      "por": "for", "favor": "please", "por favor": "please",
      "gracias": "thank you", "muchas": "many", "muchas gracias": "thanks a lot",
      "perdona": "excuse me", "perdone": "excuse me",
      "una": "a", "un": "a", "el": "the", "la": "the", "los": "the", "las": "the",
      "entrada": "ticket", "una entrada": "a ticket", "entradas": "tickets",
      "bebida": "drink", "una bebida": "a drink", "bebidas": "drinks",
      "cerveza": "beer", "una cerveza": "a beer",
      "refresco": "soft drink", "un refresco": "a soda",
      "encanta": "I love", "esta": "this", "este": "this", "esto": "this",
      "canción": "song", "canciones": "songs",
      "efectivo": "cash", "tarjeta": "card",

      /* Scene glue. Everything a bouncer, a bartender or someone in the crowd
         might plausibly say has to be in here, because the game refuses any
         line containing a word it cannot explain when the child taps it. A
         short list did not mean a careful game — it meant the generator's
         line was thrown away almost every turn and the same hand-written
         sentence appeared over and over. The whitelist is still absolute;
         it is simply wide enough now to hold a conversation. */
      "hola": "hello", "adiós": "bye", "sí": "yes", "no": "no",
      "qué": "what", "quién": "who", "cómo": "how", "dónde": "where",
      "cuánto": "how much", "cuántos": "how many", "cuál": "which",
      "y": "and", "o": "or", "pero": "but", "que": "that", "de": "of",
      "a": "to", "en": "in", "con": "with", "sin": "without", "para": "for",
      "tu": "your", "tus": "your", "mi": "my", "te": "you", "tú": "you",
      "yo": "I", "es": "is", "son": "are", "está": "is", "están": "are",
      "hay": "there is", "tengo": "I have", "tienes": "do you have",
      "tiene": "has", "tienes aquí": "here you go",
      "quieres": "do you want", "quiero": "I want", "puedo": "can I",
      "puedes": "can you", "pongo": "shall I get you", "dame": "give me",
      "toma": "take it", "aquí": "here", "allí": "there", "ahí": "there",
      "ahora": "now", "luego": "later", "ya": "already", "todavía": "still",
      "muy": "very", "más": "more", "mucho": "a lot", "poco": "a little",
      "bien": "good", "muy bien": "very good", "mal": "bad",
      "bueno": "good", "buena": "good", "genial": "great", "guay": "cool",
      "vale": "okay", "claro": "of course", "venga": "come on",
      "pasa": "go through", "pasad": "go through", "adelante": "go ahead",
      "espera": "wait", "mira": "look", "oye": "hey", "escucha": "listen",
      "perdón": "sorry", "lo siento": "sorry",
      "euros": "euros", "euro": "euro", "dinero": "money",
      "cuesta": "does it cost", "cuestan": "do they cost", "precio": "price",
      "gratis": "free", "cambio": "change",
      "noche": "night", "buenas noches": "good evening", "hoy": "today",
      "grupo": "band", "banda": "band", "música": "music", "concierto": "gig",
      "tocando": "playing", "tocan": "they play", "suena": "it sounds",
      "escenario": "stage", "puerta": "door", "barra": "bar", "cola": "queue",
      "gente": "people", "chico": "kid", "chica": "kid", "amigo": "friend",
      "agua": "water", "zumo": "juice", "hielo": "ice", "vaso": "glass",
      "otra": "another", "otro": "another", "siguiente": "next",
      "gusta": "do you like", "me gusta": "I like it", "encantan": "I love",
      "mejor": "better", "favorita": "favourite", "favorito": "favourite",
      "increíble": "amazing", "fuerte": "loud", "marcha": "energy",
      "primero": "first", "último": "last", "solo": "only", "también": "too",
      "nada": "nothing", "algo": "something", "todo": "everything",
      "gracias a ti": "thank you",

      /* The audit reads one word at a time, so a two-word key like "buenas
         noches" never matches — each half has to be here in its own right. */
      "buenas": "good", "buenos": "good", "noches": "evening",
      "días": "day", "tardes": "afternoon", "tarde": "late",
      "tomar": "to have", "beber": "to drink", "comer": "to eat",
      "pedir": "to ask for", "entrar": "to go in", "entra": "go in",
      "ver": "to see", "oír": "to hear", "decir": "to say",
      "dice": "says", "dime": "tell me", "verdad": "right",
      "señor": "sir", "señorita": "miss", "chaval": "kid",
      "dentro": "inside", "fuera": "outside", "arriba": "up",
      "list": "ready", "listo": "ready", "lista": "ready",
      "vamos": "let's go", "va": "goes", "voy": "I'm going",
      "eso": "that", "esa": "that", "ese": "that", "estos": "these",
      "cuidado": "careful", "tranquilo": "easy", "gracias": "thank you"
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
        "coachLine": "Ask for it.",
        "coachLines": ["Ask for it.", "Go on — ask him.", "Your turn. Ask.", "Say what you want."]
      },
      "i-love-this": {
        "segments": [
          { "native": "I love this", "target": "\u00a1Me encanta esta" },
          { "native": "{x}!", "target": "{x}!", "slot": true }
        ],
        "coachLine": "Tell them what you think.",
        "coachLines": ["Tell them what you think.", "Say it back to them.", "Go on, tell them.", "What do you reckon? Say it."]
      },
      "thank-you": {
        "segments": [{ "native": "Thank you.", "target": "Gracias." }],
        "coachLine": "Say the polite thing.",
        "coachLines": ["Say the polite thing.", "Don't forget your manners.", "One more word and you're in.", "Be polite."]
      },
      "excuse-me": {
        "segments": [{ "native": "Excuse me.", "target": "Perdona." }],
        "coachLine": "Get their attention first.",
        "coachLines": ["Get their attention first.", "They haven't seen you. Say something.", "Start politely.", "Catch their eye first."]
      },
      "pay-how": {
        "segments": [{ "native": "Card.", "target": "Tarjeta." }],
        "coachLine": "He's asking how you're paying \u2014 cash or card. Either one works.",
        "coachLines": ["He's asking how you're paying \u2014 cash or card. Either one works.", "Cash or card? Your call.", "How are you paying? Either is fine.", "Pick one \u2014 cash or card."],
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
        /* §6 L0-L1: meaning in the child's own language, the target word
           appearing once. The generator normally writes these; these are what
           the game falls back to when it cannot, and there are several of each
           because one apiece meant a rejected generation produced the exact
           same screen every turn. */
        "opening": "¿Sí? ¿Tienes entrada?",
        "openingNative": "Hold up. You got an entrada?",
        "lines": {
          "native": [
            "Hold up. You got an entrada?",
            "Nobody gets in without an entrada, kid.",
            "Right — show me the entrada and you're in.",
            "Well? No entrada, no gig."
          ],
          "target": [
            "¿Sí? ¿Tienes entrada?",
            "¿Y tu entrada?",
            "Sin entrada no pasas.",
            "Venga, la entrada."
          ]
        },
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
        "lines": {
          "native": [
            "Hey! What can I get you — a bebida?",
            "Busy night. You want a bebida or not?",
            "Yes? One bebida coming up, if you ask me.",
            "What's it to be? Say the word — bebida?"
          ],
          "target": [
            "¡Hola! ¿Qué te pongo?",
            "¿Sí? ¿Qué quieres?",
            "Dime. ¿Una bebida?",
            "¿Y para ti?"
          ]
        },
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
        "lines": {
          "native": [
            "Listen to them go! What do you make of this canción?",
            "They're on! Tell me about this canción.",
            "Oh, this one — what do you think of the canción?",
            "Best bit of the night. This canción, yeah?"
          ],
          "target": [
            "¡Mira! ¡Están tocando!",
            "¡Qué buena!",
            "¿Te gusta?",
            "¡Esta es la mejor!"
          ]
        },
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
          coachLines: pat.coachLines || [pat.coachLine],
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
