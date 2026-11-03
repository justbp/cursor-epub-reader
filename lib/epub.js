"use strict";

const path = require("path").posix;
const { ZipArchive, normalizeZipPath, safeDecodeUri } = require("./zip");

const XHTML_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "application/xml",
  "text/xml",
]);

const ENTITY_MAP = {
  amp: "&",
  apos: "'",
  copy: "\u00a9",
  gt: ">",
  hellip: "\u2026",
  laquo: "\u00ab",
  ldquo: "\u201c",
  lsaquo: "\u2039",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  quot: '"',
  raquo: "\u00bb",
  rdquo: "\u201d",
  reg: "\u00ae",
  rsaquo: "\u203a",
  rsquo: "\u2019",
};

const MIME_BY_EXTENSION = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parseEpub(input, sourceName = "Untitled EPUB") {
  const zip = input instanceof ZipArchive ? input : new ZipArchive(input);
  const containerXml = zip.readText("META-INF/container.xml");

  if (!containerXml) {
    throw new Error("Invalid EPUB: missing META-INF/container.xml.");
  }

  const rootfileTag = firstTag(containerXml, "rootfile");
  const opfPath = normalizeZipPath(getAttr(rootfileTag, "full-path"));
  if (!opfPath) {
    throw new Error("Invalid EPUB: container.xml does not declare an OPF rootfile.");
  }

  const opfXml = zip.readText(opfPath);
  if (!opfXml) {
    throw new Error(`Invalid EPUB: missing OPF package document "${opfPath}".`);
  }

  const opfDir = dirname(opfPath);
  const manifest = parseManifest(opfXml, opfDir);
  const spine = parseSpine(opfXml);
  const metadata = parseMetadata(opfXml, sourceName);
  const tocEntries = augmentTocEntries(zip, manifest, spine, parseToc(zip, manifest, spine, opfDir));
  const chapters = buildChapters(zip, manifest, spine, tocEntries);

  if (chapters.length === 0) {
    throw new Error("Invalid EPUB: no readable XHTML/HTML document was found in the spine.");
  }

  const chaptersByPath = new Map();
  chapters.forEach((chapter) => {
    for (const document of chapter.documents || [chapter]) {
      if (!chaptersByPath.has(document.path)) {
        chaptersByPath.set(document.path, chapter.index);
      }
    }
  });

  return {
    title: metadata.title,
    author: metadata.author,
    language: metadata.language,
    opfPath,
    opfDir,
    chapters,
    tocEntries,
    stats: {
      entryCount: zip.list().length,
      chapterCount: chapters.length,
      hasToc: tocEntries.length > 0,
    },
    renderChapter(index) {
      const chapter = chapters[index];
      if (!chapter) {
        throw new Error(`Chapter index out of range: ${index}.`);
      }
      return renderChapter(zip, chapter, chaptersByPath);
    },
    getChapterText(index) {
      const chapter = chapters[index];
      if (!chapter) {
        throw new Error(`Chapter index out of range: ${index}.`);
      }
      return extractChapterText(zip, chapter);
    },
  };
}

function parseMetadata(opfXml, sourceName) {
  return {
    title: cleanText(firstElementText(opfXml, "title")) || stripExtension(sourceName),
    author: cleanText(firstElementText(opfXml, "creator")) || "Unknown author",
    language: cleanText(firstElementText(opfXml, "language")) || "",
  };
}

function parseManifest(opfXml, opfDir) {
  const manifest = new Map();
  const itemRe = /<item\b[^>]*\/?>/gi;
  let match;

  while ((match = itemRe.exec(opfXml)) !== null) {
    const tag = match[0];
    const id = getAttr(tag, "id");
    const href = getAttr(tag, "href");
    if (!id || !href) {
      continue;
    }

    const mediaType = getAttr(tag, "media-type").toLowerCase();
    const properties = getAttr(tag, "properties").toLowerCase().split(/\s+/).filter(Boolean);
    const resolved = resolveHref(opfDir, href);

    manifest.set(id, {
      id,
      href,
      mediaType,
      properties,
      path: resolved.path,
      fragment: resolved.fragment,
    });
  }

  return manifest;
}

function parseSpine(opfXml) {
  const spineTag = firstTag(opfXml, "spine") || "";
  const tocId = getAttr(spineTag, "toc");
  const itemrefRe = /<itemref\b[^>]*\/?>/gi;
  const spine = [];
  let match;

  while ((match = itemrefRe.exec(opfXml)) !== null) {
    const tag = match[0];
    const idref = getAttr(tag, "idref");
    if (!idref) {
      continue;
    }
    spine.push({
      idref,
      linear: getAttr(tag, "linear").toLowerCase() !== "no",
    });
  }

  return { tocId, items: spine };
}

function parseToc(zip, manifest, spine, opfDir) {
  const navItem = Array.from(manifest.values()).find((item) => item.properties.includes("nav"));
  if (navItem) {
    const navXml = zip.readText(navItem.path);
    if (navXml) {
      const navEntries = parseNavDocument(navXml, navItem.path);
      if (navEntries.length > 0) {
        return navEntries;
      }
    }
  }

  const ncxItem =
    manifest.get(spine.tocId) ||
    Array.from(manifest.values()).find((item) => item.mediaType === "application/x-dtbncx+xml" || item.href.endsWith(".ncx"));

  if (ncxItem) {
    const ncxXml = zip.readText(ncxItem.path);
    if (ncxXml) {
      const ncxEntries = parseNcx(ncxXml, ncxItem.path);
      if (ncxEntries.length > 0) {
        return ncxEntries;
      }
    }
  }

  return [];
}

function augmentTocEntries(zip, manifest, spine, tocEntries) {
  if (!tocEntries.length || tocEntries.some((entry) => entry.level > 0)) {
    return tocEntries;
  }

  const orderedItems = orderedReadableItems(manifest, spine);
  const positionByPath = new Map();
  orderedItems.forEach((item, index) => {
    if (!positionByPath.has(item.path)) {
      positionByPath.set(item.path, index);
    }
  });

  const parentEntries = tocEntries
    .map((entry, order) => ({
      ...entry,
      order,
      position: positionByPath.get(entry.path),
    }))
    .filter((entry) => Number.isInteger(entry.position))
    .sort((a, b) => a.position - b.position || a.order - b.order);

  if (parentEntries.length === 0) {
    return tocEntries;
  }

  const additions = [];
  const seenTargets = new Set(tocEntries.map((entry) => tocTargetKey(entry)));

  for (const item of orderedItems) {
    const pagePosition = positionByPath.get(item.path);
    const parentIndex = findParentEntryIndex(parentEntries, pagePosition);
    if (parentIndex < 0) {
      continue;
    }

    const parent = parentEntries[parentIndex];
    const nextParent = parentEntries[parentIndex + 1];
    const parentEnd = nextParent ? nextParent.position : orderedItems.length;
    if (pagePosition >= parentEnd) {
      continue;
    }

    const html = zip.readText(item.path);
    const links = parseEmbeddedTocLinks(html, item.path);
    if (!looksLikeEmbeddedToc(html, links)) {
      continue;
    }

    const entries = normalizeEmbeddedTocEntries({
      links,
      parent,
      parentEnd,
      positionByPath,
      seenTargets,
    });
    additions.push(...entries);
  }

  if (additions.length === 0) {
    return tocEntries;
  }

  return [...tocEntries, ...additions]
    .map((entry, order) => ({
      ...entry,
      order,
      position: positionByPath.get(entry.path) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.position - b.position || a.level - b.level || a.order - b.order)
    .map(({ order, position, ...entry }) => entry);
}

function findParentEntryIndex(parentEntries, pagePosition) {
  for (let index = parentEntries.length - 1; index >= 0; index -= 1) {
    if (parentEntries[index].position < pagePosition) {
      return index;
    }
  }
  return -1;
}

function orderedReadableItems(manifest, spine) {
  const readable = (item) => item && XHTML_MEDIA_TYPES.has(item.mediaType);
  const linearItems = spine.items.filter((item) => item.linear).map((item) => manifest.get(item.idref)).filter(readable);
  const fallbackItems = Array.from(manifest.values()).filter(readable);
  return linearItems.length > 0 ? linearItems : fallbackItems;
}

function parseEmbeddedTocLinks(html, documentPath) {
  const body = extractBody(html) || html || "";
  const links = [];
  const blockRe = /<(p|blockquote|li|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let blockMatch;
  let order = 0;

  while ((blockMatch = blockRe.exec(body)) !== null) {
    const tag = blockMatch[1].toLowerCase();
    const attrs = blockMatch[2] || "";
    const content = blockMatch[3] || "";
    const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
    let anchorMatch;

    while ((anchorMatch = anchorRe.exec(content)) !== null) {
      const link = embeddedTocLink(anchorMatch[0], documentPath, tag, attrs, order);
      order += 1;
      if (link) {
        links.push(link);
      }
    }
  }

  if (links.length > 0) {
    return links;
  }

  const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorRe.exec(body)) !== null) {
    const link = embeddedTocLink(anchorMatch[0], documentPath, "", "", order);
    order += 1;
    if (link) {
      links.push(link);
    }
  }

  return links;
}

function embeddedTocLink(anchorHtml, documentPath, wrapperTag, wrapperAttrs, order) {
  const href = getAttr(anchorHtml, "href");
  const title = cleanText(anchorHtml);
  if (!href || !title || isNavChapterTitle(title)) {
    return null;
  }

  const resolved = resolveHref(dirname(documentPath), href);
  return {
    title,
    path: resolved.path,
    fragment: resolved.fragment,
    level: classifyEmbeddedTocLevel(title, wrapperTag, wrapperAttrs),
    order,
  };
}

function classifyEmbeddedTocLevel(title, wrapperTag, wrapperAttrs) {
  const text = String(title || "").trim();
  const attrs = String(wrapperAttrs || "").toLowerCase();
  if (wrapperTag === "blockquote") {
    return 1;
  }
  if (/^\d{1,4}$/.test(text) || /^第[一二三四五六七八九十百千万零〇两]+章$/.test(text)) {
    return 1;
  }
  if (/\bsub|indent|child/.test(attrs)) {
    return 1;
  }
  return 0;
}

function looksLikeEmbeddedToc(html, links) {
  if (links.length < 3) {
    return false;
  }
  const bodyText = htmlToPlainText(extractBody(html) || html).slice(0, 120);
  return /目录|contents?/i.test(bodyText);
}

function normalizeEmbeddedTocEntries(options) {
  const { links, parent, parentEnd, positionByPath, seenTargets } = options;
  const entries = [];
  const usedPaths = new Set();
  let currentParentTitle = "";

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const position = positionByPath.get(link.path);
    if (!Number.isInteger(position) || position <= parent.position || position >= parentEnd) {
      continue;
    }

    if (link.level === 0) {
      currentParentTitle = link.title;
    }

    const nextLink = nextEmbeddedTocLinkInSection(links, index + 1, parent, parentEnd, positionByPath);
    if (link.level === 0 && nextLink && nextLink.level > link.level && nextLink.path === link.path) {
      continue;
    }

    if (usedPaths.has(link.path) || seenTargets.has(tocTargetKey(link))) {
      continue;
    }

    const title = link.level > 0 && currentParentTitle && !sameTitlePrefix(link.title, currentParentTitle)
      ? `${currentParentTitle} / ${link.title}`
      : link.title;

    usedPaths.add(link.path);
    seenTargets.add(tocTargetKey(link));
    entries.push({
      title,
      path: link.path,
      fragment: link.fragment,
      level: parent.level + link.level + 1,
    });
  }

  return entries;
}

function nextEmbeddedTocLinkInSection(links, startIndex, parent, parentEnd, positionByPath) {
  for (let index = startIndex; index < links.length; index += 1) {
    const link = links[index];
    const position = positionByPath.get(link.path);
    if (Number.isInteger(position) && position > parent.position && position < parentEnd) {
      return link;
    }
  }
  return null;
}

function sameTitlePrefix(title, prefix) {
  const normalizedTitle = String(title || "").replace(/\s+/g, "");
  const normalizedPrefix = String(prefix || "").replace(/\s+/g, "");
  return normalizedTitle.startsWith(normalizedPrefix);
}

function tocTargetKey(entry) {
  return `${entry.path}#${entry.fragment || ""}`;
}

function parseNavDocument(navXml, navPath) {
  const navBlocks = navXml.match(/<nav\b[\s\S]*?<\/nav>/gi) || [];
  const tocBlock =
    navBlocks.find((block) => /\b(epub:type|type|role)\s*=\s*["'][^"']*(toc|doc-toc)[^"']*["']/i.test(block)) ||
    navBlocks[0] ||
    navXml;
  const entries = [];
  const tokenRe = /<\/?ol\b[^>]*>|<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let level = 0;
  let match;

  while ((match = tokenRe.exec(tocBlock)) !== null) {
    const token = match[0];
    if (/^<ol\b/i.test(token)) {
      level += 1;
      continue;
    }
    if (/^<\/ol/i.test(token)) {
      level = Math.max(0, level - 1);
      continue;
    }

    const href = getAttr(token, "href");
    const text = cleanText(stripTags(token));
    if (!href || !text) {
      continue;
    }

    const resolved = resolveHref(dirname(navPath), href);
    entries.push({
      title: text,
      path: resolved.path,
      fragment: resolved.fragment,
      level: Math.max(0, level - 1),
    });
  }

  return entries;
}

function parseNcx(ncxXml, ncxPath) {
  const entries = [];
  const stack = [];
  const tokenRe = /<navPoint\b[^>]*>|<\/navPoint>|<text\b[^>]*>[\s\S]*?<\/text>|<content\b[^>]*\/?>/gi;
  let match;

  while ((match = tokenRe.exec(ncxXml)) !== null) {
    const token = match[0];
    if (/^<navPoint\b/i.test(token)) {
      stack.push({ title: "", href: "", level: stack.length, pushed: false });
      continue;
    }

    if (/^<\/navPoint/i.test(token)) {
      const item = stack.pop();
      if (item && item.title && item.href && !item.pushed) {
        entries.push(toTocEntry(item, ncxPath));
      }
      continue;
    }

    const current = stack[stack.length - 1];
    if (!current) {
      continue;
    }

    if (/^<text\b/i.test(token) && !current.title) {
      current.title = cleanText(stripTags(token));
      continue;
    }

    if (/^<content\b/i.test(token) && !current.href) {
      current.href = getAttr(token, "src");
      if (current.title && current.href) {
        entries.push(toTocEntry(current, ncxPath));
        current.pushed = true;
      }
    }
  }

  return entries;
}

function toTocEntry(item, ncxPath) {
  const resolved = resolveHref(dirname(ncxPath), item.href);
  return {
    title: item.title,
    path: resolved.path,
    fragment: resolved.fragment,
    level: item.level,
  };
}

function buildChapters(zip, manifest, spine, tocEntries) {
  const orderedItems = orderedReadableItems(manifest, spine);
  const tocByPath = new Map();
  const chapters = [];

  for (const entry of tocEntries) {
    if (!tocByPath.has(entry.path)) {
      tocByPath.set(entry.path, entry);
    }
  }

  for (let itemIndex = 0; itemIndex < orderedItems.length; itemIndex += 1) {
    const item = orderedItems[itemIndex];
    const toc = tocByPath.get(item.path);
    const document = {
      id: item.id || `chapter-document-${itemIndex + 1}`,
      href: item.href,
      path: item.path,
      mediaType: item.mediaType,
    };

    const documentTitle = extractDocumentTitle(zip, item.path);
    const usableDocumentTitle = isNavChapterTitle(documentTitle) ? "" : documentTitle;
    const usableTocTitle = toc && !isNavChapterTitle(toc.title) ? toc.title : "";
    if (!usableTocTitle && !usableDocumentTitle && chapters.length > 0) {
      chapters[chapters.length - 1].documents.push(document);
      continue;
    }

    const index = chapters.length;
    const title = usableDocumentTitle || usableTocTitle || `Chapter ${index + 1}`;
    chapters.push({
      index,
      id: document.id,
      title,
      href: document.href,
      path: document.path,
      fragment: toc ? toc.fragment : "",
      mediaType: document.mediaType,
      level: toc ? toc.level : 0,
      documents: [document],
    });
  }

  return chapters;
}

function isNavChapterTitle(title) {
  return /^(后页|前页|目录|下页|上页|下一页|上一页|返回|回目录|首页)$/.test(String(title || "").replace(/\s+/g, ""));
}

function extractDocumentTitle(zip, documentPath) {
  const html = zip.readText(documentPath);
  if (!html) {
    return "";
  }

  return (
    cleanText(firstElementText(html, "title")) ||
    cleanText(firstElementText(html, "h1")) ||
    cleanText(firstElementText(html, "h2"))
  );
}

function renderChapter(zip, chapter, chaptersByPath) {
  const html = chapterDocuments(chapter)
    .map((document) => renderChapterDocument(zip, document, chaptersByPath))
    .join("\n");

  return {
    index: chapter.index,
    title: chapter.title,
    html,
  };
}

function renderChapterDocument(zip, document, chaptersByPath) {
  const source = zip.readText(document.path);
  if (!source) {
    throw new Error(`Missing chapter document "${document.path}".`);
  }

  const css = collectChapterCss(zip, source, document.path);
  const body = extractBody(source)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .trim();
  const raw = `${css ? `<style>${escapeStyleEnd(css)}</style>` : ""}${body || source}`;

  return sanitizeHtml(raw, {
    zip,
    documentPath: document.path,
    chaptersByPath,
  });
}

function extractChapterText(zip, chapter) {
  const parts = chapterDocuments(chapter).map((document) => extractDocumentText(zip, document));
  const text = parts.map((part) => part.text).filter(Boolean).join("\n\n");

  return {
    index: chapter.index,
    title: chapter.title,
    text,
    headings: parts.flatMap((part) => part.headings),
    estimatedCharacters: text.length,
  };
}

function extractDocumentText(zip, document) {
  const source = zip.readText(document.path);
  if (!source) {
    throw new Error(`Missing chapter document "${document.path}".`);
  }

  const body = extractBody(source) || source;
  const text = htmlToPlainText(body);
  return {
    text,
    headings: extractHeadings(body),
  };
}

function chapterDocuments(chapter) {
  return Array.isArray(chapter.documents) && chapter.documents.length > 0 ? chapter.documents : [chapter];
}

function htmlToPlainText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<!doctype[\s\S]*?>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
      .replace(/<(head|svg|math|iframe|object|embed|form|audio|video|canvas)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|section|article|aside|header|footer|main|blockquote|pre|li|ul|ol|dl|dt|dd|figure|figcaption|table|thead|tbody|tfoot|tr|h[1-6])>/gi, "\n")
      .replace(/<t[dh]\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s+([,.!?;:，。！？；：])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHeadings(html) {
  const headings = [];
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;

  while ((match = headingRe.exec(String(html || ""))) !== null) {
    const text = cleanText(match[2]);
    if (text) {
      headings.push({
        level: Number(match[1]),
        text,
      });
    }
  }

  return headings;
}

function collectChapterCss(zip, html, documentPath) {
  const cssParts = [];
  const linkRe = /<link\b[^>]*>/gi;
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;

  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    const rel = getAttr(tag, "rel").toLowerCase();
    const href = getAttr(tag, "href");
    if (!href || !/\bstylesheet\b/.test(rel)) {
      continue;
    }

    const cssPath = resolveHref(dirname(documentPath), href).path;
    const css = zip.readText(cssPath);
    if (css) {
      cssParts.push(rewriteCssUrls(css, cssPath, zip));
    }
  }

  while ((match = styleRe.exec(html)) !== null) {
    cssParts.push(match[1]);
  }

  return sanitizeCss(cssParts.join("\n"));
}

function rewriteCssUrls(css, cssPath, zip) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote, rawUrl) => {
    const url = rawUrl.trim();
    if (!url || url.startsWith("#") || /^data:/i.test(url)) {
      return full;
    }
    if (/^(https?:|file:|javascript:)/i.test(url)) {
      return "url(about:blank)";
    }

    const resolved = resolveHref(dirname(cssPath), url).path;
    const dataUrl = resourceDataUrl(zip, resolved);
    return dataUrl ? `url("${dataUrl}")` : "url(about:blank)";
  });
}

function sanitizeCss(css) {
  const cleaned = String(css || "")
    .replace(/@import\b[^;]+;/gi, "")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/javascript\s*:/gi, "")
    .replace(/writing-mode\s*:\s*[^;]+;?/gi, "")
    .replace(/(?:-webkit-|-moz-|-epub-)?hyphens\s*:\s*[^;]+;?/gi, "")
    .replace(/adobe-hyphenate\s*:\s*[^;]+;?/gi, "")
    .replace(/-webkit-hyphenate-limit-[a-z-]+\s*:\s*[^;]+;?/gi, "")
    .replace(/text-align\s*:\s*justify\s*;?/gi, "")
    .replace(/<\/style/gi, "<\\/style")
    .trim();

  if (!cleaned) {
    return "";
  }

  return `@scope (.chapter) {\n${cleaned}\n}`;
}

function sanitizeHtml(html, context) {
  const withoutDangerousBlocks = String(html || "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<(iframe|object|embed|form|input|button|textarea|select|option|canvas|audio|video|meta|base)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed|form|input|button|textarea|select|option|canvas|audio|video|meta|base)\b[^>]*\/?>/gi, "");

  return withoutDangerousBlocks.replace(/<\s*(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g, (full, closing, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    const simpleTag = tag.includes(":") ? tag.split(":").pop() : tag;
    if (!ALLOWED_TAGS.has(simpleTag)) {
      return "";
    }

    if (closing) {
      return VOID_TAGS.has(simpleTag) ? "" : `</${simpleTag}>`;
    }

    if (simpleTag === "style") {
      return "<style>";
    }

    const attrs = sanitizeAttributes(simpleTag, rawAttrs, context);
    const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
    return `<${simpleTag}${attrText}>`;
  });
}

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "big",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "image",
  "img",
  "ins",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "rb",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "s",
  "small",
  "span",
  "strong",
  "style",
  "sub",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const VOID_TAGS = new Set(["br", "col", "hr", "image", "img"]);

function sanitizeAttributes(tag, rawAttrs, context) {
  const attrs = [];
  const parsed = parseAttributes(rawAttrs);
  const seen = new Set();

  for (const attr of parsed) {
    const name = attr.name.toLowerCase();
    const value = decodeEntities(attr.value || "");

    if (seen.has(name) || name.startsWith("on")) {
      continue;
    }

    if (name === "style") {
      continue;
    }

    if (GLOBAL_ATTRS.has(name) || SVG_ATTRS.has(name)) {
      attrs.push(`${name}="${escapeAttr(value)}"`);
      seen.add(name);
      continue;
    }

    if (tag === "a" && name === "href") {
      const linkAttrs = linkAttributes(value, context);
      for (const linkAttr of linkAttrs) {
        attrs.push(linkAttr);
      }
      seen.add(name);
      continue;
    }

    if ((tag === "img" || tag === "image") && (name === "src" || name === "href" || name === "xlink:href")) {
      const dataUrl = resourceDataUrl(context.zip, resolveHref(dirname(context.documentPath), value).path);
      if (dataUrl) {
        attrs.push(tag === "img" ? `src="${escapeAttr(dataUrl)}"` : `href="${escapeAttr(dataUrl)}"`);
        seen.add(name);
      }
      continue;
    }

    if (TAG_ATTRS[tag] && TAG_ATTRS[tag].has(name)) {
      attrs.push(`${name}="${escapeAttr(value)}"`);
      seen.add(name);
    }
  }

  if (tag === "a" && !attrs.some((attr) => attr.startsWith("href="))) {
    attrs.push('href="#"');
  }

  if (tag === "img" && !attrs.some((attr) => attr.startsWith("loading="))) {
    attrs.push('loading="lazy"');
  }

  return attrs;
}

const GLOBAL_ATTRS = new Set(["class", "dir", "id", "lang", "title"]);
const SVG_ATTRS = new Set(["height", "preserveaspectratio", "role", "viewbox", "width", "xmlns"]);
const TAG_ATTRS = {
  col: new Set(["span", "width"]),
  img: new Set(["alt", "height", "loading", "width"]),
  table: new Set(["summary"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};

function linkAttributes(rawHref, context) {
  const href = String(rawHref || "").trim();
  if (!href) {
    return ['href="#"'];
  }

  if (/^(https?:|mailto:)/i.test(href)) {
    return [`href="${escapeAttr(href)}"`, 'data-external-link="true"', 'rel="noreferrer noopener"'];
  }

  if (/^(javascript:|file:|command:|vscode:|data:)/i.test(href)) {
    return ['href="#"'];
  }

  if (href.startsWith("#")) {
    return [`href="${escapeAttr(href)}"`];
  }

  const resolved = resolveHref(dirname(context.documentPath), href);
  const chapterIndex = context.chaptersByPath.get(resolved.path);
  if (chapterIndex !== undefined) {
    const attrs = [`href="#"`, `data-chapter-index="${chapterIndex}"`];
    if (resolved.fragment) {
      attrs.push(`data-fragment="${escapeAttr(resolved.fragment)}"`);
    }
    return attrs;
  }

  return ['href="#"'];
}

function resourceDataUrl(zip, resourcePath) {
  const pathName = normalizeZipPath(resourcePath);
  let bytes;
  try {
    bytes = zip.read(pathName);
  } catch {
    return "";
  }

  if (!bytes) {
    return "";
  }

  const ext = path.extname(pathName).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext] || "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function parseAttributes(rawAttrs) {
  const attrs = [];
  const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attrRe.exec(rawAttrs || "")) !== null) {
    attrs.push({
      name: match[1],
      value: match[2] ?? match[3] ?? match[4] ?? "",
    });
  }

  return attrs;
}

function firstTag(xml, tagName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${escapeRegExp(tagName)}\\b[^>]*>`, "i");
  const match = String(xml || "").match(re);
  return match ? match[0] : "";
}

function firstElementText(xml, localName) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${escapeRegExp(localName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapeRegExp(localName)}>`, "i");
  const match = String(xml || "").match(re);
  return match ? match[1] : "";
}

function getAttr(tag, attrName) {
  if (!tag) {
    return "";
  }
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(attrName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`, "i");
  const match = String(tag).match(re);
  return decodeEntities(match ? match[1] ?? match[2] ?? match[3] ?? "" : "");
}

function extractBody(html) {
  const match = String(html || "").match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : "";
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (full, name) => ENTITY_MAP[name.toLowerCase()] || full);
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeStyleEnd(value) {
  return String(value || "").replace(/<\/style/gi, "<\\/style");
}

function resolveHref(baseDir, href) {
  const withoutQuery = String(href || "").split("?")[0];
  const hashIndex = withoutQuery.indexOf("#");
  const pathPart = hashIndex >= 0 ? withoutQuery.slice(0, hashIndex) : withoutQuery;
  const fragment = hashIndex >= 0 ? withoutQuery.slice(hashIndex + 1) : "";
  const decodedPath = safeDecodeUri(pathPart);
  const resolvedPath = decodedPath
    ? normalizeZipPath(path.join(baseDir || "", decodedPath))
    : normalizeZipPath(baseDir || "");

  return {
    path: resolvedPath,
    fragment: safeDecodeUri(fragment),
  };
}

function dirname(filePath) {
  const dir = path.dirname(normalizeZipPath(filePath));
  return dir === "." ? "" : dir;
}

function stripExtension(fileName) {
  return String(fileName || "Untitled EPUB").replace(/\.[^.]+$/, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  htmlToPlainText,
  parseEpub,
  parseNavDocument,
  parseNcx,
  resolveHref,
  sanitizeHtml,
};
