# shplay

React + TypeScript 播放界面，配合 Rust + Tauri 2 原生壳的跨平台媒体播放器实验项目。当前版本支持用户输入 MP4/WebM/HLS URL、可选配置 Referer/Origin、HLS.js/系统原生媒体播放，以及本机媒体库持久化。

## 快速开始

```bash
pnpm install
pnpm dev                 # 浏览器预览（媒体直连，可能受来源 CORS 限制）
pnpm build               # TypeScript 检查 + Vite 生产构建
pnpm desktop:dev         # Tauri 桌面开发
pnpm desktop:build       # 当前操作系统的桌面安装包
```

Android 需要 Android Studio、Android SDK/NDK、JDK 与 Rust Android targets：

```bash
pnpm android:init
pnpm android:dev
pnpm android:build
```

iOS 构建需要 macOS、完整 Xcode 与 CocoaPods：

```bash
pnpm ios:init
pnpm ios:dev
pnpm ios:build
```

细节、Linux 系统依赖和发行目标见 [构建与打包指南](docs/build.md)。Tauri 构建要求与操作系统匹配；这不是可以在一台 Linux 机器上直接交叉产出所有平台签名安装包的工程。

## 架构

- `src/app`、`src/features`、`src/shared`：React 应用壳、播放器功能和共享 IPC/存储。
- `src-tauri/src`：Tauri 应用入口与回环媒体代理。
- `src-tauri/crates/media-core`：独立纯 Rust URL/IP/HLS 规则，可不依赖 GTK/WebKit 单独测试。
- `docs`：HGhubX 源仓库研究记录、shplay 运行时边界和平台构建说明。

`pnpm build` 校验 UI；`cargo test --manifest-path src-tauri/crates/media-core/Cargo.toml` 运行不需要原生系统库的 Rust 安全策略测试。完整 Tauri 编译还需安装相应平台的系统依赖。

## 网络与隐私边界

原生应用的代理只绑定 `127.0.0.1` 随机端口，URL 带随机 capability；它仅开放媒体 GET/HEAD，不接受任意方法/路径。代理校验 HTTP(S) 目标，解析并固定公网 DNS 地址，拒绝回环/内网/链路本地地址，逐跳检查最多 5 次重定向，禁止 HTTPS 降级；转发单段 Range、Referer 与 Origin，并重写 HLS 子清单/密钥/分片 URI。日志不记录播放源 URL。

请只播放你有权访问的来源。请求头设置仅供来源站点要求的正常兼容；项目不绕过 DRM、账号登录、付费墙、验证码或访问限制，也不提供下载、抓取或内容目录。系统 WebView 的媒体编解码能力会因平台而异，HLS/编码兼容性仍需在各目标系统真机验证。

## 与 HGhubX 的关系

HGhubX（[zxsos/HGhubX](https://github.com/zxsos/HGhubX)）用于研究 Tauri 2 媒体应用架构、网络传输和多平台构建。本项目按其公开文档分析模块边界，独立编写 shplay 实现；没有复制 HGhubX 源码、媒体来源或接口。研究快照、技术取舍和上游许可证说明见 [HGhubX 架构研究](docs/research-hghubx.md)。

HGhubX 当前仓库采用 PolyForm Noncommercial 1.0.0，包含其 Required Notice；若未来从上游复制/改写任何代码，必须遵守该许可证及相应声明。shplay 尚未选定独立开源许可证，未授权的代码再分发权不应被默认推定。
