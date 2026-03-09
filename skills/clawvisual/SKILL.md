---
name: clawvisual
description: URL or long-form text to social carousel generator via local CLI + MCP endpoint.
metadata: {"clawdbot":{"emoji":"🖼️","requires":{"bins":["clawvisual"]},"install":[{"id":"npm","kind":"npm","package":"clawvisual","bins":["clawvisual"],"label":"Install clawvisual (npm)"}]}}
---

# clawvisual

Use clawvisual as a callable skill for agent workflows. It can auto-start a local web/MCP service and expose stable CLI commands for generation and job polling.

## Quick start

```bash
npm install -g clawvisual
clawvisual set CLAWVISUAL_LLM_API_KEY "your_openrouter_key"
clawvisual initialize
clawvisual convert --input "https://example.com/article" --slides auto
clawvisual status --job <job_id>
```

For local repo usage, you can also run:

```bash
npm run skill:clawvisual -- initialize
```

## What it does

- Convert URL or direct long-form text into social carousel output.
- Provide job-based async workflow (`convert` -> `status --job`).
- Support revision operations (`revise`, `regenerate-cover`).
- Expose MCP JSON-RPC tools for OpenClaw and other agent runtimes.

## Commands

- `clawvisual initialize`: probe/start local service and print Web URL.
- `clawvisual status`: check service identity (must be `clawvisual`).
- `clawvisual tools`: list MCP tools.
- `clawvisual convert --input <text_or_url> [--slides auto|1-8] [--ratio 4:5|1:1|9:16|16:9] [--lang <code>]`
- `clawvisual status --job <job_id>`: query job state and result.
- `clawvisual revise --job <job_id> --instruction <text> [--intent rewrite_copy_style|regenerate_cover|regenerate_slides]`
- `clawvisual regenerate-cover (--job <job_id> [--instruction <text>] | --prompt <text>) [--ratio 4:5|1:1|9:16|16:9]`
- `clawvisual call --name <tool_name> --args <json>`: raw tool invocation.

## Config

Optional local config file:

- `~/.clawvisual/config.json`

Manage config with CLI:

```bash
clawvisual set CLAWVISUAL_LLM_API_KEY "your_key"
clawvisual get CLAWVISUAL_LLM_API_KEY
clawvisual config
clawvisual unset CLAWVISUAL_LLM_API_KEY
```

Supported keys:

- `CLAWVISUAL_LLM_API_KEY` (alias: `LLM_API_KEY`)
- `CLAWVISUAL_LLM_API_URL` (alias: `LLM_API_URL`)
- `CLAWVISUAL_LLM_MODEL` (alias: `LLM_MODEL`)
- `CLAWVISUAL_MCP_URL` (alias: `MCP_URL`)
- `CLAWVISUAL_API_KEY`

When auto-starting local service, `CLAWVISUAL_LLM_*` values are mapped to runtime `LLM_*` envs.

## Workflow pattern

1. `initialize`
2. `convert`
3. Poll `status --job <job_id>` until completion
4. Optional `revise` / `regenerate-cover`
5. Poll revised job with `status --job`

## Output contract

All commands return JSON to stdout for deterministic parsing by upstream agents.
