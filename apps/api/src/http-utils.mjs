import { stat } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

export function parseRequestUrl(req) {
  return new URL(req.url ?? "/", "http://localhost");
}

export async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }
  const payload = Buffer.concat(chunks).toString("utf8").trim();
  if (!payload) {
    return {};
  }
  return JSON.parse(payload);
}

export function json(res, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function text(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function noContent(res) {
  res.writeHead(204);
  res.end();
}

export function methodNotAllowed(res) {
  json(res, 405, { error: "Method not allowed" });
}

export function badRequest(res, message) {
  json(res, 400, { error: message });
}

export function notFound(res) {
  json(res, 404, { error: "Not found" });
}

export function serverError(res, error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  json(res, 500, { error: message });
}

export function getTenantId(req, url) {
  const header = req.headers["x-tenant-id"];
  const query = url.searchParams.get("tenantId");
  return (Array.isArray(header) ? header[0] : header) ?? query ?? null;
}

export async function fileExists(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
}

export function safeStaticPath(webRoot, requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const withoutQuery = normalized.split("?")[0];
  const target = path.resolve(webRoot, `.${withoutQuery}`);
  if (!target.startsWith(path.resolve(webRoot))) {
    return null;
  }
  return target;
}
