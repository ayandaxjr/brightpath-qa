# BrightPath Learn — document Q&A

A small question-answering app over the three fictional BrightPath Learn documents in [`docs/`](docs).
Type a question and get an answer with the document that supports it. If the documents don't say, it says so instead of guessing.

It uses a **real language model that runs locally for free**: `Qwen2.5-0.5B-Instruct`, run inside Node.js with [Transformers.js](https://huggingface.co/docs/transformers.js). No API key and no paid provider are needed.

There are three ways to use it: a basic web page, a JSON API, and a command-line tool.

See [WALKTHROUGH.md](WALKTHROUGH.md) for what works, the test results, and what I would improve.

## Run it

Requirements: Node.js 20 or newer, and about 1 GB of free disk space for the model.

```bash
npm install
npm start          # web page + API on http://localhost:3000
```

The first start downloads the model, which is about 800 MB and only happens once. It is cached in `.model-cache/`. Wait until the terminal prints `Model ready.`

Then:

- **Web page:** open http://localhost:3000. Tick *Simulate model failure* to see the error handling.
- **API:**
  ```bash
  curl -X POST http://localhost:3000/api/ask -H "Content-Type: application/json" \
       -d '{"question":"When is the group coaching session?"}'
  ```
  Add `"simulateFailure": true` to the body to test failure. That returns HTTP 503 with a clear message.
- **Command line:**
  ```bash
  npm run ask -- "How do I save my progress?"
  npm run ask -- "How do I save my progress?" --fail     # simulated model failure
  ```

## Tests

```bash
npm test        # the 3 required scenarios (+1 extra) -> results/test-results-real-model.json
npm run eval    # 11 questions, checks the cited document AND the key fact -> results/eval-real-model.json
```

Saved results from my machine are in [`results/`](results).

## Choosing a model (environment variables)

No keys are stored in the code. Settings are read from environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `local` | `local`, `ollama`, `openai` (any OpenAI-compatible API) or `mock` |
| `LOCAL_MODEL` | `onnx-community/Qwen2.5-0.5B-Instruct` | Transformers.js model id |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `llama3.2:3b` | For a local Ollama server |
| `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` | Groq free tier / `llama-3.1-8b-instant` / none | Any OpenAI-compatible endpoint. The key comes only from the environment |
| `MODEL_TIMEOUT_MS` | `60000` | A slower response counts as "model unavailable" |
| `SIMULATE_MODEL_FAILURE` | unset | Set to `1` to force the failure path |

`LLM_PROVIDER=mock` is a **clearly labelled mock**. It repeats the best-matching document sentence and marks the answer `[MOCK]`. It shows the plumbing, not AI answer quality. Its results are saved separately in `results/test-results-mock.json`.

To see a *real* failure rather than a simulated one, point the app at an Ollama server that isn't running:

```bash
LLM_PROVIDER=ollama npm run ask -- "When are recordings added?"
# PowerShell: $env:LLM_PROVIDER='ollama'; npm run ask -- "When are recordings added?"
```

The saved output is in `results/real-failure-ollama-not-running.json`.

## How it works

```
question
  -> out-of-scope rule (pricing / refunds / job placement -> "not in the documents", per Doc 3)
  -> keyword retrieval over document sentences (src/retrieve.js); no match -> "not in the documents"
  -> LLM answers using ONLY the retrieved documents, or replies NOT_FOUND (src/qa.js, src/llm.js)
  -> grounding checks on the answer:
       - at least 60% of its words must appear in the documents
       - every number or time in it must appear in the documents
     if a check fails -> ask the model to pick supporting sentences and quote them word for word,
                         or answer "not in the documents"
  -> answer + source document + the quoted supporting sentence
```

Files:

- `src/retrieve.js` loads the documents and scores sentences by keyword overlap
- `src/llm.js` handles model providers, the timeout, and turning any failure into `ModelUnavailableError`
- `src/qa.js` contains the prompt, the grounding checks, citations and the fallback
- `src/server.js` is the HTTP server (no framework)
- `public/index.html` is the web page
- `src/cli.js` is the command-line tool
- `tests/run-tests.js` runs the required scenarios
- `tests/eval.js` runs the wider evaluation
