import zlib from "node:zlib";

const NON_PRINTABLE = /[^\x09\x0a\x0d\x20-\x7e]/g;
const PDF_OBJECT_NOISE_PATTERN =
  /(?:%PDF-\d|<<|>>|\/Type\b|\/Font\b|\/ProcSet\b|\/XObject\b|\/MediaBox\b|\/Contents\b|\/Resources\b|\/Length\b|\bendobj\b|\bobj\b|\bstream\b|\bendstream\b)/i;
const PDF_DRAW_COMMAND_PATTERN = /\b(?:BT|ET|Td|Tf|Tm|TJ|Tj|re|cm|Do|RG|rg)\b/g;
const TEXT_OPERATOR_WRAPPER_PATTERN =
  /(?:\)\s*Tj\b|\]\s*TJ\b|\/F\d+\s+\d+(?:\.\d+)?\s+Tf\b|\b\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+Td\b)/i;
const HEX_TOKEN_PATTERN = /<[0-9A-Fa-f\s]+>/g;

function toUpperHex(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function decodeUtf16BeHex(hex) {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0) {
    return "";
  }
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const codePoint = Number.parseInt(clean.slice(i, i + 4), 16);
    if (!Number.isFinite(codePoint)) {
      continue;
    }
    out.push(String.fromCodePoint(codePoint));
  }
  return out.join("");
}

function decodeHexTokenToBytes(hexToken) {
  const clean = hexToken.replace(/[<>\s]/g, "");
  if (clean.length === 0) {
    return [];
  }
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = [];
  for (let i = 0; i < padded.length; i += 2) {
    const value = Number.parseInt(padded.slice(i, i + 2), 16);
    if (!Number.isFinite(value)) {
      continue;
    }
    bytes.push(value);
  }
  return bytes;
}

function decodePdfStringToBytes(input) {
  const out = [];
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "\\") {
      out.push(ch.charCodeAt(0) & 0xff);
      continue;
    }

    const next = input[i + 1];
    if (!next) {
      break;
    }
    if (next === "n") {
      out.push(0x0a);
      i += 1;
      continue;
    }
    if (next === "r") {
      out.push(0x0d);
      i += 1;
      continue;
    }
    if (next === "t") {
      out.push(0x09);
      i += 1;
      continue;
    }
    if (next === "b") {
      out.push(0x08);
      i += 1;
      continue;
    }
    if (next === "f") {
      out.push(0x0c);
      i += 1;
      continue;
    }
    if (next === "(" || next === ")" || next === "\\") {
      out.push(next.charCodeAt(0) & 0xff);
      i += 1;
      continue;
    }
    if (/[0-7]/.test(next)) {
      let oct = next;
      if (/[0-7]/.test(input[i + 2] ?? "")) oct += input[i + 2];
      if (/[0-7]/.test(input[i + 3] ?? "")) oct += input[i + 3];
      out.push(Number.parseInt(oct, 8) & 0xff);
      i += oct.length;
      continue;
    }
    out.push(next.charCodeAt(0) & 0xff);
    i += 1;
  }
  return out;
}

function decodeBytesLatin1(bytes) {
  return bytes.map((value) => String.fromCharCode(value)).join("");
}

function decodeBytesWithMap(bytes, mapDef) {
  if (!mapDef || mapDef.map.size === 0 || mapDef.codeByteLengths.length === 0) {
    return decodeBytesLatin1(bytes);
  }

  let index = 0;
  let out = "";
  while (index < bytes.length) {
    let matched = false;
    for (const codeLen of mapDef.codeByteLengths) {
      if (index + codeLen > bytes.length) {
        continue;
      }
      const key = toUpperHex(bytes.slice(index, index + codeLen));
      const mapped = mapDef.map.get(key);
      if (!mapped) {
        continue;
      }
      out += mapped;
      index += codeLen;
      matched = true;
      break;
    }
    if (!matched) {
      out += String.fromCharCode(bytes[index]);
      index += 1;
    }
  }
  return out;
}

function textReadabilityScore(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return -100;
  }
  const letters = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const digits = (normalized.match(/\d/g) ?? []).length;
  const spaces = (normalized.match(/\s/g) ?? []).length;
  const weird = (normalized.match(/[^A-Za-z0-9\s.,\-/#:$()]/g) ?? []).length;
  return letters * 2 + digits + spaces - weird * 3;
}

function decodeTokenBestEffort(token, unicodeMaps) {
  let bytes = [];
  if (token.startsWith("(") && token.endsWith(")")) {
    bytes = decodePdfStringToBytes(token.slice(1, -1));
  } else if (token.startsWith("<") && token.endsWith(">")) {
    bytes = decodeHexTokenToBytes(token);
  } else {
    return "";
  }

  const candidates = [decodeBytesLatin1(bytes)];
  for (const mapDef of unicodeMaps) {
    candidates.push(decodeBytesWithMap(bytes, mapDef));
  }

  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = textReadabilityScore(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function parseBfcharBlock(block, map, codeLengths) {
  const pairPattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
  for (const match of block.matchAll(pairPattern)) {
    const source = match[1].toUpperCase();
    const target = decodeUtf16BeHex(match[2].toUpperCase());
    if (!source || !target) {
      continue;
    }
    map.set(source, target);
    codeLengths.add(source.length / 2);
  }
}

function parseBfrangeBlock(block, map, codeLengths) {
  const linePattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]+\]|<[0-9A-Fa-f]+>)/g;
  for (const match of block.matchAll(linePattern)) {
    const startHex = match[1].toUpperCase();
    const endHex = match[2].toUpperCase();
    const targetDef = match[3];
    const start = Number.parseInt(startHex, 16);
    const end = Number.parseInt(endHex, 16);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      continue;
    }

    const codeLen = startHex.length / 2;
    codeLengths.add(codeLen);
    if (targetDef.startsWith("[")) {
      const values = [...targetDef.matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => item[1].toUpperCase());
      for (let offset = 0; offset <= end - start; offset += 1) {
        const source = (start + offset).toString(16).padStart(codeLen * 2, "0").toUpperCase();
        const valueHex = values[offset];
        if (!valueHex) {
          continue;
        }
        const target = decodeUtf16BeHex(valueHex);
        if (target) {
          map.set(source, target);
        }
      }
      continue;
    }

    const baseHex = targetDef.slice(1, -1).toUpperCase();
    const baseValue = Number.parseInt(baseHex, 16);
    if (!Number.isFinite(baseValue)) {
      continue;
    }
    for (let offset = 0; offset <= end - start; offset += 1) {
      const source = (start + offset).toString(16).padStart(codeLen * 2, "0").toUpperCase();
      const codePoint = baseValue + offset;
      const target = String.fromCodePoint(codePoint);
      map.set(source, target);
    }
  }
}

function extractUnicodeMapsFromStreamText(text) {
  const cmapBlocks = text.match(/begincmap[\s\S]*?endcmap/g) ?? [];
  const maps = [];

  for (const block of cmapBlocks) {
    const mapping = new Map();
    const codeLengths = new Set();
    const bfcharBlocks = block.match(/beginbfchar[\s\S]*?endbfchar/g) ?? [];
    for (const bfcharBlock of bfcharBlocks) {
      parseBfcharBlock(bfcharBlock, mapping, codeLengths);
    }
    const bfrangeBlocks = block.match(/beginbfrange[\s\S]*?endbfrange/g) ?? [];
    for (const bfrangeBlock of bfrangeBlocks) {
      parseBfrangeBlock(bfrangeBlock, mapping, codeLengths);
    }

    if (mapping.size > 0) {
      maps.push({
        map: mapping,
        codeByteLengths: [...codeLengths.values()].sort((a, b) => b - a),
      });
    }
  }

  return maps;
}

function pushPrintableLines(container, text, maxLines = 5000) {
  const cleaned = text.replace(NON_PRINTABLE, " ");
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 4 || !/[A-Za-z]/.test(line)) {
      continue;
    }
    if (PDF_OBJECT_NOISE_PATTERN.test(line)) {
      continue;
    }
    if (TEXT_OPERATOR_WRAPPER_PATTERN.test(line)) {
      continue;
    }
    const drawCommands = line.match(PDF_DRAW_COMMAND_PATTERN) ?? [];
    if (drawCommands.length >= 3) {
      continue;
    }
    container.add(line);
    if (container.size >= maxLines) {
      return;
    }
  }
}

function isLikelyTextOperatorValue(value) {
  if (value.length < 4) {
    return false;
  }
  const alphabeticCount = (value.match(/[A-Za-z]/g) ?? []).length;
  if (alphabeticCount < 2) {
    return false;
  }
  if (PDF_OBJECT_NOISE_PATTERN.test(value)) {
    return false;
  }
  return true;
}

function extractTextOperators(text, container, unicodeMaps, maxLines = 5000) {
  const tjMatches = text.match(/((?:\((?:\\.|[^\\()])*\))|(?:<[0-9A-Fa-f\s]+>))\s*Tj/g) ?? [];
  for (const match of tjMatches) {
    const tokenMatch = match.match(/^((?:\((?:\\.|[^\\()])*\))|(?:<[0-9A-Fa-f\s]+>))\s*Tj$/);
    if (!tokenMatch) {
      continue;
    }
    const value = decodeTokenBestEffort(tokenMatch[1], unicodeMaps).replace(/\s+/g, " ").trim();
    if (isLikelyTextOperatorValue(value)) {
      container.add(value);
      if (container.size >= maxLines) {
        return;
      }
    }
  }

  const tjArrayMatches = text.match(/\[(.*?)\]\s*TJ/gs) ?? [];
  for (const arrayMatch of tjArrayMatches) {
    const tokens = arrayMatch.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g) ?? [];
    if (tokens.length === 0) {
      continue;
    }
    const value = tokens
      .map((item) => decodeTokenBestEffort(item, unicodeMaps))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (isLikelyTextOperatorValue(value)) {
      container.add(value);
      if (container.size >= maxLines) {
        return;
      }
    }
  }
}

function *iterStreams(pdfBuffer) {
  const streamTag = Buffer.from("stream");
  const endTag = Buffer.from("endstream");
  let cursor = 0;

  while (cursor < pdfBuffer.length) {
    const streamPos = pdfBuffer.indexOf(streamTag, cursor);
    if (streamPos === -1) {
      return;
    }

    let dataStart = streamPos + streamTag.length;
    if (pdfBuffer[dataStart] === 0x0d && pdfBuffer[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (pdfBuffer[dataStart] === 0x0a) {
      dataStart += 1;
    }

    const endPos = pdfBuffer.indexOf(endTag, dataStart);
    if (endPos === -1) {
      return;
    }

    const headerStart = Math.max(0, streamPos - 320);
    const header = pdfBuffer.slice(headerStart, streamPos).toString("latin1");
    const isFlate = header.includes("/FlateDecode");
    yield {
      isFlate,
      bytes: pdfBuffer.slice(dataStart, endPos),
    };

    cursor = endPos + endTag.length;
  }
}

function tryInflate(data) {
  try {
    return zlib.inflateSync(data);
  } catch {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }
}

export function extractTextCandidatesFromPdfBuffer(pdfBuffer, maxLines = 5000) {
  const out = new Set();
  const streamTexts = [];
  const unicodeMaps = [];

  for (const stream of iterStreams(pdfBuffer)) {
    const streamBuffer = stream.isFlate ? tryInflate(stream.bytes) : stream.bytes;
    if (!streamBuffer || streamBuffer.length === 0) {
      continue;
    }
    const streamText = streamBuffer.toString("latin1");
    streamTexts.push(streamText);
    const maps = extractUnicodeMapsFromStreamText(streamText);
    for (const mapDef of maps) {
      unicodeMaps.push(mapDef);
    }
  }

  for (const streamText of streamTexts) {
    if (out.size >= maxLines) {
      break;
    }
    extractTextOperators(streamText, out, unicodeMaps, maxLines);
  }

  if (out.size < Math.min(200, maxLines)) {
    for (const streamText of streamTexts) {
      if (out.size >= maxLines) {
        break;
      }
      pushPrintableLines(out, streamText, maxLines);
    }
  }

  return [...out];
}
