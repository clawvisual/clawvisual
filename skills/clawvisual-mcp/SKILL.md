# clawvisual MCP Skill

Use this skill to call a deployed clawvisual service through its MCP JSON-RPC endpoint.

## Purpose

Provide reusable operations for:
- Long-text to short carousel conversion
- Job status polling
- Revision requests
- Cover regeneration

This skill is designed for external agents/workflows that want to treat clawvisual as a callable capability.

## Prerequisites

Set environment variables:

- `CLAWVISUAL_MCP_URL` (default: `http://localhost:3000/api/mcp`)
- `CLAWVISUAL_API_KEY` (required when API key validation is enabled)

## CLI Entrypoint

Script path:

`skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs`

Recommended command:

`npm run skill:clawvisual -- <command> [flags]`

## Commands

### 1. Initialize

```bash
npm run skill:clawvisual -- initialize
```

### 2. List tools

```bash
npm run skill:clawvisual -- tools
```

### 3. Convert

```bash
npm run skill:clawvisual -- convert \
  --input "Paste long text or URL here" \
  --lang zh-CN \
  --slides 8 \
  --review required
```

### 4. Job status

```bash
npm run skill:clawvisual -- status --job <job_id>
```

### 5. Revise

```bash
npm run skill:clawvisual -- revise \
  --job <job_id> \
  --intent rewrite_copy_style \
  --instruction "Make tone sharper and reduce fluff"
```

### 6. Regenerate cover

By existing job:

```bash
npm run skill:clawvisual -- regenerate-cover \
  --job <job_id> \
  --instruction "Stronger first-glance hook"
```

By direct prompt:

```bash
npm run skill:clawvisual -- regenerate-cover \
  --prompt "Dramatic split-screen contrast, bold focal subject, high readability"
```

### 7. Generic tool call

```bash
npm run skill:clawvisual -- call \
  --name convert \
  --args '{"input_text":"...","output_language":"en-US"}'
```

## Workflow Pattern

Typical automation loop:

1. `convert`
2. Poll `status` until `completed|failed`
3. Optional `revise` / `regenerate-cover`
4. Poll revised job `status`

## Output

The client prints structured JSON to stdout so upstream workflows can parse deterministically.
