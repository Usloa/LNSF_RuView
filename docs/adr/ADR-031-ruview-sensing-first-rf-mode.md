# ADR-031：RuView 项目 —— 面向多基地保真度增强的感知优先 RF 模式

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-02 |
| **决策者** | ruv |
| **代号** | **RuView** -- RuVector 视点集成增强 |
| **关联文档** | ADR-012（ESP32 网格）、ADR-014（SOTA 信号）、ADR-016（RuVector 集成）、ADR-017（RuVector 信号 + MAT）、ADR-021（生命体征）、ADR-024（AETHER 嵌入）、ADR-027（MERIDIAN 跨环境） |

---

## 1. 背景

### 1.1 单视点保真度上限

当前 WiFi DensePose 采用单发射-接收对（或单节点接收）工作，由此产生三个根本性限制：

- **人体自遮挡**：躯干后方的肢体对单一视点不可见。
- **深度歧义**：沿 RF 传播轴（靠近/远离接收机）的运动几乎不产生相位变化。
- **多人混淆**：距离相近但角度不同的两个人会产生重叠的 CSI 特征。

ESP32 网格（ADR-012）通过 3-6 个节点的特征级融合部分缓解了这一问题，但特征级融合无法学习最优融合权重 —— 它依赖手工设计的聚合方式（最大值、均值、相干求和）。

### 1.2 三个保真度杠杆

1. **带宽**：带宽越大，多径可分辨性越好。目前受限于 20 MHz（ESP32 HT20）。商用 802.11ac/ax AP 可提供更宽的 80/160 MHz 信道。
2. **载波频率**：频率越高，相位灵敏度越高。2.4 GHz 观测宏观动作；5 GHz 观测微动作；60 GHz 可观测生命体征。
3. **视点**：来自不同角度的更多视点可降低几何歧义。这正是 RuView 所撬动的杠杆。

### 1.3 为什么叫「感知优先 RF 模式」

RuView 并不是一项新的 WiFi 标准，而是运行在现有芯片、频段与法规之上的感知优先协议。核心思路是：不升级 RF 硬件，而是通过协同多台商用接收机来提升可观测性。

### 1.4 已有基础

| 组件 | ADR | 当前状态 |
|-----------|-----|---------------|
| ESP32 网格与特征级融合 | ADR-012 | Implemented（固件 + 聚合器） |
| SOTA 信号处理（Hampel、Fresnel、BVP、频谱图） | ADR-014 | Implemented |
| RuVector 训练流水线（5 个 crate） | ADR-016 | Complete |
| RuVector 信号 + MAT 集成（7 个接入点） | ADR-017 | Accepted |
| 生命体征检测流水线 | ADR-021 | Partially implemented |
| AETHER 对比嵌入 | ADR-024 | Proposed |
| MERIDIAN 跨环境泛化 | ADR-027 | Proposed |

RuView 填补了这一空白：使用可学习的注意力权重实现**跨视点嵌入融合**。

---

## 2. 决策

引入 RuView 作为跨视点嵌入融合层，作用于 AETHER 生成的每视点嵌入之上。RuView 新增一个限界上下文（ViewpointFusion），并扩展三个现有 crate。

### 2.1 核心架构

```
+-----------------------------------------------------------------+
|                    RuView Multistatic Pipeline                    |
+-----------------------------------------------------------------+
|                                                                   |
|  +----------+  +----------+  +----------+  +----------+          |
|  | Node 1   |  | Node 2   |  | Node 3   |  | Node N   |          |
|  | ESP32-S3 |  | ESP32-S3 |  | ESP32-S3 |  | ESP32-S3 |          |
|  |          |  |          |  |          |  |          |          |
|  | CSI Rx   |  | CSI Rx   |  | CSI Rx   |  | CSI Rx   |          |
|  +----+-----+  +----+-----+  +----+-----+  +----+-----+          |
|       |              |              |              |               |
|       v              v              v              v               |
|  +--------------------------------------------------------+      |
|  |              Per-Viewpoint Signal Processing             |      |
|  |  Phase sanitize -> Hampel -> BVP -> Subcarrier select   |      |
|  |              (ADR-014, unchanged per viewpoint)          |      |
|  +----------------------------+---------------------------+      |
|                               |                                   |
|                               v                                   |
|  +--------------------------------------------------------+      |
|  |              Per-Viewpoint AETHER Embedding              |      |
|  |  CsiToPoseTransformer -> 128-d contrastive embedding    |      |
|  |              (ADR-024, one per viewpoint)                |      |
|  +----------------------------+---------------------------+      |
|                               |                                   |
|                [emb_1, emb_2, ..., emb_N]                         |
|                               |                                   |
|                               v                                   |
|  +--------------------------------------------------------+      |
|  |        * RuView Cross-Viewpoint Fusion *                |      |
|  |                                                          |      |
|  |  Q = W_q * X,  K = W_k * X,  V = W_v * X              |      |
|  |  A = softmax((QK^T + G_bias) / sqrt(d))                |      |
|  |  fused = A * V                                          |      |
|  |                                                          |      |
|  |  G_bias: geometric bias from viewpoint pair geometry    |      |
|  |  (ruvector-attention: ScaledDotProductAttention)         |      |
|  +----------------------------+---------------------------+      |
|                               |                                   |
|                        fused_embedding                            |
|                               |                                   |
|                               v                                   |
|  +--------------------------------------------------------+      |
|  |              DensePose Regression Head                   |      |
|  |  Keypoint head: [B,17,H,W]                             |      |
|  |  Part/UV head: [B,25,H,W] + [B,48,H,W]                |      |
|  +--------------------------------------------------------+      |
+-----------------------------------------------------------------+
```

### 2.2 TDM 感知协议

- 协调器（聚合器）在每个周期开始时广播同步信标。
- 各节点在分配的时隙内发射，其余所有节点接收。
- 6 个节点 x 1.4 ms/时隙 = 8.4 ms 周期 -> 聚合约 119 Hz，每个双基地对约 20 Hz。
- 时钟漂移在特征级处理（不做跨节点相位对齐）。

### 2.3 几何偏置矩阵

几何偏置 `G_bias` 编码视点对之间的空间关系：

```
G_bias[i,j] = w_angle * cos(theta_ij) + w_dist * exp(-d_ij / d_ref)
```

其中：

- `theta_ij` = 视点 i 与视点 j 之间的夹角（以房间中心为顶点）
- `d_ij` = 节点 i 与节点 j 之间的基线距离
- `w_angle`、`w_dist` = 可学习权重
- `d_ref` = 参考距离（房间对角线 / 2）

这使注意力机制能够学到：相距较远且相互正交的视点比聚集在一起的视点更具互补性。

### 2.4 相干性门控的环境更新

```rust
/// 仅当相位相干性超过阈值时才更新环境模型。
pub fn coherence_gate(
    phase_diffs: &[f32],  // delta-phi over T recent frames
    threshold: f32,        // typically 0.7
) -> bool {
    // 单位相量的复数均值
    let (sum_cos, sum_sin) = phase_diffs.iter()
        .fold((0.0f32, 0.0f32), |(c, s), &dp| {
            (c + dp.cos(), s + dp.sin())
        });
    let n = phase_diffs.len() as f32;
    let coherence = ((sum_cos / n).powi(2) + (sum_sin / n).powi(2)).sqrt();
    coherence > threshold
}
```

### 2.5 两条实现路径

| 路径 | 硬件 | 带宽 | 每视点速率 | 目标级别 |
|------|----------|-----------|-------------------|-------------|
| **ESP32 多基地方案** | 6 个 ESP32-S3（$84） | 20 MHz（HT20） | 20 Hz | Silver |
| **Cognitum + RF 方案** | Cognitum v1 + LimeSDR | 20-160 MHz | 20-100 Hz | Gold |

ESP32 路径：商用器件，当下即可实现，目标为 Silver 级别（跟踪 + 姿态质量）。
Cognitum 路径：保真度更高，目标为 Gold 级别（跟踪 + 姿态 + 生命体征）。

---

## 3. DDD 设计

### 3.1 新增限界上下文：ViewpointFusion

**聚合根：`MultistaticArray`**

```rust
pub struct MultistaticArray {
    /// 阵列部署的唯一 ID
    id: ArrayId,
    /// 视点几何（节点位置、朝向）
    geometry: ArrayGeometry,
    /// TDM 调度（时隙分配、周期时长）
    schedule: TdmSchedule,
    /// 活跃的视点嵌入（每节点最新值）
    viewpoints: Vec<ViewpointEmbedding>,
    /// 融合后的输出嵌入
    fused: Option<FusedEmbedding>,
    /// 相干性门控状态
    coherence_state: CoherenceState,
}
```

**实体：`ViewpointEmbedding`**

```rust
pub struct ViewpointEmbedding {
    /// 源节点 ID
    node_id: NodeId,
    /// AETHER 嵌入向量（128 维）
    embedding: Vec<f32>,
    /// 几何元数据
    azimuth: f32,      // radians from array center
    elevation: f32,    // radians
    baseline: f32,     // meters from centroid
    /// 采集时间戳
    timestamp: Instant,
    /// 信号质量
    snr_db: f32,
}
```

**值对象：`GeometricDiversityIndex`**

```rust
pub struct GeometricDiversityIndex {
    /// GDI = (1/N) sum min_{j!=i} |theta_i - theta_j|
    value: f32,
    /// 有效独立视点数（经相关性折减后）
    n_effective: f32,
    /// 最差的视点对（冗余度最高）
    worst_pair: (NodeId, NodeId),
}
```

**领域事件：**

```rust
pub enum ViewpointFusionEvent {
    ViewpointCaptured { node_id: NodeId, timestamp: Instant, snr_db: f32 },
    TdmCycleCompleted { cycle_id: u64, viewpoints_received: usize },
    FusionCompleted { fused_embedding: Vec<f32>, gdi: f32 },
    CoherenceGateTriggered { coherence: f32, accepted: bool },
    GeometryUpdated { new_gdi: f32, n_effective: f32 },
}
```

### 3.2 扩展的限界上下文

**信号（wifi-densepose-signal）：**
- 新增服务：`CrossViewpointSubcarrierSelection`
  - 通过 ruvector-mincut 在所有视点间求敏感子载波集合的共识。
  - 输入：各视点的敏感度评分。输出：全局敏感 + 局部敏感的划分。

**硬件（wifi-densepose-hardware）：**
- 新增协议：`TdmSensingProtocol`
  - 协调器逻辑：信标生成、时隙调度、时钟漂移补偿。
  - 事件：`TdmSlotCompleted { node_id, slot_index, capture_quality }`

**训练（wifi-densepose-train）：**
- 新增模块：`ruview_metrics.rs`
  - 三指标验收测试：PCK/OKS（关节误差）、MOTA（多人分离）、生命体征精度。
  - 分级通过/失败判定：Bronze/Silver/Gold。

---

## 4. 实施计划（文件级）

### 4.1 阶段 1：ViewpointFusion 核心（新增文件）

| 文件 | 用途 | RuVector crate |
|------|---------|---------------|
| `crates/wifi-densepose-ruvector/src/viewpoint/mod.rs` | 模块根，重导出 | -- |
| `crates/wifi-densepose-ruvector/src/viewpoint/attention.rs` | 带几何偏置的跨视点缩放点积注意力 | ruvector-attention |
| `crates/wifi-densepose-ruvector/src/viewpoint/geometry.rs` | GeometricDiversityIndex、Cramer-Rao 下界估计 | ruvector-solver |
| `crates/wifi-densepose-ruvector/src/viewpoint/coherence.rs` | 面向环境稳定性的相干性门控 | --（纯数学） |
| `crates/wifi-densepose-ruvector/src/viewpoint/fusion.rs` | MultistaticArray 聚合根，编排融合流水线 | ruvector-attention + ruvector-attn-mincut |

### 4.2 阶段 2：信号处理扩展

| 文件 | 用途 | RuVector crate |
|------|---------|---------------|
| `crates/wifi-densepose-signal/src/cross_viewpoint.rs` | 通过最小割实现跨视点子载波共识 | ruvector-mincut |

### 4.3 阶段 3：硬件协议扩展

| 文件 | 用途 | RuVector crate |
|------|---------|---------------|
| `crates/wifi-densepose-hardware/src/esp32/tdm.rs` | TDM 感知协议协调器 | --（协议逻辑） |

### 4.4 阶段 4：训练与指标

| 文件 | 用途 | RuVector crate |
|------|---------|---------------|
| `crates/wifi-densepose-train/src/ruview_metrics.rs` | 三指标验收测试（PCK/OKS、MOTA、生命体征精度） | ruvector-mincut（人员匹配） |

---

## 5. 三指标验收测试

### 5.1 指标 1：关节误差（PCK / OKS）

| 判据 | 阈值 |
|-----------|-----------|
| PCK@0.2（全部 17 个关键点） | >= 0.70 |
| PCK@0.2（躯干：肩部 + 髋部） | >= 0.80 |
| 平均 OKS | >= 0.50 |
| 躯干抖动 RMS（10 秒窗口） | < 3 cm |
| 单关键点最大误差（第 95 百分位） | < 15 cm |

### 5.2 指标 2：多人分离

| 判据 | 阈值 |
|-----------|-----------|
| 受试人数 | 2 |
| 采集速率 | 20 Hz |
| 跟踪时长 | 10 分钟 |
| 身份互换（MOTA ID-switch） | 0 |
| 轨迹碎片化比例 | < 0.05 |
| 虚假轨迹创建 | 0/min |

### 5.3 指标 3：生命体征灵敏度

| 判据 | 阈值 |
|-----------|-----------|
| 呼吸检测（6-30 BPM） | +/- 2 BPM |
| 呼吸频段 SNR（0.1-0.5 Hz） | >= 6 dB |
| 心跳检测（40-120 BPM） | +/- 5 BPM（期望值） |
| 心跳频段 SNR（0.8-2.0 Hz） | >= 3 dB（期望值） |
| 微动分辨率 | 3 m 处 1 mm |

### 5.4 分级通过/失败判定

| 级别 | 要求 | 部署门槛 |
|------|-------------|-----------------|
| Bronze | 指标 2 | 原型演示 |
| Silver | 指标 1 + 2 | 量产候选 |
| Gold | 全部三项 | 完整部署 |

---

## 6. 影响

### 6.1 正面

- **根本性的几何改善**：视点多样性减少了人体自遮挡与深度歧义 —— 这些是物理限制，而非模型限制。
- **复用现有芯片**：ESP32-S3 与商用 WiFi，Silver 级别无需定制 RF 硬件。
- **可学习的融合权重**：嵌入级融合（第 3 层）优于手工设计的特征级融合（第 2 层）。
- **与现有 ADR 可组合**：AETHER（每视点）、MERIDIAN（跨环境）与 RuView（跨视点）彼此正交 —— 可自由组合。
- **与 IEEE 802.11bf 对齐**：TDM 协议可映射到 802.11bf 感知会话，便于未来迁移到符合标准的 AP。
- **商用价格水平**：6 节点 Silver 级别部署成本为 $84。

### 6.2 负面

- **TDM 速率下降**：N 个视点会使每视点速率降为 1/N。6 个节点在 120 Hz 聚合速率下，每个视点只有 20 Hz。
- **聚合器更复杂**：嵌入融合 + 几何偏置学习在每视点 AETHER 模型之上新增约 25K 参数。
- **需要规划布点**：几何多样性指数优化要求有意识地布置节点（而非随机散放）。
- **时钟漂移限制 TDM 精度**：ESP32 晶振漂移（20-50 ppm）把时隙精度限制在约 1 ms，这对特征级融合足够，但不足以做信号级相干合并。
- **训练数据**：跨视点训练需要多接收机 CSI 采集，而现有公开数据集（MM-Fi、Wi-Pose）中没有这类数据。

### 6.3 与其他 ADR 的交互

| ADR | 交互关系 |
|-----|------------|
| ADR-012（ESP32 网格） | RuView 将聚合器从特征级融合扩展到嵌入级融合；TDM 协议取代简单的 UDP 采集 |
| ADR-014（SOTA 信号） | 每视点信号处理保持不变；新增跨视点子载波共识 |
| ADR-016/017（RuVector） | 全部 5 个 ruvector crate 新增跨视点操作（见第 4 节） |
| ADR-021（生命体征） | 多视点带来的 SNR 提升直接有利于生命体征提取（Gold 级别目标） |
| ADR-024（AETHER） | 每视点 AETHER 嵌入是 RuView 融合的输入；AETHER 为必需项 |
| ADR-027（MERIDIAN） | 跨环境（MERIDIAN）与跨视点（RuView）相互正交；MERIDIAN 处理房间迁移，RuView 处理房间内几何 |

---

## 7. 参考资料

1. IEEE 802.11bf（2024 年）。"WLAN Sensing." IEEE 标准协会。
2. Kotaru, M. 等（2015 年）。"SpotFi: Decimeter Level Localization Using WiFi." SIGCOMM 2015。
3. Zeng, Y. 等（2019 年）。"FarSense: Pushing the Range Limit of WiFi-based Respiration Sensing with CSI Ratio of Two Antennas." MobiCom 2019。
4. Zheng, Y. 等（2019 年）。"Zero-Effort Cross-Domain Gesture Recognition with Wi-Fi."（Widar 3.0）MobiSys 2019。
5. Yan, K. 等（2024 年）。"Person-in-WiFi 3D: End-to-End Multi-Person 3D Pose Estimation with Wi-Fi." CVPR 2024。
6. Zhou, Y. 等（2024 年）。"AdaPose: Towards Cross-Site Device-Free Human Pose Estimation with Commodity WiFi." IEEE IoT Journal。arXiv:2309.16964。
7. Zhou, R. 等（2025 年）。"DGSense: A Domain Generalization Framework for Wireless Sensing." arXiv:2502.08155。
8. Chen, X. & Yang, J.（2025 年）。"X-Fi: A Modality-Invariant Foundation Model for Multimodal Human Sensing." ICLR 2025。arXiv:2410.10167。
9. AM-FM（2026 年）。"AM-FM: A Foundation Model for Ambient Intelligence Through WiFi." arXiv:2602.11200。
10. Chen, L. 等（2026 年）。"PerceptAlign: Breaking Coordinate Overfitting." arXiv:2601.12252。
11. Li, J. & Stoica, P.（2007 年）。"MIMO Radar with Colocated Antennas." IEEE Signal Processing Magazine, 24(5):106-114。
12. ADR-012 至 ADR-027（内部文档）。
