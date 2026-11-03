"use strict";

// Edge read-aloud client. Token and websocket flow follow node-edge-tts (MIT).
const crypto = require("node:crypto");
const WebSocket = require("ws");
const { CHROMIUM_FULL_VERSION, SEC_MS_GEC_VERSION_V2, TRUSTED_CLIENT_TOKEN, generateSecMsGecToken_V2 } = require("./edge-drm");

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => {
    switch (character) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "\"": return "&quot;";
      case "'": return "&apos;";
      default: return character;
    }
  });
}

function speedToRate(speed) {
  const percent = Math.round((Number(speed) - 1) * 100);
  if (!Number.isFinite(percent)) {
    return "+0%";
  }
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

function synthesizeEdgeSpeech(text, options = {}) {
  const voice = options.voice || "zh-CN-XiaoxiaoNeural";
  const lang = voice.split("-").slice(0, 2).join("-") || "zh-CN";
  const rate = speedToRate(options.speed || 1);
  const timeout = options.timeout || 30000;
  const job = { cancelled: false, cancel() {} };

  job.promise = new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const url = `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken_V2()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION_V2}`;
    const socket = new WebSocket(url, {
      host: "speech.platform.bing.com",
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      headers: {
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0`,
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const finish = (error, audio) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
      if (error) {
        reject(error);
      } else {
        resolve(audio);
      }
    };

    const timer = setTimeout(() => finish(new Error("语音生成超时")), timeout);
    job.cancel = () => {
      job.cancelled = true;
      finish(new Error("cancelled"));
    };

    socket.on("open", () => {
      if (job.cancelled) {
        return;
      }
      socket.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
      const requestId = crypto.randomBytes(16).toString("hex");
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rate}" pitch="+0Hz" volume="+0%">${escapeXml(text)}</prosody></voice></speak>`;
      socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    socket.on("message", (data, isBinary) => {
      if (job.cancelled) {
        return;
      }
      if (isBinary) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const separator = "Path:audio\r\n";
        const index = buffer.indexOf(separator);
        if (index >= 0) {
          chunks.push(buffer.subarray(index + separator.length));
        }
        return;
      }
      const message = data.toString();
      if (message.includes("Path:turn.end")) {
        const audio = Buffer.concat(chunks);
        if (!audio.length) {
          finish(new Error("没有收到音频"));
          return;
        }
        finish(null, audio);
      }
    });

    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      if (!settled) {
        finish(new Error("语音连接已断开"));
      }
    });
  });

  return job;
}

module.exports = {
  synthesizeEdgeSpeech,
};
