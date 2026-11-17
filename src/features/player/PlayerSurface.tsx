import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Film, LoaderCircle, Radio, ShieldCheck } from "lucide-react";
import { prepareMedia } from "../../shared/tauri";
import type { MediaEntry, PlayerStatus } from "../../shared/types";

interface PlayerSurfaceProps {
  entry: MediaEntry | null;
  onStatus: (status: PlayerStatus, message?: string) => void;
}

function isHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().includes(".m3u8");
  }
}

export default function PlayerSurface({ entry, onStatus }: PlayerSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | undefined;
    let disposed = false;
    setMessage("");

    if (!entry) {
      setLoading(false);
      video.removeAttribute("src");
      video.load();
      onStatus("idle");
      return;
    }

    onStatus("loading");
    setLoading(true);
    void (async () => {
      try {
        const source = await prepareMedia(entry.url, entry.referer, entry.origin);
        if (disposed) return;

        const useHls = isHls(entry.url);
        const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
        if (useHls && nativeHls) {
          video.src = source;
        } else if (useHls && Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              const errorMessage = "播放列表或媒体分片无法读取。请检查链接、Referer 设置或来源站点状态。";
              setMessage(errorMessage);
              setLoading(false);
              onStatus("error", errorMessage);
            }
          });
          hls.loadSource(source);
          hls.attachMedia(video);
        } else {
          video.src = source;
        }
      } catch {
        if (!disposed) {
          const errorMessage = "无法准备媒体来源。请确认这是可访问的 HTTP/HTTPS 媒体链接。";
          setMessage(errorMessage);
          setLoading(false);
          onStatus("error", errorMessage);
        }
      }
    })();

    return () => {
      disposed = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [entry, onStatus]);

  return (
    <div className="player-surface">
      <video
        ref={videoRef}
        className="player-video"
        controls
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        onLoadedMetadata={() => { setLoading(false); onStatus("ready"); }}
        onError={() => {
          const errorMessage = "媒体无法播放。格式、编码或来源链接可能不受支持。";
          setMessage(errorMessage);
          setLoading(false);
          onStatus("error", errorMessage);
        }}
      />
      {!entry && (
        <div className="player-empty">
          <div className="empty-orbit"><Film size={26} strokeWidth={1.6} /></div>
          <strong>你的下一部影片，从链接开始</strong>
          <span>添加 MP4、WebM 或 HLS 播放列表链接</span>
          <div className="empty-trust"><ShieldCheck size={14} /> 来源地址仅保存在本机</div>
        </div>
      )}
      {entry && message && (
        <div className="player-message" role="status">
          <Radio size={16} />
          <span>{message}</span>
        </div>
      )}
      {entry && loading && !message && (
        <div className="player-loading" aria-hidden="true">
          <LoaderCircle size={15} /> 正在连接媒体源
        </div>
      )}
      <div className="player-corner-badge"><span className="live-dot" /> LOCAL PROXY</div>
    </div>
  );
}
