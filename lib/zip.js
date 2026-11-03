"use strict";

const zlib = require("zlib");
const { TextDecoder } = require("util");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const UTF8_FILE_NAME_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;

class ZipArchive {
  constructor(input) {
    this.buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    this.entries = new Map();

    if (this.buffer.length < 22) {
      throw new Error("Invalid EPUB archive: file is too small to be a ZIP.");
    }

    this._readCentralDirectory();
  }

  list() {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry }));
  }

  has(name) {
    return Boolean(this._find(name));
  }

  read(name) {
    const entry = this._find(name);
    if (!entry || entry.directory) {
      return undefined;
    }

    if (entry.flags & ENCRYPTED_FLAG) {
      throw new Error(`Unsupported EPUB archive: encrypted entry "${entry.name}".`);
    }

    const localOffset = entry.localHeaderOffset;
    if (localOffset + 30 > this.buffer.length) {
      throw new Error(`Corrupt EPUB archive: bad local header for "${entry.name}".`);
    }

    const signature = this.buffer.readUInt32LE(localOffset);
    if (signature !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Corrupt EPUB archive: missing local header for "${entry.name}".`);
    }

    const nameLength = this.buffer.readUInt16LE(localOffset + 26);
    const extraLength = this.buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;

    if (dataOffset < 0 || dataEnd > this.buffer.length) {
      throw new Error(`Corrupt EPUB archive: invalid data range for "${entry.name}".`);
    }

    const compressed = this.buffer.subarray(dataOffset, dataEnd);

    if (entry.method === 0) {
      return Buffer.from(compressed);
    }

    if (entry.method === 8) {
      try {
        return zlib.inflateRawSync(compressed);
      } catch (error) {
        throw new Error(`Corrupt EPUB archive: failed to inflate "${entry.name}". ${error.message}`);
      }
    }

    throw new Error(`Unsupported EPUB archive: ZIP compression method ${entry.method} in "${entry.name}".`);
  }

  readText(name) {
    const bytes = this.read(name);
    if (!bytes) {
      return undefined;
    }
    return decodeText(bytes);
  }

  _readCentralDirectory() {
    const eocdOffset = findEndOfCentralDirectory(this.buffer);
    if (eocdOffset < 0) {
      throw new Error("Invalid EPUB archive: missing ZIP end-of-central-directory record.");
    }

    const diskNumber = this.buffer.readUInt16LE(eocdOffset + 4);
    const centralDirectoryDisk = this.buffer.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = this.buffer.readUInt16LE(eocdOffset + 8);
    const totalEntries = this.buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectorySize = this.buffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = this.buffer.readUInt32LE(eocdOffset + 16);

    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
      throw new Error("Unsupported EPUB archive: multi-disk ZIP files are not supported.");
    }

    if (
      totalEntries === 0xffff ||
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff
    ) {
      throw new Error("Unsupported EPUB archive: ZIP64 EPUB files are not supported yet.");
    }

    if (centralDirectoryOffset + centralDirectorySize > this.buffer.length) {
      throw new Error("Corrupt EPUB archive: central directory points outside the file.");
    }

    let offset = centralDirectoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > this.buffer.length) {
        throw new Error("Corrupt EPUB archive: central directory ended unexpectedly.");
      }

      const signature = this.buffer.readUInt32LE(offset);
      if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new Error("Corrupt EPUB archive: invalid central directory entry.");
      }

      const flags = this.buffer.readUInt16LE(offset + 8);
      const method = this.buffer.readUInt16LE(offset + 10);
      const compressedSize = this.buffer.readUInt32LE(offset + 20);
      const uncompressedSize = this.buffer.readUInt32LE(offset + 24);
      const nameLength = this.buffer.readUInt16LE(offset + 28);
      const extraLength = this.buffer.readUInt16LE(offset + 30);
      const commentLength = this.buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = this.buffer.readUInt32LE(offset + 42);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;

      if (nameEnd > this.buffer.length) {
        throw new Error("Corrupt EPUB archive: invalid file name in central directory.");
      }

      const name = normalizeZipPath(decodeFileName(this.buffer.subarray(nameStart, nameEnd), flags));
      if (name) {
        this.entries.set(name, {
          name,
          method,
          flags,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
          directory: name.endsWith("/"),
        });
      }

      offset = nameEnd + extraLength + commentLength;
    }
  }

  _find(name) {
    const normalized = normalizeZipPath(name);
    if (this.entries.has(normalized)) {
      return this.entries.get(normalized);
    }

    const decoded = normalizeZipPath(safeDecodeUri(normalized));
    return this.entries.get(decoded);
  }
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function decodeFileName(bytes, flags) {
  if (flags & UTF8_FILE_NAME_FLAG) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString("binary");
  }
}

function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }

  const header = buffer.subarray(0, Math.min(buffer.length, 512)).toString("ascii");
  const match = header.match(/encoding\s*=\s*["']([^"']+)["']/i);
  const encoding = normalizeEncoding(match ? match[1] : "utf-8");

  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
}

function normalizeEncoding(label) {
  const value = String(label || "utf-8").trim().toLowerCase().replace("_", "-");
  if (value === "utf8") {
    return "utf-8";
  }
  if (value === "gbk" || value === "gb2312") {
    return "gb18030";
  }
  return value;
}

function normalizeZipPath(input) {
  const raw = String(input || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = [];

  for (const part of raw.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

module.exports = {
  ZipArchive,
  decodeText,
  normalizeZipPath,
  safeDecodeUri,
};
