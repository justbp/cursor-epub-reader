"use strict";

const { AI_ERROR_CODES, AiError, errorFromHttpStatus } = require("./errors");

class OllamaProvider {
  constructor(options) {
    this.baseUrl = normalizeOllamaBaseUrl(options.baseUrl);
    this.model = String(options.model || "");
  }

  async complete(request, signal) {
    return this._request(request, signal, null);
  }

  async completeStream(request, signal, onDelta) {
    return this._request(request, signal, onDelta);
  }

  async _request(request, signal, onDelta) {
    if (!this.model) {
      throw new AiError(AI_ERROR_CODES.invalidConfig, "Ollama model is not configured.");
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: toMessages(request),
        stream: typeof onDelta === "function",
        options: {
          temperature: request.temperature ?? 0.2,
        },
      }),
      signal,
    });

    if (typeof onDelta === "function") {
      if (!response.ok) {
        const json = await readJson(response);
        throw errorFromHttpStatus(response.status, providerMessage(json));
      }
      return readOllamaStream(response, onDelta);
    }

    const json = await readJson(response);
    if (!response.ok) {
      throw errorFromHttpStatus(response.status, providerMessage(json));
    }

    const text = json && json.message && json.message.content;
    if (!text) {
      throw new AiError(AI_ERROR_CODES.emptyResponse, "Ollama returned an empty response.");
    }

    return {
      text: String(text).trim(),
      usage: {
        inputTokens: json.prompt_eval_count,
        outputTokens: json.eval_count,
      },
      raw: json,
    };
  }
}

function toMessages(request) {
  const messages = [];
  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }
  for (const message of request.messages || []) {
    messages.push({
      role: message.role || "user",
      content: String(message.content || ""),
    });
  }
  return messages;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function readOllamaStream(response, onDelta) {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new AiError(AI_ERROR_CODES.providerError, "Ollama did not return a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let raw = null;
  let usage = {};
  const processLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let json = null;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return;
    }

    raw = json;
    if (json.prompt_eval_count || json.eval_count) {
      usage = {
        inputTokens: json.prompt_eval_count,
        outputTokens: json.eval_count,
      };
    }

    const delta = json.message && json.message.content ? String(json.message.content) : "";
    if (delta) {
      text += delta;
      await onDelta(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      await processLine(line);
    }
  }

  const trailing = decoder.decode();
  if (trailing) {
    buffer += trailing;
  }
  if (buffer.trim()) {
    await processLine(buffer);
  }

  if (!text.trim()) {
    throw new AiError(AI_ERROR_CODES.emptyResponse, "Ollama returned an empty response.");
  }

  return {
    text: text.trim(),
    usage,
    raw,
  };
}

function providerMessage(json) {
  if (!json) {
    return "";
  }
  if (json.error) {
    return typeof json.error === "string" ? json.error : json.error.message;
  }
  return JSON.stringify(json).slice(0, 600);
}

function normalizeOllamaBaseUrl(value) {
  return String(value || "http://localhost:11434").trim().replace(/\/+$/, "");
}

module.exports = {
  OllamaProvider,
  normalizeOllamaBaseUrl,
};
