# Changelog

## 0.2.1 - 2026-05-27

- Fixed chapter parsing for EPUB files that split a chapter title/image page and the actual chapter body into consecutive spine documents.
- Added enhanced parsing for EPUB files whose official TOC only lists top-level books while nested chapter links are stored in embedded contents pages.
- Preserved TOC anchor fragments so nested chapter entries can jump to the correct position inside a document.

## 0.2.0 - 2026-05-27

- Added optional AI provider configuration for OpenAI, OpenAI-compatible APIs and Ollama.
- Added first-class DeepSeek provider support with default DeepSeek base URL and model.
- Redesigned the AI panel around a bottom composer with slash commands and selected-text context actions.
- Added streamed AI responses, a visible stop-generation button, and configurable AI prompt/command settings.
- Added per-answer copy/save actions and support for saving AI notes next to the EPUB file.
- Updated AI note file names to a configurable auto-incrementing pattern.
- Added preset AI commands for translation and same-style writing.
- Added AI panel actions for chapter summaries, selected-text explanations, chapter Q&A and Markdown reading-note generation.
- Added local Markdown note saving with SecretStorage-backed API key handling.
- Added chapter plain-text extraction and AI helper tests.

## 0.1.0

- Initial Cursor-compatible EPUB custom editor.
- Opens `.epub` files through a read-only webview reader.
- Parses EPUB ZIP, `container.xml`, OPF manifest/spine, EPUB 3 navigation and EPUB 2 NCX without runtime dependencies.
- Supports table of contents, images, linked CSS, current-chapter search, immersive chrome toggle, themes, font size, automatic chapter navigation at reading edges, reading progress and persisted reading state.
