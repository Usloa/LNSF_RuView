# ADR-027：MERIDIAN 项目 —— 面向 WiFi 姿态估计的跨环境域泛化

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-01 |
| **决策者** | ruv |
| **代号** | **MERIDIAN** -- Multi-Environment Robust Inference via Domain-Invariant Alignment Networks |
| **关联** | ADR-005（SONA 自学习）、ADR-014（SOTA 信号处理）、ADR-015（公开数据集）、ADR-016（RuVector 集成）、ADR-023（训练式 DensePose 流水线）、ADR-024（AETHER 对比嵌入） |

---

## 1. 背景

### 1.1 域间隙问题

基于 WiFi 的姿态估计模型一旦部署到与训练环境不同的场景，性能会严重退化。在 Room A 里按特定收发器布局、墙体材质与家具摆放训练出来的模型，搬到 Room B 后可能损失 40-70% 准确率——即使两间房在同一栋楼里。这种脆弱性是 WiFi 感知走向实际部署的最大障碍。

根因有三：

1. **布局过拟合**：模型记住了发射机、接收机与坐标系之间的空间关系，而没有学到与环境无关的人体运动特征。PerceptAlign（Chen 等，2026；arXiv:2601.12252）证明，引入几何条件化后跨布局误差可下降 >60%。

2. **多径记忆**：多径信道剖面把房间几何（墙的位置、家具、材质）编码成静态指纹。模型把这一指纹当成捷径，用房间特有的多径模式预测位置，而不是提取与姿态相关的人体反射。

3. **硬件异构**：不同 WiFi 芯片组（ESP32、Intel 5300、Atheros）产生的 CSI 在子载波数、相位噪声剖面和采样率上各不相同。用 Intel 5300（30 子载波、3x3 MIMO）训练的模型在 ESP32-S3（64 子载波、1x1 SISO）上会失效。

当前的 wifi-densepose 系统（ADR-023）只在 MM-Fi 或 Wi-Pose 的单一环境上训练与评估。系统里没有机制把人体运动与环境解耦，无法在不完全重训的情况下适应新房间，也处理不了混合硬件部署。

### 1.2 SOTA 全景（2024-2026）

当前有五条并行的研究路线汇聚到域泛化问题上：

**跨布局姿态估计：**
- **PerceptAlign**（Chen 等，2026；arXiv:2601.12252）：首个几何条件化框架。把收发器位置编码成高维嵌入并与 CSI 特征融合，跨域误差降低 60%+。构建了规模最大的跨域 WiFi 姿态数据集：21 名受试者、5 个场景、18 种动作、7 种布局。
- **AdaPose**（Zhou 等，2024；IEEE IoT Journal，arXiv:2309.16964）：用映射一致性损失在映射层面对齐域差异，是首个专门解决跨域 WiFi 姿态估计的工作。
- **Person-in-WiFi 3D**（Yan 等，CVPR 2024）：端到端从 WiFi 估计多人 3D 姿态，单人误差 91.7mm，但跨布局泛化仍是开放问题。

**域泛化框架：**
- **DGSense**（Zhou 等，2025；arXiv:2502.08155）：虚拟数据生成器 + 情景式训练以提取域不变特征。无需目标域数据即可泛化到未见域，覆盖 WiFi、毫米波与声学感知。
- **上下文感知预测编码（CAPC）**（2024；arXiv:2410.01825；IEEE OJCOMS）：面向 WiFi 的自监督 CPC + Barlow Twins，在未见环境上比监督学习提升 24.7% 准确率。

**基础模型：**
- **X-Fi**（Chen 与 Yang，ICLR 2025；arXiv:2410.10167）：首个人体感知的模态不变基础模型。X-fusion 机制保留各模态特有特征，在 MM-Fi 上 MPJPE 改善 24.8%。
- **AM-FM**（2026；arXiv:2602.11200）：首个 WiFi 基础模型，用 20 种设备、跨 439 天采集的 920 万条无标注 CSI 样本预训练。采用对比学习 + 掩码重建 + 物理约束目标。

**生成式方法：**
- **LatentCSI**（Ramesh 等，2025；arXiv:2506.10605）：轻量 CSI 编码器直接映射到 Stable Diffusion 3 的潜空间，证明 CSI 含有足以重建房间图像的空间信息。

### 1.3 MERIDIAN 给现有系统带来什么

| 现有能力 | 缺口 | MERIDIAN 的补充 |
|-------------------|-----|------------------|
| AETHER 嵌入（ADR-024） | 嵌入中编码了环境身份——有利于指纹识别，却不利于跨环境迁移 | 带显式因子分解的环境解耦嵌入 |
| SONA LoRA adapter（ADR-005） | 每个环境都要手工创建 adapter；没有从小样本数据自动生成它们的机制 | 通过几何条件化推理实现零样本环境自适应 |
| MM-Fi/Wi-Pose 训练（ADR-015） | 单环境训练/评估；没有跨域协议 | 带环境增广的多域训练协议 |
| SpotFi 相位校正（ADR-014） | 与硬件绑定的相位校准 | 硬件无关的 CSI 归一化层 |
| RuVector attention（ADR-016） | 注意力权重学到的是环境特有模式 | 域对抗注意力正则化 |

---

## 2. 决策

### 2.1 架构：环境解耦双路径 Transformer

MERIDIAN 在 CSI 编码器与姿态/嵌入头之间加入一层域泛化。核心思路是显式因子分解：把潜在表示拆成**与姿态相关**的分量（跨环境不变）和**环境**分量（刻画房间几何、硬件、布局）：

```
CSI Frame(s) [n_pairs x n_subcarriers]
     |
     v
  HardwareNormalizer                         [NEW: chipset-invariant preprocessing]
     |   - Resample to canonical 56 subcarriers
     |   - Normalize amplitude distribution to N(0,1) per-frame
     |   - Apply SanitizedPhaseTransform (hardware-agnostic)
     |
     v
  csi_embed (Linear 56 -> d_model=64)       [EXISTING]
     |
     v
  CrossAttention (Q=keypoint_queries,        [EXISTING]
                   K,V=csi_embed)
     |
     v
  GnnStack (2-layer GCN)                    [EXISTING]
     |
     v
  body_part_features [17 x 64]              [EXISTING]
     |
     +---> DomainFactorizer:                 [NEW]
     |       |
     |       +---> PoseEncoder:              [NEW: domain-invariant path]
     |       |       fc1: Linear(64, 128) + LayerNorm + GELU
     |       |       fc2: Linear(128, 64)
     |       |       --> h_pose [17 x 64]    (invariant to environment)
     |       |
     |       +---> EnvEncoder:               [NEW: environment-specific path]
     |               GlobalMeanPool [17 x 64] -> [64]
     |               fc_env: Linear(64, 32)
     |               --> h_env [32]           (captures room/hardware identity)
     |
     +---> h_pose ---> xyz_head + conf_head  [EXISTING: pose regression]
     |               --> keypoints [17 x (x,y,z,conf)]
     |
     +---> h_pose ---> MeanPool -> ProjectionHead -> z_csi [128]  [ADR-024 AETHER]
     |
     +---> h_env  ---> (discarded at inference; used only for training signal)
```

### 2.2 带梯度反转的域对抗训练

为了强迫 `h_pose` 做到环境不变，我们采用域对抗训练（Ganin 等，2016）并引入梯度反转层（GRL）：

```
h_pose [17 x 64]
     |
     +---> [Normal gradient]  --> xyz_head --> L_pose
     |
     +---> [GRL: multiply grad by -lambda_adv]
              |
              v
          DomainClassifier:
              MeanPool [17 x 64] -> [64]
              fc1: Linear(64, 32) + ReLU + Dropout(0.3)
              fc2: Linear(32, n_domains)
              --> domain_logits
              --> L_domain = CrossEntropy(domain_logits, domain_label)

Total loss:
  L = L_pose + lambda_c * L_contrastive + lambda_adv * L_domain
                                           + lambda_env * L_env_recon
```

GRL 把从 `L_domain` 流回 `PoseEncoder` 的梯度取反，也就是说 PoseEncoder 被训练成**最大化**域分类误差——迫使 `h_pose` 剥离所有环境特有信息。

**关键超参数：**
- `lambda_adv`：对抗权重，在前 20 个 epoch 内按 `lambda_adv(p) = 2 / (1 + exp(-10 * p)) - 1` 从 0.0 退火到 1.0，其中 `p = epoch / max_epochs`
- `lambda_env = 0.1`：环境重建权重（辅助任务，确保 `h_env` 捕获 `h_pose` 丢弃的信息）
- `lambda_c = 0.1`：来自 AETHER 的对比损失权重（保持不变）

### 2.3 几何条件化推理（零样本自适应）

受 PerceptAlign 启发，MERIDIAN 让姿态解码器以收发器的物理几何为条件。部署时用户提供 AP/传感器位置（安装时已知），模型据此调整坐标系：

```rust
/// 把收发器几何编码成条件向量。
/// 位置以米为单位，相对于任意选定的房间原点。
pub struct GeometryEncoder {
    /// 3D 坐标的傅里叶位置编码
    pos_embed: FourierPositionalEncoding,  // 3 coords -> 64 dims per position
    /// 把数量可变的 AP 位置聚合为固定维度向量
    set_encoder: DeepSets,                 // permutation-invariant {AP_1..AP_n} -> 64
}

/// 傅里叶特征：[sin(2^0 * pi * x), cos(2^0 * pi * x), ...,
///                     sin(2^(L-1) * pi * x), cos(2^(L-1) * pi * x)]
/// L = 10 个频带，每个坐标产出 60 维（+ 3 个原始值 = 63，补齐到 64）
pub struct FourierPositionalEncoding {
    n_frequencies: usize,  // default: 10
    scale: f32,            // default: 1.0 (meters)
}

/// DeepSets：phi(x) -> 均值池化 -> rho(.)，实现置换不变的集合编码
pub struct DeepSets {
    phi: Linear,    // 64 -> 64
    rho: Linear,    // 64 -> 64
}
```

几何嵌入 `g`（64 维）通过 FiLM 条件化注入姿态解码器：

```
g = GeometryEncoder(ap_positions)   [64-dim]
gamma = Linear(64, 64)(g)           [per-feature scale]
beta  = Linear(64, 64)(g)           [per-feature shift]

h_pose_conditioned = gamma * h_pose + beta    [FiLM: Feature-wise Linear Modulation]
     |
     v
  xyz_head --> keypoints
```

这带来零样本部署能力：只要给出新房间里 WiFi AP 的位置，模型无需任何重训即可调整坐标预测。

### 2.4 硬件无关的 CSI 归一化

```rust
/// 把异构硬件产生的 CSI 归一化为规范表示。
/// 支持 ESP32-S3（64 子载波）、Intel 5300（30 子载波）、Atheros（56 子载波）。
pub struct HardwareNormalizer {
    /// 目标子载波数（所有硬件都投影到这里）
    canonical_subcarriers: usize,  // default: 56 (matches MM-Fi)
    /// 各硬件的幅度统计量，用于 z-score 归一化
    hw_stats: HashMap<HardwareType, AmplitudeStats>,
}

pub enum HardwareType {
    Esp32S3 { subcarriers: usize, mimo: (u8, u8) },
    Intel5300 { subcarriers: usize, mimo: (u8, u8) },
    Atheros { subcarriers: usize, mimo: (u8, u8) },
    Generic { subcarriers: usize, mimo: (u8, u8) },
}

impl HardwareNormalizer {
    /// 把原始 CSI 帧归一化为规范形式：
    /// 1. 用三次插值把子载波重采样到规范数量
    /// 2. 逐帧对幅度做 z-score 归一化
    /// 3. 净化相位：去掉硬件特有的线性相位偏移
    pub fn normalize(&self, frame: &CsiFrame) -> CanonicalCsiFrame { .. }
}
```

重采样使用 `ruvector-solver` 的稀疏插值（已按 ADR-016 集成），把任意子载波数投影到规范的 56 个。

### 2.5 虚拟环境增广

沿用 DGSense 虚拟数据生成器的思路，MERIDIAN 用合成域偏移增广训练数据：

```rust
/// 通过模拟环境变化生成虚拟 CSI 域。
pub struct VirtualDomainAugmentor {
    /// 通过缩放多径时延模拟不同房间尺寸
    room_scale_range: (f32, f32),    // default: (0.5, 2.0)
    /// 通过扰动反射系数模拟墙体材质
    reflection_coeff_range: (f32, f32),  // default: (0.3, 0.9)
    /// 通过随机注入散射体模拟家具
    n_virtual_scatterers: (usize, usize),  // default: (0, 5)
    /// 通过整形子载波响应模拟硬件差异
    hw_response_filters: Vec<SubcarrierResponseFilter>,
}

impl VirtualDomainAugmentor {
    /// 对一个 CSI batch 施加随机虚拟域偏移。
    /// 每次调用都会生成一个新的「虚拟环境」，以提升训练多样性。
    pub fn augment(&self, batch: &CsiBatch, rng: &mut impl Rng) -> CsiBatch { .. }
}
```

训练时每个 mini-batch 都会增广 K=3 次虚拟域偏移，等效训练环境数变为 4 倍。域分类器同时看到真实与虚拟域标签，从而更有力地逼出环境不变特征。

### 2.6 小样本快速自适应

对于可以提供短暂校准期的部署场景（新环境 10-60 秒的 CSI 数据，不需要姿态标注）：

```rust
/// 用无标注 CSI 数据快速适应新环境。
/// 把 SONA LoRA adapter（ADR-005）与 MERIDIAN 的域因子分解结合起来。
pub struct RapidAdaptation {
    /// 自适应所需的无标注 CSI 帧数
    min_calibration_frames: usize,  // default: 200 (10 sec @ 20 Hz)
    /// 环境专属自适应的 LoRA 秩
    lora_rank: usize,               // default: 4
    /// 自监督自适应损失（AETHER 对比损失 + 熵最小化）
    adaptation_loss: AdaptationLoss,
}

pub enum AdaptationLoss {
    /// 用无标注数据做 AETHER 对比损失的测试时训练
    ContrastiveTTT { epochs: usize, lr: f32 },
    /// 对姿态置信度输出做熵最小化
    EntropyMin { epochs: usize, lr: f32 },
    /// 组合方式：对比损失 + 熵最小化
    Combined { epochs: usize, lr: f32, lambda_ent: f32 },
}
```

这利用了已有的 SONA 基础设施（ADR-005），仅凭无标注 CSI 就生成环境专属的 LoRA 权重，填平了零样本几何条件化与全监督微调之间的空档。

---

## 3. 对比：MERIDIAN 与备选方案

| 方案 | 跨布局 | 跨硬件 | 零样本 | 小样本 | 边缘可部署 | 多人 |
|----------|-------------|----------------|-----------|----------|-----------------|-------------|
| **MERIDIAN（本 ADR）** | Yes（GRL + geometry FiLM） | Yes（HardwareNormalizer） | Yes（几何条件化） | Yes（SONA + contrastive TTT） | Yes（新增约 12K 参数） | Yes（通过 ADR-023） |
| PerceptAlign（2026） | Yes | No | Partial（需要布局信息） | No | Unknown（20M 参数） | No |
| AdaPose（2024） | Partial（2 个域） | No | No | Yes（映射一致性） | Unknown | No |
| DGSense（2025） | Yes（虚拟增广） | Yes（多模态） | Yes | No | No（ResNet 骨干） | No |
| X-Fi（ICLR 2025） | Yes（基础模型） | Yes（多模态） | Yes | Yes（预训练） | No（大型 transformer） | Yes |
| AM-FM（2026） | Yes（439 天预训练） | Yes（20 种设备类型） | Yes | Yes | No（基础模型规模） | Unknown |
| CAPC（2024） | Partial（迁移学习） | No | No | Yes（自监督微调） | Yes（轻量） | No |
| **当前 wifi-densepose** | **No** | **No** | **No** | **Partial（SONA 手工配置）** | **Yes** | **Yes** |

### MERIDIAN 的差异点

1. **增量式而非替换式**：X-Fi 与 AM-FM 都需要新的基础模型基础设施，而 MERIDIAN 只在现有 ADR-023 流水线上增加 4 个小模块。
2. **边缘可部署**：参数总开销约 12K（几何编码器约 8K、域因子分解器约 4K），落在 ADR-024 确立的 ESP32 预算之内。
3. **硬件无关**：首个在单一框架内同时解决跨布局与跨硬件泛化的方案，且复用已有的 `ruvector-solver` 稀疏插值。
4. **连续的自适应谱系**：同一套架构同时支持零样本（仅几何）、小样本（10 秒校准）与完整微调。

---

## 4. 实现

### 4.1 阶段 1 —— 硬件归一化器（第 1 周）

**目标**：在 ESP32、Intel 5300 与 Atheros 硬件之间建立统一的规范 CSI 表示。

**改动文件：**
- `crates/wifi-densepose-signal/src/hardware_norm.rs`（新增）
- `crates/wifi-densepose-signal/src/lib.rs`（导出新模块）
- `crates/wifi-densepose-train/src/dataset.rs`（在数据流水线中应用归一化器）

**依赖**：`ruvector-solver`（稀疏插值，已 vendored）

**验收标准：**
- [ ] 把任意子载波数重采样到规范的 56 个，每帧耗时不超过 50us
- [ ] z-score 归一化后逐帧幅度满足 mean=0、std=1
- [ ] 相位净化去掉线性趋势（与 SpotFi 输出对照验证）
- [ ] 用合成的 ESP32（64 子载波）与 Intel 5300（30 子载波）帧做单元测试

### 4.2 阶段 2 —— 域因子分解器 + GRL（第 2-3 周）

**目标**：训练过程中解耦与姿态相关的特征和环境特有特征。

**改动文件：**
- `crates/wifi-densepose-train/src/domain.rs`（新增 DomainFactorizer、GRL、DomainClassifier）
- `crates/wifi-densepose-train/src/graph_transformer.rs`（在 GNN 之后接入因子分解器）
- `crates/wifi-densepose-train/src/trainer.rs`（把 L_domain 加入组合损失，实现 GRL 退火）
- `crates/wifi-densepose-train/src/dataset.rs`（给 DataPipeline 增加域标签）

**关键实现细节 —— 梯度反转层：**

```rust
/// 梯度反转层：前向为恒等，反向时把梯度取反。
/// 用于训练 PoseEncoder 产出域不变特征。
pub struct GradientReversalLayer {
    lambda: f32,
}

impl GradientReversalLayer {
    /// 前向：恒等。反向：把梯度乘以 -lambda。
    /// 在我们的纯 Rust autograd 里实现为：
    ///   forward(x) = x
    ///   backward(grad) = -lambda * grad
    pub fn forward(&self, x: &Tensor) -> Tensor {
        // 把 lambda 存入计算图，供反向传播使用
        x.clone_with_grad_fn(GrlBackward { lambda: self.lambda })
    }
}
```

**验收标准：**
- [ ] 域分类器在源域上达到 >90% 准确率（证明信号确实存在）
- [ ] GRL 训练后域分类器准确率降到接近随机（证明已解耦）
- [ ] 源域姿态精度相对非对抗基线下降 <5%
- [ ] 留出环境上的跨域姿态精度提升 >20%

### 4.3 阶段 3 —— 几何编码器 + FiLM 条件化（第 3-4 周）

**目标**：给定 AP 位置即可零样本部署。

**改动文件：**
- `crates/wifi-densepose-train/src/geometry.rs`（新增 GeometryEncoder、FourierPositionalEncoding、DeepSets、FiLM）
- `crates/wifi-densepose-train/src/graph_transformer.rs`（在 xyz_head 之前注入 FiLM 条件化）
- `crates/wifi-densepose-train/src/config.rs`（给 TrainConfig 增加几何字段）

**验收标准：**
- [ ] FourierPositionalEncoding 从 3D 坐标产出 64 维向量
- [ ] DeepSets 满足置换不变（AP 顺序变化不影响输出）
- [ ] 相对无条件化基线，FiLM 条件化把跨布局 MPJPE 降低 >30%
- [ ] 每帧推理开销 <100us（几何编码按会话摊销）

### 4.4 阶段 4 —— 虚拟域增广（第 4-5 周）

**目标**：用合成的环境多样性提升泛化能力。

**改动文件：**
- `crates/wifi-densepose-train/src/virtual_aug.rs`（新增 VirtualDomainAugmentor）
- `crates/wifi-densepose-train/src/trainer.rs`（把增广器接入训练循环）
- `crates/wifi-densepose-signal/src/fresnel.rs`（复用菲涅尔区模型模拟散射体）

**依赖**：`ruvector-attn-mincut`（按注意力加权的散射体布置）

**验收标准：**
- [ ] 每个 batch 生成 K=3 个虚拟域，开销 <1ms
- [ ] 虚拟域的 CSI 统计量有可测差异（KL 散度 >0.1）
- [ ] 使用虚拟增广训练后，未见环境准确率提升 >15%
- [ ] 已见环境准确率无回退（波动在 2% 以内）

### 4.5 阶段 5 —— 小样本快速自适应（第 5-6 周）

**目标**：10 秒校准即可在无标注条件下完成环境专属微调。

**改动文件：**
- `crates/wifi-densepose-train/src/rapid_adapt.rs`（新增 RapidAdaptation）
- `crates/wifi-densepose-train/src/sona.rs`（给 SonaProfile 增加 MERIDIAN 字段）
- `crates/wifi-densepose-sensing-server/src/main.rs`（增加 `--calibrate` CLI 参数）

**验收标准：**
- [ ] 200 帧（10 秒）校准能产出可用的 LoRA adapter
- [ ] 自适应后模型的 MPJPE 与全监督同域基线相差不超过 15%
- [ ] 在 x86 上校准耗时 <5 秒（含对比式 TTT）
- [ ] 自适应后的 LoRA 权重可序列化进 RVF 容器（ADR-023 的 Segment 类型）

### 4.6 阶段 6 —— 跨域评估协议（第 6-7 周）

**目标**：用 MM-Fi 的场景/受试者划分做严格的多域评估。

**改动文件：**
- `crates/wifi-densepose-train/src/eval.rs`（新增 CrossDomainEvaluator）
- `crates/wifi-densepose-train/src/dataset.rs`（为 MM-Fi 增加按域划分的加载方式）

**评估协议（参照 PerceptAlign）：**

| 指标 | 说明 |
|--------|-------------|
| **In-domain MPJPE** | 训练环境上的平均关节位置误差 |
| **Cross-domain MPJPE** | 留出环境上的 MPJPE（零样本）|
| **Few-shot MPJPE** | 目标环境 10 秒校准后的 MPJPE |
| **Cross-hardware MPJPE** | 在一种硬件上训练、在另一种硬件上测试时的 MPJPE |
| **Domain gap ratio** | 跨域 / 同域 MPJPE（越低越好；目标 <1.5）|
| **Adaptation speedup** | 相对从头训练节省的标注样本数（目标 >5x）|

### 4.7 阶段 7 —— RVF 容器与部署（第 7-8 周）

**目标**：把 MERIDIAN 增强后的模型打包用于边缘部署。

**改动文件：**
- `crates/wifi-densepose-train/src/rvf_container.rs`（增加 GEOM 与 DOMAIN 段类型）
- `crates/wifi-densepose-sensing-server/src/inference.rs`（加载几何与域权重）
- `crates/wifi-densepose-sensing-server/src/main.rs`（增加 `--ap-positions` CLI 参数）

**新增 RVF 段：**

| 段 | 类型 ID | 内容 | 大小 |
|---------|---------|----------|------|
| `GEOM` | `0x47454F4D` | GeometryEncoder 权重 + FiLM 层 | ~4 KB |
| `DOMAIN` | `0x444F4D4E` | DomainFactorizer 权重（仅 PoseEncoder；EnvEncoder 与 GRL 丢弃）| ~8 KB |
| `HWSTATS` | `0x48575354` | 供 HardwareNormalizer 使用的各硬件幅度统计量 | ~1 KB |

**CLI 用法：**

```bash
# 用 MERIDIAN 域泛化进行训练
cargo run -p wifi-densepose-sensing-server -- \
  --train --dataset data/mmfi/ --epochs 100 \
  --meridian --n-virtual-domains 3 \
  --save-rvf model-meridian.rvf

# 带几何条件化部署（零样本）
cargo run -p wifi-densepose-sensing-server -- \
  --model model-meridian.rvf \
  --ap-positions "0,0,2.5;3.5,0,2.5;1.75,4,2.5"

# 在新环境中校准（小样本，10 秒）
cargo run -p wifi-densepose-sensing-server -- \
  --model model-meridian.rvf --calibrate --calibrate-duration 10
```

---

## 5. 影响

### 5.1 正面影响

- **一次部署，处处可用**：单个 MERIDIAN 训练出的模型即可跨房间、跨建筑、跨硬件泛化，无需为每个环境重训
- **降低部署成本**：零样本模式只需输入 AP 位置；小样本模式只需 10 秒环境 WiFi 数据
- **与 AETHER 协同**：域不变嵌入（ADR-024）成为与环境无关的指纹，可实现跨建筑的房间识别
- **硬件自由**：HardwareNormalizer 打通混合机队部署（部分房间用 ESP32，部分用 Intel 5300）
- **竞争定位**：现有开源 WiFi 姿态系统都不具备跨环境泛化能力，MERIDIAN 会是第一个

### 5.2 负面影响

- **训练复杂度**：多域训练需要来自多个环境的 CSI 数据。MM-Fi 提供多个场景，但 PerceptAlign 的 7 布局数据集尚未公开。
- **超参数敏感**：GRL lambda 退火调度与对抗平衡需要仔细调参；早期对抗信号过强可能导致训练不稳定。
- **需要几何输入**：零样本模式要求用户输入 AP 位置，而这些位置未必总能精确已知。几何输入不准时的性能退化还需要刻画。
- **参数开销**：+12K 参数使模型总量从 55K 增至 67K（增加 22%），仍在 ESP32 预算内但值得注意。

### 5.3 风险与缓解措施

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| GRL 训练不稳定 | Medium | 训练发散 | lambda 退火调度；梯度裁剪到 1.0；回退到非对抗训练 |
| 虚拟增广不真实 | Low | 泛化能力没有提升 | 用真实跨域数据分布校验增广后的 CSI |
| 几何编码器过拟合训练布局 | Medium | 新几何下零样本失败 | 训练时增广几何输入（AP 位置抖动 +/-0.5m）|
| MM-Fi 场景多样性不足 | High | 评估有效性受限 | 补充合成数据；待 PerceptAlign 数据集发布后引入 |

---

## 6. 与拟议 ADR 的关系（缺口补齐）

ADR 002-011 是在初始架构阶段提出的。MERIDIAN 直接补齐、吸收或支撑了其中若干缺口。本节把每个拟议 ADR 映射到它的当前状态，并说明 ADR-027 与它的相互作用。

### 6.1 由 MERIDIAN 直接补齐

| 拟议 ADR | 缺口 | MERIDIAN 如何补齐 |
|-------------|-----|----------------------|
| **ADR-004**：HNSW 向量检索指纹 | CSI 指纹与环境绑定——在 Room A 学到的指纹在 Room B 毫无用处 | MERIDIAN 的 `DomainFactorizer` 产出**环境解耦嵌入**（`h_pose`）。送入 ADR-024 的 `FingerprintIndex` 后，由于环境信息已被分解出去，这些嵌入可以跨房间匹配。`h_env` 路径则单独刻画房间身份，使同一个模型既能跨房间匹配，又能识别房间。 |
| **ADR-005**：面向姿态估计的 SONA 自学习 | SONA LoRA adapter 必须针对每个环境用标注数据手工创建 | MERIDIAN 阶段 5（`RapidAdaptation`）为 SONA 增加**无监督 adapter 生成**：10 秒无标注 WiFi 数据 + 对比式测试时训练即可自动产出每个房间的 LoRA adapter。无需标注，也无需人工干预。`sona.rs` 中已有的 `SonaProfile` 增加 `meridian_calibration` 字段保存自适应状态。 |
| **ADR-006**：GNN 增强的 CSI 模式识别 | GNN 把每个环境的模式彼此独立看待；没有跨环境迁移 | MERIDIAN 的域对抗训练对 GCN 层（ADR-023 的 `GnnStack`）做正则，使其学到**保持结构、环境不变**的图特征。梯度反转层迫使 GCN 丢弃房间特有的多径模式，同时保留关键点之间与人体姿态相关的空间关系。 |

### 6.2 已被取代（已实现）

| 拟议 ADR | 原始设想 | 当前状态 |
|-------------|----------------|---------------|
| **ADR-002**：RuVector RVF 集成策略 | 把 RuVector crate 集成进 WiFi-DensePose 流水线 | **Fully implemented** —— 由 ADR-016（训练流水线，5 个 crate）与 ADR-017（信号 + MAT，7 个集成点）完成。`wifi-densepose-ruvector` crate 已发布到 crates.io，无需后续动作。 |

### 6.3 由 MERIDIAN 提供支撑（后续工作）

这些 ADR 仍是独立路线，但 MERIDIAN 为它们提供了可复用的基础设施：

| 拟议 ADR | 缺口 | MERIDIAN 如何提供支撑 |
|-------------|-----|------------------------|
| **ADR-003**：RVF 认知容器 | CSI 流水线各阶段产出的是瞬时数据；跨会话没有持久化的认知状态 | MERIDIAN 对 RVF 容器的扩展（阶段 7：`GEOM`、`DOMAIN`、`HWSTATS` 段）确立了**环境感知模型打包**的范式。认知容器可以基于 MERIDIAN 的段格式保存每个房间的自适应历史、几何剖面与域统计量。`h_env` 嵌入天然适合作为持久化的环境记忆。 |
| **ADR-008**：多 AP 分布式共识 | 多个 AP 需要协同感知；缺少针对冲突观测的一致性协议 | MERIDIAN 的 `GeometryEncoder` 已经通过置换不变的 `DeepSets` 建模数量可变的 AP 位置，为多 AP 融合提供了**几何基础**：每个 AP 的 CSI 先各自做几何条件化，再融合。共识层（Raft 或 BFT）可架在 MERIDIAN 之上，用来调和不同 AP 视角给出的冲突姿态估计。`HardwareNormalizer` 保证混合硬件（各 AP 上 ESP32 + Intel 5300 并存）产出可比的特征。 |
| **ADR-009**：面向边缘的 RVF WASM 运行时 | 不依赖服务端、自包含的 WASM 模型执行 | MERIDIAN 增加约 12K 参数（合计 67K）后仍在 WASM 体积预算内。`HardwareNormalizer` 对 WASM 部署至关重要：浏览器里的推理必须能处理所连硬件给出的任意 CSI 格式。WASM 构建应包含几何条件化路径，让用户可以在浏览器 UI 里指定 AP 布局。 |

### 6.4 独立路线（MERIDIAN 不涉及）

这些 ADR 处理的是正交的议题，应分别推进：

| 拟议 ADR | 缺口 | 建议 |
|-------------|-----|----------------|
| **ADR-007**：后量子密码 | WiFi 感知数据会暴露在场、健康与活动信息——量子计算机可能攻破感知流当前的加密 | **独立推进。** MERIDIAN 不涉及传输中数据的安全。PQC 应作用于 WebSocket 流（`/ws/sensing`、`/ws/mat/stream`）与 RVF 模型容器（用 ML-DSA/Dilithium 替换 Ed25519 签名）。优先级：medium —— 量子威胁并不迫近，但医疗部署可能因长期数据留存而要求 PQC 合规。 |
| **ADR-010**：用于审计轨迹的见证链 | 灾害检伤分类决策（ADR-001）需要防篡改的审计轨迹以满足法律/监管合规 | **独立推进。** MERIDIAN 的域自适应提升了陌生环境（废墟、倒塌建筑）下的检伤分类精度，从而减少了更正审计轨迹的需求。但审计轨迹本身——哈希链、Merkle 证明、带时间戳的检伤事件——是独立的完整性议题。优先级：high，面向灾害响应部署。 |
| **ADR-011**：Python 真实性证明（紧急） | Python v1 里有削弱可信度的 mock/占位代码；`verify.py` 已存在但 mock 路径仍在 | **独立推进。** 这是 Python v1 的代码质量问题，不是 ML/架构问题。Rust 移植（v2+）没有 mock 代码——全部 542+ 个测试都跑在真实算法实现上。建议：要么在 Python v1 里彻底清除 mock，要么正式弃用 Python v1 并转向 Rust 技术栈。优先级：high，事关可信度。 |

### 6.5 缺口补齐总结

```
Proposed ADRs (002-011)          Status After ADR-027
─────────────────────────        ─────────────────────
ADR-002  RVF Integration    ──→  ✅ Superseded (ADR-016/017 implemented)
ADR-003  Cognitive Containers ─→ 🔜 Enabled (MERIDIAN RVF segments provide pattern)
ADR-004  HNSW Fingerprinting ──→ ✅ Addressed (domain-disentangled embeddings)
ADR-005  SONA Self-Learning  ──→ ✅ Addressed (unsupervised rapid adaptation)
ADR-006  GNN Patterns        ──→ ✅ Addressed (adversarial GCN regularization)
ADR-007  Post-Quantum Crypto ──→ ⏳ Independent (pursue separately, medium priority)
ADR-008  Distributed Consensus → 🔜 Enabled (GeometryEncoder + HardwareNormalizer)
ADR-009  WASM Runtime        ──→ 🔜 Enabled (67K model fits WASM budget)
ADR-010  Witness Chains      ──→ ⏳ Independent (pursue separately, high priority)
ADR-011  Proof-of-Reality    ──→ ⏳ Independent (Python v1 issue, high priority)
```

---

## 7. 参考资料

1. Chen, L. 等（2026）。"Breaking Coordinate Overfitting: Geometry-Aware WiFi Sensing for Cross-Layout 3D Pose Estimation." arXiv:2601.12252. https://arxiv.org/abs/2601.12252
2. Zhou, Y. 等（2024）。"AdaPose: Towards Cross-Site Device-Free Human Pose Estimation with Commodity WiFi." IEEE Internet of Things Journal. arXiv:2309.16964. https://arxiv.org/abs/2309.16964
3. Yan, K. 等（2024）。"Person-in-WiFi 3D: End-to-End Multi-Person 3D Pose Estimation with Wi-Fi." CVPR 2024，969-978 页。https://openaccess.thecvf.com/content/CVPR2024/html/Yan_Person-in-WiFi_3D_End-to-End_Multi-Person_3D_Pose_Estimation_with_Wi-Fi_CVPR_2024_paper.html
4. Zhou, R. 等（2025）。"DGSense: A Domain Generalization Framework for Wireless Sensing." arXiv:2502.08155. https://arxiv.org/abs/2502.08155
5. CAPC（2024）。"Context-Aware Predictive Coding: A Representation Learning Framework for WiFi Sensing." IEEE OJCOMS，第 5 卷，6119-6134 页。arXiv:2410.01825. https://arxiv.org/abs/2410.01825
6. Chen, X. 与 Yang, J.（2025）。"X-Fi: A Modality-Invariant Foundation Model for Multimodal Human Sensing." ICLR 2025. arXiv:2410.10167. https://arxiv.org/abs/2410.10167
7. AM-FM（2026）。"AM-FM: A Foundation Model for Ambient Intelligence Through WiFi." 见 arXiv:2602.11200. https://arxiv.org/abs/2602.11200
8. Ramesh, S. 等（2025）。"LatentCSI: High-resolution efficient image generation from WiFi CSI using a pretrained latent diffusion model." arXiv:2506.10605. https://arxiv.org/abs/2506.10605
9. Ganin, Y. 等（2016）。"Domain-Adversarial Training of Neural Networks." JMLR 17(59):1-35. https://jmlr.org/papers/v17/15-239.html
10. Perez, E. 等（2018）。"FiLM: Visual Reasoning with a General Conditioning Layer." AAAI 2018. arXiv:1709.07871. https://arxiv.org/abs/1709.07871
