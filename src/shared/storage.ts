import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { MediaEntry, ProviderSource } from "./types";

const STORE_FILE = "library.json";
const STORE_KEY = "media-library-v1";
const SOURCE_STORE_KEY = "provider-sources-v1";
const BROWSER_KEY = "shplay.library.v1";
const BROWSER_SOURCE_KEY = "shplay.sources.v1";

let nativeStore: LazyStore | undefined;

function getNativeStore(): LazyStore {
  nativeStore ??= new LazyStore(STORE_FILE, { autoSave: false });
  return nativeStore;
}

function isMediaEntry(value: unknown): value is MediaEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MediaEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.title === "string" &&
    typeof entry.url === "string" &&
    typeof entry.addedAt === "number" &&
    typeof entry.lastPlayedAt === "number"
  );
}

export async function readLibrary(): Promise<MediaEntry[]> {
  try {
    if (isTauri()) {
      const stored = await getNativeStore().get<unknown>(STORE_KEY);
      return Array.isArray(stored) ? stored.filter(isMediaEntry) : [];
    }
    const raw = window.localStorage.getItem(BROWSER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isMediaEntry) : [];
  } catch {
    return [];
  }
}

export async function writeLibrary(entries: MediaEntry[]): Promise<void> {
  const safeEntries = entries.filter(isMediaEntry);
  if (isTauri()) {
    const store = getNativeStore();
    await store.set(STORE_KEY, safeEntries);
    await store.save();
    return;
  }
  window.localStorage.setItem(BROWSER_KEY, JSON.stringify(safeEntries));
}

function isProviderSource(value: unknown): value is ProviderSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<ProviderSource>;
  const mapping = source.mapping;
  return (
    typeof source.id === "string" &&
    typeof source.name === "string" &&
    typeof source.baseUrl === "string" &&
    typeof source.endpoint === "string" &&
    (source.method === "GET" || source.method === "POST") &&
    (source.searchParameter === undefined || typeof source.searchParameter === "string") &&
    (source.detailEndpoint === undefined || typeof source.detailEndpoint === "string") &&
    Array.isArray(source.queryParams) &&
    Array.isArray(source.headers) &&
    typeof source.body === "string" &&
    typeof source.createdAt === "number" &&
    typeof source.updatedAt === "number" &&
    !!mapping &&
    typeof mapping.itemsPath === "string" &&
    typeof mapping.titlePath === "string" &&
    typeof mapping.mediaUrlPath === "string" &&
    (mapping.idPath === undefined || typeof mapping.idPath === "string") &&
    (mapping.detailItemPath === undefined || typeof mapping.detailItemPath === "string") &&
    typeof mapping.categoryPath === "string" &&
    typeof mapping.refererPath === "string" &&
    typeof mapping.originPath === "string"
  );
}

export async function readSources(): Promise<ProviderSource[]> {
  try {
    if (isTauri()) {
      const stored = await getNativeStore().get<unknown>(SOURCE_STORE_KEY);
      return Array.isArray(stored) ? stored.filter(isProviderSource) : [];
    }
    const raw = window.localStorage.getItem(BROWSER_SOURCE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isProviderSource) : [];
  } catch {
    return [];
  }
}

export async function writeSources(sources: ProviderSource[]): Promise<void> {
  const safeSources = sources.filter(isProviderSource);
  if (isTauri()) {
    const store = getNativeStore();
    await store.set(SOURCE_STORE_KEY, safeSources);
    await store.save();
    return;
  }
  window.localStorage.setItem(BROWSER_SOURCE_KEY, JSON.stringify(safeSources));
}
