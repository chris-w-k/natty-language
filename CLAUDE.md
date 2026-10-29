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

Five question-answer groups, fourteen exchanges. A group is one question the
character asks, one construction the child answers with, and **two** words to
answer about. Inside a group there are exactly four exchanges: one per new
word, then the child's sentence crosses into the target language, then **her
question** crosses. That is NJA-3317's schema (`vocab_1` and `vocab_2`, both
required, and no third) and NJA-3343's exchange list, which the build follows
item for item.

```
nightIndex  group   construction   what is new
0           open    excuse-me      the construction
1,2         door    i-have         ticket, cash
3           door    i-have         the child's sentence crosses
4           door    i-have         HER QUESTION crosses
5,6         drinks  do-you-have    water, soda
7           drinks  do-you-have    the child's sentence crosses
8           drinks  do-you-have    HER QUESTION crosses
9,10        order   can-i-have     record, tshirt
11          order   can-i-have     the child's sentence crosses
12          order   can-i-have     HER QUESTION crosses
13          close   thank-you      the construction
```

The engine derives all of this from `g.vocab`: two words in, four steps out.
Nothing in `qaStages` counts to three or to five. To change the length of a
group, change its word list.

Then a **revision round** of up to five exchanges, made only of what the child
got wrong the first time, run whether or not they passed. Then, if still short
of the pass mark, the older makeup loop.

Exchanges 4, 8 and 12 are the ones the redesign is judged on: the child's
answer there is a sentence they have already produced, so a wrong answer is a
failure to *understand her*, not to build the sentence.

## The coach's three parts

NJA-3341: every hint is CONTEXT, then EXPOSURE, then INSTRUCTION — why this
exchange is happening, what the new words mean, and what to tell her. The
context beat is fed by the group's own `goal` in content, not by the venue
prompt: "you need a ticket to get in" is true of one exchange and false of the
night. A hint with no context is a translation and an order, which is what
shipped over the weekend while NJA-3325 sat in Refinement.

NJA-3325's other half: the coach may greet the child **once**, on exchange 0,
and never again. `greeting_rule` in `coachVars` is the switch.

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
11. **A key a group carries has to be named in the `q.qa` normaliser** in
    `content.js`, or it is dropped on the way through and the engine reads a
    group missing half of what content wrote. `goal` shipped on 27 Oct and
    never arrived: every hint that build gave went out with its first part
    blank, and nothing failed. It came back a second time on the revert.
12. **An id rule beats `.hidden`.** Any element with a `display` in an id rule
    needs its own `#id.hidden{display:none}`. Three have needed it so far;
    check it on the fourth.
13. **`nightIndex` only means anything inside one `build`.** It is renumbered
    whenever the night's shape changes, and it changed three times in a week.
    Never pool two builds on it. `groupId` is the cut that survives.
14. **One change per build, and prefer a concurrent split to a revert.** Era 3
    against era 4 is unreadable because two things changed in one commit, and
    every release comparison before that was a different week with different
    children. Two arms in one build, assigned once and stored, is the only
    honest A/B this prototype has ever had.

## Where the reasoning lives

In the README and in the comments, next to the code they explain. About a
tenth of `content.js`, `engine.js` and `ui.js` is comment, and it is mostly
*why* rather than *what* — which noun a slot gets and what happened the last
time it got a different one. That is what makes a two-week-old mechanic
readable without asking.

Keep writing them. A comment that records a decision and the evidence behind
it is worth more here than one that narrates the line below it.
