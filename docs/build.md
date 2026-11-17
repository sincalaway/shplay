# 构建与打包

shplay 使用 pnpm/Vite 构建 React UI，Tauri 2 CLI 将同一前端与 Rust 后端打包到桌面和移动系统。版本与输出类型由 `src-tauri/tauri.conf.json` 及运行目标决定。

## 通用开发

要求 Node.js 20.19+、pnpm、Rust 1.90+。

```bash
pnpm install
pnpm build
pnpm desktop:dev
pnpm desktop:build
```

`pnpm dev` 是普通浏览器预览，前端用 HLS.js 或 `<video>` 直连用户 URL，可能因来源 CORS/Referer 限制失败；真正的跨域媒体代理仅在 Tauri 原生运行时启动。纯安全逻辑测试不依赖桌面 SDK：

```bash
cargo test --manifest-path src-tauri/crates/media-core/Cargo.toml
```

## Linux 桌面

Ubuntu/Debian 需要 WebKitGTK 4.1、GTK、构建工具及 Tauri 运行依赖（具体包随发行版变化）。Ubuntu 24.04 可按 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) 安装：

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
pnpm install
pnpm desktop:dev
pnpm tauri build --bundles deb
```

项目 `bundle.targets` 配置为 `all`，会按当前主机构建支持的 bundle；Linux 可按需要选择 deb/AppImage/RPM，并满足各格式自己的打包依赖。

## Windows 桌面

需要 Rust MSVC 工具链、Microsoft C++ Build Tools（“Desktop development with C++”）和 Edge WebView2。安装依赖后：

```powershell
pnpm install
pnpm desktop:dev
pnpm desktop:build
```

Tauri 默认会按 bundle 配置生成适用于当前目标的 Windows 安装程序。若构建 MSI，Windows 还可能要求启用 VBScript；NSIS/签名需按团队发布流程设置。参考 [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) 与 [Windows installer](https://v2.tauri.app/distribute/windows-installer/)。

## macOS 桌面

需要 macOS 与 Xcode Command Line Tools；商店签名/公证另需 Apple 证书与配置。构建：

```bash
pnpm install
pnpm desktop:dev
pnpm desktop:build
```

## Android

需要 Android Studio、SDK、NDK、Build Tools、Command-line Tools、JDK，以及相应 Rust targets。设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 后，按 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) 安装 targets：

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
pnpm android:init
pnpm android:dev
pnpm android:build
```

Android 安装包签名、应用商店发布、设备编解码器验证不由本项目自动完成。

## iOS

**iOS 构建仅支持 macOS + 完整 Xcode**（Command Line Tools 不够），并需要 iOS Rust targets 与 CocoaPods：

```bash
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
pnpm ios:init
pnpm ios:dev
pnpm ios:build
```

上架/真机分发需要 Apple 签名与 provisioning profile；未签名/模拟器产物不能宣称为可直接发布的 App Store 包。

## CI 与产物

`.github/workflows/ci.yml` 会验证前端及 Rust 代码；`package-matrix.yml` 是手动触发的 Linux/Windows/macOS 桌面与 Android 构建检查。正式发布需单独加入签名密钥和受保护的发布流程，仓库不包含证书或密钥。

Tauri 官方指出每个平台有各自原生依赖与签名要求；本机通过 `tauri build` 只负责当前操作系统 target，Android/iOS 走各自 CLI 命令。任何目标的“能编译”都不等同于该平台媒体解码、系统代理、HLS 与触摸体验已通过实机回归。

Android `tauri android build` 可生成 APK/AAB，并支持 `--apk`、`--aab` 与 `--split-per-abi`；iOS CLI build 只在 macOS 主机可用。请以 [Tauri CLI reference](https://v2.tauri.app/reference/cli/) 为准。App Store 发布还要求 Apple Developer 计划与代码签名，见 [Tauri App Store 指南](https://v2.tauri.app/distribute/app-store/)。
