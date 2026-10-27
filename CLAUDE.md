# Working in this repo

The README is the design: why the night is shaped the way it is, and what the
data said when it changed. This file is the mechanics — how to run it, what
not to break, and the handful of things that have each cost a session to
re-learn.

## What this is

A language-teaching prototype that runs as a webview inside the NovaPals app,
behind the PostHog feature flag `webview-activity-test` (flag 261605, project
55757, EU). Node and Express, **no build step and no dependencies** — the
files in `public/` are served as they are written. That is deliberate: it is
why a change can be read in a diff and shipped in a minute.

## Shipping

- Render deploys `main` automatically. There is no staging environment.
- **Pushing from a Claude session is blocked** by a production-deploy
  classifier. Claude commits; Chris pushes by hand:
  `cd ~/natty-language && git push origin main`
- So **say when commits are waiting.** A commit that is not pushed is not
  live, and while the flag is on, that gap is children playing the old build.
  Check `git log --oneline origin/main..HEAD` before saying anything shipped.
- Every event carries `build`, the short commit. The webview is cached, so
  deploy time is not build time — always file a session by the build it
  *loaded*, resolved per session with `argMin` over timestamp.

## Running and testing

`node server.js`, then open `localhost:3000`. With no `GEMINI_API_KEY` it runs
in mock mode and falls back to its written lines, which is enough to exercise
every path except the coach's wording.

Test doors on the URL:

| | |
|---|---|
| `?intro=0` | straight into the night, skipping the language and title screens |
| `?native=en&target=es` | set the pair without the picker |
| `?venue=cinema` | a scenario other than the default |
| `?debug=1` | the test strip, and `window.__DEBUG` |
| `?analytics=0` | no events |
| `?opener=0` | score the first turn instead of gifting it |

`?intro=0` is the one that matters. Without it a headless test sits on the
intro forever, and that cost the better part of a week before anyone noticed
the door already existed.

Headless harnesses live in **`~/nltwork`**, outside this repo: `load.js` boots
content and engine in a VM, `qa.js` prints the whole ladder, `rev.js` walks the
revision round, `ac3317.js` checks the actor's acceptance criteria across eight
language pairs. Browser tests need Chromium, which is not on the laptop — they
run in a cloud container against a stub server, and **every source file must be
re-copied each time**, because that clone gets reset and a stale file looks
exactly like a real test failure.

## The shape of a night

Five question-answer groups, seventeen exchanges. A group is one question the
character asks, one construction the child answers with, and three words to
answer about. Inside a group: one exchange per new word, then the child's
sentence crosses into the target language, then **her question** crosses.

```
nightIndex  group   construction   what is new
0           open    excuse-me      the construction
1,2,3       door    i-have         ticket, cash, card
4           door    i-have         the child's sentence crosses
5           door    i-have         HER QUESTION crosses
6,7,8       drinks  do-you-have    water, soda, beer
9           drinks  do-you-have    the child's sentence crosses
10          drinks  do-you-have    HER QUESTION crosses
11,12,13    order   can-i-have     record, tshirt, poster
14          order   can-i-have     the child's sentence crosses
15          order   can-i-have     HER QUESTION crosses
16          close   thank-you      the construction
```

Then a **revision round** of up to five exchanges, made only of what the child
got wrong the first time, run whether or not they passed. Then, if still short
of the pass mark, the older makeup loop.

Exchanges 5, 10 and 15 are the ones the redesign is judged on: the child's
answer there is a sentence they have already produced, so a wrong answer is a
failure to *understand her*, not to build the sentence.

## The files

| | |
|---|---|
| `public/content.js` | The Directus stand-in. Vocabulary, patterns, QA groups, every UI string, and both model prompts. Six languages, always. |
| `public/engine.js` | The ladder. What crosses when, what is new, scoring, the revision round, the makeup loop. Decides everything; renders nothing. |
| `public/ui.js` | The screen. Renders the engine's decisions, runs the turn loop, sends the events. |
| `server.js` | One model call per turn (the coach), plus the judge and TTS. `/api/turn` and `/api/react` are still served but nothing calls them. |
| `public/fragments.js` | Which words are highlighted. Loaded by BOTH server and client, so the two can never disagree about what is foreign. |
| `public/bridge.js` | **Outbound only.** The app sends this page nothing — no language, no quest, no child. |

## Rules that have each cost a session

1. **Ids are permanent.** The night is called "Night club" and its id is still
   `gig`, because that id is in every event ever filed, in the quest slug and
   in a filename. Rename the label, never the id.
2. **`^` on every answer slot.** Handing the article over instead of asking
   for it took one construction from 48.4% wrong to 30.0% at 11.9σ. The reason
   was never the article — it is that an indefinite slot asks for two pills
   where a bare one asks for one. One new chunk per exchange.
3. **The coach never writes the child's answer in the target language** — not
   whole, not mostly, and not inside a native frame. Enforced in
   `generateCoachLine`, not asked for in the prompt. (NJA-3324.)
4. **Actor patterns are never drilled.** `speaker: 'actor'` means defined but
   never selectable as a question. It is what stops the child being taught to
   say the barmaid's line.
5. **Six languages or none.** A string in one language is a string that breaks
   for five sixths of the audience. Turkish and Polish need a native check;
   case inflection makes "piwo" and "piwa" look like different words to a
   nine-year-old.
6. **Group analytics on `phase`, `nightIndex` and `stepKey` — never
   `questionIndex`.** The latter is the engine's position in the *current*
   plan, and the revision round replaces that plan and resets it to zero. It
   is kept on the events only so old dashboards still render.
7. **Exclude `language_source = 'picker-flipped'`.** That is a tester running
   the night backwards, not a child.
8. **Percentages, never "x out of y"**, in anything reported to Chris. Sample
   sizes go in one footer line.
9. **`bridge.js` sends JSON and nothing else.** It once sent a bare string
   alongside, and the app's `JSON.parse` threw 5,557 times across 1,342
   children before anyone saw it.
10. **Anything reached by a selected subset is selection, not difficulty.**
    Leavers, strugglers, the makeup loop, the whole revision round. A retry
    loop once went out labelled "the single hardest moment in the activity".

## Where the reasoning lives

In the README and in the comments, next to the code they explain. About a
tenth of `content.js`, `engine.js` and `ui.js` is comment, and it is mostly
*why* rather than *what* — which noun a slot gets and what happened the last
time it got a different one. That is what makes a two-week-old mechanic
readable without asking.

Keep writing them. A comment that records a decision and the evidence behind
it is worth more here than one that narrates the line below it.
