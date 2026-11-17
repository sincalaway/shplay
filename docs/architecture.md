# shplay 架构

## 运行时链路

```text
React/TypeScript
  ├─ 播放台、媒体库和来源参数表单
  ├─ Hls.js（支持 MSE 的 WebView）/ 系统原生媒体（Safari/WKWebView 等）
  ├─ Tauri Store：本地媒体清单
  └─ invoke(prepare_media)
        ↓
Rust/Tauri 2
  ├─ 127.0.0.1:随机端口 + 随机 capability
  ├─ HTTP(S) URL 检查 + DNS 解析固定 + 公网 IP 策略
  ├─ Referer / Origin 请求头、有限跳转、Range 转发
  └─ HLS 相对清单 / URI 属性改写到本地媒体路由
        ↓
用户提供的媒体来源
```

## 目录职责

| 目录 | 职责 | 不应承担 |
| --- | --- | --- |
| `src/app/` | 应用页面、导航和产品 UI | 网络请求细节、Rust 地址策略 |
| `src/features/player/` | HLS.js/native `<video>` 生命周期和播放器错误显示 | 上游站点业务/API |
| `src/shared/` | Tauri IPC、Store/localStorage adapter、前端类型 | 任意 HTTP 代理 |
| `src-tauri/src/proxy.rs` | 随机回环服务、请求头、跳转、Range、HLS 媒体传输 | 任意 URL/path 转发、内容下载 |
| `src-tauri/crates/media-core/` | 无 Tauri 的纯 Rust URL/IP/HLS 规则与单测 | 运行时服务或系统 WebView |
| `src-tauri/capabilities/` | 前端可用的 Tauri plugin permissions | 网络来源白名单替代品 |

## 代理安全契约

- 代理绑定 `127.0.0.1:0`，使用不可预测的端口和随机 token；不绑定 `0.0.0.0`。
- 路由仅 `/media/{token}/{id}`；媒体通过 GET/HEAD 获取，HLS 子资源在 Rust 内登记为新 id。
- URL scheme 只接受 HTTP/HTTPS，禁止 userinfo；每次外连时 DNS 解析并把公网地址固定到 reqwest client，拒绝私网/回环/链路本地/特殊地址及常见本地域名。
- 禁止自动重定向；每跳重新校验目标，最多 5 次且不允许 HTTPS 降级。
- 只转发 `Range`、`If-Range`、`Accept`、`Accept-Language`、固定 User-Agent 和用户指定的 Referer/Origin；不转发 Cookie、Authorization 或页面传入任意 headers。
- HLS playlist 读取上限 2 MiB；改写 URI 行和 `URI=` 属性，阻止 WebView 对 HLS 子资源直接跨域访问。
- CORS 只允许 Tauri 本地应用源（debug 下也包括 Vite dev origin）；不记录完整源 URL。
- capability 不是用户登录；同机恶意代码/调试器仍可能观察应用进程，不能把 loopback 代理当作高强度认证。

## 当前限制

播放器接受公开可访问的媒体 URL；没有媒体供应商 API、cookie/token 管理、帐号登录、DRM 解密、下载器、缓存/离线播放或 EPG/内容目录。代理使用系统 WebView 可解码格式；桌面、Android、iOS 的 HLS 和 codec 支持不同，需在每个目标设备实测。Tauri 的功能分层不代表同一安装包可以从一个操作系统交叉编译到所有平台。
