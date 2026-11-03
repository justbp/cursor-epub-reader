# Privacy Policy

Cursor EPUB Reader is a local reader extension for Cursor and VS Code-compatible editors.

## Data Access

- The extension reads EPUB files only when you open them with the reader.
- Book content is parsed locally in the extension host and rendered locally in the editor webview.
- Reading state, such as the current chapter, scroll position, theme, font size, sidebar visibility and immersive mode, is stored locally through the editor's workspace state.
- AI provider API keys are stored through the editor's SecretStorage.
- Generated AI notes are saved only when you explicitly ask the extension to save them.

## Network

- The extension does not upload EPUB files, book content, reading progress or usage data during normal reading.
- AI features are optional and disabled by default. If you configure an AI provider and start an AI action, the extension sends only the selected text or current chapter text needed for that action to the configured provider.
- The extension does not include telemetry or analytics.
- If you click an external HTTP, HTTPS or mail link inside a book, the editor may open that link through your system browser or mail client.

## Contact

For questions or reports, use the support link in `SUPPORT.md`.
