# shplay

React + TypeScript 播放界面，配合 Rust + Tauri 2 原生壳的跨平台媒体播放器实验项目。当前版本支持用户输入 MP4/WebM/HLS URL，也支持配置通用公开 JSON API 的 GET/POST 搜索、可选详情映射，并将结果交给现有播放器；来源配置与媒体库只保存在本机。

## 快速开始

```bash
pnpm install
pnpm dev                 # 浏览器预览（媒体直连；不会请求来源 API）
pnpm build               # TypeScript 检查 + Vite 生产构建
pnpm test:provider       # SourceProvider 请求/映射逻辑单测
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

- `src/app`、`src/features`、`src/shared`：React 应用壳、播放器功能、通用 SourceProvider 和共享 IPC/存储。
- `src-tauri/src`：Tauri 应用入口、受限 JSON API 请求与回环媒体代理。
- `src-tauri/crates/media-core`：独立纯 Rust URL/IP/HLS 规则，可不依赖 GTK/WebKit 单独测试。
- `docs`：HGhubX 源仓库研究记录、shplay 运行时边界和平台构建说明。

`pnpm build` 校验 UI；`pnpm test:provider` 运行可注入模拟传输的 SourceProvider 单测；`cargo test --manifest-path src-tauri/crates/media-core/Cargo.toml` 运行不需要原生系统库的 Rust URL/IP/HLS 安全策略测试。完整 Tauri 编译还需安装相应平台的系统依赖。

## 网络与隐私边界

媒体代理只绑定 `127.0.0.1` 随机端口，URL 带随机 capability；媒体路由仅开放 GET/HEAD，不接受任意方法/路径。独立的 `fetch_provider_json` IPC 命令只支持 GET/POST、`Accept`/`Accept-Language` 请求头、64 KiB JSON 请求体和 2 MiB JSON 响应；请求有 15 秒总时限。两条网络链路都校验 HTTP(S) 公网目标、固定 DNS 并逐跳限制重定向，拒绝回环/内网/链路本地地址与 HTTPS 降级。媒体链路还转发单段 Range、Referer/Origin 并重写 HLS 子清单/密钥/分片 URI。Provider 不支持账号、Cookie、Authorization/API Key 或 DRM；浏览器预览不访问来源 API。

请只使用你有权访问的公开来源。配置仅适用于不需要登录、Cookie 或令牌的 JSON API；项目不绕过 DRM、账号登录、付费墙、验证码或访问限制，也不提供下载、抓取或内置内容目录。系统 WebView 的媒体编解码能力会因平台而异，HLS/编码兼容性仍需在各目标系统真机验证。

## 与 HGhubX 的关系

HGhubX（[zxsos/HGhubX](https://github.com/zxsos/HGhubX)）用于研究 Tauri 2 媒体应用架构、网络传输和多平台构建。本项目按其公开文档分析模块边界，独立编写 shplay 实现；没有复制 HGhubX 源码、媒体来源或接口。研究快照、技术取舍和上游许可证说明见 [HGhubX 架构研究](docs/research-hghubx.md)。

shplay 项目采用 Apache License 2.0，完整条款见 [LICENSE](LICENSE)。HGhubX 当前仓库采用 PolyForm Noncommercial 1.0.0，包含其 Required Notice；本项目未复制 HGhubX 代码。若未来引入上游代码，仍需单独遵守该代码适用的许可证及声明；shplay 的 Apache-2.0 许可不扩展至上游内容。
