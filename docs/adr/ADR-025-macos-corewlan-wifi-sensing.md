# ADR-025：通过 Swift Helper Bridge 实现 macOS CoreWLAN WiFi 感知

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-01 |
| **更新** | 2026-10-01：macOS 27 在没有定位服务时也会屏蔽 SSID；已连接的链路改用合成 id 保留，`auto`+wifi 保持 UDP 绑定（见修订 1） |
| **决策者** | ruv |
| **代号** | **ORCA** — OS-native Radio Channel Acquisition |
| **关联** | ADR-013（通用商用设备上的特征级感知）、ADR-022（Windows WiFi 保真度增强）、ADR-014（SOTA 信号处理）、ADR-018（ESP32 开发实现） |
| **问题单** | [#56](https://github.com/ruvnet/wifi-densepose/issues/56) |
| **构建/测试目标** | Mac Mini (M2 Pro, macOS 26.3) |

---

## 1. 背景

### 1.1 缺口：macOS 会静默回退

`sensing-server` 中的 `--source auto` 路径会先探测 ESP32 UDP，再探测 Windows `netsh`，最后回退到模拟模式。macOS 用户会悄无声息地走进模拟路径——目前没有 macOS WiFi 适配器。这是唯一一个缺少真实 WiFi 感知支持的主流桌面平台。

### 1.2 平台约束（macOS 26.3+）

| 约束 | 说明 |
|------------|--------|
| **`airport` CLI 已移除** | Apple 在 macOS 15 中移除了 `/System/Library/PrivateFrameworks/.../airport`。没有任何 CLI 兜底方案。 |
| **CoreWLAN 是唯一路径** | `CWWiFiClient`（Swift/ObjC）是受支持的 WiFi 扫描 API，返回 RSSI、信道、SSID、噪声、PHY 模式与安全类型。 |
| **BSSID 被屏蔽** | 除非应用同时具备定位服务与 WiFi entitlement，macOS 隐私策略会屏蔽 `CWNetwork.bssid` 中的 MAC 地址。无 entitlement 的应用读到 `nil`。 |
| **没有原始 CSI** | Apple 不开放 CSI 或逐子载波数据。macOS WiFi 感知只能是 RSSI 级，与 Windows `netsh` 同档。 |
| **扫描速率** | `CWInterface.scanForNetworks()` 耗时约 2-4 秒。无缓存时有效速率约 0.3-0.5 Hz。 |
| **权限** | 读取 BSSID 需要弹出定位服务授权提示。没有授权时，SSID + RSSI + 信道仍可获取。 |

### 1.3 机会：多 AP 的 RSSI 分集

原理与 ADR-022（Windows）相同：可见的 AP 充当伪子载波。典型室内环境在 2.4 GHz 与 5 GHz 频段上会暴露 10-30 个以上 SSID。受几何位置影响，每个 AP 的 RSSI 对人体移动的响应各不相同，由此形成空间分集。

| 来源 | 等效子载波数 | 采样率 | 能力 |
|--------|----------------------|-------------|-------------|
| ESP32-S3 (CSI) | 56-192 | 20 Hz | 完整：姿态、生命体征、穿墙 |
| Windows `netsh`（ADR-022） | 10-30 BSSIDs | ~2 Hz | 存在检测、运动、粗粒度呼吸 |
| **macOS CoreWLAN（本 ADR）** | **10-30 SSIDs** | **~0.3-0.5 Hz** | **存在检测、运动** |

相比 Windows 更低的扫描速率，由更高的信号质量补偿——CoreWLAN 返回经过校准的 dBm（而非百分比）外加底噪，因而可以正确计算 SNR。

### 1.4 为什么用 Swift 子进程（而非 FFI）

| 方案 | 复杂度 | 可维护性 | 构建 | 裁定 |
|----------|-----------|-------------|-------|---------|
| **Swift CLI → JSON → stdout** | Low | 独立二进制，可单独做版本管理 | `swiftc`（随 Xcode CLT 提供） | **Chosen** |
| 通过 `cc` crate 做 ObjC FFI | Medium | 头文件绑定脆弱，ABI 易变 | 需要 Xcode 头文件 | Rejected |
| `objc2` crate（Rust ObjC 桥） | High | 上游 `objc2-frameworks` 未收录 CoreWLAN | 需要手写类定义 | Rejected |
| `swift-bridge` crate | High | 生态年轻，不支持异步桥接 | 需要在 Cargo 中集成 Swift 构建 | Rejected |

`Command::new()` + 解析 JSON 的模式已经过验证——Windows 侧的 `NetshBssidScanner` 正是这么做的。子进程边界还把 Apple framework 依赖隔离在 Rust 构建图之外。

### 1.5 SOTA：平台自适应 WiFi 感知

近期研究验证了跨平台、基于 RSSI 的感知：

- **WiFind**（2024）：用异构硬件的 RSSI 向量做跨平台 WiFi 指纹，证明跨扫描 API（dBm、百分比、原始值）做归一化对模型可移植性至关重要。
- **WiGesture**（2025）：基于 RSSI 方差的手势识别，在有 15 个以上 AP 的通用硬件上达到 89% 准确率，说明单凭时序 RSSI 方差就携带了可观的运动信息。
- **CrossSense**（2024）：从 CSI 丰富的硬件向仅有 RSSI 的设备做迁移学习，预训练信号特征以 78% 的有效性完成迁移，印证了分层硬件策略。

---

## 2. 决策

沿用 ADR-022 中已确立的 `NetshBssidScanner` 子进程模式，把 **macOS CoreWLAN 感知适配器**实现为 Swift helper 二进制 + Rust adapter 的组合。真实 RSSI 数据走现有的 8 阶段 `WindowsWifiPipeline`（该流水线只面向 `BssidObservation` 结构，与平台来源无关）。

### 2.1 设计原则

1. **子进程隔离** — Swift 二进制是独立工具，与 Rust workspace 分开构建、独立版本化。
2. **同一套领域类型** — macOS 适配器产出 `Vec<BssidObservation>`，与 Windows 路径完全一致，所有下游处理原样复用。
3. **以 SSID:channel 作为合成 BSSID** — 当真实 BSSID 被屏蔽（无定位服务）时，用 `sha256(ssid + channel)[:12]` 生成稳定的伪 BSSID。已知局限：同 SSID、同信道的 AP 会被合并成一条观测。
4. **`#[cfg(target_os = "macos")]` 门控** — macOS 专用代码只在 macOS 上编译，Windows 与 Linux 构建不受影响。
5. **优雅降级** — 若 Swift helper 不存在或执行失败，`--source auto` 跳过 macOS WiFi 并回退到模拟模式，同时给出明确告警。

---

## 3. 架构

### 3.1 组件总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                     macOS WiFi Sensing Path                         │
│                                                                     │
│  ┌──────────────────────┐     ┌───────────────────────────────────┐│
│  │  Swift Helper Binary  │     │  Rust Adapter + Existing Pipeline ││
│  │  (tools/macos-wifi-   │     │                                   ││
│  │   scan/main.swift)    │     │  MacosCoreWlanScanner             ││
│  │                       │     │       │                           ││
│  │  CWWiFiClient         │JSON │       ▼                           ││
│  │  scanForNetworks()  ──┼────►│  Vec<BssidObservation>            ││
│  │  interface()          │     │       │                           ││
│  │                       │     │       ▼                           ││
│  │  Outputs:             │     │  BssidRegistry                   ││
│  │  - ssid               │     │       │                           ││
│  │  - rssi (dBm)         │     │       ▼                           ││
│  │  - noise (dBm)        │     │  WindowsWifiPipeline (reused)    ││
│  │  - channel            │     │  [8-stage signal intelligence]   ││
│  │  - band (2.4/5/6)     │     │       │                           ││
│  │  - phy_mode           │     │       ▼                           ││
│  │  - bssid (if avail)   │     │  SensingUpdate → REST/WS         ││
│  └──────────────────────┘     └───────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Swift Helper 二进制

**文件：** `v2/tools/macos-wifi-scan/main.swift`

```swift
// 模式：
//   （无参数）    → 完整扫描，向 stdout 输出 JSON 数组
//   --probe      → 快速可用性检查，输出 {"available": true/false}
//   --connected  → 仅输出已连接网络信息
//
// 输出结构（扫描模式）：
// [
//   {
//     "ssid": "MyNetwork",
//     "rssi": -52,
//     "noise": -90,
//     "channel": 36,
//     "band": "5GHz",
//     "phy_mode": "802.11ax",
//     "bssid": "aa:bb:cc:dd:ee:ff" | null,
//     "security": "wpa2_personal"
//   }
// ]
```

**构建：**

```bash
# 需要 Xcode Command Line Tools (xcode-select --install)
cd tools/macos-wifi-scan
swiftc -framework CoreWLAN -framework Foundation -O -o macos-wifi-scan main.swift
```

**构建脚本：** `tools/macos-wifi-scan/build.sh`

### 3.3 Rust 适配器

**文件：** `crates/wifi-densepose-wifiscan/src/adapter/macos_scanner.rs`

```rust
// #[cfg(target_os = "macos")]

pub struct MacosCoreWlanScanner {
    helper_path: PathBuf,  // Resolved at construction: $PATH or sibling of server binary
}

impl MacosCoreWlanScanner {
    pub fn new() -> Result<Self, WifiScanError>  // Finds helper or errors
    pub fn probe() -> bool                        // Runs --probe, returns availability
    pub fn scan_sync(&self) -> Result<Vec<BssidObservation>, WifiScanError>
    pub fn connected_sync(&self) -> Result<Option<BssidObservation>, WifiScanError>
}
```

**关键映射：**

| CoreWLAN 字段 | → | BssidObservation 字段 | 变换 |
|----------------|---|----------------------|-----------|
| `rssi` (dBm) | → | `signal_dbm` | 直接映射（CoreWLAN 给出已校准的 dBm） |
| `rssi` (dBm) | → | `amplitude` | `rssi_to_amplitude()`（已有） |
| `noise` (dBm) | → | `snr` | `rssi - noise`（新增字段，macOS 独有优势） |
| `channel` | → | `channel` | 直接映射 |
| `band` | → | `band` | `BandType::from_channel()`（已有） |
| `phy_mode` | → | `radio_type` | 字符串映射到 `RadioType` 枚举 |
| `bssid` | → | `bssid_id` | 可用则直接映射，否则 `sha256(ssid:channel)[:12]` |
| `ssid` | → | `ssid` | 直接映射 |

### 3.4 感知服务器集成

**文件：** `crates/wifi-densepose-sensing-server/src/main.rs`

| 函数 | 用途 |
|----------|---------|
| `probe_macos_wifi()` | 调用 `MacosCoreWlanScanner::probe()`，返回 bool |
| `macos_wifi_task()` | 异步循环：扫描 → 构建 `BssidObservation` 向量 → 送入 `BssidRegistry` + `WindowsWifiPipeline` → 发出 `SensingUpdate`。结构与 `windows_wifi_task()` 一致。 |

**自动检测顺序（已更新）：**

```
1. ESP32 UDP probe (port 5005)     → --source esp32
2. Windows netsh probe             → --source wifi (Windows)
3. macOS CoreWLAN probe  [NEW]     → --source wifi (macOS)
4. Simulated fallback              → --source simulated
```

### 3.5 流水线复用

现有的 8 阶段 `WindowsWifiPipeline`（ADR-022）完全基于 `BssidObservation` / `MultiApFrame` 类型运行：

| 阶段 | 可复用？ | 说明 |
|-------|-----------|-------|
| 1. Predictive Gating | Yes | 按时间方差过滤静止 AP |
| 2. Attention Weighting | Yes | 按运动敏感度给 AP 加权 |
| 3. Spatial Correlation | Yes | 跨 AP 信号相关性 |
| 4. Motion Estimation | Yes | RSSI 方差 → 运动强度 |
| 5. Breathing Extraction | **Marginal** | 0.3 Hz 扫描速率低于呼吸（0.1-0.5 Hz）的奈奎斯特频率，最多只能检出极慢的呼吸。 |
| 6. Quality Gating | Yes | 丢弃低置信度估计 |
| 7. Fingerprint Matching | Yes | 位置/姿态分类 |
| 8. Orchestration | Yes | 融合所有阶段 |

**限制：** CoreWLAN 扫描速率（约 0.3-0.5 Hz）明显慢于 `netsh`（约 2 Hz），呼吸提取（阶段 5）精度会下降。由于运动与存在检测依赖更长时间窗上的方差，它们仍然有效。

---

## 4. 文件

### 4.1 新增文件

| 文件 | 用途 | 行数（估） |
|------|---------|-------------|
| `tools/macos-wifi-scan/main.swift` | CoreWLAN 扫描器，输出 JSON | ~120 |
| `tools/macos-wifi-scan/build.sh` | 构建脚本（调用 `swiftc`） | ~15 |
| `crates/wifi-densepose-wifiscan/src/adapter/macos_scanner.rs` | Rust adapter：启动 helper、解析 JSON、产出 `BssidObservation` | ~200 |

### 4.2 修改文件

| 文件 | 改动 |
|------|--------|
| `crates/wifi-densepose-wifiscan/src/adapter/mod.rs` | 加入 `#[cfg(target_os = "macos")] pub mod macos_scanner;` 并重新导出 |
| `crates/wifi-densepose-wifiscan/src/lib.rs` | 重新导出 `MacosCoreWlanScanner` |
| `crates/wifi-densepose-sensing-server/src/main.rs` | 加入 `probe_macos_wifi()`、`macos_wifi_task()`，更新自动检测与 `--source wifi` 分发 |

### 4.3 不新增 Rust 依赖

- `std::process::Command` — 启动子进程（标准库）
- `serde_json` — 解析 JSON（workspace 中已有）
- `Cargo.toml` 不作改动

---

## 5. 验证计划

全部验证在 Mac Mini（M2 Pro，macOS 26.3）上进行。

### 5.1 Swift Helper（辅助程序）

| 测试 | 命令 | 预期 |
|------|---------|----------|
| Build | `cd tools/macos-wifi-scan && ./build.sh` | 生成 `macos-wifi-scan` 二进制 |
| Probe | `./macos-wifi-scan --probe` | 返回 `{"available": true}` |
| Scan | `./macos-wifi-scan` | 含真实 SSID、dBm 单位 RSSI 和信道的 JSON 数组 |
| Connected | `./macos-wifi-scan --connected` | 单个已连接网络的 JSON 对象 |
| No WiFi | 关闭 WiFi → `./macos-wifi-scan` | `{"available": false}` 或空数组 |

### 5.2 Rust 适配器

| 测试 | 方法 | 预期 |
|------|--------|----------|
| Unit: JSON parsing | `#[test]`，使用 fixture JSON | 得到正确的 `BssidObservation` 值 |
| Unit: synthetic BSSID | `#[test]`，bssid 输入为 nil | 稳定的 `sha256(ssid:channel)[:12]` |
| Unit: helper not found | `#[test]`，传入错误路径 | `WifiScanError::ProcessError` |
| Integration: real scan | 在 Mac Mini 上 `cargo test` | 来自 CoreWLAN 的实时观测 |

### 5.3 端到端

| 步骤 | 命令 | 验证 |
|------|---------|--------|
| 1 | `cargo build --release`（Mac Mini） | 构建干净，无告警 |
| 2 | `cargo test --workspace` | 既有测试全过，新增 macOS 测试通过 |
| 3 | `./target/release/sensing-server --source wifi` | 服务启动，日志出现 `source: wifi (macOS CoreWLAN)` |
| 4 | `curl http://localhost:8080/api/v1/sensing/latest` | `source: "wifi:<SSID>"`，RSSI 为真实值 |
| 5 | `curl http://localhost:8080/api/v1/vital-signs` | 运动检测能响应实际身体移动 |
| 6 | 打开 `http://localhost:8080` 的 UI | 信号字段随真实 RSSI 波动更新 |
| 7 | `--source auto` | 自动识别 macOS WiFi，不回退到模拟模式 |

### 5.4 跨平台回归

| 平台 | 构建 | 预期 |
|----------|-------|----------|
| macOS（Mac Mini） | `cargo build --release` | macOS adapter 被编译且可用 |
| Windows | `cargo build --release` | macOS adapter 被跳过（`#[cfg]`），Windows 路径不变 |
| Linux | `cargo build --release` | macOS adapter 被跳过，ESP32/模拟路径不变 |

---

## 6. 限制

| 限制 | 影响 | 缓解措施 |
|------------|--------|-----------|
| **BSSID 被屏蔽** | 同 SSID、同信道的 AP 合并成一条观测 | 用 `sha256(ssid:channel)` 作为伪 BSSID，并记录该边界情况。实践中少见（主要出现在 mesh 网络）。 |
| **扫描速率慢**（约 0.3 Hz） | 呼吸提取不可靠（低于奈奎斯特频率） | 运动/存在检测仍可用；呼吸结果标记为低置信度。后续可做缓存 + 已连接 AP 快速轮询的混合方案。 |
| **Swift helper 必须在 PATH 中** | 源码构建多一步 | 已提供 `build.sh`；Docker 镜像预置该二进制；缺失时给出明确报错。 |
| **BSSID 需要定位服务** | 完整 BSSID 需要用户授权弹窗 | 未授权时系统优雅降级到 SSID:channel 伪 BSSID。 |
| **没有 CSI** | 无法达到 ESP32 的姿态估计精度 | 符合预期——这是 RSSI 级感知（存在 + 运动），与 Windows 的限制相同。 |

---

## 7. 后续工作

| 增强项 | 说明 | 依赖 |
|-------------|-------------|-----------|
| **快速轮询已连接 AP** | 通过 `CWInterface.rssiValue()` 以约 10 Hz 轮询已连接 AP 的 RSSI（无需完整扫描） | CoreWLAN `rssiValue()` 性能测试 |
| **Linux `iw` adapter** | 同一子进程模式，改用 `iw dev wlan0 scan` 输出 | 用于测试的 Linux 机器 |
| **统一重命名为 `RssiPipeline`** | 把 `WindowsWifiPipeline` → `RssiPipeline`，体现多平台用途 | 更新 ADR-022 |
| **802.11bf 感知** | Apple 未来可能在 macOS 中通过 802.11bf 开放 CSI | Apple framework 是否可用 |
| **Docker macOS 镜像** | 预构建、内置 Swift helper 的 macOS Docker 镜像 | Docker 多架构构建 |

---

## 8. 参考资料

- [Apple CoreWLAN Documentation](https://developer.apple.com/documentation/corewlan)
- [CWWiFiClient](https://developer.apple.com/documentation/corewlan/cwwificlient) — 主要的 WiFi 接口 API
- [CWNetwork](https://developer.apple.com/documentation/corewlan/cwnetwork) — 扫描结果类型（SSID、RSSI、信道、噪声）
- [macOS 15 airport removal](https://developer.apple.com/forums/thread/732431) — Apple 开发者论坛
- ADR-022：Windows WiFi 保真度增强（同类平台适配器）
- ADR-013：在通用商用设备上做特征级感知
- Issue [#56](https://github.com/ruvnet/wifi-densepose/issues/56)：macOS 支持需求

---

## 修订 1（2026-10-01）：SSID 也被屏蔽；保留已连接链路

**在 macOS 27（M 系列 Mac、CoreWLAN、未签名的 CLI helper）上观察到。** 没有定位服务时，`mac_wifi --scan-once` 返回 `"ssid":""` 与 `"bssid":"00:00:00:00:00:00"`，而 `rssi`、`noise`、`channel`、`tx_rate` 都是真实值。§1 中「SSID + RSSI + channel 会保留」的假设不再成立。未签名的 CLI helper 从不调用 `CLLocationManager`，因此不会出现在定位服务列表里，也就无法被授权。

在这次修订之前，`resolve_bssid` 在两个身份字段都为空时会放弃解析（以免把无关网络合并），于是每次 macOS 扫描都被丢弃，`--source wifi` 什么都不产出，而且没有任何报错。

**变更。**
1. `--scan-once` 给它那唯一一条样本打上 `"connected": true`。它始终对应已连接的那条链路，因此不可能与其他网络冲突。
2. 标记为 `connected` 的被屏蔽样本，会由一段保留关键字加上信道推导出稳定的、本地管理的合成 BSSID。SSID 保持为空，不会凭空编造。未标记的被屏蔽行仍然放弃解析。
3. 解析到宿主机 WiFi 的 `--source auto` 现在也会绑定 UDP 接收器，且当 source 是活跃的 `esp32` 时 `wifi_task` 会让出。在 2 秒启动探测之后才上线的 ESP32 节点仍能把 source 提升上来，与模拟器的 #1004 规则一致。
4. helper 缺失时只记录一条带构建命令的清晰错误，而不是每个 tick 都刷一条告警。

**实测（2026-10-01，本次改动）：** `--source wifi` → source 为 `wifi:unnamed`，感知 tick 持续推进。安静端口上的 `--source auto` → `wifi` 且 `udp_receiver=true`；转发真实的 ADR-018 帧后 source 提升为 `esp32`，5 个节点全部列出。

**仍未解决：** 要拿到真实 BSSID/SSID，需要一个带 `NSLocationWhenInUseUsageDescription`、会主动请求授权的已签名 `.app` helper。该 helper 仍留在 `archive/v1` 下，没有构建步骤。

