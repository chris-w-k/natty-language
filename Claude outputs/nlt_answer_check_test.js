global.window = global; global.location = { search: '' };
global.localStorage = { getItem(){return null}, setItem(){} };
require('./fragments.js'); require('./content.js'); require('./engine.js');
const Q = window.QUEST, E = window.ENGINE;
console.log('keys', Object.keys(Q).slice(0,30).join(','));
const st = E.syllabus(Q);
const idx = st.findIndex(p => p.patternId === 'i-like-two');
const pair = st[idx];
console.log('native', Q.nativeLang, 'target', Q.targetLang, 'swappable', pair.group.swappable, pair.slotKeys);
for (let step = 0; step < E.stepsIn(pair); step++) {
  const state = E.createState(Q); state.stage = idx; state.step = step; state.go = 2;
  const plan = E.planTurn(state, pair);
  const orders = E.answerOrders(plan);
  console.log('\nstep', step, 'expected:', plan.expected, '| answer:', plan.answer.join(' '));
  orders.forEach(o => console.log('  order:', o.join(' '), '| sentence:', E.sentenceWith(plan, o)));
  const pills = plan.expectedAnswerPills;
  const asPills = o => E.makePills(o);
  console.log('  validate expected ->', E.validate(asPills(orders[0]), plan).correct);
  if (orders[1]) console.log('  validate swapped ->', E.validate(asPills(orders[1]), plan).correct, E.validate(asPills(orders[1]), plan).marks);
  const wrong = orders[0].slice(); [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
  console.log('  validate scrambled', wrong.join(' '), '->', E.validate(asPills(wrong), plan).correct);
  console.log('  spoken gap ->', E.checkSpoken(orders[0].join(' '), plan), '| spoken full ->', E.checkSpoken(plan.expected, plan),
              '| spoken swapped full ->', orders[1] ? E.checkSpoken(E.sentenceWith(plan, orders[1]), plan) : '-', '| empty ->', E.checkSpoken('', plan), '| junk ->', E.checkSpoken('banana', plan));
}
// a single-slot pattern regression
const p2 = st.find(p => p.patternId === 'do-you-have');
const s2 = E.createState(Q); s2.stage = st.indexOf(p2); s2.step = 0; s2.go = 2;
const pl2 = E.planTurn(s2, p2);
console.log('\ndo-you-have step0:', pl2.expected, '| orders', E.answerOrders(pl2).length, '| spoken full', E.checkSpoken(pl2.expected, pl2), '| gap', E.checkSpoken(pl2.answer.join(' '), pl2));
