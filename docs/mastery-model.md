# Learner mastery modelling — Max's Turkish trainer

Verbatim from `mastery-modelling_v2.pdf`, posted by Max Azarov in
**#novapals-squad** on 16 Sep 2026, in the thread on his pivot proposal. It is
a Lovable-generated summary of his own prototype at
`neuro-language-trainer.lovable.app`. His note with it: *"IMHO, it's probably
slightly over-engineered. I think it's enough to start with a slightly
stripped down version."*

This is the specification `public/mastery.js` is built to. Where the code and
this document disagree, this document is right and the code is a bug.

**Where we knowingly differ.** Four places, and each one is a consequence of
our input method rather than a disagreement with his model.

1. **Turn order.** Arm B now runs HIS order — tutor → user → character. The
   note here used to say ours stayed actor → coach → child; that changed when
   Chris asked for his.
2. **The gain rates in §4.** His §5 is a free-text scanner, so one typed
   sentence can credit four or five words at once. Ours is a tray of pills
   and a turn credits one. Paying his per-word rate for a fifth of his
   production made a 24-word scenario take nineteen evenings for a pre-A1
   learner. So the rates are scaled to what a turn actually asks for:

   | | spec | ours |
   |---|---|---|
   | valid answer, pattern | 0.10 | 0.14 |
   | per produced word | 0.25 | 0.34 |
   | word read only | 0.05 | 0.06 |
   | one-shot test | 0.25 | 0.34 |

   The bar, the damping ratios, the penalties, the typo exemption, the free
   retries and the spacing ladder are all unchanged. The numbers were swept
   against the engine with a pre-A1 error model until a learner finished in
   the eight sittings Chris asked for; they are not a guess.
3. **Phases.** Four of his nine are not implemented — warm, contrast,
   transfer and adaptive — so three of his five gain rates are unreachable.
4. **The scenario's vocabulary.** The café teaches 24 of the pack's words
   rather than all 39 reachable ones. The rest are kept for the scenario
   after it. His list is intact; it is not all taught at once.

His §10 prompt shapes are his; our actor lines are rendered from patterns
rather than generated, which already satisfies most of what his tutor prompt
is written to enforce.

---

## 1. What is modelled

The learner state is a deterministic, per-user record kept on the client and
persisted to the backend. It holds two independent item types, each with its
own mastery score in the 0–1 range:

| Item | Fields tracked | Purpose |
|---|---|---|
| Pattern (grammar construction, e.g. `Bir X lütfen`) | mastery, introduced, exposures, lastSeenTurn, retrievalStreak, dueTurn / dueSession, oneShotCandidate / oneShotSuccess | Drives which construction is practised, spaced retrieval, and one-shot testing. |
| Vocabulary word | mastery, exposures | Drives which words are introduced, recycled and consolidated. |
| Session-level | turn, sessionIndex, errors (last 20), sessionAcquired, sessionNewVocab, hintsUsedThisTurn | Feeds objective choice, error mining, and the session summary. |

Scores are stored rounded to 4 decimals, because repeated +0.15 / +0.05
additions otherwise land on 0.8499999999999999 and silently miss the 0.85 gate
that the UI already displays as 85%.

## 2. The mastery bar

- `MASTERY_BAR = 0.85` with a 1e-6 float tolerance is the single gate for
  "this item is done".
- An item at or above the bar stops being targeted: mastered patterns have
  their weakness weight cut to 25%, and words at or above the bar are never
  selected as targets.
- A scenario at a level counts as mastered when every pattern is introduced
  and above the bar, no word is unseen, and no word is below the bar (minimum
  two patterns introduced).
- Level mastery % shown in the UI = mean pattern mastery and mean word
  mastery, weighted 50/50.
- Softer display thresholds: 0.75 flips a label from "practicing" to "can use"
  and adds the item to the session's acquired list.

The term **weakness** has two meanings. Used as a yes/no check ("any weak
pattern?"), it means "not yet at the bar" — mastery < 0.85. Used as a weight
inside the objective-priority formula, weakness is the distance to the bar:
`1 − mastery` while below 0.85, damped to `(1 − mastery) × 0.25` once
mastered, so mastered patterns rarely win attention again. The goal is the
bar, not perfection.

## 3. How mastery changes

All changes are applied by pure functions over an immutable clone of the
state, so every turn is replayable and diffable. Credit follows one rule above
all: **mastery is earned only for what the learner actually produced, and only
for the items the turn targeted.**

| Event | Pattern | Target words | Notes |
|---|---|---|---|
| Valid answer using the target pattern | +0.10 base; +0.15 warm retrieval / contrast; +0.20 transfer test; +0.25 one-shot test | +0.25 per produced target word | Advances the turn, increments the retrieval streak, schedules the next retrieval. |
| Valid answer, target pattern not used | no change | no change | Words may still gain exchange credit (below). |
| Invalid / wrong answer (first failure of the turn) | −0.10, or −0.15 if two hints were used | same drop mirrored onto the turn's target words | Typos are exempt (drop 0). Streak reset, item due again in 3 turns. Retries in the same turn are penalty-free. |
| Hint button pressed twice on one turn | −0.15 | −0.15 | Charged when the second hint is shown, not when the answer arrives. |
| Tutor's Turkish in a practice prompt | — | +0.05 per word (passive exposure) | Reading is credited far below production. |
| Words used in a non-advancing exchange | — | +0.20 × hint damping | Covers valid-but-unexpected answers so the words still count. |
| Tutor reaction / correction text | — | exposure only, no mastery | Seeing a word never proves the learner can use it. |

## 4. Hint damping

Hints reveal the construction more than the words, so patterns are damped
harder than vocabulary:

| Hints used this turn | Pattern multiplier | Vocabulary multiplier |
|---|---|---|
| 0 | ×1.0 | ×1.0 |
| 1 | ×0.6 | ×0.75 |
| 2 or more | ×0.3 | ×0.5 |

Two retries per turn are penalty-free; the trainer moves on after the third.

## 5. Word matching (what counts as "produced")

- Tokens are lowercased with Turkish rules, stripped of punctuation and the
  combining dot from "İ".
- Turkish letters are folded to ASCII look-alikes (ç→c, ğ→g, ı→i, ö→o, ş→s,
  ü→u), so typing without diacritics still earns credit — matching the
  evaluator, which treats a missing diacritic as a typo, not an error.
- Inflections are matched by a scored longest-root search: exact match (100+)
  beats an inflected form such as `çayda` (50+), a short root plus a known
  suffix tail such as `evde`, `suyu` (40), a clipped token (30), and finally a
  verb-stem guess such as `istemek → istiyorum` (10).
- In loose-off mode (plain-text scans) an ASCII-only token must match exactly,
  so English words like "sure" or "variety" never credit `su` or `var`.

## 6. Mastery drives the support level (scaffold)

The amount of support-language help in a turn is derived from mastery, not
chosen by the model. A turn takes the **minimum** mastery across its target
pattern and target words (an unseen word counts as 0), so one weak item keeps
the support up.

| Mastery | Level | What the tutor is allowed to do |
|---|---|---|
| < 0.20 | L0 | Meaning carried in the support language; the target word appears once, glossed. |
| < 0.40 | L1 | Support-language sentence with the target words substituted in. |
| < 0.60 | L2 | Pattern built in target language plus one short support-language explanation. |
| < 0.80 | L3 | Pattern in target language; support language only for framing the situation. |
| ≥ 0.80 | L4 | No support-language help for the pattern; the rest in whitelisted target language. |

The strict whitelist always outranks the scaffold: reaching for an unknown
word to avoid the support language is worse than using the support language.

## 7. Mastery drives what is practised next

Each turn the controller picks one objective from the current state.

```
pattern priority = weakness × 2
                 + dueness × 1.5
                 + unresolved errors
                 − repetition fatigue
                 + rotation
```

| Term | Definition |
|---|---|
| Weakness | Distance to the bar: `1 − mastery` while mastery < 0.85; damped to `(1 − mastery) × 0.25` once mastered. |
| Dueness | Count of elapsed spaced-retrieval due dates (0–2): +1 if the due session has arrived, +1 if the due turn has arrived. |
| Unresolved errors | Raw count of logged errors against this pattern not yet resolved by a later correct use (uncapped, weight ×1). |
| Repetition fatigue | Penalty for recent use: 1.2 if used on the previous turn, decaying as `1.2 ÷ turns since use` up to 4 turns back; zero beyond that. Subtracted. |
| Rotation | Deterministic tiebreaker in [0, 0.1): the pattern's fixed curriculum index plus the current turn, modulo the pattern count, scaled small so it only breaks exact ties. |

| Phase | Chosen when | Objective |
|---|---|---|
| A — warm retrieval | First two turns, patterns known, scenario not fully mastered | Reuse a known construction without re-teaching. |
| One-shot test | A pattern was taught last turn and never tested | Produce a new example in a fresh situation. |
| Contrast | An unresolved confusion between contrasting patterns | Short contrastive exchange, then learner reproduces the contrast. |
| E — transfer test | Near the end of the session, work still open | Situation only, no native sentence, unfamiliar vocabulary. |
| B — introduce | An un-introduced pattern exists and nothing is very weak (< 0.35) | Teach exactly one construction, one example, then generalise. |
| B2 — vocabulary expansion | All patterns in place, unseen words remain | Introduce up to two new words inside the strongest known pattern. |
| B3 — word consolidation | Patterns solid, nothing new left, some words below the bar | Drill exactly one below-bar word, binding, in a rotated carrier pattern. |
| F — free conversation | Scenario fully mastered | Recombine three mastered patterns naturally, no drilling. |
| D — adaptive conversation | Fallback | Weakest/due pattern, recycling up to two shaky words. |

## 8. Anti-repetition rules

- **Carrier rotation**: the pattern hosting a word drill is scored by fit (its
  form has an open slot), freshness (turns since last use) and a turn-indexed
  rotation term — so a scenario with every pattern at 100% no longer resolves
  to the same pattern forever.
- **Word rotation**: below-bar words are sorted weakest-first but read from a
  turn-dependent offset, so a word the learner did not produce is not
  immediately re-served.
- **One target word per turn**: consolidation asks for exactly one shaky word,
  so the instruction, the expected answer and the grading all describe the
  same thing.
- **Binding targets**: the prompt states the target word is the only correct
  answer; already-mastered words may appear as scene glue only.

## 9. Spaced retrieval and transparency

- Successful retrievals schedule the next one at ~5 turns, next session,
  +3 sessions, then +7 sessions; a failure resets the interval to 3 turns.
- Every turn diffs the previous and next state and reports only the items that
  moved, largest change first — this feeds the per-bubble "Your answer /
  Mastery changes" popup and the XP coin plus confirmation sound on any gain.
- The session summary reports the overall mastery change, the patterns you can
  use, those still practising, and the new words met.

## 10. The AI prompts at a glance

Both prompts run through the Lovable AI Gateway on a Gemini flash model with
structured (JSON-schema) output and a small thinking budget. **Neither prompt
scores mastery** — all numbers come from the deterministic state above; the
model only writes text and judges categories.

The stack document pins the model as `google/gemini-3.7-flash` with
`reasoning.max_tokens = 128`, and states the invariant plainly: *"Mastery
numbers never touch the AI — the deterministic learner model owns all scoring;
the AI only reads whitelisted vocabulary and writes natural language."*

Full tutor-generator and answer-evaluator prompt shapes are in the PDF; they
are his, and ours differ because our actor speaks from rendered patterns
rather than from a model.
