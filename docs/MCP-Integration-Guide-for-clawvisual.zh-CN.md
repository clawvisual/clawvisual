# clawvisual 的 MCP 接入指南

English version: [MCP Integration Guide for clawvisual](MCP-Integration-Guide-for-clawvisual.md)

本文说明如何通过 MCP 将 clawvisual 接入到 agent 系统。

## MCP 端点

- URL：`POST /api/mcp`
- 方法：
  - `initialize`
  - `tools/list`
  - `tools/call`

## 可用工具

- `convert`
- `job_status`
- `revise`
- `regenerate_cover`

## 本地 MCP 冒烟测试

列出工具：

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

调用 `convert`：

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
        "input_text":"用于转换的长文本内容。",
        "max_slides":4
      }
    }
  }'
```

## OpenClaw Skill 接入

使用：
- `skills/clawvisual-mcp/SKILL.md`
- `skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs`

配置：
- `CLAWVISUAL_MCP_URL`
- `CLAWVISUAL_API_KEY`（如启用 API Key 校验）

相关文档：
- [快速上手：URL 转社媒轮播图](Quickstart-URL-to-Social-Carousel.zh-CN.md)
- [Agent 工作流自动化使用场景](Use-Cases-Agent-Workflow-Automation.zh-CN.md)
