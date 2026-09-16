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
   browser's own synthesis, so a bad value is never fatal. */
const VOICES = {
  axel:      process.env.VOICE_AXEL      || 'Puck',
  bouncer:   process.env.VOICE_BOUNCER   || 'Charon',
  bartender: process.env.VOICE_BARTENDER || 'Aoede',
  learner:   process.env.VOICE_LEARNER   || 'Zubenelgenubi',
};
const TTS_STYLE = process.env.TTS_STYLE || 'Say this warmly and clearly, to a child learning the language:';
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

/* ---------- gemini transport (verbatim shape) ---------- */
async function gemini(model, body, { tries = 3 } = {}) {
  const url = `${API_BASE}/models/${model}:generateContent`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('retryable ' + res.status);
      if (!res.ok) throw new Error('gemini ' + res.status + ' ' + (await res.text()).slice(0, 300));
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function askJSON({ system, parts, schema, temperature = 0.2 }) {
  const data = await gemini(MODEL, {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
    },
  });
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

scene_line: one short sentence the on-screen character says, in the TARGET
language, that makes the target phrase the natural thing to say next. Use only
words from the allowed list. If the scene's character speaks the native
language, write it in the native language instead.

coach_ask: one short sentence from the coach, in the NATIVE language, telling
the child what to communicate. Never write the target phrase itself here —
the game shows that separately when the support level allows it. Never
translate the target word for word.

Stay in character. No stage directions, no emoji, no praise, no questions to
the adult. Vary the wording every time so it never reads like a template.
Return JSON only.`;

async function generateTurn(b) {
  const { character, characterNote, sceneTitle, sceneSpeaks, target, native,
          scaffold, nativeLang, targetLang, allowed, recent } = b;
  const lines = [
    `Scene: ${sceneTitle}`,
    `On-screen character: ${character}${characterNote ? ' — ' + characterNote : ''}`,
    `That character speaks: ${sceneSpeaks === 'native' ? nativeLang + ' (they are the coach)' : targetLang}`,
    `Target phrase (${targetLang}): ${target}`,
    `Which means (${nativeLang}): ${native}`,
    `Support level: ${scaffold} of 4 (0 = brand new, 4 = nearly mastered)`,
    `Allowed ${targetLang} words: ${(allowed || []).join(', ')}`,
  ];
  if (recent && recent.length) {
    lines.push('Lines already used this session, do not repeat them:');
    for (const r of recent) lines.push('- ' + r);
  }
  const prompt = lines.join('\n');
  return await askJSON({ system: TURN_SYSTEM, parts: [{ text: prompt }], schema: TURN_SCHEMA, temperature: 1.0 });
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
  const data = await gemini(TTS_MODEL, {
    contents: [{ parts: [{ text: `${TTS_STYLE} "${text}"` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[speaker] || VOICES.axel } } },
    },
  }, { tries: 2 });
  const b64 = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error('no audio returned');
  const out = wav(Buffer.from(b64, 'base64')).toString('base64');
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
      ok: true, mock: MOCK, locked: !!ACCESS_CODE,
      model: MOCK ? 'local' : MODEL,
      tts: MOCK ? null : TTS_MODEL,
    });
  }

  if (url === '/api/unlock' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!ACCESS_CODE) return json(res, 200, { token: '' });
      if (String(b.code || '').trim() !== ACCESS_CODE) return json(res, 401, { error: 'Wrong code.' });
      return json(res, 200, { token: mintToken() });
    } catch { return json(res, 400, { error: 'bad request' }); }
  }

  if (url === '/api/evaluate' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!tokenValid(b.token)) return json(res, 401, { error: 'Locked. Reload and enter the access code.' });
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
      if (!tokenValid(b.token)) return json(res, 401, { error: 'Locked.' });
      if (MOCK) return json(res, 200, { mock: true });
      checkRate(req);
      return json(res, 200, await generateTurn(b));
    } catch (e) {
      // the client falls back to its own templates, so this is never fatal
      return json(res, 200, { error: e.message });
    }
  }

  if (url === '/api/tts' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!tokenValid(b.token)) return json(res, 401, { error: 'Locked.' });
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
