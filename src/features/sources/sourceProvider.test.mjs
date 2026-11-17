import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceText = await readFile(new URL("./sourceProvider.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(sourceText, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const providerModule = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const { buildSourceRequest, createSourceProvider, toMediaEntry, SourceProviderError } = providerModule;

function makeSource(overrides = {}) {
  return {
    id: "local-source",
    name: "Public JSON API",
    baseUrl: "https://api.example.test/v1",
    endpoint: "/search",
    method: "POST",
    searchParameter: "query",
    detailEndpoint: "/items/{id}",
    queryParams: [{ id: "lang", key: "lang", value: "zh-CN" }],
    headers: [{ id: "accept", key: "Accept-Language", value: "zh-CN" }],
    body: '{"limit":10}',
    mapping: {
      itemsPath: "data.items",
      titlePath: "title",
      mediaUrlPath: "media.url",
      idPath: "id",
      detailItemPath: "data.item",
      categoryPath: "category",
      refererPath: "referer",
      originPath: "origin",
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("builds a same-origin POST search request and encodes query parameters", () => {
  const request = buildSourceRequest(makeSource(), "search", "snow & stars");
  const url = new URL(request.url);
  assert.equal(url.origin, "https://api.example.test");
  assert.equal(url.pathname, "/v1/search");
  assert.equal(url.searchParams.get("lang"), "zh-CN");
  assert.equal(url.searchParams.get("query"), "snow & stars");
  assert.equal(request.method, "POST");
  assert.equal(request.body, '{"limit":10}');
  assert.deepEqual(request.headers, [{ name: "accept-language", value: "zh-CN" }]);
});

test("search maps only valid HTTP(S) media results and preserves optional metadata", async () => {
  const requests = [];
  const provider = createSourceProvider(makeSource({ method: "GET", body: "" }), async (request) => {
    requests.push(request);
    return {
      data: {
        items: [
          { id: "one", title: "First", media: { url: "https://cdn.example.test/first.m3u8" }, category: "Drama", referer: "https://watch.example.test/page", origin: "https://watch.example.test" },
          { id: "bad", title: "Unsafe", media: { url: "javascript:alert(1)" } },
          { id: "missing", media: { url: "https://cdn.example.test/missing.mp4" } },
        ],
      },
    };
  });
  const results = await provider.search("hello world");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "First");
  assert.equal(results[0].url, "https://cdn.example.test/first.m3u8");
  assert.equal(results[0].itemId, "one");
  assert.equal(results[0].category, "Drama");
  assert.equal(results[0].referer, "https://watch.example.test/page");
  assert.equal(results[0].origin, "https://watch.example.test/");
  assert.equal(new URL(requests[0].url).searchParams.get("query"), "hello world");
});

test("fetches a detail record with an encoded ID and maps a nested media URL", async () => {
  const requests = [];
  const provider = createSourceProvider(makeSource({ method: "GET", body: "" }), async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      return { data: { items: [{ id: "a/b ?", title: "Search title", media: { url: "https://cdn.example.test/preview.mp4" } }] } };
    }
    return { data: { item: { id: "a/b ?", title: "Detailed title", media: { url: "https://cdn.example.test/full.m3u8" }, category: "Documentary" } } };
  });
  const [searchResult] = await provider.search("film");
  const detail = await provider.detail(searchResult);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "GET");
  const detailUrl = new URL(requests[1].url);
  assert.equal(detailUrl.pathname, "/v1/items/a%2Fb%20%3F");
  assert.equal(detailUrl.searchParams.get("lang"), "zh-CN");
  assert.equal(detail.title, "Detailed title");
  assert.equal(detail.url, "https://cdn.example.test/full.m3u8");
  assert.equal(detail.category, "Documentary");
});

test("converts a mapped provider result into the existing player/library entry shape", () => {
  const entry = toMediaEntry({
    key: "source:item",
    sourceId: "source",
    title: "Mapped title",
    url: "https://cdn.example.test/live.m3u8",
    referer: "https://source.example.test/page",
    origin: "https://source.example.test/",
  }, "media-id", 1234);
  assert.deepEqual(entry, {
    id: "media-id",
    title: "Mapped title",
    url: "https://cdn.example.test/live.m3u8",
    referer: "https://source.example.test/page",
    origin: "https://source.example.test/",
    addedAt: 1234,
    lastPlayedAt: 1234,
  });
});

test("rejects cross-origin, absolute, protocol-relative, and backslash endpoints", () => {
  for (const endpoint of ["https://elsewhere.example/api", "//elsewhere.example/api", "..\\admin"]) {
    assert.throws(() => buildSourceRequest(makeSource({ endpoint }), "search", "x"), SourceProviderError);
  }
});

test("rejects credentials and unsupported request headers and invalid JSON bodies", () => {
  assert.throws(() => buildSourceRequest(makeSource({ headers: [{ id: "auth", key: "Authorization", value: "Bearer x" }] }), "search", "x"), /凭据/);
  assert.throws(() => buildSourceRequest(makeSource({ headers: [{ id: "custom", key: "X-Trace", value: "x" }] }), "search", "x"), /不支持请求头/);
  assert.throws(() => buildSourceRequest(makeSource({ headers: [{ id: "one", key: "Accept", value: "application/json" }, { id: "two", key: "accept", value: "text/plain" }] }), "search", "x"), /重复/);
  assert.throws(() => buildSourceRequest(makeSource({ body: "{broken" }), "search", "x"), /有效的 JSON/);
  assert.throws(() => buildSourceRequest(makeSource({ body: "x".repeat(65 * 1024) }), "search", "x"), /64 KiB/);
});

test("rejects unsafe object paths and non-array search results", async () => {
  const unsafe = createSourceProvider(makeSource({ mapping: { ...makeSource().mapping, itemsPath: "__proto__.polluted" } }), async () => ({}));
  await assert.rejects(unsafe.search("x"), /不是数组/);
  const wrongShape = createSourceProvider(makeSource(), async () => ({ data: { items: { title: "not an array" } } }));
  await assert.rejects(wrongShape.search("x"), /不是数组/);
});
