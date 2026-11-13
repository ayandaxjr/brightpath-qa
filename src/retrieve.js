import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');

const STOPWORDS = new Set(`a an the and or but if of to in on at for by with from as is are was were be been
do does did can could should would will i me my we our you your it its this that these those what when where
which who whom how why there here not no so than then too very just about into after before get got have has
had any all some up out over brightpath learn platform fictional document`.split(/\s+/));

// Maps everyday words onto the wording used in the documents.
const SYNONYMS = {
  price: 'pricing', cost: 'pricing', fee: 'pricing', pay: 'pricing', payment: 'pricing', subscription: 'pricing',
  money: 'refund', cancel: 'refund', job: 'placement', employment: 'placement', hire: 'placement',
  login: 'sign', log: 'sign', signin: 'sign', forgot: 'password', reset: 'password',
  call: 'session', meeting: 'session', live: 'session', webinar: 'session', coach: 'coaching',
  recording: 'recording', replay: 'recording', video: 'video', progress: 'progress', complete: 'complete',
  help: 'support', contact: 'support', email: 'support', review: 'feedback', module: 'lesson', class: 'lesson',
  wrong: 'incorrect', broken: 'incorrect', missing: 'missing', lost: 'missing', begin: 'start', first: 'start', next: 'next',
};

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@.:\s-]/g, ' ')
    .split(/[\s.:-]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem)
    .map((w) => SYNONYMS[w] ?? w);
}

function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function loadDocuments(dir = DOCS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file, i) => {
      const text = readFileSync(join(dir, file), 'utf8').trim();
      const [titleLine, ...rest] = text.split(/\r?\n/);
      const title = titleLine.replace(/^#\s*/, '');
      const sentences = rest
        .join(' ')
        .split(/(?<=\.)\s+/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('Platform:'));
      return { id: `Doc ${i + 1}`, file, title, text, sentences };
    });
}

/**
 * Scores every sentence by how many question terms it shares, then ranks documents
 * by their best sentence. Returns [] when nothing in the documents overlaps the question.
 */
export function retrieve(question, docs, { maxDocs = 2 } = {}) {
  const qTerms = new Set(tokenize(question));
  if (qTerms.size === 0) return [];

  const ranked = docs
    .map((doc) => {
      const titleTerms = new Set(tokenize(doc.title));
      const scored = doc.sentences.map((sentence) => {
        const sTerms = new Set(tokenize(sentence));
        let score = 0;
        for (const t of qTerms) if (sTerms.has(t)) score += 1;
        return { sentence, score };
      });
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { score: 0 });
      let titleBonus = 0;
      for (const t of qTerms) if (titleTerms.has(t)) titleBonus += 0.5;
      return { doc, score: best.score + titleBonus, evidence: best.score > 0 ? best.sentence : null };
    })
    .filter((r) => r.evidence)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, maxDocs);
}
