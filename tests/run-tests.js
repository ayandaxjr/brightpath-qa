// Runs the three required scenarios and saves the results to results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestion } from '../src/qa.js';
import { describeModel, warmUp } from '../src/llm.js';

await warmUp();

const scenarios = [
  {
    name: 'Answered by the documents',
    question: 'When is the group coaching session?',
    expect: (r) =>
      r.status === 'answered' && r.sources.some((s) => s.id === 'Doc 2') && /tuesday/i.test(r.answer) && /16:00/.test(r.answer),
  },
  {
    name: 'Not answered by the documents',
    question: 'How much does the Foundations course cost, and can I get a refund?',
    expect: (r) => r.status === 'not_found',
  },
  {
    name: 'Not answered, but looks related (model must refuse)',
    question: 'Can I download the lesson videos to watch offline?',
    expect: (r) => r.status === 'not_found',
  },
  {
    name: 'Model / API failure',
    question: 'How do I reset my password?',
    options: { simulateFailure: true },
    expect: (r) => r.status === 'model_unavailable' && Boolean(r.message),
  },
];

const results = [];
for (const s of scenarios) {
  const started = Date.now();
  const result = await answerQuestion(s.question, s.options);
  const passed = s.expect(result);
  results.push({ scenario: s.name, question: s.question, passed, ms: Date.now() - started, result });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${s.name}`);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');
mkdirSync(outDir, { recursive: true });
const model = describeModel();
const slug = model.startsWith('MOCK') ? 'mock' : 'real-model';
writeFileSync(join(outDir, `test-results-${slug}.json`), JSON.stringify({ model, runAt: new Date().toISOString(), results }, null, 2));
console.log(`Saved results/test-results-${slug}.json (model: ${model})`);
process.exit(results.every((r) => r.passed) ? 0 : 1);
