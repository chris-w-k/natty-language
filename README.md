# Natty Language — "Axel goes to a gig"

A webview prototype of mastery-gated language drilling. Four scenes, seven
phrases, one coach. The story only moves on when the phrase does.

Native language English, target Spanish. Swap `nativeLang` / `targetLang` in
`public/content.js` and translate the `native` / `coachLine` fields to run it
the other way round.

## Run it

```
node server.js            # http://localhost:3000
```

With no `GEMINI_API_KEY` set it starts in MOCK mode and uses the local
deterministic matcher, its own templates and the browser's speech synthesis.
That is a complete, playable build — but nothing is being decided by a model.

To use Gemini:

```
cp .env.example .env      # then fill in GEMINI_API_KEY, unset MOCK
node server.js
```

The key is read server-side only. The browser never sees it.

## Deploy

Point Render at the repo (`render.yaml` is included) and set `GEMINI_API_KEY`
and `ACCESS_CODE` in the dashboard under Environment. Never commit `.env`.

Build command: none. Start command: `node server.js`. There are no dependencies
and no lockfile, so Render's `yarn` / `yarn start` defaults are wrong —
`render.yaml` has the right ones if you create the service as a Blueprint.

## Access code

`ACCESS_CODE` gates `/api/evaluate`, `/api/turn` and `/api/tts`. The page asks
for it once and `/api/unlock` returns an HMAC token in an **HttpOnly cookie**,
as jailbreak-camera does, so no page script ever holds it. Leave `ACCESS_CODE`
empty and the gate does not appear.

`/api/health` reports `{ok, mock, locked, unlocked, model, tts}`. If `mock` is
true the key did not land; if `locked` is true and `unlocked` is false the code
has not been entered, and every model call would 401 into the fallbacks.

## What's where

```
server.js              proxy, access code, rate limits, MOCK — forked from jailbreak-camera
public/content.js      the quest: scenes, phrases, chips, distractors, glosses
public/engine.js       the deterministic learner model. Owns every number.
public/ui.js           screens, chips, mic, coach widget. Owns no numbers.
public/voice.js        Gemini TTS first, browser synthesis as fallback
public/anim/           Lottie clips, <character>-idle.json and -talk.json
public/vendor/         lottie_light.min.js, vendored so there is no CDN call
public/app.css         all visual values as tokens on :root
```

## Where Gemini is, and where it isn't

Two calls per turn, the same split as the Turkish trainer this is modelled on:

- **`/api/turn` — the generator.** Writes the scene line and the coach's ask
  fresh each turn, in character, at the support level the engine chose. This is
  what stops the game reading like a template. It is handed the target phrase
  and the allowed word list; it does not pick either.
- **`/api/evaluate` — the evaluator.** Judges one answer and returns flags.

Plus `/api/tts` for the voices. **All three are server-only**: with no key, or
opened as a static page, the prototype falls back to its templates, its local
matcher and the browser's speech synthesis. The test-mode strip at the bottom
of the progress sheet says which is live, every turn.

## The rule that matters

**The model never returns a score.** It returns flags — did they produce the
target, was it understandable, what kind of error. Every mastery number is
computed in `engine.js` from those flags. That is what makes a session
replayable and a bug findable.

## Scoring

| event | delta |
|---|---|
| said the whole phrase aloud, no help | +0.35 |
| filled the gaps, no help | +0.30 |
| correct after the coach modelled it | +0.20 |
| heard in a character's line | +0.05 |
| wrong | 0 — and no turn spent |
| not seen for a week | −0.05 (inert: no persistence in this build) |

Mastered at 0.85, "can use" badge at 0.75. Three clean productions master a
phrase, which is what makes the ladder below visible rather than a two-step
jump from "one word" to "whole sentence".

## Gating

A scene opens when every phrase in it is at or above the bar. Two escapes so
nobody gets stranded:

- **Mercy** — four failed attempts on one phrase and Axel says it for you.
- **Scene clock** — a scene also has a turn ceiling, so slow is not the same
  as wrong.

Either way the phrase is marked *owed* and comes back in the final scene.

Simulated players, all of whom reach the final scene: perfect finishes in 21 of
24 turns at 100%; one miss per phrase ends at 79%; getting nothing right at all
still sees all four scenes and the ending.

## The two ledgers

Mastery modelling v2 §1 keeps two independent scores, and they move at very
different speeds. The **pattern** — the phrase as a construction — creeps up
(+0.20 produced). The **words** in it jump (+0.25 each, produced). Hearing the
tutor say a phrase credits words only, +0.05: seeing a word never proves the
learner can use it.

The two are aggregated **differently depending on the question**, and
conflating them is what made the ramp too steep:

- **The support level takes the MINIMUM** across the pattern and every target
  word, and an unseen word counts as 0 (§6). One word the child has not met
  keeps the whole turn at L0. This is the rule that stops a phrase reaching
  "whole sentence in Spanish" while it still contains unknown vocabulary.
- **Everything else takes the 50/50 MEAN** (§2): the bar, "can use", which
  phrase to practise next, and the percentage on screen. Steady work still
  reads as progress.

Hints damp both, patterns harder than words (§4): one hint ×0.6 / ×0.75, two
or more ×0.3 / ×0.5. Wrong answers cost nothing and spend no turn — a
deliberate departure, since the cost of being stuck here is the scene clock.

Decoy chips are drawn only from words the learner has already produced or
heard (§8, §10). Early trays are short, which is correct: a decoy you have
never been taught is not a choice, it is a trick.

## Scaffold

One number, two visible effects. The phrase's own mastery sets the support
level, which controls how much Spanish the coach shows AND how many decoy
chips are in the tray.

Progressive cloze: one more word is dropped at each rung until the learner is
producing the whole sentence. For a four-word phrase:

| mastery | the slot shows | coach shows | decoys |
|---|---|---|---|
| < 20% | `I am going to a ___` | the missing word | 1 |
| < 40% | `Voy a un ___` | the whole phrase | 2 |
| < 60% | `Voy a ___ ___` | phrase with a gap | 2 |
| < 80% | `Voy ___ ___ ___` | nothing | 3 |
| ≥ 80% | `___ ___ ___ ___` | nothing | 4 |

Short phrases collapse rungs rather than repeating them — a two-word phrase
goes 1, 1, 2, 2, 2.

The slot always shows exactly what is missing, so what is being asked for is
never a guess. And the **ask** — what you are trying to communicate, in the
native language — is on screen at every level. Only the Spanish model is
withdrawn as the learner climbs.

## Tapping for meaning

Every Spanish word on screen — the character's line, the coach's model — is a
button. Tapping it shows its gloss and says it aloud. Glosses live in the
`glossary` map in `content.js`; a word with no entry still speaks.

## Getting in

The character speaks first and Axel answers: the stage box is whoever is on
screen, the coach box sits at the bottom right above the answer area, and it
stays hidden until the character has finished. Showing both at once let a
child read the hint before they had heard the question.

A title screen holds the first turn until START is pressed. That press is also
the audio gesture iOS requires, so the first turn is never silent, and the
Lottie rigs and the opening scene's voice clips load behind the title rather
than leaving an empty room and a blank stage after the tap.

Between turns the generator is a network round trip, so the panel locks and
says what it is waiting for instead of leaving the previous turn live
underneath. Each scene's words are prefetched as it begins — that scene's
vocabulary only, since every clip is a Gemini call.

## Latency

Three things were making a child watch a loading strip for 15-40 seconds a
turn, and the first was doing almost all of it.

**Thinking was on.** `gemini-2.5-flash` reasons before answering by default,
and both calls here are short structured JSON — a line of dialogue, a handful
of flags. Nothing in either needs it. `askJSON` now switches it off. The field
has been spelled two ways across API versions, so the first 400 that mentions
it moves to the next spelling and retries: a wrong guess costs one request at
boot rather than breaking every turn. `THINKING_BUDGET` overrides the value.

**The turn generator retried.** Three attempts on a 20s timeout is up to a
minute of a child staring at a spinner — for a line that has a hand-written
equivalent sitting in `content.js`. It gets one attempt on an 8s fuse.

**Nothing bounded the wait client-side.** `/api/turn` now has a 4.5s deadline,
after which the turn renders from the template. Past that point the model has
nothing to offer that is worth a spinner.

The test strip reports which happened and how long it took — `generator:
gemini 840ms`, or `generator: template (timed out, 4501ms)`. If it says
template every turn, read the reason: `timed out` is latency, `unglossable
word` or `too many new words` is the whitelist, `wrong language` is §6.

Scene prefetching is staggered rather than fired as one burst, so a scene's
worth of TTS calls does not compete with the lines the child is waiting on.

What is left is the free Render instance: it sleeps after ~15 minutes idle and
takes ~30s to wake, which is most of the wait on the very first turn of a
session and nothing to do with any of the above.

## What the characters may say

The generator writes two lines a turn and both are checked before they reach
the screen, because a model drifts and a child cannot tell a hallucinated word
from a real one.

`scene_line` — what the on-screen character says — is held to three rules:

- **Length by support level** (4, 6, 8, 12, 16 words for L0–L4). A fluent
  sentence is unreadable to a child three words into the language however
  correct it is; at a high support level the character speaks in bursts and
  the coach carries the meaning.
- **Nothing unglossable.** Every word must be in the glossary or in the
  quest's own vocabulary. A word outside that is one the child can tap and get
  nothing back.
- **At most two new drill words** (§10). Drill words are the ones they are
  tested on. Glossary-only words — sí, qué, hola — are scene glue (§8), always
  tappable, never tested, and do not count against the cap.

`coach_ask` must be in the child's own language at L0–L3 (§6). A line that
fails any of these is thrown away and the hand-written opening in
`content.js` is used instead, so a bad generation degrades to a good script
rather than to nonsense.

**The glossary is the leash.** It is the whole list of words the model is
allowed to reach for. If the characters feel too terse, widen it — that is
the dial, not the prompt.

The generator also receives the conversation so far (what was said, what the
child was asked for, whether they managed it), so a line continues the scene
instead of restarting it.

## Input lock

While a character is delivering the opening of a turn the lower panel is dead
and visibly greyed: no chips, no CLR, no SAY IT, no mic, no word glosses. It
releases when the queue drains, or after a 12s ceiling so a voice that never
arrives cannot strand the child. Answering before you have heard the question
is not a shortcut worth having, and tapping mid-line used to start a second
voice over the first.

## Voice

Server TTS is the priority path and the browser is only the fallback. Three
moments, all in `voice.js`:

1. the scene line, the ask and the model when a turn appears
2. each word as it is tapped
3. the **whole sentence in the slot** on SAY IT — read back as it stands, in
   whatever languages that is. At L0 the frame is English and only the gap is
   Spanish, so the child hears "I am going to a concierto": their own
   sentence, not a Spanish one they never wrote. Skipped when the answer came
   in by mic.

Server path is Gemini TTS through `/api/tts` — the jailbreak-camera call shape,
unchanged: `responseModalities: ['AUDIO']`, a `prebuiltVoiceConfig`, the line
wrapped in quotes behind a delivery instruction, the returned PCM given a WAV
header at the rate its own mime type declares. Fallback is the browser's own
speech synthesis, so the prototype is never silent with no key. Every utterance
races a timeout — a device with no installed voices never fires `onend`, and
nothing is allowed to wait on a voice forever.

Two properties make it feel like speech rather than a queue:

- **Fetched in parallel, played in order.** Gemini takes a second or two a
  line. Fetching inside the queue left audible holes between the character and
  Axel, so `say()` starts the download the moment a line is queued and the
  queue only orders playback. Clips are cached, so a repeated phrase is
  instant.
- **A tap is heard now.** `V.now()` drops whatever is queued and speaks
  immediately — chip taps, word glosses, SAY IT and the coach sheet all use it.
  A child who has stopped listening never waits out a sentence.

Voices per speaker are env vars: `VOICE_AXEL`, `VOICE_BOUNCER`,
`VOICE_BARTENDER`, `VOICE_LEARNER`; delivery is `STYLE_*`. Axel defaults to
**Zubenelgenubi**, the voice jailbreak-camera gives its teenage punk, so he
already sounds like the character. A wrong voice name just falls back.

`TTS_MODEL` defaults to `gemini-2.5-flash-preview-tts`. If TTS 404s, that is
the value to change; it degrades to browser speech rather than breaking.

## Characters

Lottie, vendored (`public/vendor/lottie_light.min.js`, 5.12.2, SVG renderer —
the clips use no expressions, text, effects or mattes, so the light build is
enough and it is not a CDN dependency).

`public/anim/<character>-{idle,talk}.json`. Both clips for a character load
once into one rig and stay loaded; speaking swaps which is visible rather than
reloading, so a character can start and stop talking mid-turn with no flash.
The clips are 1920×1080 with the figure centred and the slot is portrait, so
they render `xMidYMax slice`: anchored to the bottom, empty sides cropped, feet
on the stage floor.

`VOICE.onSpeaking(speaker, on)` drives the mouth, so it works on the server
voice and the browser fallback alike, and it holds for exactly as long as the
line plays. Only the character actually on screen reacts — Axel coaching from
his bubble does not move the bouncer, and the learner echo moves nobody. No
viseme matching: it is a talking loop, not lip sync.

Characters with no entry in `ANIM` fall back to the dashed placeholder box —
that is how the bartender still renders. States are still named
`idle | speak | intro | outro | pose`, the five slots Directus stores on
`ai_tutor_characters`; only `idle` and `speak` have art, and the rest resolve
to `idle`.

Axel's static avatar in the coach circle is `public/img/axel-avatar.png`. It is
61×59, so it is soft on a retina screen — worth a 2× export before this is
shown to anyone.

## Reskin later

Three stacked layers that never move: `#layer-bg`, `#layer-char`, `#layer-ui`.
`mountBackground()` in `ui.js` is still a stub — drop real images in and
nothing relayouts.

Every colour, radius and shadow is a token on `:root` in `app.css`.
