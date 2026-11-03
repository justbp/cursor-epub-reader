"use strict";

const { AI_ERROR_CODES, AiError, errorFromHttpStatus } = require("./errors");

class OpenAiCompatibleProvider {
  constructor(options) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = String(options.apiKey || "");
    this.model = String(options.model || "");
  }

  async complete(request, signal) {
    return this._request(request, signal, null);
  }

  async completeStream(request, signal, onDelta) {
    return this._request(request, signal, onDelta);
  }

  async _request(request, signal, onDelta) {
    if (!this.baseUrl) {
      throw new AiError(AI_ERROR_CODES.invalidConfig, "AI base URL is not configured.");
    }
    if (!this.model) {
      throw new AiError(AI_ERROR_CODES.invalidConfig, "AI model is not configured.");
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({
        model: this.model,
        messages: toMessages(request),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxOutputTokens || 1800,
        stream: typeof onDelta === "function",
      }),
      signal,
    });

    if (typeof onDelta === "function") {
      if (!response.ok) {
        const json = await readJson(response);
        throw errorFromHttpStatus(response.status, providerMessage(json));
      }
      return readOpenAiStream(response, onDelta);
    }

    const json = await readJson(response);
    if (!response.ok) {
      throw errorFromHttpStatus(response.status, providerMessage(json));
    }

    const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) {
      throw new AiError(AI_ERROR_CODES.emptyResponse, "AI provider returned an empty response.");
    }

    return {
      text: String(text).trim(),
      usage: json.usage || {},
      raw: json,
    };
  }

  _headers() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
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
    return { error: { message: text } };
  }
}

async function readOpenAiStream(response, onDelta) {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new AiError(AI_ERROR_CODES.providerError, "AI provider did not return a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = {};
  let raw = null;
  const processLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
      return;
    }

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      return;
    }

    let json = null;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    raw = json;
    if (json.usage) {
      usage = json.usage;
    }
    const delta = streamDelta(json);
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
    throw new AiError(AI_ERROR_CODES.emptyResponse, "AI provider returned an empty response.");
  }

  return {
    text: text.trim(),
    usage,
    raw,
  };
}

function streamDelta(json) {
  const choice = json && json.choices && json.choices[0];
  if (!choice) {
    return "";
  }
  if (choice.delta && choice.delta.content) {
    return String(choice.delta.content);
  }
  if (choice.message && choice.message.content) {
    return String(choice.message.content);
  }
  return "";
}

function providerMessage(json) {
  if (!json) {
    return "";
  }
  if (json.error && json.error.message) {
    return json.error.message;
  }
  if (json.message) {
    return json.message;
  }
  return JSON.stringify(json).slice(0, 600);
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

module.exports = {
  OpenAiCompatibleProvider,
  normalizeBaseUrl,
};
