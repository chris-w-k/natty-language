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

  /* ---------- languages ----------
     NJA-3145 writes every pattern and every vocab item with a slot per
     language: en, es, pt, tr, pl, ro. Which two are in play is a SESSION
     input (NJA-3204: startSession takes nativeLanguage and targetLanguage),
     not a constant — the same content teaches English to a Spanish speaker
     and Spanish to an English one.

     The four with no words yet are listed here anyway, because the picker
     shows what the content could support and greys out what it does not:
     filling them in is a content edit and nothing else. */
  const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'pt', name: 'Português' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'pl', name: 'Polski' },
    { code: 'ro', name: 'Română' },
  ];

  const slotTags = ['ticket', 'item', 'like'];

  /* NJA-3152's five forms, per language. `bare` is the spelling the schema
     ticket uses — NJA-3204's fixtures write `base` for the same field, and
     the schema wins.

     The plural pair is required by the schema and authored per item, not
     derived: a mass noun has no plural, so `water` and `beer` carry the mass
     form in the plural slots. That is what a content editor fills in, and it
     is why these are strings rather than something the code works out. */
  const vocabItems = {
    ticket:   { tags: ['ticket', 'item', 'like'],
                en: { bare: 'ticket',   definite: 'the ticket',   indefinite: 'a ticket',
                      plural_bare: 'tickets',   plural_definite: 'the tickets' },
                es: { bare: 'entrada',  definite: 'la entrada',   indefinite: 'una entrada',
                      plural_bare: 'entradas',  plural_definite: 'las entradas' } },
    water:    { tags: ['item', 'like'],
                en: { bare: 'water',    definite: 'water',        indefinite: 'water',
                      plural_bare: 'water',     plural_definite: 'the water' },
                es: { bare: 'agua',     definite: 'el agua',      indefinite: 'agua',
                      plural_bare: 'agua',      plural_definite: 'el agua' } },
    soda:     { tags: ['item', 'like'],
                en: { bare: 'soda',     definite: 'the soda',     indefinite: 'a soda',
                      plural_bare: 'sodas',     plural_definite: 'the sodas' },
                es: { bare: 'refresco', definite: 'el refresco',  indefinite: 'un refresco',
                      plural_bare: 'refrescos', plural_definite: 'los refrescos' } },
    beer:     { tags: ['item', 'like'],
                en: { bare: 'beer',     definite: 'the beer',     indefinite: 'a beer',
                      plural_bare: 'beer',      plural_definite: 'the beer' },
                es: { bare: 'cerveza',  definite: 'la cerveza',   indefinite: 'una cerveza',
                      plural_bare: 'cerveza',   plural_definite: 'la cerveza' } },
    sandwich: { tags: ['item', 'like'],
                en: { bare: 'sandwich', definite: 'the sandwich', indefinite: 'a sandwich',
                      plural_bare: 'sandwiches', plural_definite: 'the sandwiches' },
                es: { bare: 'bocadillo', definite: 'el bocadillo', indefinite: 'un bocadillo',
                      plural_bare: 'bocadillos', plural_definite: 'los bocadillos' } },
    record:   { tags: ['item', 'like'],
                en: { bare: 'record',   definite: 'the record',   indefinite: 'a record',
                      plural_bare: 'records',   plural_definite: 'the records' },
                es: { bare: 'disco',    definite: 'el disco',     indefinite: 'un disco',
                      plural_bare: 'discos',    plural_definite: 'los discos' } },
    tshirt:   { tags: ['item', 'like'],
                en: { bare: 't-shirt',  definite: 'the t-shirt',  indefinite: 'a t-shirt',
                      plural_bare: 't-shirts',  plural_definite: 'the t-shirts' },
                es: { bare: 'camiseta', definite: 'la camiseta',  indefinite: 'una camiseta',
                      plural_bare: 'camisetas', plural_definite: 'las camisetas' } },
    /* A band is not something you can be handed across a counter, so it
       carries `like` only and the engine will never pair it with "Can I have
       ___". That tag check is the whole point of NJA-3152's slot_tags: adding
       a noun is a tag, not an edit to seven patterns. */
    band:     { tags: ['like'],
                en: { bare: 'band',     definite: 'the band',     indefinite: 'a band',
                      plural_bare: 'bands',     plural_definite: 'the bands' },
                es: { bare: 'grupo',    definite: 'el grupo',     indefinite: 'un grupo',
                      plural_bare: 'grupos',    plural_definite: 'los grupos' } },
    singer:   { tags: ['like'],
                en: { bare: 'singer',   definite: 'the singer',   indefinite: 'a singer',
                      plural_bare: 'singers',   plural_definite: 'the singers' },
                es: { bare: 'cantante', definite: 'el cantante',  indefinite: 'un cantante',
                      plural_bare: 'cantantes', plural_definite: 'los cantantes' } },
  };

  const FORMS = ['bare', 'definite', 'indefinite', 'plural_bare', 'plural_definite'];

  /* Slot syntax is NJA-3152's: {tag#number:article}. The number distinguishes
     two slots drawing on the same tag; the article names which form to fill
     it with. A pattern with no slot is said whole.

     `speaker` is ours, and NJA-3152's pattern collection has no field for it —
     which is a gap worth closing there, because without it the conversation
     goes wrong in a way that is hard to trace. The engine tells the character
     which target-language words the child has met so he can use them; a
     construction the CHILD is learning to say to HIM then ends up in his
     mouth, and he opens with "Alright, perdona, what can I do for ya?" —
     saying the customer's own line back at them. "Excuse me", "Can I have"
     and "Thank you" belong to the person at the counter, not behind it.

       learner  only the child says this; the character must never say it back
       actor    only the character says it, so the child is never DRILLED on
                it. "There is no sandwich" is the person behind the counter
                telling you they are out; a child declining an offer with it
                is being taught to say the wrong thing. These are dropped from
                the pairs below rather than merely discouraged, because a
                pattern the engine can select is a pattern the coach will
                eventually tell the child to say.
       either   natural from either side

     A shared item word ("entrada") is never restricted by this — only the
     frame, which is what carries the pragmatic role. */
  const vocabPatterns = {
    'excuse-me':    { speaker: 'learner', en: 'Excuse me.',       es: 'Perdona.',                  opensOnly: true },
    /* The form differs between the languages, and that is the point of
       NJA-3145's grammar context rather than an oversight: English wants the
       article here and Spanish drops it — "¿Tienes entrada?" is what someone
       on the door actually says. Each word is rendered in ITS OWN language's
       form, so the English noun keeps its article when it crosses into the
       Spanish frame and the Spanish one does not pick up a stray "una". */
    'do-you-have':  { speaker: 'either',  en: 'Do you have {item:indefinite}?',        es: '¿Tienes {item:bare}?' },
    'can-i-have':   { speaker: 'learner', en: 'Can I have {item:indefinite}, please?', es: '¿Me das {item:indefinite}, por favor?' },
    'i-have':       { speaker: 'either',  en: 'I have {item:indefinite}.',            es: 'Tengo {item:indefinite}.' },
    'i-dont-have':  { speaker: 'either',  en: "I don't have {item:bare}.",            es: 'No tengo {item:bare}.' },
    /* What you say to turn down what you have just been offered. The set had
       no way to decline at all, so the only near-miss the engine could reach
       for was the barman's own "there is no ___". */
    'i-dont-want':  { speaker: 'learner', en: "I don't want {item:indefinite}.",       es: 'No quiero {item:indefinite}.' },
    'there-is-no':  { speaker: 'actor',   en: 'There is no {item:bare}.',             es: 'No hay {item:bare}.' },
    'do-you-like':  { speaker: 'either',  en: 'Do you like {like:definite}?',     es: '¿Te gusta {like:definite}?' },
    'i-like':       { speaker: 'either',  en: 'I like {like:definite}.',          es: 'Me gusta {like:definite}.' },
    /* Two slots. NJA-3160's third unit test is a pattern of exactly this
       shape, and the engine used to refuse them outright — one slot per
       pattern, or it threw. The #1 / #2 numbering is what keeps the two
       apart; both draw on the same tag. */
    'i-like-two':   { speaker: 'either',
                      en: 'I like {like#1:definite} and {like#2:definite}.',
                      es: 'Me gustan {like#1:definite} y {like#2:definite}.' },
    'thank-you':    { speaker: 'learner', en: 'Thank you.',       es: 'Gracias.' },
  };

  /* One activity, standing in for a row of quest_activities_nlt_prototype.
     `order` is what Directus list order gives the real build, and the engine
     uses it exactly as NJA-3136 says: first in list when mastery ties. */
  const activity = {
    id: 'dev_nlt_activity_gig',
    title: 'Axel goes to a gig',
    background: 'venue-bar',
    /* accent: 'target' / 'native' rather than a language code, because the
       pair is chosen per session. The person behind the counter speaks the
       language you are here to learn; your pal speaks yours. Reverse the pair
       and the two accents swap with it. */
    actor: { id: 'bartender', name: 'Bartender', speaks: 'target', accent: 'target' },
    /* NJA-3153 adds `prompt` to nlt_coach: "describes the personality of the
       coach, and role (i.e. to provide hints to the user of what to say in
       response to the actor's questions)". */
    coach: {
      id: 'axel', name: 'Coach',
      /* accent: the voice this character always speaks with, whichever language
         the line happens to be in. Without it Axel drifts into a Spanish
         accent the moment his line carries a Spanish word. */
      accent: 'native',
      prompt: 'You are Axel — a cheeky rockstar, and the child\'s own pal. You have played a hundred gigs and you are showing them the ropes. You talk with attitude: quick, a bit cocky, never impressed by much, and funny about the world rather than about them. You are always on their side, you never talk down to them, and you are the only one here who explains anything.',
    },
    /* NJA-3153's nlt_scenario.prompt: "describes scenario and actor to agent". */
    prompt: 'You are the one person behind the counter at a music venue — you sell the tickets, the drinks and the merch. A kid has come up to you. You are patient by nature and you have seen it all, but a queue is building and you are easily annoyed when you cannot make out what someone is asking for — you sigh, you lean in, you ask again. You are never annoyed AT the child, only at the hold-up, and you soften the moment they get it right.',
    /* The three screens before the game. Copy lives here rather than in the
       markup so it travels with the scenario — a different night out brings
       its own title, its own pep talk and its own way of getting there. */
    intro: {
      title: 'GOING TO A GIG',
      sub: 'Learn the Spanish to get in, get a drink and tell someone you love the song.',
      coach: "Tonight's gonna be unreal — but the band's Spanish, the bar's Spanish, and the fella on the door doesn't do English. Stick with me. I'll tell you what to say, you just say it.",
      loading: 'Getting a taxi to the club…',
      tap: 'Tap to continue',
    },
    objectives: ['get in', 'get something to drink', 'get some merch', 'talk about the band'],
    patterns: ['excuse-me', 'do-you-have', 'can-i-have', 'i-have', 'i-dont-have',
               'i-dont-want', 'there-is-no', 'do-you-like', 'i-like', 'i-like-two',
               'thank-you'],
    items: ['ticket', 'water', 'soda', 'beer', 'sandwich', 'record', 'tshirt', 'band', 'singer'],
  };

  /* ---------- the rules prompts ----------
     NJA-3150 AC 5.1 and NJA-3154 AC 2.1: a "rules prompt" per speaker, which
     is combined with the scenario prompt above into one prompt, and whose
     {{tags}} are evaluated at runtime. The three the tickets name are
     {{native_language}}, {{target_language}} and {{user_expected_answer}};
     the rest below are the same idea extended to everything else the engine
     has already decided. Every tag is filled by the server from the plan —
     the model is never asked to work one out.

     These sit in content because that is where they end up: the scenario and
     coach prompts are Directus fields already (NJA-3153), and a rules prompt
     that lives in server code cannot be tuned without a deploy. Editing the
     wording here is the whole of changing how either speaker behaves. */
  /* The character's reaction to what the child actually said — the beat the
     storyboard has between the answer and the next question. It is generated,
     because the whole point is that it answers what they said rather than what
     they were supposed to say; a written line cannot do that.

     It is deliberately NOT allowed to be funny at the child's expense. The
     design frame has the bouncer say "Are you already drunk?" to a 7-10 year
     old whose Spanish came out in the wrong order, which is a different thing
     from a bouncer being gruff. */
  const reactRules = `You write ONE very short line for a character in a
language game played by a 7-10 year old. The child has just spoken to you.
Write their reply and nothing else.

{{scenario_prompt}}

You are {{actor_name}}. One sentence, at most two — shorter than your last one.

The child tried to say: {{user_expected_answer}}
What actually came out of their mouth: {{child_said}}
Did they get it right: {{was_correct}}

If they got it right, react to WHAT THEY SAID as a person would — serve them,
answer them, agree, hand it over — and move on. Do not praise their language;
somebody else does that, and a barman who compliments a child's grammar is not
a barman.

If they got it wrong, you did not understand them, and there is a queue. Let the
faint annoyance show — a sigh, a blank look, leaning in, asking them to run that
by you again — but it is the hold-up you are annoyed at, never the child. You
are never unkind and never funny at their expense: no jokes about them being
drunk, slow or foreign. They are a child having a go in a language that is not
theirs, and you soften the moment they get it right.

Never tell them what to say, never name the words, never say the right answer
or any part of it. Somebody else does that too.

Write in {{native_language}}, except for these {{target_language}} words, which
you may use and which the child has met: {{actor_may_use}}
Use no other {{target_language}} word. These are the child's own words to you,
never yours to say back: {{learner_only}}

No stage directions, no emoji. Return JSON only.`;

  const prompts = {
    actorRules: `You write ONE short line of dialogue for a character in a
language game played by a 7-10 year old. You do not decide what is taught, how
much of it is in which language, or what the right answer is. All of that is
given to you. Write the line and nothing else.

{{scenario_prompt}}

You are {{actor_name}}. One or two short sentences.

React to what the child just said AND say the thing that makes their expected
answer the natural reply — both in the one line, the way a person behind a
counter does it. Not "Here's your water." and then, separately, "Do you want a
soda?", but one breath: "Here's your water — anything else, a soda?" The child
is trying to: {{objectives}}. If they have finished everything, close the
conversation warmly instead.

Never repeat something you have already said this conversation. Serving them and
asking the next thing is ONE sentence, not the same sentence twice.

You are NOT a teacher. Never tell the child what to say, never name the words to
use, never say "say X" or "try saying". Somebody else does that; when you do it
too, two voices are giving instructions and neither is worth listening to. You
serve, you answer, you move on.

Never ask a question the child cannot answer with what they know. They have one
short list of words. "Which one would you like?", "what size?", "how many?" each
demand vocabulary they have not got, and the exchange dies there. If you ask
anything, their expected answer must be a complete reply to it.

LANGUAGE — the rule that matters most
Write in {{native_language}}, EXCEPT for these {{target_language}} words, which
the child has already met and which you must use in {{target_language}}, never
translated back: {{actor_may_use}}
You may not use a {{target_language}} word that is not on that list. Not one.
That list is the whole of what this child may hear from you, and reaching past
it teaches vocabulary nobody chose.

WHOSE LINE IS WHOSE
These are the CHILD'S words, said by a customer to you. Never say them back to
them, in either language, not even as filler: {{learner_only}}
You are the one behind the counter. A server who greets a customer with the
customer's own opening line is not having a conversation with them.

Do not say the child's expected answer, or the substance of it, before they
have. Leave them something to say.

{{new_thing}}

The child is expected to reply: {{user_expected_answer}} (meaning:
{{user_expected_answer_native}}). Do not say it for them.

No stage directions, no emoji, no praise, no questions to an adult. Vary your
wording. Return JSON only.`,

    reactRules,
    coachRules: `You are the child's coach in a language game played by a 7-10
year old. You speak only to them, never to the character. Write ONE short line.

{{coach_prompt}}

The setting: {{scenario_prompt}}

{{actor_name}} has just said: "{{actor_line}}"

Your job, in one short sentence in {{native_language}}: make sure they
understood what was just said, and tell them what to say back — without handing
over the whole answer. They are expected to reply: {{user_expected_answer}}
(meaning: {{user_expected_answer_native}}).

{{new_thing}}

Write in {{native_language}}. The only {{target_language}} you may write is a
word or construction you are told you are introducing. Never translate the
character's line word for word; say what they want.

No stage directions, no emoji, no questions to an adult. Vary your wording.
Return JSON only.`,
  };

  /* NJA-3157 / NJA-3158's ui_strings collection. Copy the UI owns rather than
     the model, so it is identical every time and translatable as a unit. */
  const uiStrings = {
    'answer-pane-correct-text':   'Nice Job!',
    'answer-pane-incorrect-text': 'Not quite, try again',
    'pause-menu-skip': 'Skip',
    'pause-menu-exit': 'Exit',
    /* NJA-3168. {0} is the number, and the marker is INSIDE the string on
       purpose: Turkish writes the percent before the figure with no space, so
       any code that appends "%" itself is wrong in Turkish and right nowhere
       it matters. */
    'mastery-display-string': {
      en: 'Mastery: {0}%',
      es: 'Maestría: {0}%',
      pt: 'Mestria: {0}%',
      tr: 'Ustalık: %{0}',
    },
    /* The end of a go. The pass mark is a number the child should be told, so
       the two headline strings carry it: which one shows says whether they
       cleared it, and the difference is the point of NJA-3196 Q2. */
    'end-passed-title': 'You made it.',
    'end-short-title':  "That's the night.",
    'end-passed-sub':   'Cleared the {0}% mark.',
    'end-short-sub':    'Short of the {0}% mark — another go at what is left will get you there.',
    'end-stuck-label':  'Stuck',
    'end-shaky-label':  'Shaky',
    'end-missed-label': 'Not yet',
    'end-replay-some':  'PRACTISE WHAT IS LEFT',
    'end-replay-all':   'PLAY AGAIN',
    /* The coach's line after a wrong answer. Written, not generated: it is the
       same sentence every time by design, it must never be wrong, and it is
       the one beat in the loop where a child is waiting to try again. */
    'coach-retry': "Let's try that again.",
    /* The language picker. The prototype only has these in English because
       the screen is shown before a language is chosen — in the real build it
       follows the device locale. */
    'lang-pick-title':   'Pick your languages',
    'lang-pick-native':  'I SPEAK',
    'lang-pick-target':  "I'M LEARNING",
    'lang-pick-go':      'START',
    'lang-pick-missing': 'No words yet for {0}.',
  };



  const session = {
    /* NJA-3136 ends a session on mastery, not on a clock. The cap is a
       backstop so a child who cannot get one item right still reaches an
       ending — without it, "repeat until they get it right" has no exit. */
    turnCap: 40,
    /* NJA-3196 Q2: "a total session mastery > threshold i.e. 85% - so the
       minimum they will get is always 85%." The go does not end when the list
       runs out; it ends when the score clears this, and short of it the
       weakest step comes round again. The turn cap above is what stops that
       being endless — Q1 ("is there any need to measure that they got it
       wrong more than 5 times?") is still open, and the cap is the placeholder
       until it is answered. */
    passMark: 0.85,
    /* What counts as stuck, and so as carried into a replay rather than
       drilled again. A clean answer: a hinted one is worth another go. */
    keepMark: 1,
    masteryBar: 0.8,       // correct / (correct + incorrect) to count as produced
    minExposures: 2,       // ...but not before this many tries, or 1/1 = mastered
    mercyAfterFailedTurns: 4,
    /* 'walk' (default): each pattern of the syllabus takes the first noun
       nobody has had yet, so every stage has a new word to teach.
       'first': every pattern takes its first valid noun, which is the same
       noun for most of them. */
    stageItems: 'walk',
  };

  /* ---------- expansion ----------
     NJA-3136, Engine step 1: build the pattern x item pairs and validate them
     by slot tag. Step 2: keep them in the order the lists declare. */
  /* ---------- chunking (NJA-3197) ----------
     A pattern is parsed ONCE, into the shape the real session stores:

       nativeFrames: [{type:'text', text:'I like '}, {type:'slot', key:'like#1'},
                      {type:'text', text:' and '},  {type:'slot', key:'like#2'}]

     rather than a template re-scanned with a regex on every render. The slot
     KEY carries its number, so a pattern can mention the same tag twice and
     the two stay distinguishable — which is the whole reason the number is in
     the syntax and the whole reason the old single-slot version could not
     handle "I like X and Y". */
  const SLOT = /\{([a-z_]+)(?:#(\d+))?:([a-z|]+)\}/gi;

  function chunk(template) {
    const out = [];
    let at = 0, m;
    SLOT.lastIndex = 0;
    while ((m = SLOT.exec(template)) !== null) {
      if (m.index > at) out.push({ type: 'text', text: template.slice(at, m.index) });
      out.push({
        type: 'slot',
        key: m[1] + '#' + (m[2] || '1'),
        tag: m[1],
        // "a|b" means either article is acceptable; the first is what we render
        forms: m[3].split('|'),
      });
      at = m.index + m[0].length;
    }
    if (at < template.length) out.push({ type: 'text', text: template.slice(at) });
    return out;
  }

  const slotsOf = frames => frames.filter(f => f.type === 'slot');

  /* Render a chunked pattern, choosing the language of each slot separately
     from the language of the frame. `fill` maps slot key to item id; `inTarget`
     is the set of slot keys whose word has crossed over. */
  /* A slot's FORM is a property of the language, not of the pattern. NJA-3145
     has `i-like-x` as {like:bare} in English and {like:definite} in Spanish,
     and NJA-3204's two-slot fixture does the same — so a Spanish word standing
     in an English frame still takes the Spanish form. Reading the form off
     whichever frame list is being rendered gets this wrong in exactly that
     case ("I like disco" for "I like el disco"), so `forms` is looked up per
     (slot key, language) from that language's own chunked pattern. */
  function render(frames, lang, fill, inTarget, forms) {
    return frames.map(f => {
      if (f.type === 'text') return f.text;
      const id = fill[f.key];
      if (!id) return '___';
      const wordLang = (inTarget && inTarget.has(f.key)) ? lang.target : lang.native;
      return vocabItems[id][wordLang][formOf(forms, f, wordLang)];
    }).join('');
  }
  /* The form this language asks for in this slot, falling back to the form
     written in the frame we are rendering when the other language has nothing
     to say about that slot. */
  function formOf(forms, f, wordLang) {
    const byLang = forms && forms[f.key];
    return (byLang && byLang[wordLang]) || f.forms[0];
  }

  function expand(nativeCode, targetCode) {
    const LANGS = { native: nativeCode, target: targetCode };
    const q = {
      id: activity.id, title: activity.title, activity,
      nativeLang: LANGS.native, targetLang: LANGS.target,
      languages: LANGUAGES, forms: FORMS,
      slotTags, vocabItems, vocabPatterns, session, prompts, uiStrings,
      groups: [], glossary: {}, chipGloss: {},
    };

    /* NJA-3197's patternVocabGroups: the pattern, both chunkings, and which
       items are valid in each of its slots. */
    for (const pid of activity.patterns) {
      const pat = vocabPatterns[pid];
      if (!pat) throw new Error('unknown pattern: ' + pid);
      /* A pattern only the character says is scenery, not curriculum: it is
         defined so the writing can lean on it, but the child is never asked
         to produce it. */
      if (pat.speaker === 'actor') continue;

      if (!pat[LANGS.native] || !pat[LANGS.target]) continue;
      const nativeFrames = chunk(pat[LANGS.native]);
      const targetFrames = chunk(pat[LANGS.target]);
      const nk = slotsOf(nativeFrames).map(s => s.key).join(',');
      const tk = slotsOf(targetFrames).map(s => s.key).join(',');
      if (nk !== tk) {
        throw new Error('pattern slots differ between languages: ' + pid + ' (' + nk + ' vs ' + tk + ')');
      }

      const slots = {};
      for (const sl of slotsOf(nativeFrames)) {
        const usable = activity.items.filter(id => (vocabItems[id].tags || []).includes(sl.tag));
        if (!usable.length) throw new Error('slot has no valid vocab items: ' + pid + ' / ' + sl.key);
        slots[sl.key] = usable;
      }

      /* {slot key: {language: form}} — every language this pattern is written
         in, so a word can be rendered in its own language's form wherever it
         stands. */
      const forms = {};
      for (const code of LANGUAGES.map(l => l.code)) {
        if (!pat[code]) continue;
        for (const sl of slotsOf(chunk(pat[code])))
          (forms[sl.key] = forms[sl.key] || {})[code] = sl.forms[0];
      }

      q.groups.push({
        id: pid, pattern: pat, opensOnly: !!pat.opensOnly,
        nativeFrames, targetFrames, forms, langs: LANGS,
        slotKeys: slotsOf(nativeFrames).map(s => s.key),
        slots,
      });
    }

    q.pairs = q.groups.map(g => makePair(g));

    /* The engine builds its own pairs when it wants a particular word in a
       particular slot — the syllabus walks the vocabulary, so which noun a
       stage gets is its decision, not the content's. */
    q.pairFor = (groupId, fill) => {
      const g = q.groups.find(x => x.id === groupId);
      return g ? makePair(g, Object.assign({}, fill)) : null;
    };

    /* Every word the child can see, and what it means. Built from the content
       rather than hand-written, so a new item is glossed the moment it is
       added — the whitelist and the tap-to-translate modal both read this. */
    for (const [iid, item] of Object.entries(vocabItems)) {
      if (!item[LANGS.target] || !item[LANGS.native]) continue;
      for (const form of FORMS) {
        const t = item[LANGS.target][form], n = item[LANGS.native][form];
        if (!t || !n) continue;
        q.chipGloss[t.toLowerCase()] = n;
        for (const tok of t.split(/\s+/)) q.glossary[bare(tok)] = q.glossary[bare(tok)] || n;
      }
    }
    for (const g of q.groups) {
      const blankT = render(g.targetFrames, LANGS, {}, null, g.forms).trim();
      const blankN = render(g.nativeFrames, LANGS, {}, null, g.forms).trim();
      for (const seg of blankT.split(/\s+/)) {
        const k = bare(seg);
        if (k && k !== '___' && !q.glossary[k]) q.glossary[k] = '(part of "' + blankN + '")';
      }
      q.chipGloss[blankT.toLowerCase()] = blankN;
    }
    return q;
  }

  const bare = w => String(w).toLowerCase().replace(/[¿?¡!.,;:"“”]/g, '').trim();

  /* One playable pair: a group plus one item per slot. `fill` starts as the
     first valid item for each slot; the engine swaps it as the syllabus walks
     the vocabulary.

     The FRAME is the pattern with its slots blanked — the part the child learns
     as a construction — and each slot's ITEM drops into it. They are tracked
     separately because the engine crosses one of them at a time into the target
     language (NJA-3136, Engine step 4), and with two slots that is now three
     things to cross rather than two. */
  function makePair(group, fill) {
    const L = group.langs;
    const use = fill || {};
    /* Distinct by default. Two slots drawing on the same tag both take the
       first valid item unless you stop them, and "I like the ticket and the
       ticket" is not a sentence anyone wanted. */
    const taken = new Set(Object.values(use));
    for (const key of group.slotKeys) {
      if (use[key]) continue;
      use[key] = group.slots[key].find(id => !taken.has(id)) || group.slots[key][0];
      taken.add(use[key]);
    }

    const all = new Set(group.slotKeys);
    const none = new Set();
    const asTarget = keys => new Set(keys);

    return {
      id: group.id + (group.slotKeys.length
        ? '-' + group.slotKeys.map(k => use[k]).join('-') : ''),
      patternId: group.id,
      group,
      fill: use,
      slotKeys: group.slotKeys,
      // kept for everything that still thinks in terms of one word
      itemId: group.slotKeys.length ? use[group.slotKeys[0]] : null,
      opensOnly: group.opensOnly,
      hasSlot: group.slotKeys.length > 0,
      slotCount: group.slotKeys.length,

      // the frame with every slot blanked, for showing the construction alone
      frame: {
        native: render(group.nativeFrames, L, {}, null, group.forms),
        target: render(group.targetFrames, L, {}, null, group.forms),
      },
      /* What sits in each slot, in both languages — each in ITS OWN
         language's form, which is the whole of NJA-3145's grammar context. */
      items: group.slotKeys.map(key => ({
        key, id: use[key],
        native: vocabItems[use[key]][L.native][slotForm(group, key, L.native)],
        target: vocabItems[use[key]][L.target][slotForm(group, key, L.target)],
      })),
      get item() { return this.items[0] || null; },

      allNative: render(group.nativeFrames, L, use, none, group.forms),
      allTarget: render(group.targetFrames, L, use, all, group.forms),
      /* Any mix: the frame in one language, a named set of slots in the other.
         This is what replaces the old four fixed renderings — with two slots
         there are six combinations, not four, and with three there are
         sixteen, so they are computed rather than enumerated. */
      say(frameTarget, targetSlots) {
        const frames = frameTarget ? group.targetFrames : group.nativeFrames;
        return render(frames, L, use, asTarget(targetSlots || []), group.forms);
      },
    };
  }

  function slotForm(group, key, lang) {
    const byLang = group.forms && group.forms[key];
    if (byLang && byLang[lang]) return byLang[lang];
    const sl = slotsOf(group.nativeFrames).find(s => s.key === key);
    return sl ? sl.forms[0] : 'bare';
  }

  /* ---------- which pairs this content can actually teach ----------
     A language is usable when every pattern this scenario draws on, and every
     vocab item it uses, is written in it. NJA-3204 wants the unusable case to
     fail loudly rather than quietly produce half a session, so the picker
     greys them out and build() refuses them with the ticket's own message. */
  function covered() {
    return LANGUAGES.filter(l =>
      activity.patterns.every(pid => {
        const pat = vocabPatterns[pid];
        return pat && (pat.speaker === 'actor' || !!pat[l.code]);
      }) &&
      activity.items.every(id => {
        const it = vocabItems[id];
        return it && it[l.code] && FORMS.every(f => !!it[l.code][f]);
      })
    ).map(l => l.code);
  }

  const CONTENT = {
    languages: LANGUAGES,
    covered: covered(),
    name: code => (LANGUAGES.find(l => l.code === code) || {}).name || code,
    /* NJA-3204: the pair is an input, and a pair this content does not hold
       is an error with the languages it DOES hold named in it. */
    build(nativeCode, targetCode) {
      const have = CONTENT.covered;
      if (nativeCode === targetCode)
        throw new Error('Native and target language must differ');
      for (const code of [nativeCode, targetCode])
        if (!have.includes(code))
          throw new Error('This scenario only supports ' +
            have.map(CONTENT.name).join(' and '));
      return expand(nativeCode, targetCode);
    },
  };

  window.CONTENT = CONTENT;
  /* The default pair, so anything that reads window.QUEST at load still has
     one. The session replaces it the moment a pair is chosen. */
  return CONTENT.build(CONTENT.covered[0] || 'en', CONTENT.covered[1] || 'es');
})();
