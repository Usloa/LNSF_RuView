# ADR-022：通过 RuVector 多 BSSID 流水线提升 Windows WiFi DensePose 保真度

| 字段 | 值 |
|-------|-------|
| **状态** | Partially Implemented |
| **日期** | 2026-02-28 |
| **决策者** | ruv |
| **关联** | ADR-013（在通用商用设备上做特征级感知）、ADR-014（SOTA 信号处理）、ADR-016（RuVector 集成）、ADR-018（ESP32 开发实现）、ADR-021（生命体征检测） |

---

## 1. 背景

### 1.1 问题：单 RSSI 瓶颈

当前 `wifi-densepose-sensing-server` 的 Windows WiFi 模式（`:main.rs:382-464`）每 500ms 启动一次 `netsh wlan show interfaces` 子进程，从已连接的 AP 中只提取一个 RSSI% 值。由此构造出的 `Esp32Frame` 是伪单子载波帧，其内容为：

- **1 个幅度值**（signal%）
- **0 相位信息**
- **约 2 Hz 有效采样率**（进程启动开销所致）
- **无空间分集**（单一观测点）

这不足以支撑任何有意义的 DensePose 估计。ESP32 路径提供 56 个子载波、100+ Hz 的 I/Q 数据，而 Windows 路径只有 2 Hz 下的 1 个标量——**数据量相差 2,800 倍**。

### 1.2 机会：多 BSSID 空间分集

标准的 Windows WiFi 环境通过 `netsh wlan show networks mode=bssid` 可暴露 **10-30+ 个 BSSID**。在目标机器（Intel Wi-Fi 7 BE201 320MHz）上实测如下：

| 属性 | 值 |
|----------|-------|
| 适配器 | Intel Wi-Fi 7 BE201 320MHz (NDIS 6.89) |
| 可见 BSSID 数 | 23 |
| 频段 | 2.4 GHz（信道 3,5,8,11）、5 GHz（信道 36,48） |
| 无线制式 | 802.11n、802.11ac、802.11ax |
| 信号范围 | 18% 至 99% |

每个 BSSID 在环境中经过不同的物理路径。人体对各条路径的反射、吸收、衍射，取决于 AP 的相对位置、频率与信道，因而各不相同。这就形成了**等效于伪子载波的空间分集**。

### 1.3 增强方案：三级保真度提升

| 层级 | 方法 | 子载波数 | 采样率 | 实现方式 |
|------|--------|-------------|-------------|----------------|
| **现状** | `netsh show interfaces` | 1 | ~2 Hz | 启动子进程 |
| **Tier 1** | `netsh show networks mode=bssid` | 23 | ~2 Hz | 解析多 BSSID 输出 |
| **Tier 2** | Windows WLAN API（`wlanapi.dll` FFI） | 23 | 10-20 Hz | 原生 FFI，无子进程 |
| **Tier 3** | Intel Wi-Fi Sensing SDK (802.11bf) | 56+ | 100 Hz | 厂商 SDK 集成 |

本 ADR 覆盖 Tier 1 与 Tier 2。Tier 3 需等待 Intel SDK 接入，留待后续 ADR。

### 1.4 RuVector 能提供什么

`vendor/ruvector` crate 生态提供了信号处理原语，可把多 BSSID 的 RSSI 向量转换为有意义的感知数据：

| RuVector 原语 | 在 Windows WiFi 增强中的作用 |
|---|---|
| `PredictiveLayer` (nervous-system) | 抑制静态 BSSID（与人体无交互），只传输残差变化。23 个 BSSID 中通常 80-95% 是静态的。 |
| `ScaledDotProductAttention` (attention) | 学习每个环境中哪些 BSSID 对人体最敏感。注意力 query = 人体运动频谱剖面，keys = 各 BSSID 方差剖面。 |
| `RuvectorLayer` (gnn) | 在 BSSID 之上构建互相关图。节点 = BSSID，边 = 时间互相关。消息传递可识别受同一人影响的 BSSID 簇。 |
| `OscillatoryRouter` (nervous-system) | 从多 BSSID 方差中分离出呼吸频带（0.1-0.5 Hz）振荡，用于粗粒度呼吸感知。 |
| `ModernHopfield` (nervous-system) | 对 BSSID 指纹模式做模板匹配（站立、坐姿、行走、空房间）。 |
| `SpectralCoherenceScore` (coherence) | 度量 BSSID 相关图的谱间隙；间隙越大，信号分离越好。 |
| `TieredStore` (temporal-tensor) | 以自适应量化（8/5/3-bit 分层）存储多 BSSID 时间序列。 |
| `AdaptiveThresholds` (ruQu) | 借助 Welford 统计、EMA 与结果反馈学习，自整定存在/运动阈值。 |
| `DriftDetector` (ruQu) | 检测环境变化（AP 断电重启、家具移动、新增干扰源）。5 种漂移剖面：Stable、Linear、StepChange、Oscillating、VarianceExpansion。 |
| `FilterPipeline` (ruQu) | 用三滤波器门控（Structural/Shift/Evidence）评估信号质量，只对具备统计严格置信度的读数给出 PERMIT。 |
| `SonaEngine` (sona) | 按部署环境对 BSSID 权重与滤波器参数做 micro-LoRA 自适应。 |

---

## 2. 决策

在 `wifi-densepose-sensing-server` crate 中新增一个模块（部分放在新的 `wifi-densepose-wifiscan` crate 里），实现**增强版 Windows WiFi 感知流水线**，采用领域驱动设计与限界上下文。该流水线扫描所有可见 BSSID，构造多维伪 CSI 帧，再送入 RuVector 信号流水线处理，从而达成可媲美 ESP32 的存在/运动检测与粗粒度生命体征估计。

### 2.1 核心设计原则

1. **多 BSSID 视作伪子载波**：每个可见 BSSID 映射到既有 `Esp32Frame` 结构中的一个子载波槽位，从而复用全部下游信号处理。
2. **渐进式增强**：Tier 1（netsh 解析）先行交付，零新增依赖；Tier 2（wlanapi FFI）在 feature 开关之后加入 `windows-sys`。
3. **优雅降级**：当可见 BSSID 过少（<5）时，系统回退到单 AP RSSI 模式，并降低置信度分数。
4. **环境学习**：SONA 通过 micro-LoRA 按部署环境调整 BSSID 权重与阈值，结果存于 `TieredStore`。
5. **API 面不变**：输出仍是标准 `SensingUpdate` 消息，对 UI 而言与 ESP32 模式无从区分。

---

## 3. 架构（领域驱动设计）

### 3.1 战略设计：限界上下文

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WiFi DensePose Windows Enhancement                       │
│                                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │  BSSID Acquisition   │  │  Signal Intelligence  │  │  Sensing Output   │  │
│  │  (Supporting Domain) │  │  (Core Domain)        │  │  (Generic Domain) │  │
│  │                      │  │                       │  │                   │  │
│  │  • WlanScanner       │  │  • BssidAttention     │  │  • FrameBuilder   │  │
│  │  • BssidRegistry     │  │  • SpatialCorrelator  │  │  • UpdateEmitter  │  │
│  │  • ScanScheduler     │  │  • MotionEstimator    │  │  • QualityGate    │  │
│  │  • RssiNormalizer    │  │  • BreathingExtractor │  │  • HistoryStore   │  │
│  │                      │  │  • DriftMonitor       │  │                   │  │
│  │  Port: WlanScanPort  │  │  • EnvironmentAdapter │  │  Port: SinkPort   │  │
│  │  Adapter: NetshScan  │  │                       │  │  Adapter: WsSink  │  │
│  │  Adapter: WlanApiScan│  │  Port: SignalPort     │  │  Adapter: RestSink│  │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────┘  │
│             │                        │                        │             │
│             │    Anti-Corruption     │    Anti-Corruption     │             │
│             │    Layer (ACL)         │    Layer (ACL)         │             │
│             └────────────────────────┘────────────────────────┘             │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Shared Kernel                                                       │   │
│  │  • BssidId, RssiDbm, SignalPercent, ChannelInfo, BandType            │   │
│  │  • Esp32Frame (reused as universal frame type)                       │   │
│  │  • SensingUpdate, FeatureInfo, ClassificationInfo                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 战术设计：聚合与实体

#### 限界上下文 1：BSSID 采集（支撑域）

**聚合根：`BssidRegistry`**

跨扫描跟踪所有可见 BSSID，维持身份稳定性（BSSID 会随 AP 信标出现/消失）。

```rust
/// 值对象：唯一的 BSSID 标识符
#[derive(Clone, Hash, Eq, PartialEq)]
pub struct BssidId(pub [u8; 6]); // MAC address

/// 值对象：单次 BSSID 观测
#[derive(Clone, Debug)]
pub struct BssidObservation {
    pub bssid: BssidId,
    pub rssi_dbm: f64,
    pub signal_pct: f64,
    pub channel: u8,
    pub band: BandType,
    pub radio_type: RadioType,
    pub ssid: String,
    pub timestamp: std::time::Instant,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BandType { Band2_4GHz, Band5GHz, Band6GHz }

#[derive(Clone, Debug, PartialEq)]
pub enum RadioType { N, Ac, Ax, Be }

/// 聚合根：跟踪所有可见 BSSID
pub struct BssidRegistry {
    /// 已知 BSSID，带观测滑动窗口
    entries: HashMap<BssidId, BssidEntry>,
    /// 有序的 BSSID ID 列表，保证子载波映射一致
    /// （按首次出现时间排序以保持稳定）
    subcarrier_map: Vec<BssidId>,
    /// 最大跟踪 BSSID 数（对应最大子载波数）
    max_bssids: usize,
}

/// 实体：带历史记录的已跟踪 BSSID
pub struct BssidEntry {
    pub id: BssidId,
    pub meta: BssidMeta,
    /// 近期 RSSI 观测的环形缓冲区
    pub history: RingBuffer<f64>,
    /// Welford 在线统计（均值、方差）
    pub stats: RunningStats,
    /// 最后一次出现的时间戳（用于过期判定）
    pub last_seen: std::time::Instant,
    /// 在伪帧中的子载波索引（未映射时为 -1）
    pub subcarrier_idx: Option<usize>,
}
```

**端口：`WlanScanPort`**（六边形架构）

```rust
/// 端口：抽象 WiFi 扫描后端
#[async_trait::async_trait]
pub trait WlanScanPort: Send + Sync {
    /// 执行一次扫描并返回所有可见 BSSID
    async fn scan(&self) -> Result<Vec<BssidObservation>>;
    /// 获取已连接的 BSSID（若有）
    async fn connected(&self) -> Option<BssidObservation>;
    /// 触发主动扫描（可能不被支持）
    async fn trigger_active_scan(&self) -> Result<()>;
}
```

**适配器 1：`NetshBssidScanner`**（Tier 1）

```rust
/// Tier 1 适配器：解析 `netsh wlan show networks mode=bssid`
pub struct NetshBssidScanner;

#[async_trait::async_trait]
impl WlanScanPort for NetshBssidScanner {
    async fn scan(&self) -> Result<Vec<BssidObservation>> {
        let output = tokio::process::Command::new("netsh")
            .args(["wlan", "show", "networks", "mode=bssid"])
            .output()
            .await?;
        let text = String::from_utf8_lossy(&output.stdout);
        parse_bssid_scan_output(&text)
    }
    // ...
}

/// 把多 BSSID 的 netsh 输出解析为结构化观测
fn parse_bssid_scan_output(output: &str) -> Result<Vec<BssidObservation>> {
    // 解析形如下列内容的块：
    //   SSID 1 : MyNetwork
    //     BSSID 1 : aa:bb:cc:dd:ee:ff
    //          Signal  : 84%
    //          Radio type : 802.11ax
    //          Band    : 2.4 GHz
    //          Channel : 5
    // 返回字段全部填充的 Vec<BssidObservation>
    todo!()
}
```

**适配器 2：`WlanApiBssidScanner`**（Tier 2，由 feature 开关控制）

```rust
/// Tier 2 适配器：经 FFI 使用 wlanapi.dll，实现 10-20 Hz 轮询
#[cfg(all(target_os = "windows", feature = "wlanapi"))]
pub struct WlanApiBssidScanner {
    handle: WlanHandle,
    interface_guid: GUID,
}

#[cfg(all(target_os = "windows", feature = "wlanapi"))]
#[async_trait::async_trait]
impl WlanScanPort for WlanApiBssidScanner {
    async fn scan(&self) -> Result<Vec<BssidObservation>> {
        // WlanGetNetworkBssList 返回 WLAN_BSS_LIST，每个 BSSID 含：
        //   - RSSI 读数 (i32, dBm)
        //   - 链路质量 (u32, 0-100)
        //   - 信道（来自 PHY）
        //   - BSS 类型、信标周期、IE
        // 比 netsh 快得多（每次调用 ~5ms 对比 ~200ms）
        let bss_list = unsafe {
            wlanapi::WlanGetNetworkBssList(
                self.handle.0,
                &self.interface_guid,
                std::ptr::null(),
                wlanapi::dot11_BSS_type_any,
                0, // security disabled
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        // ……把 WLAN_BSS_ENTRY 结构解析为 BssidObservation
        todo!()
    }

    async fn trigger_active_scan(&self) -> Result<()> {
        // WlanScan 触发一次新扫描；结果异步返回
        unsafe { wlanapi::WlanScan(self.handle.0, &self.interface_guid, ...) };
        Ok(())
    }
}
```

**领域服务：`ScanScheduler`**

```rust
/// 协调扫描时序与 BSSID 注册表更新
pub struct ScanScheduler {
    scanner: Box<dyn WlanScanPort>,
    registry: BssidRegistry,
    /// 扫描间隔（Tier 1：500ms，Tier 2：50-100ms）
    interval: Duration,
    /// 依据运动检测结果自适应调整扫描速率
    adaptive_rate: bool,
}

impl ScanScheduler {
    /// 运行持续扫描循环并更新注册表
    pub async fn run(&mut self, frame_tx: mpsc::Sender<MultiApFrame>) {
        let mut ticker = tokio::time::interval(self.interval);
        loop {
            ticker.tick().await;
            match self.scanner.scan().await {
                Ok(observations) => {
                    self.registry.update(&observations);
                    let frame = self.registry.to_pseudo_frame();
                    let _ = frame_tx.send(frame).await;
                }
                Err(e) => tracing::warn!("Scan failed: {e}"),
            }
        }
    }
}
```

#### 限界上下文 2：信号智能（核心域）

这里把 RuVector 原语组合成一条感知流水线。

**领域服务：`WindowsWifiPipeline`**

```rust
/// 把多 BSSID 扫描转换为感知数据的核心流水线
pub struct WindowsWifiPipeline {
    // ── Stage 1: Predictive Gating ──
    /// 抑制静态 BSSID（与人体无交互）
    /// ruvector-nervous-system::routing::PredictiveLayer
    predictive: PredictiveLayer,

    // ── Stage 2: Attention Weighting ──
    /// 学习各环境下 BSSID 对人体的敏感度
    /// ruvector-attention::ScaledDotProductAttention
    attention: ScaledDotProductAttention,

    // ── Stage 3: Spatial Correlation ──
    /// 在 BSSID 之上构建互相关图
    /// ruvector-gnn::RuvectorLayer（节点=BSSID，边=相关性）
    correlator: BssidCorrelator,

    // ── Stage 4: Motion/Presence Estimation ──
    /// 带逐 AP 权重的多 BSSID 运动评分
    motion_estimator: MultiApMotionEstimator,

    // ── Stage 5: Coarse Vital Signs ──
    /// 从对人体敏感的 BSSID 振荡中提取呼吸
    /// ruvector-nervous-system::routing::OscillatoryRouter
    breathing: CoarseBreathingExtractor,

    // ── Stage 6: Quality Gate ──
    /// ruQu 三滤波器流水线 + 自适应阈值
    quality_gate: VitalCoherenceGate,

    // ── Stage 7: Fingerprint Matching ──
    /// 用于姿态分类的 Hopfield 模板匹配
    /// ruvector-nervous-system::hopfield::ModernHopfield
    fingerprint: BssidFingerprintMatcher,

    // ── Stage 8: Environment Adaptation ──
    /// 按部署环境做 SONA micro-LoRA
    /// sona::SonaEngine
    adapter: SonaEnvironmentAdapter,

    // ── Stage 9: Drift Monitoring ──
    /// 按 BSSID 基线做 ruQu 漂移检测
    drift: Vec<DriftDetector>,

    // ── Storage ──
    /// BSSID 时间序列的分层存储
    /// ruvector-temporal-tensor::TieredStore
    store: TieredStore,

    config: WindowsWifiConfig,
}
```

**值对象：`WindowsWifiConfig`**

```rust
pub struct WindowsWifiConfig {
    /// 最大跟踪 BSSID 数（默认：32）
    pub max_bssids: usize,
    /// Tier 1 扫描间隔（默认：500ms）
    pub tier1_interval_ms: u64,
    /// Tier 2 扫描间隔（默认：50ms）
    pub tier2_interval_ms: u64,
    /// PredictiveLayer 残差阈值（默认：0.05）
    pub predictive_threshold: f32,
    /// 启用多 AP 模式所需的最小 BSSID 数（默认：3）
    pub min_bssids: usize,
    /// 无观测多久后令 BSSID 过期（默认：30s）
    pub bssid_expiry_secs: u64,
    /// 启用粗粒度呼吸提取（默认：true）
    pub enable_breathing: bool,
    /// 启用指纹匹配（默认：true）
    pub enable_fingerprint: bool,
    /// 启用 SONA 自适应（默认：true）
    pub enable_adaptation: bool,
    /// 呼吸频带（Hz）——因采样率低而放宽
    pub breathing_band: (f64, f64),
    /// 存在检测所用的运动方差阈值
    pub motion_threshold: f64,
}

impl Default for WindowsWifiConfig {
    fn default() -> Self {
        Self {
            max_bssids: 32,
            tier1_interval_ms: 500,
            tier2_interval_ms: 50,
            predictive_threshold: 0.05,
            min_bssids: 3,
            bssid_expiry_secs: 30,
            enable_breathing: true,
            enable_fingerprint: true,
            enable_adaptation: true,
            breathing_band: (0.1, 0.5),
            motion_threshold: 0.15,
        }
    }
}
```

**领域服务：逐阶段处理**

```rust
impl WindowsWifiPipeline {
    pub fn process(&mut self, frame: &MultiApFrame) -> Option<EnhancedSensingResult> {
        let n = frame.bssid_count;
        if n < self.config.min_bssids {
            return None; // Too few BSSIDs, degrade to legacy
        }

        // ── Stage 1: Predictive Gating ──
        // 把 RSSI dBm 转换为线性幅度，供 PredictiveLayer 使用
        let amplitudes: Vec<f32> = frame.rssi_dbm.iter()
            .map(|&r| 10.0f32.powf((r as f32 + 100.0) / 20.0))
            .collect();

        let has_change = self.predictive.should_transmit(&amplitudes);
        self.predictive.update(&amplitudes);
        if !has_change {
            return None; // Environment static, no body present
        }

        // ── Stage 2: Attention Weighting ──
        // Query：各 BSSID 呼吸频带的方差剖面
        // Key：各 BSSID 当前的 RSSI 方差
        // Value：幅度向量
        let query = self.compute_breathing_variance_query(frame);
        let keys = self.compute_bssid_variance_keys(frame);
        let key_refs: Vec<&[f32]> = keys.iter().map(|k| k.as_slice()).collect();
        let val_refs: Vec<&[f32]> = amplitudes.chunks(1).collect(); // per-BSSID
        let weights = self.attention.compute(&query, &key_refs, &val_refs);

        // ── Stage 3: Spatial Correlation ──
        // 构建相关图：edge(i,j) = pearson_r(bssid_i, bssid_j)
        let correlation_features = self.correlator.forward(&frame.histories);

        // ── Stage 4: Motion Estimation ──
        let motion = self.motion_estimator.estimate(
            &weights,
            &correlation_features,
            &frame.per_bssid_variance,
        );

        // ── Stage 5: Coarse Breathing ──
        let breathing = if self.config.enable_breathing && motion.level == MotionLevel::Minimal {
            self.breathing.extract_from_weighted_bssids(
                &weights,
                &frame.histories,
                frame.sample_rate_hz,
            )
        } else {
            None
        };

        // ── Stage 6: Quality Gate (ruQu) ──
        let reading = PreliminaryReading {
            motion,
            breathing,
            signal_quality: self.compute_signal_quality(n, &weights),
        };
        let verdict = self.quality_gate.gate(&reading);
        if matches!(verdict, Verdict::Deny) {
            return None;
        }

        // ── Stage 7: Fingerprint Matching ──
        let posture = if self.config.enable_fingerprint {
            self.fingerprint.classify(&amplitudes)
        } else {
            None
        };

        // ── Stage 8: Environment Adaptation ──
        if self.config.enable_adaptation {
            self.adapter.end_trajectory(reading.signal_quality);
        }

        // ── Stage 9: Drift Monitoring ──
        for (i, drift) in self.drift.iter_mut().enumerate() {
            if i < n {
                drift.push(frame.rssi_dbm[i]);
            }
        }

        // ── Stage 10: Store ──
        let tick = frame.sequence as u64;
        self.store.put(
            ruvector_temporal_tensor::BlockKey::new(0, tick),
            &amplitudes,
            ruvector_temporal_tensor::Tier::Hot,
            tick,
        );

        Some(EnhancedSensingResult {
            motion,
            breathing,
            posture,
            signal_quality: reading.signal_quality,
            bssid_count: n,
            verdict,
        })
    }
}
```

#### 限界上下文 3：感知输出（通用域）

**领域服务：`FrameBuilder`**

把 `EnhancedSensingResult` 转换为既有的 `SensingUpdate` 与 `Esp32Frame` 类型，以保持兼容。

```rust
/// 把多 BSSID 扫描转换为 Esp32Frame，供下游兼容使用
pub struct FrameBuilder;

impl FrameBuilder {
    pub fn to_esp32_frame(
        registry: &BssidRegistry,
        observations: &[BssidObservation],
    ) -> Esp32Frame {
        let subcarrier_map = registry.subcarrier_map();
        let n_sub = subcarrier_map.len();

        let mut amplitudes = vec![0.0f64; n_sub];
        let mut phases = vec![0.0f64; n_sub];

        for obs in observations {
            if let Some(idx) = registry.subcarrier_index(&obs.bssid) {
                // 把 RSSI dBm 转换为线性幅度
                amplitudes[idx] = 10.0f64.powf((obs.rssi_dbm + 100.0) / 20.0);
                // 相位：把信道编码为伪相位（供下游
                // 需要相位数据的工具使用）
                phases[idx] = (obs.channel as f64 / 48.0) * std::f64::consts::PI;
            }
        }

        Esp32Frame {
            magic: 0xC511_0002, // New magic for multi-BSSID frames
            node_id: 0,
            n_antennas: 1,
            n_subcarriers: n_sub as u8,
            freq_mhz: 2437, // Mixed; could use median
            sequence: 0,     // Set by caller
            rssi: observations.iter()
                .map(|o| o.rssi_dbm as i8)
                .max()
                .unwrap_or(-90),
            noise_floor: -95,
            amplitudes,
            phases,
        }
    }

    pub fn to_sensing_update(
        result: &EnhancedSensingResult,
        frame: &Esp32Frame,
        registry: &BssidRegistry,
        tick: u64,
    ) -> SensingUpdate {
        let nodes: Vec<NodeInfo> = registry.subcarrier_map().iter()
            .filter_map(|bssid| registry.get(bssid))
            .enumerate()
            .map(|(i, entry)| NodeInfo {
                node_id: i as u8,
                rssi_dbm: entry.stats.mean,
                position: estimate_ap_position(entry),
                amplitude: vec![frame.amplitudes.get(i).copied().unwrap_or(0.0)],
                subcarrier_count: 1,
            })
            .collect();

        SensingUpdate {
            msg_type: "sensing_update".to_string(),
            timestamp: chrono::Utc::now().timestamp_millis() as f64 / 1000.0,
            source: format!("wifi:multi-bssid:{}", result.bssid_count),
            tick,
            nodes,
            features: result.to_feature_info(),
            classification: result.to_classification_info(),
            signal_field: generate_enhanced_signal_field(result, tick),
        }
    }
}
```

### 3.3 模块结构

```
v2/crates/wifi-densepose-wifiscan/
├── Cargo.toml
└── src/
    ├── lib.rs                    # Public API, re-exports
    ├── domain/
    │   ├── mod.rs
    │   ├── bssid.rs              # BssidId, BssidObservation, BandType, RadioType
    │   ├── registry.rs           # BssidRegistry aggregate, BssidEntry entity
    │   ├── frame.rs              # MultiApFrame value object
    │   └── result.rs             # EnhancedSensingResult, PreliminaryReading
    ├── port/
    │   ├── mod.rs
    │   ├── scan_port.rs          # WlanScanPort trait
    │   └── sink_port.rs          # SensingOutputPort trait
    ├── adapter/
    │   ├── mod.rs
    │   ├── netsh_scanner.rs      # NetshBssidScanner (Tier 1)
    │   ├── wlanapi_scanner.rs    # WlanApiBssidScanner (Tier 2, feature-gated)
    │   └── frame_builder.rs     # FrameBuilder (to Esp32Frame / SensingUpdate)
    ├── pipeline/
    │   ├── mod.rs
    │   ├── config.rs             # WindowsWifiConfig
    │   ├── predictive_gate.rs    # PredictiveLayer wrapper for multi-BSSID
    │   ├── attention_weight.rs   # AttentionSubcarrierWeighter for BSSIDs
    │   ├── spatial_correlator.rs # GNN-based BSSID correlation
    │   ├── motion_estimator.rs   # Multi-AP motion/presence estimation
    │   ├── breathing.rs          # CoarseBreathingExtractor
    │   ├── quality_gate.rs       # ruQu VitalCoherenceGate
    │   ├── fingerprint.rs        # ModernHopfield posture fingerprinting
    │   ├── drift_monitor.rs      # Per-BSSID DriftDetector
    │   ├── embedding.rs          # BssidEmbedding (SONA micro-LoRA per-BSSID)
    │   └── pipeline.rs           # WindowsWifiPipeline orchestrator
    ├── application/
    │   ├── mod.rs
    │   └── scan_scheduler.rs     # ScanScheduler service
    └── error.rs                  # WifiScanError type
```

### 3.4 Cargo.toml 依赖

```toml
[package]
name = "wifi-densepose-wifiscan"
version = "0.1.0"
edition = "2021"

[features]
default = []
wlanapi = ["windows-sys"]  # Tier 2: native WLAN API
full = ["wlanapi"]

[dependencies]
# 内部依赖
wifi-densepose-signal = { path = "../wifi-densepose-signal" }

# RuVector（vendored）
ruvector-nervous-system = { path = "../../../../vendor/ruvector/crates/ruvector-nervous-system" }
ruvector-attention = { path = "../../../../vendor/ruvector/crates/ruvector-attention" }
ruvector-gnn = { path = "../../../../vendor/ruvector/crates/ruvector-gnn" }
ruvector-coherence = { path = "../../../../vendor/ruvector/crates/ruvector-coherence" }
ruvector-temporal-tensor = { path = "../../../../vendor/ruvector/crates/ruvector-temporal-tensor" }
ruvector-core = { path = "../../../../vendor/ruvector/crates/ruvector-core" }
ruqu = { path = "../../../../vendor/ruvector/crates/ruQu" }
sona = { path = "../../../../vendor/ruvector/crates/sona" }

# 异步运行时
tokio = { workspace = true }
async-trait = "0.1"

# 序列化
serde = { workspace = true }
serde_json = { workspace = true }

# 日志
tracing = { workspace = true }

# 时间
chrono = "0.4"

# Windows 原生 API（Tier 2，可选）
[target.'cfg(target_os = "windows")'.dependencies]
windows-sys = { version = "0.52", features = [
    "Win32_NetworkManagement_WiFi",
    "Win32_Foundation",
], optional = true }
```

---

## 4. 信号处理流水线细节

### 4.1 BSSID 到子载波的映射

```
Visible BSSIDs (23):
┌──────────────────┬─────┬──────┬──────┬─────────┐
│ BSSID (MAC)      │ Ch  │ Band │ RSSI │ SubIdx  │
├──────────────────┼─────┼──────┼──────┼─────────┤
│ a6:aa:c3:52:1b:28│  11 │ 2.4G │ -2dBm│    0    │
│ 82:cd:d6:d6:c3:f5│   8 │ 2.4G │ -1dBm│    1    │
│ 16:0a:c5:39:e3:5d│   5 │ 2.4G │-16dBm│    2    │
│ 16:27:f5:b2:6b:ae│   8 │ 2.4G │-17dBm│    3    │
│ 10:27:f5:b2:6b:ae│   8 │ 2.4G │-22dBm│    4    │
│ c8:9e:43:47:a1:3f│   3 │ 2.4G │-40dBm│    5    │
│ 90:aa:c3:52:1b:28│  11 │ 2.4G │ -2dBm│    6    │
│ ...              │ ... │ ...  │  ... │   ...   │
│ 92:aa:c3:52:1b:20│  36 │  5G  │ -6dBm│   20    │
│ c8:9e:43:47:a1:40│  48 │  5G  │-78dBm│   21    │
│ ce:9e:43:47:a1:40│  48 │  5G  │-82dBm│   22    │
└──────────────────┴─────┴──────┴──────┴─────────┘

Mapping rule: sorted by first-seen time (stable ordering).
New BSSIDs get the next available subcarrier index.
BSSIDs not seen for >30s are expired and their index recycled.
```

### 4.2 空间分集：为何多 BSSID 有效

```
                ┌────[AP1: ch3]
                │      │
        body    │      │ path A (partially blocked)
        ┌───┐  │      │
        │   │──┤      ▼
        │ P │  │   ┌──────────┐
        │   │──┤   │  WiFi    │
        └───┘  │   │  Adapter │
               │   │ (BE201)  │
        ┌──────┤   └──────────┘
        │      │      ▲
  [AP2: ch11]  │      │ path B (unobstructed)
               │      │
               └────[AP3: ch36]
                       │ path C (reflected off wall)

Person P attenuates path A by 3-8 dB, while paths B and C
are unaffected. This differential is the multi-BSSID body signal.

At different body positions/orientations, different AP combinations
show attenuation → spatial diversity ≈ pseudo-subcarrier diversity.
```

### 4.3 RSSI 到幅度的转换

```rust
/// 把 RSSI dBm 转换为线性幅度（归一化）
/// RSSI 范围：-100 dBm（噪声）到 -20 dBm（极强）
fn rssi_to_linear(rssi_dbm: f64) -> f64 {
    // 把 -100..0 dBm 映射到 0..1 线性刻度
    // 采用 10^((rssi+100)/20) 得到对数刻度的幅度
    10.0f64.powf((rssi_dbm + 100.0) / 20.0)
}

/// 把线性幅度转换回 dBm
fn linear_to_rssi(amplitude: f64) -> f64 {
    20.0 * amplitude.max(1e-10).log10() - 100.0
}
```

### 4.4 伪相位编码

由于 RSSI 不提供相位信息，我们把信道与频段编码成伪相位，供下游工具使用：

```rust
/// 把 BSSID 的信道/频段编码为伪相位
/// 这样可为 GNN 相关器保留频段分组身份
fn encode_pseudo_phase(channel: u8, band: BandType) -> f64 {
    let band_offset = match band {
        BandType::Band2_4GHz => 0.0,
        BandType::Band5GHz => std::f64::consts::PI,
        BandType::Band6GHz => std::f64::consts::FRAC_PI_2,
    };
    // 在每个频段内把信道铺开到 [0, PI)
    let ch_phase = (channel as f64 / 48.0) * std::f64::consts::FRAC_PI_2;
    band_offset + ch_phase
}
```

---

## 5. RuVector 集成映射

### 5.1 Crate 到阶段的映射

| 流水线阶段 | RuVector Crate | 具体类型 | 用途 |
|---|---|---|---|
| 预测门控 | `ruvector-nervous-system` | `PredictiveLayer` | RMS 残差门控（阈值 0.05）；抑制没有人体引起变化的扫描 |
| 注意力加权 | `ruvector-attention` | `ScaledDotProductAttention` | Query=呼吸方差剖面，Key=各 BSSID 方差，Value=幅度；输出逐 BSSID 重要性权重 |
| 空间相关器 | `ruvector-gnn` | `RuvectorLayer` + `LayerNorm` | 基于 BSSID 的相关图；单层消息传递即可识别协同变化的 BSSID 簇 |
| 呼吸提取 | `ruvector-nervous-system` | `OscillatoryRouter` | 0.15 Hz 振荡器相位锁定到加权 BSSID 方差中最强的呼吸分量 |
| 指纹匹配 | `ruvector-nervous-system` | `ModernHopfield` | 存储 4 个模板：空房间、站立、坐姿、行走；具备指数级容量检索 |
| 信号质量 | `ruvector-coherence` | `SpectralCoherenceScore` | BSSID 相关图的谱间隙；间隙越大，人体信号越干净 |
| 质量门控 | `ruQu` | `FilterPipeline` + `AdaptiveThresholds` | 三滤波器 PERMIT/DENY/DEFER；用 Welford/EMA 自整定阈值 |
| 漂移监控 | `ruQu` | `DriftDetector` | 逐 BSSID 基线跟踪；5 种剖面（Stable/Linear/StepChange/Oscillating/VarianceExpansion） |
| 环境自适应 | `sona` | `SonaEngine` | 按部署环境对注意力权重与滤波器参数做 micro-LoRA 自适应 |
| 分层存储 | `ruvector-temporal-tensor` | `TieredStore` | 8-bit 热 / 5-bit 温 / 3-bit 冷；23 BSSIDs × 1024 samples ≈ 24 KB 热数据 |
| 模式检索 | `ruvector-core` | `VectorDB` (HNSW) | BSSID 指纹最近邻查询（1000 个模板 <1ms） |

### 5.2 数据量估算

| 指标 | Tier 1 (netsh) | Tier 2 (wlanapi) |
|---|---|---|
| 每次扫描的 BSSID 数 | 23 | 23 |
| 扫描速率 | 2 Hz | 20 Hz |
| 每秒样本数 | 46 | 460 |
| 每秒字节数（原始） | 184 B | 1,840 B |
| 环形缓冲区内存（1024 samples × 23 BSSIDs × 8 bytes） | 188 KB | 188 KB |
| PredictiveLayer 节省量 | 抑制 80-95% | 抑制 90-99% |
| 净处理速率 | 2-9 帧/秒 | 2-46 帧/秒 |

---

## 6. 预期保真度提升

### 6.1 量化目标

| 指标 | 现状（1 个 RSSI） | Tier 1（多 BSSID） | Tier 2（+ 原生 API） |
|---|---|---|---|
| 存在检测准确率 | ~70%（阈值法） | ~88%（多 AP 注意力） | ~93%（时间 + 空间） |
| 存在检测时延 | 500ms | 500ms | 50ms |
| 运动等级分类 | 2 级 | 4 级（静止/轻微/中等/剧烈） | 4 级 + 方向 |
| 房间级定位 | 无 | 粗粒度（最近 AP 簇） | 中等（3 AP 三边定位） |
| 呼吸率检测 | 无 | 勉强（置信度 0.3） | 尚可（置信度 0.5-0.6） |
| 心率检测 | 无 | 无 | 无（心率需要 CSI） |
| 姿态分类 | 无 | 4 类（空房间/站立/坐姿/行走） | 4 类 + 置信度 |
| 环境漂移韧性 | 无 | 良好（ruQu 自适应） | 良好（+ SONA 自适应） |

### 6.2 置信度分数校准

```rust
/// 信号质量随 BSSID 数量与方差分布而变
fn compute_signal_quality(
    bssid_count: usize,
    attention_weights: &[f32],
    spectral_gap: f64,
) -> f64 {
    // 因子 1：BSSID 多样性（AP 越多，空间信息越多）
    let diversity = (bssid_count as f64 / 20.0).min(1.0);

    // 因子 2：注意力集中度（对人体敏感的 BSSID 占主导）
    let max_weight = attention_weights.iter().copied().fold(0.0f32, f32::max);
    let mean_weight = attention_weights.iter().sum::<f32>() / attention_weights.len() as f32;
    let concentration = (max_weight / mean_weight.max(1e-6) - 1.0).min(5.0) as f64 / 5.0;

    // 因子 3：谱间隙（人体信号分离得干净）
    let separation = spectral_gap.min(1.0);

    // 综合质量
    (diversity * 0.3 + concentration * 0.4 + separation * 0.3).clamp(0.0, 1.0)
}
```

---

## 7. 与感知服务器集成

### 7.1 数据源选择的改动

```rust
// 在 main() 中扩展自动检测：
let source = match args.source.as_str() {
    "auto" => {
        if probe_esp32(args.udp_port).await {
            "esp32"
        } else if probe_multi_bssid().await {
            "wifi-enhanced"  // NEW: multi-BSSID mode
        } else if probe_windows_wifi().await {
            "wifi"           // Legacy single-RSSI
        } else {
            "simulate"
        }
    }
    other => other,
};

// 启动对应的后台任务
match source {
    "esp32" => {
        tokio::spawn(udp_receiver_task(state.clone(), args.udp_port));
        tokio::spawn(broadcast_tick_task(state.clone(), args.tick_ms));
    }
    "wifi-enhanced" => {
        // 新增：多 BSSID 增强流水线
        tokio::spawn(enhanced_wifi_task(state.clone(), args.tick_ms));
    }
    "wifi" => {
        tokio::spawn(windows_wifi_task(state.clone(), args.tick_ms));
    }
    _ => {
        tokio::spawn(simulated_data_task(state.clone(), args.tick_ms));
    }
}
```

### 7.2 增强版 WiFi 任务

```rust
async fn enhanced_wifi_task(state: SharedState, tick_ms: u64) {
    let scanner: Box<dyn WlanScanPort> = {
        #[cfg(feature = "wlanapi")]
        { Box::new(WlanApiBssidScanner::new().unwrap_or_else(|_| {
            tracing::warn!("WLAN API unavailable, falling back to netsh");
            Box::new(NetshBssidScanner)
        })) }
        #[cfg(not(feature = "wlanapi"))]
        { Box::new(NetshBssidScanner) }
    };

    let mut registry = BssidRegistry::new(32);
    let mut pipeline = WindowsWifiPipeline::new(WindowsWifiConfig::default());
    let mut interval = tokio::time::interval(Duration::from_millis(tick_ms));
    let mut seq: u32 = 0;

    info!("Enhanced WiFi multi-BSSID pipeline active (tick={}ms)", tick_ms);

    loop {
        interval.tick().await;
        seq += 1;

        let observations = match scanner.scan().await {
            Ok(obs) => obs,
            Err(e) => { warn!("Scan failed: {e}"); continue; }
        };

        registry.update(&observations);
        let frame = FrameBuilder::to_esp32_frame(&registry, &observations);

        // 送入由 RuVector 驱动的流水线
        let multi_frame = registry.to_multi_ap_frame();
        let result = pipeline.process(&multi_frame);

        let mut s = state.write().await;
        s.source = format!("wifi-enhanced:{}", observations.len());
        s.tick += 1;
        let tick = s.tick;

        let update = match result {
            Some(r) => FrameBuilder::to_sensing_update(&r, &frame, &registry, tick),
            None => {
                // 回退：基于帧生成基础更新
                let (features, classification) = extract_features_from_frame(&frame);
                SensingUpdate {
                    msg_type: "sensing_update".into(),
                    timestamp: chrono::Utc::now().timestamp_millis() as f64 / 1000.0,
                    source: format!("wifi-enhanced:{}", observations.len()),
                    tick,
                    nodes: vec![],
                    features,
                    classification,
                    signal_field: generate_signal_field(
                        frame.rssi as f64, 1.0, 0.05, tick,
                    ),
                }
            }
        };

        if let Ok(json) = serde_json::to_string(&update) {
            let _ = s.tx.send(json);
        }
        s.latest_update = Some(update);
    }
}
```

---

## 8. 性能考量

### 8.1 时延预算

| 阶段 | Tier 1 时延 | Tier 2 时延 | 说明 |
|---|---|---|---|
| BSSID 扫描 | ~200ms (netsh) | ~5ms (wlanapi) | 启动进程对比 FFI |
| 注册表更新 | <1ms | <1ms | HashMap 查找 |
| PredictiveLayer 门控 | <10us | <10us | 23 元素 RMS |
| 注意力加权 | <50us | <50us | 23×64 矩阵乘 |
| GNN 相关 | <100us | <100us | 23 节点单层 |
| 运动估计 | <20us | <20us | 加权方差 |
| 呼吸提取 | <30us | <30us | 带通 + 峰值检测 |
| ruQu 质量门控 | <10us | <10us | 三次比较 |
| 指纹匹配 | <50us | <50us | Hopfield 检索 |
| **每个 tick 合计** | **~200ms** | **~5ms** | Tier 1 由扫描主导 |

### 8.2 内存预算

| 组件 | 内存 |
|---|---|
| BssidRegistry（32 条 × 历史） | ~264 KB |
| PredictiveLayer（32 元素） | <1 KB |
| 注意力权重 | ~8 KB |
| GNN 层 | ~12 KB |
| Hopfield（32 维、10 个模板） | ~3 KB |
| TieredStore（256 KB 预算） | 256 KB |
| DriftDetector（32 个实例） | ~32 KB |
| **合计** | **~576 KB** |

---

## 9. 安全考量

- **不向 UI 暴露原始 BSSID 数据**：只广播聚合后的感知更新。单个 BSSID 的 MAC、SSID 与位置都留在服务端，以防 WiFi 基础设施被指纹识别。
- **BSSID 匿名化**：`NodeInfo.node_id` 使用顺序索引，而非 MAC 地址。
- **仅本地处理**：全部信号处理都在设备本地完成，任何扫描数据都不外传。
- **扫描权限**：`netsh wlan show networks` 无需管理员权限。`WlanGetNetworkBssList` 要求 WLAN 服务处于运行状态（Windows 默认开启）。

---

## 10. 备选方案

### 备选 1：仅增强单 AP RSSI

用更好的滤波与漂移检测改进现有的单 RSSI 路径，不引入多 BSSID。

**否决**：单个 RSSI 值缺乏空间分集。再多的时域滤波也无法从一维信号中恢复空间信息。多 BSSID 是通往有意义存在检测的最小可行路径。

### 备选 2：监听模式 / 抓包

把 WiFi 适配器切到监听模式，捕获带逐子载波 CSI 的原始 802.11 帧。

**否决（Windows）**：监听模式需要专用驱动（nexmon、picoscenes），而这些驱动对 Intel 适配器只有 Linux 版。Windows NDIS 不暴露原始 CSI。Tier 3（Intel SDK）才是 Windows 上获取 CSI 的正当路径。

### 备选 3：外接 USB WiFi 适配器

在 WSL 中通过 Linux 让独立的 USB 适配器工作在监听模式。

**否决**：引入硬件依赖与 WSL USB 直通的复杂度，还破坏了「商用设备、零配置」这一价值主张。

### 备选 4：蓝牙 RSSI 增强

扫描 BLE 信标以补充空间观测。

**暂缓**：可作为多 BSSID 的补充，但会增加 BLE 扫描的复杂度。属于未来增强项，不是核心路径。

---

## 11. 影响

### 正面影响

1. **数据量提升 10-20 倍**：从 2 Hz 下 1 个 RSSI 提升到 2-20 Hz 下 23 个 BSSID
2. **具备空间感知**：不同 AP 提供不同的人体交互路径
3. **复用既有流水线**：`Esp32Frame` 与 `SensingUpdate` 均未改动，UI 无需修改即可工作
4. **零硬件要求**：利用现成的商用 WiFi 基础设施
5. **RuVector 组合式复用**：用到 8 个既有 crate，约 80% 的智能逻辑已经现成
6. **渐进式增强**：Tier 1 立即交付，Tier 2 通过 feature 开关追加
7. **环境自适应**：SONA + ruQu 按部署环境自整定

### 负面影响

1. **仍无 CSI 相位**：只有 RSSI 意味着无法测心率，呼吸检测也受限
2. **依赖 AP 密度**：可见 AP 越少，保真度越低（最少需要 3 个）
3. **扫描时延**：Tier 1 的 netsh 较慢（~200ms）；要做到实时必须用 Tier 2 的 wlanapi
4. **AP 移动**：移动的 AP（手机热点）会产生伪运动信号
5. **跨平台问题**：`wlanapi.dll` 仅限 Windows；Linux/macOS 需要各自的适配器
6. **新增 crate**：把 `wifi-densepose-wifiscan` 加入 workspace，扩大了编译范围

---

## 12. 实施路线图

### 阶段 1：Tier 1 基础（第 1 周）

- [x] 创建 `wifi-densepose-wifiscan` crate，搭好 DDD 模块结构
- [x] 实现 `BssidId`、`BssidObservation`、`BandType`、`RadioType` 值对象
- [x] 实现带环形缓冲区历史与 Welford 统计的 `BssidRegistry` 聚合
- [x] 实现 `NetshBssidScanner` 适配器（解析 `netsh wlan show networks mode=bssid`）
- [x] 实现 `MultiApFrame`、`EnhancedSensingResult`、`WlanScanPort` 及错误类型
- [x] 42 个单元测试全部通过（解析器、领域类型、注册表、结果类型）
- [ ] 实现 `FrameBuilder::to_esp32_frame()`（多 BSSID → 伪 Esp32Frame）
- [ ] 实现可配置间隔的 `ScanScheduler`
- [ ] 集成测试：扫描 → 注册表 → 伪帧 → 既有感知流水线
- [ ] 把 `enhanced_wifi_task` 接入感知服务器的 `main()`

### 阶段 2：RuVector 信号流水线（第 2-3 周）

- [ ] 在 `PredictiveLayer` 之上实现面向多 BSSID 的 `PredictiveGate` 包装层
- [ ] 实现以呼吸方差为 query 的 `AttentionSubcarrierWeighter`
- [ ] 用 `RuvectorLayer` 相关图实现 `BssidCorrelator`
- [ ] 实现带加权方差的 `MultiApMotionEstimator`
- [ ] 用 `OscillatoryRouter` 实现 `CoarseBreathingExtractor`
- [ ] 实现 `VitalCoherenceGate`（ruQu 三滤波器流水线）
- [ ] 用 `ModernHopfield` 模板实现 `BssidFingerprintMatcher`
- [ ] 实现 `WindowsWifiPipeline` 编排器
- [ ] 用合成的多 BSSID 数据做单元测试

### 阶段 3：Tier 2 与自适应（第 4 周）

- [ ] 用 `windows-sys` FFI 实现 `WlanApiBssidScanner`
- [ ] 基准测试：netsh 与 wlanapi 的时延对比
- [ ] 实现按部署环境学习的 `SonaEnvironmentAdapter`
- [ ] 实现逐 BSSID 的 `DriftDetector` 数组
- [ ] 实现面向 BSSID 时间序列的 `TieredStore` 包装层
- [ ] 性能基准测试（验证时延预算）
- [ ] 在真实 Windows WiFi 环境下做端到端集成测试

### 阶段 4：加固（第 5 周）

- [ ] 用已知真值校准信号质量
- [ ] 置信度分数校验（存在/运动/呼吸）
- [ ] 输出消息中的 BSSID 匿名化
- [ ] 自适应扫描速率（检测到运动后加快）
- [ ] 文档与 API 参考
- [ ] feature 开关验证（`wlanapi` 开/关）

### 评审勘误（已应用）

对照 vendored 的 RuVector 源码做代码评审时发现下列问题，已在本 ADR 中更正：

| # | 问题 | 已应用的修复 |
|---|---|---|
| 1 | `ruvector-gnn` 中并不存在 `GnnLayer`，实际导出的是 `RuvectorLayer` | 已把所有引用改名为 `RuvectorLayer` |
| 2 | `ScaledDotProductAttention` 没有 `.forward()` 方法；实际 API 是 `.compute(query, keys, values)`，参数为 `&[&[f32]]` 切片数组 | 已把阶段 2 代码改为使用 `.compute()` 及正确的参数类型 |
| 3 | `SonaEngine::new(SonaConfig{...})` 写法不对；实际构造函数是 `SonaEngine::with_config(config)`，且 `SonaConfig` 用的是 `micro_lora_lr` 而非 `learning_rate` | 已修正第 14 节中的构造函数与字段名 |
| 4 | `apply_micro_lora` 没有返回值；实际签名是写入 `&mut [f32]` 输出缓冲区 | 已改为使用可变输出缓冲区的写法 |
| 5 | `TieredStore.put(&data)` 缺少必要参数；实际签名为 `put(key, data, tier, tick)` | 已补上 `BlockKey`、`Tier` 与 `tick` 参数 |
| 6 | `WindowsWifiPipeline` 被误标为「聚合根」；它其实是领域服务/编排器 | 已改标为「领域服务」 |

**评审遗留的未解决项：**
- `OscillatoryRouter` 是为 gamma 频带（30-90 Hz）神经同步设计的，把它用于 0.15 Hz 的呼吸提取在语义上有些牵强。可考虑改用专门的 IIR 带通滤波器。
- BSSID 抖动/索引回收可能使 GNN 相关图失效；需要显式的失效处理逻辑。
- `netsh` 输出依赖系统区域设置，在非英文版 Windows 上解析可能失败。可考虑按位置解析作为回退。
- Tier 1 在 2 Hz 下做呼吸检测很勉强，原因是子进程启动存在时序抖动；呼吸功能应要求 Tier 2。

---

## 13. 测试策略

### 13.1 单元测试（TDD 伦敦学派）

```rust
#[cfg(test)]
mod tests {
    // 领域：BssidRegistry
    #[test]
    fn registry_assigns_stable_subcarrier_indices();
    #[test]
    fn registry_expires_stale_bssids();
    #[test]
    fn registry_maintains_welford_stats();

    // 适配器：NetshBssidScanner
    #[test]
    fn parse_bssid_scan_output_extracts_all_bssids();
    #[test]
    fn parse_bssid_scan_output_handles_multi_band();
    #[test]
    fn parse_bssid_scan_output_handles_empty_output();

    // 流水线：PredictiveGate
    #[test]
    fn predictive_gate_suppresses_static_environment();
    #[test]
    fn predictive_gate_transmits_body_caused_changes();

    // 流水线：MotionEstimator
    #[test]
    fn motion_estimator_detects_presence_from_multi_ap();
    #[test]
    fn motion_estimator_classifies_four_levels();

    // 流水线：BreathingExtractor
    #[test]
    fn breathing_extracts_rate_from_oscillating_bssid();

    // 集成
    #[test]
    fn full_pipeline_produces_sensing_update();
    #[test]
    fn graceful_degradation_with_few_bssids();
}
```

### 13.2 集成测试

- 在 CI 的 Windows runner 上做真实 `netsh` 扫描
- 用模拟 BSSID 数据做确定性流水线测试
- 基准测试：每个 tick 的处理时延

---

## 14. 用 Micro-LoRA (SONA) 定制 BSSID 嵌入

### 14.1 原始 RSSI 向量的问题

原始 RSSI 值噪声大、依赖设备且非平稳。AP1 在信道 3 上的 -50 dBm 读数，与 AP2 在信道 36 上的 -50 dBm 不可直接比较（传播条件、天线增益、PHY 都不同）。把原始 RSSI 直接喂给 RuVector 流水线，会得到次优的注意力权重与指纹匹配结果。

### 14.2 解决方案：学习型 BSSID 嵌入

不使用原始 RSSI，而是借助 SONA 的 micro-LoRA 自适应，学习一个**逐 BSSID 的嵌入**，用来刻画每个 AP 的环境特征：

```rust
use sona::{SonaEngine, SonaConfig, TrajectoryBuilder};

/// 逐 BSSID 的学习型嵌入，刻画环境特征
pub struct BssidEmbedding {
    /// 用于 micro-LoRA 参数自适应的 SONA 引擎
    sona: SonaEngine,
    /// 逐 BSSID 的嵌入向量（每个 BSSID 占 d_embed 维）
    embeddings: Vec<Vec<f32>>,
    /// 嵌入维度
    d_embed: usize,
}

impl BssidEmbedding {
    pub fn new(max_bssids: usize, d_embed: usize) -> Self {
        Self {
            sona: SonaEngine::with_config(SonaConfig {
                hidden_dim: d_embed,
                embedding_dim: d_embed,
                micro_lora_lr: 0.001,
                ewc_lambda: 100.0, // Prevent forgetting previous environments
                ..Default::default()
            }),
            embeddings: vec![vec![0.0; d_embed]; max_bssids],
            d_embed,
        }
    }

    /// 把一次 BSSID 观测编码为学习型嵌入
    /// 组合：RSSI、信道、频段、无线制式、方差、历史
    pub fn encode(&self, entry: &BssidEntry) -> Vec<f32> {
        let mut raw = vec![0.0f32; self.d_embed];

        // 静态特征（经 micro-LoRA 学习）
        raw[0] = rssi_to_linear(entry.stats.mean) as f32;
        raw[1] = entry.stats.variance().sqrt() as f32;
        raw[2] = channel_to_norm(entry.meta.channel);
        raw[3] = band_to_feature(entry.meta.band);
        raw[4] = radio_to_feature(entry.meta.radio_type);

        // 时序特征（来自环形缓冲区）
        if entry.history.len() >= 4 {
            raw[5] = entry.history.delta(1) as f32;  // 1-step velocity
            raw[6] = entry.history.delta(2) as f32;  // 2-step velocity
            raw[7] = entry.history.trend_slope() as f32;
        }

        // 应用 micro-LoRA 自适应：raw → adapted
        let mut adapted = vec![0.0f32; self.d_embed];
        self.sona.apply_micro_lora(&raw, &mut adapted);
        adapted
    }

    /// 依据结果反馈训练嵌入
    /// 在存在/运动真值可用时调用
    pub fn train(&mut self, bssid_idx: usize, embedding: &[f32], quality: f32) {
        let trajectory = self.sona.begin_trajectory(embedding.to_vec());
        self.sona.end_trajectory(trajectory, quality);
        // EWC++ 防止遗忘此前的环境学习结果
    }
}
```

### 14.3 Micro-LoRA 自适应循环

```
Scan 1: Raw RSSI [AP1:-42, AP2:-58, AP3:-71, ...]
         │
         ▼
    BssidEmbedding.encode() → [e1, e2, e3, ...]  (d_embed=16 per BSSID)
         │
         ▼
    AttentionSubcarrierWeighter (query=breathing_profile, key=embeddings)
         │
         ▼
    Pipeline produces: motion=0.7, breathing=16.2, quality=0.85
         │
         ▼
    User/system feedback: correct=true (person was present)
         │
         ▼
    BssidEmbedding.train(quality=0.85)
         │
         ▼
    SONA micro-LoRA updates embedding weights
    EWC++ preserves prior environment learnings
         │
         ▼
Scan 2: Same raw RSSI → BETTER embeddings → BETTER attention → BETTER output
```

### 14.4 自定义嵌入的优势

| 方面 | 原始 RSSI | 学习型嵌入 |
|---|---|---|
| 设备归一化 | 无 | 有（micro-LoRA 按适配器自适应） |
| AP 增益补偿 | 无 | 有（逐 BSSID 学习） |
| 信道/频段编码 | 丢失 | 作为特征保留 |
| 时序动态 | 未捕获 | 速度 + 趋势特征 |
| 跨环境迁移 | 无 | EWC++ 保留既有学习结果 |
| 注意力质量 | 噪声大 | 干净（经自适应的特征） |
| 指纹匹配 | 原始距离 | 语义上有意义的距离 |

### 14.5 与流水线各阶段的集成

自定义嵌入在注意力与指纹两个阶段替代原始 RSSI：

```rust
// 在 WindowsWifiPipeline::process() 中：

// 阶段 2（已修改）：对嵌入而非原始 RSSI 做注意力
let bssid_embeddings: Vec<Vec<f32>> = frame.entries.iter()
    .map(|entry| self.embedding.encode(entry))
    .collect();
let weights = self.attention.forward(
    &self.compute_breathing_query(),
    &bssid_embeddings,  // Learned embeddings, not raw RSSI
    &amplitudes,
);

// 阶段 7（已修改）：在嵌入空间做指纹匹配
let posture = self.fingerprint.classify_embedding(&bssid_embeddings);
```

---

## 实现状态（2026-02-28）

### 阶段 1：领域模型 -- COMPLETE
- 已创建 `wifi-densepose-wifiscan` crate，含 DDD 限界上下文
- `MultiApFrame` 值对象，含幅度、相位、方差、历史
- `BssidRegistry` 聚合根，带 Welford 滚动统计（容量 32、30s 过期）
- `NetshBssidScanner` 适配器，解析 `netsh wlan show networks mode=bssid`（56 个单元测试）
- `EnhancedSensingResult` 输出类型，含运动、呼吸、姿态、质量
- 六边形架构：用 `WlanScanPort` trait 抽象适配器

### 阶段 2：信号智能流水线 -- COMPLETE
8 阶段纯 Rust 流水线，125 个测试通过：

| 阶段 | 模块 | 实现 |
|-------|--------|---------------|
| 1 | `predictive_gate` | 基于 EMA 的残差滤波器（替代 `PredictiveLayer`） |
| 2 | `attention_weighter` | Softmax 点积注意力（替代 `ScaledDotProductAttention`） |
| 3 | `correlator` | Pearson 相关 + BFS 聚类（替代 `RuvectorLayer` GNN） |
| 4 | `motion_estimator` | 加权方差 + EMA 平滑 |
| 5 | `breathing_extractor` | IIR 带通（0.1-0.5 Hz）+ 过零检测 |
| 6 | `quality_gate` | 三滤波器门控（structural/shift/evidence），借鉴 ruQu |
| 7 | `fingerprint_matcher` | 余弦相似度模板（替代 `ModernHopfield`） |
| 8 | `orchestrator` | `WindowsWifiPipeline` 领域服务 |

性能：约 2.1M 帧/秒（debug）、约 12M 帧/秒（release）。

### 阶段 3：服务器集成 -- IN PROGRESS
- 把 `WindowsWifiPipeline` 接入 `wifi-densepose-sensing-server`
- Tier 2 `WlanApiScanner` 异步适配器桩（通往原生 WLAN API 的升级路径）
- 扩展 `SensingUpdate`，加入增强后的运动、呼吸、姿态、质量字段

### 阶段 4：Tier 2 原生 WLAN API -- PLANNED
- 原生 `wlanapi.dll` FFI，实现 10-20 Hz 扫描速率
- 用于按环境调优的 SONA 自适应层
- 多环境基准测试

---

## 15. 参考资料

- IEEE 802.11bf WiFi 感知标准（2024）
- Adib, F. 等，「See Through Walls with WiFi!」，SIGCOMM 2013
- Ali, K. 等，「Keystroke Recognition Using WiFi Signals」，MobiCom 2015
- Halperin, D. 等，「Tool Release: Gathering 802.11n Traces with Channel State Information」，ACM SIGCOMM CCR 2011
- Intel Wi-Fi 7 BE200/BE201 规格书（2024）
- Microsoft WLAN API 文档：`WlanGetNetworkBssList`、`WlanScan`
- RuVector v2.0.4 crate 文档
