# clawvisual AI

中文文档: [README.zh-CN.md](README.zh-CN.md)

clawvisual AI is an agent-skill pipeline that converts long-form text into short-form carousel/infographic content.

Default output constraints (fast mode):
- `post_title`: one-sentence hook.
- `post_caption`: concise body, normalized to 100-300 characters.
- `hashtags`: 1-5 tags.
- `slides`: generated visual slides are required (not text-only output).
  - each slide should include `image_url` and `visual_prompt`
  - cover slide (`slide_id: 1`) must prioritize first-glance clarity and hook strength

## Screenshots

<p>
  <img src="screenshots/start.png" alt="start" width="24%" />
  <img src="screenshots/thinking.png" alt="thinking" width="24%" />
  <img src="screenshots/control.png" alt="control" width="24%" />
  <img src="screenshots/res.png" alt="res" width="24%" />
</p>

## Quick Start (Web)

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.local.template .env.local
```

3. Fill required keys in `.env.local` at least:
- `LLM_API_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

Important local-dev note:
- `.env.local.template` now leaves `CLAWVISUAL_API_KEYS` empty by default.
- Local requests do not require `x-api-key` unless you explicitly configure `CLAWVISUAL_API_KEYS`.
- If you enable API-key validation, send the same configured value in the `x-api-key` header.
- For real image generation instead of fallback gradients/SVGs, also set a valid `GEMINI_API_KEY` and `NANO_BANANA_MODEL`.
- If `LLM_COPY_POLISH_MODEL` is unavailable on your provider, the copy-polish stage may be skipped.

4. Start dev server:

```bash
npm run dev
```

5. Open in browser:
- `http://localhost:3000`

If `3000` is already occupied, Next.js will move to another port such as `3001`. Use the actual port shown in the terminal.

## Quick Smoke Test

After `npm run dev`, confirm the service is healthy before testing the full UI.

1. Open OpenAPI:

```bash
curl http://localhost:3000/api/openapi.json
```

2. List MCP tools:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

3. Create a conversion job:

```bash
curl -X POST http://localhost:3000/api/v1/convert \
  -H 'content-type: application/json' \
  --data '{
    "input_text": "Open source projects grow faster when onboarding is simple and the value is visible on first use.",
    "max_slides": 4
  }'
```

4. Poll the returned `status_url` until `status` becomes `completed` or `failed`.

Expected first-run behavior:
- The job should be accepted immediately and return `202`.
- In `fast` mode, several quality stages are intentionally reported as `skipped:fast_mode`.
- Without fully working external model/image credentials, some quality/image steps may degrade or fall back.
- Leaving `NANO_BANANA_MODEL` as the template placeholder can trigger image-generation retries and fallback placeholder outputs.

## OpenClaw Integration (as a Skill)

clawvisual can be integrated into OpenClaw as a workspace/local skill via MCP.

1. Run clawvisual service:

```bash
npm install
cp .env.local.template .env.local
npm run dev
```

2. Install this skill into OpenClaw:
- copy [skills/clawvisual-mcp](skills/clawvisual-mcp) to either:
  - `<openclaw-workspace>/skills/clawvisual-mcp` (workspace scope), or
  - `~/.openclaw/skills/clawvisual-mcp` (shared local scope)

3. Configure skill runtime env:

```bash
CLAWVISUAL_MCP_URL=http://localhost:3000/api/mcp
CLAWVISUAL_API_KEY=<your_clawvisual_api_key_if_enabled>
```

If the dev server starts on `3001` or another port, update `CLAWVISUAL_MCP_URL` accordingly.

If you explicitly configure `CLAWVISUAL_API_KEYS`, set `CLAWVISUAL_API_KEY` to one of those accepted values.

4. Test the skill client locally:

```bash
npm run skill:clawvisual -- tools
```

## Implemented Architecture (V1 Scaffold)

- Framework: Next.js App Router + TypeScript
- API:
  - `POST /api/v1/convert` starts a 16-skill chain and returns `job_id`
  - `GET /api/v1/jobs/:id` returns status/progress/result
  - `POST /api/mcp` JSON-RPC MCP endpoint (`initialize`, `tools/list`, `tools/call`)
  - `GET /api/openapi.json` exports OpenAPI schema
- Skill system: `src/lib/skills` contains 16 atomic async skills
- Prompt templates: `src/lib/prompts/index.ts`
- Orchestration: `src/lib/orchestrator.ts`
- Queue:
  - Local in-memory job queue for immediate development
- API key validation: `src/lib/auth/api-key.ts`

## Directory Layout

- `src/app/page.tsx`: clawvisual dashboard UI
- `src/app/api/v1/convert/route.ts`: conversion entrypoint
- `src/app/api/v1/jobs/[id]/route.ts`: job status endpoint
- `src/app/api/openapi.json/route.ts`: OpenAPI export
- `src/lib/types`: standard interfaces and context object
- `src/lib/skills`: 16 atomic skill modules

## Environment Variables

Existing keys are reusable. Current scaffold reads:

- `LLM_API_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS` (optional, default `25000`)
- `LLM_COPY_FALLBACK_MODEL` (optional, default `google/gemini-2.5-flash`)
- `LLM_COPY_POLISH_MODEL` (optional, default `openai/gpt-5.1-mini`)
- `GEMINI_API_KEY`
- `NANO_BANANA_MODEL`
- `NANO_BANANA_TIMEOUT_MS` (optional, default `60000`)
- `NANO_BANANA_TRANSIENT_RETRY_MAX` (optional, default `2`)
- `NANO_BANANA_RETRY_BASE_DELAY_MS` (optional, default `450`)
- `QUALITY_LOOP_ENABLED` (optional, default `true`)
- `QUALITY_AUDIT_THRESHOLD` (optional, default `78`)
- `QUALITY_IMAGE_COVER_THRESHOLD` (optional, default `85`)
- `QUALITY_IMAGE_INNER_THRESHOLD` (optional, default `78`)
- `QUALITY_COVER_FIRST_GLANCE_THRESHOLD` (optional, default `82`)
- `QUALITY_COVER_NOVELTY_THRESHOLD` (optional, default `80`)
- `QUALITY_COVER_CANDIDATE_COUNT` (optional, default `1`)
- `QUALITY_MAX_COPY_ROUNDS` (optional, default `1`)
- `QUALITY_MAX_IMAGE_ROUNDS` (optional, default `0`)
- `QUALITY_MAX_EXTRA_IMAGES` (optional, default `1`)
- `QUALITY_IMAGE_LOOP_MAX_MS` (optional, default `120000`)
- `QUALITY_IMAGE_AUDIT_SCOPE` (optional, `cover` or `all`, default `cover`)
- `PIPELINE_MODE` (optional, `fast` or `full`, default `fast`)
- `PIPELINE_MAX_DURATION_MS` (optional, default `300000`)
- `PIPELINE_ENABLE_SOURCE_INTEL` (optional, default `false` in fast mode)
- `PIPELINE_ENABLE_STORYBOARD_QUALITY` (optional, default `false` in fast mode)
- `PIPELINE_ENABLE_STYLE_RECOMMENDER` (optional, default `false` in fast mode)
- `PIPELINE_ENABLE_ATTENTION_FIXER` (optional, default `false` in fast mode)
- `PIPELINE_ENABLE_POST_COPY_QUALITY` (optional, default `false` in fast mode)
- `PIPELINE_ENABLE_FINAL_AUDIT` (optional, default `false` in fast mode)

Runtime observability:
- Thinking & Actions event timeline now includes per-step token usage deltas (`in/out/total`) when provider `usage` is returned.
- Final `skill_logs` includes `llm_usage_summary` for total request-level token aggregation.
- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`
- `SERPER_API_KEY`
- `JINA_API_KEY`

API security controls:

- `CLAWVISUAL_API_KEYS` comma-separated accepted keys
- `CLAWVISUAL_ALLOW_NO_KEY` default `true` in local development

## Notes

- This project includes async conversion pipeline + revision engine + MCP-compatible JSON-RPC endpoint.
- Real integrations (Flux/Midjourney, Redis/BullMQ worker process, PostgreSQL persistence, satori rendering) are left as plug-in points.

## MCP Tools

`POST /api/mcp` supports:

- `convert`: create conversion job
- `job_status`: fetch current job status/result
- `revise`: create revision job for copy/image changes
- `regenerate_cover`: regenerate cover via job revision or direct prompt image call

## Skill Template

Reusable external skill package:

- [skills/clawvisual-mcp/SKILL.md](skills/clawvisual-mcp/SKILL.md)
- [skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs](skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs)

Convenience command:

- `npm run skill:clawvisual -- tools`

## Common Local Issues

- `Missing x-api-key`
  - Cause: API-key validation was explicitly enabled by setting `CLAWVISUAL_API_KEYS`.
  - Fix: send `x-api-key`, or clear `CLAWVISUAL_API_KEYS` for local no-auth mode.

- MCP client points to the wrong service
  - Cause: `npm run dev` switched to `3001`, but the client default is still `http://localhost:3000/api/mcp`.
  - Fix: set `CLAWVISUAL_MCP_URL` to the real local port.

- Next.js workspace-root warning during `dev` or `build`
  - Cause: another lockfile exists above this repo, so Next.js infers a higher workspace root.
  - Fix: set `turbopack.root` in `next.config.ts` or remove the unrelated parent lockfile.
