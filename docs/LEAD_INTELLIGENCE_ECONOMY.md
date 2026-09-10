# Lead Intelligence Economy Mode

Lead Intelligence is intentionally cost-capped for routine prospect research.

Production defaults:

- Model: `gpt-5.6-luna`
- Reasoning effort: `none`
- Web search context: `low`
- Maximum built-in tool calls: 3
- Maximum prospects per run: 5
- Default prospects per run: 3
- Maximum output tokens: 2,200
- Legacy synchronous OpenAI research route: disabled

These are server-side safeguards. The browser cannot request a more expensive model or raise the search/token caps. An existing running research job is resumed rather than duplicated.

The caps reduce spend substantially but do not create an exact dollar guarantee because OpenAI billing can include model tokens and web-search usage. Check the OpenAI usage dashboard for actual billed cost.
