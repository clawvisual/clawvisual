# MCP Integration Guide for clawvisual

中文版本: [clawvisual 的 MCP 接入指南](MCP-Integration-Guide-for-clawvisual.zh-CN.md)

This guide explains how to connect clawvisual to agent systems through MCP.

## MCP endpoint

- URL: `POST /api/mcp`
- Methods:
  - `initialize`
  - `tools/list`
  - `tools/call`

## Available tools

- `convert`
- `job_status`
- `revise`
- `regenerate_cover`

## Local MCP smoke test

List tools:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call `convert`:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  --data '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"convert",
      "arguments":{
        "input_text":"Long-form text for conversion.",
        "max_slides":4
      }
    }
  }'
```

## OpenClaw skill integration

Use:
- `skills/clawvisual/SKILL.md`
- `skills/clawvisual/scripts/clawvisual-client.mjs`

Set:
- `CLAWVISUAL_MCP_URL`
- `CLAWVISUAL_API_KEY` (if API key validation is enabled)

Related docs:
- [Quickstart Guide for URL to Social Carousel](Quickstart-URL-to-Social-Carousel.md)
- [Use Cases for Agent Workflow Automation](Use-Cases-Agent-Workflow-Automation.md)
