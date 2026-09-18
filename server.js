/* server.js — forked from chris-w-k/jailbreak-camera.
   Zero dependencies, Node 18+. Holds the key, serves public/, judges answers.
   Camera and image generation stripped out; askJSON kept as-is. */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

/* ---------- .env loader (same as jailbreak-camera) ---------- */
function readIfExists(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
for (const line of readIfExists(path.join(ROOT, '.env')).split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const API_KEY     = (process.env.GEMINI_API_KEY || '').trim();
const API_BASE    = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL       = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TTS_MODEL   = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
/* One prebuilt voice per speaker. Swap freely — the names are Gemini's.
   If a name is wrong the call fails and the client falls back to the
   browser's own synthesis, so a bad value is never fatal.

   Axel gets Zubenelgenubi: that is the voice jailbreak-camera uses for its
   teenage punk, so he already sounds like the character Chris drew. The
   others are picked to sit away from him — a door you have to get past, a
   bar you have to order at, and the child's own echo. */
const VOICES = {
  axel:      process.env.VOICE_AXEL      || 'Zubenelgenubi',
  bouncer:   process.env.VOICE_BOUNCER   || 'Algenib',
  bartender: process.env.VOICE_BARTENDER || 'Algenib',   // the one person the child talks to
  fan:       process.env.VOICE_FAN       || 'Callirrhoe',
  learner:   process.env.VOICE_LEARNER   || 'Leda',
};

/* Gemini TTS reads a leading "Say X:" as a delivery instruction rather than
   as words to speak — the jailbreak-camera trick for steering a prebuilt
   voice without SSML. One per speaker, so Axel coaches and the bouncer
   does not. */
const STYLES = {
  axel:      process.env.STYLE_AXEL      || 'Say in a warm, cocky, laddish teenage-punk voice, like a big brother coaching a kid through it — encouraging, never babyish, and clear enough to copy:',
  bouncer:   process.env.STYLE_BOUNCER   || 'Say in a deep, gruff, slightly bored doorman voice, unhurried and a little intimidating but not unkind:',
  bartender: process.env.STYLE_BARTENDER || 'Say in a deep, gruff but good-natured voice over a noisy bar — a big bloke behind the counter who has seen it all, brisk and unbothered but never unkind:',
  fan:       process.env.STYLE_FAN       || 'Say shouted happily over loud live music, delighted and a bit breathless:',
  learner:   process.env.STYLE_LEARNER   || 'Say clearly and simply, at a learner\'s pace, like a child repeating a phrase they have just worked out:',
};
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
const MOCK        = process.env.MOCK === '1' || !API_KEY;

const TURNS_PER_IP_PER_HOUR = Number(process.env.TURNS_PER_IP_PER_HOUR || 400);
const TURNS_PER_DAY         = Number(process.env.TURNS_PER_DAY || 4000);
const TOKEN_TTL_MS          = 1000 * 60 * 60 * 6;

/* ---------- rate limiting ---------- */
let dayStamps = [];
const ipHits = new Map();
const clientIP = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

function checkRate(req) {
  const now = Date.now();
  dayStamps = dayStamps.filter(t => now - t < 864e5);
  if (TURNS_PER_DAY > 0 && dayStamps.length >= TURNS_PER_DAY) {
    throw Object.assign(new Error('This demo has hit its daily limit. Try again tomorrow.'), { status: 429 });
  }
  const ip = clientIP(req);
  const hits = (ipHits.get(ip) || []).filter(t => now - t < 36e5);
  if (TURNS_PER_IP_PER_HOUR > 0 && hits.length >= TURNS_PER_IP_PER_HOUR) {
    throw Object.assign(new Error('That’s a lot of practice for one hour. Come back later.'), { status: 429 });
  }
  hits.push(now); ipHits.set(ip, hits); dayStamps.push(now);
}

/* ---------- access code ---------- */
function mintToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${crypto.createHmac('sha256', ACCESS_CODE).update(String(exp)).digest('hex').slice(0, 32)}`;
}
function tokenValid(tok) {
  if (!ACCESS_CODE) return true;
  const [exp, sig] = String(tok || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac('sha256', ACCESS_CODE).update(exp).digest('hex').slice(0, 32);
  if (sig.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

/* The token rides in an HttpOnly cookie, as it does in jailbreak-camera, so
   no page script ever holds it. A body token is still accepted for anything
   calling the API directly (curl, a test harness, a future webview host). */
const COOKIE = 'natty_auth';
function cookieToken(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}
const authed = (req, b) => tokenValid(cookieToken(req) || (b && b.token));

/* ---------- gemini transport (verbatim shape) ---------- */
async function gemini(model, body, { tries = 3, timeoutMs = 20000 } = {}) {
  const url = `${API_BASE}/models/${model}:generateContent`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('retryable ' + res.status);
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw Object.assign(new Error('gemini ' + res.status + ' ' + detail), { status: res.status, detail });
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e && e.status === 400) throw e;      // our fault; retrying changes nothing
      if (i < tries - 1) await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/* Both of these calls are short structured JSON — a line of dialogue, a
   handful of flags. gemini-2.5-flash thinks by DEFAULT, and on a prompt this
   size that was costing tens of seconds per turn while a child sat watching a
   loading strip. Thinking is switched off.

   The field has been spelled two ways across API versions, so rather than bet
   on one, the first 400 that mentions it drops the field for the rest of the
   process and the call is retried plain. That way a wrong guess costs one
   request at boot instead of breaking every turn. */
const THINKING_BUDGET = Number(process.env.THINKING_BUDGET || 0);
const THINKING_SHAPES = [
  { thinkingConfig: { thinkingBudget: THINKING_BUDGET } },   // v1beta, 2.5-flash
  { thinking_level: 'low' },                                  // newer spelling
  {},                                                         // model default
];
let thinkingShape = 0;

async function askJSON({ system, parts, schema, temperature = 0.2, tries = 3, timeoutMs = 20000 }) {
  const send = () => gemini(MODEL, {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
      ...THINKING_SHAPES[thinkingShape],
    },
  }, { tries, timeoutMs });

  let data;
  for (;;) {
    try { data = await send(); break; }
    catch (e) {
      const rejected = e && e.status === 400 && /thinking/i.test(e.detail || e.message || '');
      if (!rejected || thinkingShape >= THINKING_SHAPES.length - 1) throw e;
      thinkingShape += 1;
      console.warn('\x1b[33m⚠\x1b[0m thinking field rejected, trying', JSON.stringify(THINKING_SHAPES[thinkingShape]));
    }
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '{}';
  return JSON.parse(text);
}

/* ---------- the evaluator ----------
   Returns flags only. It never returns a score — the client engine owns
   every number. Same contract as the local matcher it replaces. */
const EVAL_SCHEMA = {
  type: 'object',
  properties: {
    target_produced: { type: 'boolean' },
    understandable:  { type: 'boolean' },
    error_type: {
      type: 'string',
      enum: ['none', 'word_order', 'wrong_word', 'missing_word', 'native_fallback', 'typo'],
    },
    correction: { type: 'string' },
  },
  required: ['target_produced', 'understandable', 'error_type'],
};

const EVAL_SYSTEM = `You judge a single answer from a 7-10 year old learning a language through a game.
You are strict about meaning and generous about everything else.

Rules:
- target_produced is true when the learner produced the target phrase, allowing for
  missing accents, missing punctuation, capitalisation, a typo of one or two letters,
  and any of the listed acceptable variants.
- A speech transcript may mishear a word. If the whole phrase is clearly an attempt at
  the target and only one word is garbled, treat it as produced and set error_type "typo".
- understandable is true when the answer means roughly the right thing even if it is
  not the target phrasing.
- native_fallback means they answered in their own language instead.
- correction is the target phrase, written out. Never explain, never add praise.
Return JSON only.`;

async function evaluateAnswer(body) {
  const { learnerText, target, native, accept, nativeLang, targetLang } = body;
  const prompt =
    `Target phrase (${targetLang}): ${target}\n` +
    `Means (${nativeLang}): ${native}\n` +
    `Also acceptable: ${(accept || []).join(' | ') || '(none)'}\n` +
    `The learner said: ${learnerText}`;
  return await askJSON({ system: EVAL_SYSTEM, parts: [{ text: prompt }], schema: EVAL_SCHEMA });
}

/* ---------- the tutor turn generator ----------
   The other half of the Turkish trainer: a model writes the scene line and the
   coach's ask fresh every turn, in character, at the support level the
   deterministic engine chose. It still decides NOTHING about scoring or about
   which phrase is drilled — it is handed the target and asked for the words. */
const TURN_SCHEMA = {
  type: 'object',
  properties: {
    scene_line: { type: 'string' },   // what the on-screen character says
    coach_ask:  { type: 'string' },   // what the coach says, native language
  },
  required: ['scene_line', 'coach_ask'],
};

const TURN_SYSTEM = `You write two short lines for a language game played by a 7-10 year old.

You are given a scene, a character, a target phrase the child must produce, and
a support level 0-4. You do NOT choose the target and you do NOT judge anything.

scene_line: what the on-screen character says, which must make the target
phrase the natural thing to say back. It continues the conversation you are
shown — it does not restart it, greet someone already greeted, or ask
something already answered.

He is a person behind a counter, not a teacher. He NEVER tells the child what
to say, never names the words they should use, never says "say X" or "the word
is X" or "try saying". Somebody else in this game does that; when he does it
too, two voices are giving instructions and neither is worth listening to. He
serves, he answers, he reacts, he moves on.

He also never asks a question the child has no way to answer. The child has
one short list of words. "Which ticket do you need?", "what size?", "how many?"
— each of these demands vocabulary they have not got, and the turn dies there.
If he asks anything, the target phrase must be a complete answer to it.
Accepting what they said and carrying on is always better than a follow-up.

At the NATIVE levels, the target-language word you drop in is not decoration
and it is not your choice: it is the word this turn is teaching, which you are
given. "Do you need a ticket for the show?" keeps every other rule and teaches
nobody anything, because the one word the turn is about went past in the
child's own language. Use the word itself.

Two lists govern its vocabulary. Nothing outside the second list may appear
at all: those are the only words the game can explain when the child taps
them, and an unexplainable word is a dead end. Of the words that are in it
but not yet in the first list, you may use at most two — they are new to this
child. Reaching for a word they were never taught is worse than saying
something simpler.

The support level governs this line too, not just the coach's, because a
child on their first turn cannot read the person in front of them either.

  scene_line mode NATIVE (levels 0 and 1): write the line in the NATIVE
  language, with the target-language words dropped into it. At level 0 that
  means EXACTLY ONE target-language word in an otherwise native sentence —
  the meaning is carried in the language the child already has, and the one
  new word is met in context. At level 1 up to three. The line must not be
  entirely in the target language, and must contain no target-language word
  you invented.

  scene_line mode TARGET (levels 2 and up): write the line in the target
  language, within the word limit you are given. A fluent sentence is
  unreadable to a child three words into the language however correct it is,
  so at the lower of these levels the character speaks in short bursts and the
  coach carries the meaning.

You are told which mode and which limits apply. The game counts the words and
throws your line away if it breaks them.

If the scene's character speaks the native language, write it entirely in the
native language, with NOT ONE target-language word in it — no greeting, no
flourish, nothing. A coach who opens on "¡Hola!" to a child who has never
seen the language is showing off, not teaching, and the game will throw the
line away. The word limits above do not apply to a native-language line.

coach_ask: one short sentence from the coach, Axel, who has just heard the
character speak and is helping. Where the character said something in the
target language, Axel makes its meaning clear before telling the child what
to say back — that is his job on the turn. Do not hand over the whole target
phrase; the game shows that separately when the support level allows it.

THE ONE EXCEPTION, and it outranks everything else here. You are given a list
of words this turn asks for that the child has NEVER MET. If that list is not
empty, Axel must say those words and what they mean, in the same breath as the
ask — "you'll want PERDONA for that, it means excuse me". A child cannot pick
a word out of a tray they have never seen, and the alternative is a guess. If
the list IS empty, name none of it: the child has the word, and printing it
turns the turn into copying.

The support level decides how much of the child's own language you may lean
on. It is not a style choice, it is the rule:

  0  meaning carried entirely in the NATIVE language
  1  a NATIVE-language sentence with the target words dropped into it
  2  NATIVE language, plus at most one short phrase of the target language
  3  NATIVE language for framing the situation only
  4  no NATIVE-language help at all

At levels 0-3 coach_ask is written in the NATIVE language. Only at level 4 may
it be entirely in the target language. Writing the target language at a lower
level makes the turn unreadable to a child who has not met those words, and
the game will throw your line away and use its own.

Introduce at most two target-language words the child has not already met, and
never use a target-language word that is not in the allowed list.

Stay in character. No stage directions, no emoji, no praise, no questions to
the adult. Vary the wording every time so it never reads like a template.
Return JSON only.`;

async function generateTurn(b) {
  const { character, characterNote, sceneTitle, sceneSpeaks, sceneGoal, target, native,
          scaffold, sceneMode, maxSceneWords, maxSceneTargetWords,
          nativeLang, targetLang, allowed, glossable, newWords, history, recent } = b;
  const lines = [
    `Scene: ${sceneTitle}${sceneGoal ? ' — ' + sceneGoal : ''}`,
    `On-screen character: ${character}${characterNote ? ' — ' + characterNote : ''}`,
    `That character speaks: ${sceneSpeaks === 'native' ? nativeLang + ' (they are the coach)' : targetLang}`,
    `Target phrase (${targetLang}): ${target}`,
    `The word this turn is teaching — scene_line must contain it, in ${targetLang}, when writing in NATIVE mode: ${
      (target || '').split(/\s+/).slice(-1)[0].replace(/[¿?¡!.,;:]/g, '')}`,
    `Which means (${nativeLang}): ${native}`,
    `Support level: ${scaffold} of 4 (0 = brand new, 4 = nearly mastered)`,
    sceneMode === 'native'
      ? `scene_line mode: NATIVE — write it in ${nativeLang}, with at most ${maxSceneTargetWords || 1} ${targetLang} word(s) in it`
      : `scene_line mode: TARGET — write it in ${targetLang}, at most ${maxSceneWords || 12} words`,
    `Words this child has already met: ${(allowed || []).join(', ')}`,
    (newWords && newWords.length)
      ? `NEW to this child this turn — coach_ask must name these and say what they mean: ${
          newWords.map(w => `${w.target} = ${w.means}`).join('; ')}`
      : 'Nothing is new to this child this turn — coach_ask must not spell out the answer.',
    `Words the game can explain at all — nothing outside this list may appear: ${(glossable || []).join(', ')}`,
  ];
  if (history && history.length) {
    lines.push('', 'The conversation so far, oldest first. Continue it:');
    for (const h of history) {
      lines.push(`- ${h.character} said: ${h.said}`);
      if (h.coached) lines.push(`  coach: ${h.coached}`);
      lines.push(`  the child was asked for "${h.wanted}" — ${h.got}`);
    }
  } else {
    lines.push('', 'This is the first exchange of the scene.');
  }
  if (recent && recent.length) {
    lines.push('', 'Coach lines already used, do not repeat them:');
    for (const r of recent) lines.push('- ' + r);
  }
  const prompt = lines.join('\n');
  /* One attempt, short fuse. A slow turn is worse than a templated one: the
     client has a hand-written line ready and a child is watching a spinner. */
  return await askJSON({
    system: TURN_SYSTEM, parts: [{ text: prompt }], schema: TURN_SCHEMA,
    temperature: 1.0, tries: 1, timeoutMs: 8000,
  });
}

/* ---------- the coach, as an agent of its own ----------
   Switch 1 = "two". The turn generator writes the character; this writes the
   hint, having been shown what the character actually said. Two jobs, two
   prompts, each short enough to be followed.

   It costs no waiting in the normal case: the client does not post the coach's
   bubble until the character has finished speaking, so this call runs inside
   that audio. If it is late, the client uses its own line — the hint is never
   what a child is left waiting for. */
const COACH_SCHEMA = {
  type: 'object',
  properties: { coach_ask: { type: 'string' } },
  required: ['coach_ask'],
};

const COACH_SYSTEM = `You are Axel: a teenage punk musician coaching a 7-10 year
old through a conversation in a language they are learning. You have just heard
what the other person said. You write ONE short sentence back to the child — not
to the other person, who cannot hear you.

Your sentence does two things and nothing else: make sure the child understood
what was just said to them, and tell them what to say back. Say it in the
child's own language.

You are given the words this turn asks for that the child has NEVER MET. If that
list is not empty, name those words and what they mean — "you'll want PERDONA,
it means excuse me". This is the whole reason you are here: a child cannot pick
a word out of a tray they have never seen, and without you the turn is a guess.

If the list is empty the child already has the words, so do NOT spell the answer
out. Nudge instead. Printing an answer they already know turns the turn into
copying, and they learn nothing from copying.

The other person in this conversation will not help you. He serves, he answers
and he moves on; he never tells the child what to say. Explaining is yours
alone — if you skip it nobody else covers for you.

If he has just used a target-language word the child has never met, say what it
meant before you ask them for anything.

Never write the whole target phrase for them. Never use a target-language word
that is not in the allowed list — a word the game cannot explain is a dead end.
No stage directions, no emoji, no praise, no questions to an adult. Vary your
wording; you say a lot of these. Return JSON only.`;

async function generateCoach(b) {
  const { character, sceneLine, target, native, objective, scaffold,
          nativeLang, targetLang, glossable, newWords, recent } = b;
  const lines = [
    `The ${character} just said: ${sceneLine}`,
    `The child must now say (${targetLang}): ${target}`,
    `Which means (${nativeLang}): ${native}`,
    objective ? `What this turn is teaching: ${objective}` : '',
    `Support level: ${scaffold} of 4 (0 = brand new, 4 = nearly mastered)`,
    `Write your sentence in: ${nativeLang}`,
    (newWords && newWords.length)
      ? `NEVER MET before this turn — name these and say what they mean: ${
          newWords.map(w => `${w.target} = ${w.means}`).join('; ')}`
      : 'Nothing here is new to this child. Nudge; do not spell it out.',
    `Target-language words you may use at all: ${(glossable || []).join(', ')}`,
  ].filter(Boolean);
  if (recent && recent.length) {
    lines.push('', 'Your own recent lines, do not repeat them:');
    for (const r of recent) lines.push('- ' + r);
  }
  return await askJSON({
    system: COACH_SYSTEM, parts: [{ text: lines.join('\n') }], schema: COACH_SCHEMA,
    temperature: 1.0, tries: 1, timeoutMs: 6000,
  });
}

/* ---------- text to speech ----------
   Same call shape as jailbreak-camera. Gemini returns raw 24 kHz mono PCM,
   so it gets a WAV header here and the browser plays it directly. */
function wav(pcm, rate = 24000, channels = 1, bits = 16) {
  const bytes = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * bits / 8, 28);
  h.writeUInt16LE(channels * bits / 8, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return Buffer.concat([h, pcm]);
}

const ttsCache = new Map();   // "speaker|text" -> base64 wav

async function speak(text, speaker) {
  const key = speaker + '|' + text;
  if (ttsCache.has(key)) return ttsCache.get(key);
  const style = STYLES[speaker] || STYLES.axel;
  const data = await gemini(TTS_MODEL, {
    contents: [{ parts: [{ text: `${style} "${text}"` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[speaker] || VOICES.axel } } },
    },
  }, { tries: 2 });
  const part = (data?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new Error('no audio returned (' + (data?.candidates?.[0]?.finishReason || 'unknown') + ')');
  // the rate comes back on the mime type; do not assume it
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  const out = wav(Buffer.from(part.inlineData.data, 'base64'), rate).toString('base64');
  if (ttsCache.size < 500) ttsCache.set(key, out);
  return out;
}

/* ---------- static ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------- server ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) reject(new Error('too big')); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); } });
  });
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];

  if (url === '/api/health') {
    return json(res, 200, {
      ok: true, mock: MOCK, locked: !!ACCESS_CODE, unlocked: authed(req, null),
      model: MOCK ? 'local' : MODEL,
      tts: MOCK ? null : TTS_MODEL,
    });
  }

  if (url === '/api/unlock' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!ACCESS_CODE) return json(res, 200, { token: '', unlocked: true });
      if (String(b.code || '').trim() !== ACCESS_CODE) return json(res, 401, { error: 'Wrong code.' });
      const tok = mintToken();
      const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
      res.setHeader('Set-Cookie',
        `${COOKIE}=${encodeURIComponent(tok)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}${secure}`);
      return json(res, 200, { token: tok, unlocked: true });
    } catch { return json(res, 400, { error: 'bad request' }); }
  }

  if (url === '/api/evaluate' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!authed(req, b)) return json(res, 401, { error: 'Locked. Reload and enter the access code.' });
      if (MOCK) return json(res, 200, { mock: true, target_produced: null });
      checkRate(req);
      const out = await evaluateAnswer(b);
      return json(res, 200, out);
    } catch (e) {
      return json(res, e.status || 500, { error: e.message || 'evaluation failed' });
    }
  }

  if (url === '/api/turn' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!authed(req, b)) return json(res, 401, { error: 'Locked.' });
      if (MOCK) return json(res, 200, { mock: true });
      checkRate(req);
      return json(res, 200, await generateTurn(b));
    } catch (e) {
      // the client falls back to its own templates, so this is never fatal
      return json(res, 200, { error: e.message });
    }
  }

  if (url === '/api/coach' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!authed(req, b)) return json(res, 401, { error: 'Locked.' });
      if (MOCK) return json(res, 200, { mock: true });
      checkRate(req);
      return json(res, 200, await generateCoach(b));
    } catch (e) {
      // the client has its own line ready, so a failure here is never fatal
      return json(res, 200, { error: e.message });
    }
  }

  if (url === '/api/tts' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!authed(req, b)) return json(res, 401, { error: 'Locked.' });
      if (MOCK) return json(res, 200, { audio: null, mock: true });
      const text = String(b.text || '').slice(0, 300);
      if (!text) return json(res, 400, { error: 'no text' });
      return json(res, 200, { audio: await speak(text, String(b.speaker || 'axel')) });
    } catch (e) {
      // the client falls back to browser synthesis, so this is never fatal
      return json(res, 200, { audio: null, error: e.message });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end('method not allowed');
}).listen(PORT, () => {
  console.log(`natty-language on :${PORT} — ${MOCK ? 'MOCK (local matcher)' : 'gemini ' + MODEL}`);
});
