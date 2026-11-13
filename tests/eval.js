// Wider check than run-tests.js: answerable and unanswerable questions, scored by expected source.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestion } from '../src/qa.js';
import { describeModel, warmUp } from '../src/llm.js';

const cases = [
  { q: 'How do I start my first lesson?', expect: 'Doc 1', must: /Start Lesson 1/i },
  { q: 'How many lessons are in the Foundations course?', expect: 'Doc 1', must: /\b6\b|six/i },
  { q: 'How do I save my progress after a lesson?', expect: 'Doc 1', must: /Mark complete/i },
  { q: 'When is the group coaching session and where do I find the link?', expect: 'Doc 2', must: /16:00[\s\S]*30 minutes|30 minutes[\s\S]*16:00/ },
  { q: 'When are coaching recordings available?', expect: 'Doc 2', must: /24 hours/ },
  { q: 'How long does feedback on practice work take?', expect: 'Doc 2', must: /2 working days/ },
  { q: 'I forgot my password, what do I do?', expect: 'Doc 3', must: /Forgot password/i },
  { q: 'My lesson progress is wrong, who do I contact?', expect: 'Doc 3', must: /support@brightpath\.example/ },
  { q: 'Can I download the lesson videos to watch offline?', expect: 'not_found' },
  { q: 'Will BrightPath help me get a job?', expect: 'not_found' },
  { q: 'Is there a mobile app?', expect: 'not_found' },
];

await warmUp();
const rows = [];
for (const c of cases) {
  const r = await answerQuestion(c.q);
  const got = r.status === 'answered' ? r.sources.map((s) => s.id).join(',') : r.status;
  const passed = c.expect === 'not_found' ? r.status === 'not_found' : got.includes(c.expect) && c.must.test(r.answer);
  rows.push({ question: c.q, expected: c.expect, got, passed, answerMode: r.answerMode, answer: r.answer ?? r.message, note: r.note });
  console.log(`${passed ? 'PASS' : 'FAIL'}  [${got}] ${c.q}\n      ${r.answer ?? r.message}`);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'eval-real-model.json'), JSON.stringify({ model: describeModel(), runAt: new Date().toISOString(), rows }, null, 2));
console.log(`\n${rows.filter((r) => r.passed).length}/${rows.length} passed — saved results/eval-real-model.json`);
