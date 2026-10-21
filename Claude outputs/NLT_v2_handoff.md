# NLT prototype — handoff from the analytics session (7 Oct 2026)

Context for the [NLT PROTOTYPE BUILD] session. Source: PostHog project 55757 (EU), production NovaPals only.

## Experiments & flag
- Flag `webview-activity-test` (id 261605). Test variant swaps Axel Q1 (`Axel/axel_pack_concert/1`, "Rehearsal Room") for the webview prototype (natty-language.onrender.com, activity `dev_nlt_activity_gig`).
- v1: experiment 99093 "axel q1 NLT going to a gig" (2–5 Oct) — ended, marked LOST. Main cause: 46% chose English as hint language and got the Spanish-learning fallback (14% finish).
- v2: experiment 99492 "axel q1 NLT going to a gig v2", launched 2026-10-05 15:04:36 UTC. Primary metrics: all-quest start→end, and "Axel Q1 (gig) start → end". On 6 Oct Chris moved 100% of traffic to test (control baselines already known; plan is to abandon the A/B and study usage). Code unchanged since v2 launch.
- v2 had a sample-ratio mismatch while 50/50 (272 control vs 222 test exposed) — not explained.

## How to filter to the prototype (quest name/slug do NOT distinguish it)
- App events: `quest_variant = 'webview-activity-test'` AND `quest_activity_type = 'webview'`.
- Webview events: `$host = 'natty-language.onrender.com'` AND `activity_type = 'nlt_prototype'` AND `activityId = 'dev_nlt_activity_gig'`. Webview distinct_ids are anonymous (not the app user).
- Linking webview → app user: match webview `NovaPals.Activity.Start` to app `NovaPals.Quest.Start` (prototype filter) on same OS within −5s/+60s, keep unique matches (~77% link).
- Spoken vs tapped: no `answerMode` logged. Answers whose `answerText` contains "…" are spoken (tap submit requires every slot filled).

## Results
- v2 head-to-head (new users, Axel Q1, phones es/pt/tr/ro/pl, hint = phone language): start→end control 58% vs NLT 58%; replays 11% vs 18%; time to finish 4.4 vs 6.1 min; D2+ too early.
- Usage, all prototype learners 5 Oct 15:04 → 7 Oct 07:30 UTC (414 learners):
  - Handoff 96% (427 app starters → 414 webview). 173 finished (42%); new 42% / returning 43%. iOS 53% (n=40), Android 41% (n=370).
  - Hint language: nobody picks English. Matched phone 45% finish; mismatched 20% — 51 of 56 mismatched are on ENGLISH phones (mostly US time zones) where the picker defaults to Spanish.
  - Median 6.2 min to finish (p75 8.0). Replays 21% of finishers. Mastery avg 94% (58% ≥95).
  - Drop-off: 414 → Q3 355 → Q8 242 → done 173. 40% of quitters leave in Q1–3; median quit 2.4 min. Quit causes: 80 question open, 55 after wrong, 55 backgrounded, 27 after right, 17 never answered.
  - First-try accuracy lowest at Q2 "¿Tienes a ticket?" 61%, Q3 "Do you have a ticket?" 62%, Q5 75%, Q15 72%; 84–93% from Q10.
  - Speaking: 36% of learners tried, 9% of answers spoken, only 20% marked correct; speakers finish 31% vs 48%.
  - Tap-to-translate: 28% used it; 47% vs 40% finish. Mic denials <2%. Finishers → another quest 70%. Later-day return 11%.

## Issues & suggested fixes (all webview — no app release needed)
1. Spoken answers: `ui.js submit()` logs/displays `builtSentence()` (tiles) instead of the transcript → "… …"; spoken check only accepts gap words exactly. Fix: see commits 6fd3e96 / 7746c57 on `fix/nlt-answer-checking`, since reverted in ba4540e ( `E.checkSpoken`, `answerOrders`, `sentenceWith`, `answerMode`). Chris reverted/did not ship it ("wasn't necessary") — data since says speakers are penalised.
2. `/api/listen` (server.js) transcribes in target language only; bridge-step answers mix native+English. Pass both languages.
3. Use existing `/api/evaluate` (Gemini judge, server.js) for spoken answers — currently unused (`evaluateSpoken` falls back to missing `E.evaluateLocal`).
4. Don't count a garbled transcript as a wrong attempt: show "I heard: …", retry / use tiles.
5. Swapped nouns rejected on i-like-two (28 answers, 26 learners; top wrong answer at Q15). Fix: `swappable` flag + order-tolerant `validate()` (same branch).
6. Article "a" confusion at Q2–3 ("¿Tienes ticket band?"/"singer ticket", ~80 answers): introduce "a" explicitly or keep it printed on the bridge step; fewer noun decoys on first slot step (`pills()`).
7. Word-order errors ("I Can have water?"): `engine.check()` already returns `why: 'word_order'` but UI ignores it — show "right words, wrong order".
8. Hint language for English phones: exclude English device locales via the flag (PostHog-only change; confirm which person property holds locale), or fall back to time zone in `deviceLang()`; make the picker an explicit, self-labelled choice instead of pre-selecting Spanish.
9. Early drop-off: guided first move on Q1; re-prompt when resuming an open question.
10. Review/makeup round grind (24 learners, 5.4 attempts/question, 50% first try): cap attempts or end once mastery met.
11. Tap-to-translate tokens include punctuation (`“Excuse` → "(part of 'Perdona.')", 21 learners): strip lead/tail punctuation before gloss lookup (`fragments.js`).
12. Tracking: identify the webview with the app user id via the handoff (`bridge.js`); add `answerMode`.

## Repo state
- Local `~/natty-language` is on branch `fix/nlt-answer-checking`: 6fd3e96 (fixes) → 7746c57 (Chris: "Record what they said, and accept the sentence they actually spoke") → ba4540e (Chris: "Revert both voice/swapped-noun fixes, back to a clean base"). Net effect: no fix live. Test script: `Claude outputs/nlt_answer_check_test.js` (untracked).
- Charts from the analysis were delivered in the analytics chat (nlt_experiment_metrics*.png, nlt_time_to_convert*.png, nlt_dropoff_usage.png).
