export interface MediaEntry {
  id: string;
  title: string;
  url: string;
  referer?: string;
  origin?: string;
  addedAt: number;
  lastPlayedAt: number;
}

export type PlayerStatus = "idle" | "loading" | "ready" | "error";
