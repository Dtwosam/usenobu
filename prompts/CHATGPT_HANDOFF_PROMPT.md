# ChatGPT Project Handoff Prompt

Use this after uploading the Nobu sources into a ChatGPT Project:

> Treat the uploaded Nobu source pack as the governing project context. Read `START-HERE.md`, `docs/nobu-clean-master-spec.md`, `docs/nobu-current-state.md`, and `docs/nobu-build-order.md` first. Confirm the active lane and summarize the non-negotiable product/data locks. For any dynamic OKX, Target, or SerpApi fact, verify the current official source before making a decision. Do not expand scope, invent live proof, or call third-party observed pricing an official Target API price. Then prepare the next Grok Build lane prompt using `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`. Keep it concise, lane-scoped, phone-friendly, and explicit about mandatory files, hard locks, tests, proof, final report, and stopping on first failure. Regular Grok research does not implement product code and does not override official sources.
