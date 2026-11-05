# ADR-034：Expo React Native 移动应用

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted |
| **日期** | 2026-03-02 |
| **决策者** | MaTriXy, rUv |
| **代号** | **FieldView** -- 面向 WiFi-DensePose 现场部署的移动伴侣 |
| **关联文档** | ADR-019（仅感知 UI 模式）、ADR-021（生命体征检测）、ADR-026（幸存者轨迹生命周期）、ADR-029（RuvSense 多基地）、ADR-031（RuView 感知优先 RF）、ADR-032（网格安全） |

---

## 1. 背景

### 1.1 对移动伴侣应用的需求

WiFi-DensePose 是一套基于 WiFi 的人体姿态估计系统，使用 ESP32 网格节点的信道状态信息（CSI）。现有 Web UI（`ui/`）面向桌面浏览器，未针对移动端形态优化。有三类部署场景要求专门的移动应用：

1. **灾害响应（WiFi-MAT）**：在坍塌建筑中部署 ESP32 网格节点的首批响应人员，需要便携设备实时查看幸存者检测、呼吸/心率生命体征与区域地图。在瓦砾现场使用笔记本电脑并不现实。
2. **楼宇安防**：在设施内巡逻的安保人员需要手持显示设备，查看各区域占用情况、移动告警与历史模式。口袋里的手机是最自然的形态。
3. **医疗监护**：通过基于 CSI 的非接触式生命体征监测病人的临床人员，需要在床边或护士站使用平板视图，配实时更新的呼吸率与心率仪表盘。

在这三类场景中，移动设备都不与 ESP32 节点直接通信。取而代之的是由 Rust 感知服务器（`wifi-densepose-sensing-server`，ADR-031）聚合 ESP32 的 UDP 流并暴露 WebSocket API，移动应用通过本地 WiFi 连接该服务器。

### 1.2 技术选型依据

| 需求 | 决策 | 理由 |
|-------------|----------|-----------|
| 跨平台（iOS + Android + Web） | Expo SDK 55 + React Native 0.83 | 单一代码库、托管工作流、OTA 更新 |
| 实时流传输 | WebSocket（ws://host:3001/ws/sensing） | 从 CSI 采集到移动显示的时延低于 100 ms |
| 三维可视化 | 通过 WebView 使用 Three.js 高斯泼溅 | 复用现有 `ui/` 的 Three.js 泼溅渲染器；避免原生 OpenGL 绑定 |
| 状态管理 | Zustand | 样板代码少、React 并发安全、基于 selector 的重渲染 |
| 持久化 | AsyncStorage | Expo 内置，足以保存设置与少量缓存状态 |
| 导航 | react-navigation v7（底部标签页） | 标准 React Native 导航；5 标签布局契合移动端人机工学 |
| WiFi RSSI 扫描 | 平台相关（Android：react-native-wifi-reborn，iOS：CoreWLAN stub，Web：synthetic） | 不存在跨平台的 WiFi 扫描 API；必须使用平台模块 |
| E2E 测试 | Maestro YAML 规格 | 声明式、无需 Detox 原生构建依赖、可在 CI 运行 |
| 设计系统 | 深色主题（#0D1117 背景，#32B8C6 强调色） | 与现有 `ui/` 感知仪表盘风格一致；减轻现场条件下的视觉疲劳 |

### 1.3 与现有 UI 的关系

桌面 Web UI（`ui/`）与移动应用在组件层面不共享代码，但消费相同的后端 API：

- **WebSocket**：`ws://host:3001/ws/sensing` -- 流式传输 SensingFrame JSON
- **REST**：`http://host:3000/api/v1/...` -- 配置、历史、健康检查

移动应用的 Three.js 高斯泼溅查看器（LiveScreen）加载桌面 UI 使用的同一份泼溅 HTML 包，在 WebView（原生端）或 iframe（Web 端）中渲染。

---

## 2. 决策

在 `ui/mobile/` 构建一套 Expo React Native 移动应用，为现场作业人员提供五个主屏幕，并通过 WebSocket 流连接到 Rust 感知服务器。当感知服务器不可达时，应用自动回退到模拟数据，以支持演示与离线测试。

### 2.1 屏幕架构

```
+---------------------------------------------------------------+
|                    MainTabs (Bottom Tab Navigator)             |
+---------------------------------------------------------------+
|                                                                 |
|  +----------+  +----------+  +----------+  +--------+  +-----+ |
|  |   Live   |  |  Vitals  |  |  Zones   |  |  MAT   |  | Cog | |
|  | (3D splat|  |(breathing|  |(floor    |  |(disaster|  |(set-| |
|  |  + HUD)  |  | + heart) |  | plan SVG)|  |response)|  |tings| |
|  +----------+  +----------+  +----------+  +--------+  +-----+ |
|                                                                 |
+---------------------------------------------------------------+
|  ConnectionBanner (Connected / Simulated / Disconnected)       |
+---------------------------------------------------------------+
```

**各屏幕职责：**

| 屏幕 | 主视图 | 数据源 | 关键组件 |
|--------|-------------|-------------|----------------|
| **Live** | 三维高斯泼溅，含 17 个 COCO 关键点 + HUD 叠层 | `poseStore.latestFrame` | `GaussianSplatWebView`、`LiveHUD`、`HudOverlay` |
| **Vitals** | 呼吸 BPM 仪表、心率 BPM 仪表、迷你趋势图历史 | `poseStore.latestFrame.vital_signs` | `BreathingGauge`、`HeartRateGauge`、`MetricCard`、`SparklineChart` |
| **Zones** | 楼层平面 SVG，带占用热力叠层与区域图例 | `poseStore.latestFrame.persons` | `FloorPlanSvg`、`OccupancyGrid`、`ZoneLegend` |
| **MAT** | 幸存者计数、区域地图 WebView、告警列表 | `matStore.survivors`、`matStore.alerts` | `SurvivorCounter`、`MatWebView`、`AlertList`、`AlertCard` |
| **Settings** | 服务器 URL 输入、主题选择、RSSI 开关 | `settingsStore` | `ServerUrlInput`、`ThemePicker`、`RssiToggle` |

### 2.2 状态架构

三个 Zustand store 分离关注点，避免不必要的重渲染：

```
+------------------------------------------------------------+
|                     Zustand Stores                          |
+------------------------------------------------------------+
|                                                              |
|  poseStore                                                   |
|  +--------------------------------------------------------+ |
|  | connectionStatus: 'connected' | 'simulated' | 'error'  | |
|  | latestFrame: SensingFrame | null                        | |
|  | frameHistory: RingBuffer<SensingFrame>                  | |
|  | features: FeatureVector | null                          | |
|  | persons: Person[]                                       | |
|  | vitalSigns: VitalSigns | null                           | |
|  +--------------------------------------------------------+ |
|                                                              |
|  matStore                                                    |
|  +--------------------------------------------------------+ |
|  | survivors: Survivor[]                                   | |
|  | alerts: MatAlert[]                                      | |
|  | events: MatEvent[]                                      | |
|  | zoneMap: ZoneMap | null                                  | |
|  +--------------------------------------------------------+ |
|                                                              |
|  settingsStore  (persisted via AsyncStorage)                 |
|  +--------------------------------------------------------+ |
|  | serverUrl: string  (default: 'http://localhost:3000')   | |
|  | wsUrl: string      (default: 'ws://localhost:3001')     | |
|  | theme: 'dark' | 'light'                                 | |
|  | rssiEnabled: boolean                                    | |
|  | simulationMode: boolean                                 | |
|  +--------------------------------------------------------+ |
|                                                              |
+------------------------------------------------------------+
```

### 2.3 服务层

四个服务封装外部通信与数据生成：

| 服务 | 文件 | 职责 |
|---------|------|----------------|
| `ws.service` | `src/services/ws.service.ts` | WebSocket 连接生命周期、指数退避重连、SensingFrame 解析、分发到 `poseStore` |
| `api.service` | `src/services/api.service.ts` | 对感知服务器的 REST 调用（健康检查、配置、历史端点） |
| `rssi.service` | `src/services/rssi.service.ts`（含平台变体） | 平台相关的 WiFi RSSI 扫描。Android 使用 `react-native-wifi-reborn`，iOS 提供 CoreWLAN stub，Web 生成合成 RSSI 值 |
| `simulation.service` | `src/services/simulation.service.ts` | 真实服务器不可达时生成合成的 SensingFrame 数据。按可配置的节拍间隔产出逼真的幅度、相位、生命体征与人员数据 |

**平台相关的 RSSI 服务文件：**

| 文件 | 平台 | 实现 |
|------|----------|----------------|
| `rssi.service.android.ts` | Android | `react-native-wifi-reborn` 原生模块，需要 `ACCESS_FINE_LOCATION` 权限 |
| `rssi.service.ios.ts` | iOS | CoreWLAN stub（返回空扫描结果；Apple 把 WiFi 扫描限制在系统应用内） |
| `rssi.service.web.ts` | Web | 由噪声模型生成合成 RSSI 值 |
| `rssi.service.ts` | 默认 | 通过 React Native 文件解析机制重新导出对应平台的模块 |

### 2.4 数据流

```
ESP32 Mesh Nodes
      |
      | UDP CSI frames (ADR-029 TDM protocol)
      v
+---------------------------+
| Rust Sensing Server       |
| (wifi-densepose-sensing-  |
|  server, ADR-031)         |
|                           |
| Aggregates ESP32 streams  |
| Runs RuvSense pipeline    |
| Exposes WS + REST APIs    |
+---------------------------+
      |                    |
      | WebSocket          | REST
      | ws://host:3001     | http://host:3000
      | /ws/sensing        | /api/v1/...
      v                    v
+---------------------------+
| Expo Mobile App           |
|                           |
| ws.service                |
|   -> poseStore            |
|   -> matStore             |
|                           |
| Screens subscribe to      |
| stores via Zustand        |
| selectors                 |
+---------------------------+
```

**连接生命周期：**

1. 应用启动，`settingsStore` 从 AsyncStorage 加载已持久化的服务器 URL。
2. `ws.service` 向 `wsUrl/ws/sensing` 打开 WebSocket。
3. 每收到一条消息，`ws.service` 解析 `SensingFrame` JSON 并分发到 `poseStore`。
4. 若 WebSocket 失败，`ws.service` 以指数退避重试（1s、2s、4s、8s，最大 16s）。
5. 在 `MAX_RECONNECT_ATTEMPTS`（5）次连续失败后，`ws.service` 切换到 `simulation.service`，后者以 10 Hz 生成合成帧。
6. `poseStore.connectionStatus` 的状态迁移：`connected` -> `error` -> `simulated`。
7. `ConnectionBanner` 组件在所有屏幕上反映当前状态。
8. 若服务器重新可达，`ws.service` 会重连并恢复实时数据。

### 2.5 SensingFrame JSON 模式

WebSocket 流交付的 JSON 帧与 Rust `SensingFrame` 结构一致：

```typescript
interface SensingFrame {
  timestamp: number;           // Unix epoch ms
  amplitude: number[];         // Per-subcarrier amplitude (52 or 114 values)
  phase: number[];             // Per-subcarrier phase (radians)
  features: {
    mean_amplitude: number;
    std_amplitude: number;
    phase_slope: number;
    doppler_shift: number;
    delay_spread: number;
  };
  classification: string;      // "empty" | "single_person" | "multi_person" | "motion"
  confidence: number;          // 0.0 - 1.0
  persons: Array<{
    id: number;
    keypoints: Array<[number, number, number]>;  // 17 COCO keypoints [x, y, confidence]
    bbox: [number, number, number, number];       // [x, y, width, height]
    track_id: number;
  }>;
  vital_signs?: {
    breathing_rate_bpm: number;
    heart_rate_bpm: number;
    breathing_confidence: number;
    heart_confidence: number;
  };
  rssi?: number;
  node_id?: number;
}
```

### 2.6 Three.js 高斯泼溅渲染

LiveScreen 使用 WebView（原生端）或 iframe（Web 端）渲染 Three.js 高斯泼溅场景。这样既避免了原生 OpenGL 绑定，又能复用桌面 UI 现有的泼溅渲染器。

**原生路径（iOS/Android）：**
- `GaussianSplatWebView.tsx` 渲染 `<WebView>`，加载打包好的 HTML 页面。
- 该 HTML 页面用高斯泼溅着色器初始化 Three.js 场景。
- React Native 与 WebView 之间通过 `postMessage` / `onMessage` 桥接通信。
- `useGaussianBridge.ts` hook 管理该桥接，以 JSON 发送骨架关键点更新。

**Web 路径：**
- `GaussianSplatWebView.web.tsx`（平台专用文件）用同一份 HTML 包渲染 `<iframe>`。
- 通信使用带来源校验的 `window.postMessage`。

### 2.7 设计系统

| 令牌 | 值 | 用途 |
|-------|-------|-------|
| `colors.background` | `#0D1117` | 主背景（深色主题） |
| `colors.surface` | `#161B22` | 卡片/面板背景 |
| `colors.border` | `#30363D` | 边框、分隔线 |
| `colors.accent` | `#32B8C6` | 主强调色、活动标签、仪表填充 |
| `colors.danger` | `#F85149` | 告警、错误、危急生命体征 |
| `colors.warning` | `#D29922` | 警告、降级状态 |
| `colors.success` | `#3FB950` | 已连接状态、正常生命体征 |
| `colors.text` | `#E6EDF3` | 主文本 |
| `colors.textSecondary` | `#8B949E` | 次要/弱化文本 |
| `typography.mono` | `Courier New` | 数据值与 HUD 使用等宽字体 |
| `spacing.xs` | `4` | 紧凑间距 |
| `spacing.sm` | `8` | 小间距 |
| `spacing.md` | `16` | 中等间距 |
| `spacing.lg` | `24` | 大间距 |
| `spacing.xl` | `32` | 超大间距 |

深色主题是默认且主要的设计目标，针对现场条件优化（低环境光、减少眩光）。浅色主题变体可通过 Settings 屏幕启用。

### 2.8 ESP32 集成模型

移动应用不与 ESP32 节点直接通信，架构如下：

```
ESP32 Node A ---\
ESP32 Node B ----+---> Sensing Server (Raspberry Pi / Laptop) <---> Mobile App
ESP32 Node C ---/         (local WiFi)                            (local WiFi)
```

- **现场部署**：感知服务器运行在 Raspberry Pi 4 或作业人员的笔记本电脑上。所有设备（ESP32 节点、服务器、移动应用）接入同一个本地 WiFi 网络或便携路由器。
- **服务器 URL**：可在 Settings 屏幕配置。默认值：`http://localhost:3000`（服务器）与 `ws://localhost:3001/ws/sensing`（WebSocket）。现场使用时，作业人员把它设为服务器的局域网 IP（例如 `http://192.168.1.100:3000`）。
- **无 BLE/直连**：ESP32 节点用 UDP 广播发送 CSI 帧（ADR-029）。移动应用没有 UDP 监听器，只消费服务器处理后的输出。

---

## 3. 目录结构

```
ui/mobile/
|-- App.tsx                              # Root component, ThemeProvider + NavigationContainer
|-- app.config.ts                        # Expo config (SDK 55, app name, icons, splash)
|-- app.json                             # Expo static config
|-- babel.config.js                      # Babel config (expo-router preset)
|-- eas.json                             # EAS Build profiles (dev, preview, production)
|-- index.ts                             # Entry point (registerRootComponent)
|-- jest.config.js                       # Jest config for unit tests
|-- jest.setup.ts                        # Jest setup (mock AsyncStorage, react-native modules)
|-- metro.config.js                      # Metro bundler config
|-- package.json                         # Dependencies and scripts
|-- tsconfig.json                        # TypeScript config (strict mode)
|
|-- assets/
|   |-- android-icon-background.png      # Android adaptive icon background
|   |-- android-icon-foreground.png      # Android adaptive icon foreground
|   |-- android-icon-monochrome.png      # Android monochrome icon
|   |-- favicon.png                      # Web favicon
|   |-- icon.png                         # App icon (1024x1024)
|   |-- splash-icon.png                  # Splash screen icon
|
|-- e2e/                                 # Maestro E2E test specs
|   |-- live_screen.yaml                 # LiveScreen: splat renders, HUD shows data
|   |-- vitals_screen.yaml              # VitalsScreen: gauges animate, sparklines update
|   |-- zones_screen.yaml              # ZonesScreen: floor plan renders, legend visible
|   |-- mat_screen.yaml                 # MATScreen: survivor count, alerts list
|   |-- settings_screen.yaml            # SettingsScreen: URL input, theme toggle
|   |-- offline_fallback.yaml           # Simulated mode activates on server disconnect
|
|-- src/
|   |-- components/                      # Shared UI components (12 components)
|   |   |-- ConnectionBanner.tsx         # Status banner: Connected/Simulated/Disconnected
|   |   |-- ErrorBoundary.tsx            # React error boundary with fallback UI
|   |   |-- GaugeArc.tsx                 # SVG arc gauge (used by vitals)
|   |   |-- HudOverlay.tsx              # Translucent HUD overlay for LiveScreen
|   |   |-- LoadingSpinner.tsx           # Animated loading indicator
|   |   |-- ModeBadge.tsx               # Badge showing current mode (Live/Sim)
|   |   |-- OccupancyGrid.tsx           # Grid overlay for zone occupancy
|   |   |-- SignalBar.tsx               # WiFi signal strength bar
|   |   |-- SparklineChart.tsx          # Inline sparkline chart (SVG)
|   |   |-- StatusDot.tsx              # Colored status dot indicator
|   |   |-- ThemedText.tsx             # Text component with theme support
|   |   |-- ThemedView.tsx             # View component with theme support
|   |
|   |-- constants/                       # App-wide constants
|   |   |-- api.ts                       # REST API endpoint paths, timeouts
|   |   |-- simulation.ts               # Simulation tick rate, data ranges
|   |   |-- websocket.ts                # WS reconnect config, max attempts
|   |
|   |-- hooks/                           # Custom React hooks (5 hooks)
|   |   |-- usePoseStream.ts            # Subscribe to poseStore, manage WS lifecycle
|   |   |-- useRssiScanner.ts           # Platform RSSI scanning with permission handling
|   |   |-- useServerReachability.ts    # Periodic health check, reachability state
|   |   |-- useTheme.ts                # Theme context consumer
|   |   |-- useWebViewBridge.ts         # WebView <-> RN message bridge
|   |
|   |-- navigation/                      # React Navigation setup
|   |   |-- MainTabs.tsx                # Bottom tab navigator (5 tabs)
|   |   |-- RootNavigator.tsx           # Root stack (splash -> MainTabs)
|   |   |-- types.ts                    # Navigation type definitions
|   |
|   |-- screens/                         # Screen modules (5 screens)
|   |   |-- LiveScreen/
|   |   |   |-- index.tsx               # LiveScreen container
|   |   |   |-- GaussianSplatWebView.tsx       # Native: WebView 3D splat
|   |   |   |-- GaussianSplatWebView.web.tsx   # Web: iframe 3D splat
|   |   |   |-- LiveHUD.tsx             # Heads-up display overlay
|   |   |   |-- useGaussianBridge.ts    # Bridge hook for splat WebView
|   |   |
|   |   |-- VitalsScreen/
|   |   |   |-- index.tsx               # VitalsScreen container
|   |   |   |-- BreathingGauge.tsx      # Breathing rate arc gauge
|   |   |   |-- HeartRateGauge.tsx      # Heart rate arc gauge
|   |   |   |-- MetricCard.tsx          # Metric display card
|   |   |
|   |   |-- ZonesScreen/
|   |   |   |-- index.tsx               # ZonesScreen container
|   |   |   |-- FloorPlanSvg.tsx        # SVG floor plan with occupancy overlay
|   |   |   |-- useOccupancyGrid.ts     # Occupancy grid computation hook
|   |   |   |-- ZoneLegend.tsx          # Zone color legend
|   |   |
|   |   |-- MATScreen/
|   |   |   |-- index.tsx               # MATScreen container
|   |   |   |-- SurvivorCounter.tsx     # Large survivor count display
|   |   |   |-- MatWebView.tsx          # WebView for MAT zone map
|   |   |   |-- AlertList.tsx           # Scrollable alert list
|   |   |   |-- AlertCard.tsx           # Individual alert card
|   |   |   |-- useMatBridge.ts         # Bridge hook for MAT WebView
|   |   |
|   |   |-- SettingsScreen/
|   |       |-- index.tsx               # SettingsScreen container
|   |       |-- ServerUrlInput.tsx      # Server URL text input with validation
|   |       |-- ThemePicker.tsx         # Dark/light theme toggle
|   |       |-- RssiToggle.tsx          # RSSI scanning enable/disable
|   |
|   |-- services/                        # External communication services (4 services)
|   |   |-- ws.service.ts               # WebSocket client with reconnection
|   |   |-- api.service.ts              # REST API client (fetch-based)
|   |   |-- rssi.service.ts             # Default RSSI service (platform re-export)
|   |   |-- rssi.service.android.ts     # Android RSSI via react-native-wifi-reborn
|   |   |-- rssi.service.ios.ts         # iOS CoreWLAN stub
|   |   |-- rssi.service.web.ts         # Web synthetic RSSI
|   |   |-- simulation.service.ts       # Synthetic SensingFrame generator
|   |
|   |-- stores/                          # Zustand state stores (3 stores)
|   |   |-- poseStore.ts                # Connection state, frames, features, persons
|   |   |-- matStore.ts                 # Survivors, alerts, events, zone map
|   |   |-- settingsStore.ts            # Server URL, theme, RSSI toggle (persisted)
|   |
|   |-- theme/                           # Design system tokens
|   |   |-- index.ts                    # Theme re-exports
|   |   |-- colors.ts                   # Color palette (dark + light)
|   |   |-- spacing.ts                  # Spacing scale
|   |   |-- typography.ts              # Font families and sizes
|   |   |-- ThemeContext.tsx            # React context for theme
|   |
|   |-- types/                           # TypeScript type definitions
|   |   |-- api.ts                      # REST API response types
|   |   |-- html.d.ts                   # HTML asset module declaration
|   |   |-- mat.ts                      # MAT domain types (Survivor, Alert, Event)
|   |   |-- navigation.ts              # Navigation param list types
|   |   |-- react-native-wifi-reborn.d.ts  # Type stubs for wifi-reborn
|   |   |-- sensing.ts                  # SensingFrame, Person, VitalSigns types
|   |
|   |-- utils/                           # Utility functions
|   |   |-- colorMap.ts                 # Value-to-color mapping for gauges
|   |   |-- formatters.ts              # Number/date formatting helpers
|   |   |-- ringBuffer.ts             # Fixed-size ring buffer for frame history
|   |   |-- urlValidator.ts           # Server URL validation
|   |
|   |-- __tests__/                       # Unit tests (mirroring src/ structure)
|       |-- test-utils.tsx              # Test utilities, render helpers, mocks
|       |-- components/                 # Component unit tests (7 test files)
|       |-- hooks/                      # Hook unit tests (3 test files)
|       |-- screens/                    # Screen unit tests (5 test files)
|       |-- services/                   # Service unit tests (4 test files)
|       |-- stores/                     # Store unit tests (3 test files)
|       |-- utils/                      # Utility unit tests (3 test files)
```

**文件数量汇总：**

| 类别 | 文件数 |
|----------|-------|
| 源码（组件、屏幕、服务、store、hook、工具、类型、主题、导航） | 63 个 `.ts`/`.tsx` 文件 |
| 单元测试 | 25 个测试文件 |
| E2E 测试（Maestro） | 6 份 YAML 规格 |
| 配置（babel、metro、jest、tsconfig、eas、app） | 7 个配置文件 |
| 资源 | 6 个图片文件 |
| **合计** | **107 files** |

---

## 4. 实施计划（文件级）

### 4.1 阶段 1：核心基础设施

| 文件 | 用途 | 优先级 |
|------|---------|----------|
| `App.tsx` | 根组件，含 ThemeProvider 与 NavigationContainer | P0 |
| `index.ts` | Expo 入口点 | P0 |
| `app.config.ts` | Expo SDK 55 配置 | P0 |
| `src/theme/colors.ts` | 深色与浅色调色板 | P0 |
| `src/theme/spacing.ts` | 间距比例 | P0 |
| `src/theme/typography.ts` | 字体定义 | P0 |
| `src/theme/ThemeContext.tsx` | 主题的 React context provider | P0 |
| `src/navigation/MainTabs.tsx` | 含 5 个标签的底部标签导航器 | P0 |
| `src/navigation/RootNavigator.tsx` | 根 stack 导航器 | P0 |
| `src/types/sensing.ts` | SensingFrame、Person、VitalSigns 类型定义 | P0 |

### 4.2 阶段 2：状态与服务

| 文件 | 用途 | 优先级 |
|------|---------|----------|
| `src/stores/poseStore.ts` | 管理连接状态、帧、人员的 Zustand store | P0 |
| `src/stores/matStore.ts` | 管理 MAT 幸存者、告警、事件的 Zustand store | P0 |
| `src/stores/settingsStore.ts` | 带 AsyncStorage 持久化的 Zustand store | P0 |
| `src/services/ws.service.ts` | 带重连与分发能力的 WebSocket 客户端 | P0 |
| `src/services/api.service.ts` | REST API 客户端 | P1 |
| `src/services/simulation.service.ts` | 用于回退的合成 SensingFrame 生成器 | P0 |
| `src/services/rssi.service.ts` | 平台 RSSI 重新导出 | P1 |
| `src/services/rssi.service.android.ts` | Android 侧 react-native-wifi-reborn 集成 | P1 |
| `src/services/rssi.service.ios.ts` | iOS CoreWLAN 桩实现 | P2 |
| `src/services/rssi.service.web.ts` | Web 端合成 RSSI | P1 |
| `src/utils/ringBuffer.ts` | 用于帧历史的定长环形缓冲区 | P0 |
| `src/utils/urlValidator.ts` | 服务器 URL 校验 | P1 |

### 4.3 阶段 3：共享组件

| 文件 | 用途 | 优先级 |
|------|---------|----------|
| `src/components/ConnectionBanner.tsx` | 跨所有屏幕的状态横幅 | P0 |
| `src/components/GaugeArc.tsx` | 生命体征用的 SVG 弧形仪表 | P0 |
| `src/components/SparklineChart.tsx` | 历史数据的行内迷你趋势图 | P0 |
| `src/components/OccupancyGrid.tsx` | 区域的网格叠层 | P1 |
| `src/components/StatusDot.tsx` | 彩色状态指示点 | P1 |
| `src/components/SignalBar.tsx` | WiFi 信号强度显示 | P1 |
| `src/components/ModeBadge.tsx` | Live/Sim 模式徽标 | P1 |
| `src/components/ErrorBoundary.tsx` | React 错误边界 | P0 |
| `src/components/LoadingSpinner.tsx` | 加载状态指示器 | P1 |
| `src/components/ThemedText.tsx` | 带主题支持的文本组件 | P0 |
| `src/components/ThemedView.tsx` | 带主题支持的视图组件 | P0 |
| `src/components/HudOverlay.tsx` | Live 屏幕的半透明 HUD 叠层 | P1 |

### 4.4 阶段 4：各屏幕

| 文件 | 用途 | 优先级 |
|------|---------|----------|
| `src/screens/LiveScreen/index.tsx` | Live 三维泼溅 + HUD | P0 |
| `src/screens/LiveScreen/GaussianSplatWebView.tsx` | 原生端泼溅 WebView | P0 |
| `src/screens/LiveScreen/GaussianSplatWebView.web.tsx` | Web 端泼溅 iframe | P1 |
| `src/screens/LiveScreen/LiveHUD.tsx` | 带指标显示的 HUD 叠层 | P1 |
| `src/screens/LiveScreen/useGaussianBridge.ts` | 泼溅 WebView 的桥接 hook | P0 |
| `src/screens/VitalsScreen/index.tsx` | 生命体征仪表与迷你趋势图 | P0 |
| `src/screens/VitalsScreen/BreathingGauge.tsx` | 呼吸率仪表 | P0 |
| `src/screens/VitalsScreen/HeartRateGauge.tsx` | 心率仪表 | P0 |
| `src/screens/VitalsScreen/MetricCard.tsx` | 生命体征指标卡片 | P1 |
| `src/screens/ZonesScreen/index.tsx` | 带占用信息的楼层平面 | P1 |
| `src/screens/ZonesScreen/FloorPlanSvg.tsx` | SVG 楼层平面渲染器 | P1 |
| `src/screens/ZonesScreen/useOccupancyGrid.ts` | 占用网格计算 | P1 |
| `src/screens/ZonesScreen/ZoneLegend.tsx` | 区域图例 | P2 |
| `src/screens/MATScreen/index.tsx` | MAT 仪表盘 | P1 |
| `src/screens/MATScreen/SurvivorCounter.tsx` | 幸存者计数显示 | P1 |
| `src/screens/MATScreen/MatWebView.tsx` | MAT 区域地图 WebView | P1 |
| `src/screens/MATScreen/AlertList.tsx` | 告警列表 | P1 |
| `src/screens/MATScreen/AlertCard.tsx` | 单条告警卡片 | P2 |
| `src/screens/MATScreen/useMatBridge.ts` | MAT WebView 桥接 | P1 |
| `src/screens/SettingsScreen/index.tsx` | 设置表单 | P0 |
| `src/screens/SettingsScreen/ServerUrlInput.tsx` | 服务器 URL 输入 | P0 |
| `src/screens/SettingsScreen/ThemePicker.tsx` | 主题切换 | P2 |
| `src/screens/SettingsScreen/RssiToggle.tsx` | RSSI 开关 | P2 |

### 4.5 阶段 5：测试

| 文件 | 用途 | 优先级 |
|------|---------|----------|
| `src/__tests__/stores/poseStore.test.ts` | store 状态迁移、帧处理 | P0 |
| `src/__tests__/stores/matStore.test.ts` | MAT store 状态管理 | P1 |
| `src/__tests__/stores/settingsStore.test.ts` | 持久化、默认值 | P1 |
| `src/__tests__/services/ws.service.test.ts` | WS 连接、重连、回退 | P0 |
| `src/__tests__/services/simulation.service.test.ts` | 合成帧生成 | P1 |
| `src/__tests__/services/api.service.test.ts` | REST 客户端打桩 | P1 |
| `src/__tests__/services/rssi.service.test.ts` | 平台 RSSI 打桩 | P2 |
| `src/__tests__/components/*.test.tsx` | 组件渲染测试（7 个文件） | P1 |
| `src/__tests__/hooks/*.test.ts` | hook 行为测试（3 个文件） | P1 |
| `src/__tests__/screens/*.test.tsx` | 屏幕集成测试（5 个文件） | P1 |
| `src/__tests__/utils/*.test.ts` | 工具函数测试（3 个文件） | P1 |
| `e2e/*.yaml` | Maestro E2E 规格（6 个文件） | P2 |

---

## 5. 验收标准

### 5.1 构建与平台支持

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| B-1 | 应用可通过 `npx expo start` 为 iOS、Android、Web 成功构建 | CI 构建矩阵：`expo start --ios`、`--android`、`--web` |
| B-2 | 应用可在 iOS Simulator（iPhone 15 Pro、iOS 17+）运行 | 在 Simulator 上人工验证 |
| B-3 | 应用可在 Android Emulator（API 34+）运行 | 在 Emulator 上人工验证 |
| B-4 | 应用可在 Web 浏览器（Chrome 120+、Safari 17+、Firefox 120+）运行 | 在浏览器中人工验证 |
| B-5 | TypeScript 在 strict 模式下零错误编译 | 在 CI 中执行 `npx tsc --noEmit` |

### 5.2 WebSocket 与数据流

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| W-1 | WebSocket 连上感知服务器并接收 SensingFrame JSON | 集成测试：启动服务器，验证 `poseStore.connectionStatus === 'connected'` |
| W-2 | `poseStore.latestFrame` 在收到 WebSocket 消息后 100ms 内更新 | 单元测试：打桩 WS，测量分发时延 |
| W-3 | 连接断开后 WebSocket 以指数退避重连 | 单元测试：模拟 WS 关闭，验证重试间隔（1s、2s、4s、8s、16s） |
| W-4 | 连接失败后 5 秒内自动回退到模拟数据 | 单元测试：让 WS 失败 5 次，验证 5s 内 `connectionStatus === 'simulated'` |
| W-5 | 感知服务器重启后应用优雅恢复（重连且不崩溃） | 集成测试：关闭并重启服务器，验证重连且 `connectionStatus === 'connected'` |

### 5.3 屏幕渲染

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S-1 | 全部 5 个屏幕在感知服务器实时数据下正确渲染 | 集成测试：连接服务器、遍历所有标签、验证内容 |
| S-2 | 全部 5 个屏幕在模拟数据下正确渲染 | 单元测试：设置 `connectionStatus = 'simulated'`，验证所有屏幕可渲染 |
| S-3 | 生命体征仪表平滑动画（呼吸 BPM、心率 BPM） | 目视检查：仪表按帧率更新且无卡顿 |
| S-4 | 三维高斯泼溅查看器显示含 17 个 COCO 关键点的骨架 | 集成测试：验证 WebView 加载、桥接发送关键点、泼溅渲染成功 |
| S-5 | 检测到人员时楼层平面 SVG 随占用数据更新 | 单元测试：向 poseStore 注入 3 人，验证 FloorPlanSvg 上出现 3 个标记 |
| S-6 | MAT 仪表盘显示幸存者计数、区域地图与告警列表 | 单元测试：注入 matStore 数据，验证 SurvivorCounter 与 AlertList 渲染 |
| S-7 | 连接横幅对全部 3 种状态显示正确的文案与颜色 | 单元测试：依次切换 `connected`/`simulated`/`error`，验证横幅文案与颜色 |

### 5.4 持久化与设置

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| P-1 | 设置跨应用重启保持（服务器 URL、主题、RSSI 开关） | 集成测试：设置取值、结束应用、重启，验证取值恢复 |
| P-2 | 无持久化取值时默认服务器 URL 为 `http://localhost:3000` | 单元测试：清空 AsyncStorage，验证默认值 |
| P-3 | 服务器 URL 输入框在保存前校验格式 | 单元测试：提交 `not-a-url` 验证被拒；提交 `http://192.168.1.1:3000` 验证通过 |

### 5.5 导航与用户体验

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| N-1 | 底部标签导航可用，全部 5 个标签图标正确 | E2E：Maestro 遍历所有标签并验证激活态 |
| N-2 | 深色主题在所有平台正确渲染（背景 #0D1117、强调色 #32B8C6） | 在 iOS、Android、Web 上目视检查 |
| N-3 | store 无无限渲染循环或内存泄漏 | 单元测试：挂载所有屏幕、处理 1000 帧，验证内存增长不超过环形缓冲区大小 |
| N-4 | ErrorBoundary 捕获组件错误并显示回退 UI | 单元测试：在子组件中抛错，验证回退 UI 渲染 |

### 5.6 平台相关功能

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| R-1 | RSSI 扫描在 Android 上通过 react-native-wifi-reborn 正常工作 | 在已授权定位权限的 Android 设备上人工测试 |
| R-2 | iOS RSSI 服务返回空结果且不崩溃 | 单元测试：在 iOS 调用 `scanNetworks()`，验证返回空数组 |
| R-3 | Web RSSI 服务生成合成 RSSI 值 | 单元测试：在 Web 调用 `scanNetworks()`，验证返回合成数据 |

### 5.7 测试

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| T-1 | 全部单元测试通过（`npm test` 退出码 0） | CI：`cd ui/mobile && npm test` |
| T-2 | 全部 5 个屏幕的 E2E Maestro 测试通过 | CI：`maestro test e2e/` |
| T-3 | E2E 离线回退测试通过（断连时启用模拟模式） | CI：`maestro test e2e/offline_fallback.yaml` |
| T-4 | 无 TypeScript 类型错误 | CI：`npx tsc --noEmit` |

---

## 6. 影响

### 6.1 正面

- **三平台共用一套代码库**：Expo SDK 55 配合 React Native 0.83，可由同一份 TypeScript 源码构建 iOS、Android 与 Web，相比分别开发原生应用，开发与维护成本约降低 60%。
- **现场即时部署**：作业人员可通过 Expo Go（开发）或 EAS Build（生产）安装应用，几分钟内连上本地感知服务器，无需任何服务端移动基础设施。
- **显示时延低于 100 ms**：从 Rust 感知服务器到移动应用的 WebSocket 流，在 CSI 处理流水线之外只引入不到 100ms 的额外时延，可提供近实时可视化。
- **可离线演示**：仿真服务生成逼真的合成 SensingFrame 数据，可在没有 ESP32 硬件、也没有运行中的感知服务器时向相关方演示并开展测试。
- **面向作业人员的易用体验**：五个专用屏幕覆盖主要使用场景（实时视图、生命体征、区域、MAT、设置），并采用移动用户熟悉的底部标签导航模式。
- **可测试的架构**：基于 selector 订阅的 Zustand store、服务层抽象以及 Maestro E2E 规格，构成从单元、集成到端到端的完整测试策略。
- **复用既有基础设施**：应用消费与桌面 UI 相同的 WebSocket 与 REST API，无需改动后端；Three.js 泼溅渲染器通过 WebView 复用。

### 6.2 负面

- **基于 WebView 的三维渲染性能低于原生 OpenGL**：高斯泼溅查看器运行在 WebView（原生端）或 iframe（Web 端）中，增加了一次 JavaScript 到原生的桥接跳转，在中端设备上帧率上限约为 30 FPS。原生 OpenGL 或 Metal/Vulkan 渲染可达 60 FPS，但需要平台专用代码。
- **react-native-wifi-reborn 在 Android RSSI 上需要链接原生模块**：这打破了 Android 构建的纯 Expo 托管工作流，必须使用带自定义开发客户端的 EAS Build。受 Apple 限制，iOS 完全无法进行 RSSI 扫描。
- **Expo 托管工作流限制部分原生模块访问**：某些原生 API（后台定位、Bluetooth LE、原始 WiFi 帧）不退出到 bare workflow 就无法使用，这约束了蓝牙网格回退等未来特性。
- **WebView 桥接时延**：React Native 与 Three.js WebView 之间通过 `postMessage` 通信，每条消息增加 5-15ms，降低了三维泼溅视图的有效更新率。对 10-20 Hz 的感知帧率尚可接受，但在更高帧率下会成为瓶颈。
- **AsyncStorage 没有加密**：设置（含服务器 URL）以明文保存在 AsyncStorage 中。对于安全敏感部署，应改用 expo-secure-store 保存凭据。

### 6.3 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| Expo SDK 55 在未来更新中引入破坏性变更 | Medium | 构建失败、API 废弃 | 在 `app.config.ts` 中锁定 SDK 版本；在预览分支测试升级 |
| 低端 Android 设备上的 WebView 内存压力 | Medium | 渲染 Three.js 泼溅时 OOM 崩溃 | 实现泼溅 LOD（细节层级）回退；通过 `onContentProcessDidTerminate` 监控 WebView 内存 |
| react-native-wifi-reborn 无人维护或与 RN 0.83 不兼容 | Low | Android RSSI 扫描失效 | 必要时 fork 并打补丁；RSSI 扫描属次要功能 |
| 感知服务器 WebSocket 协议变更 | Medium | 帧解析错误、显示中断 | 为 WebSocket 协议加版本；在 SensingFrame 中增加 `protocol_version` 字段 |
| 移动端持续 WebSocket 连接耗电 | Medium | 长时间现场作业时体验变差 | 在设置中实现可配置的更新率限流；应用进入后台时暂停 WS |
| Three.js 高斯泼溅 HTML 包超出 WebView 限制 | Low | 首次加载缓慢、白屏 | 懒加载泼溅包；加载期间显示占位骨架；把包缓存到 AsyncStorage |

---

## 7. 后续工作

### 7.1 离线模型推理

用 `onnxruntime-react-native` 在移动设备上直接运行量化后的 ONNX 姿态估计模型。这样应用无需感知服务器即可处理原始 CSI 数据（通过本地 UDP 中继或蓝牙接收），实现完全断网的现场作业。

**前置条件：** 把训练好的 WiFi-DensePose 模型（ADR-023）导出为 ONNX 格式；量化为 INT8 以适配移动端；在 iPhone 15 与 Pixel 8 上实测推理时延。

### 7.2 MAT 告警推送通知

集成 Firebase Cloud Messaging（Android）与 APNs（iOS），在感知服务器检测到新幸存者或危急生命体征告警时推送通知，使应用处于后台时作业人员也能收到提醒。

**前置条件：** 在 Rust 感知服务器中新增推送通知端点；在移动应用中实现 Expo Notifications 集成。

### 7.3 Apple Watch 伴侣应用

用 Expo 实验性的 watch 支持或原生 SwiftUI 模块构建 watchOS 伴侣应用。手表在作业人员腕上显示精简生命体征视图（呼吸率、心率、告警计数），并对危急 MAT 告警提供触觉反馈。

**前置条件：** 评估 Expo watch 支持的成熟度；定义最小化的手表屏幕集合；实现 WatchConnectivity 桥接。

### 7.4 蓝牙网格回退

当 WiFi 不可用（建筑坍塌、停电）时，用低功耗蓝牙（BLE）网格把 ESP32 节点聚合后的 CSI 摘要中继到移动设备。这需要退出 Expo 托管工作流、改用 bare workflow 才能访问 BLE 原生模块。

**前置条件：** 在 ESP32 固件实现 BLE GATT 服务（ADR-018）；在 bare Expo 工作流中集成 `react-native-ble-plx`；定义 BLE CSI 摘要协议（压缩后带宽低于 WiFi）。

### 7.5 多服务器仪表盘

支持同时连接多台感知服务器（例如每层楼或每个楼翼一台）。应用把所有服务器的数据聚合到统一的区域地图与 MAT 仪表盘中，并附各服务器的状态指示。

**前置条件：** 扩展 `settingsStore` 以支持服务器列表；修改 `ws.service` 以管理多条 WebSocket 连接；合并来自多个来源、带 server-id 标签的 `poseStore` 帧。

---

## 8. 相关 ADR

| ADR | 关系 |
|-----|-------------|
| ADR-019（仅感知 UI 模式） | **扩展**：移动应用是仅感知 UI 模式面向现场优化的演进，加入了原生移动能力（推送、RSSI、离线） |
| ADR-021（生命体征检测） | **消费**：VitalsScreen 显示由 ADR-021 流水线提取的 breathing_rate_bpm 与 heart_rate_bpm |
| ADR-026（幸存者轨迹生命周期） | **消费**：MATScreen 显示来自 ADR-026、带生命周期状态（detected、confirmed、rescued、lost）的幸存者轨迹 |
| ADR-029（RuvSense 多基地） | **消费**：感知服务器聚合 ESP32 TDM 帧（ADR-029），并把处理结果流式推送到移动应用 |
| ADR-031（RuView 感知优先 RF） | **消费**：`wifi-densepose-sensing-server`（ADR-031）暴露的 WebSocket 与 REST API 是移动应用的数据源 |
| ADR-032（网格安全） | **消费**：经认证的 CSI 帧（ADR-032）确保移动应用显示的是可信数据，而非伪造的传感器读数 |

---

## 9. 参考资料

1. Expo SDK 55 文档。https://docs.expo.dev/
2. React Native 0.83 发布说明。https://reactnative.dev/
3. Zustand v5 项目。https://github.com/pmndrs/zustand
4. React Navigation v7 项目。https://reactnavigation.org/
5. Maestro 移动测试框架。https://maestro.mobile.dev/
6. react-native-wifi-reborn 项目。https://github.com/JuanSeBestworker/react-native-wifi-reborn
7. Three.js 高斯泼溅。https://github.com/mrdoob/three.js
8. AsyncStorage 项目。https://react-native-async-storage.github.io/async-storage/
9. Geng, J. 等（2023 年）。"DensePose From WiFi." arXiv:2301.00250。
10. ADR-019 至 ADR-032（内部文档）。
