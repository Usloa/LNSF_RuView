# ADR-029：RuvSense 项目 —— 面向多基地 WiFi DensePose 的感知优先 RF 模式

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-02 |
| **更新日期** | 2026-10-04 —— 只有当每一帧都声明同一个共享相位参考时，多基地融合才会跨节点合并相位；彼此独立的 ESP32 节点与仅支持幅度的服务端桥接只融合幅度，并报告原因（`/health/ready` 中的 `phase_fusion`，issue #1752）。|
| **决策者** | ruv |
| **代号** | **RuvSense** —— 面向多基地保真度的 RuVector 增强感知 |
| **关联项** | ADR-012（ESP32 网格）、ADR-014（SOTA 信号处理）、ADR-016（RuVector 训练）、ADR-017（RuVector Signal+MAT）、ADR-018（ESP32 实现）、ADR-024（AETHER 嵌入）、ADR-026（幸存者轨迹生命周期）、ADR-027（MERIDIAN 泛化）|

---

## 1. 背景

### 1.1 保真度差距

当前 WiFi-DensePose 已能从单个 ESP32 AP 实现可用的姿态估计，但有三项保真度指标阻碍其投入生产部署：

| 指标 | 现状（单台 ESP32）| 要求（生产环境）| 根本原因 |
|--------|------------------------|----------------------|------------|
| 躯干关键点抖动 | ~15cm RMS | <3cm RMS | 单一视角、20 MHz 带宽、缺少时域平滑 |
| 多人分离 | 超过 2 人即失败，频繁发生 ID 互换 | 4 人以上、10 分钟内零互换 | 仅 1 条 TX-RX 链路导致欠定；缺少个体专属特征 |
| 微小运动灵敏度 | 只能感知大幅动作 | 3m 处呼吸、1.5m 处心跳 | 2.4 GHz 下相位灵敏度不足；本底噪声过高 |
| 更新率 | 有效约 ~10 Hz | 20 Hz | 单信道串行 CSI 采集 |
| 时域稳定性 | 数小时内发生漂移 | 数天保持稳定 | 没有相干性门控；模型吸收了环境漂移 |

### 1.2 核心思路：在现有芯片上实现感知优先 RF 模式

并不需要发明新的 WiFi 标准。更优解是一种**感知优先的 RF 模式**，直接依托现有芯片（ESP32-S3）、现有频段（2.4/5 GHz）与现有规范（802.11n NDP 帧）。保真度的提升来自三个物理杠杆：

1. **带宽**：在 2.4 GHz 的 1/6/11 信道间跳变，把有效带宽从 20 MHz 提升到 60 MHz，多径分离能力提升 3 倍
2. **载频**：双频段感知（2.4 + 5 GHz）把对微小运动的相位灵敏度提高一倍
3. **视角**：多基地 ESP32 网格（4 个节点 = 12 条 TX-RX 链路）提供 360 度几何多样性

### 1.3 验收测试

**两人在同一房间内，20 Hz 更新率，轨迹稳定保持 10 分钟，无身份互换，躯干关键点抖动低。**

量化指标：
- 躯干关键点抖动 < 30mm RMS（髋部、肩部、脊柱）
- 600 秒（12,000 帧）内零身份互换
- 20 Hz 输出率（50 ms 周期）
- 3m 处呼吸 SNR > 10dB（验证微小运动灵敏度）

---

## 2. 决策

### 2.1 架构总览

在 `wifi-densepose-signal` 中把 RuvSense 实现为一个新的限界上下文，由 6 个模块组成：

```
wifi-densepose-signal/src/ruvsense/
├── mod.rs              // Module exports, RuvSense pipeline orchestrator
├── multiband.rs        // Multi-band CSI frame fusion (§2.2)
├── phase_align.rs      // Cross-channel phase alignment (§2.3)
├── multistatic.rs      // Multi-node viewpoint fusion (§2.4)
├── coherence.rs        // Coherence metric computation (§2.5)
├── coherence_gate.rs   // Gated update policy (§2.6)
└── pose_tracker.rs     // 17-keypoint Kalman tracker with re-ID (§2.7)
```

### 2.2 信道跳变固件（ESP32-S3）

修改 ESP32 固件（`firmware/esp32-csi-node/main/csi_collector.c`），使其按可配置的驻留时间在不重叠的信道间循环：

```c
// 信道跳变表（启动时从 NVS 填充）
static uint8_t s_hop_channels[6] = {1, 6, 11, 36, 40, 44};
static uint8_t s_hop_count = 3;   // default: 2.4 GHz only
static uint32_t s_dwell_ms = 50;  // 50ms per channel
```

在 100 Hz 原始 CSI 速率、每信道 50 ms 驻留、共 3 个信道的条件下，每个信道约产生 ~33 帧/秒。现有 ADR-018 二进制帧格式已在偏移 8 处携带 `channel_freq_mhz`，因此无需改动线格式。

> **注（Issue #127 修复）：** 在混杂模式下，CSI 回调每秒触发 100-500+ 次，远超信道驻留速率。固件现在把 UDP 发送限速到 50 Hz，并在 lwIP 缓冲区耗尽时施加 100 ms 的 ENOMEM 退避。这对负载下的稳定信道跳变至关重要。

**NDP 帧注入：** `esp_wifi_80211_tx()` 按 GPIO 触发的间隔注入确定性的 Null Data Packet 帧（仅前导码、无载荷、约 ~24 us 空中时间）。这正是感知优先：射频发射的首要目的是 CSI 测量，而非数据通信。

### 2.3 多频段帧融合

把各信道的 CSI 帧聚合为一张宽带虚拟快照：

```rust
/// 单节点单时隙融合后的多频段 CSI。
pub struct MultiBandCsiFrame {
    pub node_id: u8,
    pub timestamp_us: u64,
    /// 每个信道一行 canonical-56 数据，按中心频率排序。
    pub channel_frames: Vec<CanonicalCsiFrame>,
    /// 各信道行对应的中心频率（MHz）。
    pub frequencies_mhz: Vec<u32>,
    /// 跨信道相干性得分（0.0-1.0）。
    pub coherence: f32,
}
```

跨信道相位对齐使用 `ruvector-solver::NeumannSolver` 求解 ESP32 本振在信道跳变过程中引入的、随信道变化的相位旋转。系统关系如下：

```
[Φ₁, Φ₆, Φ₁₁] = [Φ_body + δ₁, Φ_body + δ₆, Φ_body + δ₁₁]
```

NeumannSolver 从静态子载波分量（其人体引起的相移应为零）拟合出 `δ` 偏移量，然后将其消除。

### 2.4 多基地视角融合

使用 N 个 ESP32 节点时，每个时隙采集 N 个 `MultiBandCsiFrame`，并借助几何多样性进行融合：

**TDMA 感知调度（4 个节点）：**

| 时隙 | TX | RX₁ | RX₂ | RX₃ | 时长 |
|------|-----|-----|-----|-----|----------|
| 0 | 节点 A | B | C | D | 4 ms |
| 1 | 节点 B | A | C | D | 4 ms |
| 2 | 节点 C | A | B | D | 4 ms |
| 3 | 节点 D | A | B | C | 4 ms |
| 4 | -- | 处理 + 融合 | | | 30 ms |
| **合计** | | | | | **50 ms = 20 Hz** |

同步：周期开始时由聚合节点发出 GPIO 脉冲。50 ms 内 ±10ppm 的时钟漂移约为 ~0.5 us，远在 1 ms 保护间隔之内。

**跨节点融合**使用 `ruvector-attn-mincut::attn_mincut`，让来自不同节点的时频单元彼此做注意力交互。跨节点呈现相关运动能量的单元（人体反射）被放大，只在单节点出现的能量单元（局部多径伪影）被抑制。

**多人分离**通过 `ruvector-mincut::DynamicMinCut` 实现：

1. 构建跨链路时域相关图（节点 = TX-RX 链路，边 = 相关系数）
2. `DynamicMinCut` 将其划分为 K 个簇（每个簇对应一个检测到的人）
3. 注意力融合（研究文档 §5.3）在每个簇内独立运行

### 2.5 相干性指标

逐链路相干性用于量化与近期历史的一致程度：

```rust
pub fn coherence_score(
    current: &[f32],
    reference: &[f32],
    variance: &[f32],
) -> f32 {
    current.iter().zip(reference.iter()).zip(variance.iter())
        .map(|((&c, &r), &v)| {
            let z = (c - r).abs() / v.sqrt().max(1e-6);
            let weight = 1.0 / (v + 1e-6);
            ((-0.5 * z * z).exp(), weight)
        })
        .fold((0.0, 0.0), |(sc, sw), (c, w)| (sc + c * w, sw + w))
        .pipe(|(sc, sw)| sc / sw)
}
```

静态/动态分解使用 `ruvector-solver`，把环境漂移（缓慢、全局）与人体运动（快速、子载波特异）分离开来。

### 2.6 相干性门控更新策略

```rust
pub enum GateDecision {
    /// 相干性 > 0.85：执行完整 Kalman 量测更新
    Accept(Pose),
    /// 0.5 < 相干性 < 0.85：仅做 Kalman 预测（噪声放大 3 倍）
    PredictOnly,
    /// 相干性 < 0.5：完全拒绝该量测
    Reject,
    /// 连续 >10s 低相干性：触发 SONA 重校准（ADR-005）
    Recalibrate,
}
```

当 `Recalibrate` 触发时：
1. 冻结输出，保持最后一个已知良好的姿态
2. 采集 200 帧（10s）无标注 CSI
3. 运行 AETHER 对比式 TTT（ADR-024）自适应编码器
4. 更新 SONA LoRA 权重（ADR-005），每次更新 <1ms
5. 使用自适应后的模型恢复感知

### 2.7 姿态跟踪器（17 关键点 Kalman + 重识别）

把 `wifi-densepose-mat/src/tracking/`（ADR-026）中的 Kalman + 生命周期 + 重识别基础设施移植到 RuvSense 限界上下文，并扩展为 17 关键点骨架：

| 参数 | 值 | 依据 |
|-----------|-------|-----------|
| 状态维度 | 每个关键点 6 维 (x,y,z,vx,vy,vz) | 恒速模型 |
| 过程噪声 σ_a | 0.3 m/s² | 正常步行加速度 |
| 量测噪声 σ_obs | 0.08 m | 目标：躯干 <8cm RMS |
| Mahalanobis 门限 | χ²(3) = 9.0 | 3σ 椭球（与 ADR-026 相同）|
| 起始命中数 | 2 帧（20Hz 下 100ms）| 剔除单帧噪声 |
| 丢失容忍帧数 | 5 帧（250ms）| 容忍短暂遮挡 |
| 重识别特征 | AETHER 128 维嵌入 | 具备体型区分度（ADR-024）|
| 重识别窗口 | 5 秒 | 足以从交叉遮挡中恢复 |

**轨迹分配**使用 `ruvector-mincut` 的 `DynamicPersonMatcher`（已集成于 `metrics.rs`，ADR-016），代价由位置与嵌入联合构成：

```
cost(track_i, det_j) = 0.6 * mahalanobis(track_i, det_j.position)
                      + 0.4 * (1 - cosine_sim(track_i.embedding, det_j.embedding))
```

---

## 3. GOAP 集成计划（目标导向的动作规划）

### 3.1 动作依赖图

```
Phase 1: Foundation
  Action 1: Channel-Hopping Firmware ──────────────────────┐
      │                                                      │
      v                                                      │
  Action 2: Multi-Band Frame Fusion ──→ Action 6: Coherence │
      │                                  Metric              │
      v                                    │                 │
  Action 3: Multistatic Mesh              v                 │
      │                              Action 7: Coherence    │
      v                                  Gate               │
Phase 2: Tracking                         │                 │
  Action 4: Pose Tracker ←────────────────┘                 │
      │                                                      │
      v                                                      │
  Action 5: End-to-End Pipeline @ 20 Hz ←────────────────────┘
      │
      v
Phase 4: Hardening
  Action 8: AETHER Track Re-ID
      │
      v
  Action 9: ADR-029 Documentation (this document)
```

### 3.2 代价与 RuVector 映射

| # | 动作 | 代价 | 前置条件 | RuVector crate | 效果 |
|---|--------|------|---------------|-----------------|---------|
| 1 | 信道跳变固件 | 4/10 | ESP32 固件已存在 | None（纯 C）| `bandwidth_extended = true` |
| 2 | 多频段帧融合 | 5/10 | 动作 1 | `solver`、`attention` | `fused_multi_band_frame = true` |
| 3 | 多基地网格聚合 | 5/10 | 动作 2 | `mincut`、`attn-mincut` | `multistatic_mesh = true` |
| 4 | 姿态跟踪器 | 4/10 | 动作 3、7 | `mincut` | `pose_tracker = true` |
| 5 | 端到端流水线 | 6/10 | 动作 2-4 | `temporal-tensor`、`attention` | `20hz_update = true` |
| 6 | 相干性指标 | 3/10 | 动作 2 | `solver` | `coherence_metric = true` |
| 7 | 相干性门控 | 3/10 | 动作 6 | `attn-mincut` | `coherence_gating = true` |
| 8 | AETHER 重识别 | 4/10 | 动作 4、7 | `attention` | `identity_stable = true` |
| 9 | ADR 文档 | 2/10 | 以上全部 | None | 决策已记录 |

**总代价：36 单位。通往验收测试的最小可行路径：动作 1-5 + 6-7 = 30 单位。**

### 3.3 时延预算（50ms 周期）

| 阶段 | 预算 | 方法 |
|-------|--------|--------|
| UDP 接收 + 解析 | <1 ms | ADR-018 二进制帧、148 bytes、零分配 |
| 多频段融合 | ~2 ms | NeumannSolver 做 2×2 相位对齐 |
| 多基地融合 | ~3 ms | attn_mincut 处理 3-6 节点 × 64 速度单元 |
| 模型推理 | ~30-40 ms | CsiToPoseTransformer（轻量，无 ResNet）|
| Kalman 更新 | <1 ms | 17 个独立 6D 滤波器，栈上分配 |
| **合计** | **~37-47 ms** | **可在 50 ms 内完成** |

---

## 4. 硬件物料清单

| 组件 | 数量 | 单价 | 用途 |
|-----------|-----|-----------|---------|
| ESP32-S3-DevKitC-1 | 4 | $10 | TX/RX 感知节点 |
| ESP32-S3-DevKitC-1 | 1 | $10 | 聚合节点（或 x86/RPi 主机）|
| 外置 5dBi 天线 | 4-8 | $3 | 提升增益、定向覆盖 |
| USB-C 集线器（4 口）| 1 | $15 | 供电分配 |
| 壁挂支架 | 4 | $2 | 天花板/墙面安装 |
| **合计** | | **$73-91** | 完整的 4 节点网格 |

---

## 5. RuVector v2.0.4 集成映射

五个已发布的 crate 全部都会被用到：

| crate | 动作 | 集成点 | 算法优势 |
|-------|---------|-------------------|----------------------|
| `ruvector-solver` | 2、6 | 相位对齐；相干矩阵分解 | O(√n) Neumann 收敛 |
| `ruvector-attention` | 2、5、8 | 跨信道加权；环形缓冲；嵌入相似度 | 小 d 下的次线性注意力 |
| `ruvector-mincut` | 3、4 | 视角多样性划分；轨迹分配 | O(n^1.5 log n) 动态更新 |
| `ruvector-attn-mincut` | 3、7 | 跨节点频谱图融合；相干性门控 | 单趟完成注意力 + 最小割 |
| `ruvector-temporal-tensor` | 5 | 压缩感知窗口环形缓冲 | 内存占用降低 50-75% |

---

## 6. IEEE 802.11bf 对齐

RuvSense 的 TDMA 感知调度与 IEEE 802.11bf（WLAN Sensing，2024 年发布）前向兼容：

| RuvSense 概念 | 802.11bf 对应项 |
|-----------------|---------------------|
| TX 时隙 | Sensing Initiator |
| RX 时隙 | Sensing Responder |
| TDMA 周期 | Sensing Measurement Instance |
| NDP 帧 | Sensing NDP |
| 聚合节点 | Sensing Session Owner |

当商用 AP 支持 802.11bf 时，ESP32 网格可通过把 SSP 时隙翻译为 802.11bf Sensing Trigger 帧实现互操作。

---

## 7. 依赖变更

### 固件（C）

新增文件：
- `firmware/esp32-csi-node/main/sensing_schedule.h`
- `firmware/esp32-csi-node/main/sensing_schedule.c`

修改的文件：
- `firmware/esp32-csi-node/main/csi_collector.c`（增加信道跳变、链路标记）
- `firmware/esp32-csi-node/main/main.c`（增加 GPIO 同步、TDMA 定时器）

### Rust 部分

新增模块：`crates/wifi-densepose-signal/src/ruvsense/`（6 个文件，预计 ~1500 行）

修改的文件：
- `crates/wifi-densepose-signal/src/lib.rs`（导出 `ruvsense` 模块）
- `crates/wifi-densepose-signal/Cargo.toml`（无新增依赖；按 ADR-017，所有 ruvector crate 均已存在）
- `crates/wifi-densepose-sensing-server/src/main.rs`（把 RuvSense 流水线接入 WebSocket 输出）

不新增任何 workspace 依赖。所有 ruvector crate 都已在工作区 `Cargo.toml` 中。

---

## 8. 实施优先级

| 优先级 | 动作 | 周数 | 里程碑 |
|----------|---------|-------|-----------|
| P0 | 1（固件）| 2 | 信道跳变 ESP32 原型 |
| P0 | 2（多频段）| 2 | 宽带虚拟帧 |
| P1 | 3（多基地）| 2 | 多节点融合 |
| P1 | 4（跟踪器）| 1 | 17 关键点 Kalman |
| P1 | 6、7（相干性）| 1 | 门控更新 |
| P2 | 5（端到端）| 2 | 20 Hz 流水线 |
| P2 | 8（AETHER 重识别）| 1 | 身份稳定性加固 |
| P3 | 9（文档）| 0.5 | 本 ADR 定稿 |
| **合计** | | **~10 周** | **验收测试** |

---

## 9. 影响

### 9.1 正面

- **带宽提升 3 倍**，无需更换硬件（在现有 ESP32 上做信道跳变）
- 用 4 个 $10 的商用节点获得 **12 个独立视角**（C(4,2) × 2 条链路）
- **20 Hz 更新率**，配合 Kalman 平滑输出，躯干抖动低于 30mm
- 通过相干性门控 + SONA 重校准实现**数天级稳定性**
- **五个 ruvector crate 全部得到运用** —— 算法基础一致
- **BOM 总额 $73-91** —— 研究与生产都负担得起
- **前向兼容 802.11bf** —— 商用感知能力落地时投资不会浪费
- **Cognitum 升级路径** —— 软件栈不变，把 ESP32 换成更高带宽的前端即可

### 9.2 负面

- **4 节点部署**需要实际安装并标定节点位置
- **TDMA 调度**降低单节点 CSI 速率（每个节点只有 1/4 的时间在发射）
- **信道跳变**在 `esp_wifi_set_channel()` 切换期间引入约 ~1-5ms 的空档
- **ESP32-S3 上的 5 GHz CSI** 可能不可用（ESP32-C6 原生支持）
- **相干性门控**可能在人体快速运动时拒绝有效量测（缓解办法：只对静态子载波的相干性做门控）

### 9.3 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| ESP32 信道跳变造成 CSI 空档 | Medium | 有效速率下降 | 测量空档时长；若 >5ms 则增大驻留时间 |
| CSI 回调速率耗尽 lwIP pbuf | **Resolved** | Guru meditation 崩溃 | 50 Hz 限速器 + 100 ms ENOMEM 退避（Issue #127、PR #132）|
| S3 上 5 GHz CSI 不可用 | High | 失去频率多样性 | 回退方案：3 信道 2.4 GHz 仍可提供 3 倍带宽；双频段改用 ESP32-C6 |
| 模型推理 >40ms | Medium | 达不到 20 Hz 目标 | 模型按 10 Hz 运行；Kalman 预测按 20 Hz 插值 |
| 3 节点下两人分离失败 | Low | 身份互换 | AETHER 重识别可恢复；增加到 4-6 个节点 |
| 相干性门控误触发 | Low | 漏掉更新 | 只对环境相干性做门控，不对人体运动子载波做门控 |

---

## 10. 相关 ADR

| ADR | 关系 |
|-----|-------------|
| ADR-012 | **扩展**：RuvSense 在单 AP 网格上加入 TDMA 多基地能力 |
| ADR-014 | **使用**：6 种 SOTA 算法逐链路应用 |
| ADR-016 | **扩展**：为多链路融合新增 ruvector 集成点 |
| ADR-017 | **扩展**：相干性门控增加了时域稳定性层 |
| ADR-018 | **修改**：固件增加信道跳变、TDMA 调度、HT40 |
| ADR-022 | **互补**：RuvSense 是 Windows 多 BSSID 方案的 ESP32 对应实现 |
| ADR-024 | **使用**：用 AETHER 嵌入做人员重识别 |
| ADR-026 | **复用**：Kalman + 生命周期基础设施移植到 RuvSense |
| ADR-027 | **使用**：GeometryEncoder、HardwareNormalizer、FiLM 条件化 |

---

## 11. 参考资料

1. IEEE 802.11bf-2024. "WLAN Sensing." IEEE 标准协会。
2. Geng, J.、Huang, D.、De la Torre, F.（2023 年）。"DensePose From WiFi." arXiv:2301.00250。
3. Yan, K. 等（2024 年）。"Person-in-WiFi 3D." CVPR 2024，第 969-978 页。
4. Chen, L. 等（2026 年）。"PerceptAlign: Geometry-Aware WiFi Sensing." arXiv:2601.12252。
5. Kotaru, M. 等（2015 年）。"SpotFi: Decimeter Level Localization Using WiFi." SIGCOMM。
6. Zheng, Y. 等（2019 年）。"Zero-Effort Cross-Domain Gesture Recognition with Wi-Fi." MobiSys。
7. Zeng, Y. 等（2019 年）。"FarSense: Pushing the Range Limit of WiFi-based Respiration Sensing." MobiCom。
8. AM-FM（2026 年）。"A Foundation Model for Ambient Intelligence Through WiFi." arXiv:2602.11200。
9. Espressif ESP-CSI 项目。https://github.com/espressif/esp-csi
