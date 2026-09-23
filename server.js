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

async function askJSON({ system, parts, contents, schema, temperature = 0.2, tries = 3, timeoutMs = 20000 }) {
  const send = () => gemini(MODEL, {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: contents || [{ role: 'user', parts }],
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

/* ---------- the two agents ----------
   NJA-3154 splits the exchange into two Gemini calls, in series: the actor
   speaks first, then the coach is asked for a hint GIVEN what the actor
   actually said. That ordering is the point. A single call that writes both
   lines at once is writing the coach's reaction to a line it has not committed
   to yet, and the two drift — the coach glosses a word the actor did not use,
   or hints at a question the actor did not ask.

   Each call is built the way the ticket describes:
     rules prompt  (per speaker, from content, with {{tags}})
   + scenario prompt
   = one system prompt, tags evaluated at runtime,
   and the chat history goes in the `contents` array rather than the prompt.

   Neither agent decides anything. The engine has already chosen the pair,
   which half of the sentence is in the target language and what the right
   answer is; these two write the dialogue around it. */

const { fragments } = require('./public/fragments.js');

/* {{tag}} evaluation. A tag with no value evaluates to empty rather than
   being left on the page as literal braces — an unreplaced {{tag}} reaching
   the model is worse than a missing sentence, because it reads as an
   instruction nobody wrote. Unknown tags are logged once so a typo in a
   Directus-authored prompt is visible rather than silent. */
const warnedTags = new Set();
function evaluateTags(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, name) => {
    const key = name.toLowerCase();
    if (!(key in vars)) {
      if (!warnedTags.has(key)) {
        warnedTags.add(key);
        console.warn('\x1b[33m⚠\x1b[0m prompt tag {{' + key + '}} has no value');
      }
      return '';
    }
    const v = vars[key];
    return Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v));
  });
}

const ACTOR_SCHEMA = {
  type: 'object',
  properties: { actor_line: { type: 'string' } },
  required: ['actor_line'],
};
const COACH_SCHEMA = {
  type: 'object',
  properties: { coach_line: { type: 'string' } },
  required: ['coach_line'],
};

/* The chat history as Gemini `contents`, not as prose inside the prompt
   (NJA-3154 AC 2.4). Each agent sees its OWN past lines as `model` turns and
   everything else as `user` turns, which is what stops either of them
   repeating a line they already said — the thing a flattened transcript in the
   prompt never quite manages.

   A conversation may not open on a model turn, so a bare opening beat is
   prepended when the oldest entry is one of ours. */
function historyContents(history, mine, names) {
  const out = [];
  const push = (role, text) => text && out.push({ role, parts: [{ text }] });
  for (const h of history || []) {
    if (mine === 'coach') {
      push('user', `${names.actor}: ${h.actor}`);
      push('model', h.coach);
    } else {
      push('model', h.actor);
      if (h.coach) push('user', `${names.coach} told them: ${h.coach}`);
    }
    push('user', h.got === 'the child said it'
      ? `The child answered correctly: "${h.wanted}"`
      : `The child did not manage "${h.wanted}".`);
  }
  if (out.length && out[0].role === 'model') {
    out.unshift({ role: 'user', parts: [{ text: 'The conversation so far:' }] });
  }
  return out;
}

/* The tag values both agents share. Everything here is a decision the engine
   has already made; nothing is left for a model to infer. */
function turnVars(b) {
  const intro = b.introducing;
  return {
    native_language: b.nativeLang,
    target_language: b.targetLang,
    user_expected_answer: b.expected,
    user_expected_answer_native: b.expectedNative,
    scenario_prompt: b.prompt,
    coach_prompt: b.coachPrompt,
    actor_name: b.actor,
    coach_name: b.coach,
    objectives: b.objectives,
    introduced_words: (b.introduced || []).length ? b.introduced : '(none yet)',
    /* The same list split by whose line it is. The character gets the words he
       may say; the words that are the child's alone are named so he can avoid
       them, and the client rejects his line outright if he uses one anyway. */
    actor_may_use: (b.actorMayUse || b.introduced || []).length
      ? (b.actorMayUse || b.introduced) : '(none yet)',
    learner_only: (b.learnerOnly || []).length ? b.learnerOnly : '(none yet)',
    new_thing: !intro
      ? 'Nothing new is being introduced this exchange. Do not spell the answer out.'
      : intro.by === 'actor'
        ? `NEW THIS EXCHANGE: you introduce the word "${intro.target}" (it means "${intro.means}"). It must appear in your line, in ${b.targetLang}, used naturally. This is the child's first meeting with it.`
        : `NEW THIS EXCHANGE: the CHARACTER is introducing the word "${intro.target}" (it means "${intro.means}"). Do not introduce anything yourself.`,
    actor_line: b.actorLine || '',
  };
}

/* The coach's version of {{new_thing}} is the mirror image: a construction is
   the coach's to hand over, a word is the character's. */
function coachVars(b) {
  const v = turnVars(b);
  const intro = b.introducing;
  v.new_thing = !intro
    ? 'Nothing new is being introduced this exchange. Remind them what to say without giving the whole line.'
    : intro.by === 'coach'
      ? `NEW THIS EXCHANGE: you introduce the construction "${intro.target}", which means "${intro.means}". Say it and say what it means — this is the child's first sight of it and there is no other way for them to know it.`
      : `NEW THIS EXCHANGE: ${b.actor} has just used the new word "${intro.target}". Tell the child what it means, in ${b.nativeLang}.`;
  return v;
}

async function generateActor(b) {
  const vars = turnVars(b);
  const system = evaluateTags(b.actorRules, vars);
  const ask = [
    `It is the child's turn to speak to you next. Say your line.`,
    (b.recentActor || []).length
      ? `Lines you have already used — do not repeat them:\n` + b.recentActor.map(r => '- ' + r).join('\n')
      : '',
  ].filter(Boolean).join('\n\n');

  const contents = historyContents(b.history, 'actor', { actor: b.actor, coach: b.coach });
  contents.push({ role: 'user', parts: [{ text: ask }] });

  const out = await askJSON({
    system, contents, schema: ACTOR_SCHEMA,
    temperature: 1.0, tries: 1, timeoutMs: 8000,
  });
  return {
    actorText: out.actor_line,
    chatHistory: [{ role: 'actor', messageFragments: fragments(out.actor_line, b.introduced || []) }],
  };
}

async function generateCoach(b) {
  const vars = coachVars(b);
  const system = evaluateTags(b.coachRules, vars);
  const ask = [
    `${b.actor} has just said: "${b.actorLine}". Say your line to the child.`,
    (b.recentCoach || []).length
      ? `Lines you have already used — do not repeat them:\n` + b.recentCoach.map(r => '- ' + r).join('\n')
      : '',
  ].filter(Boolean).join('\n\n');

  const contents = historyContents(b.history, 'coach', { actor: b.actor, coach: b.coach });
  contents.push({ role: 'user', parts: [{ text: ask }] });

  const out = await askJSON({
    system, contents, schema: COACH_SCHEMA,
    temperature: 1.0, tries: 1, timeoutMs: 8000,
  });
  /* The coach may legitimately write one target-language phrase: the
     construction they are introducing. Everything else of theirs is the
     child's own language, so only that phrase is eligible to highlight. */
  const allowed = (b.introducing && b.introducing.by === 'coach')
    ? [...(b.introduced || []), ...String(b.introducing.target).split(/\s+/)]
    : (b.introduced || []);
  return {
    coachText: out.coach_line,
    chatHistory: [{ role: 'coach', messageFragments: fragments(out.coach_line, allowed) }],
  };
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

  /* Two calls, in the order NJA-3154 fixes: the actor speaks, then the coach
     hints at what the actor actually said. In the real build these are the two
     halves of one startSession response; here they are two requests so the
     client can put the character on screen the moment his line lands and ask
     for the coach's while his audio is still playing. */
  if (url === '/api/turn' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!authed(req, b)) return json(res, 401, { error: 'Locked.' });
      if (MOCK) return json(res, 200, { mock: true });
      checkRate(req);
      return json(res, 200, await generateActor(b));
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
