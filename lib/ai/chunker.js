"use strict";

function compactText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitText(text, maxCharacters) {
  const clean = compactText(text);
  const limit = Math.max(1000, Number(maxCharacters) || 24000);
  if (!clean || clean.length <= limit) {
    return clean ? [clean] : [];
  }

  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      continue;
    }

    if (paragraph.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongParagraph(paragraph, limit));
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > limit) {
      if (current) {
        chunks.push(current);
      }
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongParagraph(paragraph, limit) {
  const chunks = [];
  let offset = 0;

  while (offset < paragraph.length) {
    const hardEnd = Math.min(paragraph.length, offset + limit);
    let end = hardEnd;
    const softBreak = paragraph.lastIndexOf("。", hardEnd);
    if (softBreak > offset + Math.floor(limit * 0.5)) {
      end = softBreak + 1;
    }
    chunks.push(paragraph.slice(offset, end).trim());
    offset = end;
  }

  return chunks.filter(Boolean);
}

function limitText(text, maxCharacters) {
  const clean = compactText(text);
  const limit = Math.max(1000, Number(maxCharacters) || 24000);
  if (clean.length <= limit) {
    return {
      text: clean,
      truncated: false,
    };
  }

  return {
    text: `${clean.slice(0, limit).trim()}\n\n[内容因长度限制已截断]`,
    truncated: true,
  };
}

module.exports = {
  compactText,
  limitText,
  splitText,
};
