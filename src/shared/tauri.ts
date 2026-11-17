import { invoke, isTauri } from "@tauri-apps/api/core";

export async function prepareMedia(
  url: string,
  referer?: string,
  origin?: string,
): Promise<string> {
  if (!isTauri()) return url;
  return invoke<string>("prepare_media", {
    url,
    referer: referer?.trim() || null,
    origin: origin?.trim() || null,
  });
}
