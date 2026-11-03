# Cursor EPUB Reader

[中文](./README.md)

A local EPUB reader extension for Cursor and VS Code. It opens `.epub` files with a custom editor instead of treating them as plain text, parses the EPUB package in the extension host, and renders a focused reading experience in a webview.

![Cursor EPUB Reader AI screenshot](./media/screenshot2.png)

## Highlights

- **Native EPUB opening**: double-click or right-click `.epub` files and open them with EPUB Reader.
- **Built-in EPUB parser**: reads ZIP, OPF, spine, EPUB 3 `nav.xhtml`, and EPUB 2 `toc.ncx` without runtime npm dependencies.
- **Comfortable reading**: table of contents, previous/next chapter navigation, edge-scroll chapter switching, immersive mode, current-chapter search, themes, font size controls, reading progress, and persisted reading position.
- **AI reading assistant**: connect OpenAI, DeepSeek, OpenAI-compatible APIs, or Ollama for chapter summaries, selected-text explanations, Q&A, streamed responses, Markdown reading notes, and custom slash commands.
- **Local-first safety**: EPUB content is cleaned before rendering; webviews use CSP; AI requests are only sent when you explicitly trigger an AI action.

## Usage

- Open an `.epub` file from Explorer, or run `EPUB Reader: Open EPUB` from the command palette.
- Use the toolbar to switch the table of contents, open the AI panel, navigate chapters, change font size, switch themes, and search the current chapter.
- Scroll beyond the chapter bottom/top to move to the next/previous chapter.
- Use the small top-right button to hide or show the reader chrome.

## AI Features

AI features are disabled by default. Run `EPUB Reader: Configure AI Provider` and choose OpenAI, DeepSeek, OpenAI-compatible, or Ollama. API keys are stored in SecretStorage, not in project files or normal settings.

DeepSeek defaults to `https://api.deepseek.com` and `deepseek-v4-flash`, and both can be changed in settings or during configuration.

After configuration, open the AI panel and type directly in the bottom composer, or type `/` to choose a command:

- `/总结本章`
- `/章节笔记`
- `/解读选中`
- `/总结选中`
- `/提问`
- `/翻译`
- `/同风格写作`

Select text in the chapter and right-click to send that selection into the AI composer. AI responses stream when the provider supports streaming, and each answer includes copy and save-note actions.

Notes are saved next to the EPUB file by default with names like `Z0001_命令名_章节名.md`. You can customize this with `cursorEpub.ai.noteFileNamePattern`.

## Custom Prompts And Commands

You can customize prompts and slash commands in Cursor/VS Code settings:

- `cursorEpub.ai.prompts`: override prompt templates such as `system`, `chapterSummary`, `selectionExplain`, `selectionSummary`, `chapterNote`, `qa`, and `customCommand`.
- `cursorEpub.ai.commands`: add or override slash commands. Commands with the same `label` as built-ins replace that built-in command.

Prompt examples and all supported variables are documented in [docs/AI_PROMPT_CONFIG.md](./docs/AI_PROMPT_CONFIG.md).

## Privacy

The extension does not automatically upload EPUB content. It sends only the selected text or chapter context required for the AI action you explicitly start, and only to the AI provider you configure.

## Development

```bash
npm run check
```

Open this folder in Cursor or VS Code, press `F5` to start the Extension Development Host, then open an `.epub` file.

## Install From VSIX

```bash
npm run package
```

Then install the generated package:

```bash
cursor --install-extension z-epub-reader-0.2.1.vsix
code --install-extension z-epub-reader-0.2.1.vsix
```

## Current Limits

- Supports common Stored/Deflated EPUB ZIP entries.
- Does not support encrypted EPUB files, split ZIP archives, or ZIP64.
- Does not modify EPUB files.
- Does not call Cursor's built-in Agent or inject into Cursor Chat; it uses your configured AI provider.

## Support

- Privacy details: [PRIVACY.md](./PRIVACY.md)
- Support and feedback: [SUPPORT.md](./SUPPORT.md)
