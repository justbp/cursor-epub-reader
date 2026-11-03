"use strict";

const path = require("path");
const vscode = require("vscode");
const { parseEpub } = require("./lib/epub");
const { synthesizeEdgeSpeech } = require("./lib/edge-tts");

const VIEW_TYPE = "cursorEpub.reader";

function activate(context) {
  const output = vscode.window.createOutputChannel("Cursor EPUB Reader");
  output.appendLine(`[${new Date().toISOString()}] Activating Cursor EPUB Reader.`);
  context.subscriptions.push(output);

  const provider = new EpubEditorProvider(context, output);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorEpub.openFile", async (uri) => {
      const target = uri || (await pickEpubFile());
      if (target) {
        output.appendLine(`[${new Date().toISOString()}] Opening EPUB with reader: ${target.toString()}`);
        await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorEpub.reopenAsReader", async (uri) => {
      const target = uri || vscode.window.activeTextEditor?.document.uri || (await pickEpubFile());
      if (target) {
        output.appendLine(`[${new Date().toISOString()}] Reopening EPUB with reader: ${target.toString()}`);
        await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorEpub.clearReadingState", async (uri) => {
      const target = uri || vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showInformationMessage("Open an EPUB first, then clear its reading state.");
        return;
      }
      await context.workspaceState.update(stateKey(target), undefined);
      vscode.window.showInformationMessage("EPUB reading state cleared.");
    })
  );
}

function deactivate() {}

const LISTEN_SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const EDGE_VOICE_PATTERN = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;

class EpubEditorProvider {
  constructor(context, output) {
    this.context = context;
    this.output = output;
    this._ttsSessions = new Map();
    this._ttsChain = Promise.resolve();
    this._ttsGapUntil = 0;
  }

  async openCustomDocument(uri) {
    this._log(`openCustomDocument: ${uri.toString()}`);
    const document = new EpubDocument(uri);
    await document.load();
    if (document.error) {
      this._log(`document load error: ${document.error}`);
    } else {
      this._log(`document loaded: ${document.book ? document.book.title : "unknown"}`);
    }
    return document;
  }

  async resolveCustomEditor(document, webviewPanel) {
    this._log(`resolveCustomEditor: ${document.uri.toString()}`);
    try {
      await this._resolveCustomEditor(document, webviewPanel);
      this._log(`resolveCustomEditor completed: ${document.uri.toString()}`);
    } catch (error) {
      const message = readableError(error);
      this._log(`resolveCustomEditor failed: ${message}`);
      vscode.window.showErrorMessage(`EPUB Reader failed to open: ${message}`);
      webviewPanel.webview.html = errorHtml(message);
    }
  }

  async _resolveCustomEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    const disposables = [];

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    const savedState = this.context.workspaceState.get(stateKey(document.uri), {});
    this._log("creating webview payload");
    const payload = this._createPayload(document, savedState);

    webviewPanel.title = document.book ? document.book.title : path.basename(document.uri.fsPath || document.uri.path);
    this._log("assigning webview html");
    webview.html = this._html(webview, payload);
    this._log("webview html assigned");

    this._ttsSessions.set(webview, { jobs: new Map() });
    disposables.push(
      webview.onDidReceiveMessage(async (message) => {
        await this._handleMessage(document, webview, message);
      })
    );

    webviewPanel.onDidDispose(() => {
      this._cancelTts(webview);
      this._ttsSessions.delete(webview);
      while (disposables.length > 0) {
        const disposable = disposables.pop();
        disposable.dispose();
      }
      document.dispose();
    });
  }

  _log(message) {
    if (this.output) {
      this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
  }

  _createPayload(document, savedState) {
    if (document.error || !document.book) {
      return {
        ok: false,
        error: document.error || "EPUB failed to load.",
        state: savedState || {},
      };
    }

    const chapterIndex = clampNumber(savedState.chapterIndex, 0, document.book.chapters.length - 1, 0);
    let chapter = null;
    let chapterError = "";

    try {
      chapter = document.book.renderChapter(chapterIndex);
    } catch (error) {
      chapterError = readableError(error);
    }

    return {
      ok: true,
      book: serializeBook(document.book),
      chapter,
      chapterError,
      state: {
        theme: "system",
        fontSize: 18,
        sidebarOpen: true,
        chromeHidden: false,
        hideImages: false,
        listenEngine: "system",
        listenSpeed: 1,
        listenVoice: "auto",
        sidebarWidth: 288,
        chapterWidth: 0,
        scrollTops: {},
        ...savedState,
        chapterIndex,
      },
    };
  }

  async _handleMessage(document, webview, message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "loadChapter") {
      const index = Number(message.index);
      if (!document.book || !Number.isInteger(index)) {
        return;
      }

      try {
        const chapter = document.book.renderChapter(index);
        await webview.postMessage({ type: "chapterContent", chapter });
      } catch (error) {
        await webview.postMessage({
          type: "chapterError",
          index,
          error: readableError(error),
        });
      }
      return;
    }

    if (message.type === "saveState") {
      const cleanState = sanitizeState(message.state);
      await this.context.workspaceState.update(stateKey(document.uri), cleanState);
      return;
    }

    if (message.type === "openExternal" && typeof message.href === "string") {
      if (/^(https?:|mailto:)/i.test(message.href)) {
        await vscode.env.openExternal(vscode.Uri.parse(message.href));
      }
      return;
    }

    if (message.type === "ttsStop") {
      this._cancelTts(webview);
      return;
    }

    if (message.type === "ttsSpeak") {
      await this._speak(webview, message);
    }
  }

  _cancelTts(webview) {
    const session = this._ttsSessions.get(webview);
    if (!session) {
      return;
    }
    for (const job of session.jobs.values()) {
      job.cancel();
    }
    session.jobs.clear();
  }

  async _speak(webview, message) {
    const id = typeof message.id === "string" ? message.id.slice(0, 80) : "";
    const text = typeof message.text === "string" ? message.text.replace(/\s+/g, " ").trim() : "";
    const voice = typeof message.voice === "string" ? message.voice : "";
    const speed = LISTEN_SPEEDS.includes(Number(message.speed)) ? Number(message.speed) : 1;
    if (!id) {
      return;
    }
    if (!text || text.length > 2000 || !EDGE_VOICE_PATTERN.test(voice)) {
      await webview.postMessage({ type: "ttsAudio", id, error: "朗读参数无效" });
      return;
    }

    const session = this._ttsSessions.get(webview);
    if (!session || session.jobs.has(id)) {
      return;
    }

    const handle = {
      cancelled: false,
      current: null,
      cancel() {
        this.cancelled = true;
        if (this.current) {
          this.current.cancel();
        }
        if (this._timer) {
          clearTimeout(this._timer);
          this._timer = 0;
        }
        if (this._rejectDelay) {
          const rejectDelay = this._rejectDelay;
          this._rejectDelay = null;
          rejectDelay(new Error("cancelled"));
        }
      },
    };
    session.jobs.set(id, handle);
    try {
      const audio = await this._enqueueTts(() => this._synthesizeWithRetry(webview, id, handle, text, voice, speed));
      if (handle.cancelled || !session.jobs.has(id)) {
        return;
      }
      await webview.postMessage({ type: "ttsAudio", id, audio: audio.toString("base64") });
    } catch (error) {
      if (handle.cancelled || !session.jobs.has(id)) {
        return;
      }
      const detail = speakError(error);
      this._log(`Edge TTS failed: ${detail}`);
      await webview.postMessage({ type: "ttsAudio", id, error: detail });
    } finally {
      session.jobs.delete(id);
    }
  }

  _enqueueTts(task) {
    const run = this._ttsChain.then(async () => {
      const wait = this._ttsGapUntil - Date.now();
      if (wait > 0) {
        await delay(wait);
      }
      try {
        return await task();
      } finally {
        this._ttsGapUntil = Date.now() + 700;
      }
    });
    this._ttsChain = run.then(() => {}, () => {});
    return run;
  }

  async _synthesizeWithRetry(webview, id, handle, text, voice, speed) {
    const waits = [2000, 5000, 10000];
    for (let attempt = 0; attempt <= waits.length; attempt += 1) {
      if (handle.cancelled) {
        throw new Error("cancelled");
      }
      const job = synthesizeEdgeSpeech(text, { voice, speed, timeout: 20000 });
      handle.current = job;
      try {
        return await job.promise;
      } catch (error) {
        if (handle.cancelled || !isRateLimitError(error) || attempt === waits.length) {
          throw error;
        }
        this._log(`Edge TTS rate limited, retry in ${waits[attempt]}ms`);
        await webview.postMessage({ type: "ttsStatus", id, text: "Edge 语音限流了，正在等待后重试。" });
        await cancellableDelay(waits[attempt], handle);
      }
    }
    throw new Error("Edge 语音暂时限流");
  }

  _html(webview, payload) {
    const nonce = createNonce();
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "reader.css")).with({ query: "v=listen-voice-1" });
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "reader.js")).with({ query: "v=listen-voice-1" });
    const data = safeJson(payload);
    const chapterLang = payload && payload.book && payload.book.language
      ? String(payload.book.language).replace(/[^A-Za-z0-9-]/g, "")
      : "";

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource}; font-src data:; media-src blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${stylesUri}">
  <title>EPUB Reader</title>
</head>
<body>
  <div id="app" class="reader-app">
    <header class="topbar">
      <button class="icon-button" type="button" data-action="toggleSidebar" title="目录" aria-label="目录">☰</button>
      <div class="title-block">
        <div id="bookTitle" class="book-title"></div>
        <div id="chapterTitle" class="chapter-title"></div>
      </div>
      <div class="toolbar" aria-label="阅读控制">
        <button class="icon-button" type="button" data-action="prev" title="上一章" aria-label="上一章">‹</button>
        <button class="icon-button" type="button" data-action="next" title="下一章" aria-label="下一章">›</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button class="text-button" type="button" data-action="fontDown" title="减小字号" aria-label="减小字号">A-</button>
        <button class="text-button" type="button" data-action="fontUp" title="增大字号" aria-label="增大字号">A+</button>
        <button id="imageToggle" class="text-button" type="button" data-action="toggleImages" title="隐藏图片" aria-label="隐藏图片" aria-pressed="false">图</button>
        <div class="listen-controls">
          <button id="listenToggle" class="text-button" type="button" data-action="toggleListen" title="朗读本书" aria-label="朗读本书" aria-pressed="false">听</button>
          <button id="listenSettings" class="text-button" type="button" data-action="toggleListenPanel" title="朗读设置" aria-label="朗读设置" aria-expanded="false">声</button>
          <div id="listenPanel" class="listen-panel" hidden>
            <label class="listen-field">引擎
              <select id="listenEngine" aria-label="朗读引擎">
                <option value="system">系统语音</option>
                <option value="edge">Edge TTS</option>
              </select>
            </label>
            <div class="listen-field">声音
              <div id="listenVoice" class="listen-voice-list" role="listbox" aria-label="朗读声音"></div>
            </div>
            <label class="listen-field">语速
              <select id="listenSpeed" aria-label="朗读语速">
                <option value="0.75">0.75×</option>
                <option value="1">1×</option>
                <option value="1.25">1.25×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2×</option>
              </select>
            </label>
            <p id="listenHint" class="listen-hint">系统语音走本机，可离线。Edge TTS 需要联网，当前句子会发到微软语音服务，不用密钥。</p>
          </div>
        </div>
        <select id="themeSelect" class="theme-select" title="主题" aria-label="主题">
          <option value="system">跟随 Cursor</option>
          <option value="light">浅色</option>
          <option value="sepia">护眼</option>
          <option value="dark">深色</option>
        </select>
        <input id="searchInput" class="search-input" type="search" placeholder="搜索当前章节" aria-label="搜索当前章节">
        <button id="chromeToggle" class="icon-button chrome-toggle" type="button" data-action="toggleChrome" title="专注阅读" aria-label="专注阅读">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h5v1.2H3.2V7H2V2zm7 0h5v5h-1.2V3.2H9V2zM2 9h1.2v3.8H7V14H2V9zm9.8 3.8V9H14v5H9v-1.2h2.8z"/></svg>
        </button>
      </div>
    </header>
    <div class="reader-body">
      <aside id="sidebar" class="sidebar" aria-label="目录">
        <div id="tocPanel" class="sidebar-panel toc-panel">
          <ol id="toc" class="toc"></ol>
        </div>
        <div id="sidebarResizer" class="sidebar-resizer" title="拖动调节目录宽度" role="separator" aria-orientation="vertical" aria-label="调节目录宽度"></div>
      </aside>
      <main id="readingPane" class="reading-pane">
        <div id="message" class="message" hidden></div>
        <div id="chapterShell" class="chapter-shell">
          <div id="chapterResizerLeft" class="chapter-resizer left" title="拖动调节正文宽度" role="separator" aria-orientation="vertical" aria-label="调节正文宽度"></div>
          <article id="article" class="chapter"${chapterLang ? ` lang="${chapterLang}"` : ""}></article>
          <div id="chapterResizerRight" class="chapter-resizer right" title="拖动调节正文宽度" role="separator" aria-orientation="vertical" aria-label="调节正文宽度"></div>
        </div>
      </main>
    </div>
    <footer class="statusbar">
      <span id="progressLabel"></span>
      <div class="progress-track" aria-hidden="true"><div id="progressFill" class="progress-fill"></div></div>
    </footer>
  </div>
  <button id="sidebarToggle" class="icon-button sidebar-toggle" type="button" data-action="toggleSidebar" title="目录" aria-label="目录" aria-expanded="true">☰</button>
  <script nonce="${nonce}">window.__EPUB_READER_DATA__ = ${data};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

class EpubDocument {
  constructor(uri) {
    this.uri = uri;
    this.book = null;
    this.error = "";
  }

  async load() {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.uri);
      this.book = parseEpub(Buffer.from(bytes), path.basename(this.uri.fsPath || this.uri.path || "Untitled EPUB"));
      this.error = "";
    } catch (error) {
      this.book = null;
      this.error = readableError(error);
    }
  }

  dispose() {}
}

async function pickEpubFile() {
  const files = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      EPUB: ["epub"],
    },
    title: "Open EPUB",
  });

  return files && files[0];
}

function serializeBook(book) {
  return {
    title: book.title,
    author: book.author,
    language: book.language,
    chapters: book.chapters.map((chapter) => ({
      index: chapter.index,
      id: chapter.id,
      title: chapter.title,
      level: chapter.level,
      fragment: chapter.fragment || "",
    })),
    stats: book.stats,
  };
}

function sanitizeState(state) {
  const input = state && typeof state === "object" ? state : {};
  const scrollTops = {};

  if (input.scrollTops && typeof input.scrollTops === "object") {
    for (const [key, value] of Object.entries(input.scrollTops)) {
      const index = String(Number(key));
      const top = Number(value);
      if (Number.isInteger(Number(key)) && Number.isFinite(top) && top >= 0) {
        scrollTops[index] = Math.round(top);
      }
    }
  }

  return {
    chapterIndex: Math.max(0, Math.floor(Number(input.chapterIndex) || 0)),
    theme: ["system", "light", "sepia", "dark"].includes(input.theme) ? input.theme : "system",
    fontSize: clampNumber(input.fontSize, 14, 28, 18),
    sidebarOpen: input.sidebarOpen !== false,
    chromeHidden: input.chromeHidden === true,
    hideImages: input.hideImages === true,
    listenEngine: input.listenEngine === "edge" ? "edge" : "system",
    listenSpeed: LISTEN_SPEEDS.includes(Number(input.listenSpeed)) ? Number(input.listenSpeed) : 1,
    listenVoice: typeof input.listenVoice === "string" && input.listenVoice.length <= 120 ? input.listenVoice : "auto",
    sidebarWidth: clampNumber(input.sidebarWidth, 180, 560, 288),
    chapterWidth: clampNumber(input.chapterWidth, 0, 4000, 0),
    scrollTops,
  };
}

function stateKey(uri) {
  return `cursorEpub.state:${uri.toString()}`;
}

function readableError(error) {
  return error && error.message ? error.message : String(error || "Unknown error.");
}

function isRateLimitError(error) {
  return /429|too many requests|rate limit/i.test(readableError(error));
}

function speakError(error) {
  if (isRateLimitError(error)) {
    return "Edge 语音暂时限流，请等一两分钟，或先改用系统语音。";
  }
  return readableError(error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cancellableDelay(ms, handle) {
  return new Promise((resolve, reject) => {
    if (handle.cancelled) {
      reject(new Error("cancelled"));
      return;
    }
    handle._rejectDelay = reject;
    handle._timer = setTimeout(() => {
      handle._timer = 0;
      handle._rejectDelay = null;
      resolve();
    }, ms);
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function errorHtml(message) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EPUB Reader Error</title>
</head>
<body>
  <main style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px;">
    <h1>EPUB Reader failed to open</h1>
    <pre style="white-space: pre-wrap;">${escapeHtml(message)}</pre>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function createRequestId() {
  return `ai-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

module.exports = {
  activate,
  deactivate,
};
