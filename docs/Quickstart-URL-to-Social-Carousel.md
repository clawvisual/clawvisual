# Quickstart Guide for URL to Social Carousel

中文版本: [快速上手：URL 转社媒轮播图](Quickstart-URL-to-Social-Carousel.zh-CN.md)

This guide shows how to run clawvisual locally and generate a social carousel from a URL or long-form text.

## 1. Install and run

```bash
npm install
cp .env.local.template .env.local
npm run dev
```

Default app URL:
- `http://localhost:3000`

## 2. Set minimum environment variables

At least configure:
- `LLM_API_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

For real image generation, also set:
- `GEMINI_API_KEY`
- `NANO_BANANA_MODEL`

## 3. Create a conversion job

```bash
curl -X POST http://localhost:3000/api/v1/convert \
  -H 'content-type: application/json' \
  --data '{
    "input_text": "Paste a long text or article summary here.",
    "max_slides": 4
  }'
```

The API returns `job_id` and `status_url`.

## 4. Poll job status

```bash
curl http://localhost:3000/api/v1/jobs/<job_id>
```

Wait until `status` is `completed` or `failed`.

## 5. Optional revision

Use revision APIs to refine output:
- `rewrite_copy_style`
- `regenerate_cover`
- `regenerate_slides`

Related docs:
- [MCP Integration Guide for clawvisual](MCP-Integration-Guide-for-clawvisual.md)
- [Use Cases for Agent Workflow Automation](Use-Cases-Agent-Workflow-Automation.md)
