# shplay 架构

## 运行时链路

```text
React/TypeScript
  ├─ 播放台、媒体库、来源配置、搜索与详情映射
  ├─ SourceProvider：注入式 JSON 传输、搜索/详情字段映射
  ├─ Hls.js（支持 MSE 的 WebView）/ 系统原生媒体（Safari/WKWebView 等）
  ├─ Tauri Store：本地媒体清单与来源配置
  ├─ invoke(fetch_provider_json)：原生 JSON API 请求
  └─ invoke(prepare_media)
        ↓
Rust/Tauri 2
  ├─ fetch_provider_json：受限 GET/POST、响应大小与超时限制
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
| `src/features/sources/` | 通用 JSON SourceProvider、来源配置、搜索与详情映射 | 特定供应商端点、账号或凭据 |
| `src/features/player/` | HLS.js/native `<video>` 生命周期和播放器错误显示 | 上游站点业务/API |
| `src/shared/` | Tauri IPC、Store/localStorage adapter、前端类型 | 任意 HTTP 代理 |
| `src-tauri/src/proxy.rs` | 受限 JSON API 请求、随机回环服务、Range、HLS 媒体传输 | 任意请求头/凭据、任意内网 URL、内容下载 |
| `src-tauri/crates/media-core/` | 无 Tauri 的纯 Rust URL/IP/HLS 规则与单测 | 运行时服务或系统 WebView |
| `src-tauri/capabilities/` | 前端可用的 Tauri plugin permissions | 网络来源白名单替代品 |

## 代理安全契约

- 代理绑定 `127.0.0.1:0`，使用不可预测的端口和随机 token；不绑定 `0.0.0.0`。
- 路由仅 `/media/{token}/{id}`；媒体通过 GET/HEAD 获取，HLS 子资源在 Rust 内登记为新 id。
- URL scheme 只接受 HTTP/HTTPS，禁止 userinfo；每次外连时 DNS 解析并把公网地址固定到 reqwest client，拒绝私网/回环/链路本地/特殊地址及常见本地域名。
- 禁止自动重定向；每跳重新校验目标，最多 5 次且不允许 HTTPS 降级。
- 只转发 `Range`、`If-Range`、`Accept`、`Accept-Language`、固定 User-Agent 和用户指定的 Referer/Origin；不转发 Cookie、Authorization 或页面传入任意 headers。
- HLS playlist 读取上限 2 MiB；改写 URI 行和 `URI=` 属性，阻止 WebView 对 HLS 子资源直接跨域访问。
- `fetch_provider_json` 与媒体代理分离；只允许 GET/POST 与 `Accept`、`Accept-Language` 两类用户头。POST body 上限 64 KiB，JSON 响应上限 2 MiB，请求超时 15 秒。
- Provider API 同样通过公网 IP 校验与 DNS 固定；最多 5 次跳转，HTTPS 不能降级。POST 只跟随保留方法/正文的 307/308 跳转。
- 来源配置仅本机保存；不提供 Cookie、Authorization、令牌或登录。API 端点必须是公开、可访问的 HTTP(S) JSON 服务。
- CORS 只允许 Tauri 本地应用源（debug 下也包括 Vite dev origin）；不记录完整源 URL。
- 网页预览不开放任意来源 API 网络访问；在非 Tauri 预览中点击搜索会收到明确提示，不会尝试直连外部服务。
- capability 不是用户登录；同机恶意代码/调试器仍可能观察应用进程，不能把 loopback 代理当作高强度认证。

## 当前限制

来源适配器支持用户配置的通用 GET/POST JSON 搜索接口、字段映射及可选 GET 详情路径；不含任何特定供应商端点或内容目录。它不能访问需要登录、Cookie、Authorization/API Key、令牌或 DRM 的接口；浏览器预览不支持 API 搜索。播放器使用系统 WebView 可解码格式；桌面、Android、iOS 的 HLS 和 codec 支持不同，需在每个目标设备实测。Tauri 的功能分层不代表同一安装包可以从一个操作系统交叉编译到所有平台。
