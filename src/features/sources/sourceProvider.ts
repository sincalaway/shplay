import type { FieldMapping, MediaEntry, ProviderSource, SourceHttpMethod } from "../../shared/types";

export interface SourceRequestHeader {
  name: string;
  value: string;
}

export interface SourceRequest {
  url: string;
  method: SourceHttpMethod;
  headers: SourceRequestHeader[];
  body?: string;
}

export type SourceTransport = (request: SourceRequest) => Promise<unknown>;

export interface SourceSearchResult {
  key: string;
  sourceId: string;
  title: string;
  url: string;
  category?: string;
  referer?: string;
  origin?: string;
  itemId?: string;
}

export interface SourceProvider {
  readonly hasDetails: boolean;
  search(query: string): Promise<SourceSearchResult[]>;
  detail(result: SourceSearchResult): Promise<SourceSearchResult>;
}

export function toMediaEntry(result: SourceSearchResult, id: string, timestamp = Date.now()): MediaEntry {
  return {
    id,
    title: result.title,
    url: result.url,
    referer: result.referer,
    origin: result.origin,
    addedAt: timestamp,
    lastPlayedAt: timestamp,
  };
}

const MAX_BODY_BYTES = 64 * 1024;
const SAFE_HEADER_NAMES = new Set(["accept", "accept-language"]);
const SECRET_HEADER_NAME = /(?:authorization|cookie|token|secret|api[-_]?key|password|credential)/i;

export class SourceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceProviderError";
  }
}

function resolveFieldPath(value: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;

  const tokens: Array<string | number> = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    if (trimmed[cursor] === ".") {
      cursor += 1;
      if (cursor >= trimmed.length) return undefined;
    }
    if (trimmed[cursor] === "[") {
      const end = trimmed.indexOf("]", cursor + 1);
      if (end < 0) return undefined;
      const index = trimmed.slice(cursor + 1, end);
      if (!/^\d+$/.test(index)) return undefined;
      tokens.push(Number(index));
      cursor = end + 1;
      continue;
    }
    const start = cursor;
    while (cursor < trimmed.length && trimmed[cursor] !== "." && trimmed[cursor] !== "[") cursor += 1;
    const key = trimmed.slice(start, cursor);
    if (!key || key === "__proto__" || key === "prototype" || key === "constructor") return undefined;
    tokens.push(key);
  }
  if (tokens.length === 0) return undefined;

  return tokens.reduce<unknown>((current, token) => {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    return (current as Record<string | number, unknown>)[token];
  }, value);
}

function resolveEndpoint(baseUrl: string, endpoint: string): URL {
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    throw new SourceProviderError("接口路径必须是相对路径，不能更改基础地址的主机。");
  }

  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("invalid base");
    const path = trimmed.replace(/^\/+/, "");
    target = new URL(path, `${base.toString().replace(/\/+$/, "")}/`);
  } catch {
    throw new SourceProviderError("基础地址或接口路径无效；只支持 HTTP/HTTPS。");
  }
  if (target.origin !== base.origin || !/^https?:$/.test(target.protocol) || target.username || target.password) {
    throw new SourceProviderError("接口路径必须与基础地址使用同一主机，且不能包含登录凭据。");
  }
  return target;
}

function makeRequest(source: ProviderSource, endpoint: string, method: SourceHttpMethod, query: string, isSearch: boolean): SourceRequest {
  const url = resolveEndpoint(source.baseUrl, endpoint);
  for (const { key, value } of source.queryParams) {
    if (key.trim()) url.searchParams.set(key.trim(), value);
  }
  if (isSearch && query.trim()) {
    const searchParameter = source.searchParameter?.trim() ?? "q";
    if (searchParameter) url.searchParams.set(searchParameter, query.trim());
  }

  const headers: SourceRequestHeader[] = [];
  const seenHeaders = new Set<string>();
  for (const { key, value } of source.headers) {
    const name = key.trim().toLowerCase();
    if (!name) continue;
    if (SECRET_HEADER_NAME.test(name)) {
      throw new SourceProviderError("请求头不支持密码、Cookie、令牌或 API Key 等凭据。");
    }
    if (!SAFE_HEADER_NAMES.has(name)) {
      throw new SourceProviderError(`不支持请求头“${key.trim()}”。目前仅支持 Accept 和 Accept-Language。`);
    }
    if (seenHeaders.has(name)) {
      throw new SourceProviderError(`请求头“${key.trim()}”重复；每种支持的请求头最多添加一行。`);
    }
    seenHeaders.add(name);
    headers.push({ name, value });
  }

  let body: string | undefined;
  if (method === "POST" && source.body.trim()) {
    if (new TextEncoder().encode(source.body).byteLength > MAX_BODY_BYTES) {
      throw new SourceProviderError("JSON 请求体不能超过 64 KiB。");
    }
    try {
      JSON.parse(source.body);
    } catch {
      throw new SourceProviderError("POST 请求体不是有效的 JSON。");
    }
    body = source.body;
  }
  return { url: url.toString(), method, headers, body };
}

function safeMediaUrl(value: unknown, baseUrl: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim(), baseUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeHeaderUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function mapItem(source: ProviderSource, item: unknown, key: string): SourceSearchResult | undefined {
  const mapping: FieldMapping = source.mapping;
  const titleValue = resolveFieldPath(item, mapping.titlePath);
  const url = safeMediaUrl(resolveFieldPath(item, mapping.mediaUrlPath), source.baseUrl);
  const title = typeof titleValue === "string" || typeof titleValue === "number" ? String(titleValue).trim() : "";
  if (!title || !url) return undefined;

  const categoryValue = mapping.categoryPath ? resolveFieldPath(item, mapping.categoryPath) : undefined;
  const idValue = mapping.idPath ? resolveFieldPath(item, mapping.idPath) : undefined;
  const refererValue = mapping.refererPath ? resolveFieldPath(item, mapping.refererPath) : undefined;
  const originValue = mapping.originPath ? resolveFieldPath(item, mapping.originPath) : undefined;
  return {
    key,
    sourceId: source.id,
    title,
    url,
    ...(typeof categoryValue === "string" && categoryValue ? { category: categoryValue } : {}),
    ...(safeHeaderUrl(refererValue) ? { referer: safeHeaderUrl(refererValue) } : {}),
    ...(safeHeaderUrl(originValue) ? { origin: safeHeaderUrl(originValue) } : {}),
    ...(typeof idValue === "string" || typeof idValue === "number" ? { itemId: String(idValue) } : {}),
  };
}

function requireArrayAtPath(response: unknown, path: string): unknown[] {
  const items = resolveFieldPath(response, path);
  if (!Array.isArray(items)) {
    throw new SourceProviderError(`响应字段“${path || "（空）"}”不是数组，请检查列表路径映射。`);
  }
  return items;
}

function itemKey(source: ProviderSource, itemId: string | undefined, mediaUrl: string, index: number): string {
  return `${source.id}:${itemId ?? mediaUrl}:${index}`;
}

export function createSourceProvider(source: ProviderSource, transport: SourceTransport): SourceProvider {
  const hasDetails = Boolean(source.detailEndpoint?.trim());
  return {
    hasDetails,
    async search(query: string): Promise<SourceSearchResult[]> {
      const request = makeRequest(source, source.endpoint, source.method, query, true);
      const response = await transport(request);
      return requireArrayAtPath(response, source.mapping.itemsPath)
        .map((item, index) => {
          const result = mapItem(source, item, `${source.id}:${index}`);
          if (!result) return undefined;
          result.key = itemKey(source, result.itemId, result.url, index);
          return result;
        })
        .filter((item): item is SourceSearchResult => Boolean(item));
    },
    async detail(result: SourceSearchResult): Promise<SourceSearchResult> {
      if (!hasDetails) return result;
      if (!source.mapping.idPath?.trim() || !result.itemId) {
        throw new SourceProviderError("此项目没有映射到详情 ID；请设置“详情 ID 字段”。");
      }
      const endpoint = source.detailEndpoint!.replaceAll("{id}", encodeURIComponent(result.itemId));
      const request = makeRequest(source, endpoint, "GET", "", false);
      const response = await transport(request);
      const detailItem = source.mapping.detailItemPath?.trim()
        ? resolveFieldPath(response, source.mapping.detailItemPath)
        : response;
      if (detailItem === undefined) {
        throw new SourceProviderError(`响应字段“${source.mapping.detailItemPath}”未找到，请检查详情对象路径。`);
      }
      const mapped = mapItem(source, detailItem, result.key);
      if (!mapped) {
        throw new SourceProviderError("详情响应未映射出有效的名称和 HTTP/HTTPS 媒体地址。");
      }
      return { ...result, ...mapped, key: result.key };
    },
  };
}

export function buildSourceRequest(source: ProviderSource, operation: "search" | "detail", query = "", itemId = ""): SourceRequest {
  if (operation === "search") return makeRequest(source, source.endpoint, source.method, query, true);
  if (!source.detailEndpoint?.trim()) throw new SourceProviderError("尚未配置详情接口。");
  if (!source.mapping.idPath?.trim() || !itemId) throw new SourceProviderError("详情接口需要详情 ID 字段和项目 ID。");
  return makeRequest(source, source.detailEndpoint.replaceAll("{id}", encodeURIComponent(itemId)), "GET", "", false);
}
