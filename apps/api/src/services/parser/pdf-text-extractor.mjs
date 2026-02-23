import zlib from "node:zlib";

const NON_PRINTABLE = /[^\x09\x0a\x0d\x20-\x7e]/g;

function decodePdfString(input) {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }

    const next = input[i + 1];
    if (!next) {
      break;
    }
    if (next === "n") {
      out += "\n";
      i += 1;
      continue;
    }
    if (next === "r") {
      out += "\r";
      i += 1;
      continue;
    }
    if (next === "t") {
      out += "\t";
      i += 1;
      continue;
    }
    if (next === "b") {
      out += "\b";
      i += 1;
      continue;
    }
    if (next === "f") {
      out += "\f";
      i += 1;
      continue;
    }
    if (next === "(" || next === ")" || next === "\\") {
      out += next;
      i += 1;
      continue;
    }
    if (/[0-7]/.test(next)) {
      let oct = next;
      if (/[0-7]/.test(input[i + 2] ?? "")) oct += input[i + 2];
      if (/[0-7]/.test(input[i + 3] ?? "")) oct += input[i + 3];
      out += String.fromCharCode(Number.parseInt(oct, 8));
      i += oct.length;
      continue;
    }
    out += next;
    i += 1;
  }
  return out;
}

function pushPrintableLines(container, text, maxLines = 5000) {
  const cleaned = text.replace(NON_PRINTABLE, " ");
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 4 || !/[A-Za-z]/.test(line)) {
      continue;
    }
    container.add(line);
    if (container.size >= maxLines) {
      return;
    }
  }
}

function extractTextOperators(text, container, maxLines = 5000) {
  const tjMatches = text.match(/\((?:\\.|[^\\()])*\)\s*Tj/g) ?? [];
  for (const match of tjMatches) {
    const start = match.indexOf("(");
    const end = match.lastIndexOf(")");
    if (start === -1 || end === -1 || end <= start) {
      continue;
    }
    const value = decodePdfString(match.slice(start + 1, end)).replace(/\s+/g, " ").trim();
    if (value.length >= 4) {
      container.add(value);
      if (container.size >= maxLines) {
        return;
      }
    }
  }

  const tjArrayMatches = text.match(/\[(.*?)\]\s*TJ/gs) ?? [];
  for (const arrayMatch of tjArrayMatches) {
    const strings = arrayMatch.match(/\((?:\\.|[^\\()])*\)/g) ?? [];
    if (strings.length === 0) {
      continue;
    }
    const value = strings
      .map((item) => decodePdfString(item.slice(1, -1)))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (value.length >= 4) {
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
  pushPrintableLines(out, pdfBuffer.toString("latin1"), maxLines);

  for (const stream of iterStreams(pdfBuffer)) {
    if (out.size >= maxLines) {
      break;
    }
    const streamBuffer = stream.isFlate ? tryInflate(stream.bytes) : stream.bytes;
    if (!streamBuffer || streamBuffer.length === 0) {
      continue;
    }
    const streamText = streamBuffer.toString("latin1");
    extractTextOperators(streamText, out, maxLines);
    if (out.size < maxLines) {
      pushPrintableLines(out, streamText, maxLines);
    }
  }

  return [...out];
}
