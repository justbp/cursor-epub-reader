# Cursor EPUB Reader

公开仓库：https://github.com/justbp/cursor-epub-reader

基于 [whyisee/z-epub-reader](https://github.com/whyisee/z-epub-reader)（MIT）。这一版加上了朗读：系统语音走本机，Edge TTS 由扩展进程向微软的公开朗读接口要音频。不支持 PDF。

[English](https://github.com/whyisee/z-epub-reader/blob/HEAD/README_EN.md)

一个给 Cursor 使用的本地 EPUB 阅读插件。它采用 VS Code/Cursor 兼容的 Custom Editor，不把 EPUB 当纯文本打开，而是在扩展端解析 EPUB 包，再在 webview 中以阅读器形式呈现。

![Cursor EPUB Reader AI screenshot](https://github.com/whyisee/z-epub-reader/raw/HEAD/media/screenshot2.png)

## 产品设计

- **打开方式完整**：双击或右键 `.epub` 文件会使用 EPUB Reader 打开，也可以从命令面板运行 `EPUB Reader: Open EPUB`。
- **解析链路可控**：内置 ZIP/OPF/Spine/TOC 解析，不依赖 npm 运行时包；支持 EPUB 3 `nav.xhtml` 和 EPUB 2 `toc.ncx`。
- **阅读体验闭环**：目录、上一章/下一章、滚动到章节边界自动翻章、短章节滚轮翻章、沉浸模式、当前章节搜索、主题、字号、滚动进度和阅读位置持久化。
- **AI 阅读辅助**：可接入 OpenAI、DeepSeek、OpenAI-compatible API 或 Ollama，支持流式输出、章节总结、选中文本解释、章节问答、Markdown 读书笔记生成和自定义命令。
- **错误状态明确**：损坏文件、缺失 `container.xml`、缺失 OPF、加密 ZIP、ZIP64 等情况会展示清楚的错误界面。
- **安全边界清楚**：章节内容会在扩展端清理脚本、事件属性和危险链接；webview 使用 CSP，只允许插件脚本运行。

## 使用

- 在资源管理器中双击 `.epub` 文件，或右键选择 `EPUB Reader: Open EPUB`。
- 使用顶部按钮切换目录、AI 面板、上一章/下一章、字号、主题和章节搜索。
- 滚动到章节底部继续向下滚会进入下一章；在章节顶部继续向上滚会回到上一章。
- 点击右上角小按钮可隐藏或显示顶部工具栏和底部进度栏。

## AI 功能

AI 功能默认关闭。先从命令面板运行 `EPUB Reader: Configure AI Provider`，选择 OpenAI、DeepSeek、OpenAI-compatible 或 Ollama，并配置模型、Base URL 和 API Key。API Key 会保存到编辑器的 SecretStorage，不会写入项目文件或普通设置文件。

DeepSeek 会默认使用 `https://api.deepseek.com` 和 `deepseek-v4-flash`，也可以在配置流程或设置里改成其他 DeepSeek 模型。

配置完成后，打开阅读器左侧的 AI 面板，可以在底部输入框里直接提问，或输入 `/` 选择命令：

- `/总结本章`
- `/章节笔记`
- `/解读选中`
- `/总结选中`
- `/提问`
- `/翻译`
- `/同风格写作`

在正文中选中文字后右键，可以把选中文本带入 AI 输入框，例如 `AI 解读`、`总结选中` 和 `提问这段`。AI 面板底部也提供模型配置入口，可切换 provider、模型和 API Key。

AI 结果会以对话历史形式展示，并在 provider 支持时流式输出。生成中会显示停止按钮，可中断当前请求。

每条 AI 回答下方有复制和保存笔记按钮。笔记默认保存到 EPUB 文件同目录，文件名格式为 `Z0001_命令名_章节名.md`，数字会在同目录内自增。可以通过 `cursorEpub.ai.noteFileNamePattern` 修改命名规则，支持 `{counter}`、`{command}`、`{chapter}`、`{chapterIndex}`、`{book}`、`{author}`。如果想继续保存到工作区内，可把 `cursorEpub.ai.notesLocation` 改为 `workspaceNotes`，并用 `cursorEpub.ai.notesDirectory` 指定目录。

可以在 Cursor 设置中自定义提示词和 slash 命令：

- `cursorEpub.ai.prompts`：覆盖 `system`、`chapterSummary`、`selectionExplain`、`selectionSummary`、`chapterNote`、`qa` 等提示词模板。
- `cursorEpub.ai.commands`：新增或覆盖 `/命令`。同名 `label` 会覆盖内置命令；`context` 可选 `chapter`、`selection`、`question`、`selectionQuestion`。

提示词变量支持 `{bookTitle}`、`{author}`、`{chapterTitle}`、`{text}`、`{selectedText}`、`{question}`、`{outputLanguage}`、`{contextText}`、`{commandTitle}` 和 `{truncationNotice}`。

提示词配置示例见 [docs/AI_PROMPT_CONFIG.md](https://github.com/whyisee/z-epub-reader/blob/HEAD/docs/AI_PROMPT_CONFIG.md)。最小示例：

```json
{
  "cursorEpub.ai.prompts": {
    "system": "你是一个严谨的中文读书助手。只基于用户提供的书籍内容回答。输出语言：{outputLanguage}。",
    "chapterSummary": "书名：{bookTitle}\n章节：{chapterTitle}\n\n请总结下面章节：\n{text}"
  }
}
```

插件不会自动上传 EPUB 内容；只有用户点击 AI 操作后，才会把当前任务需要的章节文本或选中文本发送给已配置的 AI provider。

## 开发运行

```bash
npm run check
```

在 Cursor 或 VS Code 中打开本目录，按 `F5` 启动 Extension Development Host，然后打开一个 `.epub` 文件。

## 安装到 Cursor

项目已经可以打包为 VSIX：

```bash
npm run package
```

安装方式任选一种：

```bash
cursor --install-extension z-epub-reader-0.2.1.vsix
code --install-extension z-epub-reader-0.2.1.vsix
```

也可以在 Cursor 的 Extensions 面板里选择从 VSIX 安装。

## 打包

```bash
npm run package
```

`package` 会调用本机已安装的 `vsce package`，并生成 `.vsix` 安装包。

## 当前边界

- 支持常见的 Stored/Deflated EPUB ZIP 条目，不支持加密 EPUB、分卷 ZIP 和 ZIP64。
- 当前版本聚焦阅读，不修改 EPUB 文件。
- AI 功能不调用 Cursor 内置 Agent，也不自动注入 Cursor Chat；它使用用户配置的 provider。

## 隐私和支持

- 隐私说明见 [PRIVACY.md](https://github.com/whyisee/z-epub-reader/blob/HEAD/PRIVACY.md)。
- 支持和反馈见 [SUPPORT.md](https://github.com/whyisee/z-epub-reader/blob/HEAD/SUPPORT.md)。
- 作者本人擅长在网络上查找公开、正版或合法可获取的各类书籍资源，如有找书需求，欢迎联系作者。

## 已验证

- `npm run check`
- `npm run test` 覆盖 EPUB 2 NCX、EPUB 3 NAV、压缩 ZIP 条目、资源重写、安全清理、章节纯文本提取和 AI helper。
