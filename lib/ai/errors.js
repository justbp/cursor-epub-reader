"use strict";

const AI_ERROR_CODES = {
  providerDisabled: "providerDisabled",
  missingApiKey: "missingApiKey",
  invalidConfig: "invalidConfig",
  networkError: "networkError",
  unauthorized: "unauthorized",
  rateLimited: "rateLimited",
  modelNotFound: "modelNotFound",
  contextTooLarge: "contextTooLarge",
  requestCancelled: "requestCancelled",
  providerError: "providerError",
  emptyResponse: "emptyResponse",
  unknown: "unknown",
};

class AiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AiError";
    this.code = code || AI_ERROR_CODES.unknown;
    this.retryable = options.retryable === true;
    this.status = options.status;
  }
}

function normalizeAiError(error) {
  if (error && error.name === "AbortError") {
    return {
      code: AI_ERROR_CODES.requestCancelled,
      message: "AI request was cancelled.",
      retryable: false,
    };
  }

  if (error instanceof AiError) {
    return {
      code: error.code,
      message: sanitizeErrorMessage(error.message),
      retryable: error.retryable,
      status: error.status,
    };
  }

  const message = sanitizeErrorMessage(error && error.message ? error.message : String(error || "Unknown AI error."));
  return {
    code: isLikelyNetworkError(message) ? AI_ERROR_CODES.networkError : AI_ERROR_CODES.unknown,
    message,
    retryable: isLikelyNetworkError(message),
  };
}

function errorFromHttpStatus(status, message) {
  const text = sanitizeErrorMessage(message || `AI provider returned HTTP ${status}.`);

  if (status === 401 || status === 403) {
    return new AiError(AI_ERROR_CODES.unauthorized, "AI provider rejected the credentials.", {
      status,
      retryable: false,
    });
  }

  if (status === 404) {
    return new AiError(AI_ERROR_CODES.modelNotFound, text || "AI model was not found.", {
      status,
      retryable: false,
    });
  }

  if (status === 429) {
    return new AiError(AI_ERROR_CODES.rateLimited, "AI provider rate limit was reached.", {
      status,
      retryable: true,
    });
  }

  if (status === 400 && /context|token|too\s+long|maximum/i.test(text)) {
    return new AiError(AI_ERROR_CODES.contextTooLarge, text, {
      status,
      retryable: false,
    });
  }

  return new AiError(AI_ERROR_CODES.providerError, text, {
    status,
    retryable: status >= 500,
  });
}

function sanitizeErrorMessage(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(key=)[^&\s]+/gi, "$1[redacted]")
    .trim();
}

function isLikelyNetworkError(message) {
  return /fetch|network|timeout|dns|socket|ECONN|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(message || "");
}

module.exports = {
  AI_ERROR_CODES,
  AiError,
  errorFromHttpStatus,
  normalizeAiError,
};
