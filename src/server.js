import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestion } from './qa.js';
import { describeModel, warmUp } from './llm.js';

const PORT = Number(process.env.PORT || 3000);
const indexHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'));

const STATUS_CODES = { answered: 200, not_found: 200, error: 400, model_unavailable: 503 };

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(indexHtml);
  }
  if (req.method === 'POST' && req.url === '/api/ask') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10_000) return sendJson(res, 413, { status: 'error', message: 'Question is too long.' });
    }
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      return sendJson(res, 400, { status: 'error', message: 'Body must be JSON: {"question": "..."}' });
    }
    try {
      const result = await answerQuestion(payload.question, { simulateFailure: payload.simulateFailure === true });
      return sendJson(res, STATUS_CODES[result.status] ?? 200, result);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { status: 'error', message: 'Something went wrong on the server.' });
    }
  }
  sendJson(res, 404, { status: 'error', message: 'Not found' });
}).listen(PORT, () => {
  console.log(`BrightPath Q&A running at http://localhost:${PORT} (model: ${describeModel()})`);
  warmUp().then(() => console.log('Model ready.'));
});
