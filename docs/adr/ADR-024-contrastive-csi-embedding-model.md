# ADR-024：AETHER 项目 —— 以 CsiToPoseTransformer 为骨干的对比式 CSI 嵌入模型

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-01 |
| **决策者** | ruv |
| **代号** | **AETHER** -- Ambient Electromagnetic Topology for Hierarchical Embedding and Recognition |
| **关联** | ADR-004（HNSW 指纹）、ADR-005（SONA 自学习）、ADR-006（GNN 增强 CSI）、ADR-014（SOTA 信号处理）、ADR-015（公开数据集）、ADR-016（RuVector 集成）、ADR-023（训练式 DensePose 流水线） |

---

## 1. 背景

### 1.1 嵌入能力的缺口

WiFi CSI 信号编码了丰富的环境与人体信息流形：通过多径反射体现房间几何，通过菲涅尔区扰动体现人体姿态，通过类多普勒的子载波相移体现时间动态。CsiToPoseTransformer（ADR-023）已经学会借助交叉注意力与 GNN 消息传递，把这个流形解码成 17 个关键点的人体姿态，并产出形状为 `[17 x d_model]` 的中间 `body_part_features`，隐式地表示潜在的 CSI 状态。

这些表示目前是**与任务耦合**的：它们只在姿态回归期间作为瞬时激活存在，`xyz_head` 与 `conf_head` 产出关键点预测后即被丢弃。目前没有任何机制能够：

1. **提取并持久化**这些表示，形成可复用、可查询的嵌入向量
2. 通过习得的相似度**比较** CSI 观测（「这是同一个房间吗？」/「这是同一个人吗？」）
3. 用无标签的 CSI 流以自监督方式**预训练**骨干网络——这是最充足的数据来源
4. 在不同 WiFi 硬件、环境或部署站点之间**迁移**习得的表示
5. 把有语义的向量**送入** HNSW 索引（ADR-004），取代手工设计的特征编码

Transformer *内部掌握*的信息与系统*对外暴露*的信息之间的落差，正是 AETHER 要解决的核心问题。

### 1.2 为什么叫「AETHER」？

这个名字取自历史上的「光以太」概念——人们曾认为电磁波需借助这种不可见介质传播。在我们的场景里，WiFi 信号在物理空间中传播，而 AETHER 直接从信号本身提取出对该空间的潜在几何理解。名字概括了三个核心理念：

- **环境（Ambient）**：直接利用任何室内环境里已经存在的 WiFi 信号
- **电磁拓扑（Electromagnetic Topology）**：捕捉多径传播的拓扑结构
- **分层嵌入（Hierarchical Embedding）**：在多个语义层级（环境、活动、人）产出嵌入

### 1.3 为什么用对比式，而非生成式？

我们评估并否决了生成式的「RuvLLM」方案。GOAP 分析如下：

| 因素 | 生成式（自回归） | 对比式（AETHER） |
|--------|---------------------------|---------------------|
| **领域契合度** | CSI 是 20 Hz 下的 56 个连续浮点数，并非离散词表；自回归生成在架构上并不匹配。 | 在连续传感器数据上做对比学习已是成熟的 SOTA 方案（SimCLR、BYOL、VICReg、CAPC）。 |
| **模型规模** | 生成式 transformer 需要数百万参数才能有效建模序列。 | 复用现有 28K 参数的 CsiToPoseTransformer + 25K 投影头 = 共 53K。 |
| **边缘部署** | 无法在 ESP32（240 MHz、520 KB SRAM）上运行。 | INT8 量化后 53K 参数约 53 KB，占 ESP32 SRAM 的 10%。 |
| **训练数据** | 自回归预训练需要海量 CSI 语料才能收敛。 | 自监督增强对任意 CSI 流都有效，哪怕只有几分钟数据。 |
| **推理** | 自回归解码是串行的，违反 20 Hz 实时约束。 | 单次前向传播：INT8 下 <2 ms。 |
| **基础设施** | 需要新的模型架构、分词器、训练器、量化器与 RVF 打包。 | 只需一个新模块（`embedding.rs`）、一个新损失项、一种新 RVF 段类型。 |
| **坍缩风险** | 生成中的模式坍缩表现为输出重复。 | 嵌入坍缩可检测（方差监控）且可预防（VICReg 正则化）。 |

### 1.4 现有基础

| 组件 | 文件 | 相关 API |
|-----------|------|-------------|
| **CsiToPoseTransformer** | `graph_transformer.rs` | `embed()` 返回 `[17 x d_model]` 的 body_part_features（已存在） |
| **线性层** | `graph_transformer.rs` | `Linear::new()`、`flatten_into()`、`unflatten_from()` |
| **GnnStack** | `graph_transformer.rs` | 在 COCO 骨架上做 2 层 GCN，使用对称归一化邻接矩阵 |
| **CrossAttention** | `graph_transformer.rs` | 4 头缩放点积注意力 |
| **SONA** | `sona.rs` | `LoraAdapter`, `EwcRegularizer`, `EnvironmentDetector`, `SonaProfile` |
| **Trainer** | `trainer.rs` | 6 项复合损失、SGD+动量、余弦学习率、PCK/OKS 指标、检查点 |
| **稀疏推理** | `sparse_inference.rs` | INT8 对称/非对称量化、FP16、神经元画像、稀疏前向 |
| **RVF 容器** | `rvf_container.rs` | 基于分段的二进制格式：VEC、META、QUANT、WITNESS、PROFILE、MANIFEST |
| **数据集流水线** | `dataset.rs` | MM-Fi（56 个子载波、17 个 COCO 关键点）、Wi-Pose（重采样）、统一的 DataPipeline |
| **HNSW 索引** | `ruvector-core` | `VectorIndex` trait：`add()`、`search()`、`remove()`，余弦/L2/点积度量 |
| **Micro-HNSW** | `micro-hnsw-wasm` | 面向 WASM/边缘的 `no_std` HNSW：16 维、每核 32 个向量、LIF 神经元、STDP |

### 1.5 SOTA 现状（2024-2025）

直接影响 AETHER 设计的最新进展：

- **IdentiFi**（2025）：用潜在 CSI 表示做基于 WiFi 的人员识别的对比学习，证明信号域的对比预训练无需空间位置标签即可产出可区分身份的嵌入。
- **WhoFi**（2025）：基于 transformer 的 WiFi CSI 编码用于人员重识别，在 NTU-Fi 上达到 95.5% 准确率，验证了 transformer 骨干能从 CSI 学到满足重识别质量的特征。
- **CAPC**（2024）：面向 WiFi 感知的上下文感知预测编码，融合 CPC 与 Barlow Twins，从无标签 WiFi 数据中学到时间一致且上下文一致的表示。
- **WiFi HAR 自监督综述**（2025，arXiv:2506.12052）：全面评估 SimCLR、VICReg、Barlow Twins 与 SimSiam 在 WiFi CSI 人体活动识别上的表现。VICReg 下游准确率最佳但需要仔细调参；SimCLR 训练更稳定。
- **ContraWiMAE**（2024-2025）：掩码自编码器加对比预训练用于无线信道表示学习，证明混合式自监督目标优于纯对比或纯重构方案。
- **Wi-PER81**（2025）：包含 16.2 万个无线包的基准数据集，用信号幅度热力图上的孪生网络做基于 WiFi 的人员重识别。

---

## 2. 决策

### 2.1 架构：带对比投影的双头 Transformer

在保留现有姿态回归路径的前提下，增加一个轻量投影头，把 GNN 的身体部位特征映射到归一化嵌入空间：

```
CSI Frame(s) [n_pairs x n_subcarriers]
     |
     v
  csi_embed (Linear 56 -> d_model=64)           [EXISTING]
     |
     v
  CrossAttention (Q=keypoint_queries,            [EXISTING]
                   K,V=csi_embed)
     |
     v
  GnnStack (2-layer GCN, COCO skeleton)          [EXISTING]
     |
     +---> body_part_features [17 x 64]           [EXISTING, now exposed via embed()]
     |          |
     |          v
     |     GlobalMeanPool --> frame_feature [64]   [NEW: mean over 17 keypoints]
     |          |
     |          v
     |     ProjectionHead:                         [NEW]
     |       proj_1: Linear(64, 128) + BatchNorm1D(128) + ReLU
     |       proj_2: Linear(128, 128)
     |       L2-normalize
     |          |
     |          v
     |     z_csi [128-dim unit vector]             [NEW: contrastive embedding]
     |
     +---> xyz_head (Linear 64->3) + conf_head    [EXISTING: pose regression]
            --> keypoints [17 x (x,y,z,conf)]
```

**关键设计选择：**

1. **带 BatchNorm 的 2 层 MLP**：依据 SimCLR v2 的结论——更深的投影头配合批归一化能改善下游任务表现。投影头会丢弃对对比目标无用的信息，使骨干表示保留得更丰富。

2. **128 维输出**：对比学习文献（SimCLR、MoCo、CLIP）的标准选择。大到足以支撑高召回的 HNSW 检索，小到足以在边缘部署。经 L2 归一化落到单位超球面上，便于用余弦相似度。

3. **投影头内使用 BatchNorm1D**：通过在 batch 维度上维持特征方差来防止表示坍缩。它充当隐式的对比机制（VICReg 的洞见），使嵌入各维度去相关。

4. **共享骨干、独立头部**：骨干（csi_embed、交叉注意力、GNN）由姿态回归与嵌入提取共用，从而支持多任务训练，让对比信号与有监督信号共同正则化骨干。

### 2.2 数学基础

#### 2.2.1 InfoNCE 对比损失

给定一批 N 个 CSI 窗口，每个窗口做两次增强得到 2N 个视图，正样本对 (i, j) 的 InfoNCE 损失为：

```
L_InfoNCE(i, j) = -log(  exp(sim(z_i, z_j) / tau)  /  sum_{k != i} exp(sim(z_i, z_k) / tau)  )
```

其中：
- `sim(u, v) = u^T v / (||u|| * ||v||)` 是余弦相似度（对 L2 归一化向量即点积）
- `tau` 是控制分布集中程度的温度超参数
- 分母中的求和遍历除 i 自身外的全部 2N-1 个视图（含正样本 j 与 2N-2 个负样本）

对称的 NT-Xent 损失对每个正样本对的两个方向取平均：

```
L_NT-Xent = (1 / 2N) * sum_{k=1}^{N} [ L_InfoNCE(2k-1, 2k) + L_InfoNCE(2k, 2k-1) ]
```

**温度选择**：`tau = 0.07`（沿用 SimCLR）。温度越低分布越尖锐，损失对困难负样本越敏感。我们使用可学习温度，初始化为 0.07，下限 0.01。

#### 2.2.2 VICReg 正则化（防止坍缩）

在 batch 较小时（CSI 场景常见），纯 InfoNCE 可能坍缩。为此加入 VICReg 正则项：

```
L_variance = (1/d) * sum_{j=1}^{d} max(0, gamma - sqrt(Var(z_j) + epsilon))

L_covariance = (1/d) * sum_{i != j} C(z)_{ij}^2

L_AETHER = alpha * L_NT-Xent + beta * L_variance + gamma_cov * L_covariance
```

其中：
- `Var(z_j)` 是嵌入第 j 维在整个 batch 上的方差
- `C(z)` 是 batch 内嵌入的协方差矩阵
- `gamma = 1.0` 是每维的目标标准差
- `epsilon = 1e-4` 防止零方差梯度
- 默认权重：`alpha = 1.0, beta = 25.0, gamma_cov = 1.0`（依 VICReg 论文）

方差项阻止所有嵌入坍缩到同一个点；协方差项让各维度去相关，使信息量最大化。

#### 2.2.3 面向 CSI 的数据增强策略

每种增强都必须保持 CSI 观测的身份不变（同一房间、同一人、同一活动），只改变无关维度（噪声、时序、硬件漂移）。所有增强都有 WiFi 信号传播上的**物理依据**：

| 增强 | 操作 | 物理依据 | 默认参数 |
|-------------|-----------|--------------------| --------------|
| **时间抖动** | 将窗口起点平移 `U(-J, +J)` 帧 | AP 与客户端之间的时钟同步偏差 | `J = 3` 帧 |
| **子载波掩码** | 随机将 `p_mask` 比例的子载波置零 | 窄带干扰引起的频率选择性衰落 | `p_mask ~ U(0.05, 0.20)` |
| **高斯噪声** | 在幅度上叠加 `N(0, sigma)` | 接收机前端的热噪声 | `sigma ~ U(0.01, 0.05)` |
| **相位旋转** | 每帧叠加 `U(0, 2*pi)` 的均匀随机偏置 | 本振相位漂移与载波频偏 | 逐帧 |
| **幅度缩放** | 乘以 `U(s_lo, s_hi)` | 距离/遮挡变化带来的路径损耗波动 | `s_lo=0.8, s_hi=1.2` |
| **子载波置换** | 以 `p_swap` 概率随机交换相邻子载波对 | 不同 WiFi 芯片组的子载波重排伪影 | `p_swap = 0.1` |
| **时间裁剪** | 随机丢弃窗口中 `p_drop` 比例的帧后插值 | 丢包与 CSI 上报速率波动 | `p_drop ~ U(0.0, 0.15)` |

每个视图顺序组合 2-4 种随机选取的增强。组合按视图单独采样，保证同一 CSI 窗口的两个视图彼此不同。

#### 2.2.4 跨模态对齐（可选阶段 C）

当存在成对的 CSI + 相机姿态数据（MM-Fi、Wi-Pose）时，把 CSI 嵌入空间与姿态语义对齐：

```
z_pose = L2_normalize(PoseEncoder(pose_keypoints_flat))

PoseEncoder: Linear(51, 128) -> ReLU -> Linear(128, 128)  [51 = 17 keypoints * 3 coords]

L_cross = (1/N) * sum_{k=1}^{N} [ -log( exp(sim(z_csi_k, z_pose_k) / tau) / sum_{j} exp(sim(z_csi_k, z_pose_j) / tau) ) ]

L_total = L_supervised_pose + lambda_c * L_contrastive + lambda_x * L_cross
```

这能保证同一姿态的 CSI 嵌入在嵌入空间中彼此接近，从而支持用 CSI 查询检索姿态。

### 2.3 训练策略：三阶段流水线

#### 阶段 A -- 自监督预训练（无标签）

```
Raw CSI Window W (any stream, any environment)
     |
     +---> Aug_1(W) ---> CsiToPoseTransformer.embed() ---> MeanPool ---> ProjectionHead ---> z_1
     |                                                                                         |
     |                                                                              L_AETHER(z_1, z_2)
     |                                                                                         |
     +---> Aug_2(W) ---> CsiToPoseTransformer.embed() ---> MeanPool ---> ProjectionHead ---> z_2
```

- **优化器**：SGD，动量 0.9，权重衰减 1e-4（依 SimCLR，对比学习优先选 SGD 而非 Adam）
- **学习率策略**：前 10 个 epoch 线性预热 0 -> 0.03，随后余弦衰减到 1e-5
- **Batch 大小**：256 个正样本对（共 512 个视图）。有 VICReg 正则化时，较小的 batch（32-64）也可接受。
- **Epoch 数**：100-200（通过嵌入均匀性与对齐度指标监控收敛）
- **监控**：对正样本对跟踪 `alignment = E[||z_i - z_j||^2]`（应下降），对所有样本对跟踪 `uniformity = log(E[exp(-2 * ||z_i - z_j||^2)])`（应下降，表示在超球面上分布均匀）

#### 阶段 B -- 有监督微调（带标签数据）

预训练完成后接上 `xyz_head` 与 `conf_head`，用现有的 6 项复合损失微调（ADR-023 阶段 4），可选地保留对比损失作为正则项：

```
L_total = L_pose_composite + lambda_c * L_contrastive

lambda_c = 0.1 (contrastive acts as regularizer, not primary objective)
```

预训练后的骨干已具备理解 CSI 空间结构的表示，达到同等姿态精度通常只需 1/3 至 1/10 的标注样本。

#### 阶段 C -- 跨模态对齐（可选，需要配对数据）

加入 `L_cross` 对齐 CSI 与姿态嵌入空间。仅在存在成对的 CSI + 相机姿态数据时适用（MM-Fi 提供此类数据）。

### 2.4 HNSW 索引架构

128 维、L2 归一化的 `z_csi` 嵌入送入四个专用 HNSW 索引，各自承担一类识别任务：

| 索引 | 嵌入来源 | 更新频率 | 距离度量 | M | ef_construction | 最大元素数 | 用途 |
|-------|-----------------|-----------------|-----------------|---|----------------|-------------|----------|
| `env_fingerprint` | 10 秒窗口内 `z_csi` 的均值（20 Hz 下 200 帧） | 检测到环境变化时（SONA 漂移） | 余弦 | 16 | 200 | 10K | 房间/区域识别 |
| `activity_pattern` | 活动切换边界处的 `z_csi`（通过嵌入速度检测） | 每检测到一个活动片段 | 余弦 | 12 | 150 | 50K | 活动分类 |
| `temporal_baseline` | 校准期（前 60 秒）内的 `z_csi` | 部署/重新校准时 | 余弦 | 16 | 200 | 1K | 异常/入侵检测 |
| `person_track` | 逐人的 `z_csi` 序列（按嵌入轨迹聚类） | 每次确认检测后 | 余弦 | 16 | 200 | 10K | 跨会话重识别 |

**索引操作：**

```rust
pub trait EmbeddingIndex {
    /// 插入带元数据的嵌入向量
    fn insert(&mut self, embedding: &[f32; 128], metadata: EmbeddingMetadata) -> VectorId;

    /// 搜索 k 个最近邻
    fn search(&self, query: &[f32; 128], k: usize) -> Vec<(VectorId, f32, EmbeddingMetadata)>;

    /// 移除早于 `max_age` 的过期条目
    fn prune(&mut self, max_age: std::time::Duration) -> usize;

    /// 索引统计信息
    fn stats(&self) -> IndexStats;
}

pub struct EmbeddingMetadata {
    pub timestamp: u64,
    pub environment_id: Option<String>,
    pub person_id: Option<u32>,
    pub activity_label: Option<String>,
    pub confidence: f32,
    pub sona_profile: Option<String>,
}
```

**异常检测**使用 `temporal_baseline` 索引：计算 `d = 1 - cosine_sim(z_current, nearest_baseline)`。若连续 `>= n_consecutive` 帧（默认 5）满足 `d > threshold_anomaly`（默认 0.3），则标记为异常。这无需任何任务专用模型即可发现入侵、跌倒与环境变化。

### 2.5 与现有系统的集成

#### 2.5.1 SONA 集成（ADR-005）

每个 `SonaProfile` 已经代表一次面向特定环境的适配。AETHER 再补上一个紧凑的环境描述符：

```rust
pub struct SonaProfile {
    // ……已有字段……

    /// AETHER：该环境下校准 CSI 的平均嵌入。
    /// 128 个浮点数 = 512 字节。用于 O(1) 环境识别，
    /// 在加载完整 LoRA 配置之前完成。
    pub env_embedding: Option<[f32; 128]>,
}
```

**环境切换流程：**
1. 对输入的 CSI 计算 `z_csi`
2. 与所有已知 `SonaProfile` 的 `env_embedding` 比较（128 维点积，每次 <1 us）
3. 若最近的 profile 距离小于阈值：加载该 profile 的 LoRA 权重
4. 若没有接近的 profile：触发针对新环境的 SONA 适配，并保存新的 `env_embedding`

这用具备语义感知的嵌入比较，取代了当前 `EnvironmentDetector` 的统计漂移检验。

#### 2.5.2 RVF 容器扩展（ADR-003）

新增一种用于嵌入模型配置的段类型：

```rust
/// 嵌入模型配置与投影头权重。
/// 段类型：SEG_EMBED = 0x0C
const SEG_EMBED: u8 = 0x0C;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingModelConfig {
    /// 主干特征维度（投影头的输入）
    pub d_model: usize,           // 64
    /// 嵌入输出维度
    pub d_proj: usize,            // 128
    /// 是否对输出做 L2 归一化
    pub normalize: bool,          // true
    /// 所用的预训练方法
    pub pretrain_method: String,  // "simclr" | "vicreg" | "capc"
    /// InfoNCE 的温度系数（如适用）
    pub temperature: f32,         // 0.07
    /// 预训练期间使用的数据增强
    pub augmentations: Vec<String>,
    /// 已完成的预训练轮数
    pub pretrain_epochs: usize,
    /// 预训练结束时的对齐度指标
    pub alignment_score: f32,
    /// 预训练结束时的均匀性指标
    pub uniformity_score: f32,
}
```

投影头权重（25K 个浮点数，FP32 下 100 KB，INT8 下 25 KB）与 transformer 权重一同存放在现有 VEC 段中。RVF manifest 用于区分模型类型：

```json
{
    "model_type": "aether-embedding",
    "backbone": "csi-to-pose-transformer",
    "embedding_dim": 128,
    "pose_capable": true,
    "pretrain_method": "simclr+vicreg"
}
```

#### 2.5.3 稀疏推理集成（ADR-023 阶段 6）

嵌入提取同样受益于 INT8 量化与稀疏神经元剪枝。**关键校验**：量化后必须保持余弦距离的排序。

**排序保持度指标：**

```
rho = SpearmanRank(ranking_fp32, ranking_int8)
```

其中 `ranking` 是测试查询的 k 近邻顺序。要求 `k = 10` 时 `rho > 0.95`。若 `rho < 0.95`，改用混合精度：骨干用 INT8，投影头用 FP16。

**量化预算：**

| 组件 | 参数量 | FP32 | INT8 | FP16 |
|-----------|-----------|------|------|------|
| CsiToPoseTransformer 骨干 | ~28,000 | 112 KB | 28 KB | 56 KB |
| 投影头 ProjectionHead（`proj_1` + `proj_2`） | ~24,960 | 100 KB | 25 KB | 50 KB |
| PoseEncoder（跨模态，可选） | ~7,040 | 28 KB | 7 KB | 14 KB |
| **合计（不含 PoseEncoder）** | **~53,000** | **212 KB** | **53 KB** | **106 KB** |
| **合计（含 PoseEncoder）** | **~60,000** | **240 KB** | **60 KB** | **120 KB** |

ESP32 SRAM 预算为 520 KB。INT8 下模型 53-60 KB，占 SRAM 的 10-12%，为激活值、HNSW 索引和运行时栈留出了充足余量。

### 2.6 具体模块新增

所有新增/修改的文件都位于 `v2/crates/wifi-densepose-sensing-server/src/`：

#### 2.6.1 `embedding.rs`（新增，约 450 行）

```rust
// ── Core types ──────────────────────────────────────────────────────

/// AETHER 嵌入系统的配置。
pub struct AetherConfig {
    pub d_model: usize,          // 64 (from TransformerConfig)
    pub d_proj: usize,           // 128
    pub temperature: f32,        // 0.07
    pub vicreg_alpha: f32,       // 1.0  (InfoNCE weight)
    pub vicreg_beta: f32,        // 25.0 (variance weight)
    pub vicreg_gamma: f32,       // 1.0  (covariance weight)
    pub variance_target: f32,    // 1.0
    pub n_augmentations: usize,  // 2-4 per view
}

/// 2 层 MLP 投影头：Linear -> BN -> ReLU -> Linear -> L2 归一化。
pub struct ProjectionHead {
    proj_1: Linear,       // d_model -> d_proj
    bn_running_mean: Vec<f32>,   // d_proj
    bn_running_var: Vec<f32>,    // d_proj
    bn_gamma: Vec<f32>,          // d_proj (learnable scale)
    bn_beta: Vec<f32>,           // d_proj (learnable shift)
    proj_2: Linear,       // d_proj -> d_proj
}

impl ProjectionHead {
    pub fn new(d_model: usize, d_proj: usize) -> Self;
    pub fn forward(&self, x: &[f32]) -> Vec<f32>;   // returns L2-normalized
    pub fn forward_train(&mut self, batch: &[Vec<f32>]) -> Vec<Vec<f32>>; // updates BN stats
    pub fn flatten_into(&self, out: &mut Vec<f32>);
    pub fn unflatten_from(data: &[f32], d_model: usize, d_proj: usize) -> (Self, usize);
    pub fn param_count(&self) -> usize;
}

/// 面向 CSI 的数据增强流水线。
pub struct CsiAugmenter {
    rng: Rng64,
    config: AugmentConfig,
}

pub struct AugmentConfig {
    pub temporal_jitter_frames: usize,  // 3
    pub mask_ratio_range: (f32, f32),   // (0.05, 0.20)
    pub noise_sigma_range: (f32, f32),  // (0.01, 0.05)
    pub scale_range: (f32, f32),        // (0.8, 1.2)
    pub swap_prob: f32,                 // 0.1
    pub drop_ratio_range: (f32, f32),   // (0.0, 0.15)
}

impl CsiAugmenter {
    pub fn new(seed: u64) -> Self;
    pub fn augment(&mut self, csi_window: &[Vec<f32>]) -> Vec<Vec<f32>>;
}

/// 带温度缩放的 InfoNCE 损失。
pub fn info_nce_loss(embeddings_a: &[Vec<f32>], embeddings_b: &[Vec<f32>], temperature: f32) -> f32;

/// VICReg 方差损失：惩罚标准差低于目标值的维度。
pub fn variance_loss(embeddings: &[Vec<f32>], target: f32) -> f32;

/// VICReg 协方差损失：惩罚彼此相关的维度。
pub fn covariance_loss(embeddings: &[Vec<f32>]) -> f32;

/// 组合后的 AETHER 损失 = alpha * InfoNCE + beta * 方差 + gamma * 协方差。
pub fn aether_loss(
    z_a: &[Vec<f32>], z_b: &[Vec<f32>],
    temperature: f32, alpha: f32, beta: f32, gamma: f32, var_target: f32,
) -> AetherLossComponents;

pub struct AetherLossComponents {
    pub total: f32,
    pub info_nce: f32,
    pub variance: f32,
    pub covariance: f32,
}

/// 完整的嵌入提取流水线。
pub struct EmbeddingExtractor {
    transformer: CsiToPoseTransformer,
    projection: ProjectionHead,
    config: AetherConfig,
}

impl EmbeddingExtractor {
    pub fn new(transformer: CsiToPoseTransformer, config: AetherConfig) -> Self;

    /// 从 CSI 特征中提取 128 维、L2 归一化的嵌入。
    pub fn embed(&self, csi_features: &[Vec<f32>]) -> Vec<f32>;

    /// 单次前向传播同时产出姿态关键点与嵌入。
    pub fn forward_dual(&self, csi_features: &[Vec<f32>]) -> (PoseOutput, Vec<f32>);

    /// 展平全部权重（transformer + 投影头）。
    pub fn flatten_weights(&self) -> Vec<f32>;

    /// 反展平全部权重。
    pub fn unflatten_weights(&mut self, params: &[f32]) -> Result<(), String>;

    /// 可训练参数总数。
    pub fn param_count(&self) -> usize;
}

// ── Monitoring ──────────────────────────────────────────────────────

/// 对齐度指标：正样本对嵌入之间的平均 L2 距离。
pub fn alignment_metric(z_a: &[Vec<f32>], z_b: &[Vec<f32>]) -> f32;

/// 均匀性指标：成对高斯核均值的对数。
pub fn uniformity_metric(embeddings: &[Vec<f32>], t: f32) -> f32;
```

#### 2.6.2 `trainer.rs`（修改）

```rust
// 添加到 LossComponents：
pub struct LossComponents {
    // ……已有 6 项……
    pub contrastive: f32,      // NEW: AETHER contrastive loss
}

// 添加到 LossWeights：
pub struct LossWeights {
    // ……已有 6 个权重……
    pub contrastive: f32,      // NEW: default 0.0 (disabled), set to 0.1 for joint training
}

// 添加到 TrainerConfig：
pub struct TrainerConfig {
    // ……已有字段……
    pub contrastive_loss_weight: f32,  // NEW: 0.0 = no contrastive, 0.1 = regularizer
    pub aether_config: Option<AetherConfig>,  // NEW: None = no AETHER
}

// Trainer 上的新方法：
impl Trainer {
    /// 用 AETHER 对比损失做自监督预训练的单轮。
    /// 不需要姿态标签，只需要原始 CSI 窗口。
    pub fn pretrain_epoch(
        &mut self,
        csi_windows: &[Vec<Vec<f32>>],
        augmenter: &mut CsiAugmenter,
    ) -> PretrainEpochStats;

    /// 完整的自监督预训练循环。
    pub fn run_pretraining(
        &mut self,
        csi_windows: &[Vec<Vec<f32>>],
        n_epochs: usize,
    ) -> PretrainResult;
}

pub struct PretrainEpochStats {
    pub epoch: usize,
    pub loss: f32,
    pub info_nce: f32,
    pub variance: f32,
    pub covariance: f32,
    pub alignment: f32,
    pub uniformity: f32,
    pub lr: f32,
}

pub struct PretrainResult {
    pub best_epoch: usize,
    pub best_alignment: f32,
    pub best_uniformity: f32,
    pub history: Vec<PretrainEpochStats>,
    pub total_time_secs: f64,
}
```

#### 2.6.3 `rvf_container.rs`（少量新增）

```rust
/// 嵌入模型配置的段类型。
const SEG_EMBED: u8 = 0x0C;

impl RvfBuilder {
    /// 添加 AETHER 嵌入模型配置。
    pub fn add_embedding_config(&mut self, config: &EmbeddingModelConfig) {
        let payload = serde_json::to_vec(config).unwrap_or_default();
        self.push_segment(SEG_EMBED, &payload);
    }
}

impl RvfReader {
    /// 解析并返回嵌入模型配置（若存在）。
    pub fn embedding_config(&self) -> Option<EmbeddingModelConfig> {
        self.find_segment(SEG_EMBED)
            .and_then(|data| serde_json::from_slice(data).ok())
    }
}
```

#### 2.6.4 `graph_transformer.rs`（无需改动）

`embed()` 方法已经存在并返回 `[17 x d_model]`，无需修改。

### 2.7 参数预算

| 组件 | 参数量 | 拆解 | FP32 | INT8 |
|-----------|--------|-----------|------|------|
| `csi_embed` | 3,648 | 56*64 + 64 | 14.6 KB | 3.6 KB |
| `keypoint_queries` | 1,088 | 17*64 | 4.4 KB | 1.1 KB |
| `CrossAttention`（4 头） | 16,640 | 4*(64*64+64) | 66.6 KB | 16.6 KB |
| `GnnStack`（2 层） | 8,320 | 2*(64*64+64) | 33.3 KB | 8.3 KB |
| `xyz_head` | 195 | 64*3 + 3 | 0.8 KB | 0.2 KB |
| `conf_head` | 65 | 64*1 + 1 | 0.3 KB | 0.1 KB |
| **主干小计** | **29,956** | | **119.8 KB** | **29.9 KB** |
| `proj_1`（线性层） | 8,320 | 64*128 + 128 | 33.3 KB | 8.3 KB |
| `bn_1` (gamma + beta) | 256 | 128 + 128 | 1.0 KB | 0.3 KB |
| `proj_2`（线性层） | 16,512 | 128*128 + 128 | 66.0 KB | 16.5 KB |
| **投影头小计** | **25,088** | | **100.4 KB** | **25.1 KB** |
| **AETHER 总计** | **55,044** | | **220.2 KB** | **55.0 KB** |
| `PoseEncoder`（可选） | 7,040 | 51*128+128 + 128*128+128 | 28.2 KB | 7.0 KB |
| **全系统** | **62,084** | | **248.3 KB** | **62.1 KB** |

### 2.8 性能目标

| 指标 | 目标 | 测量方式 |
|--------|--------|-------------|
| 嵌入提取延迟（FP32，x86） | < 1 ms | `BenchmarkRunner::benchmark_inference()` |
| 嵌入提取延迟（INT8，ESP32） | < 2 ms | 240 MHz 下的硬件基准测试 |
| HNSW 检索延迟（10K 向量，k=5） | < 0.5 ms | `ruvector-core` 基准测试套件 |
| 自监督预训练收敛 | < 200 epochs | 对齐度/均匀性进入平台期的检测 |
| 房间识别准确率（5 个房间） | > 95% | 在 `env_fingerprint` 索引上做 k-NN |
| 活动分类准确率（6 类活动） | > 85% | 在 `activity_pattern` 索引上做 k-NN |
| 人员重识别 mAP（5 名受试者） | > 80% | 在 `person_track` 索引上取 Rank-1 |
| 异常检测 F1 | > 0.90 | 在 `temporal_baseline` 上设距离阈值 |
| INT8 与 FP32 的排序相关性 | > 0.95 | 对 1000 组查询-邻居对计算 Spearman |
| INT8 下模型大小 | < 65 KB | `param_count * 1 byte` |
| 训练内存开销 | < 50 MB | 预训练期间的峰值 RSS |

### 2.9 边缘部署策略

#### 2.9.1 ESP32（通过 C/Rust 交叉编译）

- 必须使用 INT8 量化（53 KB 模型 + 20 KB 激活缓冲 = 520 KB SRAM 中的 73 KB）
- `micro-hnsw-wasm` 每核最多存 32 个参考嵌入（256 核 = 8K 个嵌入）
- 嵌入提取以 20 Hz 运行（50 ms 预算，目标 <2 ms）
- 32 向量索引的 HNSW 检索额外耗时 <0.1 ms
- 整条流水线：CSI 采集（25 ms）+ 嵌入（2 ms）+ 检索（0.1 ms）= 27.1 ms < 50 ms 预算

#### 2.9.2 WASM（浏览器/服务端）

- FP32 或 FP16 模型（尺寸约束放宽）
- `ruvector-core` HNSW 索引使用完整模式（最多 100 万个向量）
- 用 Web Worker 做非阻塞推理
- REST API 端点：`POST /api/v1/embedding/extract`（输入：CSI 帧，输出：128 维向量）
- REST API 端点：`POST /api/v1/embedding/search`（输入：128 维向量，输出：k 个最近邻）
- WebSocket 端点：`ws://.../embedding/stream`（流式 CSI -> 流式嵌入）

---

## 3. 实施阶段

### 阶段 1：嵌入模块（2-3 天）

**文件：**
- `embedding.rs`（新增）：`ProjectionHead`、`CsiAugmenter`、`EmbeddingExtractor`、损失函数、指标
- `rvf_container.rs`（修改）：加入 `SEG_EMBED`、`add_embedding_config()`、`embedding_config()`
- `lib.rs`（修改）：加入 `pub mod embedding;`

**交付物：**
- `ProjectionHead`，含 `forward()`、`forward_train()`、`flatten_into()`、`unflatten_from()`
- `CsiAugmenter`，含全部 7 种增强策略
- `info_nce_loss()`, `variance_loss()`, `covariance_loss()`, `aether_loss()`
- `EmbeddingExtractor`，含 `embed()` 与 `forward_dual()`
- `alignment_metric()` 与 `uniformity_metric()`
- 单元测试：增强输出形状、损失梯度方向、L2 归一化、投影头往返一致性
- **行数**：约 450

### 阶段 2：自监督预训练（1-2 天）

**文件：**
- `trainer.rs`（修改）：加入 `pretrain_epoch()`、`run_pretraining()`，并把对比损失并入复合损失
- `embedding.rs`（扩展）：加入 `PretrainEpochStats`、`PretrainResult`

**交付物：**
- `Trainer::pretrain_epoch()` 在原始 CSI 窗口上运行 SimCLR+VICReg
- `Trainer::run_pretraining()` 完整循环并带监控
- `LossComponents` 与 `LossWeights` 中的对比损失权重
- 集成测试：在合成 CSI 上预训练 10 个 epoch，验证对齐度改善
- **行数**：`trainer.rs` 新增约 200 行

### 阶段 3：HNSW 指纹流水线（2-3 天）

**文件：**
- `embedding.rs`（扩展）：加入 `EmbeddingIndex` trait、`EmbeddingMetadata`、索引管理
- `main.rs` 或新建 `api_embedding.rs`（修改/新增）：嵌入检索的 REST 端点

**交付物：**
- 四类 HNSW 索引，具备 insert/search/prune 操作
- 通过嵌入比较切换环境（取代统计漂移检验）
- 通过基线距离阈值做异常检测
- REST API 端点：`/api/v1/embedding/extract`、`/api/v1/embedding/search`
- 与现有 SONA `EnvironmentDetector` 集成
- **行数**：约 300

### 阶段 4：跨模态对齐（1 天，可选）

**文件：**
- `embedding.rs`（扩展）：加入 `PoseEncoder`、`cross_modal_loss()`

**交付物：**
- `PoseEncoder` 结构：Linear(51 -> 128) -> ReLU -> Linear(128 -> 128) -> L2-norm
- 在成对 CSI + 姿态数据上做跨模态 InfoNCE 损失
- 用于从 CSI 查询检索姿态的评估脚本
- **行数**：约 150

### 阶段 5：量化嵌入验证（1 天）

**文件：**
- `sparse_inference.rs`（扩展）：加入 `SpearmanRankCorrelation` 与嵌入专用量化测试
- `rvf_pipeline.rs`（修改）：把 AETHER 模型连同 SEG_EMBED 打包进 RVF

**交付物：**
- INT8 与 FP32 嵌入的 Spearman 秩相关测试
- 混合精度回退（INT8 骨干 + FP16 投影头）
- ESP32 延迟目标基准验证
- 完整 AETHER 模型的 RVF 打包
- **行数**：约 150

### 阶段 6：集成测试与基准（1-2 天）

**交付物：**
- 端到端测试：CSI -> embed -> HNSW insert -> HNSW search -> 校验最近邻正确性
- MM-Fi 数据集上的预训练收敛基准
- 量化排序保持度基准
- ESP32 仿真延迟基准
- 验证全部性能目标

**总工作量估计：8-12 天**

---

## 4. 影响

### 正面影响

- **用无标签 CSI 做自监督预训练**：任意 WiFi CSI 流（无需相机、无需标注）都能预训练嵌入骨干，大幅降低对标注数据的需求。这是影响力最大的一项能力：WiFi 信号无处不在且免费。
- **100% 复用现有基础设施**：不引入新的模型架构，只在现有 CsiToPoseTransformer 上扩展一个模块、一个损失项、一种 RVF 段类型。
- **可直接用于 HNSW 的嵌入**：128 维 L2 归一化向量能直接接入 ADR-004 提出的 HNSW 索引，补上了该 ADR 中「向量编码」流水线的缺口。
- **嵌入可多用途**：同一模型在单次前向传播中同时产出姿态关键点与嵌入向量，一次推理换来两项能力。
- **无需任务专用模型即可做异常检测**：分布外的 CSI 帧会产出远离训练分布的嵌入。跌倒检测、入侵检测与环境变化检测，都是嵌入空间几何结构的副产物。
- **紧凑的环境指纹**：128 维嵌入（512 字节）取代约 448 KB 的 `SonaProfile` 用于环境识别，压缩约 900 倍且区分能力更强。
- **跨环境迁移**：在多样环境上做对比预训练，可得到捕捉环境不变人体动态的特征，从而用少量样本（5-10 个标注样本）适配新空间。
- **可边缘部署**：INT8 下 55 KB，装入 ESP32 SRAM 后仍有 88% 余量。整条嵌入 + 检索流水线在 <3 ms 内完成。
- **保护隐私**：嵌入无法反推出原始 CSI。投影头的信息瓶颈（17x64 -> 128）丢弃了环境专属细节，使嵌入适合跨站点比较而不泄露房间几何。

### 负面影响

- **嵌入质量受骨干制约**：与独立的嵌入模型不同，质量取决于 CsiToPoseTransformer。缓解方式是让投影头补上一层任务专用的非线性变换。
- **对增强敏感**：自监督嵌入质量取决于增强设计。过强会导致嵌入坍缩，过弱只能学到平凡的不变性。缓解方式是 VICReg 方差正则化，并用对齐度/均匀性指标监控。
- **多出一个训练阶段**：先预训练再微调，比直接做有监督训练更长。缓解方式：(a) 预训练是一次性成本；(b) 得到的骨干在有监督任务上收敛更快。
- **量化下的余弦距离**：INT8 可能扭曲相对距离，降低 HNSW 召回率。缓解方式是 Spearman 秩相关检验，并对投影头回退到 FP16。
- **投影头中的 BatchNorm**：引入训练/推理两种模式（running 统计量 vs batch 统计量）。推理时使用训练期间累积的 running 均值/方差；在设备端，这只是固定的逐维度缩放加平移。

### 风险与缓解措施

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------------|--------|------------|
| 增强导致嵌入坍缩（所有向量完全相同） | Medium | High | 用 VICReg 方差项（`beta=25`）并逐维监控方差。若任一 j 满足 `Var(z_j) < 0.1` 则告警。坍缩持续时改用 BYOL（stop-gradient）。 |
| INT8 量化使 HNSW 召回率跌破 90% | Low | Medium | 以 Spearman `rho > 0.95` 作为门槛。混合精度回退：INT8 骨干 + FP16 投影头（+25 KB）。 |
| 对比预训练未能提升下游姿态精度 | Low | Low | 预训练是可选的，纯有监督训练（ADR-023）始终是兜底路径。即便姿态精度不变，嵌入仍能支持指纹与检索。 |
| 跨模态对齐收敛需要过多配对数据 | Medium | Low | 阶段 C 是可选的，纯 CSI 自监督预训练（阶段 A）才是主路径。跨模态对齐是增强项，不是必需项。 |
| 投影头过拟合预训练增强 | Low | Medium | 有监督微调期间冻结投影头（只微调骨干 + 姿态头）。也可在联合训练时对投影头使用 stop-gradient。 |
| 嵌入空间对人员重识别区分度不足 | Medium | Medium | WhoFi（2025）用 transformer 编码 CSI 达到 95.5% 准确率，我们的架构与之相当。若仍不足，微调时加入带人员标签的有监督对比损失。 |

---

## 5. 测试策略

### 5.1 单元测试（位于 `embedding.rs`）

```rust
#[cfg(test)]
mod tests {
    // ProjectionHead 相关测试
    fn projection_head_output_is_128_dim();
    fn projection_head_output_is_l2_normalized();
    fn projection_head_zero_input_does_not_nan();
    fn projection_head_flatten_unflatten_roundtrip();
    fn projection_head_param_count_correct();

    // CsiAugmenter 相关测试
    fn augmenter_output_same_shape_as_input();
    fn augmenter_two_views_differ();
    fn augmenter_deterministic_with_same_seed();
    fn temporal_jitter_shifts_window();
    fn subcarrier_masking_zeros_expected_fraction();
    fn gaussian_noise_changes_values();
    fn amplitude_scaling_within_range();

    // 损失函数
    fn info_nce_zero_for_identical_embeddings();
    fn info_nce_positive_for_different_embeddings();
    fn info_nce_decreases_with_closer_positives();
    fn variance_loss_zero_when_variance_at_target();
    fn variance_loss_positive_when_variance_below_target();
    fn covariance_loss_zero_for_uncorrelated_dims();
    fn aether_loss_finite_for_random_embeddings();

    // 指标
    fn alignment_zero_for_identical_pairs();
    fn uniformity_decreases_with_uniform_distribution();

    // EmbeddingExtractor 相关测试
    fn extractor_embed_output_shape();
    fn extractor_dual_forward_produces_both_outputs();
    fn extractor_flatten_unflatten_preserves_output();
}
```

### 5.2 集成测试

```rust
#[cfg(test)]
mod integration_tests {
    // 预训练
    fn pretrain_5_epochs_alignment_improves();
    fn pretrain_loss_is_finite_throughout();
    fn pretrain_embeddings_not_collapsed(); // variance > 0.5 per dim

    // 联合训练
    fn joint_train_contrastive_plus_pose_loss_finite();
    fn joint_train_pose_accuracy_not_degraded();

    // RVF 相关测试
    fn rvf_embed_config_round_trip();
    fn rvf_full_aether_model_package();

    // 量化
    fn int8_embedding_rank_correlation_above_095();
    fn fp16_embedding_rank_correlation_above_099();
}
```

---

## 6. 阶段 7：深度集成 RuVector — MicroLoRA + EWC++ + 库内损失函数

**状态**：Required（能力审计后从「后续工作」提升为必做）

vendored 的 RuVector v2.0.4 crate 提供了 50 多种注意力机制、对比损失与优化工具，阶段 1-6 完全没有使用（利用率 0%）。阶段 7 把影响力最大的几项能力直接接入嵌入流水线。

### 6.1 ProjectionHead 上的 MicroLoRA（面向特定环境的嵌入）

把 `sona.rs::LoraAdapter` 集成进 `ProjectionHead`，用极少的参数实现随环境自适应的嵌入投影：

```rust
pub struct ProjectionHead {
    proj_1: Linear,                       // base weights (frozen after pretraining)
    proj_1_lora: Option<LoraAdapter>,     // rank-4 environment delta (NEW)
    // ……bn 相关字段……
    proj_2: Linear,                       // base weights (frozen)
    proj_2_lora: Option<LoraAdapter>,     // rank-4 environment delta (NEW)
}
```

**每个环境的参数预算：**
- `proj_1_lora`：rank 4 * (64 + 128) = **768 个参数**
- `proj_2_lora`：rank 4 * (128 + 128) = **1,024 个参数**
- **合计：1,792 个参数/环境**，而完整 ProjectionHead 为 24,832，**减少 93%**

**需要新增的方法：**
- `ProjectionHead::with_lora(rank: usize)` — 带 LoRA adapter 的构造函数
- 修改 `ProjectionHead::forward()`：存在 adapter 时 `out = base_out + lora.forward(input)`
- `ProjectionHead::merge_lora()` / `unmerge_lora()` — 用于快速切换环境
- `ProjectionHead::freeze_base()` — 冻结基础权重，只训练 LoRA
- `ProjectionHead::lora_params() -> Vec<f32>` — 只展平 LoRA 权重供检查点保存

**环境切换流程：**
1. 对输入的 CSI 计算 `z_csi`
2. 与所有已知 profile 中保存的 `env_embedding` 比较（128 维点积，每次 <1 us）
3. 若最近的 profile 小于阈值：先 `unmerge_lora(old)`，再 `merge_lora(new)`
4. 若没有接近的 profile：为新环境启动 LoRA 适配

**工作量**：`embedding.rs` 约 120 行

### 6.2 用 EWC++ 巩固预训练到微调的过渡

应用 `sona.rs::EwcRegularizer`，避免有监督微调期间遗忘预训练得到的对比结构：

```
Phase A (pretrain):   Train backbone + projection with InfoNCE + VICReg
                      ↓
Consolidation:        fisher = EwcRegularizer::compute_fisher(pretrained_params, contrastive_loss)
                      ewc.consolidate(pretrained_params)
                      ↓
Phase B (finetune):   L_total = L_pose + lambda * ewc.penalty(current_params)
                      grad += ewc.penalty_gradient(current_params)
```

**实现：**
- 给 `Trainer` 增加 `embedding_ewc: Option<EwcRegularizer>` 字段
- `run_pretraining()` 完成后，在对比损失曲面上调用 `ewc.compute_fisher()`
- 在 `train_epoch()` 期间，把 `ewc.penalty(current_params)` 加入总损失
- 把 `ewc.penalty_gradient(current_params)` 加入梯度计算
- Lambda 默认 5000.0（取自 SONA 配置），随微调轮数衰减

**工作量**：`trainer.rs` 约 80 行

### 6.3 嵌入流水线中的 EnvironmentDetector

把 `sona.rs::EnvironmentDetector` 接入 `EmbeddingExtractor`，实现实时漂移感知：

```rust
pub struct EmbeddingExtractor {
    transformer: CsiToPoseTransformer,
    projection: ProjectionHead,
    config: AetherConfig,
    drift_detector: EnvironmentDetector,   // NEW
}
```

**行为：**
- `extract()` 每帧调用 `drift_detector.update(csi_mean, csi_var)`
- 当 `drift_detected()` 返回 true 时：
  - 在 `FingerprintIndex` 中把新嵌入标记为 `anomalous: true`
  - 触发 ProjectionHead 上的 LoRA 适配（见 6.1）
  - 可选地暂停 HNSW 插入，直到漂移稳定
- 通过 REST 暴露 `DriftInfo`：`GET /api/v1/embedding/drift`

**工作量**：`embedding.rs` 等文件合计约 60 行

### 6.4 面向对比训练的困难负样本挖掘

在对比损失中加入困难负样本挖掘，提高训练效率：

```rust
pub struct HardNegativeMiner {
    pub ratio: f32,        // 0.5 = use top 50% hardest negatives
    pub warmup_epochs: usize, // 5 = use all negatives for first 5 epochs
}

impl HardNegativeMiner {
    /// 从相似度矩阵中选出最难的 top-K 个负样本。
    /// 困难负样本指余弦相似度最高的非匹配对
    /// （即模型最容易混淆的那些）。
    pub fn mine(&self, sim_matrix: &[Vec<f32>], epoch: usize) -> Vec<(usize, usize)>;
}
```

修改 `info_nce_loss()`，使其接受可选的 miner：
- 前 `warmup_epochs` 轮：使用全部负样本（标准 InfoNCE）
- 预热之后：每个 anchor 只使用最难的 `ratio` 比例负样本
- 不增大 batch 也能提高有效训练难度

**工作量**：`embedding.rs` 约 80 行

### 6.5 RVF SEG_EMBED 与 LoRA profile 存储

扩展 RVF 容器，同时存放嵌入模型配置与各环境的 LoRA 增量：

```rust
pub const SEG_EMBED: u8 = 0x0C;
pub const SEG_LORA: u8 = 0x0D;  // NEW: LoRA weight deltas

pub struct EmbeddingModelConfig {
    pub d_model: usize,
    pub d_proj: usize,
    pub normalize: bool,
    pub pretrain_method: String,
    pub temperature: f32,
    pub augmentations: Vec<String>,
    pub lora_rank: Option<usize>,     // Some(4) if MicroLoRA enabled
    pub ewc_lambda: Option<f32>,      // Some(5000.0) if EWC active
    pub hard_negative_ratio: Option<f32>,
}

impl RvfBuilder {
    pub fn add_embedding_config(&mut self, config: &EmbeddingModelConfig);
    pub fn add_lora_profile(&mut self, name: &str, lora_weights: &[f32]);
}

impl RvfReader {
    pub fn embedding_config(&self) -> Option<EmbeddingModelConfig>;
    pub fn lora_profile(&self, name: &str) -> Option<Vec<f32>>;
    pub fn lora_profiles(&self) -> Vec<String>;  // list all stored profiles
}
```

**工作量**：`rvf_container.rs` 约 100 行

### 阶段 7 汇总

| 子阶段 | 内容 | 新增参数 | 行数 |
|-----------|------|-----------|-------|
| 7.1 ProjectionHead 上的 MicroLoRA | 面向特定环境的嵌入 | 1,792/env | ~120 |
| 7.2 EWC++ 巩固 | 保留预训练到微调的记忆 | 0（正则项） | ~80 |
| 7.3 EnvironmentDetector 集成 | 具备漂移感知的嵌入提取 | 0 | ~60 |
| 7.4 困难负样本挖掘 | 更高效的对比训练 | 0 | ~80 |
| 7.5 RVF SEG_EMBED + SEG_LORA | 完整模型 + LoRA profile 打包 | 0 | ~100 |
| **合计** | | **1,792/env** | **~440** |

## 7. 后续工作

- **掩码自编码器预训练（ContraWiMAE 风格）**：把对比学习与掩码重构结合，得到更丰富的预训练表示。随机遮蔽子载波-时间块并重构，把重构损失作为额外的预训练信号。
- **双曲嵌入**：用 `ruvector-hyperbolic-hnsw` crate 把活动嵌入庞加莱球空间，捕捉天然的层级关系（移动 > 行走 > 拖步）。
- **时序对比损失**：从单帧 InfoNCE 扩展到时序 CPC（对比预测编码），让模型从过去的 CSI 嵌入预测未来嵌入，从而捕捉时间动态。
- **联邦式 AETHER**：在多个部署站点之间训练嵌入，而不集中原始 CSI 数据。各站点计算本地梯度更新，中心服务器用 FedAvg 聚合，跨站点边界的只有嵌入空间中的梯度。
- **RuVector 高级注意力**：集成 `MoEAttention` 把 CSI 帧路由到专用的嵌入专家，`HyperbolicAttention` 处理 CSI 的层级结构，`SheafAttention` 在嵌入提取中实现提前退出。

---

## 7. 参考资料

### 对比学习基础
- [SimCLR: A Simple Framework for Contrastive Learning of Visual Representations](https://arxiv.org/abs/2002.05709)（Chen 等，ICML 2020）
- [SimCLR v2: Big Self-Supervised Models are Strong Semi-Supervised Learners](https://arxiv.org/abs/2006.10029)（Chen 等，NeurIPS 2020）
- [MoCo v3: An Empirical Study of Training Self-Supervised Vision Transformers](https://arxiv.org/abs/2104.02057)（Chen 等，ICCV 2021）
- [BYOL: Bootstrap Your Own Latent](https://arxiv.org/abs/2006.07733)（Grill 等，NeurIPS 2020）
- [VICReg: Variance-Invariance-Covariance Regularization for Self-Supervised Learning](https://arxiv.org/abs/2105.04906)（Bardes 等，ICLR 2022）
- [DINO: Emerging Properties in Self-Supervised Vision Transformers](https://arxiv.org/abs/2104.14294)（Caron 等，ICCV 2021）
- [Barlow Twins: Self-Supervised Learning via Redundancy Reduction](https://arxiv.org/abs/2103.03230)（Zbontar 等，ICML 2021）
- [Understanding Contrastive Representation Learning through Alignment and Uniformity on the Hypersphere](https://arxiv.org/abs/2005.10242)（Wang & Isola，ICML 2020）
- [CLIP: Learning Transferable Visual Models From Natural Language Supervision](https://arxiv.org/abs/2103.00020)（Radford 等，ICML 2021）

### WiFi 感知与 CSI 嵌入
- [DensePose From WiFi](https://arxiv.org/abs/2301.00250)（Geng 等，CMU，2023）
- [WhoFi: Deep Person Re-Identification via Wi-Fi Channel Signal Encoding](https://arxiv.org/abs/2507.12869)（2025）
- [IdentiFi: Self-Supervised WiFi-Based Identity Recognition in Multi-User Smart Environments](https://pmc.ncbi.nlm.nih.gov/articles/PMC12115556/)（2025）
- [Context-Aware Predictive Coding (CAPC): A Representation Learning Framework for WiFi Sensing](https://arxiv.org/abs/2410.01825)（2024）
- [A Tutorial-cum-Survey on Self-Supervised Learning for Wi-Fi Sensing](https://arxiv.org/abs/2506.12052)（2025）
- [Evaluating Self-Supervised Learning for WiFi CSI-Based Human Activity Recognition](https://dl.acm.org/doi/10.1145/3715130)（ACM TOSN，2025）
- [Wi-Fi CSI Fingerprinting-Based Indoor Positioning Using Deep Learning and Vector Embedding](https://www.sciencedirect.com/science/article/abs/pii/S0957417424026691)（2024）
- [SelfHAR: Improving Human Activity Recognition through Self-training with Unlabeled Data](https://arxiv.org/abs/2102.06073)（2021）
- [WiFi CSI Contrastive Pre-training for Activity Recognition](https://doi.org/10.1145/3580305.3599383)（Wang 等，KDD 2023）
- [Wi-PER81: Benchmark Dataset for Radio Signal Image-based Person Re-Identification](https://www.nature.com/articles/s41597-025-05804-0)（Nature Sci Data，2025）
- [SignFi: Sign Language Recognition Using WiFi](https://arxiv.org/abs/1806.04583)（Ma 等，2018）

### 面向时间序列的自监督学习
- [Self-Supervised Contrastive Learning for Long-term Forecasting](https://openreview.net/forum?id=nBCuRzjqK7)（2024）
- [Resampling Augmentation for Time Series Contrastive Learning](https://arxiv.org/abs/2506.18587)（2025）
- [Diffusion Model-based Contrastive Learning for Human Activity Recognition](https://arxiv.org/abs/2408.05567)（2024）
- [Self-Supervised Contrastive Learning for 6G UM-MIMO THz Communications](https://rings.winslab.lids.mit.edu/wp-content/uploads/2024/06/MurUllSaqWin-ICC-06-2024.pdf)（ICC 2024）

### 内部 ADR
- ADR-003：面向 CSI 数据的 RVF 认知容器
- ADR-004：用于信号指纹的 HNSW 向量检索
- ADR-005：面向姿态估计的 SONA 自学习
- ADR-006：GNN 增强的 CSI 模式识别
- ADR-014：SOTA 信号处理算法
- ADR-015：公开数据集训练策略
- ADR-016：训练流水线的 RuVector 集成
- ADR-023：采用 RuVector 信号智能流水线的训练式 DensePose 模型
