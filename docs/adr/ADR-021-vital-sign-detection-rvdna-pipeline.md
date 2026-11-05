# ADR-021：基于 rvdna 信号处理流水线的生命体征检测

| 字段 | 值 |
|-------|-------|
| **状态** | Partially Implemented |
| **日期** | 2026-02-28 |
| **决策者** | ruv |
| **关联** | ADR-014（SOTA 信号处理）、ADR-017（RuVector-Signal-MAT）、ADR-019（仅感知 UI）、ADR-020（Rust RuVector AI 模型迁移） |

## 背景

### 生命体征检测的必要性

基于 WiFi 的生命体征监测是一个快速成熟的领域。信道状态信息（CSI）能捕捉生理运动引起的细粒度多径传播变化——呼吸造成的胸腔位移（幅度 1-5 mm、频率 0.1-0.5 Hz）与心脏活动造成的体表位移（0.1-0.5 mm、0.8-2.0 Hz）。现有 WiFi-DensePose 项目已实现运动检测、存在感知与人体速度剖面（BVP），但缺少专门的生命体征提取流水线。

生命体征检测把项目价值从占用感知拓展到健康监测，可为养老看护、睡眠监测、灾害幸存者检测（ADR-001）与临床分诊提供非接触式呼吸率与心率估计。

### rvdna（RuVector DNA）能提供什么

`vendor/ruvector` 代码库提供了丰富的信号处理原语，与生命体征检测需求直接对应。与其从零构建，不如把既有 rvdna 组件组合成一条生命体征流水线。关键 crate 及其关联如下：

| Crate | 关键原语 | 与生命体征检测的关联 |
|-------|---------------|---------------------|
| `ruvector-temporal-tensor` | `TemporalTensorCompressor`、`TieredStore`、`TierPolicy`、分级量化（8/7/5/3 位） | 以自适应精度存储压缩后的 CSI 时序流——热数据（实时生命体征）8 位、温数据（历史）5 位、冷数据（归档）3 位 |
| `ruvector-nervous-system` | `PredictiveLayer`、`OscillatoryRouter`、`GlobalWorkspace`、`DVSEvent`、`EventRingBuffer`、`ShardedEventBus`、`EpropSynapse`、`Dendrite`、`ModernHopfield` | 预测编码抑制 CSI 静态分量（带宽减少 90-99%），振荡路由分离呼吸与心跳频带，事件总线承载高吞吐 CSI 流 |
| `ruvector-attention` | `ScaledDotProductAttention`、混合专家（MoE）、PDE 注意力、稀疏注意力 | 按生命体征灵敏度做注意力加权子载波选择，已用于 BVP 提取 |
| `ruvector-coherence` | `SpectralCoherenceScore`、`HnswHealthMonitor`、谱间隙估计、Fiedler 值 | CSI 时间序列的频谱分析，用子载波对之间的相干性分离呼吸与心跳 |
| `ruvector-gnn` | `GnnLayer`、`Linear`、`LayerNorm`、图注意力、EWC 训练 | 在子载波相关拓扑上构建图神经网络，学习哪些子载波组携带生命体征信息 |
| `ruvector-core` | `VectorDB`、HNSW 索引、SIMD 距离、量化 | 对生命体征波形模板做基于指纹的模式匹配 |
| `sona` | `SonaEngine`、`TrajectoryBuilder`、micro-LoRA、EWC++ | 按环境自优化生命体征提取参数 |
| `ruvector-sparse-inference` | 稀疏模型执行、精度管理 | 在计算受限的边缘设备上高效推理 |
| `ruQu` | `FilterPipeline`（Structural/Shift/Evidence）、`AdaptiveThresholds`（Welford、EMA、类 CUSUM）、`DriftDetector`（阶跃变化、方差扩张、振荡）、`QuantumFabric`（256 tile 并行处理） | **三滤波器决策流水线**用于生命体征门控——结构滤波器检测信号分区/退化，偏移滤波器捕捉生命体征基线的分布漂移，证据滤波器提供随时有效的统计严谨性。`DriftDetector` 直接检测呼吸/心脏参数漂移。`AdaptiveThresholds` 依据结果反馈（精确率/召回率/F1）自调异常阈值。256 tile fabric 对应子载波并行处理。 |
| DNA 示例（`examples/dna`） | `BiomarkerProfile`、`StreamProcessor`、`RingBuffer`、`BiomarkerReading`、z-score 异常检测、CUSUM 变点检测、EMA、趋势分析 | 直接类比——生物标志物流式引擎处理带异常检测的时序健康数据，与生命体征监测完全对应 |

### 项目现状

Rust 移植版（`v2/`）已包含：

- **`wifi-densepose-signal`**：CSI 处理、BVP 提取、相位清洗、Hampel 滤波、频谱图生成、菲涅尔几何、运动检测、子载波选择
- **`wifi-densepose-sensing-server`**：接收 ESP32 CSI 帧（UDP 5005）的 Axum 服务，通过 WebSocket 广播感知更新、生成信号场，具备三种数据源模式：
  - **ESP32 模式**（`--source esp32`）：通过 UDP `:5005` 接收 ADR-018 二进制帧。帧格式：magic `0xC511_0001`、20 字节头（`node_id`、`n_antennas`、`n_subcarriers`、`freq_mhz`、`sequence`、`rssi`、`noise_floor`）、打包的 I/Q 对。`parse_esp32_frame()` 按子载波提取幅度（`sqrt(I^2+Q^2)`）与相位（`atan2(Q,I)`）。ESP32 模式还会运行 `broadcast_tick_task`，在两帧之间把缓冲状态重播给 WebSocket 客户端。
  - **Windows WiFi 模式**（`--source wifi`）：用 `netsh wlan show interfaces` 提取 RSSI/信号百分比，构造伪单子载波帧。便于开发，但缺少多子载波 CSI。
  - **模拟模式**（`--source simulate`）：生成幅度/相位按正弦变化的合成 56 子载波帧，用于 UI 测试。
- **自动探测**：`main()` 先探测 ESP32 UDP，再探测 Windows WiFi，最后回退到模拟。生命体征模块必须与三种模式都集成，但只有 ESP32 模式（多子载波 CSI）能给出有意义的 HR/RR。
- **生命体征复用的既有能力**：`extract_features_from_frame()` 已计算 `breathing_band_power`（低频子载波方差）与 `motion_band_power`（高频方差）；`generate_signal_field()` 已建模由 variance 与 tick 调制的 `breath_ring`。它们构成生命体征流水线的集成锚点。
- **既有 ADR-019/020**：带 Three.js 可视化的仅感知 UI 模式，以及 Rust 迁移计划

缺失的是 CSI 处理流水线与 UI 可视化之间专门的生命体征提取环节。

## 决策

在 Rust 移植版 workspace 中新增 crate `wifi-densepose-vitals`，用 rvdna 原语组合出**生命体征检测模块**。该模块从 WiFi CSI 数据中提取心率（HR）与呼吸率（RR），并与既有感知服务及 UI 集成。

### 核心设计原则

1. **复用优先于自研**：用既有 rvdna crate 作为构件，而不是从零重实现信号处理。
2. **流式优先架构**：用环形缓冲与事件驱动方式处理随到随来的 CSI 帧，参照 `biomarker_stream::StreamProcessor` 模式。
3. **环境自适应**：用 SONA 的自优化闭环，按部署环境调整提取参数（滤波截止、子载波权重、噪声阈值）。
4. **分级存储**：用 `ruvector-temporal-tensor` 按访问模式以可变精度存储生命体征时间序列。
5. **隐私优先设计**：所有处理都在本地、设备端完成，原始 CSI 数据不出设备。

## 架构

### 组件图

```
                        ┌─────────────────────────────────────────────────────────┐
                        │              wifi-densepose-vitals crate                │
                        │                                                         │
ESP32 CSI (UDP:5005) ──▶│  ┌──────────────────┐    ┌──────────────────────────┐  │
                        │  │ CsiVitalPreproc   │    │  VitalSignExtractor       │  │
    ┌───────────────────│  │ (ruvector-nervous  │──▶│  ┌────────────────────┐   │  │
    │                   │  │  -system:          │    │  │ BreathingExtractor │   │  │──▶ WebSocket
    │  wifi-densepose-  │  │  PredictiveLayer   │    │  │ (Bandpass 0.1-0.5) │   │  │    (/ws/vitals)
    │  signal crate     │  │  + EventRingBuffer)│    │  └────────────────────┘   │  │
    │  ┌─────────────┐  │  └──────────────────┘    │  ┌────────────────────┐   │  │──▶ REST API
    │  │CsiProcessor │  │           │               │  │ HeartRateExtractor │   │  │    (/api/v1/vitals)
    │  │PhaseSntzr   │──│───────────┘               │  │ (Bandpass 0.8-2.0) │   │  │
    │  │HampelFilter │  │                           │  └────────────────────┘   │  │
    │  │SubcarrierSel│  │  ┌──────────────────┐    │  ┌────────────────────┐   │  │
    │  └─────────────┘  │  │ SubcarrierWeighter│    │  │ MotionArtifact    │   │  │
    │                   │  │ (ruvector-attention│    │  │ Rejector          │   │  │
    └───────────────────│  │  + ruvector-gnn)   │──▶│  └────────────────────┘   │  │
                        │  └──────────────────┘    └──────────────────────────┘  │
                        │                                       │                 │
                        │  ┌──────────────────┐    ┌──────────────────────────┐  │
                        │  │ VitalSignStore    │    │  AnomalyDetector         │  │
                        │  │ (ruvector-temporal │◀──│  (biomarker_stream        │  │
                        │  │  -tensor:TieredSt)│    │   pattern: z-score,      │  │
                        │  └──────────────────┘    │   CUSUM, EMA, trend)     │  │
                        │                           └──────────────────────────┘  │
                        │  ┌──────────────────┐    ┌──────────────────────────┐  │
                        │  │ VitalCoherenceGate│    │  PatternMatcher          │  │
                        │  │ (ruQu: 3-filter   │    │  (ruvector-core:VectorDB │  │
                        │  │  pipeline, drift  │    │   + ModernHopfield)      │  │
                        │  │  detection,       │    └──────────────────────────┘  │
                        │  │  adaptive thresh) │                                  │
                        │  └──────────────────┘    ┌──────────────────────────┐  │
                        │  ┌──────────────────┐    │  SonaAdaptation          │  │
                        │  │ ESP32 Frame Input │    │  (sona:SonaEngine        │  │
                        │  │ (UDP:5005, magic  │    │   micro-LoRA adapt)      │  │
                        │  │  0xC511_0001,     │    └──────────────────────────┘  │
                        │  │  20B hdr + I/Q)   │                                  │
                        │  └──────────────────┘                                   │
                        └─────────────────────────────────────────────────────────┘
```

### 模块结构

```
v2/crates/wifi-densepose-vitals/
├── Cargo.toml
└── src/
    ├── lib.rs                 # Public API and re-exports
    ├── config.rs              # VitalSignConfig, band definitions
    ├── preprocess.rs          # CsiVitalPreprocessor (PredictiveLayer-based)
    ├── extractor.rs           # VitalSignExtractor (breathing + heartrate)
    ├── breathing.rs           # BreathingExtractor (respiratory rate)
    ├── heartrate.rs           # HeartRateExtractor (cardiac rate)
    ├── subcarrier_weight.rs   # AttentionSubcarrierWeighter (GNN + attention)
    ├── artifact.rs            # MotionArtifactRejector
    ├── anomaly.rs             # VitalAnomalyDetector (z-score, CUSUM, EMA)
    ├── coherence_gate.rs      # VitalCoherenceGate (ruQu three-filter pipeline + drift detection)
    ├── store.rs               # VitalSignStore (TieredStore wrapper)
    ├── pattern.rs             # VitalPatternMatcher (Hopfield + HNSW)
    ├── adaptation.rs          # SonaVitalAdapter (environment adaptation)
    ├── types.rs               # VitalReading, VitalSign, VitalStatus
    └── error.rs               # VitalError type
```

## 信号处理流水线

### 阶段 1：CSI 预处理（既有能力 + PredictiveLayer）

既有 `wifi-densepose-signal` crate 负责原始 CSI 接入：

1. **ESP32 帧解析**：`parse_esp32_frame()` 从 ADR-018 二进制帧格式（magic `0xC511_0001`、20 字节头 + 打包 I/Q 对）中提取 I/Q 幅度与相位。
2. **相位清洗**：`PhaseSanitizer` 执行线性相位去除、解卷绕与 Hampel 离群点过滤。
3. **子载波选择**：`subcarrier_selection` 模块识别对运动敏感的子载波。

生命体征模块在 `ruvector-nervous-system::routing` 之上增加一个 **PredictiveLayer** 门控：

```rust
use ruvector_nervous_system::routing::PredictiveLayer;

pub struct CsiVitalPreprocessor {
    /// 预测编码层 —— 抑制 CSI 静态分量。
    /// 只传输超过阈值的残差（变化量）。
    /// 在稳定环境下可减少 90-99% 带宽。
    predictive: PredictiveLayer,

    /// 每个子载波的 CSI 幅度历史环形缓冲。
    /// 参照 biomarker_stream::RingBuffer。
    amplitude_buffers: Vec<RingBuffer<f64>>,

    /// 相位差缓冲（相邻包的相位差）。
    phase_diff_buffers: Vec<RingBuffer<f64>>,

    /// 被跟踪的子载波数量。
    n_subcarriers: usize,

    /// 由 ESP32 包到达率推导出的采样率。
    sample_rate_hz: f64,
}

impl CsiVitalPreprocessor {
    pub fn new(n_subcarriers: usize, window_size: usize) -> Self {
        Self {
            // 10% 阈值：仅当 CSI 变化超过 10% 时才传输
            predictive: PredictiveLayer::new(n_subcarriers, 0.10),
            amplitude_buffers: (0..n_subcarriers)
                .map(|_| RingBuffer::new(window_size))
                .collect(),
            phase_diff_buffers: (0..n_subcarriers)
                .map(|_| RingBuffer::new(window_size))
                .collect(),
            n_subcarriers,
            sample_rate_hz: 100.0, // Default; calibrated from packet timing
        }
    }

    /// 接入新的 CSI 帧，返回可供生命体征提取的预处理数据。
    /// 若该帧可预测（无变化）则返回 None。
    pub fn ingest(&mut self, amplitudes: &[f64], phases: &[f64]) -> Option<VitalFrame> {
        let amp_f32: Vec<f32> = amplitudes.iter().map(|&a| a as f32).collect();

        // PredictiveLayer 门控：仅当残差超过阈值时才处理
        if !self.predictive.should_transmit(&amp_f32) {
            self.predictive.update(&amp_f32);
            return None; // Static environment, skip processing
        }

        self.predictive.update(&amp_f32);

        // 缓存幅度与相位差数据
        for (i, (&amp, &phase)) in amplitudes.iter().zip(phases.iter()).enumerate() {
            if i < self.n_subcarriers {
                self.amplitude_buffers[i].push(amp);
                self.phase_diff_buffers[i].push(phase);
            }
        }

        Some(VitalFrame {
            amplitudes: amplitudes.to_vec(),
            phases: phases.to_vec(),
            timestamp_us: /* from ESP32 frame */,
        })
    }
}
```

### 阶段 2：子载波加权（注意力 + GNN）

并非所有子载波都同等地携带生命体征信息：有些被静态多径主导，有些被运动伪影主导。子载波加权阶段用 `ruvector-attention` 与 `ruvector-gnn` 学习哪些子载波对生理运动最敏感。

```rust
use ruvector_attention::ScaledDotProductAttention;
use ruvector_attention::traits::Attention;

pub struct AttentionSubcarrierWeighter {
    /// 用于子载波重要性打分的注意力机制。
    /// 键：子载波方差剖面。
    /// 查询：目标生命体征频带功率。
    /// 值：子载波幅度时间序列。
    attention: ScaledDotProductAttention,

    /// 在子载波相关图上运算的 GNN 层。
    /// 节点即子载波，边即互相关强度。
    /// 学习表征生命体征的空—频谱模式。
    gnn_layer: ruvector_gnn::GnnLayer,

    /// 每个子载波的权重（每个处理窗口更新一次）。
    weights: Vec<f32>,
}
```

这一思路与 `wifi-densepose-signal::bvp` 中 BVP 提取的做法一致：后者已用 `ScaledDotProductAttention` 为各子载波对速度剖面的贡献加权。对生命体征而言，注意力查询向量编码期望的频谱成分（呼吸频带 0.1-0.5 Hz、心脏频带 0.8-2.0 Hz），键则编码各子载波当前的频谱剖面。

`ruvector-gnn::layer` 的 GNN 层在子载波之上构建相关图（节点 = 子载波，边权 = 互相关系数），再通过消息传递找出呈现相干生命体征频带振荡的子载波簇。这与 ADR-006 的 GNN 增强 CSI 模式识别直接类比。

### 阶段 3：生命体征提取

两个并行提取器作用于加权、预处理后的 CSI 数据：

#### 3a：呼吸率提取

```rust
pub struct BreathingExtractor {
    /// 带通滤波器：0.1 - 0.5 Hz（每分钟 6-30 次呼吸）
    filter_low: f64,  // 0.1 Hz
    filter_high: f64, // 0.5 Hz

    /// 来自 ruvector-nervous-system 的振荡路由器。
    /// 配置在约 0.25 Hz（平均呼吸频率）。
    /// 与 CSI 中的主导呼吸分量锁相。
    oscillator: OscillatoryRouter,

    /// 滤波后呼吸频带信号的环形缓冲。
    /// 参照 biomarker_stream::RingBuffer<f64>。
    signal_buffer: RingBuffer<f64>,

    /// 用于呼吸计数的峰值检测器状态。
    last_peak_time: Option<u64>,
    peak_intervals: RingBuffer<f64>,
}

impl BreathingExtractor {
    pub fn extract(&mut self, weighted_csi: &[f64], timestamp_us: u64) -> BreathingEstimate {
        // 1. 把 CSI 带通滤波到呼吸频带（0.1-0.5 Hz）
        let breathing_signal = self.bandpass_filter(weighted_csi);

        // 2. 跨子载波聚合（加权求和）
        let composite = self.aggregate(breathing_signal);

        // 3. 入缓冲并检测峰值
        self.signal_buffer.push(composite);

        // 4. 统计峰间间隔以估计速率
        // 使用 Welford 在线均值/方差（同 biomarker_stream::window_mean_std）
        let rate_bpm = self.estimate_rate();

        BreathingEstimate {
            rate_bpm,
            confidence: self.compute_confidence(),
            waveform_sample: composite,
            timestamp_us,
        }
    }
}
```

#### 3b：心率提取

```rust
pub struct HeartRateExtractor {
    /// 带通滤波器：0.8 - 2.0 Hz（每分钟 48-120 次心跳）
    filter_low: f64,  // 0.8 Hz
    filter_high: f64, // 2.0 Hz

    /// 用于心脏模式模板匹配的 Hopfield 网络。
    /// 存储已学习的心跳波形模板。
    /// 检索过程相当于对含噪 CSI 做匹配滤波。
    hopfield: ModernHopfield,

    /// 供频谱分析使用的信号缓冲。
    signal_buffer: RingBuffer<f64>,

    /// 来自 ruvector-coherence 的频谱相干性跟踪器。
    coherence: SpectralTracker,
}
```

心率提取本质上比呼吸更难，因为体表位移小得多（0.1-0.5 mm 对比 1-5 mm）。`ruvector-nervous-system::hopfield` 的 `ModernHopfield` 网络以指数级存储容量保存已学习的心跳波形模板（Ramsauer 等人 2020 年的表述）。检索过程相当于一次软匹配滤波：含噪 CSI 信号经 transformer 式注意力机制（`beta` 参数化的 softmax）与所有已存模板比较，最匹配模板的周期即决定心率。

`ruvector-coherence::spectral::SpectralTracker` 持续监控子载波相关图的谱间隙与 Fiedler 值。心脏频带出现明显的谱间隙，说明信号质量高、HR 估计可靠。

### 阶段 4：运动伪影抑制

大幅身体动作（行走、手势）会淹没微弱的生命体征信号。伪影抑制器结合 `wifi-densepose-signal::motion` 中既有的 `MotionDetector`，以及 `ruvector-nervous-system::eventbus` 的 `DVSEvent`/`EventRingBuffer` 体系：

```rust
pub struct MotionArtifactRejector {
    /// 运动事件的事件环形缓冲。
    /// DVSEvent.polarity=true 表示运动开始，false 表示运动结束。
    event_buffer: EventRingBuffer<DVSEvent>,

    /// 来自 ruvector-nervous-system::eventbus 的背压控制器。
    /// 在剧烈运动期间抑制生命体征输出。
    backpressure: BackpressureController,

    /// 来自 ruvector-nervous-system::routing 的全局工作区。
    /// 有限容量的广播（米勒定律：4-7 个条目）。
    /// 生命体征与运动信号竞争工作区槽位。
    /// 只有运动信号在竞争中落败，生命体征才能广播。
    workspace: GlobalWorkspace,

    /// 触发消隐的运动能量阈值。
    motion_threshold: f64,

    /// 运动事件后的消隐时长（秒）。
    blanking_duration: f64,
}
```

来自路由模块的 `GlobalWorkspace`（Baars 1988 模型）实现了有限容量竞争。生命体征表征与运动表征争夺工作区访问权：剧烈运动时运动信号占主导，生命体征输出被抑制；运动平息后，生命体征表征胜出并被广播给消费者。

### 阶段 5：异常检测

直接参照 `examples/dna/src/biomarker_stream.rs::StreamProcessor`：

```rust
pub struct VitalAnomalyDetector {
    /// 各生命体征的环形缓冲与滚动统计量。
    /// 直接照搬 biomarker_stream::StreamProcessor 的架构。
    buffers: HashMap<VitalSignType, RingBuffer<f64>>,
    stats: HashMap<VitalSignType, VitalStats>,

    /// 异常检测的 z-score 阈值（默认 2.5，与 biomarker_stream 一致）。
    z_threshold: f64,

    /// CUSUM 变点检测参数。
    /// 检测生命体征的持续偏移（例如呼吸骤停的发生）。
    cusum_threshold: f64, // 4.0 (same as biomarker_stream)
    cusum_drift: f64,     // 0.5

    /// EMA 平滑系数（alpha = 0.1）。
    ema_alpha: f64,
}

pub struct VitalStats {
    pub mean: f64,
    pub variance: f64,
    pub min: f64,
    pub max: f64,
    pub count: u64,
    pub anomaly_rate: f64,
    pub trend_slope: f64,
    pub ema: f64,
    pub cusum_pos: f64,
    pub cusum_neg: f64,
    pub changepoint_detected: bool,
}
```

这几乎是 `biomarker_stream` 架构的直接移植：同样的 Welford 在线算法计算滚动均值与标准差，同样的 CUSUM 算法检测变点（呼吸暂停发生、心动过速），同样的线性回归计算趋势斜率。

### 阶段 5b：ruQu 相干性门控（三滤波器信号质量评估）

`ruQu` crate 提供了一条生产级**三滤波器决策流水线**，最初为量子纠错设计，但其抽象恰好对应生命体征的信号质量门控。与其从零重实现质量门控，不如把 ruQu 的滤波器组合成生命体征相干性门控：

```rust
use ruqu::{
    AdaptiveThresholds, DriftDetector, DriftConfig, DriftProfile, LearningConfig,
    FilterPipeline, FilterConfig, Verdict,
};

pub struct VitalCoherenceGate {
    /// 适配生命体征门控的三滤波器流水线：
    /// - 结构：子载波相关图上的最小割（割值低 = 信号退化）
    /// - 偏移：生命体征基线的分布漂移（检测环境变化）
    /// - 证据：随时有效的 e-value 累积，保证统计严谨性
    filter_pipeline: FilterPipeline,

    /// 依据结果反馈自调的自适应阈值。
    /// 使用 Welford 在线统计、EMA 跟踪与精确率/召回率/F1 评分。
    /// 直接移植 ruQu 的 AdaptiveThresholds 与 LearningConfig。
    adaptive: AdaptiveThresholds,

    /// 生命体征基线的漂移检测器。
    /// 检测 ruQu 定义的 5 种漂移形态：
    /// - Stable：正常运行
    /// - Linear：呼吸率渐变（例如入睡）
    /// - StepChange：心率突变（例如惊吓反应）
    /// - Oscillating：周期性伪影（例如风扇干扰）
    /// - VarianceExpansion：噪声增大（例如被测者移动）
    rr_drift: DriftDetector,
    hr_drift: DriftDetector,
}

impl VitalCoherenceGate {
    pub fn new() -> Self {
        Self {
            filter_pipeline: FilterPipeline::new(FilterConfig::default()),
            adaptive: AdaptiveThresholds::new(LearningConfig {
                learning_rate: 0.01,
                history_window: 10_000,
                warmup_samples: 500,  // ~5 seconds at 100 Hz
                ema_decay: 0.99,
                auto_adjust: true,
                ..Default::default()
            }),
            rr_drift: DriftDetector::with_config(DriftConfig {
                window_size: 300,  // 3-second window at 100 Hz
                min_samples: 100,
                mean_shift_threshold: 2.0,
                variance_threshold: 1.5,
                trend_sensitivity: 0.1,
            }),
            hr_drift: DriftDetector::with_config(DriftConfig {
                window_size: 500,  // 5-second window (cardiac needs longer baseline)
                min_samples: 200,
                mean_shift_threshold: 2.5,
                variance_threshold: 2.0,
                trend_sensitivity: 0.05,
            }),
        }
    }

    /// 对一次生命体征读数做门控：返回 Verdict（Permit/Deny/Defer）
    pub fn gate(&mut self, reading: &VitalReading) -> Verdict {
        // 把呼吸率送入漂移检测器
        self.rr_drift.push(reading.respiratory_rate.value_bpm);
        self.hr_drift.push(reading.heart_rate.value_bpm);

        // 记录指标供自适应阈值学习
        let cut = reading.signal_quality;
        let shift = self.rr_drift.severity().max(self.hr_drift.severity());
        let evidence = reading.respiratory_rate.confidence.min(reading.heart_rate.confidence);
        self.adaptive.record_metrics(cut, shift, evidence);

        // 三滤波器决策：全部通过才 PERMIT
        // 确保只有高置信度生命体征进入 UI
        let verdict = self.filter_pipeline.evaluate(cut, shift, evidence);

        // 若检测到漂移，补偿自适应阈值
        if let Some(profile) = self.rr_drift.detect() {
            if !matches!(profile, DriftProfile::Stable) {
                self.adaptive.apply_drift_compensation(&profile);
            }
        }

        verdict
    }

    /// 记录门控决策是否正确（供学习使用）
    pub fn record_outcome(&mut self, was_deny: bool, was_actually_bad: bool) {
        self.adaptive.record_outcome(was_deny, was_actually_bad);
    }
}
```

**为什么 ruQu 适合这里：**

| ruQu 概念 | 生命体征映射 |
|---|---|
| 综合轮次（检测器位图） | CSI 帧（子载波幅度/相位） |
| 结构最小割 | 子载波相关图的连通性（割值低 = 信号破碎） |
| 偏移滤波器（分布漂移） | 呼吸/心脏基线偏离常态 |
| 证据滤波器（e-value） | 随时间累积的统计置信度 |
| 带 5 种形态的 `DriftDetector` | 检测入睡（Linear）、惊吓（StepChange）、风扇干扰（Oscillating）、被测者移动（VarianceExpansion） |
| 基于 Welford/EMA 的 `AdaptiveThresholds` | 以结果反馈优化 F1 的自调异常阈值 |
| PERMIT / DENY / DEFER | 仅在质量得到验证时才向 UI 输出生命体征 |
| 256 tile 的 `QuantumFabric` | 未来：在 WASM 上按子载波并行处理 |

### 阶段 6：分级存储

```rust
use ruvector_temporal_tensor::{TieredStore, TierPolicy, Tier};
use ruvector_temporal_tensor::core_trait::{TensorStore, TensorStoreExt};

pub struct VitalSignStore {
    store: TieredStore,
    tier_policy: TierPolicy,
}
```

生命体征数据存放在 `ruvector-temporal-tensor` 的 `TieredStore` 中：

| 层级 | 位数 | 压缩比 | 用途 |
|------|------|-------------|---------|
| Tier1（热） | 8 位 | 4x | 实时生命体征（最近 5 分钟），供 UI 使用 |
| Tier2（温） | 5 位 | 6.4x | 近期历史（最近 1 小时），趋势分析 |
| Tier3（冷） | 3 位 | 10.67x | 长期归档（24 小时以上），模式库 |
| Tier0（已逐出） | 仅元数据 | N/A | 带重建策略的过期数据 |

`BlockKey` 天然适配生命体征存储：
- `tensor_id`：编码生命体征类型（0 = 呼吸率，1 = 心率，2 = 合成波形）
- `block_index`：编码时间窗口索引

### 阶段 7：环境自适应（SONA）

```rust
use sona::{SonaEngine, SonaConfig, TrajectoryBuilder};

pub struct SonaVitalAdapter {
    engine: SonaEngine,
}

impl SonaVitalAdapter {
    pub fn begin_extraction(&self, csi_embedding: Vec<f32>) -> TrajectoryBuilder {
        self.engine.begin_trajectory(csi_embedding)
    }

    pub fn end_extraction(&self, builder: TrajectoryBuilder, quality: f32) {
        // quality = 生命体征估计的置信度 * 准确度
        self.engine.end_trajectory(builder, quality);
    }

    /// 对滤波器参数应用 micro-LoRA 适配。
    pub fn adapt_filters(&self, filter_params: &[f32], adapted: &mut [f32]) {
        self.engine.apply_micro_lora(filter_params, adapted);
    }
}
```

SONA 引擎的四步智能流水线（RETRIEVE、JUDGE、DISTILL、CONSOLIDATE）支持：
1. **RETRIEVE**：通过 HNSW 查找相似环境下过去成功的提取参数。
2. **JUDGE**：按生理合理性给提取质量打分（HR 40-180 BPM、RR 4-40 BPM）。
3. **DISTILL**：经 micro-LoRA 提炼关键参数调整。
4. **CONSOLIDATE**：通过 EWC++ 避免遗忘先前学到的环境。

## 数据流

### 端到端流水线

```
ESP32 CSI Frame (UDP :5005)
│  Magic: 0xC511_0001 | 20-byte header | packed I/Q pairs
│  parse_esp32_frame() → Esp32Frame { node_id, n_antennas,
│     n_subcarriers, freq_mhz, sequence, rssi, noise_floor,
│     amplitudes: Vec<f64>, phases: Vec<f64> }
│
▼
[wifi-densepose-signal] CsiProcessor + PhaseSanitizer + HampelFilter
│
▼
[wifi-densepose-vitals] CsiVitalPreprocessor (PredictiveLayer gate)
│
├──▶ Static environment? (predictable) ──▶ Skip (90-99% frames filtered)
│
▼ (residual frames with physiological changes)
[wifi-densepose-vitals] AttentionSubcarrierWeighter (attention + GNN)
│
▼
[wifi-densepose-vitals] MotionArtifactRejector (GlobalWorkspace competition)
│
├──▶ High motion? ──▶ Blank vital sign output, report motion-only
│
▼ (low-motion frames)
├──▶ BreathingExtractor ──▶ RR estimate (BPM + confidence)
├──▶ HeartRateExtractor ──▶ HR estimate (BPM + confidence)
│
▼
[wifi-densepose-vitals] VitalAnomalyDetector (z-score, CUSUM, EMA)
│
├──▶ Anomaly? ──▶ Alert (apnea, tachycardia, bradycardia)
│
▼
[wifi-densepose-vitals] VitalCoherenceGate (ruQu three-filter pipeline)
│
├──▶ DENY (low quality)  ──▶ Suppress reading, keep previous valid
├──▶ DEFER (accumulating) ──▶ Buffer, await more evidence
│
▼ PERMIT (high-confidence vital signs)
[wifi-densepose-vitals] VitalSignStore (TieredStore: 8/5/3-bit)
│
▼
[wifi-densepose-sensing-server] WebSocket broadcast (/ws/vitals)
│  AppStateInner extended with latest_vitals + vitals_tx channel
│  ESP32 mode: udp_receiver_task feeds amplitudes/phases to VitalSignExtractor
│  WiFi mode: pseudo-frame (single subcarrier) → VitalStatus::Unreliable
│  Simulate mode: synthetic CSI → calibration/demo vital signs
│
▼
[UI] SensingTab.js: vital sign visualization overlay
```

**ESP32 集成细节：** 感知服务中的 `udp_receiver_task` 已负责接收并解析 ESP32 帧，生命体征模块挂到这条路径上：

```rust
// 在 udp_receiver_task 中，parse_esp32_frame() 之后：
if let Some(frame) = parse_esp32_frame(&buf[..len]) {
    let (features, classification) = extract_features_from_frame(&frame);

    // 新增：送入生命体征提取器
    let vital_reading = s.vital_extractor.process_frame(
        &frame.amplitudes,
        &frame.phases,
        frame.sequence as u64 * 10_000, // approximate timestamp_us
    );

    if let Some(reading) = vital_reading {
        s.latest_vitals = Some(reading.into());
        if let Ok(json) = serde_json::to_string(&s.latest_vitals) {
            let _ = s.vitals_tx.send(json);
        }
    }
    // ... 既有感知更新逻辑保持不变 ...
}
```

### WebSocket 消息结构

```json
{
  "type": "vital_update",
  "timestamp": 1709146800.123,
  "source": "esp32",
  "vitals": {
    "respiratory_rate": {
      "value_bpm": 16.2,
      "confidence": 0.87,
      "waveform": [0.12, 0.15, 0.21, ...],
      "status": "normal"
    },
    "heart_rate": {
      "value_bpm": 72.5,
      "confidence": 0.63,
      "waveform": [0.02, 0.03, 0.05, ...],
      "status": "normal"
    },
    "motion_level": "low",
    "signal_quality": 0.78
  },
  "anomalies": [],
  "stats": {
    "rr_mean": 15.8,
    "rr_trend": -0.02,
    "hr_mean": 71.3,
    "hr_trend": 0.01,
    "rr_ema": 16.0,
    "hr_ema": 72.1
  }
}
```

## 集成点

### 1. 感知服务集成

`wifi-densepose-sensing-server` crate 的 `AppStateInner` 扩展了生命体征状态：

```rust
struct AppStateInner {
    latest_update: Option<SensingUpdate>,
    latest_vitals: Option<VitalUpdate>,   // NEW
    vital_extractor: VitalSignExtractor,  // NEW
    rssi_history: VecDeque<f64>,
    tick: u64,
    source: String,
    tx: broadcast::Sender<String>,
    vitals_tx: broadcast::Sender<String>, // NEW: separate channel for vitals
    total_detections: u64,
    start_time: std::time::Instant,
}
```

新增 Axum 路由：

```rust
Router::new()
    .route("/ws/vitals", get(ws_vitals_handler))
    .route("/api/v1/vitals/current", get(get_current_vitals))
    .route("/api/v1/vitals/history", get(get_vital_history))
    .route("/api/v1/vitals/config", get(get_vital_config).put(set_vital_config))
```

### 2. UI 集成

既有 SensingTab.js 的高斯泼溅可视化（ADR-019）扩展出：

- **呼吸环**：已在 `generate_signal_field()` 中以 `breath_ring` 变量做过原型，幅度由 `variance` 与 `tick` 调制；现改为使用生命体征提取器输出的实际呼吸波形。
- **心率指示器**：与估计心率同步的脉冲式不透明度叠加层。
- **生命体征面板**：侧栏展示 HR/RR 数值、趋势迷你曲线与异常告警。

### 3. 既有 signal crate 集成

`wifi-densepose-vitals` 依赖 `wifi-densepose-signal` 做 CSI 预处理，依赖 rvdna crate 提供核心算法。依赖关系如下：

```
wifi-densepose-vitals
├── wifi-densepose-signal          (CSI preprocessing)
├── ruvector-nervous-system        (PredictiveLayer, EventBus, Hopfield, GlobalWorkspace)
├── ruvector-attention             (subcarrier attention weighting)
├── ruvector-gnn                   (subcarrier correlation graph)
├── ruvector-coherence             (spectral analysis, signal quality)
├── ruvector-temporal-tensor       (tiered storage)
├── ruvector-core                  (VectorDB for pattern matching)
├── ruqu                           (three-filter coherence gate, adaptive thresholds, drift detection)
└── sona                           (environment adaptation)
```

## API 设计

### 核心公开 API

```rust
/// 生命体征提取主引擎。
pub struct VitalSignExtractor {
    preprocessor: CsiVitalPreprocessor,
    weighter: AttentionSubcarrierWeighter,
    breathing: BreathingExtractor,
    heartrate: HeartRateExtractor,
    artifact_rejector: MotionArtifactRejector,
    anomaly_detector: VitalAnomalyDetector,
    coherence_gate: VitalCoherenceGate,  // ruQu three-filter quality gate
    store: VitalSignStore,
    adapter: SonaVitalAdapter,
    config: VitalSignConfig,
}

impl VitalSignExtractor {
    /// 以默认配置创建提取器。
    pub fn new(config: VitalSignConfig) -> Self;

    /// 处理单个 CSI 帧并返回生命体征估计。
    /// 运动消隐或静态环境期间返回 None。
    pub fn process_frame(
        &mut self,
        amplitudes: &[f64],
        phases: &[f64],
        timestamp_us: u64,
    ) -> Option<VitalReading>;

    /// 获取当前生命体征估计。
    pub fn current(&self) -> VitalStatus;

    /// 从分级存储读取历史生命体征数据。
    pub fn history(&mut self, duration_secs: u64) -> Vec<VitalReading>;

    /// 获取异常告警。
    pub fn anomalies(&self) -> Vec<VitalAnomaly>;

    /// 获取信号质量评估。
    pub fn signal_quality(&self) -> SignalQuality;
}

/// 生命体征提取配置。
pub struct VitalSignConfig {
    /// 要跟踪的子载波数量。
    pub n_subcarriers: usize,
    /// CSI 采样率（Hz），按 ESP32 包速率校准。
    pub sample_rate_hz: f64,
    /// 环形缓冲窗口大小（样本数）。
    pub window_size: usize,
    /// 呼吸频带（Hz）。
    pub breathing_band: (f64, f64),
    /// 心率频带（Hz）。
    pub heartrate_band: (f64, f64),
    /// PredictiveLayer 残差阈值。
    pub predictive_threshold: f32,
    /// z-score 异常阈值。
    pub anomaly_z_threshold: f64,
    /// 运动消隐时长（秒）。
    pub motion_blank_secs: f64,
    /// 分级存储容量（字节）。
    pub store_capacity: usize,
    /// 是否启用 SONA 自适应。
    pub enable_adaptation: bool,
}

impl Default for VitalSignConfig {
    fn default() -> Self {
        Self {
            n_subcarriers: 56,
            sample_rate_hz: 100.0,
            window_size: 1024,    // ~10 seconds at 100 Hz
            breathing_band: (0.1, 0.5),
            heartrate_band: (0.8, 2.0),
            predictive_threshold: 0.10,
            anomaly_z_threshold: 2.5,
            motion_blank_secs: 2.0,
            store_capacity: 4 * 1024 * 1024, // 4 MB
            enable_adaptation: true,
        }
    }
}

/// 某一时刻的单次生命体征读数。
pub struct VitalReading {
    pub timestamp_us: u64,
    pub respiratory_rate: VitalEstimate,
    pub heart_rate: VitalEstimate,
    pub motion_level: MotionLevel,
    pub signal_quality: f64,
}

/// 带置信度的生命体征估计值。
pub struct VitalEstimate {
    pub value_bpm: f64,
    pub confidence: f64,
    pub waveform_sample: f64,
    pub status: VitalStatus,
}

pub enum VitalStatus {
    Normal,
    Elevated,
    Depressed,
    Critical,
    Unreliable,  // Confidence below threshold
    Blanked,     // Motion artifact blanking
}

pub enum MotionLevel {
    Static,
    Minimal,  // Micro-movements (breathing, heartbeat)
    Low,      // Small movements (fidgeting)
    Moderate, // Walking
    High,     // Running, exercising
}
```

## 性能考量

### 时延预算

| 阶段 | 目标时延 | 实现机制 |
|-------|---------------|-----------|
| CSI 帧解析 | <50 us | 既有 `parse_esp32_frame()` |
| 预测门控 | <10 us | `PredictiveLayer.should_transmit()` 只做一次 RMS 计算 |
| 子载波加权 | <100 us | 注意力 O(n_subcarriers * dim)，GNN 单层前向 |
| 带通滤波 | <50 us | 向量化 FIR 滤波器 |
| 峰值检测 | <10 us | 简单阈值比较 |
| 异常检测 | <5 us | Welford 在线更新 + CUSUM |
| 分级存储写入 | <20 us | 量化 + memcpy |
| **单帧合计** | **<250 us** | **远在 100 Hz 下 10ms 帧预算之内** |

### 带宽削减

`ruvector-nervous-system::routing` 的 `PredictiveLayer` 在稳定信号上可减少 90-99% 带宽。生命体征监测的主要场景是被测者静止，多数 CSI 帧都可预测；只有带生理残差（呼吸、心跳）的帧能通过，计算量因此降低 10-100 倍。

### 内存预算

| 组件 | 估计内存 |
|-----------|-----------------|
| 环形缓冲（56 子载波 x 1024 样本 x 8 字节） | ~450 KB |
| 注意力权重（56 x 64 维） | ~14 KB |
| GNN 层（56 节点、单层） | ~25 KB |
| Hopfield 网络（128 维、100 个模板） | ~50 KB |
| TieredStore（4 MB 预算） | 4 MB |
| SONA 引擎（64 维隐层） | ~10 KB |
| **合计** | **~4.6 MB** |

这完全落在感知服务的目标占用之内（ADR-019：整个服务约 5 MB RAM）。

### 精度预期

基于 WiFi 生命体征相关文献与 rvdna 原语的质量：

| 指标 | 目标 | 说明 |
|--------|--------|-------|
| 呼吸率误差 | < 1.5 BPM（中位数） | 呼吸是较易提取的信号，胸腔位移大 |
| 心率误差 | < 5 BPM（中位数） | 更难，需要高信噪比与静止被测者 |
| 检测时延 | < 15 秒 | 初始化后得到首个可靠估计所需时间 |
| 运动抑制 | > 95% 真阳性 | 在大幅度运动期间正确消隐 |
| 误报异常率 | < 2% | CUSUM + z-score 配合保守阈值 |

## 安全考量

### 健康数据隐私

1. **不上传云端**：所有生命体征处理都在设备端完成，CSI 数据与提取出的生命体征不会离开本地网络。
2. **CSI 不含个人身份信息**：WiFi CSI 捕捉的是环境传播模式，而非生物识别标识；生命体征是统计量（速率），不是可识别个人的波形。
3. **本地存储加密**：可为 `TieredStore` 的冷层加静态加密封装。rvdna workspace 中既有的 `rvf-crypto` crate 提供后量子密码原语（ADR-007）。
4. **访问控制**：在多用户环境部署时，生命体征历史的 REST API 端点要求认证。
5. **数据留存**：`TieredStore` 块的 TTL 可配置。默认热层 5 分钟、温层 1 小时、冷层 24 小时过期。

### 医疗免责声明

从 WiFi CSI 提取的生命体征**不是医疗设备**，不得用于临床诊断。本系统提供的是健康级监测，适用于：
- 结合占用情况的暖通空调优化
- 养老看护活动监测（长时间静止时告警）
- 睡眠质量估计
- 灾害幸存者检测（ADR-001）

## 备选方案

### 方案 1：纯 FFT 提取（不使用 rvdna）

不使用 rvdna 组件，仅实现简单的带通滤波器与 FFT 峰值检测。

**否决原因**：该方案缺少自适应子载波选择、环境校准、精细的伪影抑制与异常检测，系统在跨环境、跨传感器布设时会很脆弱。而 rvdna 组件恰恰为这些难点提供了生产级原语。

### 方案 2：基于 Python 的生命体征模块

用 scipy 信号处理扩展既有 Python `ws_server.py`。

**否决原因**：ADR-020 已确立 Rust 为主后端。用 Python 增加生命体征处理与迁移方向相悖，还会让依赖负担翻倍；而 rvdna crate 本就是 Rust 原生且已 vendored。

### 方案 3：外部机器学习模型（ONNX）

训练深度学习模型从原始 CSI 提取生命体征，并通过 ONNX Runtime 运行。

**部分采纳**：阶段 3 可能引入基于 ONNX 的模型作为备选提取器。但主流水线采用可解释的信号处理（带通 + 峰值检测），因为：(a) 无需训练数据即可工作，(b) 便于调试，(c) 可在没有 ONNX Runtime 的资源受限边缘设备上运行。SONA 自适应层则在这条可解释流水线之上提供学习式优化。

### 方案 4：基于雷达的生命体征（不用 WiFi）

改用专用 FMCW 雷达硬件，而非 WiFi CSI。

**否决原因**：WiFi CSI 复用既有基础设施（商用路由器、ESP32），无需额外硬件；项目的核心价值主张正是无需额外基础设施的感知。

## 影响

### 正面影响

- **扩展感知能力**：无需额外硬件，项目即从存在/运动检测扩展到生命体征监测。
- **复用既有投入**：复用已 vendored 且已掌握的 rvdna crate，不引入新依赖。
- **生产级原语**：PredictiveLayer、TieredStore、CUSUM、Hopfield 匹配、SONA 自适应都是经过测试、性能特征明确的组件。
- **可组合架构**：每一阶段都可独立测试与替换。
- **边缘友好**：4.6 MB 内存占用与单帧 <250 us 时延适配 ESP32 级设备。
- **保护隐私**：全程本地处理，不依赖云端。

### 负面影响

- **信噪比挑战**：基于 WiFi 的心率检测信噪比天生偏低，嘈杂环境下置信度可能频繁为 "Unreliable"。
- **需要校准**：每个部署环境的多径特征都不同。SONA 自适应可缓解，但需要 15-60 秒的初始校准期。
- **单人限制**：从单条 TX-RX 链路分离多人生命体征仍是开放研究问题。本设计假设感知区内只有一名主导被测者。
- **新增 crate 依赖**：生命体征模块给 workspace 增加 6 个 rvdna crate 依赖，编译时间变长。
- **非医疗级**：不能替代临床监护设备，必须明确标注为健康级。

## 实施路线图

### 阶段 1：核心流水线（第 1-2 周）

- 建立 `wifi-densepose-vitals` crate 与模块结构
- 实现带 `PredictiveLayer` 门控的 `CsiVitalPreprocessor`
- 实现带带通滤波与峰值检测的 `BreathingExtractor`
- 实现 `VitalAnomalyDetector`（移植 `biomarker_stream::StreamProcessor` 模式）
- 用合成 CSI 数据编写基础单元测试
- 与 `wifi-densepose-sensing-server` 的 WebSocket 集成

### 阶段 2：增强提取（第 3-4 周）

- 用 `ruvector-attention` 实现 `AttentionSubcarrierWeighter`
- 实现带 `ModernHopfield` 模板匹配的 `HeartRateExtractor`
- 实现带 `GlobalWorkspace` 竞争机制的 `MotionArtifactRejector`
- 用 `TieredStore` 实现 `VitalSignStore`
- 用 ESP32 CSI 数据做端到端集成测试

### 阶段 3：自适应与 UI（第 5-6 周）

- 实现 `SonaVitalAdapter` 做环境校准
- 增加基于 GNN 的子载波相关分析
- 扩展 UI 的 SensingTab，加入生命体征可视化
- 增加生命体征历史的 REST API 端点
- 性能基准测试与优化

### 阶段 4：加固（第 7-8 周）

- 用 CUSUM 变点检测实现呼吸暂停/心动过速告警
- 多环境测试与 SONA 训练
- 安全审查（数据留存、访问控制）
- 文档与 API 参考
- 可选：基于 ONNX 的备选提取器

## Windows WiFi 模式增强

当前 Windows WiFi 模式（`--source wifi`）用 `netsh wlan show interfaces` 每个 tick 提取单个 RSSI/信号百分比值，得到的是伪单子载波帧，不足以做多子载波生命体征提取。不过 ruQu 与 rvdna 原语仍能增强该模式：

### Windows WiFi 模式下可行的能力

| 能力 | 实现机制 | 质量 |
|---|---|---|
| **存在检测** | 用 `DriftDetector` 观察 RSSI 随时间的变化 | 良好 —— 有人进出时 ruQu 能检出 StepChange |
| **粗略呼吸估计** | RSSI 在 0.1-0.5 Hz 上的时间调制 | 一般 —— 单一信号源，需要 30 秒以上静止 RSSI |
| **环境漂移** | 对 RSSI 序列使用 `AdaptiveThresholds` + `DriftDetector` | 良好 —— 可检测线性趋势、阶跃变化、周期性干扰 |
| **信号质量门控** | ruQu `FilterPipeline` 拦截不可靠读数 | 良好 —— 在 WiFi 波动期间抑制误报读数 |

### Windows WiFi 模式下不可行的能力

| 能力 | 不可行原因 |
|---|---|
| 心率提取 | 需要多子载波 CSI 相位相干性（0.1-0.5 mm 位移分辨率） |
| 多人分离 | 单个全向 RSSI 无法区分空间上的信号源 |
| 子载波注意力加权 | 只有 1 个子载波可用 |
| GNN 相关图 | 至少需要 2 个子载波节点 |

### 增强策略（Windows WiFi）

```rust
// 在 windows_wifi_task 中，采集 RSSI 之后：
// 把 RSSI 时间序列送入简化的生命体征流水线
let mut wifi_vitals = WifiRssiVitalEstimator {
    // 用 ruQu 自适应阈值做 RSSI 门控
    adaptive: AdaptiveThresholds::new(LearningConfig::conservative()),
    // 对 RSSI 做漂移检测（识别存在性事件）
    drift: DriftDetector::new(60), // 60 samples = ~30 seconds at 2 Hz
    // 基于 RSSI 时间调制的简易呼吸估计器
    breathing_buffer: RingBuffer::new(120), // 60 seconds of RSSI history
};

// 每个 tick：
wifi_vitals.breathing_buffer.push(rssi_dbm);
wifi_vitals.drift.push(rssi_dbm);

// 尝试从 RSSI 振荡中粗估呼吸率
let rr_estimate = wifi_vitals.estimate_breathing_from_rssi();

// 用 ruQu 做质量门控
let verdict = wifi_vitals.adaptive.current_thresholds();
// 仅在信号质量达标时输出
let vitals = VitalReading {
    respiratory_rate: VitalEstimate {
        value_bpm: rr_estimate.unwrap_or(0.0),
        confidence: if rr_estimate.is_some() { 0.3 } else { 0.0 },
        status: VitalStatus::Unreliable, // Always marked as low-confidence
        ..
    },
    heart_rate: VitalEstimate {
        confidence: 0.0,
        status: VitalStatus::Unreliable, // Cannot estimate from single RSSI
        ..
    },
    ..
};
```

**结论：** Windows WiFi 模式借助 ruQu 的自适应阈值与漂移检测器，可获得存在/漂移检测与粗略呼吸估计；要有意义的生命体征（HR、高置信度 RR）仍需 ESP32 CSI。

## 实施状态（2026-02-28）

### 已完成：ADR-022 Windows WiFi 多 BSSID 流水线

`wifi-densepose-wifiscan` crate 把上述 Windows WiFi 增强策略实现为完整的 8 阶段流水线（ADR-022 阶段 2）。所有阶段均为纯 Rust，不依赖外部 vendor 代码：

| 阶段 | 模块 | 实现 | 测试数 |
|-------|--------|---------------|-------|
| 1. 预测门控 | `predictive_gate.rs` | 基于 EMA 的残差滤波（取代 `PredictiveLayer`） | 4 |
| 2. 注意力加权 | `attention_weighter.rs` | Softmax 点积注意力（取代 `ScaledDotProductAttention`） | 4 |
| 3. 空间相关 | `correlator.rs` | Pearson 相关 + BFS 聚类 | 5 |
| 4. 运动估计 | `motion_estimator.rs` | 加权方差 + EMA 平滑 | 6 |
| 5. 呼吸提取 | `breathing_extractor.rs` | IIR 带通（0.1-0.5 Hz）+ 过零检测 | 6 |
| 6. 质量门控 | `quality_gate.rs` | 受 ruQu 启发的三滤波器（结构/偏移/证据） | 8 |
| 7. 指纹匹配 | `fingerprint_matcher.rs` | 余弦相似度模板（取代 `ModernHopfield`） | 8 |
| 8. 编排器 | `orchestrator.rs` | 组合阶段 1-7 的 `WindowsWifiPipeline` 领域服务 | 7 |

**合计：124 个测试通过，0 个失败。**

领域模型（阶段 1）包含：
- `MultiApFrame`：含幅度、相位、方差、历史的多 BSSID 帧值对象
- `BssidRegistry`：用 Welford 滚动统计管理 BSSID 生命周期的聚合根
- `NetshBssidScanner`：解析 `netsh wlan show networks mode=bssid` 输出的适配器
- `EnhancedSensingResult`：含运动、呼吸、姿态、质量指标的流水线输出

### 待完成：ADR-021 专用生命体征 crate

`wifi-densepose-vitals` crate（ESP32 CSI 级生命体征）尚未实现，以下能力依赖它：
- 从多子载波 CSI 相位相干性中提取心率
- 多人生命体征分离
- 基于 SONA 的环境自适应
- 带分级时序压缩的 `VitalSignStore`

## 实施备注

### 2026-06 —— ESP32 边缘生命体征：人数高估与存在性抖动（#998、#996）

设备端边缘路径（`firmware/esp32-csi-node/main/edge_processing.c`，ADR-039 的 `0xC5110002` 包）修复了两处健壮性缺陷。改动只涉及*布尔/计数输出逻辑*，不涉及底层 CSI 信号处理数学，也**不**构成经过精度验证的结论——相对标注真值的真实人数与存在检测精度仍受硬件/数据门控（COM9 ESP32-S3 + 标注采集）。

- **#998 `n_persons` 高估（单人却报 4 人）。** `update_multi_person_vitals()` 把 top-K 子载波分成 `top_k_count/2` 组，并把*每一*组都标为 `active`，于是一个人的多径始终被读成满额 `EDGE_MAX_PERSONS`。现通过两个纯函数 `count_distinct_persons()` / `person_count_debounce()` 增加了能量门控（`EDGE_PERSON_MIN_ENERGY_RATIO`）、空间去重（`EDGE_PERSON_MIN_SC_SEP`）与持续性消抖（`EDGE_PERSON_PERSIST_FRAMES`）。
- **#996 约 50 cm 处存在标志抖动。** 对含噪 `presence_score` 做单阈值比较，会在边界处反复跳变。现改为施密特触发器 + 清除消抖（`presence_flag_update()`，常量 `EDGE_PRESENCE_HYST_RATIO` / `EDGE_PRESENCE_CLEAR_FRAMES`）；`presence_score` 保持不变，仍会输出供消费侧自行设阈值。

两者都由可在主机构建的 C99 测试固定下来：`firmware/esp32-csi-node/test/test_vitals_count_presence.c`（`make run_vitals`）。具体阈值是已文档化的常量，仍待在设备上对照真值校准。

### 2026-06 —— Rust `wifi-densepose-vitals`：IIR 滤波器 NaN/inf 自愈（ADR-158 §A1）

对 Rust 提取 crate 做正确性/安全审查时，发现一个与上述固件健壮性问题同类的真实缺陷。`breathing.rs` 与 `heartrate.rs` 中的二阶谐振器 `bandpass_filter` 会把每次输出 `y[n]` 锁存进滤波器状态（`y1`/`y2`）。来自损坏 CSI 帧的单个非有限幅度残差会产生 NaN `output` 并写入状态；既有 `extract()` 的 `is_finite()` 保护只是把这一个样本从历史缓冲里丢掉，**却从未清理被污染的状态**，于是之后所有输出都保持 NaN、同样被丢弃，滑动窗口历史再也无法重新填满——呼吸**与**心率提取就此静默失效（永远返回 `None`），直到调用 `reset()`。在告警路径上，这属于与安全相关的拒绝服务（一帧坏数据即可让生命体征监测停摆且不报任何错误）。

修复：`bandpass_filter` 算出非有限 `output` 时，把 IIR 状态重置为默认值并返回 `0.0`，谐振器在下一个干净帧即可自愈（该 `0.0` 仍会被调用方的有限性检查丢弃，不会有伪样本进入历史）。这与校准 NaN 缺陷（ADR-154 §3）形状相同——先前的加固守住了*历史边界*，却没守住*滤波器状态边界*。由 `breathing::tests::nan_frame_does_not_permanently_poison_filter`、`breathing::tests::inf_mid_stream_does_not_freeze_history`、`heartrate::tests::nan_frame_does_not_permanently_poison_filter` 固定（修复前全部 FAIL，通过回退验证）。审查还把 HR 生理合理区间从魔法数改成具名常量 `HR_PLAUSIBLE_MIN_BPM`/`HR_PLAUSIBLE_MAX_BPM`（数值不变，仍为 40/180 BPM），并补了一条「伪造生命体征」负例（`pure_noise_is_never_reported_valid` —— 宽带噪声绝不产生临床级 `Valid` HR，提取器会如实返回低置信度 `Unreliable`）。有证据地确认了各洁净维度：平坦/静默输入 → `None`；纯噪声 → 低置信度 `Unreliable`，绝不为 `Valid`；富含谐波但无心脏分量的呼吸 → 低置信度，而非自信的错误 HR；越界 BPM 被合理性钳位拒绝。

## 参考资料

- Ramsauer et al. (2020). "Hopfield Networks is All You Need." ICLR 2021.（ModernHopfield 表述来源）
- Fries (2015). "Rhythms for Cognition: Communication through Coherence." Neuron.（OscillatoryRouter 依据）
- Bellec et al. (2020). "A solution to the learning dilemma for recurrent networks of spiking neurons." Nature Communications.（E-prop 在线学习依据）
- Baars (1988). "A Cognitive Theory of Consciousness." Cambridge UP.（GlobalWorkspace 模型依据）
- Liu et al. (2023). "WiFi-based Contactless Breathing and Heart Rate Monitoring." IEEE Sensors Journal.（非接触式呼吸与心率监测文献）
- Wang et al. (2022). "Robust Vital Signs Monitoring Using WiFi CSI." ACM MobiSys.（基于 WiFi CSI 的鲁棒生命体征监测）
- Widar 3.0 (MobiSys 2019). "Zero-Effort Cross-Domain Gesture Recognition with WiFi."（BVP 提取依据）
