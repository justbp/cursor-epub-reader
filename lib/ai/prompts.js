"use strict";

const { limitText } = require("./chunker");

const TASKS = {
  chapterSummary: "chapterSummary",
  selectionExplain: "selectionExplain",
  selectionSummary: "selectionSummary",
  chapterNote: "chapterNote",
  qa: "qa",
  customCommand: "customCommand",
};

const DEFAULT_AI_COMMANDS = [
  {
    id: "chapterSummary",
    label: "/总结本章",
    task: TASKS.chapterSummary,
    title: "总结本章",
    detail: "提炼当前章节的核心内容",
    context: "chapter",
  },
  {
    id: "chapterNote",
    label: "/章节笔记",
    task: TASKS.chapterNote,
    title: "章节笔记",
    detail: "生成可保存的 Markdown 笔记",
    context: "chapter",
  },
  {
    id: "selectionExplain",
    label: "/解读选中",
    task: TASKS.selectionExplain,
    title: "解读选中",
    detail: "解释选中文本的含义",
    context: "selection",
  },
  {
    id: "selectionSummary",
    label: "/总结选中",
    task: TASKS.selectionSummary,
    title: "总结选中",
    detail: "概括选中文本",
    context: "selection",
  },
  {
    id: "qa",
    label: "/提问",
    task: TASKS.qa,
    title: "提问",
    detail: "基于当前章节回答问题",
    context: "question",
  },
  {
    id: "translate",
    label: "/翻译",
    task: TASKS.customCommand,
    title: "翻译",
    detail: "翻译选中文本",
    context: "selection",
    prompt: [
      "书名：{bookTitle}",
      "作者：{author}",
      "当前章节：{chapterTitle}",
      "",
      "请把下面选中文本翻译成{outputLanguage}。",
      "要求：忠实原意，保留段落结构；专有名词保持准确；不要添加未出现在原文中的解释。",
      "",
      "{truncationNotice}",
      "",
      "{selectedText}",
    ].join("\n"),
  },
  {
    id: "writeInSameStyle",
    label: "/同风格写作",
    task: TASKS.customCommand,
    title: "同风格写作",
    detail: "参考选中文本风格进行写作",
    context: "selectionQuestion",
    prompt: [
      "书名：{bookTitle}",
      "作者：{author}",
      "当前章节：{chapterTitle}",
      "",
      "请分析选中文本的语气、节奏、句式、意象和表达风格，然后按照用户需求写一段同风格文本。",
      "只模仿风格，不续写受版权保护文本中的具体情节或未提供内容。",
      "",
      "用户需求：{question}",
      "",
      "{truncationNotice}",
      "",
      "风格参考文本：",
      "{selectedText}",
    ].join("\n"),
  },
];

const DEFAULT_PROMPTS = {
  system: [
    "你是一个严谨的读书助手。",
    "你只基于用户提供的书籍内容回答，不编造未提供的信息。",
    "输出应清晰、结构化、适合保存为 Markdown 笔记。",
    "如果内容不足以回答，请说明不足之处。",
    "输出语言：{outputLanguage}。",
  ].join("\n"),
  chapterSummary: [
    "书名：{bookTitle}",
    "作者：{author}",
    "章节：{chapterTitle}",
    "",
    "请总结下面的章节内容。",
    "",
    "输出格式：",
    "## 一句话概括",
    "## 核心要点",
    "## 重要概念",
    "## 值得摘录",
    "## 继续阅读的问题",
    "",
    "{truncationNotice}",
    "",
    "{text}",
  ].join("\n"),
  chunkSummary: [
    "书名：{bookTitle}",
    "作者：{author}",
    "章节：{chapterTitle}",
    "分块：{chunkIndex} / {chunkCount}",
    "",
    "请基于下面这一段章节内容，提炼局部摘要。输出 5-8 条要点，不要扩展未提供的信息。",
    "",
    "{text}",
  ].join("\n"),
  finalSummary: [
    "书名：{bookTitle}",
    "作者：{author}",
    "章节：{chapterTitle}",
    "",
    "下面是同一章节不同分块的局部摘要。请合成为一个完整章节总结。",
    "",
    "输出格式：",
    "## 一句话概括",
    "## 核心要点",
    "## 重要概念",
    "## 值得摘录",
    "## 继续阅读的问题",
    "",
    "{text}",
  ].join("\n"),
  selectionExplain: [
    "书名：{bookTitle}",
    "作者：{author}",
    "当前章节：{chapterTitle}",
    "",
    "请解释下面的选中文本。只基于选中文本和已提供的元数据回答。",
    "",
    "输出格式：",
    "## 简明解释",
    "## 放在本章中的作用",
    "## 可能的延伸理解",
    "",
    "{truncationNotice}",
    "",
    "{selectedText}",
  ].join("\n"),
  selectionSummary: [
    "书名：{bookTitle}",
    "作者：{author}",
    "当前章节：{chapterTitle}",
    "",
    "请总结下面的选中文本。只基于选中文本和已提供的元数据回答。",
    "",
    "输出格式：",
    "## 摘要",
    "## 要点",
    "## 可继续追问",
    "",
    "{truncationNotice}",
    "",
    "{selectedText}",
  ].join("\n"),
  chapterNote: [
    "书名：{bookTitle}",
    "作者：{author}",
    "章节：{chapterTitle}",
    "",
    "请把下面的章节整理成适合保存的 Markdown 读书笔记。",
    "",
    "输出格式：",
    "# {chapterTitle}",
    "## 摘要",
    "## 结构",
    "## 关键观点",
    "## 概念与术语",
    "## 摘录",
    "## 我的思考",
    "",
    "摘录只能来自原文，不要伪造引用。",
    "{truncationNotice}",
    "",
    "{text}",
  ].join("\n"),
  qa: [
    "书名：{bookTitle}",
    "作者：{author}",
    "章节：{chapterTitle}",
    "",
    "问题：{question}",
    "",
    "{qaInstruction}",
    "",
    "{contextTitle}",
    "{contextText}",
  ].join("\n"),
  customCommand: [
    "书名：{bookTitle}",
    "作者：{author}",
    "章节：{chapterTitle}",
    "",
    "请根据下面内容完成命令：{commandTitle}",
    "",
    "用户输入：{question}",
    "",
    "{contextTitle}",
    "{contextText}",
  ].join("\n"),
};

function buildAiRequest(options) {
  const task = options.task;
  const outputLanguage = describeOutputLanguage(options.outputLanguage, options.book && options.book.language);
  const metadata = buildMetadata(options);
  const maxInputCharacters = Number(options.maxInputCharacters) || 24000;

  if (task === TASKS.selectionExplain) {
    return buildSelectionRequest(options, outputLanguage, metadata, maxInputCharacters, TASKS.selectionExplain, 1400);
  }

  if (task === TASKS.selectionSummary) {
    return buildSelectionRequest(options, outputLanguage, metadata, maxInputCharacters, TASKS.selectionSummary, 1200);
  }

  if (task === TASKS.chapterNote) {
    return buildChapterTextRequest(options, outputLanguage, metadata, maxInputCharacters, TASKS.chapterNote, 2400, 0.25);
  }

  if (task === TASKS.qa) {
    return buildQaRequest(options, outputLanguage, metadata, maxInputCharacters);
  }

  if (task === TASKS.customCommand) {
    return buildCustomCommandRequest(options, outputLanguage, metadata, maxInputCharacters);
  }

  return buildChapterTextRequest(options, outputLanguage, metadata, maxInputCharacters, TASKS.chapterSummary, 1800, 0.2);
}

function buildChunkSummaryRequest(options) {
  const outputLanguage = describeOutputLanguage(options.outputLanguage, options.book && options.book.language);
  const metadata = buildMetadata(options);
  const variables = promptVariables(options, outputLanguage, metadata, {
    text: String(options.text || ""),
    chunkIndex: String(Number(options.chunkIndex || 0) + 1),
    chunkCount: String(options.chunkCount || 1),
  });

  return {
    task: TASKS.chapterSummary,
    system: buildSystemPrompt(outputLanguage, options.prompts),
    messages: [{ role: "user", content: renderConfiguredPrompt(options, "chunkSummary", variables) }],
    temperature: 0.2,
    maxOutputTokens: 900,
    metadata,
  };
}

function buildFinalSummaryRequest(options) {
  const outputLanguage = describeOutputLanguage(options.outputLanguage, options.book && options.book.language);
  const metadata = buildMetadata(options);
  const variables = promptVariables(options, outputLanguage, metadata, {
    text: String(options.text || ""),
  });

  return {
    task: TASKS.chapterSummary,
    system: buildSystemPrompt(outputLanguage, options.prompts),
    messages: [{ role: "user", content: renderConfiguredPrompt(options, "finalSummary", variables) }],
    temperature: 0.2,
    maxOutputTokens: 1800,
    metadata,
  };
}

function buildChapterTextRequest(options, outputLanguage, metadata, maxInputCharacters, task, maxOutputTokens, temperature) {
  const limited = limitText(options.text, maxInputCharacters);
  const variables = promptVariables(options, outputLanguage, metadata, {
    text: limited.text,
    contextText: limited.text,
    truncationNotice: limited.truncated ? "注意：输入内容因长度限制被截断，请在回答中说明这一点。" : "",
  });

  return {
    task,
    system: buildSystemPrompt(outputLanguage, options.prompts),
    messages: [{ role: "user", content: renderConfiguredPrompt(options, task, variables) }],
    temperature,
    maxOutputTokens,
    metadata,
  };
}

function buildSelectionRequest(options, outputLanguage, metadata, maxInputCharacters, task, maxOutputTokens) {
  const limited = limitText(options.selectedText || options.text, maxInputCharacters);
  const variables = promptVariables(options, outputLanguage, metadata, {
    selectedText: limited.text,
    contextText: limited.text,
    truncationNotice: limited.truncated ? "注意：选中文本因长度限制被截断。" : "",
  });

  return {
    task,
    system: buildSystemPrompt(outputLanguage, options.prompts),
    messages: [{ role: "user", content: renderConfiguredPrompt(options, task, variables) }],
    temperature: 0.2,
    maxOutputTokens,
    metadata,
  };
}

function buildQaRequest(options, outputLanguage, metadata, maxInputCharacters) {
  const hasSelection = Boolean(String(options.selectedText || "").trim());
  const limited = limitText(hasSelection ? options.selectedText : options.text, maxInputCharacters);
  const variables = promptVariables(options, outputLanguage, metadata, {
    question: String(options.question || "").trim(),
    selectedText: hasSelection ? limited.text : "",
    text: hasSelection ? "" : limited.text,
    contextTitle: hasSelection ? "选中文本：" : "章节内容：",
    contextText: limited.text,
    qaInstruction: hasSelection
      ? "请优先根据下面选中文本回答。如果内容不足以回答，请直接说明。"
      : "请只根据下面章节内容回答。如果内容不足以回答，请直接说明。",
    truncationNotice: limited.truncated ? "注意：上下文因长度限制被截断。" : "",
  });

  return {
    task: TASKS.qa,
    system: buildSystemPrompt(outputLanguage, options.prompts),
    messages: [{ role: "user", content: renderConfiguredPrompt(options, TASKS.qa, variables) }],
    temperature: 0.2,
    maxOutputTokens: 1600,
    metadata,
  };
}

function buildCustomCommandRequest(options, outputLanguage, metadata, maxInputCharacters) {
  const command = normalizeAiCommand(options.command, 0);
  const context = command.context || "chapter";
  const useSelection = context === "selection" || context === "selectionQuestion";
  const source = useSelection ? options.selectedText : options.text;
  const limited = limitText(source, maxInputCharacters);
  const variables = promptVariables(options, outputLanguage, metadata, {
    commandLabel: command.label,
    commandTitle: command.title || command.label,
    question: String(options.question || "").trim(),
    selectedText: useSelection ? limited.text : "",
    text: useSelection ? "" : limited.text,
    contextTitle: useSelection ? "选中文本：" : "章节内容：",
    contextText: limited.text,
    truncationNotice: limited.truncated ? "注意：上下文因长度限制被截断。" : "",
  });

  return {
    task: TASKS.customCommand,
    system: buildSystemPrompt(outputLanguage, options.prompts),
    messages: [{ role: "user", content: renderConfiguredPrompt({ ...options, command }, TASKS.customCommand, variables) }],
    temperature: numberOrDefault(command.temperature, 0.2),
    maxOutputTokens: clampNumber(command.maxOutputTokens, 200, 8000, 1600),
    metadata,
  };
}

function renderConfiguredPrompt(options, key, variables) {
  const commandPrompt = options.command && options.command.prompt ? options.command.prompt : "";
  const prompts = options.prompts || {};
  const template = commandPrompt || prompts[key] || DEFAULT_PROMPTS[key] || DEFAULT_PROMPTS.customCommand;
  return renderTemplate(template, variables).replace(/\n{3,}/g, "\n\n").trim();
}

function buildSystemPrompt(outputLanguage, prompts) {
  return renderTemplate((prompts && prompts.system) || DEFAULT_PROMPTS.system, {
    outputLanguage,
  }).trim();
}

function promptVariables(options, outputLanguage, metadata, extra) {
  return {
    bookTitle: metadata.bookTitle,
    author: metadata.author,
    language: metadata.language,
    chapterTitle: metadata.chapterTitle,
    chapterIndex: String(metadata.chapterIndex + 1),
    outputLanguage,
    question: String(options.question || ""),
    text: String(options.text || ""),
    selectedText: String(options.selectedText || ""),
    contextText: String(options.text || options.selectedText || ""),
    contextTitle: "章节内容：",
    truncationNotice: "",
    commandLabel: options.command && options.command.label ? options.command.label : "",
    commandTitle: options.command && options.command.title ? options.command.title : "",
    qaInstruction: "",
    ...extra,
  };
}

function renderTemplate(template, variables) {
  return String(template || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}|\{([A-Za-z0-9_]+)\}/g, (_match, doubleKey, singleKey) => {
    const key = doubleKey || singleKey;
    return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : "";
  });
}

function buildMetadata(options) {
  const book = options.book || {};
  const chapter = options.chapter || {};
  return {
    bookTitle: book.title || "Untitled EPUB",
    author: book.author || "Unknown author",
    language: book.language || "",
    chapterTitle: chapter.title || `Chapter ${(chapter.index || 0) + 1}`,
    chapterIndex: Number.isInteger(chapter.index) ? chapter.index : 0,
  };
}

function describeOutputLanguage(value) {
  if (value === "zh-CN") {
    return "简体中文";
  }
  if (value === "en-US") {
    return "English";
  }
  return "简体中文";
}

function normalizeAiCommands(value) {
  const commands = new Map();
  for (const command of DEFAULT_AI_COMMANDS) {
    const normalized = normalizeAiCommand(command, commands.size);
    commands.set(normalized.label, normalized);
  }

  const customCommands = Array.isArray(value) ? value : [];
  for (const command of customCommands) {
    const normalized = normalizeAiCommand(command, commands.size);
    if (!normalized.label) {
      continue;
    }
    const previous = commands.get(normalized.label);
    commands.set(normalized.label, previous ? normalizeAiCommand({ ...previous, ...command }, commands.size) : normalized);
  }

  return Array.from(commands.values());
}

function normalizeAiCommand(command, index) {
  const source = command && typeof command === "object" ? command : {};
  const label = normalizeCommandLabel(source.label || source.title || "");
  const task = normalizeTask(source.task, source.prompt);
  const context = normalizeContext(source.context, task);
  const title = String(source.title || label.replace(/^\//, "") || `命令 ${index + 1}`).trim();
  return {
    id: String(source.id || stableCommandId(label, index)),
    label,
    task,
    title,
    detail: String(source.detail || title).trim(),
    context,
    needsSelection: context === "selection" || context === "selectionQuestion",
    requiresQuestion: context === "question" || context === "selectionQuestion",
    prompt: String(source.prompt || ""),
    temperature: numberOrUndefined(source.temperature),
    maxOutputTokens: numberOrUndefined(source.maxOutputTokens),
  };
}

function normalizeCommandLabel(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.startsWith("/") ? text : `/${text}`;
}

function normalizeTask(value, prompt) {
  const text = String(value || "").trim();
  if (Object.values(TASKS).includes(text)) {
    return text;
  }
  return prompt || text ? TASKS.customCommand : TASKS.customCommand;
}

function normalizeContext(value, task) {
  const text = String(value || "").trim();
  if (text === "chapter" || text === "selection" || text === "question" || text === "selectionQuestion") {
    return text;
  }
  if (task === TASKS.selectionExplain || task === TASKS.selectionSummary) {
    return "selection";
  }
  if (task === TASKS.qa) {
    return "question";
  }
  return "chapter";
}

function stableCommandId(label, index) {
  const text = String(label || `command-${index + 1}`);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `command-${Math.abs(hash)}`;
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

module.exports = {
  TASKS,
  DEFAULT_AI_COMMANDS,
  DEFAULT_PROMPTS,
  buildAiRequest,
  buildChunkSummaryRequest,
  buildFinalSummaryRequest,
  normalizeAiCommand,
  normalizeAiCommands,
};
