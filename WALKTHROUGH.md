# Walkthrough

## What works

- A web page, a JSON API (`POST /api/ask`) and a command-line tool all use the same answering code.
- Answers come only from the three supplied documents. Each answer shows the supporting document (`Doc 1`, `Doc 2` or `Doc 3`) and the exact sentence it relies on.
- When the documents don't contain the answer, the app says so and refers the member to support. For pricing, refunds and job placement this happens without calling the model, because Document 3 explicitly says those topics are not covered.
- A real, free, local language model is used: Qwen2.5-0.5B-Instruct via Transformers.js. No API key is needed. Ollama or any OpenAI-compatible API can be swapped in with environment variables, so no key is ever in the code.
- Model failures (provider down, timeout, bad response, missing key) all become one clear message: *"The AI model is unavailable right now, so no answer was generated."* The API returns HTTP 503, and the app still lists the documents that look relevant. The failure can be triggered on purpose with a checkbox, the `--fail` flag, `"simulateFailure": true`, or `SIMULATE_MODEL_FAILURE=1`.
- Answers made up by the model are caught in code, not just discouraged in the prompt. See the notes on result 2 below.

## The three test results

These come from `npm test` with the real local model. The full output is in `results/test-results-real-model.json`.

| # | Question | Result |
|---|---|---|
| 1 | **Answered by the documents:** "When is the group coaching session?" | *"The group coaching session takes place every Tuesday from 16:00 UTC."* The source is **Doc 2**, quoting "A group coaching session takes place every Tuesday at 16:00 UTC." (about 6 seconds on a laptop CPU) |
| 2 | **Not answered by the documents:** "How much does the Foundations course cost, and can I get a refund?" | *"I could not find this in the supplied BrightPath documents, so I will not guess. Please contact support@brightpath.example…"* The model was not called, because Doc 3 rules these topics out of scope. |
| 3 | **API failure:** "How do I reset my password?" with failure simulated | *"The AI model is unavailable right now, so no answer was generated. Please try again in a few minutes."* The API returns HTTP 503 and lists Doc 3 as relevant. A real failure (Ollama not running) gives the same message with the detail `fetch failed`, saved in `results/real-failure-ollama-not-running.json`. |

**Extra test, the harder "not answered" case:** "Can I download the lesson videos to watch offline?" This shares words with Doc 1 ("lesson", "video", "watch"), so keyword search finds Doc 1 and the model *does* get called. The 0.5B model invented download instructions. My grounding check rejected the answer because it contained facts and numbers not in the documents, so the user got "not in the documents" instead. This is the most important result: **prompting alone did not stop the small model from making things up, and the code checks did.**

**Wider evaluation** (`npm run eval`, 11 questions, each checked for both the right document and the key fact): **9 of 11 passed.** Neither miss gave the member wrong information:

- *"When is the group coaching session and where do I find the link?"* got the time right but left out the "30 minutes before" part. In an earlier run the model said "three hours before", which is wrong. The number check now rejects that answer and falls back to quoting the documents.
- *"My lesson progress is wrong, who do I contact?"* returned "not in the documents, contact support@brightpath.example". That is safe but less helpful than quoting the Doc 3 sentence.

## What I built, and the tools used

Built with **Cursor's AI agent (Claude)** as the coding assistant, plus Node.js 22 and Transformers.js. No other libraries: the HTTP server, keyword retrieval and tests are plain Node.

The design and behaviour, and the parts I can explain in an interview:

- **Keyword retrieval** with a small synonym map (for example "cost" maps to "pricing" and "wrong" to "incorrect"). The documents are tiny, so embeddings would add a dependency without a clear benefit.
- **A provider layer** where every failure becomes one error type with a timeout, so the user-facing message is always the same and always clear.
- **Grounding checks after the model answers:** a word-overlap ratio, and an exact-match check for numbers and times. I added these after the tests showed the model inventing details.
- **A fallback where the model picks sentences and the app quotes them word for word.** Keyword retrieval can veto weak picks. I added the veto after the evaluation showed the model picking irrelevant sentences.
- **Tests that check facts, not just status codes.** An early version of test 1 "passed" while the answer said "three hours" instead of "30 minutes". I tightened the tests to check the actual facts.
- I tried the larger Qwen2.5-1.5B model, but it ran out of memory on this laptop. That's why the default is 0.5B.

## What I would improve

**Use a stronger model and measure it properly.** The 0.5B model is the main weakness: it adds made-up detail, and the safety checks then turn some good answers into "not found". I would run the same `npm run eval` set against a 3B–8B model (for example `LLM_PROVIDER=ollama` with `llama3.2:3b`, or a free Groq model via `LLM_PROVIDER=openai`). I would grow the set to 30–50 questions, including paraphrases and two-part questions, and track two numbers separately:

- **Answer rate:** how often an answerable question gets a correct answer.
- **Unsupported-claim rate:** how often an answer contains something the documents don't say.

The grounding checks keep the second number near zero. A better model should raise the first without lowering the second.

## Not done (kept small on purpose)

No hosting, sign-in, database or polished design, as the brief allowed. The model runs on the CPU, so the first answer after starting takes a few seconds, and model download/loading is excluded from the per-question timeout.
