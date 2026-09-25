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
    'do-you-have':  { speaker: 'either',  en: 'Do you have {item:indefinite}?',        es: '¿Tienes {item:indefinite}?' },
    'can-i-have':   { speaker: 'learner', en: 'Can I have {item:indefinite}, please?', es: '¿Me das {item:indefinite}, por favor?' },
    'i-have':       { speaker: 'either',  en: 'I have {item:indefinite}.',            es: 'Tengo {item:indefinite}.' },
    'i-dont-have':  { speaker: 'either',  en: "I don't have {item:bare}.",            es: 'No tengo {item:bare}.' },
    /* What you say to turn down what you have just been offered. The set had
       no way to decline at all, so the only near-miss the engine could reach
       for was the barman's own "there is no ___". */
    'i-dont-want':  { speaker: 'learner', en: "I don't want {item:indefinite}.",       es: 'No quiero {item:indefinite}.' },
    'there-is-no':  { speaker: 'actor',   en: 'There is no {item:bare}.',             es: 'No hay {item:bare}.' },
    'do-you-like':  { speaker: 'either',  en: 'Do you like {likeable:definite}?',     es: '¿Te gusta {likeable:definite}?' },
    'i-like':       { speaker: 'either',  en: 'I like {likeable:definite}.',          es: 'Me gusta {likeable:definite}.' },
    'thank-you':    { speaker: 'learner', en: 'Thank you.',       es: 'Gracias.' },
  };

  /* One activity, standing in for a row of quest_activities_nlt_prototype.
     `order` is what Directus list order gives the real build, and the engine
     uses it exactly as NJA-3136 says: first in list when mastery ties. */
  const activity = {
    id: 'dev_nlt_activity_gig',
    title: 'Axel goes to a gig',
    background: 'venue-bar',
    actor: { id: 'bartender', name: 'Bartender', speaks: 'target', accent: 'es' },
    /* NJA-3153 adds `prompt` to nlt_coach: "describes the personality of the
       coach, and role (i.e. to provide hints to the user of what to say in
       response to the actor's questions)". */
    coach: {
      id: 'axel', name: 'Coach',
      /* accent: the voice this character always speaks with, whichever language
         the line happens to be in. Without it Axel drifts into a Spanish
         accent the moment his line carries a Spanish word. */
      accent: 'en',
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
               'i-dont-want', 'there-is-no', 'do-you-like', 'i-like', 'thank-you'],
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
    'answer-pane-incorrect-text': 'Not quite!',
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
    /* The coach's line after a wrong answer. Written, not generated: it is the
       same sentence every time by design, it must never be wrong, and it is
       the one beat in the loop where a child is waiting to try again. */
    'coach-retry': "Let's try that again.",
  };



  const session = {
    /* NJA-3136 ends a session on mastery, not on a clock. The cap is a
       backstop so a child who cannot get one item right still reaches an
       ending — without it, "repeat until they get it right" has no exit. */
    turnCap: 40,
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
      slotTags, vocabItems, vocabPatterns, session, prompts, uiStrings,
      glossary: {}, chipGloss: {},
    };

    const pairs = [];
    for (const pid of activity.patterns) {
      const pat = vocabPatterns[pid];
      if (!pat) throw new Error('unknown pattern: ' + pid);
      /* A pattern only the character says is scenery, not curriculum: it is
         defined so the writing can lean on it, but the child is never asked
         to produce it. */
      if (pat.speaker === 'actor') continue;
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
