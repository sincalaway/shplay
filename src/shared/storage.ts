import { isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { MediaEntry } from "./types";

const STORE_FILE = "library.json";
const STORE_KEY = "media-library-v1";
const BROWSER_KEY = "shplay.library.v1";

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
