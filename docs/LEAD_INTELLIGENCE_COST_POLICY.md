# Lead Intelligence Cost Policy

The production Lead Intelligence workflow must stay in economy mode unless explicitly redesigned and approved.

Hard server-side limits:
- model: gpt-5.6-luna
- reasoning effort: none
- web search context: low
- maximum built-in tool calls: 3
- maximum suggested prospects: 5
- default suggested prospects: 3
- maximum output tokens: 2200
- legacy synchronous research endpoint cannot initiate OpenAI work

The UI may not override these limits. Running jobs are resumed instead of duplicated.
