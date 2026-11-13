import { answerQuestion } from './qa.js';
import { warmUp } from './llm.js';

const args = process.argv.slice(2);
const simulateFailure = args.includes('--fail');
const question = args.filter((a) => a !== '--fail').join(' ');

if (!question) {
  console.log('Usage: npm run ask -- "your question" [--fail]');
  process.exit(1);
}

if (!simulateFailure) await warmUp();
const result = await answerQuestion(question, { simulateFailure });
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'model_unavailable' ? 2 : 0);
