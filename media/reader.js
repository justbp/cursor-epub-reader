"use strict";

const vscode = acquireVsCodeApi();
const initial = window.__EPUB_READER_DATA__ || {};

const elements = {
  aiCommandMenu: document.getElementById("aiCommandMenu"),
  aiComposerInput: document.getElementById("aiComposerInput"),
  aiComposerTags: document.getElementById("aiComposerTags"),
  aiNoteSaved: document.getElementById("aiNoteSaved"),
  aiPanel: document.getElementById("aiPanel"),
  aiProgress: document.getElementById("aiProgress"),
  aiResult: document.getElementById("aiResult"),
  aiModelButton: document.getElementById("aiModelButton"),
  aiSendButton: document.getElementById("aiSendButton"),
  aiStopButton: document.getElementById("aiStopButton"),
  aiStatus: document.getElementById("aiStatus"),
  aiThread: document.getElementById("aiThread"),
  aiTab: document.getElementById("aiTab"),
  article: document.getElementById("article"),
  bookTitle: document.getElementById("bookTitle"),
  chapterTitle: document.getElementById("chapterTitle"),
  chromeToggle: document.getElementById("chromeToggle"),
  imageToggle: document.getElementById("imageToggle"),
  listenEngine: document.getElementById("listenEngine"),
  listenHint: document.getElementById("listenHint"),
  listenPanel: document.getElementById("listenPanel"),
  listenSettings: document.getElementById("listenSettings"),
  listenSpeed: document.getElementById("listenSpeed"),
  listenToggle: document.getElementById("listenToggle"),
  listenVoice: document.getElementById("listenVoice"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  message: document.getElementById("message"),
  progressFill: document.getElementById("progressFill"),
  progressLabel: document.getElementById("progressLabel"),
  readingPane: document.getElementById("readingPane"),
  chapterResizerLeft: document.getElementById("chapterResizerLeft"),
  chapterResizerRight: document.getElementById("chapterResizerRight"),
  searchInput: document.getElementById("searchInput"),
  sidebarResizer: document.getElementById("sidebarResizer"),
  themeSelect: document.getElementById("themeSelect"),
  toc: document.getElementById("toc"),
  tocPanel: document.getElementById("tocPanel"),
  tocTab: document.getElementById("tocTab"),
};

const persisted = vscode.getState() || {};
const state = {
  chapterIndex: 0,
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
  ...initial.state,
  ...persisted,
};

const chapterCache = new Map();
if (initial.chapter) {
  chapterCache.set(initial.chapter.index, initial.chapter);
}

const EDGE_NAVIGATION_THRESHOLD_PX = 32;
const EDGE_NAVIGATION_DELAY_MS = 850;
const EDGE_NAVIGATION_PAUSE_MS = 1200;
const EDGE_WHEEL_THRESHOLD_PX = 96;
const EDGE_WHEEL_RESET_MS = 500;
let saveTimer = 0;
let edgeNavigationTimer = 0;
let edgeNavigationArmedKey = "";
let edgeNavigationPausedUntil = 0;
let edgeWheelDelta = 0;
let edgeWheelDirection = 0;
let edgeWheelResetTimer = 0;
let pendingFragment = "";
let currentSearch = "";
let lastScrollTop = 0;
const pendingChapterOptions = new Map();
const pendingAudio = new Map();
const LISTEN_SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const EDGE_VOICES = [
  ["zh-CN-XiaoxiaoNeural", "晓晓（普通话女）"],
  ["zh-CN-YunxiNeural", "云希（普通话男）"],
  ["zh-CN-XiaoyiNeural", "晓伊（普通话女）"],
  ["zh-CN-YunyangNeural", "云扬（普通话男）"],
  ["zh-HK-HiuMaanNeural", "曉曼（粤语）"],
  ["zh-TW-HsiaoChenNeural", "曉臻（台湾）"],
  ["en-US-AriaNeural", "Aria（美式女）"],
  ["en-US-AndrewNeural", "Andrew（美式男）"],
  ["en-GB-SoniaNeural", "Sonia（英式女）"],
];
const listen = {
  active: false,
  run: 0,
  blocks: [],
  index: 0,
  queue: [],
  nextRequest: 0,
  edgeBusy: false,
  ctx: null,
  sources: new Set(),
  currentUtterance: null,
  highlighted: null,
  audioRequest: 0,
  token: 0,
  emptySkips: 0,
  keepalive: 0,
  paused: false,
  heldEdge: null,
  sessionAudio: null,
  sessionBound: false,
  pendingStart: null,
  savedStart: null,
};

try {
  if (!initial.ok) {
    renderFatalError(initial.error || "EPUB failed to load.");
  } else {
    bootstrapReader();
  }
} catch (error) {
  renderFatalError(error && error.message ? error.message : String(error || "Reader failed to start."));
}

function bootstrapReader() {
  elements.bookTitle.textContent = initial.book.title || "Untitled EPUB";
  elements.themeSelect.value = state.theme;
  document.documentElement.style.setProperty("--reader-font-size", `${state.fontSize}px`);
  applySidebarWidth(state.sidebarWidth);
  applyChapterWidth(state.chapterWidth);
  document.body.classList.toggle("sidebar-open", state.sidebarOpen !== false);
  document.body.dataset.theme = state.theme;
  updateSidebarToggle();
  updateChromeVisibility();
  updateImageVisibility();
  bindListenControls();
  bindListenStart();
  bindMediaSession();

  renderToc();
  bindEvents();
  navigateTo(clamp(state.chapterIndex, 0, initial.book.chapters.length - 1), { restoreScroll: true });
}

function bindEvents() {
  document.body.addEventListener("click", (event) => {
    if (elements.listenPanel && !elements.listenPanel.hidden && !event.target.closest(".listen-controls")) {
      elements.listenPanel.hidden = true;
      if (elements.listenSettings) {
        elements.listenSettings.setAttribute("aria-expanded", "false");
      }
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      handleAction(actionButton.dataset.action);
      return;
    }

    const chapterLink = event.target.closest("a[data-chapter-index]");
    if (chapterLink) {
      event.preventDefault();
      pendingFragment = chapterLink.dataset.fragment || "";
      navigateTo(Number(chapterLink.dataset.chapterIndex), { restoreScroll: false });
      return;
    }

    const externalLink = event.target.closest("a[data-external-link]");
    if (externalLink) {
      event.preventDefault();
      vscode.postMessage({ type: "openExternal", href: externalLink.href });
    }
  });

  elements.toc.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-chapter-index]");
    if (!button) {
      return;
    }
    pendingFragment = button.dataset.fragment || "";
    navigateTo(Number(button.dataset.chapterIndex), { restoreScroll: !pendingFragment });
  });

  elements.themeSelect.addEventListener("change", () => {
    state.theme = elements.themeSelect.value;
    document.body.dataset.theme = state.theme;
    saveStateSoon();
  });

  elements.searchInput.addEventListener("input", () => {
    currentSearch = elements.searchInput.value.trim();
    applySearch();
  });

  bindSidebarResize();
  bindChapterResize();

  elements.readingPane.addEventListener("scroll", () => {
    const scrollTop = elements.readingPane.scrollTop;
    state.scrollTops[String(state.chapterIndex)] = scrollTop;
    updateProgress();
    handleEdgeNavigationOnScroll(scrollTop);
    lastScrollTop = scrollTop;
    saveStateSoon();
  }, { passive: true });

  elements.readingPane.addEventListener("wheel", handleEdgeWheel, { passive: false });

  document.addEventListener("keydown", (event) => {
    if (event.target && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handleAction("prev");
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      handleAction("next");
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "chapterContent" && message.chapter) {
      chapterCache.set(message.chapter.index, message.chapter);
      if (message.chapter.index === state.chapterIndex) {
        const options = pendingChapterOptions.get(message.chapter.index) || { restoreScroll: true };
        pendingChapterOptions.delete(message.chapter.index);
        renderCurrentChapter(options);
      }
    }

    if (message.type === "chapterError" && message.index === state.chapterIndex) {
      showMessage("章节无法读取", message.error || "Unknown chapter error.");
    }

    if (message.type === "ttsStatus" && message.text) {
      setListenHint(message.text);
    }

    if (message.type === "ttsAudio" && message.id) {
      const resolve = pendingAudio.get(message.id);
      if (resolve) {
        pendingAudio.delete(message.id);
        resolve(message);
      }
    }

  });

  window.addEventListener("beforeunload", saveStateNow);
}

function handleAction(action) {
  switch (action) {
    case "toggleSidebar":
      state.sidebarOpen = !state.sidebarOpen;
      document.body.classList.toggle("sidebar-open", state.sidebarOpen);
      updateSidebarToggle();
      saveStateSoon();
      break;
    case "showTocPanel":
      showSidebarPanel("toc");
      break;
    case "toggleChrome":
      state.chromeHidden = !state.chromeHidden;
      updateChromeVisibility();
      saveStateSoon();
      break;
    case "prev":
      navigateTo(state.chapterIndex - 1, { restoreScroll: true });
      break;
    case "next":
      navigateTo(state.chapterIndex + 1, { restoreScroll: true });
      break;
    case "fontDown":
      state.fontSize = clamp(state.fontSize - 1, 14, 28);
      document.documentElement.style.setProperty("--reader-font-size", `${state.fontSize}px`);
      saveStateSoon();
      break;
    case "fontUp":
      state.fontSize = clamp(state.fontSize + 1, 14, 28);
      document.documentElement.style.setProperty("--reader-font-size", `${state.fontSize}px`);
      saveStateSoon();
      break;
    case "toggleImages":
      state.hideImages = !state.hideImages;
      updateImageVisibility();
      saveStateSoon();
      break;
    case "toggleListen":
      toggleListen();
      break;
    case "toggleListenPanel":
      toggleListenPanel();
      break;
  }
}

function navigateTo(index, options = {}) {
  if (!initial.book || initial.book.chapters.length === 0) {
    return;
  }

  pauseEdgeNavigation();
  const nextIndex = clamp(index, 0, initial.book.chapters.length - 1);
  state.scrollTops[String(state.chapterIndex)] = elements.readingPane.scrollTop;
  state.chapterIndex = nextIndex;

  updateChrome();
  renderTocSelection();

  if (!chapterCache.has(nextIndex)) {
    pendingChapterOptions.set(nextIndex, options);
    showMessage("正在载入章节", " ");
    vscode.postMessage({ type: "loadChapter", index: nextIndex });
  } else {
    renderCurrentChapter(options);
  }

  saveStateSoon();
}

function renderCurrentChapter(options = {}) {
  const chapter = chapterCache.get(state.chapterIndex);
  if (!chapter) {
    return;
  }

  pauseEdgeNavigation();
  hideMessage();
  listen.savedStart = null;
  hideListenFromButton();
  elements.article.innerHTML = chapter.html || "";
  applySearch();

  requestAnimationFrame(() => {
    if (pendingFragment) {
      scrollToFragment(pendingFragment);
      pendingFragment = "";
    } else if (options.scrollToBottom) {
      elements.readingPane.scrollTop = Math.max(0, elements.readingPane.scrollHeight - elements.readingPane.clientHeight);
    } else if (options.restoreScroll) {
      elements.readingPane.scrollTop = Number(state.scrollTops[String(state.chapterIndex)] || 0);
    } else {
      elements.readingPane.scrollTop = 0;
    }
    lastScrollTop = elements.readingPane.scrollTop;
    updateProgress();
    if (listen.active) {
      const run = listen.run;
      requestAnimationFrame(() => {
        if (listen.active && listen.run === run) {
          beginListenBlocks(run);
        }
      });
    }
  });
}

function renderToc() {
  elements.toc.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const chapter of initial.book.chapters) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.chapterIndex = String(chapter.index);
    if (chapter.fragment) {
      button.dataset.fragment = chapter.fragment;
    }
    button.title = chapter.title;
    button.textContent = chapter.title || `Chapter ${chapter.index + 1}`;
    button.style.setProperty("--toc-indent", `${8 + Math.min(chapter.level || 0, 5) * 14}px`);
    item.appendChild(button);
    fragment.appendChild(item);
  }

  elements.toc.appendChild(fragment);
  renderTocSelection();
}

function renderTocSelection() {
  for (const button of elements.toc.querySelectorAll("button[data-chapter-index]")) {
    const active = Number(button.dataset.chapterIndex) === state.chapterIndex;
    button.classList.toggle("active", active);
    if (active) {
      button.scrollIntoView({ block: "nearest" });
    }
  }
}

function showSidebarPanel(panel) {
  state.sidebarOpen = true;
  document.body.classList.add("sidebar-open");
  updateSidebarToggle();
  saveStateSoon();
}

function applySidebarWidth(width) {
  state.sidebarWidth = clamp(width, 180, 560);
  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
}

function bindSidebarResize() {
  const resizer = elements.sidebarResizer;
  if (!resizer) {
    return;
  }

  let dragging = false;

  const onPointerMove = (event) => {
    if (!dragging) {
      return;
    }
    applySidebarWidth(event.clientX);
  };

  const onPointerUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("sidebar-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    saveStateNow();
  };

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging = true;
    document.body.classList.add("sidebar-resizing");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

function applyChapterWidth(width) {
  const paneWidth = elements.readingPane ? elements.readingPane.clientWidth : 0;
  const requested = Number(width);
  if (!paneWidth || paneWidth < 240 || !requested || requested >= paneWidth) {
    state.chapterWidth = 0;
    document.documentElement.style.setProperty("--chapter-width", "100%");
    return;
  }
  state.chapterWidth = clamp(requested, Math.min(480, paneWidth), paneWidth);
  document.documentElement.style.setProperty("--chapter-width", `${state.chapterWidth}px`);
}

function bindChapterResize() {
  const handles = [elements.chapterResizerLeft, elements.chapterResizerRight].filter(Boolean);
  if (handles.length === 0 || !elements.readingPane) {
    return;
  }

  let dragging = false;

  const widthFromPointer = (event) => {
    const pane = elements.readingPane.getBoundingClientRect();
    const center = pane.left + pane.width / 2;
    return Math.abs(event.clientX - center) * 2;
  };

  const onPointerMove = (event) => {
    if (!dragging) {
      return;
    }
    applyChapterWidth(widthFromPointer(event));
  };

  const onPointerUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("chapter-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    saveStateNow();
  };

  for (const handle of handles) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragging = true;
      document.body.classList.add("chapter-resizing");
      applyChapterWidth(widthFromPointer(event));
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });

    handle.addEventListener("dblclick", () => {
      applyChapterWidth(elements.readingPane.clientWidth);
      saveStateNow();
    });
  }

  window.addEventListener("resize", () => {
    applyChapterWidth(state.chapterWidth);
  });
}

function renderSidebarPanel() {
  if (elements.tocPanel) {
    elements.tocPanel.hidden = false;
  }
}

function updateSidebarToggle() {
  if (!elements.sidebarToggle) {
    return;
  }
  const open = state.sidebarOpen !== false;
  elements.sidebarToggle.setAttribute("aria-expanded", open ? "true" : "false");
  elements.sidebarToggle.title = open ? "隐藏目录" : "显示目录";
  elements.sidebarToggle.setAttribute("aria-label", elements.sidebarToggle.title);
}

function updateImageVisibility() {
  const hidden = state.hideImages === true;
  document.body.classList.toggle("hide-images", hidden);
  if (!elements.imageToggle) {
    return;
  }
  elements.imageToggle.setAttribute("aria-pressed", hidden ? "true" : "false");
  elements.imageToggle.title = hidden ? "显示图片" : "隐藏图片";
  elements.imageToggle.setAttribute("aria-label", elements.imageToggle.title);
  elements.imageToggle.textContent = hidden ? "无图" : "图";
}

function updateChrome() {
  const chapter = initial.book.chapters[state.chapterIndex];
  elements.chapterTitle.textContent = chapter ? chapter.title : "";
  elements.progressLabel.textContent = `${state.chapterIndex + 1} / ${initial.book.chapters.length}`;
  syncMediaSession();
  setButtonDisabled("prev", state.chapterIndex <= 0);
  setButtonDisabled("next", state.chapterIndex >= initial.book.chapters.length - 1);
}

function updateChromeVisibility() {
  document.body.classList.toggle("chrome-hidden", state.chromeHidden === true);
  if (elements.chromeToggle) {
    const toolbar = document.querySelector(".toolbar");
    const app = document.getElementById("app");
    if (state.chromeHidden && app) {
      app.appendChild(elements.chromeToggle);
    } else if (toolbar && elements.chromeToggle.parentElement !== toolbar) {
      toolbar.appendChild(elements.chromeToggle);
    }
    const listenControls = document.querySelector(".listen-controls");
    if (state.chromeHidden && app && listenControls) {
      app.appendChild(listenControls);
    } else if (toolbar && listenControls && elements.chromeToggle && listenControls.parentElement !== toolbar) {
      toolbar.insertBefore(listenControls, elements.chromeToggle);
    }
    const enterFocusIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h5v1.2H3.2V7H2V2zm7 0h5v5h-1.2V3.2H9V2zM2 9h1.2v3.8H7V14H2V9zm9.8 3.8V9H14v5H9v-1.2h2.8z"/></svg>';
    const exitFocusIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 2v1.2H3.2V6.2H2V2h4.2zm3.6 0H14v4.2h-1.2V3.2H9.8V2zM2 9.8h1.2v3h3v1.2H2V9.8zm9.6 3h3v1.2H9.8v-4.2h1.2v3z"/></svg>';
    elements.chromeToggle.innerHTML = state.chromeHidden ? exitFocusIcon : enterFocusIcon;
    elements.chromeToggle.title = state.chromeHidden ? "显示工具栏" : "专注阅读";
    elements.chromeToggle.setAttribute("aria-label", elements.chromeToggle.title);
  }
  requestAnimationFrame(updateProgress);
}

function setButtonDisabled(action, disabled) {
  for (const button of document.querySelectorAll(`[data-action="${action}"]`)) {
    button.disabled = disabled;
  }
}

function updateProgress() {
  const max = Math.max(1, elements.readingPane.scrollHeight - elements.readingPane.clientHeight);
  const percent = clamp((elements.readingPane.scrollTop / max) * 100, 0, 100);
  elements.progressFill.style.width = `${percent}%`;
}

function applySearch() {
  removeSearchMarks();
  if (!currentSearch) {
    return;
  }

  const needle = currentSearch.toLocaleLowerCase();
  const walker = document.createTreeWalker(elements.article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.toLocaleLowerCase().includes(needle)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement && ["SCRIPT", "STYLE", "MARK"].includes(node.parentElement.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  for (const node of nodes) {
    markMatches(node, currentSearch);
  }

  const first = elements.article.querySelector("mark.search-hit");
  if (first) {
    pauseEdgeNavigation();
    first.scrollIntoView({ block: "center" });
  }
}

function markMatches(textNode, term) {
  const text = textNode.nodeValue;
  const lower = text.toLocaleLowerCase();
  const needle = term.toLocaleLowerCase();
  const fragment = document.createDocumentFragment();
  let offset = 0;

  while (offset < text.length) {
    const index = lower.indexOf(needle, offset);
    if (index < 0) {
      fragment.appendChild(document.createTextNode(text.slice(offset)));
      break;
    }

    if (index > offset) {
      fragment.appendChild(document.createTextNode(text.slice(offset, index)));
    }

    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = text.slice(index, index + term.length);
    fragment.appendChild(mark);
    offset = index + term.length;
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

function removeSearchMarks() {
  const marks = Array.from(elements.article.querySelectorAll("mark.search-hit"));
  for (const mark of marks) {
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
  }
  elements.article.normalize();
}

function showMessage(title, detail) {
  cancelEdgeNavigation();
  if (listen.active) {
    stopListenPlayback();
  }
  elements.article.innerHTML = "";
  elements.message.hidden = false;
  elements.message.innerHTML = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail || "")}</p>`;
}

function hideMessage() {
  elements.message.hidden = true;
  elements.message.textContent = "";
}

function renderFatalError(error) {
  document.body.dataset.theme = "system";
  elements.bookTitle.textContent = "EPUB Reader";
  elements.chapterTitle.textContent = "无法打开文件";
  showMessage("无法打开 EPUB", error);
}

function scrollToFragment(fragment) {
  const target = document.getElementById(fragment) || elements.article.querySelector(`[name="${cssEscape(fragment)}"]`);
  pauseEdgeNavigation();
  if (target) {
    target.scrollIntoView({ block: "start" });
  } else {
    elements.readingPane.scrollTop = 0;
  }
}

function handleEdgeNavigationOnScroll(scrollTop) {
  if (!initial.book || state.chapterIndex >= initial.book.chapters.length - 1) {
    cancelEdgeNavigation();
    return;
  }

  if (!elements.message.hidden || Date.now() < edgeNavigationPausedUntil) {
    cancelEdgeNavigation();
    return;
  }

  const { maxScroll } = getScrollInfo();
  const isScrollableChapter = maxScroll > EDGE_NAVIGATION_THRESHOLD_PX;
  const isScrollingDown = scrollTop >= lastScrollTop - 1;
  const isAtBottom = maxScroll - scrollTop <= EDGE_NAVIGATION_THRESHOLD_PX;

  if (!isScrollableChapter || !isScrollingDown || !isAtBottom) {
    cancelEdgeNavigation();
    return;
  }

  scheduleEdgeNavigation(1, EDGE_NAVIGATION_DELAY_MS);
}

function handleEdgeWheel(event) {
  if (!initial.book || !elements.message.hidden || Date.now() < edgeNavigationPausedUntil) {
    resetEdgeWheel();
    return;
  }

  const deltaY = normalizeWheelDeltaY(event);
  if (Math.abs(deltaY) < 1) {
    return;
  }

  const direction = deltaY > 0 ? 1 : -1;
  const { isAtTop, isAtBottom, isShortChapter } = getScrollInfo();
  const canGoNext = state.chapterIndex < initial.book.chapters.length - 1;
  const canGoPrev = state.chapterIndex > 0;
  const wantsNext = direction > 0 && canGoNext && (isAtBottom || isShortChapter);
  const wantsPrev = direction < 0 && canGoPrev && (isAtTop || isShortChapter);

  if (!wantsNext && !wantsPrev) {
    resetEdgeWheel();
    return;
  }

  event.preventDefault();
  accumulateEdgeWheel(direction, Math.abs(deltaY));
}

function accumulateEdgeWheel(direction, delta) {
  if (edgeWheelDirection !== direction) {
    resetEdgeWheel();
    edgeWheelDirection = direction;
  }

  edgeWheelDelta += delta;
  clearTimeout(edgeWheelResetTimer);
  edgeWheelResetTimer = setTimeout(resetEdgeWheel, EDGE_WHEEL_RESET_MS);

  if (edgeWheelDelta >= EDGE_WHEEL_THRESHOLD_PX) {
    scheduleEdgeNavigation(direction, 120);
  }
}

function scheduleEdgeNavigation(direction, delay) {
  const targetIndex = state.chapterIndex + direction;
  if (targetIndex < 0 || targetIndex >= initial.book.chapters.length) {
    cancelEdgeNavigation();
    return;
  }

  const { maxScroll, isAtTop, isAtBottom, isShortChapter } = getScrollInfo();
  const stillAtEdge = direction > 0 ? isAtBottom || isShortChapter : isAtTop || isShortChapter;
  if (!stillAtEdge || Date.now() < edgeNavigationPausedUntil) {
    cancelEdgeNavigation();
    return;
  }

  const armedKey = `${state.chapterIndex}:${direction}:${Math.round(maxScroll)}`;
  if (edgeNavigationTimer && edgeNavigationArmedKey === armedKey) {
    return;
  }

  cancelEdgeNavigationTimer();
  edgeNavigationArmedKey = armedKey;
  edgeNavigationTimer = setTimeout(() => {
    edgeNavigationTimer = 0;
    edgeNavigationArmedKey = "";

    const latest = getScrollInfo();
    const latestAtEdge = direction > 0
      ? latest.isAtBottom || latest.isShortChapter
      : latest.isAtTop || latest.isShortChapter;
    const latestTargetIndex = state.chapterIndex + direction;

    if (
      latestAtEdge &&
      latestTargetIndex >= 0 &&
      latestTargetIndex < initial.book.chapters.length &&
      Date.now() >= edgeNavigationPausedUntil
    ) {
      resetEdgeWheel();
      navigateTo(latestTargetIndex, {
        restoreScroll: false,
        scrollToBottom: direction < 0,
      });
    }
  }, delay);
}

function pauseEdgeNavigation(duration = EDGE_NAVIGATION_PAUSE_MS) {
  edgeNavigationPausedUntil = Date.now() + duration;
  cancelEdgeNavigation();
}

function cancelEdgeNavigation() {
  cancelEdgeNavigationTimer();
  resetEdgeWheel();
}

function cancelEdgeNavigationTimer() {
  if (edgeNavigationTimer) {
    clearTimeout(edgeNavigationTimer);
    edgeNavigationTimer = 0;
  }
  edgeNavigationArmedKey = "";
}

function resetEdgeWheel() {
  edgeWheelDelta = 0;
  edgeWheelDirection = 0;
  if (edgeWheelResetTimer) {
    clearTimeout(edgeWheelResetTimer);
    edgeWheelResetTimer = 0;
  }
}

function getScrollInfo() {
  const scrollTop = elements.readingPane.scrollTop;
  const maxScroll = Math.max(0, elements.readingPane.scrollHeight - elements.readingPane.clientHeight);
  return {
    scrollTop,
    maxScroll,
    isAtTop: scrollTop <= EDGE_NAVIGATION_THRESHOLD_PX,
    isAtBottom: maxScroll - scrollTop <= EDGE_NAVIGATION_THRESHOLD_PX,
    isShortChapter: maxScroll <= EDGE_NAVIGATION_THRESHOLD_PX,
  };
}

function normalizeWheelDeltaY(event) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(1, elements.readingPane.clientHeight);
  }
  return event.deltaY;
}

function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStateNow();
  }, 180);
}

function saveStateNow() {
  clearTimeout(saveTimer);
  const cleanState = {
    chapterIndex: state.chapterIndex,
    theme: state.theme,
    fontSize: state.fontSize,
    sidebarOpen: state.sidebarOpen,
    chromeHidden: state.chromeHidden,
    hideImages: state.hideImages === true,
    listenEngine: state.listenEngine === "edge" ? "edge" : "system",
    listenSpeed: LISTEN_SPEEDS.includes(Number(state.listenSpeed)) ? Number(state.listenSpeed) : 1,
    listenVoice: state.listenVoice || "auto",
    sidebarWidth: state.sidebarWidth,
    chapterWidth: state.chapterWidth,
    scrollTops: state.scrollTops,
  };
  vscode.setState(cleanState);
  vscode.postMessage({ type: "saveState", state: cleanState });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LISTEN_HINT = "系统语音走本机，可离线。Edge TTS 需要联网，当前句子会发到微软语音服务，不用密钥。";
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, pre, td";

function bindListenControls() {
  if (!elements.listenEngine || !elements.listenVoice || !elements.listenSpeed) {
    return;
  }
  elements.listenEngine.value = state.listenEngine === "edge" ? "edge" : "system";
  elements.listenSpeed.value = LISTEN_SPEEDS.includes(Number(state.listenSpeed)) ? String(state.listenSpeed) : "1";
  fillListenVoices();
  updateListenButton();
  elements.listenEngine.addEventListener("change", () => {
    state.listenEngine = elements.listenEngine.value === "edge" ? "edge" : "system";
    state.listenVoice = "auto";
    fillListenVoices();
    setListenHint(LISTEN_HINT);
    restartListenSettings();
  });
  elements.listenVoice.addEventListener("click", (event) => {
    const button = event.target.closest("[data-voice]");
    if (!button) {
      return;
    }
    event.stopPropagation();
    state.listenVoice = button.dataset.voice || "auto";
    markListenVoice(state.listenVoice);
    restartListenSettings();
  });
  elements.listenSpeed.addEventListener("change", () => {
    const speed = Number(elements.listenSpeed.value);
    state.listenSpeed = LISTEN_SPEEDS.includes(speed) ? speed : 1;
    restartListenSettings();
  });
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      if (state.listenEngine !== "edge") {
        fillListenVoices();
      }
    });
  }
}

function fillListenVoices() {
  const list = elements.listenVoice;
  if (!list) {
    return;
  }
  const previous = state.listenVoice || "auto";
  const options = [{ value: "auto", label: "自动" }];
  if (state.listenEngine === "edge") {
    for (const [id, label] of EDGE_VOICES) {
      options.push({ value: id, label });
    }
  } else if (window.speechSynthesis) {
    for (const voice of window.speechSynthesis.getVoices()) {
      options.push({ value: voice.voiceURI, label: `${voice.name}（${voice.lang}）` });
    }
  }
  const selected = options.some((option) => option.value === previous) ? previous : "auto";
  const signature = options.map((option) => option.value).join("\n");
  if (list.dataset.signature === signature && list.dataset.selected === selected) {
    return;
  }
  state.listenVoice = selected;
  list.dataset.signature = signature;
  list.dataset.selected = selected;
  list.replaceChildren();
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "listen-voice-option";
    button.dataset.voice = option.value;
    button.textContent = option.label;
    button.setAttribute("aria-pressed", option.value === selected ? "true" : "false");
    list.appendChild(button);
  }
}

function markListenVoice(value) {
  const list = elements.listenVoice;
  if (!list) {
    return;
  }
  list.dataset.selected = value;
  for (const button of list.querySelectorAll("[data-voice]")) {
    button.setAttribute("aria-pressed", button.dataset.voice === value ? "true" : "false");
  }
}

function toggleListenPanel() {
  if (!elements.listenPanel) {
    return;
  }
  const willOpen = elements.listenPanel.hidden;
  elements.listenPanel.hidden = !willOpen;
  if (willOpen) {
    placeListenPanel();
  }
  if (elements.listenSettings) {
    elements.listenSettings.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }
}

function placeListenPanel() {
  const anchor = elements.listenSettings || elements.listenToggle;
  const panel = elements.listenPanel;
  if (!anchor || !panel) {
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const width = 248;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 48)}px`;
  panel.style.right = "auto";
}

function toggleListen() {
  if (listen.active) {
    stopListen();
  } else {
    startListen();
  }
}

function startListen() {
  if (!initial.book || !initial.book.chapters.length) {
    return;
  }
  const start = listen.pendingStart || captureListenStart() || connectedStart(listen.savedStart);
  listen.pendingStart = null;
  listen.savedStart = null;
  hideListenFromButton();
  listen.active = true;
  listen.paused = false;
  listen.run += 1;
  listen.emptySkips = 0;
  setListenHint(LISTEN_HINT);
  updateListenButton();
  holdMediaSession();
  prepareListenAudio();
  if (!elements.message.hidden || !(elements.article.innerText || "").trim()) {
    return;
  }
  beginListenBlocks(listen.run, start);
  if (state.listenEngine === "system") {
    armSystemKeepalive();
  }
}

function listenFromSelection(start) {
  if (!start) {
    return;
  }
  listen.pendingStart = start;
  if (listen.active) {
    listen.savedStart = null;
    hideListenFromButton();
    listen.paused = false;
    listen.heldEdge = null;
    listen.run += 1;
    stopListenPlayback();
    const chosen = listen.pendingStart;
    listen.pendingStart = null;
    beginListenBlocks(listen.run, chosen);
    if (state.listenEngine === "system") {
      armSystemKeepalive();
    }
    updateListenButton();
    return;
  }
  startListen();
}

function stopListen() {
  listen.active = false;
  listen.paused = false;
  listen.heldEdge = null;
  listen.run += 1;
  stopListenPlayback();
  clearListenHighlight();
  if (listen.keepalive) {
    clearInterval(listen.keepalive);
    listen.keepalive = 0;
  }
  releaseMediaSession();
  updateListenButton();
}

function restartListenSettings() {
  saveStateSoon();
  updateListenButton();
  if (!listen.active) {
    return;
  }
  listen.paused = false;
  listen.heldEdge = null;
  listen.nextRequest = listen.index;
  listen.queue = [];
  stopListenPlayback();
  if (state.listenEngine === "system") {
    armSystemKeepalive();
    playSystem(listen.run);
  } else {
    prepareListenAudio();
    pumpEdge(listen.run);
  }
}

function beginListenBlocks(run, start) {
  if (!isListenRun(run)) {
    return;
  }
  stopListenPlayback();
  listen.paused = false;
  listen.heldEdge = null;
  listen.blocks = collectListenBlocks();
  const located = start ? applyListenStart(listen.blocks, start) : { index: 0, moved: false };
  listen.index = located.index;
  listen.nextRequest = located.index;
  listen.queue = [];
  if (located.moved) {
    setListenHint("从选中的位置开始朗读。");
  }
  if (!listen.blocks.length) {
    listen.emptySkips += 1;
    if (listen.emptySkips > 8) {
      failListen("后面几章没有可读正文");
      return;
    }
    advanceListenChapter(run);
    return;
  }
  listen.emptySkips = 0;
  if (state.listenEngine === "edge") {
    pumpEdge(run);
  } else {
    armSystemKeepalive();
    playSystem(run);
  }
}

function advanceListenChapter(run) {
  if (!isListenRun(run) || !initial.book) {
    return;
  }
  clearListenHighlight();
  if (state.chapterIndex >= initial.book.chapters.length - 1) {
    stopListen();
    setListenHint("已经读完这本书。");
    return;
  }
  stopListenPlayback();
  navigateTo(state.chapterIndex + 1, { restoreScroll: false });
}

function collectListenBlocks() {
  const chosen = [];

  const addSpoken = (element) => {
    const text = spokenText(element);
    if (!text) {
      return;
    }
    for (const line of text.split(/\n+/)) {
      const cleaned = line.replace(/\s+/g, " ").trim();
      if (!cleaned || isNavLabel(cleaned)) {
        continue;
      }
      const parts = cleaned.split(" ").filter(Boolean);
      if (parts.length > 0 && parts.every((part) => isNavLabel(part))) {
        continue;
      }
      const previous = chosen[chosen.length - 1];
      if (previous && previous.text === cleaned) {
        continue;
      }
      chosen.push({ el: element, text: cleaned });
    }
  };

  const visit = (element) => {
    const leafBlock = element.matches(BLOCK_SELECTOR) && !element.querySelector(BLOCK_SELECTOR);
    const leafFlow = element.matches("div, span") && !element.querySelector(`${BLOCK_SELECTOR}, div, span`);
    if (leafBlock || leafFlow) {
      addSpoken(element);
      return;
    }
    for (const child of element.children) {
      visit(child);
    }
  };

  visit(elements.article);
  if (!chosen.length) {
    addSpoken(elements.article);
  }

  const blocks = [];
  for (const item of chosen) {
    for (const piece of splitSpeakable(item.text)) {
      blocks.push({ el: item.el, text: piece });
    }
  }
  return blocks;
}

function spokenText(element) {
  if (!element) {
    return "";
  }
  const clone = element.cloneNode(true);
  for (const anchor of clone.querySelectorAll("a")) {
    if (isNavLabel(anchor.textContent)) {
      anchor.remove();
    }
  }
  return (clone.innerText || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
}

function isNavLabel(text) {
  return /^(后页|前页|目录|下页|上页|下一页|上一页|返回|回目录|首页)$/.test(String(text || "").replace(/\s+/g, ""));
}

function bindListenStart() {
  const button = ensureListenFromButton();
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    listen.pendingStart = captureListenStart() || connectedStart(listen.savedStart);
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    listenFromSelection(listen.pendingStart || connectedStart(listen.savedStart));
  });
  if (elements.listenToggle) {
    elements.listenToggle.addEventListener("pointerdown", () => {
      if (!listen.active) {
        listen.pendingStart = captureListenStart() || connectedStart(listen.savedStart);
      }
    }, true);
  }
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!elements.article.contains(range.startContainer)) {
      return;
    }
    listen.savedStart = { node: range.startContainer, offset: range.startOffset };
    placeListenFromButton(range);
  });
  elements.article.addEventListener("pointerup", () => {
    const captured = captureListenStart();
    listen.savedStart = captured;
    if (!captured) {
      hideListenFromButton();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("#listenToggle") || target.closest("#listenFromHere") || target.closest("#article")) {
      return;
    }
    listen.savedStart = null;
    hideListenFromButton();
  }, true);
  elements.readingPane.addEventListener("scroll", () => {
    hideListenFromButton();
  }, { passive: true });
}

function ensureListenFromButton() {
  let button = document.getElementById("listenFromHere");
  if (!button) {
    button = document.createElement("button");
    button.id = "listenFromHere";
    button.type = "button";
    button.className = "listen-from-here";
    button.textContent = "从这里读";
    button.hidden = true;
    document.body.appendChild(button);
  }
  return button;
}

function placeListenFromButton(range) {
  const button = ensureListenFromButton();
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  const width = 84;
  button.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  button.style.top = `${Math.max(8, rect.top - 34)}px`;
}

function hideListenFromButton() {
  const button = document.getElementById("listenFromHere");
  if (button) {
    button.hidden = true;
  }
}

function captureListenStart() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!elements.article.contains(range.startContainer)) {
    return null;
  }
  if (!flatText(selection.toString())) {
    return null;
  }
  return { node: range.startContainer, offset: range.startOffset };
}

function connectedStart(start) {
  if (!start || !start.node || !start.node.isConnected || !elements.article.contains(start.node)) {
    return null;
  }
  return start;
}

function applyListenStart(blocks, start) {
  const node = start && start.node;
  if (!node || !node.isConnected) {
    return { index: 0, moved: false };
  }
  const index = blocks.findIndex((block) => block.el.contains(node));
  if (index < 0) {
    return { index: 0, moved: false };
  }
  const element = blocks[index].el;
  let prefix = "";
  try {
    prefix = flatText(textBefore(element, node, start.offset));
  } catch {
    return { index, moved: index > 0 };
  }
  let seen = 0;
  for (let cursor = index; cursor < blocks.length && blocks[cursor].el === element; cursor += 1) {
    const piece = flatText(blocks[cursor].text);
    if (prefix.length <= seen + piece.length) {
      const cut = prefix.length - seen;
      if (cut <= 0) {
        return { index: cursor, moved: cursor > 0 };
      }
      const sliced = sliceAfterFlat(blocks[cursor].text, cut);
      if (!sliced) {
        return { index: cursor + 1, moved: true };
      }
      blocks[cursor].text = sliced;
      return { index: cursor, moved: true };
    }
    seen += piece.length;
  }
  return { index, moved: index > 0 };
}

function textBefore(element, node, offset) {
  const range = document.createRange();
  range.setStart(element, 0);
  range.setEnd(node, offset);
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  return spokenText(holder);
}

function flatText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function sliceAfterFlat(text, count) {
  if (count <= 0) {
    return String(text || "").trim();
  }
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) {
      continue;
    }
    seen += 1;
    if (seen >= count) {
      return text.slice(index + 1).trim();
    }
  }
  return "";
}

function splitSpeakable(text) {
  if (text.length <= 700) {
    return [text];
  }
  const parts = text.split(/(?<=[。！？!?；;])\s*/);
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (buffer && buffer.length + part.length > 700) {
      chunks.push(buffer);
      buffer = part;
    } else {
      buffer += part;
    }
  }
  if (buffer) {
    chunks.push(buffer);
  }
  return chunks.length ? chunks : [text.slice(0, 700)];
}

function playSystem(run) {
  const token = listen.token;
  if (!isListenRun(run)) {
    return;
  }
  if (!window.speechSynthesis) {
    failListen("这个窗口没有系统语音，可以改用 Edge TTS");
    return;
  }
  if (listen.index >= listen.blocks.length) {
    advanceListenChapter(run);
    return;
  }
  const block = listen.blocks[listen.index];
  const utterance = new SpeechSynthesisUtterance(block.text);
  utterance.rate = LISTEN_SPEEDS.includes(Number(state.listenSpeed)) ? Number(state.listenSpeed) : 1;
  const voice = systemVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = preferredListenLang() === "en" ? "en-US" : "zh-CN";
  }
  listen.currentUtterance = utterance;
  utterance.onend = () => {
    if (listen.paused || listen.currentUtterance !== utterance || !isListenRun(run) || listen.token !== token) {
      return;
    }
    listen.index += 1;
    playSystem(run);
  };
  utterance.onerror = (event) => {
    if (listen.currentUtterance !== utterance || !isListenRun(run) || listen.token !== token) {
      return;
    }
    const reason = event.error || "";
    if (reason === "interrupted" || reason === "canceled" || reason === "cancelled") {
      return;
    }
    failListen(reason || "系统语音失败");
  };
  window.setTimeout(() => {
    if (listen.paused || listen.currentUtterance !== utterance || !isListenRun(run) || listen.token !== token) {
      return;
    }
    highlightListen(block.el);
    window.speechSynthesis.speak(utterance);
  }, 40);
}

function armSystemKeepalive() {
  if (listen.keepalive) {
    return;
  }
  listen.keepalive = window.setInterval(() => {
    const synth = window.speechSynthesis;
    if (!listen.active || listen.paused || state.listenEngine !== "system" || !synth || !synth.speaking || synth.paused) {
      return;
    }
  }, 10000);
}

function fillEdgeQueue(run) {
  while (listen.queue.length < 1 && listen.nextRequest < listen.blocks.length && isListenRun(run)) {
    const index = listen.nextRequest;
    listen.nextRequest += 1;
    const block = listen.blocks[index];
    listen.queue.push({ index, block, promise: requestEdgeAudio(block.text) });
  }
}

async function pumpEdge(run) {
  const token = listen.token;
  if (!isListenRun(run) || listen.edgeBusy) {
    return;
  }
  listen.edgeBusy = true;
  fillEdgeQueue(run);
  const next = listen.queue.shift();
  if (!next) {
    if (listen.token === token) {
      listen.edgeBusy = false;
    }
    advanceListenChapter(run);
    return;
  }
  const result = await next.promise;
  if (!isListenRun(run) || listen.token !== token || result.cancelled) {
    if (listen.token === token) {
      listen.edgeBusy = false;
    }
    return;
  }
  if (result.error || !result.audio) {
    listen.edgeBusy = false;
    failListen(result.error || "语音生成失败");
    return;
  }
  listen.index = next.index;
  listen.edgeBusy = false;
  fillEdgeQueue(run);
  playEdgeBuffer(result.audio, next.block, run, token);
}

function playEdgeBuffer(base64, block, run, token) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    failListen("这个窗口不能播放 Edge 音频");
    return;
  }
  const audio = listen.ctx || (listen.ctx = new AudioCtx());
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const prepare = listen.paused || audio.state === "suspended" ? Promise.resolve() : audio.resume();
  prepare
    .then(() => audio.decodeAudioData(bytes.buffer))
    .then((buffer) => {
      if (!isListenRun(run) || listen.token !== token) {
        return;
      }
      if (listen.paused) {
        listen.heldEdge = { buffer, block, run, token };
        return;
      }
      startEdgeSource(buffer, block, run, token);
    })
    .catch((error) => {
      if (isListenRun(run) && listen.token === token) {
        failListen(error && error.message ? error.message : "音频无法播放");
      }
    });
}

function startEdgeSource(buffer, block, run, token) {
  const audio = listen.ctx;
  if (!audio || !isListenRun(run) || listen.token !== token) {
    return;
  }
  highlightListen(block.el);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.onended = () => {
    listen.sources.delete(source);
    if (listen.paused || !isListenRun(run) || listen.token !== token) {
      return;
    }
    pumpEdge(run);
  };
  listen.sources.add(source);
  source.start();
  syncMediaSession();
}

function requestEdgeAudio(text) {
  listen.audioRequest += 1;
  const id = `tts-${listen.run}-${listen.audioRequest}`;
  const promise = new Promise((resolve) => {
    pendingAudio.set(id, resolve);
  });
  vscode.postMessage({
    type: "ttsSpeak",
    id,
    text,
    voice: edgeVoiceName(),
    speed: LISTEN_SPEEDS.includes(Number(state.listenSpeed)) ? Number(state.listenSpeed) : 1,
  });
  return promise;
}

function prepareListenAudio() {
  if (state.listenEngine !== "edge") {
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  if (!listen.ctx) {
    listen.ctx = new AudioCtx();
  }
  listen.ctx.resume();
}

function stopListenPlayback() {
  listen.token += 1;
  listen.edgeBusy = false;
  listen.heldEdge = null;
  listen.queue = [];
  listen.currentUtterance = null;
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  for (const source of listen.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  listen.sources.clear();
  for (const [id, resolve] of pendingAudio) {
    pendingAudio.delete(id);
    resolve({ id, cancelled: true });
  }
  vscode.postMessage({ type: "ttsStop" });
}

function highlightListen(element) {
  if (!element || listen.highlighted === element) {
    if (element) {
      element.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  clearListenHighlight();
  element.classList.add("tts-current");
  listen.highlighted = element;
  element.scrollIntoView({ block: "nearest" });
}

function clearListenHighlight() {
  if (listen.highlighted) {
    listen.highlighted.classList.remove("tts-current");
    listen.highlighted = null;
  }
  for (const element of elements.article.querySelectorAll(".tts-current")) {
    element.classList.remove("tts-current");
  }
}

function preferredListenLang() {
  const lang = (elements.article.getAttribute("lang") || (initial.book && initial.book.language) || "").toLowerCase();
  return lang.startsWith("en") ? "en" : "zh";
}

function edgeVoiceName() {
  if (state.listenVoice && state.listenVoice !== "auto") {
    return state.listenVoice;
  }
  return preferredListenLang() === "en" ? "en-US-AriaNeural" : "zh-CN-XiaoxiaoNeural";
}

function systemVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (state.listenVoice && state.listenVoice !== "auto") {
    return voices.find((voice) => voice.voiceURI === state.listenVoice) || null;
  }
  const preferred = preferredListenLang();
  return voices.find((voice) => voice.lang.toLowerCase().startsWith(preferred)) || voices[0] || null;
}

function updateListenButton() {
  if (!elements.listenToggle) {
    return;
  }
  const engine = state.listenEngine === "edge" ? "Edge TTS" : "系统语音";
  elements.listenToggle.textContent = listen.active ? "停" : "听";
  elements.listenToggle.setAttribute("aria-pressed", listen.active ? "true" : "false");
  if (!listen.active) {
    elements.listenToggle.title = `朗读本书（${engine}）。先选中文字再点，会从选中处开始`;
  } else if (listen.paused) {
    elements.listenToggle.title = `已暂停（${engine}）。按播放键继续，再按此按钮停止`;
  } else {
    elements.listenToggle.title = `停止朗读（${engine}）。也可用键盘播放/暂停键`;
  }
  elements.listenToggle.setAttribute("aria-label", elements.listenToggle.title);
  syncMediaSession();
}

function bindMediaSession() {
  const session = navigator.mediaSession;
  if (!session || listen.sessionBound) {
    return;
  }
  listen.sessionBound = true;
  try {
    session.setActionHandler("play", () => {
      resumeListen();
    });
    session.setActionHandler("pause", () => {
      pauseListen();
    });
  } catch {
    // This webview does not accept media-key handlers.
  }
}

function syncMediaSession() {
  const session = navigator.mediaSession;
  if (!session || !initial.book) {
    return;
  }
  const chapter = initial.book.chapters[state.chapterIndex];
  try {
    session.metadata = new MediaMetadata({
      title: chapter && chapter.title ? chapter.title : "EPUB",
      artist: initial.book.title || "EPUB Reader",
      album: "朗读",
    });
    if (!listen.active) {
      session.playbackState = "none";
    } else {
      session.playbackState = listen.paused ? "paused" : "playing";
    }
  } catch {
    // Metadata is optional. Playback handlers still work without it.
  }
}

function silentWavUrl() {
  const samples = 800;
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function holdMediaSession() {
  if (!listen.sessionAudio) {
    const audio = document.createElement("audio");
    audio.loop = true;
    audio.volume = 0;
    audio.setAttribute("aria-hidden", "true");
    audio.src = silentWavUrl();
    document.body.appendChild(audio);
    listen.sessionAudio = audio;
  }
  const pending = listen.sessionAudio.play();
  if (pending && typeof pending.catch === "function") {
    pending.catch(() => {});
  }
  syncMediaSession();
}

function releaseMediaSession() {
  if (!listen.sessionAudio) {
    syncMediaSession();
    return;
  }
  listen.sessionAudio.pause();
  syncMediaSession();
}

function pauseListen() {
  if (!listen.active || listen.paused) {
    return;
  }
  listen.paused = true;
  if (window.speechSynthesis && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
  }
  if (listen.ctx && listen.ctx.state === "running") {
    listen.ctx.suspend();
  }
  if (listen.sessionAudio && !listen.sessionAudio.paused) {
    listen.sessionAudio.pause();
  }
  updateListenButton();
}

function resumeListen() {
  if (!listen.active) {
    startListen();
    return;
  }
  if (!listen.paused) {
    return;
  }
  listen.paused = false;
  holdMediaSession();
  if (state.listenEngine === "system") {
    const synth = window.speechSynthesis;
    if (synth && synth.paused) {
      synth.resume();
    } else if (!synth || !synth.speaking) {
      playSystem(listen.run);
    }
  } else {
    const held = listen.heldEdge;
    listen.heldEdge = null;
    if (listen.sources.size && listen.ctx && listen.ctx.state === "suspended") {
      listen.ctx.resume();
    } else if (held && held.run === listen.run && held.token === listen.token) {
      if (listen.ctx && listen.ctx.state === "suspended") {
        listen.ctx.resume();
      }
      startEdgeSource(held.buffer, held.block, held.run, held.token);
    } else if (listen.ctx && listen.ctx.state === "suspended") {
      listen.ctx.resume();
    }
  }
  updateListenButton();
}

function setListenHint(text) {
  if (elements.listenHint) {
    elements.listenHint.textContent = text;
  }
}

function failListen(error) {
  setListenHint(`朗读失败：${error}`);
  if (elements.listenPanel) {
    elements.listenPanel.hidden = false;
  }
  if (elements.listenSettings) {
    elements.listenSettings.setAttribute("aria-expanded", "true");
  }
  stopListen();
}

function isListenRun(run) {
  return listen.active && listen.run === run;
}
