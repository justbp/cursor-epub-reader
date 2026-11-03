"use strict";

const { AiError, AI_ERROR_CODES } = require("./errors");
const { OpenAiCompatibleProvider } = require("./openai-compatible");
const { OllamaProvider } = require("./ollama");

const SECRET_KEYS = {
  openai: "cursorEpub.ai.openai.apiKey",
  openaiCompatible: "cursorEpub.ai.openaiCompatible.apiKey",
  deepseek: "cursorEpub.ai.deepseek.apiKey",
};

function createAiProvider(config) {
  const provider = config.provider || "disabled";

  if (provider === "disabled") {
    throw new AiError(AI_ERROR_CODES.providerDisabled, "AI provider is disabled.");
  }

  if (provider === "openai") {
    if (!config.apiKey) {
      throw new AiError(AI_ERROR_CODES.missingApiKey, "OpenAI API key is not configured.");
    }
    return new OpenAiCompatibleProvider({
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  if (provider === "deepseek") {
    if (!config.apiKey) {
      throw new AiError(AI_ERROR_CODES.missingApiKey, "DeepSeek API key is not configured.");
    }
    return new OpenAiCompatibleProvider({
      baseUrl: config.baseUrl || defaultBaseUrl(provider),
      apiKey: config.apiKey,
      model: config.model || defaultModel(provider),
    });
  }

  if (provider === "openaiCompatible") {
    return new OpenAiCompatibleProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  if (provider === "ollama") {
    return new OllamaProvider({
      baseUrl: config.baseUrl || "http://localhost:11434",
      model: config.model,
    });
  }

  throw new AiError(AI_ERROR_CODES.invalidConfig, `Unsupported AI provider: ${provider}.`);
}

function publicAiStatus(config, hasApiKey) {
  const provider = config.provider || "disabled";
  const supported = provider === "openai" || provider === "deepseek" || provider === "openaiCompatible" || provider === "ollama";
  const requiresKey = provider === "openai" || provider === "deepseek";
  const requiresBaseUrl = provider === "deepseek" || provider === "openaiCompatible" || provider === "ollama";
  const configured =
    supported &&
    Boolean(config.model || defaultModel(provider)) &&
    (!requiresBaseUrl || Boolean(config.baseUrl || defaultBaseUrl(provider))) &&
    Boolean(provider === "ollama" || provider === "openaiCompatible" || !requiresKey || hasApiKey);

  return {
    configured,
    provider,
    model: config.model || defaultModel(provider),
    baseUrl: publicBaseUrl(config.baseUrl || defaultBaseUrl(provider)),
    needsApiKey: requiresKey && !hasApiKey,
  };
}

function defaultBaseUrl(provider) {
  if (provider === "openai") {
    return "https://api.openai.com/v1";
  }
  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }
  if (provider === "ollama") {
    return "http://localhost:11434";
  }
  return "";
}

function defaultModel(provider) {
  if (provider === "deepseek") {
    return "deepseek-v4-flash";
  }
  return "";
}

function publicBaseUrl(value) {
  const text = String(value || "");
  return text.replace(/(api[_-]?key=)[^&\s]+/gi, "$1[redacted]").replace(/(key=)[^&\s]+/gi, "$1[redacted]");
}

module.exports = {
  SECRET_KEYS,
  createAiProvider,
  defaultBaseUrl,
  defaultModel,
  publicAiStatus,
};
