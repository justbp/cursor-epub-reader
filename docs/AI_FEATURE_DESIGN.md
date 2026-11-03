# Cursor EPUB Reader AI 功能设计文档

## 1. 背景

Cursor EPUB Reader 当前是一个本地 EPUB 阅读扩展，负责在 Cursor/VS Code 兼容环境中打开 `.epub` 文件，并通过 Custom Editor + Webview 提供目录、章节阅读、主题、字号、搜索、滚动进度和阅读位置持久化等能力。

下一阶段希望在不依赖 Cursor 内置 Chat/Agent 私有能力的前提下，为阅读器增加自有 AI 能力，例如章节总结、选中文本总结、全书总结、AI 写笔记、问答、摘录整理和 Markdown 笔记导出。

本设计文档描述 AI 功能的产品范围、技术架构、数据流、隐私边界、UI 交互、接口设计、错误处理、测试方案和分阶段落地计划。

## 2. 设计结论

### 2.1 不直接依赖 Cursor Agent

Cursor 当前没有稳定公开的扩展 API 允许第三方扩展直接调用前台 Chat/Agent 或把内容注入 Add to Chat。插件可以尝试调用内部命令，但这类命令缺少兼容性保证，不适合作为核心功能依赖。

因此本项目的 AI 功能应采用自有 provider 层：

```text
Webview 阅读器
  -> VS Code extension host
  -> AI provider adapter
  -> OpenAI / DeepSeek / Anthropic / Gemini / Ollama / OpenAI-compatible endpoint
  -> extension host
  -> Webview 渲染结果
```

### 2.2 核心原则

- 用户明确触发时才发送 EPUB 内容给 AI。
- 默认不上传全书，不自动后台分析。
- API Key 使用 `context.secrets` 保存。
- AI provider 可替换，不把业务功能绑定到单一厂商。
- 阅读器 UI 保持本地优先，AI 是增强层，不影响基础阅读功能。
- 长文本走分块和汇总链路，避免一次性提交整本书导致上下文超限。
- 生成的笔记默认保存为 Markdown，用户可审阅、编辑、删除。

## 3. 目标

### 3.1 产品目标

为 EPUB 阅读器增加面向深度阅读的 AI 辅助能力：

- 快速理解当前章节。
- 对选中文本做解释、翻译、总结和笔记整理。
- 将章节内容转成结构化读书笔记。
- 支持全书级摘要、主题梳理和人物/概念索引。
- 支持用户基于当前章节或全书上下文提问。
- 让 AI 结果可以沉淀为本地 Markdown 笔记。

### 3.2 技术目标

- 在当前无 npm runtime dependencies 的项目风格上谨慎扩展。
- 保持 `extension.js` 作为 VS Code 扩展入口，新增 AI 相关模块。
- Webview 只负责交互和展示，不直接持有 API Key，不直接调用模型服务。
- 所有外部请求都由 extension host 发起，便于安全控制和错误处理。
- 用清晰的消息协议连接 webview 和 extension。
- 新增测试覆盖文本提取、分块、provider 参数构造、状态保存和错误分支。

### 3.3 非目标

第一阶段不做：

- 直接调用 Cursor 内置 Chat/Agent。
- 自动扫描用户整个工作区或上传工作区文件。
- 后台自动总结用户打开过的所有 EPUB。
- 修改 EPUB 原文件。
- 训练、微调或持久化向量数据库。
- 多设备云同步。
- 商业账号、支付、用量计费系统。

## 4. 用户场景

### 4.1 当前章节总结

用户正在阅读某一章，点击工具栏中的 AI 按钮，选择“总结当前章节”。插件提取当前章节纯文本，调用 AI，返回：

- 本章一句话概括。
- 关键观点。
- 重要概念。
- 可摘录句子。
- 后续阅读问题。

### 4.2 选中文本解释

用户在章节内选择一段文字，点击浮动 AI 菜单或侧栏按钮，选择“解释选中内容”。插件只发送选中文本，并带上当前书名、章节名等最少上下文，返回解释。

### 4.3 AI 写笔记

用户点击“生成章节笔记”，插件把当前章节整理成 Markdown：

- 标题。
- 章节摘要。
- 要点。
- 概念解释。
- 引用摘录。
- 我的思考提示。

用户可以在 webview 预览，然后选择保存到工作区。

### 4.4 全书总结

用户选择“生成全书总结”。插件按章节分批处理：

1. 对每章生成短摘要。
2. 将所有章节摘要再合成全书摘要。
3. 输出主题脉络、结构大纲、人物/概念索引、适合复习的卡片。

### 4.5 阅读问答

用户输入问题，例如“这一章和上一章的关系是什么？”插件根据配置选择当前章节、相邻章节或全书摘要作为上下文，调用 AI 返回答案。

### 4.6 导出 Markdown

用户将 AI 生成内容保存为 Markdown 文件：

```text
notes/
  Book Title/
    001-chapter-title.md
    summary.md
```

默认文件内容包含 YAML frontmatter，方便 Obsidian、Markdown 编辑器和 Cursor 后续检索。

## 5. 功能范围

### 5.1 MVP 功能

第一阶段建议实现以下功能：

- 配置 AI provider。
- 保存和测试 API Key。
- 当前章节总结。
- 选中文本总结/解释。
- 生成当前章节 Markdown 笔记。
- 保存笔记到工作区。
- AI 请求错误提示。
- 手动复制 AI 结果。

### 5.2 第二阶段功能

- 全书总结。
- 自定义提示词模板。
- AI 结果历史记录。
- 对当前章节提问。
- 多语言输出配置。
- 流式响应。
- 本地 Ollama provider。

### 5.3 第三阶段功能

- 跨章节问答。
- 全书知识卡片。
- 人物、术语、地点索引。
- 阅读进度关联笔记。
- 可插拔笔记目录规则。
- 可选向量索引，仅本地或用户显式配置。

## 6. 信息架构

### 6.1 新增 UI 区域

阅读器可新增一个 AI 侧栏面板，和目录侧栏共存或复用左侧区域的 tab：

```text
┌──────────────────────────────────────────────┐
│ Topbar: 目录 | AI | 上/下一章 | 字号 | 主题 │
├───────────────┬──────────────────────────────┤
│ Sidebar       │ Reading Pane                 │
│ - 目录 Tab    │                              │
│ - AI Tab      │                              │
├───────────────┴──────────────────────────────┤
│ Statusbar                                    │
└──────────────────────────────────────────────┘
```

### 6.2 AI 面板内容

AI 面板建议包含：

- Provider 状态：未配置、可用、请求中、错误。
- 快捷动作：
  - 总结当前章节。
  - 解释选中文本。
  - 生成章节笔记。
  - 询问当前章节。
- 输入框：自定义问题。
- 结果区：展示 Markdown 渲染结果或纯文本。
- 操作区：
  - 复制。
  - 保存为笔记。
  - 重新生成。
  - 停止生成。

### 6.3 工具栏最小改动

当前 topbar 空间有限，建议只增加一个 `AI` 图标按钮。点击后打开 AI 面板，不把所有 AI 操作都塞进顶部工具栏。

## 7. 配置设计

### 7.1 package.json contributes.configuration

建议新增配置项：

```json
{
  "cursorEpub.ai.provider": {
    "type": "string",
    "enum": ["disabled", "openai", "deepseek", "openaiCompatible", "anthropic", "gemini", "ollama"],
    "default": "disabled",
    "description": "AI provider for EPUB summary and notes."
  },
  "cursorEpub.ai.model": {
    "type": "string",
    "default": "",
    "description": "Model name used by the selected AI provider."
  },
  "cursorEpub.ai.baseUrl": {
    "type": "string",
    "default": "",
    "description": "Base URL for OpenAI-compatible or local providers."
  },
  "cursorEpub.ai.outputLanguage": {
    "type": "string",
    "enum": ["auto", "zh-CN", "en-US"],
    "default": "zh-CN",
    "description": "Preferred language for AI-generated output."
  },
  "cursorEpub.ai.maxInputCharacters": {
    "type": "number",
    "default": 24000,
    "minimum": 2000,
    "maximum": 120000,
    "description": "Maximum chapter text characters sent in a single AI request."
  },
  "cursorEpub.ai.notesDirectory": {
    "type": "string",
    "default": "notes",
    "description": "Workspace-relative directory for generated Markdown notes."
  },
  "cursorEpub.ai.enableStreaming": {
    "type": "boolean",
    "default": true,
    "description": "Stream AI responses when the provider supports it."
  }
}
```

### 7.2 SecretStorage

API Key 不写入 `settings.json`，使用 VS Code SecretStorage：

```text
context.secrets.store("cursorEpub.ai.openai.apiKey", value)
context.secrets.get("cursorEpub.ai.openai.apiKey")
context.secrets.delete("cursorEpub.ai.openai.apiKey")
```

每个 provider 使用独立 secret key，便于切换和删除。

### 7.3 配置入口

命令面板新增命令：

- `EPUB Reader: Configure AI Provider`
- `EPUB Reader: Test AI Provider`
- `EPUB Reader: Clear AI Secrets`

这些命令通过 `showQuickPick` 和 `showInputBox` 完成基础配置。

## 8. 技术架构

### 8.1 当前架构

```text
extension.js
  - activate
  - register custom editor
  - load EPUB file
  - parseEpub
  - create webview payload
  - handle webview messages

lib/zip.js
  - read ZIP entries

lib/epub.js
  - parse metadata, manifest, spine, toc
  - render chapter HTML
  - sanitize HTML/CSS

media/reader.js
  - render reader UI
  - handle chapter navigation
  - save reading state
```

### 8.2 目标架构

```text
extension.js
  - editor lifecycle
  - message router
  - commands

lib/epub.js
  - EPUB parsing
  - chapter rendering
  - chapter plain text extraction

lib/ai/
  provider.js
    - provider interface
    - createProvider
  openai-compatible.js
    - OpenAI and compatible APIs
  anthropic.js
    - Anthropic adapter
  gemini.js
    - Gemini adapter
  ollama.js
    - local Ollama adapter
  prompts.js
    - prompt templates
  chunker.js
    - text chunking
  notes.js
    - Markdown note generation
  errors.js
    - normalized AI errors

media/reader.js
  - AI panel state
  - selection extraction
  - request/response rendering

media/reader.css
  - AI panel layout
```

### 8.3 Provider interface

内部统一接口建议如下：

```js
class AiProvider {
  constructor(options) {}

  async complete(request, signal) {
    return {
      text: "...",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      raw: {}
    };
  }

  async *stream(request, signal) {
    yield { type: "delta", text: "..." };
    yield { type: "done", usage: {} };
  }
}
```

统一请求结构：

```js
{
  task: "chapterSummary" | "selectionExplain" | "chapterNote" | "qa" | "bookSummary",
  system: "system prompt",
  messages: [
    { role: "user", content: "..." }
  ],
  temperature: 0.2,
  maxOutputTokens: 1800,
  metadata: {
    bookTitle: "...",
    author: "...",
    chapterTitle: "...",
    chapterIndex: 0,
    language: "zh-CN"
  }
}
```

统一响应结构：

```js
{
  ok: true,
  requestId: "uuid",
  task: "chapterSummary",
  text: "...",
  usage: {},
  createdAt: 1710000000000
}
```

错误结构：

```js
{
  ok: false,
  requestId: "uuid",
  task: "chapterSummary",
  error: {
    code: "missingApiKey",
    message: "AI provider is not configured.",
    retryable: false
  }
}
```

## 9. Webview 消息协议

### 9.1 Webview -> Extension

#### `aiRequest`

```js
{
  type: "aiRequest",
  requestId: "ai-001",
  task: "chapterSummary",
  payload: {
    chapterIndex: 3,
    selectedText: "",
    question: "",
    outputFormat: "markdown"
  }
}
```

#### `aiCancel`

```js
{
  type: "aiCancel",
  requestId: "ai-001"
}
```

#### `saveAiNote`

```js
{
  type: "saveAiNote",
  payload: {
    chapterIndex: 3,
    title: "Chapter 3 Notes",
    markdown: "...",
    mode: "create"
  }
}
```

#### `getAiStatus`

```js
{
  type: "getAiStatus"
}
```

### 9.2 Extension -> Webview

#### `aiStatus`

```js
{
  type: "aiStatus",
  configured: true,
  provider: "openaiCompatible",
  model: "gpt-...",
  streaming: true
}
```

#### `aiStart`

```js
{
  type: "aiStart",
  requestId: "ai-001",
  task: "chapterSummary"
}
```

#### `aiDelta`

```js
{
  type: "aiDelta",
  requestId: "ai-001",
  text: "增量内容"
}
```

#### `aiResult`

```js
{
  type: "aiResult",
  requestId: "ai-001",
  task: "chapterSummary",
  text: "完整内容",
  usage: {}
}
```

#### `aiError`

```js
{
  type: "aiError",
  requestId: "ai-001",
  error: {
    code: "rateLimited",
    message: "The provider rate limit was reached.",
    retryable: true
  }
}
```

#### `aiNoteSaved`

```js
{
  type: "aiNoteSaved",
  path: "notes/Book/003-chapter.md"
}
```

## 10. 文本提取设计

### 10.1 为什么不能直接发送 HTML

章节 HTML 包含样式、图片 data URL、目录锚点和清理后的标签。直接发送 HTML 会浪费上下文，也可能让模型关注排版噪音。

AI 请求应使用纯文本，并保留必要的结构信息。

### 10.2 扩展端提取

建议在 `lib/epub.js` 新增方法：

```js
book.getChapterText(index)
```

返回：

```js
{
  index: 0,
  title: "Chapter title",
  text: "纯文本内容",
  headings: [
    { level: 1, text: "..." }
  ],
  estimatedCharacters: 12000
}
```

文本提取策略：

- 从原始 XHTML/HTML 读取章节。
- 移除 `script`、`style`、`nav` 等非正文块。
- 将标题、段落、列表项、表格单元转换为带换行的文本。
- 解码 HTML entities。
- 合并连续空白。
- 保留章节标题。

### 10.3 Webview 端选中文本

选中文本来自 DOM Selection：

```js
const selection = window.getSelection();
const selectedText = selection ? selection.toString().trim() : "";
```

规则：

- 选中文本为空时禁用“解释选中内容”。
- 选中文本超过配置上限时提示截断或切换为章节总结。
- 选中文本只在用户点击 AI 操作时发送。

## 11. 分块策略

### 11.1 当前章节

若章节文本小于 `maxInputCharacters`，直接请求。

若超过限制：

1. 按段落切分。
2. 合并成多个 chunk。
3. 每个 chunk 生成局部摘要。
4. 将局部摘要合成最终摘要。

### 11.2 全书总结

全书总结使用 map-reduce：

```text
chapter text
  -> chapter summary
  -> book-level synthesis
```

中间结果应可缓存到 workspaceState 或本地 JSON 缓存，避免重复消耗。

### 11.3 缓存 key

```text
cursorEpub.ai.cache:{bookUri}:{chapterIndex}:{task}:{model}:{promptVersion}
```

MVP 可以不做缓存，第二阶段再加。

## 12. Prompt 设计

### 12.1 通用 system prompt

```text
你是一个严谨的读书助手。你只基于用户提供的书籍内容回答，不编造未提供的信息。输出应清晰、结构化、适合保存为 Markdown 笔记。如果内容不足以回答，请说明不足之处。
```

### 12.2 章节总结 prompt

输入：

- 书名。
- 作者。
- 章节标题。
- 章节文本。
- 输出语言。

输出格式：

```markdown
## 一句话概括

## 核心要点

## 重要概念

## 值得摘录

## 继续阅读的问题
```

### 12.3 选中文本解释 prompt

输出格式：

```markdown
## 简明解释

## 放在本章中的作用

## 可能的延伸理解
```

如果只有选中文本，没有章节上下文，应明确“以下解释仅基于选中文本”。

### 12.4 章节笔记 prompt

输出格式：

```markdown
---
source: "Book Title"
chapter: "Chapter Title"
type: "reading-note"
---

# Chapter Title

## 摘要

## 结构

## 关键观点

## 概念与术语

## 摘录

## 我的思考
```

### 12.5 问答 prompt

约束：

- 只根据提供内容回答。
- 不确定时说不确定。
- 引用章节标题。
- 尽量给出简洁答案和依据。

## 13. 笔记保存设计

### 13.1 文件路径

默认路径：

```text
{workspaceFolder}/notes/{safeBookTitle}/{chapterNumber}-{safeChapterTitle}.md
```

如果没有打开 workspace，则提示用户选择保存位置，或保存到扩展全局存储目录。

### 13.2 文件名清理

规则：

- 去除 `/ \ : * ? " < > |` 等非法字符。
- 合并连续空格。
- 限制长度，例如 80 字符。
- 章节序号补零，例如 `003-preface.md`。

### 13.3 冲突策略

当文件已存在：

- 默认提示：覆盖、追加、另存为。
- MVP 可以默认另存为 `{name}-2.md`，减少误覆盖风险。

### 13.4 Frontmatter

建议写入：

```yaml
---
book: "Book Title"
author: "Author"
chapter: "Chapter Title"
chapter_index: 3
source_file: "file:///..."
created: "2026-05-27T10:00:00.000Z"
generator: "Cursor EPUB Reader"
provider: "openaiCompatible"
model: "..."
---
```

`source_file` 可考虑只写文件名或可配置，避免在分享笔记时泄露本机路径。

## 14. 隐私与安全

### 14.1 用户可见说明

首次使用 AI 功能时展示说明：

```text
AI 功能会把你选择的文本或章节内容发送给你配置的 AI 服务商。插件不会自动上传 EPUB 内容，也不会在未触发 AI 操作时发送数据。
```

用户确认后记录：

```text
cursorEpub.ai.consentAccepted = true
```

### 14.2 API Key 安全

- API Key 存入 SecretStorage。
- Webview 不接收 API Key。
- 日志不打印 API Key。
- 错误信息中清理 Authorization header、URL query token 等敏感内容。

### 14.3 网络边界

- provider 为 `disabled` 时不发起任何 AI 请求。
- provider 为 `deepseek` 时默认使用 `https://api.deepseek.com`，并使用独立 SecretStorage key 保存 API Key。
- provider 为 `ollama` 时默认只允许本地地址，如 `http://localhost:11434`。
- provider 为 `openaiCompatible` 时由用户配置 `baseUrl`。

### 14.4 内容边界

- 只发送当前任务需要的最小文本。
- 选中文本任务不自动附带整章全文。
- 全书总结必须二次确认。
- 未来如加入缓存，应提供清除缓存命令。

### 14.5 CSP

当前 webview CSP 不允许任意网络请求，这是好的。AI 请求应继续在 extension host 中完成，不改变 webview 的 `connect-src`。

## 15. 错误处理

### 15.1 错误分类

```js
const AI_ERROR_CODES = {
  providerDisabled: "providerDisabled",
  missingApiKey: "missingApiKey",
  invalidConfig: "invalidConfig",
  networkError: "networkError",
  unauthorized: "unauthorized",
  rateLimited: "rateLimited",
  modelNotFound: "modelNotFound",
  contextTooLarge: "contextTooLarge",
  requestCancelled: "requestCancelled",
  providerError: "providerError",
  unknown: "unknown"
};
```

### 15.2 用户提示

- 未配置：显示“先配置 AI Provider”按钮。
- Key 无效：提示重新输入 API Key。
- 网络失败：提示检查网络或 base URL。
- 速率限制：提示稍后重试。
- 文本过长：提示自动分块或缩小范围。
- 取消：静默停止，保留已生成内容。

### 15.3 重试策略

MVP 不自动重试，避免重复消耗额度。第二阶段可对网络抖动和 5xx 做一次用户确认后的重试。

## 16. 状态管理

### 16.1 Webview 内存状态

```js
const aiState = {
  panelOpen: false,
  activeTask: "",
  activeRequestId: "",
  selectedText: "",
  resultText: "",
  isLoading: false,
  error: null
};
```

### 16.2 VS Code webview state

使用 `vscode.setState` 保存轻量 UI 状态：

- AI 面板是否打开。
- 最近一次任务类型。
- 最近一次结果文本，限制长度。

不要保存 API Key，不要保存整本书内容。

### 16.3 workspaceState

可保存：

- 用户是否接受 AI 隐私提示。
- AI 面板偏好。
- 章节级 AI 缓存索引。

## 17. 命令设计

新增命令：

```json
[
  {
    "command": "cursorEpub.configureAi",
    "title": "EPUB Reader: Configure AI Provider"
  },
  {
    "command": "cursorEpub.testAi",
    "title": "EPUB Reader: Test AI Provider"
  },
  {
    "command": "cursorEpub.clearAiSecrets",
    "title": "EPUB Reader: Clear AI Secrets"
  },
  {
    "command": "cursorEpub.openAiSettings",
    "title": "EPUB Reader: Open AI Settings"
  }
]
```

## 18. 交互细节

### 18.1 AI 面板空状态

未配置时：

```text
AI 尚未配置
[配置 AI Provider]
```

已配置但没有结果时：

```text
选择一个操作开始：
[总结当前章节] [解释选中内容] [生成章节笔记]
```

### 18.2 加载状态

流式：

- 显示停止按钮。
- 边生成边展示。
- 完成后出现复制和保存按钮。

非流式：

- 显示 spinner 和“正在生成”。
- 请求完成后一次性展示。

### 18.3 选中文本按钮

仅当 `window.getSelection().toString().trim()` 非空时启用。

可以在 AI 面板中显示选中文本预览：

```text
已选择 328 字
```

### 18.4 保存笔记

保存成功后：

```text
已保存到 notes/Book/003-Chapter.md
[打开笔记]
```

点击“打开笔记”调用 `vscode.open`。

## 19. Provider 实现建议

### 19.1 OpenAI-compatible

优先实现 OpenAI-compatible，因为它可以覆盖多个服务：

- OpenAI。
- Azure OpenAI 的兼容接口，若用户自行配置。
- DeepSeek、Moonshot、SiliconFlow 等兼容 OpenAI Chat Completions 的服务。
- 本地 OpenAI-compatible 代理。

请求形态：

```js
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "...",
  "messages": [...],
  "temperature": 0.2,
  "stream": true
}
```

### 19.2 DeepSeek

DeepSeek 作为 OpenAI-compatible 云端 provider 的一等预设：

```text
POST https://api.deepseek.com/chat/completions
```

默认模型建议使用 `deepseek-v4-flash`，用户可在设置中改成其他 DeepSeek 模型。

### 19.3 Ollama

Ollama 可作为本地隐私优先 provider：

```text
POST http://localhost:11434/api/chat
```

优点：

- 不上传内容到第三方云服务。
- 用户可离线使用。

缺点：

- 模型能力和速度取决于本机。
- 上下文长度和中文能力差异较大。

### 19.4 Anthropic/Gemini

这两个 provider 可第二阶段实现。它们 API 结构与 OpenAI-compatible 不完全一致，适合单独 adapter。

## 20. 文件改动计划

### 20.1 第一阶段新增文件

```text
lib/ai/provider.js
lib/ai/openai-compatible.js
lib/ai/ollama.js
lib/ai/prompts.js
lib/ai/chunker.js
lib/ai/notes.js
lib/ai/errors.js
test/ai.test.js
```

### 20.2 第一阶段修改文件

```text
package.json
extension.js
lib/epub.js
media/reader.js
media/reader.css
README.md
PRIVACY.md
```

### 20.3 可能新增文档

```text
docs/AI_SETUP.md
docs/AI_FEATURE_DESIGN.md
```

## 21. 关键实现伪代码

### 21.1 extension.js 消息分发

```js
if (message.type === "aiRequest") {
  await this._handleAiRequest(document, webview, message);
}

if (message.type === "aiCancel") {
  this._cancelAiRequest(message.requestId);
}

if (message.type === "saveAiNote") {
  await this._saveAiNote(document, webview, message.payload);
}
```

### 21.2 AI 请求处理

```js
async _handleAiRequest(document, webview, message) {
  const requestId = String(message.requestId || createRequestId());
  const task = String(message.task || "");
  const abortController = new AbortController();

  this.aiRequests.set(requestId, abortController);
  await webview.postMessage({ type: "aiStart", requestId, task });

  try {
    const aiRequest = await buildAiRequest({
      task,
      payload: message.payload,
      book: document.book,
      config: getAiConfig()
    });

    const provider = await createAiProvider(this.context);

    for await (const event of provider.stream(aiRequest, abortController.signal)) {
      if (event.type === "delta") {
        await webview.postMessage({ type: "aiDelta", requestId, text: event.text });
      }
      if (event.type === "done") {
        await webview.postMessage({ type: "aiResult", requestId, task, text: event.text, usage: event.usage });
      }
    }
  } catch (error) {
    await webview.postMessage({ type: "aiError", requestId, error: normalizeAiError(error) });
  } finally {
    this.aiRequests.delete(requestId);
  }
}
```

### 21.3 章节文本获取

```js
function getChapterText(zip, chapter) {
  const source = zip.readText(chapter.path);
  const body = extractBody(source);
  return htmlToPlainText(body);
}
```

### 21.4 保存笔记

```js
async function saveMarkdownNote(workspaceFolder, book, chapter, markdown, config) {
  const dir = vscode.Uri.joinPath(workspaceFolder.uri, config.notesDirectory, safeFileName(book.title));
  const file = vscode.Uri.joinPath(dir, `${pad(chapter.index + 1)}-${safeFileName(chapter.title)}.md`);
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(file, Buffer.from(markdown, "utf8"));
  return file;
}
```

## 22. 测试方案

### 22.1 单元测试

新增 `test/ai.test.js` 覆盖：

- `htmlToPlainText` 正确去除标签和危险内容。
- `chunkText` 不截断段落。
- `buildChapterSummaryPrompt` 包含必要元数据。
- `safeFileName` 处理非法字符。
- `normalizeAiError` 分类常见 HTTP 错误。

### 22.2 Provider 测试

不在默认测试中请求真实网络。使用 fake fetch：

- 正常响应。
- 流式响应。
- 401。
- 429。
- 5xx。
- 超时/取消。

### 22.3 集成测试

用当前 `test/epub.test.js` 的 EPUB 样本扩展：

- 能提取章节纯文本。
- 能基于章节生成 AI 请求。
- 保存笔记路径符合预期。

### 22.4 手工验证

在 Extension Development Host 中验证：

- 未配置 provider 时 AI 面板提示正确。
- 配置 API Key 后测试成功。
- 当前章节总结能返回。
- 选中文本解释只发送选中文本。
- 保存笔记能落到工作区。
- 关闭再打开 EPUB 后阅读功能不受影响。

## 23. 性能考虑

- 当前章节总结只读取当前章节文本，不预加载全书。
- 全书总结需要用户明确确认，并显示预计处理章节数。
- 长章节分块处理时展示进度，例如 `3 / 8`。
- 避免把图片 data URL、CSS 和 HTML 发送给模型。
- 对同一章节重复总结可在第二阶段加入缓存。

## 24. 兼容性考虑

- 项目引擎当前为 VS Code `^1.85.0`，应避免使用过新的 VS Code API，除非提升 engines 版本。
- `fetch` 在扩展 host 的 Node 版本中通常可用，但为兼容性可以封装请求层，必要时回退到 `https` 模块。
- Webview 现有 CSP 不需要开放网络请求。
- 不依赖 Cursor 内部命令，保证在 VS Code 中也能使用 AI 功能。

## 25. 风险与取舍

### 25.1 模型输出不可控

风险：AI 可能幻觉、误读或给出过度概括。

缓解：

- Prompt 明确“只基于提供内容”。
- 输出中加入“内容不足时说明不足”。
- 对笔记结果保留用户审阅流程。

### 25.2 隐私风险

风险：用户误以为 AI 功能完全本地。

缓解：

- 首次使用强提示。
- Provider 状态清晰显示。
- 本地 Ollama 作为隐私优先选项。
- 不自动上传。

### 25.3 成本风险

风险：全书总结消耗大量 token 和费用。

缓解：

- 全书总结二次确认。
- 显示章节数和分块数。
- 支持用户设置最大输入字符数。

### 25.4 复杂 EPUB 兼容性

风险：某些 EPUB 正文提取不准确。

缓解：

- 文本提取复用现有解析链路。
- 测试覆盖常见 XHTML 结构。
- 提供“选中文本 AI”作为精确输入路径。

## 26. 分阶段落地计划

### 26.1 Milestone 1: AI 基础设施

- 新增配置项和命令。
- 实现 SecretStorage API Key 管理。
- 实现 OpenAI-compatible provider。
- 实现 Ollama provider。
- 实现 AI 错误归一化。
- 新增基础测试。

验收标准：

- 可以配置 provider。
- 可以测试 provider。
- 不配置时阅读器功能不受影响。

### 26.2 Milestone 2: 当前章节总结

- `lib/epub.js` 新增章节纯文本提取。
- Webview 新增 AI 面板。
- 增加 `aiRequest` 消息协议。
- 实现章节总结 prompt。
- 支持非流式或流式返回。

验收标准：

- 打开 EPUB 后可以总结当前章节。
- 请求中可取消。
- 错误提示清楚。

### 26.3 Milestone 3: 选中文本解释和章节笔记

- Webview 获取选中文本。
- 实现选中文本解释。
- 实现章节笔记 prompt。
- 支持复制结果。
- 支持保存 Markdown。

验收标准：

- 选中文本为空时按钮禁用。
- 保存笔记后可打开文件。
- Markdown frontmatter 正确。

### 26.4 Milestone 4: 全书总结

- 实现章节分块。
- 实现章节摘要缓存。
- 实现全书汇总。
- 显示处理进度。

验收标准：

- 可以对多章节 EPUB 生成全书摘要。
- 中途取消不破坏阅读器状态。
- 重复生成可复用缓存或提示用户。

### 26.5 Milestone 5: 自定义提示词和问答

- 配置自定义 prompt 模板。
- 当前章节问答。
- 基于全书摘要问答。
- AI 历史记录。

验收标准：

- 用户可以基于当前章节提问。
- 自定义模板不会破坏默认功能。

## 27. MVP 推荐实现顺序

建议实际开发顺序：

1. `lib/epub.js` 增加 `getChapterText(index)`。
2. 增加 `lib/ai/prompts.js` 和 `lib/ai/errors.js`。
3. 增加 OpenAI-compatible provider。
4. 增加配置命令和 SecretStorage。
5. `extension.js` 接入 `aiRequest`。
6. `media/reader.js` 增加 AI 面板和章节总结按钮。
7. 增加复制结果和保存 Markdown。
8. 增加测试和 README/PRIVACY 更新。

这样可以先打通最短闭环：

```text
当前章节 -> 纯文本 -> AI 总结 -> 展示 -> 保存
```

## 28. 验收清单

MVP 完成时需要满足：

- `npm run check` 通过。
- 未配置 AI 时插件仍能正常打开和阅读 EPUB。
- API Key 不会出现在 webview、日志、settings.json 和错误消息中。
- 当前章节总结能处理普通章节和较长章节。
- 选中文本解释不会发送整章内容。
- AI 请求失败时有明确错误提示。
- 用户可以取消请求。
- 用户可以复制 AI 结果。
- 用户可以保存 Markdown 笔记。
- README 说明 AI 功能配置方式。
- PRIVACY 说明 AI 请求会发送用户选择的内容到配置的 provider。

## 29. 开放问题

- 首个云端 provider 是否只做 OpenAI-compatible，还是单独提供 OpenAI 预设。
- 是否在 MVP 就支持流式响应。
- 保存笔记时，如果没有 workspace folder，是否允许保存到用户选择的位置。
- 全书总结是否需要在第一个版本提供，还是放到第二阶段。
- AI 面板使用左侧目录 tab，还是右侧独立抽屉。
- 是否需要提供“永不发送完整章节，只发送选中文本”的严格隐私模式。

## 30. 推荐 MVP 定稿

建议第一版 AI 功能定为：

- Provider：OpenAI-compatible + DeepSeek + Ollama。
- 任务：当前章节总结、选中文本解释、章节笔记。
- 输出：Markdown。
- 保存：workspace 下 `notes/{book}/{chapter}.md`。
- 隐私：首次确认 + API Key SecretStorage + 手动触发。
- UI：新增 AI 面板，不侵入现有阅读体验。

这个范围足够形成可用闭环，也不会一次性把项目复杂度拉太高。
