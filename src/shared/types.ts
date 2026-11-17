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
export type SourceHttpMethod = "GET" | "POST";

export interface SourceParameter {
  id: string;
  key: string;
  value: string;
}

export interface FieldMapping {
  itemsPath: string;
  titlePath: string;
  mediaUrlPath: string;
  idPath?: string;
  detailItemPath?: string;
  categoryPath: string;
  refererPath: string;
  originPath: string;
}

/** A local, declarative description of a user-owned JSON API source. */
export interface ProviderSource {
  id: string;
  name: string;
  baseUrl: string;
  endpoint: string;
  method: SourceHttpMethod;
  searchParameter?: string;
  detailEndpoint?: string;
  queryParams: SourceParameter[];
  headers: SourceParameter[];
  body: string;
  mapping: FieldMapping;
  createdAt: number;
  updatedAt: number;
}
