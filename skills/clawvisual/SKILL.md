---
name: clawvisual
description: URL or long-form text to social carousel generator via local CLI + MCP endpoint.
metadata: {"openclaw":{"emoji":"🖼️","requires":{"bins":["clawvisual"],"env":["CLAWVISUAL_LLM_API_KEY","CLAWVISUAL_LLM_API_URL","CLAWVISUAL_LLM_MODEL","CLAWVISUAL_GEMINI_API_KEY","CLAWVISUAL_MCP_URL","CLAWVISUAL_API_KEY"],"files":["~/.clawvisual/config.json","~/.clawvisual/service.json"]},"install":[{"id":"npm","kind":"npm","package":"clawvisual","bins":["clawvisual"],"label":"Install clawvisual (npm)"}],"runtime":{"starts_local_service":true,"local_service_endpoint":"http://127.0.0.1:<port>/api/mcp","external_network":["https://openrouter.ai","https://*.googleapis.com","https://registry.npmjs.org"]}}}
---

# clawvisual

URL or long-form text to social carousel generator. It runs a local MCP service and can be invoked by AI agents.

## Quick start

```bash
npm install -g clawvisual
clawvisual set CLAWVISUAL_LLM_API_KEY "your_openrouter_key"
clawvisual set CLAWVISUAL_LLM_API_URL "https://openrouter.ai/api/v1/chat/completions"
clawvisual initialize
clawvisual convert --input "https://example.com/article" --slides auto
clawvisual status --job <job_id>
```

For local repo usage:

```bash
npm run skill:clawvisual -- initialize
```

## What it does

- Convert URL or long-form text into social carousel output (images + copy).
- Provide async workflow (`convert` -> `status --job`).
- Support revision operations (`revise`, `regenerate-cover`).
- Expose MCP JSON-RPC tools for OpenClaw and other agent runtimes.

## Service management

- Start service: `clawvisual initialize`
- Stop service: `clawvisual stop`
- Restart service: `clawvisual restart`
- Check identity/status: `clawvisual status`

Service endpoints (default):

- Web UI: `http://localhost:3000`
- MCP API: `http://localhost:3000/api/mcp`

Health checks:

```bash
clawvisual status
curl -s http://localhost:3000/api/openapi.json
```

## Commands

- `clawvisual initialize`: start/probe local service and print Web URL.
- `clawvisual status`: check service identity (must be `clawvisual`).
- `clawvisual tools`: list MCP tools.
- `clawvisual convert --input <text_or_url> [--slides auto|1-8] [--ratio 4:5|1:1|9:16|16:9] [--lang <code>]`
- `clawvisual status --job <job_id>`: query job status and result.
- `clawvisual revise --job <job_id> --instruction <text> [--intent rewrite_copy_style|regenerate_cover|regenerate_slides]`
- `clawvisual regenerate-cover (--job <job_id> [--instruction <text>] | --prompt <text>) [--ratio 4:5|1:1|9:16|16:9]`
- `clawvisual call --name <tool_name> --args <json>`: raw tool call.

## Config

Optional local config file:

- `~/.clawvisual/config.json`

Manage config:

```bash
clawvisual set CLAWVISUAL_LLM_API_KEY "your_key"
clawvisual set CLAWVISUAL_LLM_API_URL "https://openrouter.ai/api/v1/chat/completions"
clawvisual get CLAWVISUAL_LLM_API_KEY
clawvisual config
clawvisual unset CLAWVISUAL_LLM_API_KEY
```

Supported keys:

- `CLAWVISUAL_LLM_API_KEY` (alias: `LLM_API_KEY`)
- `CLAWVISUAL_LLM_API_URL` (alias: `LLM_API_URL`)
- `CLAWVISUAL_LLM_MODEL` (alias: `LLM_MODEL`)
- `CLAWVISUAL_GEMINI_API_KEY` (alias: `GEMINI_API_KEY`)
- `CLAWVISUAL_MCP_URL` (alias: `MCP_URL`)
- `CLAWVISUAL_API_KEY`

Runtime mapping:

- `CLAWVISUAL_LLM_*` -> `LLM_*`
- `CLAWVISUAL_GEMINI_API_KEY` -> `GEMINI_API_KEY`

## Workflow pattern

1. `clawvisual initialize`
2. `clawvisual convert --input "<url_or_text>" --slides auto`
3. Poll `clawvisual status --job <job_id>` until `status: completed`
4. Optional: `revise` / `regenerate-cover`
5. Poll revised job via `status --job`

## Response field paths

For `clawvisual status --job <job_id>`, key result paths:

- `.payload.result.structuredContent.result.post_title`
- `.payload.result.structuredContent.result.post_caption`
- `.payload.result.structuredContent.result.hashtags[]`
- `.payload.result.structuredContent.result.slides[]`
- `.payload.result.structuredContent.result.slides[].image_url`
- `.payload.result.structuredContent.result.slides[].content_quote`

Example with `jq`:

```bash
clawvisual status --job "$job_id" > /tmp/job_result.json
title=$(jq -r '.payload.result.structuredContent.result.post_title' /tmp/job_result.json)
caption=$(jq -r '.payload.result.structuredContent.result.post_caption' /tmp/job_result.json)
hashtags=$(jq -r '.payload.result.structuredContent.result.hashtags[]' /tmp/job_result.json | tr '\n' ' ')
```

## MCP API direct call

```bash
curl -s http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
