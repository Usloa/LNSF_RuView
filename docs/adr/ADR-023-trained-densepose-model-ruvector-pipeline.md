# ADR-023：采用 RuVector 信号智能流水线的训练式 DensePose 模型

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-02-28 |
| **决策者** | ruv |
| **关联** | ADR-003（RVF 认知容器）、ADR-005（SONA 自学习）、ADR-015（公开数据集策略）、ADR-016（RuVector 集成）、ADR-017（RuVector-Signal-MAT）、ADR-020（Rust AI 迁移）、ADR-021（生命体征检测） |

## 背景

### 感知与 DensePose 之间的落差

WiFi-DensePose 系统目前以两种彼此独立的模式运行：

1. **WiFi CSI 感知**（可用）：ESP32 推送 CSI 帧 → Rust 聚合器 → 特征提取 → 存在/运动分类。41 个测试通过，并已在真实硬件上以约 20 Hz 验证。

2. **启发式姿态推导**（可用但只是近似）：Rust 感知服务器用手工规则从 WiFi 信号属性生成 17 个 COCO 关键点（`sensing-server/src/main.rs` 中的 `derive_pose_from_sensing()`）。这不是训练出来的模型——关键点位置来自信号幅度、相位方差与运动指标，而不是从标注数据中学得。

两种模式都无法产出 **DensePose 级别**的人体表面估计。CMU 的「DensePose From WiFi」论文（arXiv:2301.00250）证明：用成对的 WiFi CSI 与相机姿态数据训练神经网络，可以仅凭 WiFi 得到稠密的人体表面 UV 坐标。但该方案要求：

- **按环境训练**：CSI 多径模式依赖环境，模型必须针对每个部署环境训练或微调。
- **成对训练数据**：同时采集的 WiFi CSI 与真值姿态标注（或由基于相机的教师模型生成伪标签）。
- **相当可观算力**：训练模态翻译网络 + DensePose 头需要 GPU 时间（视数据集规模，数小时到数天）。

### 代码库里已有什么

Rust workspace 里其实已经备好了可供训练的完整模型架构：

| 组件 | Crate | 文件 | 状态 |
|-----------|-------|------|--------|
| `WiFiDensePoseModel` | `wifi-densepose-train` | `model.rs` | Implemented（随机权重） |
| `ModalityTranslator` | `wifi-densepose-train` | `model.rs` | Implemented（已接入 RuVector 注意力） |
| `KeypointHead` | `wifi-densepose-train` | `model.rs` | Implemented（17 个 COCO 热力图） |
| `DensePoseHead` | `wifi-densepose-nn` | `densepose.rs` | Implemented（25 个部位 + 48 个 UV） |
| `WiFiDensePoseLoss` | `wifi-densepose-train` | `losses.rs` | Implemented（关键点 + 部位 + UV + 迁移） |
| `MmFiDataset` 加载器 | `wifi-densepose-train` | `dataset.rs` | Planned（ADR-015） |
| `WiFiDensePosePipeline` | `wifi-densepose-nn` | `inference.rs` | Implemented（对 Backend 泛型） |
| 训练证明校验 | `wifi-densepose-train` | `proof.rs` | Implemented（确定性哈希） |
| 子载波重采样（114→56） | `wifi-densepose-train` | `subcarrier.rs` | Planned（ADR-016） |

### 可用的 RuVector Crate

`vendor/ruvector/` 子树提供 90+ 个 crate。以下与训练式 DensePose 流水线直接相关：

**已集成（5 个 crate，ADR-016）：**

| Crate | 算法 | 当前用途 |
|-------|-----------|-------------|
| `ruvector-mincut` | 次多项式动态最小割 O(n^{o(1)}) | `metrics.rs` 中的多人分配 |
| `ruvector-attn-mincut` | 注意力门控最小割 | `model.rs` 中的降噪频谱图 |
| `ruvector-attention` | 缩放点积 + 几何注意力 | `model.rs` 中的空间解码器 |
| `ruvector-solver` | 稀疏 Neumann 求解器 O(√n) | `subcarrier.rs` 中的子载波重采样 |
| `ruvector-temporal-tensor` | 分层时序压缩 | `dataset.rs` 中的 CSI 帧缓冲 |

**本次为 DensePose 流水线新提议（再加 6 个 crate）：**

| Crate | 说明 | 拟议用途 |
|-------|-------------|-------------|
| `ruvector-gnn` | 基于 HNSW 拓扑的图神经网络 | 空间人体图推理 |
| `ruvector-graph-transformer` | 证明门控图 transformer（8 个模块） | CSI 到姿态的交叉注意力 |
| `ruvector-sparse-inference` | PowerInfer 式稀疏推理引擎 | 利用神经元激活稀疏性做边缘部署 |
| `ruvector-sona` | 自优化神经架构（LoRA + EWC++） | 在线环境自适应 |
| `ruvector-fpga-transformer` | FPGA 优化 transformer | 硬件加速推理路径 |
| `ruvector-math` | 最优传输、信息几何 | 域自适应损失函数 |

### RVF 容器格式

RuVector Format（RVF）是一种基于分段的二进制容器格式，用于把各类智能产物打包进
一个自包含文件：嵌入向量、HNSW 索引、量化权重、WASM 运行时、见证证明与元数据
都可装入其中。关键特性：

- **64 字节段头**（`SegmentHeader`，magic `0x52564653` 即 "RVFS"）：含类型判别、内容哈希、压缩与时间戳
- **渐进加载**：Layer A（入口点，<5ms）→ Layer B（热邻接，100ms–1s）→ Layer C（全图，秒级）
- **20+ 种段类型**：`Vec`（嵌入）、`Index`（HNSW）、`Overlay`（最小割见证）、`Quant`（码本）、`Witness`（计算证明）、`Wasm`（自举运行时）、`Dashboard`（内嵌 UI）、`AggregateWeights`（联邦 SONA 增量）、`Crypto`（Ed25519 签名）等
- **按温度分层的量化**（`rvf-quant`）：逐段可选 f32 / f16 / u8 / 二值，距离计算由 SIMD 加速
- **AGI 认知容器**（`agi_container.rs`）：把内核、WASM、世界模型、编排器、评估 harness 与见证链打包进单个可部署文件

训练好的 DensePose 模型会打包成 `.rvf` 容器，成为单个自包含产物：其中含模型权重、
以 HNSW 索引的嵌入表、最小割图覆盖层、量化码本、SONA 自适应增量，
以及 WASM 推理运行时。这样无需任何外部依赖，
即可部署到任意宿主机。

## 决策

实现一个以 RuVector 信号智能作为底层信号处理层、并封装为 RVF 容器格式的完整训练式 DensePose 模型。流水线分为三阶段：(1) 在公开数据集上离线训练，(2) 用教师-学生蒸馏生成 DensePose UV 标签，(3) 通过 SONA 在线自适应按环境微调。训练好的模型连同嵌入、索引与自适应状态一起序列化进单个 `.rvf` 文件。

### 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRAINED DENSEPOSE PIPELINE                                │
│                                                                             │
│  ┌─────────────┐    ┌──────────────────────┐    ┌──────────────────────┐   │
│  │ ESP32 CSI    │    │  RuVector Signal      │    │  Trained Neural      │   │
│  │ Raw I/Q      │───▶│  Intelligence Layer   │───▶│  Network             │   │
│  │ [ant×sub×T]  │    │  (preprocessing)      │    │  (inference)         │   │
│  └─────────────┘    └──────────────────────┘    └──────────────────────┘   │
│                              │                           │                   │
│                    ┌─────────┴─────────┐       ┌────────┴────────┐         │
│                    │ 5 RuVector crates  │       │ 6 RuVector      │         │
│                    │ (signal processing)│       │ crates (neural) │         │
│                    └───────────────────┘       └─────────────────┘         │
│                                                        │                    │
│                              ┌──────────────────────────┘                   │
│                              ▼                                              │
│                    ┌──────────────────────────────────────┐                 │
│                    │              Outputs                   │                 │
│                    │  • 17 COCO keypoints [B,17,H,W]       │                 │
│                    │  • 25 body parts     [B,25,H,W]       │                 │
│                    │  • 48 UV coords      [B,48,H,W]       │                 │
│                    │  • Confidence scores                   │                 │
│                    └──────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 阶段 1：RuVector 信号预处理层

来自 ESP32 的原始 CSI 帧（56–192 个子载波 × N 根天线 × T 个时间帧）先经 RuVector 信号智能栈处理，再进入神经网络。这用可学习、具备图感知的预处理替代了手工特征提取。

```
Raw CSI [ant, sub, T]
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  1. ruvector-attn-mincut: gate_spectrogram()        │
│     Input:  Q=amplitude, K=phase, V=combined        │
│     Effect: Suppress multipath noise, keep motion-  │
│             relevant subcarrier paths                │
│     Output: Gated spectrogram [ant, sub', T]        │
├─────────────────────────────────────────────────────┤
│  2. ruvector-mincut: mincut_subcarrier_partition()   │
│     Input:  Subcarrier coherence graph               │
│     Effect: Partition into sensitive (motion-         │
│             responsive) vs insensitive (static)      │
│     Output: Partition mask + per-subcarrier weights   │
├─────────────────────────────────────────────────────┤
│  3. ruvector-attention: attention_weighted_bvp()     │
│     Input:  Gated spectrogram + partition weights    │
│     Effect: Compute body velocity profile with       │
│             sensitivity-weighted attention            │
│     Output: BVP feature vector [D_bvp]               │
├─────────────────────────────────────────────────────┤
│  4. ruvector-solver: solve_fresnel_geometry()        │
│     Input:  Amplitude + known TX/RX positions        │
│     Effect: Estimate TX-body-RX ellipsoid distances  │
│     Output: Fresnel geometry features [D_fresnel]    │
├─────────────────────────────────────────────────────┤
│  5. ruvector-temporal-tensor: compress + buffer      │
│     Input:  Temporal CSI window (100 frames)         │
│     Effect: Tiered quantization (hot/warm/cold)      │
│     Output: Compressed tensor, 50-75% memory saving  │
└─────────────────────────────────────────────────────┘
    │
    ▼
Feature tensor [B, T*tx*rx, sub] (preprocessed, noise-suppressed)
```

### 阶段 2：神经网络架构

神经网络沿用 CMU 的教师-学生架构，并在三个关键位置加入 RuVector 增强。

#### 2a. ModalityTranslator（CSI → 视觉特征空间）

```
CSI features [B, T*tx*rx, sub]
    │
    ├──amplitude──┐
    │              ├─► Encoder (Conv1D stack, 64→128→256)
    └──phase──────┘         │
                            ▼
              ┌──────────────────────────────┐
              │  ruvector-graph-transformer   │
              │                              │
              │  Treat antenna-pair×time as  │
              │  graph nodes. Edges connect  │
              │  spatially adjacent antenna  │
              │  pairs and temporally        │
              │  adjacent frames.            │
              │                              │
              │  Proof-gated attention:      │
              │  Each layer verifies that    │
              │  attention weights satisfy   │
              │  physical constraints        │
              │  (Fresnel ellipsoid bounds)  │
              └──────────────────────────────┘
                            │
                            ▼
              Decoder (ConvTranspose2d stack, 256→128→64→3)
                            │
                            ▼
              Visual features [B, 3, 48, 48]
```

**RuVector 增强**：用 `ruvector-graph-transformer` 替换瓶颈层里的标准多头自注意力。图结构编码了天线的物理拓扑——空间上更近（mesh 中相邻的 ESP32 节点）或时间上更近（相邻帧）的节点，边权更大。这注入了标准注意力所缺乏的领域归纳偏置。

#### 2b. GNN 人体图推理

```
Visual features [B, 3, 48, 48]
    │
    ▼
ResNet18 backbone → feature maps [B, 256, 12, 12]
    │
    ▼
┌─────────────────────────────────────────┐
│  ruvector-gnn: Body Graph Network       │
│                                         │
│  17 COCO keypoints as graph nodes       │
│  Edges: anatomical connections          │
│  (shoulder→elbow, hip→knee, etc.)       │
│                                         │
│  GNN message passing (3 rounds):        │
│  h_i^{l+1} = σ(W·h_i^l + Σ_j α_ij·h_j)│
│  α_ij = attention(h_i, h_j, edge_ij)   │
│                                         │
│  Enforces anatomical constraints:       │
│  - Limb length ratios                   │
│  - Joint angle limits                   │
│  - Left-right symmetry priors           │
└─────────────────────────────────────────┘
    │
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  ▼
KeypointHead      DensePoseHead     ConfidenceHead
[B,17,H,W]       [B,25+48,H,W]     [B,1]
heatmaps          parts + UV         quality score
```

**RuVector 增强**：`ruvector-gnn` 用作用于人体图的图神经网络取代扁平的空间解码器。WiFi CSI 天生噪声大，在解剖学相连的关节之间做 GNN 消息传递，可保证即便单个关节预测不确定，输出的关键点仍维持合理的人体结构。

#### 2c. 面向边缘部署的稀疏推理

```
Trained model weights (full precision)
    │
    ▼
┌─────────────────────────────────────────────┐
│  ruvector-sparse-inference                   │
│                                              │
│  PowerInfer-style activation sparsity:       │
│  - Profile neuron activation frequency       │
│  - Partition into hot (always active, 20%)   │
│    and cold (conditionally active, 80%)      │
│  - Hot neurons: GPU/SIMD fast path           │
│  - Cold neurons: sparse lookup on demand     │
│                                              │
│  Quantization:                               │
│  - Backbone: INT8 (4x memory reduction)      │
│  - DensePose head: FP16 (2x reduction)       │
│  - ModalityTranslator: FP16                  │
│                                              │
│  Target: <50ms inference on ESP32-S3         │
│          <10ms on x86 with AVX2              │
└─────────────────────────────────────────────┘
```

### 阶段 3：训练流水线

#### 3a. 数据集加载与预处理

主数据集：**MM-Fi**（NeurIPS 2023）——40 名受试者、27 类动作、114 个子载波、3 根 RX 天线、17 个 COCO 关键点 + DensePose UV 标注。

辅助数据集：**Wi-Pose**——12 名受试者、12 类动作、30 个子载波、3×3 天线阵列、18 个关键点。

```
┌──────────────────────────────────────────────────────────┐
│  Data Loading Pipeline                                    │
│                                                          │
│  MM-Fi .npy ──► Resample 114→56 subcarriers ──┐         │
│                (ruvector-solver NeumannSolver)  │         │
│                                                ├──► Batch│
│  Wi-Pose .mat ──► Zero-pad 30→56 subcarriers ──┘  [B,T*│
│                                                    ant, │
│  Phase sanitize ──► Hampel filter ──► unwrap        sub] │
│  (wifi-densepose-signal::phase_sanitizer)                │
│                                                          │
│  Temporal buffer ──► ruvector-temporal-tensor             │
│  (100 frames/sample, tiered quantization)                │
└──────────────────────────────────────────────────────────┘
```

#### 3b. 教师-学生 DensePose 标签

对于有 3D 关键点但没有 DensePose UV 图的样本：

1. 在成对的 RGB 帧上运行 Detectron2 DensePose R-CNN（在 GPU 工作站上做一次性预处理）
2. 生成 `(part_labels [H,W], u_coords [H,W], v_coords [H,W])` 伪标签
3. 以 `.npy` 形式缓存在原始数据旁
4. 标签生成完毕后丢弃教师模型——推理阶段只用 WiFi

#### 3c. 损失函数

```rust
L_total = λ_kp  · L_keypoint      // MSE on predicted vs GT heatmaps
        + λ_part · L_part          // Cross-entropy on 25-class body part segmentation
        + λ_uv   · L_uv           // Smooth L1 on UV coordinate regression
        + λ_xfer · L_transfer     // MSE between CSI features and teacher visual features
        + λ_ot   · L_ot           // Optimal transport regularization (ruvector-math)
        + λ_graph · L_graph       // GNN edge consistency loss (ruvector-gnn)
```

**RuVector 增强**：`ruvector-math` 提供最优传输（Wasserstein 距离）作为正则项。它会惩罚在 Wasserstein 度量下偏离真值的人体部位分布预测；对空间部位分割而言，这比逐像素交叉熵在几何上更有意义。

#### 3d. 训练配置

| 参数 | 值 | 依据 |
|-----------|-------|-----------|
| 优化器 | AdamW | 权重衰减正则化 |
| 学习率 | 1e-3，余弦衰减至 1e-5 | 模态翻译的常规配置 |
| 批大小 | 32 | 可装入 24GB GPU 显存 |
| 训练轮数 | 100 | 带早停（patience=15） |
| 预热 | 5 个 epoch | 学习率线性预热 |
| 训练/验证划分 | 受试者 1-32 / 33-40 | 受试者互不重叠，便于验证泛化 |
| 数据增强 | 时移 ±5 帧、幅度噪声 ±2dB、天线 dropout 10% | CSI 域的数据增强 |
| 硬件 | 单卡 RTX 3090 或 A100 | A100 上约 8 小时 |
| 检查点 | 每轮保存，保留验证集 PCK 最优 | 固定随机种子 |

#### 3e. 指标

| 指标 | 目标 | 说明 |
|--------|--------|-------------|
| PCK@0.2 | MM-Fi 验证集 >70% | 正确关键点占比（阈值 = 0.2 × 躯干直径） |
| OKS mAP | MM-Fi 验证集 >0.50 | 目标关键点相似度，COCO 标准 |
| DensePose GPS | MM-Fi 验证集 >0.30 | 测地点相似度，衡量 UV 精度 |
| 推理时延 | 每帧 <50ms | x86 上用 ONNX Runtime |
| 模型大小 | <25MB（FP16） | 适合边缘部署 |

### 阶段 4：用 SONA 做在线自适应

离线训练产出基座模型后，SONA 可让它持续适配新环境，而无需从头重训。

```
┌──────────────────────────────────────────────────────────┐
│  SONA Online Adaptation Loop                              │
│                                                          │
│  Base model (frozen weights W)                           │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────────────────────────────┐                    │
│  │  LoRA Adaptation Matrices        │                    │
│  │  W_effective = W + α · A·B       │                    │
│  │                                  │                    │
│  │  Rank r=4 for translator layers  │                    │
│  │  Rank r=2 for backbone layers    │                    │
│  │  Rank r=8 for DensePose head     │                    │
│  │                                  │                    │
│  │  Total trainable params: ~50K    │                    │
│  │  (vs ~5M frozen base)            │                    │
│  └──────────────────────────────────┘                    │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────────────────────────────┐                    │
│  │  EWC++ Regularizer               │                    │
│  │  L = L_task + λ·Σ F_i(θ-θ*)²    │                    │
│  │                                  │                    │
│  │  Prevents forgetting base model  │                    │
│  │  knowledge when adapting to new  │                    │
│  │  environment                     │                    │
│  └──────────────────────────────────┘                    │
│       │                                                  │
│       ▼                                                  │
│  Adaptation triggers:                                    │
│  • First deployment in new room                          │
│  • PCK drops below threshold (drift detection)           │
│  • User manually initiates calibration                   │
│  • Furniture/layout change detected (CSI baseline shift) │
│                                                          │
│  Adaptation data:                                        │
│  • Self-supervised: temporal consistency loss             │
│    (pose at t should be similar to t-1 for slow motion)  │
│  • Semi-supervised: user confirmation of presence/count  │
│  • Optional: brief camera calibration session (5 min)    │
│                                                          │
│  Convergence: 10-50 gradient steps, <5 seconds on CPU    │
└──────────────────────────────────────────────────────────┘
```

### 阶段 5：推理流水线（生产环境）

```
ESP32 CSI (UDP :5005)
    │
    ▼
Rust Axum server (port 8080)
    │
    ├─► RuVector signal preprocessing (Stage 1)
    │       5 crates, ~2ms per frame
    │
    ├─► ONNX Runtime inference (Stage 2)
    │       Quantized model, ~10ms per frame
    │       OR ruvector-sparse-inference, ~8ms per frame
    │
    ├─► GNN post-processing (ruvector-gnn)
    │       Anatomical constraint enforcement, ~1ms
    │
    ├─► SONA adaptation check (Stage 4)
    │       <0.05ms per frame (gradient accumulation only)
    │
    └─► Output: DensePose results
            │
            ├──► /api/v1/stream/pose (WebSocket, 17 keypoints)
            ├──► /api/v1/pose/current (REST, full DensePose)
            └──► /ws/sensing (WebSocket, raw + processed)
```

推理总预算：x86 上 20 Hz 时**每帧 <15ms**，ESP32-S3 上（启用稀疏推理）**<50ms**。

### 阶段 6：RVF 模型容器格式

训练好的模型打包为单个 `.rvf` 文件，内含推理所需的一切——
无需外部权重文件、无需 ONNX Runtime、无需 Python 依赖。

#### RVF DensePose 容器布局

```
wifi-densepose-v1.rvf (single file, ~15-30 MB)
┌───────────────────────────────────────────────────────────────┐
│  SEGMENT 0: Manifest (0x05)                                   │
│  ├── Model ID: "wifi-densepose-v1.0"                          │
│  ├── Training dataset: "mmfi-v1+wipose-v1"                    │
│  ├── Training config hash: SHA-256                            │
│  ├── Target hardware: x86_64, aarch64, wasm32                 │
│  ├── Segment directory (offsets to all segments)               │
│  └── Level-1 TLV manifest with metadata tags                  │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 1: Vec (0x01) — Model Weight Embeddings              │
│  ├── ModalityTranslator weights [64→128→256→3, Conv1D+ConvT]  │
│  ├── ResNet18 backbone weights [3→64→128→256, residual blocks] │
│  ├── KeypointHead weights [256→17, deconv layers]             │
│  ├── DensePoseHead weights [256→25+48, deconv layers]         │
│  ├── GNN body graph weights [3 message-passing rounds]        │
│  └── Graph transformer attention weights [proof-gated layers] │
│  Format: flat f32 vectors, 768-dim per weight tensor          │
│  Total: ~5M parameters → ~20MB f32, ~10MB f16, ~5MB INT8     │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 2: Index (0x02) — HNSW Embedding Index               │
│  ├── Layer A: Entry points + coarse routing centroids          │
│  │   (loaded first, <5ms, enables approximate search)         │
│  ├── Layer B: Hot region adjacency for frequently             │
│  │   accessed weight clusters (100ms load)                    │
│  └── Layer C: Full adjacency graph for exact nearest          │
│      neighbor lookup across all weight partitions             │
│  Use: Fast weight lookup for sparse inference —               │
│  only load hot neurons, skip cold neurons via HNSW routing    │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 3: Overlay (0x03) — Dynamic Min-Cut Graph            │
│  ├── Subcarrier partition graph (sensitive vs insensitive)     │
│  ├── Min-cut witnesses from ruvector-mincut                   │
│  ├── Antenna topology graph (ESP32 mesh spatial layout)       │
│  └── Body skeleton graph (17 COCO joints, 16 edges)           │
│  Use: Pre-computed graph structures loaded at init time.       │
│  Dynamic updates via ruvector-mincut insert/delete_edge       │
│  as environment changes (furniture moves, new obstacles)      │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 4: Quant (0x06) — Quantization Codebooks             │
│  ├── INT8 codebook for backbone (4x memory reduction)         │
│  ├── FP16 scale factors for translator + heads                │
│  ├── Binary quantization tables for SIMD distance compute     │
│  └── Per-layer calibration statistics (min, max, zero-point)  │
│  Use: rvf-quant temperature-tiered quantization —             │
│  hot layers stay f16, warm layers u8, cold layers binary      │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 5: Witness (0x0A) — Training Proof Chain             │
│  ├── Deterministic training proof (seed, loss curve, hash)    │
│  ├── Dataset provenance (MM-Fi commit hash, download URL)     │
│  ├── Validation metrics (PCK@0.2, OKS mAP, GPS scores)       │
│  ├── Ed25519 signature over weight hash                       │
│  └── Attestation: training hardware, duration, config         │
│  Use: Verifiable proof that model weights match a specific    │
│  training run. Anyone can re-run training with same seed      │
│  and verify the weight hash matches the witness.              │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 6: Meta (0x07) — Model Metadata                      │
│  ├── COCO keypoint names and skeleton connectivity            │
│  ├── DensePose body part labels (24 parts + background)       │
│  ├── UV coordinate range and resolution                       │
│  ├── Input normalization statistics (mean, std per subcarrier)│
│  ├── RuVector crate versions used during training             │
│  └── Environment calibration profiles (named, per-room)       │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 7: AggregateWeights (0x36) — SONA LoRA Deltas        │
│  ├── Per-environment LoRA adaptation matrices (A, B per layer)│
│  ├── EWC++ Fisher information diagonal                        │
│  ├── Optimal θ* reference parameters                          │
│  ├── Adaptation round count and convergence metrics           │
│  └── Named profiles: "lab-a", "living-room", "office-3f"     │
│  Use: Multiple environment adaptations stored in one file.    │
│  Server loads the matching profile or creates a new one.      │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 8: Profile (0x0B) — RVDNA Domain Profile             │
│  ├── Domain: "wifi-csi-densepose"                             │
│  ├── Input spec: [B, T*ant, sub] CSI tensor format            │
│  ├── Output spec: keypoints [B,17,H,W], parts [B,25,H,W],    │
│  │   UV [B,48,H,W], confidence [B,1]                         │
│  ├── Hardware requirements: min RAM, recommended GPU          │
│  └── Supported data sources: esp32, wifi-rssi, simulation    │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 9: Crypto (0x0C) — Signature and Keys                │
│  ├── Ed25519 public key for model publisher                   │
│  ├── Signature over all segment content hashes                │
│  └── Certificate chain (optional, for enterprise deployment)  │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 10: Wasm (0x10) — Self-Bootstrapping Runtime         │
│  ├── Compiled WASM inference engine                           │
│  │   (ruvector-sparse-inference-wasm)                         │
│  ├── WASM microkernel for RVF segment parsing                 │
│  └── Browser-compatible: load .rvf → run inference in-browser │
│  Use: The .rvf file is fully self-contained — a WASM host     │
│  can execute inference without any external dependencies.     │
├───────────────────────────────────────────────────────────────┤
│  SEGMENT 11: Dashboard (0x11) — Embedded Visualization        │
│  ├── Three.js-based pose visualization (HTML/JS/CSS)          │
│  ├── Gaussian splat renderer for signal field                 │
│  └── Served at http://localhost:8080/ when model is loaded    │
│  Use: Open the .rvf file → get a working UI with no install  │
└───────────────────────────────────────────────────────────────┘
```

#### RVF 加载顺序

```
1. Read tail → find_latest_manifest() → SegmentDirectory
2. Load Manifest (seg 0) → validate magic, version, model ID
3. Load Profile (seg 8) → verify input/output spec compatibility
4. Load Crypto (seg 9) → verify Ed25519 signature chain
5. Load Quant (seg 4) → prepare quantization codebooks
6. Load Index Layer A (seg 2) → entry points ready (<5ms)
       ↓ (inference available at reduced accuracy)
7. Load Vec (seg 1) → hot weight partitions via Layer A routing
8. Load Index Layer B (seg 2) → hot adjacency ready (100ms)
       ↓ (inference at full accuracy for common poses)
9. Load Overlay (seg 3) → min-cut graphs, body skeleton
10. Load AggregateWeights (seg 7) → apply matching SONA profile
11. Load Index Layer C (seg 2) → complete graph loaded
       ↓ (full inference with all weight partitions)
12. Load Wasm (seg 10) → WASM runtime available (optional)
13. Load Dashboard (seg 11) → UI served (optional)
```

**渐进可用**：第 6 步（约 5ms）后即可开始推理，此时给出近似
结果；到第 9 步（约 500ms）达到完整精度。这样既能瞬间启动，
质量又会逐步提升——对实时应用至关重要。

#### RVF 构建流水线

训练完成后，模型会被封装进 `.rvf` 文件：

```bash
# 由训练好的检查点构建 RVF 容器
cargo run -p wifi-densepose-train --bin build-rvf -- \
    --checkpoint checkpoints/best-pck.pt \
    --quantize int8,fp16 \
    --hnsw-build \
    --sign --key model-signing-key.pem \
    --include-wasm \
    --include-dashboard ../../ui \
    --output wifi-densepose-v1.rvf

# 校验构建好的容器
cargo run -p wifi-densepose-train --bin verify-rvf -- \
    --input wifi-densepose-v1.rvf \
    --verify-signature \
    --verify-witness \
    --benchmark-inference
```

#### RVF 运行时集成

感知服务器在启动时加载 `.rvf` 容器：

```bash
# 从 RVF 容器加载模型
./target/release/sensing-server \
    --model wifi-densepose-v1.rvf \
    --source auto \
    --ui-from-rvf  # serve Dashboard segment instead of --ui-path
```

```rust
// 在 sensing-server/src/main.rs 中
use rvf_runtime::RvfContainer;
use rvf_index::layers::IndexLayer;
use rvf_quant::QuantizedVec;

let container = RvfContainer::open("wifi-densepose-v1.rvf")?;

// 渐进加载：先加载 Layer A 以实现瞬间启动
let index = container.load_index(IndexLayer::A)?;
let weights = container.load_vec_hot(&index)?;  // hot partitions only

// 在后台完成全量加载
tokio::spawn(async move {
    container.load_index(IndexLayer::B).await?;
    container.load_index(IndexLayer::C).await?;
    container.load_vec_cold().await?;  // remaining partitions
});

// SONA 环境自适应
let sona_deltas = container.load_aggregate_weights("office-3f")?;
model.apply_lora_deltas(&sona_deltas);

// 提供内嵌的 dashboard
let dashboard = container.load_dashboard()?;
// 挂载到 Axum 的 /ui/* 路由
```

## 实施计划

### 阶段 1：数据集加载器（2 周）

- 在 `wifi-densepose-train/src/dataset.rs` 中实现 `MmFiDataset`
- 读取 MM-Fi `.npy` 文件并做天线校正（1TX/3RX → 3×3 零填充）
- 用 `ruvector-solver::NeumannSolver` 做子载波重采样 114→56
- 用 `wifi-densepose-signal::phase_sanitizer` 做相位净化
- 为辅助数据集实现 `WiPoseDataset`
- 用 `ruvector-temporal-tensor` 做时间窗口切分
- **交付物**：`cargo test -p wifi-densepose-train` 含数据集加载测试

### 阶段 2：图 Transformer 集成（2 周）

- 给 `wifi-densepose-train` 增加 `ruvector-graph-transformer` 依赖
- 用证明门控图 transformer 替换 `ModalityTranslator` 瓶颈层的自注意力
- 构建天线拓扑图（节点 = 天线对，边 = 空间/时间邻接）
- 增加 `ruvector-gnn` 依赖以支持人体图推理
- 构建 COCO 人体骨架图（17 个节点、16 条解剖学边）
- 在空间解码器中实现 GNN 消息传递
- **交付物**：加入图层后，模型前向传播能产出正确形状的输出

### 阶段 3：教师-学生标签生成（1 周）

- 用 Python 脚本调用 Detectron2 DensePose，从 MM-Fi 的 RGB 帧生成 UV 伪标签
- 把标签缓存为 `.npy`，供 Rust 加载器读取
- 随机抽样做人工目视检查，验证标签质量
- **交付物**：MM-Fi 训练划分的完整 UV 标签集

### 阶段 4：训练循环（3 周）

- 实现 `WiFiDensePoseTrainer`，含完整损失函数（6 项）
- 加入 `ruvector-math` 的最优传输损失项
- 集成 GNN 边一致性损失
- 训练循环支持余弦学习率调度、早停、检查点
- 验证指标：PCK@0.2、OKS mAP、DensePose GPS
- 用权重哈希做确定性证明校验（`proof.rs`）
- **交付物**：训练出的检查点在 MM-Fi 验证集上达到 PCK@0.2 >70%

### 阶段 5：SONA 在线自适应（2 周）

- 把 `ruvector-sona` 接入推理流水线
- 在 translator、backbone 与 DensePose 头各层注入 LoRA
- 实现 EWC++ Fisher 信息计算与正则化
- 用自监督时序一致性损失做无监督自适应
- 校准模式：5 分钟相机采集，做有监督微调
- 漂移检测：在时序一致性代理指标上监控滚动 PCK
- **交付物**：自适应在 <50 步梯度更新内收敛，PCK 恢复到基座的 10% 以内

### 阶段 6：稀疏推理与边缘部署（2 周）

- 在验证集上统计神经元激活频率
- 用 `ruvector-sparse-inference` 做热/冷神经元划分
- backbone 用 INT8 量化、各头用 FP16
- 导出带量化权重的 ONNX 模型
- 在 x86（目标 <10ms）与 ARM（目标 <50ms）上做基准测试
- 通过 `ruvector-sparse-inference-wasm` 导出 WASM 以支持浏览器推理
- **交付物**：量化后的 ONNX 模型、基准测试结果、WASM 二进制

### 阶段 7：RVF 容器构建流水线（2 周）

- 在 `wifi-densepose-train` 中实现 `build-rvf` 二进制
- 把训练权重序列化进 `Vec` 段（SegmentType::Vec, 0x01）
- 为稀疏推理在权重分区之上构建 HNSW 索引（SegmentType::Index, 0x02）
- 序列化最小割图覆盖层：子载波划分、天线拓扑、人体骨架（SegmentType::Overlay, 0x03）
- 用 `rvf-quant` 生成量化码本（SegmentType::Quant, 0x06）
- 写入带 Ed25519 签名的训练证明见证（SegmentType::Witness, 0x0A）
- 存储模型元数据、COCO 关键点 schema、归一化统计量（SegmentType::Meta, 0x07）
- 按环境存储 SONA LoRA 自适应增量（SegmentType::AggregateWeights, 0x36）
- 写入面向 WiFi CSI DensePose 的 RVDNA 域 profile（SegmentType::Profile, 0x0B）
- 可选：内嵌 WASM 推理运行时（SegmentType::Wasm, 0x10）
- 可选：内嵌 Three.js dashboard（SegmentType::Dashboard, 0x11）
- 构建 Level-1 manifest 与段目录（SegmentType::Manifest, 0x05）
- 实现用于容器校验的 `verify-rvf` 二进制
- **交付物**：`wifi-densepose-v1.rvf` 单文件容器，可校验且自包含

### 阶段 8：与感知服务器集成（1 周）

- 通过 `rvf-runtime` 在 `wifi-densepose-sensing-server` 中加载 `.rvf` 容器
- 渐进加载：先加载 Layer A 以瞬间启动，全图在后台加载
- 用训练模型的推理替换 `derive_pose_from_sensing()` 启发式
- 增加 `--model` CLI 参数，接受 `.rvf` 路径（或旧的 `.onnx`）
- 依据 `--env` 参数从 `AggregateWeights` 段应用 SONA LoRA 增量
- 设置 `--ui-from-rvf` 时，在 `/ui/*` 提供内嵌的 Dashboard 段
- 没有模型文件时优雅回退到启发式
- 更新 WebSocket 协议以包含 DensePose UV 数据
- **交付物**：感知服务器从单个 `.rvf` 文件提供训练模型

## 文件改动

### 新增文件

| 文件 | 用途 |
|------|---------|
| `v2/.../wifi-densepose-train/src/dataset_mmfi.rs` | 带子载波重采样的 MM-Fi 数据集加载器 |
| `v2/.../wifi-densepose-train/src/dataset_wipose.rs` | Wi-Pose 数据集加载器 |
| `v2/.../wifi-densepose-train/src/graph_transformer.rs` | 图 transformer 集成 |
| `v2/.../wifi-densepose-train/src/body_gnn.rs` | GNN 人体图推理 |
| `v2/.../wifi-densepose-train/src/adaptation.rs` | SONA LoRA + EWC++ 自适应 |
| `v2/.../wifi-densepose-train/src/trainer.rs` | 带多目标损失的训练循环 |
| `scripts/generate_densepose_labels.py` | 教师-学生 UV 标签生成 |
| `scripts/benchmark_inference.py` | 推理时延基准测试 |
| `v2/.../wifi-densepose-train/src/rvf_builder.rs` | RVF 容器构建流水线 |
| `v2/.../wifi-densepose-train/src/bin/build_rvf.rs` | 构建 `.rvf` 容器的 CLI 二进制 |
| `v2/.../wifi-densepose-train/src/bin/verify_rvf.rs` | 校验 `.rvf` 容器的 CLI 二进制 |

### 修改文件

| 文件 | 改动 |
|------|--------|
| `v2/.../wifi-densepose-train/Cargo.toml` | 增加 ruvector-gnn、graph-transformer、sona、sparse-inference、math 及 rvf-types、rvf-wire、rvf-manifest、rvf-index、rvf-quant、rvf-crypto、rvf-runtime 依赖 |
| `v2/.../wifi-densepose-train/src/model.rs` | 集成图 transformer 与 GNN 层 |
| `v2/.../wifi-densepose-train/src/losses.rs` | 增加最优传输与 GNN 边一致性损失项 |
| `v2/.../wifi-densepose-train/src/config.rs` | 增加新组件的训练超参数 |
| `v2/.../sensing-server/Cargo.toml` | 增加 rvf-runtime、rvf-types、rvf-index、rvf-quant 依赖 |
| `v2/.../sensing-server/src/main.rs` | 增加 `--model` 参数、加载 `.rvf` 容器、渐进启动、提供内嵌 dashboard |

## 影响

### 正面影响

- **训练模型产出准确的 DensePose**：从启发式关键点转向基于公开数据集评测的学习式人体表面估计
- **RuVector 信号智能是差异化优势**：天线拓扑上的图 transformer 与 GNN 人体推理都是新做法，此前没有 WiFi 姿态系统用过这些技术
- **SONA 支持零样本部署**：新环境无需完整重训——LoRA 自适应不到 50 步梯度更新即可在数秒内收敛
- **稀疏推理让边缘部署可行**：PowerInfer 式神经元划分把 DensePose 推理带到了 ESP32 级硬件
- **优雅降级**：没有模型文件时服务器回退到启发式姿态，既有功能得以保留
- **RVF 单文件部署**：训练模型、嵌入、HNSW 索引、量化码本、SONA 自适应 profile、WASM 运行时与 dashboard UI 全部装进一个 `.rvf` 文件——复制一个文件即可部署
- **渐进加载**：RVF 的 Layer A 在 <5ms 内加载完成，可瞬间启动；随其余段载入，约 500ms 达到完整精度
- **可验证的来源**：RVF Witness 段含带 Ed25519 签名的确定性训练证明，任何人都能重跑训练并核对权重哈希
- **自举能力**：RVF Wasm 段支持无需服务端依赖的浏览器内推理
- **开放式评测**：在公开 MM-Fi 数据集上的 PCK、OKS、GPS 指标，结果可复现、可横向比较

### 负面影响

- **训练需要 GPU**：初次训练需要 RTX 3090 或更高档显卡（A100 上约 8 小时），并非所有开发者都具备条件
- **教师-学生标签生成依赖 Detectron2**：从 RGB 帧生成 UV 伪标签需要一次性的 Python + CUDA 依赖
- **MM-Fi 的 CC BY-NC 许可**：用 MM-Fi 训练的权重在收集自有数据之前不得商用
- **仍需按环境适配**：SONA 减轻了负担，但为达到最佳精度，仍建议在每个新环境做一次简短校准
- **新增 6 个 RuVector crate 依赖**：延长编译时间、增大二进制体积，可通过 feature 开关缓解（例如 `--features trained-model`）
- **模型磁盘占用**：约 25MB（FP16）或约 12MB（INT8）。服务器部署尚可，用于 WASM 可能还需进一步剪枝

### 风险与缓解

| 风险 | 缓解措施 |
|------|------------|
| MM-Fi 的 114→56 插值会损失精度 | 备选方案是按原生 114 训练；ESP32 mesh 可原生采集 56 子载波数据 |
| GNN 过拟合训练集中的体型 | 用多样体型做数据增强；Wi-Pose 补充受试者多样性 |
| SONA 自适应在对抗性环境中发散 | EWC++ 正则限制参数漂移；检测到异常即回滚到基座权重 |
| 稀疏推理降低精度 | 对比 INT8 / FP16 / FP32 基准；质量下降时回退到全精度 |
| RuVector 版本升级会改变训练证明哈希 | 在 Cargo.toml 中锁定 ruvector crate 版本；升级时重新生成哈希 |

## 参考资料

- Geng 等，「DensePose From WiFi」（CMU，arXiv:2301.00250，2023）
- Yang 等，「MM-Fi: Multi-Modal Non-Intrusive 4D Human Dataset」（NeurIPS 2023，arXiv:2305.10345）
- Hu 等，「LoRA: Low-Rank Adaptation of Large Language Models」（ICLR 2022）
- Kirkpatrick 等，「Overcoming Catastrophic Forgetting in Neural Networks」（PNAS，2017）
- Song 等，「PowerInfer: Fast Large Language Model Serving with a Consumer-grade GPU」（2024）
- ADR-005：面向姿态估计的 SONA 自学习
- ADR-015：训练姿态估计模型的公开数据集策略
- ADR-016：训练流水线的 RuVector 集成
- ADR-020：把 AI/模型推理迁移到 Rust + RuVector 与 ONNX Runtime

## 附录 A：ruQu 考量

**ruQu**（「面向量子机器的经典神经系统」）借助动态最小割提供实时的
一致性评估。它主要为量子纠错而设计（伴随式解码、表面码仲裁），
但其核心原语 `CoherenceGate` 在架构上
与 WiFi CSI 处理直接相关：

- **CoherenceGate** 借助 `ruvector-mincut`，依据结构一致性阈值对
  信号流做实时的放行/拦截判定。在量子计算里它门控的是量子比特伴随式流；
  换到 WiFi CSI，同一机制可以门控 CSI
  子载波流——只放行一致性（跨天线相位稳定性）
  超过动态阈值的子载波。

- **伴随式滤波**（`filters.rs`）实现了类 Kalman 的自适应滤波器，
  可改用于 CSI 降噪——把每个子载波的幅度漂移
  视作一路「伴随式」流。

- **最小割门控 transformer** 集成（可选 feature）提供一致性优化的
  注意力，FLOP 减少 50%——可直接用于 `ModalityTranslator` 的
  瓶颈层。

**决策**：初始流水线（阶段 1-8）不纳入 ruQu，但把它列为
**阶段 9 探索**候选，用于一致性门控的 CSI 滤波。CoherenceGate
原语天然适合子载波质量评估，而且集成路径很干净，
因为 ruQu 本就依赖 `ruvector-mincut`。

## 附录 B：训练数据策略

流水线支持三类训练数据源，组合使用：

| 来源 | 子载波 | 姿态标签 | 规模 | 成本 | 使用时机 |
|--------|-------------|-------------|--------|------|------|
| **MM-Fi**（公开） | 114 → 56（插值） | 17 COCO + DensePose UV | 40 名受试者，320K 帧 | 免费（CC BY-NC） | 阶段 1 — 冷启动 |
| **Wi-Pose**（公开） | 30 → 56（零填充） | 18 个关键点 | 12 名受试者，166K 包 | 免费（研究用途） | 阶段 1 — 增加多样性 |
| **ESP32 自采** | 56（原生） | 相机教师-学生 | 不限，按环境定制 | 仅硬件（$54） | 阶段 4 起 — 微调 |

**推荐做法：公开数据 + ESP32 数据都用。**

1. **在 MM-Fi + Wi-Pose 上预训练**（公开数据，阶段 1-4）：为基座模型
   提供多样的受试者与动作。114→56 的子载波插值足以
   学习通用的 CSI 到姿态映射。

2. **用 ESP32 自采数据微调**（阶段 5 起，SONA 自适应）：在每个目标环境
   采集 5-30 分钟成对的 ESP32 CSI 与相机数据。相机充当
   教师模型（由 Detectron2 生成伪标签）。SONA LoRA 自适应
   不到 50 步梯度更新即可收敛。

3. **持续自适应**（运行时）：SONA 的自监督时序一致性损失可在无相机条件下
   继续优化模型，其依据是姿态在短时窗口内
   会平滑变化这一假设。

这套三层策略带来：
- 第一天就有可用模型（公开数据）
- 针对具体环境的精度（ESP32 微调）
- 持续的漂移修正（SONA 运行时自适应）
