import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  ChevronRight,
  Film,
  FolderOpen,
  Globe2,
  Headphones,
  History,
  Layers3,
  Link2,
  LockKeyhole,
  MonitorPlay,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Video,
  X,
} from "lucide-react";
import PlayerSurface from "../features/player/PlayerSurface";
import { readLibrary, writeLibrary } from "../shared/storage";
import { isTauri } from "@tauri-apps/api/core";
import type { MediaEntry, PlayerStatus } from "../shared/types";

type View = "watch" | "library" | "settings";

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value || "本地媒体库";
  }
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function App() {
  const [library, setLibrary] = useState<MediaEntry[]>([]);
  const [current, setCurrent] = useState<MediaEntry | null>(null);
  const [view, setView] = useState<View>("watch");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [referer, setReferer] = useState("");
  const [origin, setOrigin] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [searchText, setSearchText] = useState("");
  const [saving, setSaving] = useState(false);
  const native = useMemo(() => isTauri(), []);
  const handlePlayerStatus = useCallback((next: PlayerStatus, message?: string) => {
    setStatus(next);
    setStatusMessage(message || "");
  }, []);

  useEffect(() => {
    void readLibrary().then(setLibrary);
  }, []);

  const persist = useCallback(async (next: MediaEntry[]) => {
    setLibrary(next);
    try {
      await writeLibrary(next);
      setNotice("");
    } catch {
      setNotice("保存失败：请检查应用本地存储空间。");
    }
  }, []);

  const playEntry = useCallback(async (entry: MediaEntry) => {
    const touched = { ...entry, lastPlayedAt: Date.now() };
    setCurrent(touched);
    setView("watch");
    setStatus("loading");
    await persist([touched, ...library.filter((item) => item.id !== entry.id)]);
  }, [library, persist]);

  async function addMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const trimmedUrl = url.trim();
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
    } catch {
      setNotice("请输入完整的 HTTP 或 HTTPS 媒体链接。");
      return;
    }

    const now = Date.now();
    const entry: MediaEntry = {
      id: makeId(),
      title: title.trim() || hostLabel(trimmedUrl),
      url: trimmedUrl,
      referer: referer.trim() || undefined,
      origin: origin.trim() || undefined,
      addedAt: now,
      lastPlayedAt: now,
    };
    const next = [entry, ...library.filter((item) => item.url !== entry.url)];
    setSaving(true);
    await persist(next);
    setCurrent(entry);
    setView("watch");
    setStatus("loading");
    setUrl("");
    setTitle("");
    setSaving(false);
  }

  async function removeEntry(id: string) {
    const next = library.filter((item) => item.id !== id);
    await persist(next);
    if (current?.id === id) {
      setCurrent(null);
      setStatus("idle");
    }
  }

  const filtered = library.filter((item) => {
    const query = searchText.trim().toLowerCase();
    return !query || `${item.title} ${hostLabel(item.url)}`.toLowerCase().includes(query);
  });

  const navItems: { id: View; label: string; icon: typeof MonitorPlay }[] = [
    { id: "watch", label: "播放台", icon: MonitorPlay },
    { id: "library", label: "媒体库", icon: FolderOpen },
    { id: "settings", label: "设置", icon: Settings2 },
  ];

  const pageTitle = view === "watch" ? "播放台" : view === "library" ? "媒体库" : "设置";
  const statusLabel = status === "ready" ? "正在播放" : status === "loading" ? "连接中" : status === "error" ? "需要检查来源" : "等待媒体来源";
  const statusClass = `status-pill status-${status}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => setView("watch")} aria-label="shplay 播放台">
          <span className="brand-mark"><span /></span>
          <span className="brand-name">shplay<span className="brand-period">.</span></span>
        </button>

        <div className="sidebar-section-label">工作区</div>
        <nav className="primary-nav" aria-label="主导航">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}>
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "library" && library.length > 0 && <span className="nav-count">{library.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label recent-label"><span>最近播放</span><History size={13} /></div>
        <div className="recent-list">
          {library.slice(0, 4).map((item) => (
            <button key={item.id} className={`recent-item ${current?.id === item.id ? "selected" : ""}`} onClick={() => void playEntry(item)} title={item.title}>
              <span className="recent-thumb"><Video size={15} /></span>
              <span className="recent-copy"><strong>{item.title}</strong><small>{hostLabel(item.url)}</small></span>
            </button>
          ))}
          {library.length === 0 && <p className="recent-empty">添加一个媒体链接<br />即可在这里快速访问</p>}
        </div>

        <div className="sidebar-spacer" />
        <div className="sidebar-local-card">
          <div className="local-icon"><LockKeyhole size={15} /></div>
          <div><strong>本机优先</strong><span>链接保存在你的设备</span></div>
          <Check className="local-check" size={14} />
        </div>
        <div className="sidebar-footer"><span className="footer-dot" />{native ? "TAURI 2 · NATIVE" : "WEB PREVIEW"}<span className="footer-version">v0.1.0</span></div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>SHPLAY</span><ChevronRight size={13} /><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <span className={statusClass}><span className="status-dot" />{statusLabel}</span>
            <button className="icon-button search-shortcut" onClick={() => setView("library")} aria-label="打开媒体库"><Search size={17} /></button>
            <span className="avatar-mark">S</span>
          </div>
        </header>

        <div className="page-content">
          {view === "watch" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow"><span className="eyebrow-line" />PERSONAL MEDIA SPACE</div><h1>播放台<span className="heading-dot">.</span></h1><p>把你有权访问的媒体链接，交给 shplay。</p></div>
                <div className="heading-chip"><Layers3 size={14} /> 跨端播放体验</div>
              </section>

              <section className="watch-layout">
                <div className="watch-main-column">
                  <PlayerSurface entry={current} onStatus={handlePlayerStatus} />
                  <div className="now-playing-row">
                    <div className="now-playing-art"><Film size={19} /></div>
                    <div className="now-playing-copy">
                      <div className="now-playing-label">NOW PLAYING</div>
                      <strong>{current?.title || "尚未选择媒体"}</strong>
                      <span>{current ? hostLabel(current.url) : "添加链接后开始播放"}</span>
                    </div>
                    {current && <button className="subtle-action" onClick={() => void removeEntry(current.id)} title="从媒体库移除"><Trash2 size={16} /></button>}
                  </div>
                  {statusMessage && <div className="inline-warning"><AlertCircle size={15} />{statusMessage}</div>}
                </div>

                <aside className="source-panel">
                  <div className="panel-header"><div><div className="eyebrow">QUICK SOURCE</div><h2>添加媒体</h2></div><div className="panel-plus"><Plus size={16} /></div></div>
                  <p className="panel-intro">粘贴直接播放链接，保存到本机媒体库。</p>
                  <form className="source-form" onSubmit={(event) => void addMedia(event)}>
                    <label className="field-label" htmlFor="media-url">媒体 URL <span>必填</span></label>
                    <div className="input-wrap url-input-wrap"><Link2 size={15} /><input id="media-url" type="url" placeholder="https://example.com/video.m3u8" value={url} onChange={(event) => setUrl(event.target.value)} required autoComplete="url" /></div>
                    <label className="field-label" htmlFor="media-title">名称 <span>可选</span></label>
                    <input id="media-title" className="text-input" type="text" placeholder="例如：周末纪录片" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />

                    <button type="button" className={`advanced-toggle ${showAdvanced ? "open" : ""}`} onClick={() => setShowAdvanced((value) => !value)}>
                      <ShieldCheck size={15} /><span>来源请求头</span><span className="toggle-note">Referer / Origin</span><ChevronRight size={14} />
                    </button>
                    {showAdvanced && (
                      <div className="advanced-fields">
                        <label className="field-label" htmlFor="media-referer">Referer <span>可选</span></label>
                        <input id="media-referer" className="text-input" type="url" placeholder="https://来源站点/页面" value={referer} onChange={(event) => setReferer(event.target.value)} />
                        <label className="field-label" htmlFor="media-origin">Origin <span>可选</span></label>
                        <input id="media-origin" className="text-input" type="url" placeholder="留空时从 Referer 自动推导" value={origin} onChange={(event) => setOrigin(event.target.value)} />
                        <p className="field-hint">只为来源站点要求的请求头提供兼容；不绕过 DRM、登录或访问权限。</p>
                      </div>
                    )}
                    {notice && <div className="form-notice"><AlertCircle size={14} />{notice}</div>}
                    <button className="primary-button" type="submit" disabled={saving}>
                      <BookmarkPlus size={16} />{saving ? "保存中…" : "保存并播放"}<ArrowUpRight className="button-arrow" size={15} />
                    </button>
                  </form>
                  <div className="proxy-note"><div className="proxy-note-icon"><Radio size={14} /></div><div><strong>本地媒体代理已就绪</strong><span>仅监听回环地址 · 支持 Range 与 HLS 清单</span></div><span className="ready-pill">READY</span></div>
                </aside>
              </section>

              <section className="library-preview">
                <div className="section-heading"><div><div className="eyebrow">YOUR COLLECTION</div><h2>最近添加</h2></div><button className="text-action" onClick={() => setView("library")}>查看媒体库 <ArrowUpRight size={14} /></button></div>
                {library.length === 0 ? (
                  <div className="empty-library"><span className="empty-library-icon"><FolderOpen size={18} /></span><span><strong>媒体库还是空的</strong><small>使用右侧表单添加一个 HLS 或视频文件链接。</small></span><button onClick={() => document.getElementById("media-url")?.focus()}>添加链接 <Plus size={14} /></button></div>
                ) : (
                  <div className="recent-cards">{library.slice(0, 3).map((item, index) => <MediaCard key={item.id} entry={item} index={index} active={item.id === current?.id} onPlay={() => void playEntry(item)} onRemove={() => void removeEntry(item.id)} />)}</div>
                )}
              </section>
            </>
          )}

          {view === "library" && (
            <>
              <section className="page-heading library-heading">
                <div><div className="eyebrow"><span className="eyebrow-line" />YOUR COLLECTION</div><h1>媒体库<span className="heading-dot">.</span></h1><p>你的播放列表仅存放在本机应用数据中。</p></div>
                <button className="primary-button compact-button" onClick={() => setView("watch")}><Plus size={16} /> 添加媒体</button>
              </section>
              <div className="library-toolbar"><div className="input-wrap library-search"><Search size={16} /><input placeholder="按名称或站点搜索" value={searchText} onChange={(event) => setSearchText(event.target.value)} /></div><span>{filtered.length} 个项目</span></div>
              {filtered.length === 0 ? <div className="empty-library large-empty"><span className="empty-library-icon"><FolderOpen size={20} /></span><span><strong>{library.length ? "没有匹配结果" : "媒体库还是空的"}</strong><small>{library.length ? "试试其他名称或网站。" : "添加一个可访问的媒体链接，即可在多端继续播放。"}</small></span></div> : <div className="library-grid">{filtered.map((item, index) => <MediaCard key={item.id} entry={item} index={index} active={item.id === current?.id} onPlay={() => void playEntry(item)} onRemove={() => void removeEntry(item.id)} />)}</div>}
            </>
          )}

          {view === "settings" && (
            <>
              <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />PREFERENCES & SECURITY</div><h1>设置<span className="heading-dot">.</span></h1><p>了解 shplay 的存储、网络和平台边界。</p></div></section>
              <section className="settings-grid">
                <div className="settings-card"><div className="settings-icon blue"><LockKeyhole size={18} /></div><div className="eyebrow">LOCAL STORAGE</div><h2>媒体库在本机保存</h2><p>{native ? "通过 Tauri Store 插件写入应用数据目录；媒体 URL 与 Referer 不会上传到 shplay 服务。" : "浏览器预览使用 localStorage；桌面/移动应用会改用 Tauri Store 插件。"}</p><div className="settings-foot"><Check size={14} /> {library.length} 个已保存项目</div></div>
                <div className="settings-card"><div className="settings-icon violet"><Globe2 size={18} /></div><div className="eyebrow">NETWORK POLICY</div><h2>受限的本地代理</h2><p>代理只绑定 127.0.0.1，校验公网目标、限制跳转并固定 DNS 结果；转发单段 Range 请求以支持拖动进度。</p><div className="settings-foot"><ShieldCheck size={14} /> 不提供任意内网地址访问</div></div>
                <div className="settings-card"><div className="settings-icon green"><Headphones size={18} /></div><div className="eyebrow">PLAYBACK</div><h2>HLS 与常见视频格式</h2><p>支持 HLS.js 与系统 WebView 原生媒体能力。实际可播放的编码取决于各平台系统解码器。</p><div className="settings-foot"><MonitorPlay size={14} /> {native ? "Tauri 2 原生壳" : "浏览器预览模式"}</div></div>
                <div className="settings-card"><div className="settings-icon amber"><ShieldCheck size={18} /></div><div className="eyebrow">RESPONSIBLE USE</div><h2>只播放你有权访问的媒体</h2><p>Referer / Origin 只用于合法来源兼容。shplay 不处理 DRM，不绕过账号、付费墙、验证码或平台访问限制。</p><div className="settings-foot"><Check size={14} /> 用户自行提供媒体来源</div></div>
              </section>
              <div className="platform-note"><Layers3 size={17} /><span><strong>一个 React + TypeScript 前端，多平台 Tauri 壳。</strong> 桌面、Android 与 iOS 需在对应原生工具链上分别构建和实机验证。</span></div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function MediaCard({ entry, index, active, onPlay, onRemove }: { entry: MediaEntry; index: number; active: boolean; onPlay: () => void; onRemove: () => void }) {
  const palettes = ["tone-blue", "tone-purple", "tone-coral", "tone-green"];
  return (
    <article className={`media-card ${active ? "media-card-active" : ""}`}>
      <button className={`media-art ${palettes[index % palettes.length]}`} onClick={onPlay} aria-label={`播放 ${entry.title}`}>
        <span className="art-grid" /><span className="art-film"><Film size={25} strokeWidth={1.4} /></span><span className="art-play"><Video size={16} fill="currentColor" /></span>
        <span className="art-format">{entry.url.toLowerCase().includes(".m3u8") ? "HLS" : "MEDIA"}</span>
      </button>
      <div className="media-card-copy"><div><strong>{entry.title}</strong><span>{hostLabel(entry.url)}</span></div><button className="card-remove" onClick={onRemove} title="从媒体库移除"><X size={14} /></button></div>
      <button className="media-card-open" onClick={onPlay}>{active ? "正在播放" : "立即播放"}<ChevronRight size={14} /></button>
    </article>
  );
}

export default App;
