"use strict";
// Sec-MS-GEC token from node-edge-tts 1.2.12 (MIT).
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSecMsGecToken_V2 = exports.generateSecMsGecToken = exports.TRUSTED_CLIENT_TOKEN = exports.SEC_MS_GEC_VERSION_V2 = exports.SEC_MS_GEC_VERSION = exports.CHROMIUM_FULL_VERSION = void 0;
const node_crypto_1 = require("node:crypto");
exports.CHROMIUM_FULL_VERSION = '143.0.3650.75';
exports.SEC_MS_GEC_VERSION = `1-${exports.CHROMIUM_FULL_VERSION}`;
exports.SEC_MS_GEC_VERSION_V2 = `2-${exports.CHROMIUM_FULL_VERSION}`;
exports.TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
function generateSecMsGecToken() {
    const ticks = BigInt(Math.floor((Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
    const roundedTicks = ticks - (ticks % 3000000000n);
    const strToHash = `${roundedTicks}${exports.TRUSTED_CLIENT_TOKEN}`;
    const hash = (0, node_crypto_1.createHash)('sha256');
    hash.update(strToHash, 'ascii');
    return hash.digest('hex').toUpperCase();
}
exports.generateSecMsGecToken = generateSecMsGecToken;
// 固定前缀使用 Base64 分段存储
const PREFIX = Buffer.from([
    'Q29weXJpZ2h0IChDKSBNaWNyb3NvZnQg',
    'Q29ycG9yYXRpb24uIEFsbCByaWdodHMgcmVzZXJ2ZWQu',
].join(''), 'base64');
const COEFFICIENTS = [
    [0xE82E91B1, 0xB32700D0],
    [0x44DE24C6, 0x88DFF51D],
    [0x3BEB65BC, 0x29514038],
    [0xC89C5933, 0xB328CBDF],
    [0x8D1EC211, 0xD405B4D5],
    [0x314EF5D5, 0x26E55F3C],
    [0xE92491B1, 0x607801C6],
    [0xF0A5B9D5, 0x82B2C1FB],
    [0x06064CF3, 0xFA51A3DA],
    [0xDA79FA60, 0x207CC464],
    [0xBED20560, 0x3C3C74F3],
    [0x89F9C9F8, 0xD2D14B61],
    [0x35FA38C6, 0xBB04A2C1],
    [0xCB49E3C6, 0xC5626167],
];
const mul = Math.imul;
const rol16 = (x) => ((x << 16) | (x >>> 16)) >>> 0;
function cs64Digest(data, shaDigest) {
    const keyA = (shaDigest.readUInt32LE(0) | 1) >>> 0;
    const keyB = (shaDigest.readUInt32LE(4) | 1) >>> 0;
    const factors = [
        mul(keyA, 0x82893933) >>> 0,
        mul(keyB, 0x82893933) >>> 0,
    ];
    const terms = COEFFICIENTS.map(([coefficient], i) => mul(coefficient, factors[i % 2]) >>> 0);
    const offsets = COEFFICIENTS.map(([, offset]) => offset);
    const padded = Buffer.alloc(Math.ceil((data.length + 1) / 8) * 8);
    padded.set(data, 1);
    for (let i = 0; i < padded.length / 4; i++) {
        const word = padded.readUInt32LE(i * 4);
        let term = mul(word, i % 2 === 0 ? keyA : keyB);
        let offset = mul(rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
        if (i === 0) {
            term = (term + mul(0xF2F90B1A, factors[0])) >>> 0;
            offset = (offset + 0x0B1A0000) >>> 0;
        }
        terms.push(term >>> 0);
        offsets.push(offset >>> 0);
    }
    let swapAcc = 0;
    let swapLast = 0;
    let state = 0;
    let acc = 0;
    for (let i = 0; i < terms.length; i += 2) {
        const x = terms[i];
        const y = terms[i + 1];
        let t = rol16((offsets[i] + x) >>> 0);
        let q = mul(t, 0x76F50F34);
        swapAcc += (mul(rol16(q), 0xC3EFEA97) + q) >>> 0;
        t = rol16((offsets[i + 1] + y) >>> 0);
        q = mul(t, 0x1881CE3C);
        swapLast = (mul(rol16(q), 0x35BD1EC9) + q) >>> 0;
        swapAcc = (swapAcc + swapLast) >>> 0;
        state = (mul(state, keyA) + x) >>> 0;
        for (const k of [
            0xCF98B111,
            0x87085B9F,
            0x12CEB96D,
            0x257E1D83,
        ]) {
            state = mul(rol16(state), k) >>> 0;
        }
        acc += state;
        t = (mul(state, keyB) + y) >>> 0;
        t = mul(rol16(t), 0xA27416F5) >>> 0;
        t = mul(rol16(t), 0xD38396FF) >>> 0;
        state = mul(rol16(mul(rol16(t), 0x7C932B89)), 0xBFA49F69) >>> 0;
        acc = (acc + state) >>> 0;
    }
    const result = Buffer.allocUnsafe(8);
    result.writeUInt32LE((swapLast ^ state) >>> 0, 0);
    result.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
    return result;
}
/**
 * 根据 Unix 时间戳生成 Sec-MS-GEC v2 Token
 *
 * @param unixSeconds Unix 时间戳（秒）
 * @returns CS64-SHA256 格式的 Token
 */
function generateSecMsGecToken_V2(unixSeconds = Date.now() / 1000) {
    if (!Number.isFinite(unixSeconds)) {
        throw new TypeError('unixSeconds must be a finite number');
    }
    const epochSeconds = BigInt(Math.floor(unixSeconds)) + WINDOWS_FILE_TIME_EPOCH;
    const roundedSeconds = epochSeconds - (epochSeconds % 300n);
    const ticks = roundedSeconds * 10000000n;
    const data = Buffer.from(`${ticks}${exports.TRUSTED_CLIENT_TOKEN}`, 'ascii');
    const sha = (0, node_crypto_1.createHash)('sha256')
        .update(new Uint8Array(PREFIX))
        .update(new Uint8Array(data))
        .digest();
    const cs64 = cs64Digest(data, sha);
    return (`${cs64.toString('hex').toUpperCase()}-` +
        sha.toString('hex').toUpperCase());
}
exports.generateSecMsGecToken_V2 = generateSecMsGecToken_V2;
