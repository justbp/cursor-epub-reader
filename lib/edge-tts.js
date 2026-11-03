"use strict";

// Edge read-aloud client. Token and websocket flow follow node-edge-tts (MIT).
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { execFile } = require("node:child_process");
const WebSocket = require("ws");
const { CHROMIUM_FULL_VERSION, SEC_MS_GEC_VERSION_V2, TRUSTED_CLIENT_TOKEN, generateSecMsGecToken_V2 } = require("./edge-drm");

let proxyCache = { at: 0, url: "" };

function proxyFromEnvironment() {
  const value = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || "";
  return /^https?:\/\//i.test(value) ? value : "";
}

function systemProxyUrl() {
  const fromEnv = proxyFromEnvironment();
  if (fromEnv) {
    return Promise.resolve(fromEnv);
  }
  if (process.platform !== "darwin") {
    return Promise.resolve("");
  }
  if (Date.now() - proxyCache.at < 30000) {
    return Promise.resolve(proxyCache.url);
  }
  return new Promise((resolve) => {
    execFile("scutil", ["--proxy"], { timeout: 1500 }, (error, stdout) => {
      let url = "";
      const text = stdout || "";
      const enabled = /HTTPSEnable\s*:\s*1/.test(text);
      const host = text.match(/HTTPSProxy\s*:\s*(\S+)/);
      const port = text.match(/HTTPSPort\s*:\s*(\d+)/);
      if (!error && enabled && host && port) {
        url = `http://${host[1]}:${port[1]}`;
      }
      proxyCache = { at: Date.now(), url };
      resolve(url);
    });
  });
}

class SystemProxyAgent extends https.Agent {
  constructor(proxyUrl) {
    super({ keepAlive: false });
    const url = new URL(proxyUrl);
    this.proxyHost = url.hostname;
    this.proxyPort = Number(url.port || 80);
  }

  createConnection(options, callback) {
    let settled = false;
    const done = (error, socket) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(error, socket);
    };
    const host = options.host;
    const port = options.port || 443;
    const request = http.request({
      host: this.proxyHost,
      port: this.proxyPort,
      method: "CONNECT",
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}` },
    });
    request.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        done(new Error(`代理连接失败（${response.statusCode}）`));
        return;
      }
      const secure = tls.connect({
        socket,
        servername: options.servername || host,
      });
      secure.once("secureConnect", () => done(null, secure));
      secure.once("error", done);
    });
    request.once("error", (error) => {
      done(error.code === "ECONNREFUSED"
        ? new Error("系统代理没有打开")
        : error);
    });
    request.setTimeout(8000, () => request.destroy(new Error("系统代理连接超时")));
    request.end();
  }
}

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
  const job = {
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  };

  job.promise = (async () => {
    const proxyUrl = await systemProxyUrl();
    if (job.cancelled) {
      throw new Error("cancelled");
    }
    return await new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const url = `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken_V2()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION_V2}`;
    const socket = new WebSocket(url, {
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      headers: {
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0`,
        "Accept-Language": "en-US,en;q=0.9",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
      agent: proxyUrl ? new SystemProxyAgent(proxyUrl) : undefined,
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
        if (buffer.length >= 2) {
          const headerLength = buffer.readUInt16BE(0);
          const audio = buffer.subarray(headerLength + 2);
          if (headerLength + 2 <= buffer.length && audio.length) {
            chunks.push(audio);
          }
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
  })();

  return job;
}

module.exports = {
  synthesizeEdgeSpeech,
};
