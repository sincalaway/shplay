import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Globe2,
  Plus,
  Play,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { FieldMapping, ProviderSource, SourceParameter } from "../../shared/types";
import type { MediaEntry } from "../../shared/types";
import { createSourceProvider, toMediaEntry, type SourceSearchResult } from "./sourceProvider";
import { requestSourceJson } from "./sourceTransport";

interface SourcesPageProps {
  sources: ProviderSource[];
  onSave: (source: ProviderSource) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPlay: (entry: MediaEntry) => Promise<void>;
}

interface PreviewRow {
  title: string;
  mediaUrl: string;
  category: string;
  validUrl: boolean;
}

const DEFAULT_SAMPLE = JSON.stringify({
  data: {
    items: [
      { id: "demo-1", title: "示例视频", url: "https://media.example/video.m3u8", category: "演示" },
      { id: "demo-2", title: "示例短片", url: "https://media.example/clip.mp4", category: "演示" },
    ],
  },
}, null, 2);

const EMPTY_MAPPING: FieldMapping = {
  itemsPath: "data.items",
  titlePath: "title",
  mediaUrlPath: "url",
  idPath: "",
  detailItemPath: "",
  categoryPath: "category",
  refererPath: "",
  originPath: "",
};

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newSource(): ProviderSource {
  const now = Date.now();
  return {
    id: makeId(),
    name: "",
    baseUrl: "",
    endpoint: "/api/videos",
    method: "GET",
    searchParameter: "q",
    detailEndpoint: "",
    queryParams: [],
    headers: [],
    body: "",
    mapping: { ...EMPTY_MAPPING },
    createdAt: now,
    updatedAt: now,
  };
}

function resolvePath(value: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  const tokens = [...path.matchAll(/(?:^|\.)([^.[\]]+)|\[(\d+)\]/g)].map((match) => match[1] ?? Number(match[2]));
  if (tokens.length === 0) return undefined;
  return tokens.reduce<unknown>((current, token) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string | number, unknown>)[token];
  }, value);
}

function buildRequestUrl(source: ProviderSource): string {
  try {
    const base = new URL(source.baseUrl);
    const path = source.endpoint.trim().replace(/^\/+/, "");
    const url = new URL(path, `${base.toString().replace(/\/+$/, "")}/`);
    source.queryParams.forEach(({ key, value }) => {
      if (key.trim()) url.searchParams.set(key.trim(), value);
    });
    return url.toString();
  } catch {
    return "填写有效的基础地址后显示请求地址";
  }
}

function SourceParameterEditor({
  label,
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string;
  rows: SourceParameter[];
  onChange: (rows: SourceParameter[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  function updateRow(id: string, field: "key" | "value", value: string) {
    onChange(rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }

  return (
    <div className="source-param-editor">
      <div className="source-param-heading"><span>{label}</span><button type="button" className="source-add-row" onClick={() => onChange([...rows, { id: makeId(), key: "", value: "" }])}><Plus size={13} /> 添加一行</button></div>
      {rows.length === 0 ? <p className="source-no-rows">暂未添加参数</p> : rows.map((row) => (
        <div className="source-param-row" key={row.id}>
          <input aria-label={`${label}名称`} value={row.key} onChange={(event) => updateRow(row.id, "key", event.target.value)} placeholder={keyPlaceholder} />
          <input aria-label={`${label}值`} value={row.value} onChange={(event) => updateRow(row.id, "value", event.target.value)} placeholder={valuePlaceholder} />
          <button type="button" className="source-remove-row" aria-label="删除此行" onClick={() => onChange(rows.filter((item) => item.id !== row.id))}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export default function SourcesPage({ sources, onSave, onDelete, onPlay }: SourcesPageProps) {
  const [draft, setDraft] = useState<ProviderSource | null>(null);
  const [step, setStep] = useState(0);
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SourceSearchResult[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<SourceSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState("");
  const [playingKey, setPlayingKey] = useState("");
  const requestSequence = useRef(0);
  const editing = draft ? sources.some((source) => source.id === draft.id) : false;
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;

  const preview = useMemo(() => {
    if (!draft) return { rows: [] as PreviewRow[], error: "" };
    try {
      const response: unknown = JSON.parse(sample);
      const items = resolvePath(response, draft.mapping.itemsPath);
      if (!Array.isArray(items)) return { rows: [] as PreviewRow[], error: `“${draft.mapping.itemsPath || "（空）"}”没有指向数组。` };
      const rows = items.slice(0, 6).map((item: unknown) => {
        const title = resolvePath(item, draft.mapping.titlePath);
        const mediaUrl = resolvePath(item, draft.mapping.mediaUrlPath);
        const category = draft.mapping.categoryPath ? resolvePath(item, draft.mapping.categoryPath) : undefined;
        return {
          title: typeof title === "string" ? title : "（未匹配名称）",
          mediaUrl: typeof mediaUrl === "string" ? mediaUrl : "（未匹配媒体链接）",
          category: typeof category === "string" ? category : "",
          validUrl: typeof mediaUrl === "string" && /^https?:\/\//i.test(mediaUrl),
        };
      });
      return { rows, error: "" };
    } catch (error) {
      return { rows: [] as PreviewRow[], error: error instanceof Error ? `样例 JSON 无法解析：${error.message}` : "样例 JSON 无法解析。" };
    }
  }, [draft, sample]);

  function startNew() {
    setDraft(newSource());
    setStep(0);
    setSample(DEFAULT_SAMPLE);
    setFormError("");
    setNotice("");
  }

  function startEdit(source: ProviderSource) {
    setDraft({ ...source, queryParams: source.queryParams.map((row) => ({ ...row })), headers: source.headers.map((row) => ({ ...row })), mapping: { ...source.mapping } });
    setStep(0);
    setSample(DEFAULT_SAMPLE);
    setFormError("");
    setNotice("");
  }

  function closeWizard() {
    setDraft(null);
    setFormError("");
  }

  function openSearch(source: ProviderSource) {
    requestSequence.current += 1;
    setSearching(false);
    setActiveSourceId(source.id);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedDetail(null);
    setSearchNotice("");
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSource) return;
    const sequence = ++requestSequence.current;
    setSearching(true);
    setSelectedDetail(null);
    setSearchNotice("");
    try {
      const provider = createSourceProvider(activeSource, requestSourceJson);
      const results = await provider.search(searchQuery);
      if (sequence !== requestSequence.current) return;
      setSearchResults(results);
      setSearchNotice(results.length ? `搜索完成：找到 ${results.length} 条结果。` : "搜索已完成，但没有映射到可播放项目。");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setSearchResults([]);
      setSearchNotice(error instanceof Error ? error.message : "接口请求失败，请检查接口地址和配置。");
    } finally {
      if (sequence === requestSequence.current) setSearching(false);
    }
  }

  async function openDetail(result: SourceSearchResult) {
    if (!activeSource) return;
    const sequence = ++requestSequence.current;
    setSearching(true);
    setSelectedDetail(null);
    setSearchNotice("");
    try {
      const provider = createSourceProvider(activeSource, requestSourceJson);
      const detail = await provider.detail(result);
      if (sequence !== requestSequence.current) return;
      setSelectedDetail(detail);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setSearchNotice(error instanceof Error ? error.message : "无法读取详情接口。");
    } finally {
      if (sequence === requestSequence.current) setSearching(false);
    }
  }

  async function playResult(result: SourceSearchResult) {
    const now = Date.now();
    const id = globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(16).slice(2)}`;
    const entry: MediaEntry = toMediaEntry(result, id, now);
    setPlayingKey(result.key);
    try {
      await onPlay(entry);
      setSearchNotice(`已将“${result.title}”送入播放器并保存到媒体库。`);
    } catch {
      setSearchNotice("启动播放失败，请稍后重试。");
    } finally {
      setPlayingKey("");
    }
  }

  function updateDraft(patch: Partial<ProviderSource>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setFormError("");
  }

  function updateMapping(patch: Partial<FieldMapping>) {
    setDraft((current) => current ? { ...current, mapping: { ...current.mapping, ...patch } } : current);
    setFormError("");
  }

  function validateCurrentStep(): boolean {
    if (!draft) return false;
    if (step === 0) {
      if (!draft.name.trim()) { setFormError("请填写来源名称。"); return false; }
      try {
        const parsed = new URL(draft.baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        setFormError("基础地址需要是完整的 HTTP 或 HTTPS URL。");
        return false;
      }
    }
    if (step === 1 && [draft.endpoint, draft.detailEndpoint ?? ""].some((endpoint) => endpoint.trim() && (/^https?:\/\//i.test(endpoint.trim()) || endpoint.trim().startsWith("//") || endpoint.includes("\\")))) {
      setFormError("接口路径请填写相对路径，域名使用上方的基础地址。 ");
      return false;
    }
    if (step === 1 && draft.detailEndpoint?.trim() && !draft.detailEndpoint.includes("{id}")) {
      setFormError("详情路径需要包含 {id}，用于代入搜索结果中的详情 ID。");
      return false;
    }
    if (step === 1 && draft.method === "POST" && draft.body.trim()) {
      try {
        JSON.parse(draft.body);
      } catch {
        setFormError("POST 请求体不是有效的 JSON。");
        return false;
      }
    }
    if (step === 1 && draft.headers.some(({ key }) => key.trim() && !["accept", "accept-language"].includes(key.trim().toLowerCase()))) {
      setFormError("目前只支持 Accept 和 Accept-Language 请求头；请移除凭据或其他自定义请求头。");
      return false;
    }
    const configuredHeaderNames = draft.headers.map(({ key }) => key.trim().toLowerCase()).filter(Boolean);
    if (step === 1 && new Set(configuredHeaderNames).size !== configuredHeaderNames.length) {
      setFormError("Accept 和 Accept-Language 每种请求头最多添加一行。");
      return false;
    }
    if (step === 1 && new TextEncoder().encode(draft.body).byteLength > 64 * 1024) {
      setFormError("JSON 请求体不能超过 64 KiB。");
      return false;
    }
    if (step === 2) {
      if (!draft.mapping.itemsPath.trim() || !draft.mapping.titlePath.trim() || !draft.mapping.mediaUrlPath.trim()) {
        setFormError("列表路径、名称字段和媒体链接字段为必填项。");
        return false;
      }
      if (draft.detailEndpoint?.trim() && !draft.mapping.idPath?.trim()) {
        setFormError("配置了详情接口时，必须填写搜索结果中的详情 ID 字段。");
        return false;
      }
      if (preview.error) { setFormError(preview.error); return false; }
      if (preview.rows.length === 0) { setFormError("样例没有匹配到列表项，请检查列表路径或粘贴接口响应示例。"); return false; }
      if (!preview.rows.some((row) => row.validUrl && row.title !== "（未匹配名称）")) {
        setFormError("样例中至少需要有一条包含名称和 HTTP/HTTPS 媒体链接的项目。");
        return false;
      }
    }
    setFormError("");
    return true;
  }

  function goNext() {
    if (validateCurrentStep()) setStep((current) => Math.min(current + 1, 2));
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateCurrentStep() || !draft) return;
    setSaving(true);
    const now = Date.now();
    try {
      await onSave({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""), endpoint: draft.endpoint.trim() || "/", updatedAt: now });
      setNotice(editing ? "来源配置已更新。" : "来源配置已保存到本机。保存后可搜索接口并把匹配结果送入播放器。");
      setDraft(null);
      setStep(0);
    } catch {
      setFormError("保存失败。请检查本机存储空间后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSource(source: ProviderSource) {
    if (!window.confirm(`删除“${source.name}”的本地接口配置？`)) return;
    try {
      await onDelete(source.id);
      setNotice(`已删除“${source.name}”的本地配置。`);
    } catch {
      setNotice("删除失败：请检查本机存储空间后重试。");
    }
  }

  return (
    <>
      <section className="page-heading sources-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" />LOCAL API CONFIGURATION</div><h1>来源管理<span className="heading-dot">.</span></h1><p>用表单描述你有权访问的 JSON 接口，并把响应字段映射成播放项目。</p></div>
        <button className="primary-button compact-button" onClick={startNew}><Plus size={16} /> 添加来源</button>
      </section>

      <div className="sources-safety-note"><span className="sources-safety-icon"><ShieldCheck size={16} /></span><span><strong>配置仅保存在本机</strong><small>桌面/移动端请求会校验公网目标并限制响应大小；浏览器预览不会请求任意接口。仅支持公开接口，不支持登录、Cookie、令牌或 DRM。</small></span><span className="sources-local-badge">LOCAL ONLY</span></div>
      {notice && <div className="sources-notice" role="status"><Check size={15} />{notice}<button onClick={() => setNotice("")} aria-label="关闭提示"><X size={14} /></button></div>}

      {sources.length === 0 ? (
        <div className="sources-empty"><div className="sources-empty-icon"><Code2 size={23} /></div><strong>还没有配置接口来源</strong><p>添加名称、API 地址、请求参数和字段映射；用一段 JSON 响应样例即时检查映射是否正确。</p><button className="secondary-button" onClick={startNew}><Plus size={15} /> 创建第一个来源</button></div>
      ) : (
        <div className="provider-grid">{sources.map((source) => (
          <article className="provider-card" key={source.id}>
            <div className="provider-card-top"><span className="provider-icon"><Globe2 size={18} /></span><span className="provider-status"><span />可测试</span></div>
            <h2>{source.name}</h2>
            <div className="provider-url" title={source.baseUrl}>{source.baseUrl}</div>
            <div className="provider-endpoint"><span className={`method-badge method-${source.method.toLowerCase()}`}>{source.method}</span><code>{source.endpoint || "/"}</code></div>
            <div className="provider-map-summary"><Braces size={14} /><span>列表 <code>{source.mapping.itemsPath}</code></span><span>·</span><span>媒体 <code>{source.mapping.mediaUrlPath}</code></span></div>
            <div className="provider-card-footer"><span><Clock3 size={12} />{new Date(source.updatedAt).toLocaleDateString()}</span><div><button className="provider-action" onClick={() => openSearch(source)}><Search size={13} /> 搜索</button><button className="provider-action" onClick={() => startEdit(source)}>编辑配置</button><button className="provider-delete" aria-label={`删除 ${source.name}`} onClick={() => void deleteSource(source)}><Trash2 size={14} /></button></div></div>
          </article>
        ))}</div>
      )}

      {activeSource && (
        <section className="source-search-workbench" aria-label={`${activeSource.name} 搜索`}>
          <div className="source-search-heading"><div><div className="eyebrow">SOURCE SEARCH</div><h2>{activeSource.name}<span className="heading-dot">.</span></h2><p>{activeSource.detailEndpoint ? "搜索后可查看详情并播放。" : "搜索结果可直接送入播放器。"} 搜索请求只连接此来源。</p></div><button className="wizard-close" type="button" aria-label="关闭搜索" onClick={() => { setActiveSourceId(null); setSearchResults([]); setSelectedDetail(null); }}><X size={17} /></button></div>
          <form className="source-search-form" onSubmit={(event) => void runSearch(event)}>
            <div className="input-wrap"><Search size={15} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="输入要搜索的内容" aria-label="搜索内容" /></div>
            <button className="primary-button" type="submit" disabled={searching}><Search size={15} />{searching ? "请求中…" : "搜索接口"}</button>
          </form>
          {searchNotice && <div className="sources-notice" role="status"><AlertCircle size={14} />{searchNotice}</div>}
          {searchResults.length > 0 && <div className="source-search-results">{searchResults.map((result) => (
            <article className="source-result-card" key={result.key}>
              <div className="source-result-copy"><strong>{result.title}</strong><code>{result.url}</code>{result.category && <span>{result.category}</span>}</div>
              <div className="source-result-actions">{activeSource.detailEndpoint?.trim() ? <button className="secondary-button" type="button" onClick={() => void openDetail(result)} disabled={searching}>查看详情</button> : <button className="primary-button" type="button" onClick={() => void playResult(result)} disabled={Boolean(playingKey)}><Play size={14} />{playingKey === result.key ? "启动中…" : "播放"}</button>}</div>
            </article>
          ))}</div>}
          {selectedDetail && <div className="source-detail-card"><div><div className="eyebrow">DETAIL</div><h3>{selectedDetail.title}</h3><code>{selectedDetail.url}</code>{selectedDetail.category && <span>{selectedDetail.category}</span>}</div><button className="primary-button" type="button" onClick={() => void playResult(selectedDetail)} disabled={Boolean(playingKey)}><Play size={14} />{playingKey === selectedDetail.key ? "启动中…" : "播放详情"}</button></div>}
        </section>
      )}

      {draft && (
        <div className="source-wizard-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWizard(); }}>
          <section className="source-wizard" role="dialog" aria-modal="true" aria-labelledby="source-wizard-title">
            <header className="source-wizard-header"><div><div className="eyebrow"><span className="eyebrow-line" />SOURCE SETUP</div><h2 id="source-wizard-title">{editing ? "编辑来源配置" : "添加接口来源"}</h2></div><button className="wizard-close" type="button" onClick={closeWizard} aria-label="关闭向导"><X size={18} /></button></header>
            <div className="wizard-steps">{["来源信息", "请求配置", "字段映射"].map((label, index) => <div className={`wizard-step ${step === index ? "current" : ""} ${step > index ? "complete" : ""}`} key={label}><span>{step > index ? <Check size={13} /> : index + 1}</span><small>{label}</small>{index < 2 && <i />}</div>)}</div>
            <form className="wizard-form" onSubmit={(event) => void saveDraft(event)}>
              {step === 0 && (
                <div className="wizard-page">
                  <div className="wizard-intro"><strong>先给来源一个容易辨认的名字</strong><span>填写 API 的基础地址。接口路径会在下一步设置。</span></div>
                  <label className="wizard-field"><span>来源名称 <b>必填</b></span><input autoFocus value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="例如：我的视频 API" maxLength={80} /></label>
                  <label className="wizard-field"><span>基础地址 <b>必填</b></span><div className="wizard-input-icon"><Globe2 size={15} /><input type="url" value={draft.baseUrl} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="https://api.example.com" /></div><small>仅描述接口地址；此版本不会主动连接该地址。</small></label>
                  <div className="wizard-inline-note"><ShieldCheck size={15} /><span>配置保存在本机。不要填写密码、Cookie 或私密访问令牌。</span></div>
                </div>
              )}

              {step === 1 && (
                <div className="wizard-page">
                  <div className="wizard-intro"><strong>描述接口请求</strong><span>配置搜索接口与可选详情接口；搜索词通过查询参数传入。</span></div>
                  <div className="wizard-request-line"><label className="wizard-field"><span>请求方法</span><select value={draft.method} onChange={(event) => updateDraft({ method: event.target.value as ProviderSource["method"] })}><option value="GET">GET</option><option value="POST">POST</option></select></label><label className="wizard-field"><span>接口路径</span><input value={draft.endpoint} onChange={(event) => updateDraft({ endpoint: event.target.value })} placeholder="/api/videos" /></label></div>
                  <div className="request-preview"><span>请求地址预览</span><code>{buildRequestUrl(draft)}</code></div>
                  <label className="wizard-field"><span>搜索词参数名 <small>留空则不传搜索词</small></span><input value={draft.searchParameter ?? "q"} onChange={(event) => updateDraft({ searchParameter: event.target.value })} placeholder="q" /></label>
                  <SourceParameterEditor label="Query 参数" rows={draft.queryParams} onChange={(queryParams) => updateDraft({ queryParams })} keyPlaceholder="参数名" valuePlaceholder="参数值" />
                  <SourceParameterEditor label="请求头（仅 Accept / Accept-Language）" rows={draft.headers} onChange={(headers) => updateDraft({ headers })} keyPlaceholder="Accept-Language" valuePlaceholder="例如：zh-CN" />
                  {draft.method === "POST" && <label className="wizard-field"><span>JSON 请求体 <small>可留空</small></span><textarea className="request-body-input" value={draft.body} onChange={(event) => updateDraft({ body: event.target.value })} placeholder={'{\n  "page": 1\n}'} spellCheck={false} /></label>}
                  <label className="wizard-field"><span>详情接口路径 <small>可选；仅 GET</small></span><input value={draft.detailEndpoint ?? ""} onChange={(event) => updateDraft({ detailEndpoint: event.target.value })} placeholder="/api/videos/{id}" /><small>留空时搜索结果可直接播放；填写时须包含 {`{id}`} 占位符。</small></label>
                  <p className="wizard-footnote"><AlertCircle size={13} />不支持密码、Cookie、令牌或任意自定义请求头；请只连接你有权访问的公开 JSON 接口。</p>
                </div>
              )}

              {step === 2 && (
                <div className="wizard-page mapping-page">
                  <div className="wizard-intro"><strong>把 JSON 字段对应到播放项目</strong><span>使用点号分隔对象层级，例如 <code>data.items</code>；数组索引可写成 <code>items[0]</code>。</span></div>
                  <div className="mapping-fields">
                    <label className="wizard-field"><span>列表路径 <b>必填</b></span><input value={draft.mapping.itemsPath} onChange={(event) => updateMapping({ itemsPath: event.target.value })} placeholder="data.items" /></label>
                    <label className="wizard-field"><span>媒体名称字段 <b>必填</b></span><input value={draft.mapping.titlePath} onChange={(event) => updateMapping({ titlePath: event.target.value })} placeholder="title" /></label>
                    <label className="wizard-field"><span>媒体 URL 字段 <b>必填</b></span><input value={draft.mapping.mediaUrlPath} onChange={(event) => updateMapping({ mediaUrlPath: event.target.value })} placeholder="url" /></label>
                    {draft.detailEndpoint?.trim() && <label className="wizard-field"><span>详情 ID 字段 <b>必填</b></span><input value={draft.mapping.idPath ?? ""} onChange={(event) => updateMapping({ idPath: event.target.value })} placeholder="id" /></label>}
                    {draft.detailEndpoint?.trim() && <label className="wizard-field"><span>详情对象路径 <small>可选；空白表示响应根对象</small></span><input value={draft.mapping.detailItemPath ?? ""} onChange={(event) => updateMapping({ detailItemPath: event.target.value })} placeholder="data.item" /></label>}
                    <label className="wizard-field"><span>分类字段 <small>可选</small></span><input value={draft.mapping.categoryPath} onChange={(event) => updateMapping({ categoryPath: event.target.value })} placeholder="category" /></label>
                    <label className="wizard-field"><span>Referer 字段 <small>可选</small></span><input value={draft.mapping.refererPath} onChange={(event) => updateMapping({ refererPath: event.target.value })} placeholder="referer" /></label>
                    <label className="wizard-field"><span>Origin 字段 <small>可选</small></span><input value={draft.mapping.originPath} onChange={(event) => updateMapping({ originPath: event.target.value })} placeholder="origin" /></label>
                  </div>
                  <label className="wizard-field sample-json-field"><span>响应 JSON 样例 <small>仅在本机解析，不会上传</small></span><textarea value={sample} onChange={(event) => setSample(event.target.value)} spellCheck={false} /></label>
                  <div className="mapping-preview"><div className="mapping-preview-head"><span><Braces size={14} /> 映射预览</span><small>{preview.rows.length} 条（最多显示 6 条）</small></div>
                    {preview.error ? <p className="mapping-preview-error"><AlertCircle size={14} />{preview.error}</p> : preview.rows.length === 0 ? <p className="mapping-preview-empty">输入 JSON 样例后，这里会显示映射结果。</p> : <div className="mapping-preview-list">{preview.rows.map((row, index) => <div className="mapping-preview-row" key={`${String(row.mediaUrl)}-${index}`}><span className={`mapping-preview-check ${row.validUrl ? "valid" : "invalid"}`}>{row.validUrl ? <Check size={12} /> : <AlertCircle size={12} />}</span><span className="mapping-preview-copy"><strong>{String(row.title)}</strong><code>{String(row.mediaUrl)}</code></span>{row.category && <small>{String(row.category)}</small>}</div>)}</div>}
                  </div>
                </div>
              )}
              {formError && <div className="wizard-error" role="alert"><AlertCircle size={14} />{formError}</div>}
              <footer className="wizard-footer"><div>{step > 0 && <button className="wizard-back" type="button" onClick={() => { setFormError(""); setStep((current) => current - 1); }}><ArrowLeft size={14} /> 上一步</button>}</div>{step < 2 ? <button className="primary-button wizard-next" type="button" onClick={goNext}>继续 <ChevronRight size={15} /></button> : <button className="primary-button wizard-next" type="submit" disabled={saving}><Save size={15} />{saving ? "保存中…" : "保存配置"}<ArrowRight size={14} /></button>}</footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
