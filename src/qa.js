import { loadDocuments, retrieve, tokenize } from './retrieve.js';
import { chat, describeModel, ModelUnavailableError } from './llm.js';

const docs = loadDocuments();

// Doc 3 says these topics are not covered and must be referred to support.
const OUT_OF_SCOPE_TERMS = ['pricing', 'refund', 'placement'];

const NOT_FOUND_MESSAGE =
  'I could not find this in the supplied BrightPath documents, so I will not guess. ' +
  'Please contact support@brightpath.example (Monday to Friday, 09:00–17:00 UTC).';

const MODEL_DOWN_MESSAGE =
  'The AI model is unavailable right now, so no answer was generated. Please try again in a few minutes.';

const SYSTEM_PROMPT = `You answer questions for members of BrightPath Learn.
Rules:
- Use ONLY the documents provided by the user message. Do not use outside knowledge.
- If the documents do not contain the answer, reply with exactly: NOT_FOUND
- Pricing, refunds and job placement are NOT covered by the documents: reply NOT_FOUND for those.
- Never ask the member to send a password.
- Answer in one or two short sentences, reusing the documents' own wording.
- Only include facts that directly answer the question. Do not add steps, reasons or benefits that are not written in the documents.
- On the last line write: SOURCE: Doc N (the document that supports the answer).`;

export async function answerQuestion(question, { simulateFailure = false } = {}) {
  const model = describeModel();
  const q = String(question ?? '').trim();
  if (!q) return { status: 'error', message: 'Please type a question.', model };

  if (OUT_OF_SCOPE_TERMS.some((t) => tokenize(q).includes(t))) {
    return {
      status: 'not_found',
      answer: NOT_FOUND_MESSAGE,
      sources: [],
      model,
      note: 'Pricing, refunds and job placement are excluded by Doc 3 — Account help; the model was not called.',
    };
  }

  const hits = retrieve(q, docs);
  if (hits.length === 0) {
    return { status: 'not_found', answer: NOT_FOUND_MESSAGE, sources: [], model, note: 'No document matched the question; the model was not called.' };
  }

  const context = hits
    .map(({ doc, evidence }) => {
      const ordered = [evidence, ...doc.sentences.filter((s) => s !== evidence)];
      return `[${doc.id} — ${doc.title.replace(/^Document \d+ — /, '')}]\n${ordered.join('\n')}`;
    })
    .join('\n\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Documents:\n${context}\n\nQuestion: ${q}` },
  ];

  let raw;
  try {
    raw = await chat(messages, { simulateFailure });
  } catch (err) {
    if (!(err instanceof ModelUnavailableError)) throw err;
    return {
      status: 'model_unavailable',
      message: MODEL_DOWN_MESSAGE,
      detail: err.message,
      relatedDocuments: hits.map((h) => ({ id: h.doc.id, title: h.doc.title })),
      model,
    };
  }

  const result = parseModelOutput(raw, hits, model);
  if (!result.rejectedAsUngrounded) return result;

  // A small model often pads its answer with invented detail. Ask it a narrower question instead:
  // which of these exact sentences answer the question? The reply can then only contain document text.
  try {
    const quoted = await quoteSentences(q, hits, simulateFailure);
    if (quoted) return { ...quoted, model, note: `${result.note} Fell back to quoting the documents.` };
  } catch (err) {
    if (!(err instanceof ModelUnavailableError)) throw err;
  }
  delete result.rejectedAsUngrounded;
  return result;
}

async function quoteSentences(question, hits, simulateFailure) {
  const numbered = hits.flatMap(({ doc }) => doc.sentences.map((sentence) => ({ doc, sentence })));
  const list = numbered.map((n, i) => `${i + 1}. ${n.sentence}`).join('\n');
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          'You pick the sentences that directly answer a question. Reply ONLY with sentence numbers separated by commas, for example: 2, 4. If no sentence answers the question, reply NONE.',
      },
      { role: 'user', content: 'Sentences:\n1. The cafe opens at 08:00.\n2. Dogs are welcome on the terrace.\n3. The terrace closes at 20:00.\n\nQuestion: When does the terrace close?' },
      { role: 'assistant', content: '3' },
      { role: 'user', content: 'Sentences:\n1. The cafe opens at 08:00.\n2. Dogs are welcome on the terrace.\n\nQuestion: Do you sell gift cards?' },
      { role: 'assistant', content: 'NONE' },
      { role: 'user', content: `Sentences:\n${list}\n\nQuestion: ${question}` },
    ],
    { simulateFailure },
  );
  if (/NONE/i.test(raw)) return null;
  const qTerms = new Set(tokenize(question));
  const overlap = (n) => new Set(tokenize(n.sentence).filter((t) => qTerms.has(t))).size;
  // The model chooses, but retrieval can veto: only the best-matching sentences are allowed.
  const minOverlap = Math.max(Math.min(2, qTerms.size), ...numbered.map(overlap));
  const reply = raw.trim().replace(/[."]+$/, '');
  const candidates = /^\d+(\s*,\s*\d+)*$/.test(reply)
    ? [...new Set(reply.split(',').map((n) => Number(n) - 1))].map((i) => numbered[i]).filter(Boolean)
    : numbered.filter((n) => reply.length >= 3 && n.sentence.toLowerCase().includes(reply.toLowerCase()));
  const picked = candidates
    .filter((n) => overlap(n) >= minOverlap)
    .slice(0, 2);
  if (picked.length === 0) return null;

  const docsUsed = [...new Set(picked.map((p) => p.doc))];
  return {
    status: 'answered',
    answerMode: 'quoted',
    answer: picked.map((p) => p.sentence).join(' '),
    sources: docsUsed.map((doc) => ({
      id: doc.id,
      title: doc.title,
      file: `docs/${doc.file}`,
      quote: picked.filter((p) => p.doc === doc).map((p) => p.sentence).join(' '),
    })),
  };
}

const MIN_GROUNDING = 0.6;

/** Share of the answer's content words that also appear in the retrieved documents. */
function groundingScore(raw, hits) {
  const contextTerms = new Set(hits.flatMap((h) => tokenize(h.doc.text)));
  const answerTerms = tokenize(raw.replace(/SOURCE\s*:.*$/gim, '').replace(/Doc\s*\d/gi, ''));
  if (answerTerms.length === 0) return 0;
  return answerTerms.filter((t) => contextTerms.has(t)).length / answerTerms.length;
}

const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|hundred|half|once|twice)\b/gi;

/** Times, durations and counts must match the documents exactly; a wrong number is the costliest mistake. */
function unsupportedNumbers(raw, hits) {
  const context = hits.map((h) => h.doc.text).join(' ').toLowerCase();
  const answer = raw.replace(/SOURCE\s*:.*$/gim, '').replace(/Doc\s*\d/gi, '');
  const found = [...(answer.match(/\d+(:\d+)?/g) ?? []), ...(answer.match(NUMBER_WORDS) ?? [])];
  return [...new Set(found.map((n) => n.toLowerCase()))].filter((n) => !new RegExp(`\\b${n}\\b`).test(context));
}

function parseModelOutput(raw, hits, model) {
  if (/NOT_FOUND/i.test(raw) || /not (available|found|included|mentioned) in the (supplied |provided )?documents/i.test(raw)) {
    return { status: 'not_found', answer: NOT_FOUND_MESSAGE, sources: [], model, rawModelOutput: raw };
  }

  const support = groundingScore(raw, hits);
  const badNumbers = unsupportedNumbers(raw, hits);
  if (support < MIN_GROUNDING || badNumbers.length > 0) {
    return {
      status: 'not_found',
      answer: NOT_FOUND_MESSAGE,
      sources: [],
      model,
      note: badNumbers.length
        ? `Model answer rejected: it states numbers not in the documents (${badNumbers.join(', ')}).`
        : `Model answer rejected: only ${Math.round(support * 100)}% of its words appear in the documents.`,
      rawModelOutput: raw,
      rejectedAsUngrounded: true,
    };
  }

  const cited = [...raw.matchAll(/Doc\s*(\d)/gi)].map((m) => `Doc ${m[1]}`);
  // Only accept citations of documents that were actually given to the model.
  let sourceHits = hits.filter((h) => cited.includes(h.doc.id));
  if (sourceHits.length === 0) sourceHits = [hits[0]];

  const answer = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*SOURCE\s*:/i.test(line))
    .join(' ')
    .replace(/\[?\(?Doc\s*\d\)?\]?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    status: 'answered',
    answerMode: 'generated',
    answer,
    sources: sourceHits.map((h) => ({ id: h.doc.id, title: h.doc.title, file: `docs/${h.doc.file}`, quote: h.evidence })),
    model,
  };
}
