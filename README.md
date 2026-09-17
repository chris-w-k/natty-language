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

## Voice

Server TTS is the priority path and the browser is only the fallback. Three
moments, all in `voice.js`:

1. the scene line, the ask and the model when a turn appears
2. each word as it is tapped
3. the **whole target sentence** on SAY IT — not just the words they filled
   in, so even a one-word rung ends with the finished thing. Skipped when the
   answer came in by mic.

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
