# 快速上手：URL 转社媒轮播图

English version: [Quickstart Guide for URL to Social Carousel](Quickstart-URL-to-Social-Carousel.md)

本文说明如何本地运行 clawvisual，并将 URL 或长文本转换为社媒轮播内容。

## 1. 安装并启动

```bash
npm install
cp .env.local.template .env.local
npm run dev
```

默认访问地址：
- `http://localhost:3000`

## 2. 配置最小环境变量

请配置：
- `LLM_API_KEY`

`LLM_API_URL` 与 `LLM_MODEL` 已默认设置为：
- `https://openrouter.ai/api/v1/chat/completions`
- `google/gemini-3-flash-preview`

如果需要真实图片生成，还需配置：
- `GEMINI_API_KEY`
- `NANO_BANANA_MODEL`

## 3. 创建转换任务

```bash
curl -X POST http://localhost:3000/api/v1/convert \
  -H 'content-type: application/json' \
  --data '{
    "input_text": "在这里粘贴长文本或文章摘要。",
    "max_slides": 4
  }'
```

接口会返回 `job_id` 与 `status_url`。

## 4. 轮询任务状态

```bash
curl http://localhost:3000/api/v1/jobs/<job_id>
```

直到 `status` 变为 `completed` 或 `failed`。

## 5. 可选修订

可用修订能力：
- `rewrite_copy_style`
- `regenerate_cover`
- `regenerate_slides`

相关文档：
- [clawvisual 的 MCP 接入指南](MCP-Integration-Guide-for-clawvisual.zh-CN.md)
- [Agent 工作流自动化使用场景](Use-Cases-Agent-Workflow-Automation.zh-CN.md)
