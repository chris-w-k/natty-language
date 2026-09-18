/* The quest content.

   ONE stage, one person to talk to. The scenario used to be three rooms with
   two or three phrases each, and the model had almost nothing to work with in
   any of them — three phrases is not a conversation, it is a menu, which is
   why the same line kept coming back. Everything now lives in one room with
   five constructions and nine nouns, so the generator has somewhere to go and
   the learner model has something to choose between.

   A PATTERN is a construction with one slot. A WORD drops into that slot.
   "Can I have a ticket" and "Can I have a t-shirt" are the same pattern met
   twice, not two things to learn — so the pattern's mastery carries while each
   new word starts from nothing. That gap is what the support ladder rides on.

   expand() turns patterns x words into the flat item list the engine plays. */

window.QUEST = (function () {

  const quest = {
    "id": "axel-gig",
    "title": "Axel goes to a gig",
    "coach": "axel",
    "nativeLang": "en",
    "targetLang": "es",

    "session": {
      "turnBudget": 32,
      "masteryBar": 0.85,
      "canUseBar": 0.75,
      "mercyAfterFailedTurns": 4
    },

    /* Word-level glosses. Every Spanish word a child can see is tappable, and
       this is what the tooltip shows. It is also the whitelist: the generator
       may not use a target-language word that is not in here, because a word
       with no gloss is a dead end. Wide enough to hold a conversation —
       a fifty-word list meant the model's line was thrown away nearly every
       turn and the same hand-written sentence came back instead. */
    "glossary": {
      /* what is being taught */
      "tienes": "do you have", "tengo": "I have", "hay": "there is",
      "me": "me", "das": "will you give", "gusta": "do you like",
      "me gusta": "I like", "por": "for", "favor": "please",
      "por favor": "please", "gracias": "thank you", "perdona": "excuse me",
      "no": "no", "sí": "yes",
      "una": "a", "un": "a", "el": "the", "la": "the", "los": "the", "las": "the",
      "este": "this", "esta": "this", "esto": "this",
      "entrada": "ticket", "entradas": "tickets",
      "agua": "water", "refresco": "soft drink", "refrescos": "soft drinks",
      "cerveza": "beer", "grupo": "band", "banda": "band",
      "camiseta": "t-shirt", "camisetas": "t-shirts",
      "disco": "record", "discos": "records",
      "efectivo": "cash", "tarjeta": "card",

      /* scene glue — what a person behind a counter actually says */
      "hola": "hello", "adiós": "bye", "buenas": "hello", "noches": "evening",
      "días": "day", "tardes": "afternoon",
      "qué": "what", "quién": "who", "cómo": "how", "dónde": "where",
      "cuánto": "how much", "cuántos": "how many", "cuál": "which",
      "y": "and", "o": "or", "pero": "but", "que": "that", "de": "of",
      "a": "to", "en": "in", "con": "with", "sin": "without", "para": "for",
      "tu": "your", "tus": "your", "mi": "my", "te": "you", "tú": "you",
      "yo": "I", "es": "is", "son": "are", "está": "is", "están": "are",
      "quieres": "do you want", "quiero": "I want", "puedo": "can I",
      "puedes": "can you", "pongo": "shall I get you", "dame": "give me",
      "toma": "take it", "aquí": "here", "allí": "there", "ahí": "there",
      "ahora": "now", "luego": "later", "ya": "already", "todavía": "still",
      "muy": "very", "más": "more", "mucho": "a lot", "poco": "a little",
      "bien": "good", "mal": "bad", "bueno": "good", "buena": "good",
      "genial": "great", "guay": "cool", "vale": "okay", "claro": "of course",
      "venga": "come on", "pasa": "go through", "adelante": "go ahead",
      "espera": "wait", "mira": "look", "oye": "hey", "escucha": "listen",
      "perdón": "sorry", "siento": "sorry",
      "euros": "euros", "euro": "euro", "dinero": "money",
      "cuesta": "does it cost", "cuestan": "do they cost", "precio": "price",
      "gratis": "free", "cambio": "change", "queda": "is left",
      "quedan": "are left", "último": "last", "últimas": "last",
      "noche": "night", "hoy": "today", "música": "music", "concierto": "gig",
      "tocando": "playing", "tocan": "they play", "suena": "it sounds",
      "escenario": "stage", "puerta": "door", "barra": "bar", "cola": "queue",
      "gente": "people", "chico": "kid", "chica": "kid", "amigo": "friend",
      "zumo": "juice", "hielo": "ice", "vaso": "glass", "talla": "size",
      "otra": "another", "otro": "another", "siguiente": "next",
      "encanta": "I love", "encantan": "I love", "mejor": "better",
      "favorita": "favourite", "favorito": "favourite",
      "increíble": "amazing", "fuerte": "loud",
      "primero": "first", "solo": "only", "también": "too",
      "nada": "nothing", "algo": "something", "todo": "everything",
      "grande": "big", "pequeña": "small", "pequeño": "small",
      "negra": "black", "blanca": "white", "roja": "red",
      "tomar": "to have", "beber": "to drink", "ver": "to see",
      "decir": "to say", "dime": "tell me", "verdad": "right",
      "señor": "sir", "chaval": "kid", "vamos": "let's go",
      "eso": "that", "esa": "that", "ese": "that",
      "tranquilo": "easy", "cuidado": "careful",
      "bebida": "drink", "bebidas": "drinks", "botella": "bottle",
      "lata": "can", "entradas": "tickets", "grupos": "bands",
      "cola": "queue", "caja": "till", "bolsa": "bag",
      "pequeña": "small", "mediana": "medium", "grandes": "big"
    },

    /* The constructions, declared as SEGMENTS that line up across the two
       languages. Each segment has the child's version and the target version,
       and one carries the slot. Aligning them is what lets the sentence start
       mostly in English and lose an English chunk per rung:

         L0   Can I have [una entrada] please?
         L1   Can I have [una entrada] [por favor?]
         L2   [¿Me das] [una entrada] [por favor?]

       Cloze over bare words could not do that — there is no English word that
       "por" replaces.

       The slot names which FORM of the word it wants. "Can I have a beer" and
       "I like this beer" need "una cerveza" and "esta cerveza"; one slot value
       per word would have produced "I like this a beer". `lead` and `tail` are
       punctuation that belongs to the sentence rather than to a chip — nobody
       can read a chip that says ", por favor?" or "?". */
    "patterns": {
      "do-you-have": {
        "segments": [
          { "native": "Do you have", "target": "¿Tienes" },
          { "native": "{x}", "target": "{x}", "slot": true, "form": "a" }
        ],
        "tail": "?",
        "coachLine": "Ask him if he's got one.",
        "coachLines": ["Ask him if he's got one.", "Find out if there's any.",
                       "Ask whether he has it.", "See if they've got one."],
        "words": ["ticket", "water", "soda", "beer", "tshirt", "record"]
      },

      "can-i-have": {
        "segments": [
          { "native": "Can I have", "target": "¿Me das" },
          { "native": "{x}", "target": "{x}", "slot": true, "form": "a" },
          { "native": "please?", "target": "por favor?", "lead": "," }
        ],
        "coachLine": "Ask for it.",
        "coachLines": ["Ask for it.", "Go on — ask him.", "Your turn. Ask.",
                       "Say what you want."],
        "words": ["ticket", "water", "soda", "beer", "tshirt", "record"]
      },

      "there-is-no": {
        "segments": [
          { "native": "There is no", "target": "No hay" },
          { "native": "{x}", "target": "{x}", "slot": true, "form": "bare" }
        ],
        "tail": ".",
        "coachLine": "Say what they've run out of.",
        "coachLines": ["Say what they've run out of.", "Tell him there isn't any.",
                       "Say there's none left.", "Say what's missing."],
        "words": ["ticket", "water", "soda", "beer", "tshirt", "record"]
      },

      "there-is": {
        "segments": [
          { "native": "There is", "target": "Hay" },
          { "native": "{x}", "target": "{x}", "slot": true, "form": "a" }
        ],
        "tail": ".",
        "coachLine": "Say what you can see.",
        "coachLines": ["Say what you can see.", "Tell him what's there.",
                       "Point it out.", "Say what's on."],
        "words": ["band", "record", "tshirt"]
      },

      "i-like-this": {
        "segments": [
          { "native": "I like", "target": "Me gusta" },
          { "native": "{x}", "target": "{x}", "slot": true, "form": "demo" }
        ],
        "tail": ".",
        "coachLine": "Tell him what you think.",
        "coachLines": ["Tell him what you think.", "Say you like it.",
                       "Tell him your verdict.", "Let him know."],
        "words": ["band", "record", "tshirt", "beer", "soda"]
      },

      /* No slot: said whole, or they are not said at all. "please" lives
         inside can-i-have; these two stand on their own. */
      "thank-you": {
        "segments": [{ "native": "Thank you.", "target": "Gracias." }],
        "coachLine": "Say the polite thing.",
        "coachLines": ["Say the polite thing.", "Don't forget your manners.",
                       "One more word.", "Be polite."]
      },
      "excuse-me": {
        "segments": [{ "native": "Excuse me.", "target": "Perdona." }],
        "coachLine": "Get his attention first.",
        "coachLines": ["Get his attention first.", "He hasn't seen you — say something.",
                       "Start politely.", "Catch his eye first."]
      },
      "pay-how": {
        "segments": [{ "native": "Card.", "target": "Tarjeta." }],
        "coachLine": "He's asking how you're paying — cash or card. Either works.",
        "coachLines": ["He's asking how you're paying — cash or card. Either works.",
                       "Cash or card? Your call.", "How are you paying? Either is fine.",
                       "Pick one — cash or card."],
        /* Both answers are right — this is a choice, not a drill. */
        "acceptAny": ["Tarjeta.", "Efectivo."]
      }
    },

    /* Each word carries every form the patterns ask for, in BOTH languages,
       because the two sides have to stay aligned for the cloze to peel one
       chunk at a time. `a` is what you ask for, `bare` is what there is none
       of, `demo` is what you are pointing at. */
    "words": {
      "ticket": { "a": ["una entrada", "a ticket"],   "bare": ["entrada", "ticket"],   "demo": ["esta entrada", "this ticket"] },
      "water":  { "a": ["agua", "water"],             "bare": ["agua", "water"],         "demo": ["esta agua", "this water"] },
      "soda":   { "a": ["un refresco", "a soda"],     "bare": ["refresco", "soda"],      "demo": ["este refresco", "this soda"] },
      "beer":   { "a": ["una cerveza", "a beer"],     "bare": ["cerveza", "beer"],       "demo": ["esta cerveza", "this beer"] },
      "band":   { "a": ["un grupo", "a band"],        "bare": ["grupo", "band"],       "demo": ["este grupo", "this band"] },
      "tshirt": { "a": ["una camiseta", "a t-shirt"], "bare": ["camiseta", "t-shirt"], "demo": ["esta camiseta", "this t-shirt"] },
      "record": { "a": ["un disco", "a record"],      "bare": ["disco", "record"],     "demo": ["este disco", "this record"] }
    },

    "scenes": [
      {
        "id": "s1-the-bar",
        "title": "The counter",
        "background": "venue-bar",
        "goal": "get a ticket, something to drink and a t-shirt",
        "onScreen": { "character": "bartender", "role": "npc", "speaks": "target" },
        /* §6 L0-L1: meaning in the child's own language, the target word
           appearing once. The generator normally writes these; these are what
           the game falls back to when it cannot, and there are several because
           one apiece meant a rejected line produced the same screen every
           turn. */
        "opening": "¡Hola! ¿Qué quieres?",
        "openingNative": "Evening! Still after an entrada?",
        "lines": {
          "native": [
            "Evening! Still after an entrada?",
            "Busy night. What can I get you — agua?",
            "Yes? There's still a camiseta or two left.",
            "Go on then. Say the word — cerveza?"
          ],
          "target": [
            "¡Hola! ¿Qué quieres?",
            "¿Sí? Dime.",
            "¿Y para ti?",
            "Venga, ¿qué te pongo?"
          ]
        },
        /* One room, so the beats are not a script — they are the starting
           order. The engine takes over after the first construction, choosing
           by mastery (§7) rather than walking a list. */
        "opens": ["excuse-me", "do-you-have", "can-i-have", "thank-you",
                  "there-is-no", "there-is", "i-like-this", "pay-how"]
      }
    ]
  };

  /* ---------- expansion ----------
     Every pattern x word pairing the matrix allows becomes one item.
     `patternId` lets the engine keep ONE mastery score for the construction
     across every word it is met with, and the aligned segments give the cloze
     something to peel: the slot goes first because that is what the turn is
     about, then the English chunks are replaced from the end inwards. */
  function expand(q) {
    const join = parts => parts.filter(Boolean).join(' ')
      .replace(/\s+([,.!?])/g, '$1').replace(/([¿¡])\s+/g, '$1').trim();

    const items = [];
    for (const [pid, pat] of Object.entries(q.patterns)) {
      const wordIds = pat.words && pat.words.length ? pat.words : [null];
      for (const wid of wordIds) {
        const word = wid ? q.words[wid] : null;
        if (wid && !word) throw new Error('unknown word: ' + wid);

        const segments = pat.segments.map(seg => {
          const form = seg.slot ? (seg.form || 'a') : null;
          const pair = (word && form) ? word[form] : null;
          if (seg.slot && !pair) throw new Error(`${wid} has no "${form}" form`);
          return {
            slot: !!seg.slot,
            lead: seg.lead || '',
            target: seg.slot ? pair[0] : seg.target,
            native: seg.slot ? pair[1] : seg.native,
          };
        });

        const lead = (s, k) => (s.lead ? s.lead + ' ' : '') + s[k];
        const tail = pat.tail || '';
        const chips = segments.map(s => s.target);
        const slot = segments.findIndex(s => s.slot);

        /* Gap order: the slot, then the remaining chunks from the end inwards.
           "Can I have [___] please?" becomes "Can I have [___] [___]" becomes
           "[___] [___] [___]" — one English chunk leaving per rung. */
        const order = [];
        if (slot >= 0) order.push(slot);
        for (let i = segments.length - 1; i >= 0; i--) if (i !== slot) order.push(i);

        const target = join(segments.map(s => lead(s, 'target'))) + tail;
        items.push({
          id: pid + (wid ? '-' + wid : ''),
          patternId: pid,
          slotId: wid || null,
          slotTarget: slot >= 0 ? segments[slot].target : null,
          segments, tail,
          target,
          native: join(segments.map(s => lead(s, 'native'))) + tail,
          coachLine: pat.coachLine,
          coachLines: pat.coachLines || [pat.coachLine],
          chips,
          gapOrder: order,
          acceptAny: pat.acceptAny || null,
          accept: [target.toLowerCase()],
          distractors: []
        });
      }
    }

    // one room: every item belongs to it
    q.scenes[0].items = items;

    /* Every chip that can appear on screen, mapped to what it means. The
       glossary is keyed on single words, so "una entrada" has no entry in it
       and a tapped chip had nothing to say — and a decoy borrowed from another
       item had nowhere to look at all. The segments are already aligned across
       the two languages, so the meaning is sitting right there; this just
       collects it. */
    q.chipGloss = {};
    for (const it of items) {
      for (const seg of it.segments) {
        const k = String(seg.target).toLowerCase().trim();
        if (k && !q.chipGloss[k]) q.chipGloss[k] = seg.native;
      }
    }

    /* A decoy has to be a plausible wrong answer, not just another word on the
       board. When the turn asks for the SLOT, the other slot words are the
       real competition — a ticket, a water, a t-shirt all fit "¿Me das ___"
       and telling them apart is the point. Frame chips only come in once the
       child is building whole sentences, where word order is what is tested. */
    const key = w => String(w).toLowerCase().replace(/[¿?¡!.,;:]/g, '').trim();
    const slotWords = [...new Set(items.map(it => it.slotTarget).filter(Boolean))];
    // whole utterances with no slot — "Gracias.", "Perdona.", "Tarjeta."
    const solos = [...new Set(items.filter(it => !it.slotTarget).map(it => it.target))];
    const frameChips = [...new Set(
      items.flatMap(it => it.chips).filter(c => !slotWords.includes(c)))];

    for (const it of items) {
      const own = new Set(it.chips.map(key));
      /* Decoys in the SAME form as the answer. Offering "esta cerveza" against
         "una cerveza" would be testing a distinction nothing has taught. */
      const form = (it.segments.find(s => s.slot) || {}).target;
      const sameShape = w => !form || w.split(' ').length === form.split(' ').length;
      const near = slotWords.filter(w => !own.has(key(w)) && sameShape(w));
      let far    = frameChips.filter(c => !own.has(key(c)));
      /* Kept apart, because they are not interchangeable. When the turn asks
         for the SLOT, the competition is other slot words — offering the whole
         of "Perdona." against "¿Tienes ___?" is not a distractor, it is a
         category error, and it turned up because a sentence already produced
         counts as a word the child has met. Frame chips are for the rungs
         where whole sentences are being ordered. */
      it.slotDecoys  = near;
      it.frameDecoys = far;
      /* A phrase said whole competes with other phrases said whole. Nouns
         against "Perdona." are no more a choice than sentences against a noun
         slot, and the fragments in `far` ("¿Tienes", "por favor?") are worse
         than either. */
      if (!it.slotTarget) {
        it.slotDecoys = solos.filter(w => !own.has(key(w)));
        far = [...it.slotDecoys, ...far];
      }
      it.distractors = [...near, ...far];
      if (it.acceptAny) for (const alt of it.acceptAny) if (!own.has(key(alt))) {
        it.distractors.unshift(alt);
        it.slotDecoys = [alt, ...it.slotDecoys];
      }
    }
    return q;
  }

  return expand(quest);
})();
