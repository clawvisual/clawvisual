# clawvisual AI

clawvisual AI 是一个 Agent + Skills 流水线，用来把长文章或 URL 直接转换成适合社媒传播的轮播图 / 信息图内容。

它不仅能生成标题、caption 和 hashtags，还会给出真正可用的 slide 文案、视觉 prompt、图片结果，并且可以通过 MCP 被其他 agent 调用。

<p>
  <img src="screenshots/readme-ui-thread.png" alt="clawvisual 结果页 UI" width="100%" />
</p>

## 为什么它更适合做传播内容

- 直接吃 URL 或长文本，输出可发布的 carousel 结构
- 不是只做摘要，而是真的生成 slide 图片和视觉 prompt
- 有异步任务、进度事件、修订能力和下载输出
- 提供 MCP 端点，可以作为其他 agent 的工具能力

默认输出约束（fast 模式）：
- `post_title`：一句话标题钩子
- `post_caption`：精简正文，标准化为 100-300 字符
- `hashtags`：1-5 个标签
- `slides`：必须生成可用图片页（不是纯文案输出）
  - 每页需包含 `image_url` 与 `visual_prompt`
  - 封面页（`slide_id: 1`）优先保证第一眼识别度与钩子强度

## 真实示例

本地实测 URL：
- [How to Fix Your Entire Life in 1 Year](https://letters.thedankoe.com/p/how-to-fix-your-entire-life-in-1)

生成输出（`output_language: zh-CN`，`max_slides: 8`）：

```json
{
  "post_title": "为什么你年年立Flag，年年都打脸？",
  "post_caption": "90%的新年计划都会失败，因为你只是在玩一场“给别人看”的地位游戏。真正的改变，从来不是靠意志力死撑，而是源于深层的自我重构。当你对现状的厌恶超过了对未知的恐惧，改变才会真正发生。",
  "hashtags": ["#自律", "#AI", "#Productivity", "#ContentStrategy", "#Marketing"]
}
```

生成 slide 预览：

<p>
  <img src="screenshots/readme-cover.png" alt="生成的封面 slide" width="49%" />
  <img src="screenshots/readme-slide-2.png" alt="生成的第二张 slide" width="49%" />
</p>

## 本地启动（Web）

1. 安装依赖：

```bash
npm install
```

2. 创建本地环境变量文件：

```bash
cp .env.local.template .env.local
```

3. 至少补齐 `.env.local` 中这 3 项：
- `LLM_API_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

本地开发的重要说明：
- `.env.local.template` 现在默认把 `CLAWVISUAL_API_KEYS` 留空
- 本地请求默认不需要 `x-api-key`，只有你显式配置了 `CLAWVISUAL_API_KEYS` 才需要带
- 如果你启用了 API Key 校验，请在 `x-api-key` 里传入同一个已配置值
- 如果你想测试真实图片生成，而不是占位渐变图/SVG，还需要设置可用的 `GEMINI_API_KEY` 和 `NANO_BANANA_MODEL`
- 如果当前 provider 不支持 `LLM_COPY_POLISH_MODEL`，文案 polish 阶段可能会被跳过

4. 启动开发服务器：

```bash
npm run dev
```

5. 浏览器访问：
- `http://localhost:3000`

如果 `3000` 已被占用，Next.js 会自动切到别的端口，比如 `3001`。请以终端里实际显示的端口为准。

## 最小冒烟测试

执行 `npm run dev` 之后，建议先确认服务健康，再测试完整 UI 流程。

1. 打开 OpenAPI：

```bash
curl http://localhost:3000/api/openapi.json
```

2. 列出 MCP tools：

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

3. 创建一个转换任务：

```bash
curl -X POST http://localhost:3000/api/v1/convert \
  -H 'content-type: application/json' \
  --data '{
    "input_text": "Open source projects grow faster when onboarding is simple and the value is visible on first use.",
    "max_slides": 4
  }'
```

4. 持续轮询返回的 `status_url`，直到 `status` 变成 `completed` 或 `failed`

首次运行时的预期行为：
- 接口会先快速返回 `202`，任务异步执行
- 在 `fast` 模式下，一些质量环节显示 `skipped:fast_mode` 是正常行为
- 如果外部模型或图片能力没有完整配置，部分质量或图片步骤可能退化或走回退路径
- 如果 `NANO_BANANA_MODEL` 仍然保留模板占位值，图片生成可能会反复重试，最后回退到占位输出

## OpenClaw 接入（作为 Skill）

clawvisual 可以通过 MCP 方式，作为 OpenClaw 的本地/工作区 Skill 接入。

1. 启动 clawvisual 服务：

```bash
npm install
cp .env.local.template .env.local
npm run dev
```

2. 将本仓库 Skill 安装到 OpenClaw：
- 把 [skills/clawvisual-mcp](skills/clawvisual-mcp) 复制到以下任一位置：
  - `<openclaw-workspace>/skills/clawvisual-mcp`（工作区级）
  - `~/.openclaw/skills/clawvisual-mcp`（本机共享）

3. 配置 Skill 运行环境变量：

```bash
CLAWVISUAL_MCP_URL=http://localhost:3000/api/mcp
CLAWVISUAL_API_KEY=<如果开启鉴权则填写>
```

如果开发服务器实际跑在 `3001` 或其他端口，这里的 `CLAWVISUAL_MCP_URL` 也要同步修改。

如果你显式配置了 `CLAWVISUAL_API_KEYS`，这里的 `CLAWVISUAL_API_KEY` 也应该设置为其中一个可接受的值。

4. 本地测试 Skill 客户端：

```bash
npm run skill:clawvisual -- tools
```

## 已实现架构（V1 脚手架）

- 框架：Next.js App Router + TypeScript
- API：
  - `POST /api/v1/convert`：启动 16 个技能链路并返回 `job_id`
  - `GET /api/v1/jobs/:id`：查询状态/进度/结果
  - `POST /api/mcp`：MCP JSON-RPC 端点（`initialize`、`tools/list`、`tools/call`）
  - `GET /api/openapi.json`：导出 OpenAPI Schema
- 技能系统：`src/lib/skills` 中包含 16 个原子异步技能
- Prompt 模板：`src/lib/prompts/index.ts`
- 编排器：`src/lib/orchestrator.ts`
- 队列：
  - 本地内存队列（便于本地开发）
- API Key 校验：`src/lib/auth/api-key.ts`

## 目录结构

- `src/app/page.tsx`：clawvisual 控制台 UI
- `src/app/api/v1/convert/route.ts`：转换入口
- `src/app/api/v1/jobs/[id]/route.ts`：任务状态查询
- `src/app/api/openapi.json/route.ts`：OpenAPI 导出
- `src/lib/types`：统一类型与上下文对象
- `src/lib/skills`：16 个原子技能模块

## 环境变量

当前脚手架会读取以下变量：

- `LLM_API_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`（可选，默认 `25000`）
- `LLM_COPY_FALLBACK_MODEL`（可选，默认 `google/gemini-2.5-flash`）
- `LLM_COPY_POLISH_MODEL`（可选，默认 `openai/gpt-5.1-mini`）
- `GEMINI_API_KEY`
- `NANO_BANANA_MODEL`
- `NANO_BANANA_TIMEOUT_MS`（可选，默认 `60000`）
- `NANO_BANANA_TRANSIENT_RETRY_MAX`（可选，默认 `2`）
- `NANO_BANANA_RETRY_BASE_DELAY_MS`（可选，默认 `450`）
- `QUALITY_LOOP_ENABLED`（可选，默认 `true`）
- `QUALITY_AUDIT_THRESHOLD`（可选，默认 `78`）
- `QUALITY_IMAGE_COVER_THRESHOLD`（可选，默认 `85`）
- `QUALITY_IMAGE_INNER_THRESHOLD`（可选，默认 `78`）
- `QUALITY_COVER_FIRST_GLANCE_THRESHOLD`（可选，默认 `82`）
- `QUALITY_COVER_NOVELTY_THRESHOLD`（可选，默认 `80`）
- `QUALITY_COVER_CANDIDATE_COUNT`（可选，默认 `1`）
- `QUALITY_MAX_COPY_ROUNDS`（可选，默认 `1`）
- `QUALITY_MAX_IMAGE_ROUNDS`（可选，默认 `0`）
- `QUALITY_MAX_EXTRA_IMAGES`（可选，默认 `1`）
- `QUALITY_IMAGE_LOOP_MAX_MS`（可选，默认 `120000`）
- `QUALITY_IMAGE_AUDIT_SCOPE`（可选，`cover` 或 `all`，默认 `cover`）
- `PIPELINE_MODE`（可选，`fast` 或 `full`，默认 `fast`）
- `PIPELINE_MAX_DURATION_MS`（可选，默认 `300000`）
- `PIPELINE_ENABLE_SOURCE_INTEL`（可选，fast 模式默认 `false`）
- `PIPELINE_ENABLE_STORYBOARD_QUALITY`（可选，fast 模式默认 `false`）
- `PIPELINE_ENABLE_STYLE_RECOMMENDER`（可选，fast 模式默认 `false`）
- `PIPELINE_ENABLE_ATTENTION_FIXER`（可选，fast 模式默认 `false`）
- `PIPELINE_ENABLE_POST_COPY_QUALITY`（可选，fast 模式默认 `false`）
- `PIPELINE_ENABLE_FINAL_AUDIT`（可选，fast 模式默认 `false`）
- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`
- `SERPER_API_KEY`
- `JINA_API_KEY`

运行时可观测性：
- Thinking & Actions 事件时间线包含每步 token 增量（`in/out/total`，前提是上游 provider 返回 usage）
- 最终 `skill_logs` 包含 `llm_usage_summary`，用于请求级 token 汇总

API 安全控制：
- `CLAWVISUAL_API_KEYS`：逗号分隔可用 key 列表
- `CLAWVISUAL_ALLOW_NO_KEY`：本地开发默认 `true`

## 说明

- 项目已包含异步转换流水线 + 修订引擎 + MCP 兼容 JSON-RPC 端点
- 真实生产集成（Flux/Midjourney、Redis/BullMQ Worker、PostgreSQL、satori 渲染）仍是可插拔扩展点

## MCP 工具

`POST /api/mcp` 支持：

- `convert`：创建转换任务
- `job_status`：查询当前任务状态/结果
- `revise`：对文案或图片发起修订任务
- `regenerate_cover`：基于任务修订或直接 prompt 重新生成封面

## Skill 模板

可复用的外部技能包：

- [skills/clawvisual-mcp/SKILL.md](skills/clawvisual-mcp/SKILL.md)
- [skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs](skills/clawvisual-mcp/scripts/clawvisual-mcp-client.mjs)

快捷命令：

- `npm run skill:clawvisual -- tools`

## 常见本地问题

- `Missing x-api-key`
  - 原因：你显式启用了 `CLAWVISUAL_API_KEYS`
  - 处理：带上 `x-api-key`，或者清空 `CLAWVISUAL_API_KEYS`

- MCP 客户端连错服务
  - 原因：`npm run dev` 自动切到了 `3001`，但客户端默认还在请求 `http://localhost:3000/api/mcp`
  - 处理：把 `CLAWVISUAL_MCP_URL` 改成真实端口

- `dev` 或 `build` 出现 Next.js workspace root 警告
  - 原因：仓库上层还存在其他 lockfile，Next.js 推断了更高一级的 workspace root
  - 处理：在 `next.config.ts` 里设置 `turbopack.root`，或者移除无关的上层 lockfile
