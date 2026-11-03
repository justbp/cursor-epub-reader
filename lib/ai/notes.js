"use strict";

const DEFAULT_NOTE_FILE_NAME_PATTERN = "Z{counter}_{command}_{chapter}.md";

function safeFileName(value, fallback = "untitled") {
  const clean = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return clean && clean !== "." && clean !== ".." ? clean : fallback;
}

function noteFileName(chapter) {
  const index = Number.isInteger(chapter && chapter.index) ? chapter.index + 1 : 1;
  const title = chapter && chapter.title ? chapter.title : `Chapter ${index}`;
  return `${padNumber(index)}-${safeFileName(title, `chapter-${index}`)}.md`;
}

function formatNoteFileName(options = {}) {
  const book = options.book || {};
  const chapter = options.chapter || {};
  const pattern = String(options.pattern || DEFAULT_NOTE_FILE_NAME_PATTERN);
  const chapterIndex = Number.isInteger(chapter.index) ? chapter.index + 1 : 1;
  const command = String(options.command || "AI").replace(/^\/+/, "") || "AI";
  const variables = {
    counter: padCounter(options.counter),
    command: safeFileName(command, "AI"),
    chapter: safeFileName(chapter.title || `Chapter ${chapterIndex}`, `chapter-${chapterIndex}`),
    chapterIndex: padNumber(chapterIndex),
    book: safeFileName(book.title || "Untitled EPUB", "Untitled EPUB"),
    author: safeFileName(book.author || "Unknown author", "Unknown author"),
  };

  const rendered = pattern.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
  const clean = safeNoteFileName(rendered, noteFileName(chapter));
  return /\.md$/i.test(clean) ? clean : `${clean}.md`;
}

function buildFrontmatter(options) {
  const book = options.book || {};
  const chapter = options.chapter || {};
  const provider = options.provider || {};
  const lines = [
    "---",
    `book: ${yamlString(book.title || "Untitled EPUB")}`,
    `author: ${yamlString(book.author || "Unknown author")}`,
    `chapter: ${yamlString(chapter.title || "")}`,
    `chapter_index: ${Number.isInteger(chapter.index) ? chapter.index : 0}`,
    `created: ${yamlString(new Date().toISOString())}`,
    `generator: ${yamlString("Cursor EPUB Reader")}`,
    `provider: ${yamlString(provider.provider || "")}`,
    `model: ${yamlString(provider.model || "")}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function withFrontmatter(markdown, options) {
  const body = String(markdown || "").trim();
  if (/^---\s*\n/.test(body)) {
    return body.endsWith("\n") ? body : `${body}\n`;
  }
  return `${buildFrontmatter(options)}${body}\n`;
}

function padNumber(value) {
  return String(Math.max(1, Number(value) || 1)).padStart(3, "0");
}

function padCounter(value) {
  return String(Math.max(1, Number(value) || 1)).padStart(4, "0");
}

function safeNoteFileName(value, fallback) {
  const clean = String(value || fallback || "note.md")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
    .trim();
  return clean && clean !== "." && clean !== ".." ? clean : fallback;
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

module.exports = {
  DEFAULT_NOTE_FILE_NAME_PATTERN,
  buildFrontmatter,
  formatNoteFileName,
  noteFileName,
  safeFileName,
  withFrontmatter,
};
