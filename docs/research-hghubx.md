# HGhubX 架构研究：shplay 的 Tauri 2 媒体应用参考

## 先看结论

HGhubX 值得借鉴的不是“把网页放进原生窗口”这么简单，而是把内容/UI、播放状态、HTTP/DNS/代理策略、HLS 子资源传输和各系统 WebView 差异拆成边界清晰的层。shplay 采用了更小的通用播放器切面：React 负责媒体库和播放界面，Rust 负责可审计的本地代理、请求头与地址策略，Tauri 提供原生壳和存储插件。

研究对象为 [HGhubX 仓库](https://github.com/zxsos/HGhubX)，检出快照 `5f60e371a63798ff17bef18e87cc2e6453d5a24d`，项目版本 `2.2.0`。以下判断结合仓库自己的 [架构索引](https://github.com/zxsos/HGhubX/blob/5f60e371a63798ff17bef18e87cc2e6453d5a24d/docs/architecture.md)、[播放子系统说明](https://github.com/zxsos/HGhubX/blob/5f60e371a63798ff17bef18e87cc2e6453d5a24d/docs/subsystems/playback.md)、[网络/媒体代理说明](https://github.com/zxsos/HGhubX/blob/5f60e371a63798ff17bef18e87cc2e6453d5a24d/docs/subsystems/network-proxy-media.md)、[平台壳说明](https://github.com/zxsos/HGhubX/blob/5f60e371a63798ff17bef18e87cc2e6453d5a24d/docs/subsystems/platform-shells.md) 与 [构建说明](https://github.com/zxsos/HGhubX/blob/5f60e371a63798ff17bef18e87cc2e6453d5a24d/docs/subsystems/build-release.md)。源文件清单和 manifest 也做了只读检查。

## HGhubX 的模块边界

| 层 | 仓库位置 | 主要职责 |
| --- | --- | --- |
| React 应用装配与页面 | `src/app/`、`src/features/` | Feed/详情/搜索/账号/设置等业务；播放页面只消费已准备好的媒体地址 |
| 共享前端服务 | `src/shared/api/`、`model/`、`storage/`、`network/` | Tauri IPC、共享状态、localStorage 迁移、偏好、线路选择与诊断 |
| Rust 业务/网络 | `src-tauri/src/api/`、`net/`、`network_policy.rs` | 命令入口、上游 API 信封、代理与系统代理、DNS 固定、跳转策略和诊断 |
| Rust 媒体协议 | `src-tauri/src/media/` | HLS 清单 URI 重写、分片/密钥/封面请求、Range 响应与内存缓存 |
| 平台壳 | `ios_media_http.rs`、`linux_http.rs`、`linux_webview.rs`、平台 `cfg` 模块 | 适配 WKWebView、GStreamer/WebKitGTK、WebView2、Android 自定义协议等差异 |
| 构建与发布 | `package.json`、`src-tauri/tauri.conf.json`、`.github/workflows/` | pnpm/Vite、Tauri CLI、各目标的原生 runner、签名与包类型 |

仓库自己的说明特别强调目录归组不等于状态机已拆分，也强调平台差异需在 Rust `cfg`/平台配置中隔离；这对 shplay 是重要约束：播放策略可共享，实际媒体能力仍必须由平台运行验证。

## 播放与网络链路

HGhubX 的播放链路可概括为：

```text
React 播放组件
  → hls.js 或系统原生媒体
  → 平台本地媒体地址（自定义协议或 loopback HTTP）
  → Rust media handler
  → URL/解析地址安全校验、代理/DNS/跳转策略
  → HLS 清单重写、Range/分片/密钥响应
  → 上游媒体服务
```

这种本地传输层解决两个问题：浏览器媒体请求不能方便地设置站点要求的 Referer/Origin；HLS 播放列表还会继续请求相对路径的分片/密钥。只把顶层 `.m3u8` 转给 WebView 并不能自动代理这些子请求。HGhubX 还为 iOS AVFoundation、Linux GStreamer 等不同 WebView/解码器提供不同 loopback 通道，而不是假设所有系统都能播放 `hg://` 或使用同一 HLS.js 路径。

网络安全也不是“接上 reqwest 就好”：该仓库明确要求每次跳转都重新检验目标、避免 DNS 检查与连接解析之间的竞态、拒绝内网/回环地址、限制重定向与媒体入口，并避免媒体代理变成开放通用转发。shplay 的 Rust 侧保留了这类安全边界，但仅实现通用媒体 GET/HEAD；尚未实现 HGhubX 的上游 API、代理设置界面、缓存、帐号/线路逻辑、原生 AVFoundation/GStreamer 适配或其完整播放恢复状态机。

## 存储与打包

HGhubX 同时使用 WebView `localStorage`（应用/账号数据）和 Rust 应用数据目录（会话、线路、代理、安全设置等），并把旧键迁移写成明确的“先写新值、确认后再删旧值”过程。shplay 暂时只存媒体库：Tauri 运行时用 [Tauri Store 插件](https://v2.tauri.app/plugin/store/) 写入应用数据；浏览器预览使用 `localStorage` fallback，不存账号/token，也没有跨版本迁移需求。

其构建入口是 `pnpm build` 与 Tauri CLI，Tauri 配置指向 Vite dev server 与 `dist`；桌面用 `tauri build`，Android/iOS 使用单独的 Tauri mobile CLI 命令和本机工具链。仓库通过独立 CI jobs 验证 Linux/Windows/macOS/Android/iOS，签名密钥只交由安全的发布 runner 管理。shplay 的具体命令及工具要求写在 [构建与打包指南](build.md)。

官方 Tauri 当前文档也沿用 Vite 的 `beforeDevCommand`、`devUrl`、`beforeBuildCommand`、`frontendDist` 设置；权限通过按窗口授权的 capability 管理，而非只靠前端代码约束。参见 [Vite 集成](https://v2.tauri.app/start/frontend/vite/)、[capabilities](https://v2.tauri.app/security/capabilities/) 与 [多平台分发概览](https://v2.tauri.app/distribute/)。

## shplay 的复用与有意不做

- 复用的是分层思想与工程边界：React feature/shared、Rust media core、loopback 媒体入口、Tauri app data store、单独的平台构建命令。
- shplay 新写 `crates/media-core`，独立测试 URL scheme、公开 IP、HLS URI 改写；Rust handler 绑定随机端口并仅提供有 capability 的 `/media/{token}/{id}` GET/HEAD 路由。
- UI 的 URL、Referer、Origin 由用户明确填写；播放列表中的相对 URI 会在 Rust 侧改写到该应用的本地代理，Range/If-Range 被限制转发。
- 不复制 HGhubX 的媒体直链、站点 API、破解/解密逻辑、帐户或用户内容，也不提供 DRM 绕过、批量下载、抓取或访问限制规避功能。

## 许可证说明

HGhubX 的 [LICENSE](https://github.com/zxsos/HGhubX/blob/5f60e371a63798ff17bef18e87cc2e6453d5a24d/LICENSE) 写明 PolyForm Noncommercial 1.0.0，并包含 `Required Notice: Copyright (c) 2026 HGhubX contributors (https://github.com/zxsos/HGhubX)`。本研究只引用公开架构信息，shplay 实现为独立编写；没有把上游源码/许可证复制进项目。若后续决定直接改写其代码，需要重新评估衍生作品、非商业限制和 Required Notice 的适用范围；商业发布前应先取得适当许可并做法律审查。

## Tauri 官方参考

- [Vite 前端设置](https://v2.tauri.app/start/frontend/vite/)
- [构建前置依赖（桌面与移动）](https://v2.tauri.app/start/prerequisites/)
- [CLI reference（Android APK/AAB 与 iOS build 参数）](https://v2.tauri.app/reference/cli/)
- [App Store 发行与签名要求](https://v2.tauri.app/distribute/app-store/)
- [capabilities 与窗口权限](https://v2.tauri.app/security/capabilities/)
- [Store 插件](https://v2.tauri.app/plugin/store/)
- [构建和分发](https://v2.tauri.app/distribute/)
