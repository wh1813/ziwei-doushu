# 紫微斗数 · Cloudflare 智能排盘

基于倪海夏《天纪》教学体系的紫微斗数排盘系统，包含排盘算法、四化系统、格局知识库、古籍原文与流式 AI 命盘解读。

## 功能

- Next.js 15 App Router 前端与排盘工作台
- 服务端 `POST /api/interpret`
- OpenAI-compatible API（DeepSeek、OpenAI 或其他兼容服务）
- 命盘上下文整理：程序负责排盘，模型只负责解释
- SSE 流式回答，不向浏览器暴露供应商、模型、API Key 或系统提示词
- Cloudflare Workers + OpenNext
- Cloudflare D1 匿名记录AI提问、回答、状态与耗时，默认保留30天
- Cloudflare Access 保护的查询记录管理后台
- Cloudflare 原生每分钟限流，以及请求体、消息轮数、单条内容、输出和超时限制

## 开始使用

```bash
npm install
cp .env.example .env.local
npm run dev
```

服务端环境变量：

```env
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=your-secret
AI_MODEL=deepseek-v4-flash
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

`AI_API_KEY` 不得使用 `NEXT_PUBLIC_` 前缀。

## 部署到 Cloudflare Workers

项目使用 `@opennextjs/cloudflare`，生产运行环境是 Cloudflare Workers，不是 Cloudflare Pages 或 Vercel。

1. 在 Cloudflare Workers Builds 中连接本 GitHub 仓库。
2. 将 `AI_API_KEY` 配置为 Secret。
3. 配置 `AI_BASE_URL`、`AI_MODEL`、`NEXT_PUBLIC_SITE_URL`。
4. 使用 `npm run deploy` 构建并部署。
5. 在 Workers 的 Domains & Routes 中绑定自定义域名。

本地 Wrangler 登录环境也可以运行 `npm run preview` 或 `npm run deploy`。

## 安全边界

- 单次请求体最大 96 KiB。
- 最多保留 10 条历史消息，每条最多 1000 字符。
- 模型输出和上游请求有硬限制。
- `wrangler.jsonc` 的 `AI_RATE_LIMITER` 默认每个访问来源每分钟 10 次。
- 命理内容仅用于传统文化研究与休闲参考。

## 上游数据来源

如果使用 Releases 中的 51.8 万条样本数据，请保留上游要求的 attribution：

> 本项目使用了紫微斗数开源样本数据集 v3.0（518,400 条）  
> 来源：https://github.com/Renhuai123/ziwei-doushu  
> 作者：王多鱼AI

代码使用 MIT License；古籍原文属于公有领域。详见 [LICENSE](./LICENSE)。
<!-- Cloudflare Workers build trigger -->


## AI询问记录后台

管理后台地址：

```text
https://你的域名/admin/query-logs
```

后台支持按关键词和状态搜索、分页、查看完整回答与命盘摘要、CSV导出及批量删除。记录包含匿名会话编号，不保存真实IP，系统在每次写入时清理30天前的数据。

### 1. 创建D1数据库

在 Cloudflare 控制台进入 **Storage & Databases → D1 SQL Database**，创建：

```text
ziwei-doushu-logs
```

复制数据库 ID，并分别添加到 GitHub Actions Secret 以及 Cloudflare Workers Builds 的构建变量：

```text
CLOUDFLARE_D1_DATABASE_ID
```

部署脚本会生成临时 Wrangler 配置并自动执行 `migrations/0001_ai_query_logs.sql`。临时配置不会提交到仓库。

### 2. 配置管理员邮箱

在 Worker 的变量和密钥中添加文本变量：

```text
ADMIN_EMAILS=你的邮箱
```

多个管理员邮箱使用英文逗号分隔。

### 3. 使用Cloudflare Access保护后台

在 **Zero Trust → Access controls → Applications** 创建 Self-hosted 应用，只允许管理员邮箱，并保护两个路径：

```text
你的域名/admin/*
你的域名/api/admin/*
```

应用代码要求同时存在 Cloudflare Access JWT 和经过验证的管理员邮箱；未配置 Access 时后台默认拒绝访问。

## 询问记录隐私边界

- 保存用户问题、AI回答、命盘摘要、状态、耗时、国家或地区代码及随机会话编号。
- 不保存真实IP、API Key、Cookie或完整请求头。
- 前端明确提示保存范围并链接到隐私政策。
- 默认保留30天，管理员可提前删除。
