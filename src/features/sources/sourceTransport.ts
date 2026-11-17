import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SourceRequest, SourceTransport } from "./sourceProvider";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("接口没有返回有效的 JSON。");
  }
}

export const requestSourceJson: SourceTransport = async (request: SourceRequest) => {
  if (!isTauri()) {
    throw new Error("来源 API 搜索仅在 shplay 桌面/移动应用中启用；浏览器预览不会向任意接口发起网络请求。");
  }
  const text = await invoke<string>("fetch_provider_json", {
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body ?? null,
  });
  return parseJson(text);
};
