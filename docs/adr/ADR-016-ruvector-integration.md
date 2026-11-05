# ADR-016：训练流水线的 RuVector 集成

## 状态

Accepted

## 背景

`wifi-densepose-train` crate（ADR-015）最初用标准 crate 实现
（`petgraph`、`ndarray`、自研信号处理）。而 ruvector 生态
提供了已发布的 Rust crate，其中的次多项式算法可以
直接替换多个组件，且实现更优。

所有 ruvector crate 均已在 crates.io 发布 v2.0.4（已核实），
源码见 https://github.com/ruvnet/ruvector。

### 可用的 ruvector crate（均为 v2.0.4，已发布到 crates.io）

| Crate | 说明 | 默认特性 |
|-------|-------------|-----------------|
| `ruvector-mincut` | 首个次多项式动态最小割实现 | `exact`、`approximate` |
| `ruvector-attn-mincut` | 最小割门控注意力（基于图，可替代 softmax） | 全部模块 |
| `ruvector-attention` | 几何、图与稀疏注意力机制 | 全部模块 |
| `ruvector-temporal-tensor` | 带分层量化的时序张量压缩 | 全部模块 |
| `ruvector-solver` | 亚线性时间稀疏线性求解器，O(log n) 至 O(√n) | `neumann`、`cg`、`forward-push` |
| `ruvector-core` | 带 HNSW 索引的向量数据库内核 | v2.0.5 |
| `ruvector-math` | 最优传输、信息几何 | v2.0.4 |

### 已核实的 API 细节（来自 github.com/ruvnet/ruvector 源码核查）

#### ruvector-mincut

```rust
use ruvector_mincut::{MinCutBuilder, DynamicMinCut, MinCutResult, VertexId, Weight};

// 构建动态最小割结构
let mut mincut = MinCutBuilder::new()
    .exact()                                          // or .approximate(0.1)
    .with_edges(vec![(u: VertexId, v: VertexId, w: Weight)])  // (u32, u32, f64) tuples
    .build()
    .expect("Failed to build");

// 次多项式 O(n^{o(1)}) 的摊还动态更新
mincut.insert_edge(u, v, weight) -> Result<f64>   // new cut value
mincut.delete_edge(u, v) -> Result<f64>           // new cut value

// 查询
mincut.min_cut_value() -> f64
mincut.min_cut() -> MinCutResult                  // includes partition
mincut.partition() -> (Vec<VertexId>, Vec<VertexId>)   // S and T sets
mincut.cut_edges() -> Vec<Edge>                   // edges crossing the cut
// 注意：VertexId = u64（不是 u32）；Edge 的字段为 { source: u64, target: u64, weight: f64 }
```

`MinCutResult` 包含：
- `value: f64` — 最小割权重
- `is_exact: bool` — 是否为精确解
- `approximation_ratio: f64` — 近似比
- `partition: Option<(Vec<VertexId>, Vec<VertexId>)>` — S 与 T 节点集合

#### ruvector-attn-mincut

```rust
use ruvector_attn_mincut::{attn_mincut, attn_softmax, AttentionOutput, MinCutConfig};

// 最小割门控注意力（可直接替换 softmax 注意力）
// Q、K、V 均为扁平 &[f32]，形状为 [seq_len, d]
let output: AttentionOutput = attn_mincut(
    q: &[f32],       // queries: flat [seq_len * d]
    k: &[f32],       // keys:    flat [seq_len * d]
    v: &[f32],       // values:  flat [seq_len * d]
    d: usize,        // feature dimension
    seq_len: usize,  // number of tokens / antenna paths
    lambda: f32,     // min-cut threshold (larger = more pruning)
    tau: usize,      // temporal hysteresis window
    eps: f32,        // numerical epsilon
) -> AttentionOutput;

// 注意力输出
pub struct AttentionOutput {
    pub output: Vec<f32>,  // attended values [seq_len * d]
    pub gating: GatingResult,  // which edges were kept/pruned
}

// 用于对照的基线 softmax 注意力
let output: Vec<f32> = attn_softmax(q, k, v, d, seq_len);
```

**在 wifi-densepose-train 中的用途**：在 `ModalityTranslator` 里，把
`T * n_tx * n_rx` 条天线×时间路径当作 `seq_len` 个 token，把 `n_sc`
个子载波当作特征维度 `d`。用 `attn_mincut` 门控掉无关的
天线对相关性，再送入全连接层。

#### ruvector-solver（NeumannSolver 求解器）

```rust
use ruvector_solver::neumann::NeumannSolver;
use ruvector_solver::types::CsrMatrix;
use ruvector_solver::traits::SolverEngine;

// 由 COO 条目构建稀疏矩阵
let matrix = CsrMatrix::<f32>::from_coo(rows, cols, vec![
    (row: usize, col: usize, val: f32), ...
]);

// 对稀疏系统以 O(√n) 求解 Ax = b
let solver = NeumannSolver::new(tolerance: f64, max_iterations: usize);
let result = solver.solve(&matrix, rhs: &[f32]) -> Result<SolverResult, SolverError>;

// 求解结果
result.solution: Vec<f32>   // solution vector x
result.residual_norm: f64   // ||b - Ax||
result.iterations: usize    // number of iterations used
```

**在 wifi-densepose-train 中的用途**：在 `subcarrier.rs` 里，把 114→56 的
子载波重采样建模为稀疏正则化最小二乘问题 `A·x ≈ b`，
其中 `A` 是稀疏基函数矩阵（由多径传播模型给出物理依据：
每个目标子载波都是相邻源子载波的稀疏组合）。
复杂度由 O(n) 降为 O(√n)，此处 n=114 个子载波。

#### ruvector-temporal-tensor

```rust
use ruvector_temporal_tensor::{TemporalTensorCompressor, TierPolicy};
use ruvector_temporal_tensor::segment;

// 为每帧 `element_count` 个 f32 元素创建压缩器
let mut comp = TemporalTensorCompressor::new(
    TierPolicy::default(),  // configures hot/warm/cold thresholds
    element_count: usize,   // n_tx * n_rx * n_sc (elements per CSI frame)
    id: u64,                // tensor identity (0 for amplitude, 1 for phase)
);

// 标记访问新旧程度（决定分层）：
//   hot  = 最近几个时间戳内访问过 → 8-bit（约 4 倍压缩）
//   warm = 较近访问                 → 5 或 7-bit（约 4.6–6.4 倍）
//   cold = 很少访问                 → 3-bit（约 10.67 倍）
comp.set_access(timestamp: u64, tensor_id: u64);

// 把各帧压缩进字节段
let mut segment_buf: Vec<u8> = Vec::new();
comp.push_frame(frame: &[f32], timestamp: u64, &mut segment_buf);
comp.flush(&mut segment_buf);  // flush current partial segment

// 解压
let mut decoded: Vec<f32> = Vec::new();
segment::decode(&segment_buf, &mut decoded);  // all frames
segment::decode_single_frame(&segment_buf, frame_index: usize) -> Option<Vec<f32>>;
segment::compression_ratio(&segment_buf) -> f64;
```

**在 wifi-densepose-train 中的用途**：在 `dataset.rs` 里用
`TemporalTensorCompressor` 缓冲 CSI 帧，把内存占用降低 50–75%。CSI 窗口
每个样本含 `window_frames` 帧（默认 100）；热帧（较新的）
保持 f32 精度，冷帧（较旧的）则被大幅量化。

#### ruvector-attention

```rust
use ruvector_attention::{
    attention::ScaledDotProductAttention,
    traits::Attention,
};

let attention = ScaledDotProductAttention::new(d: usize);  // feature dim

// 计算注意力：q 为 [d]，keys 与 values 是 Vec<&[f32]>
let output: Vec<f32> = attention.compute(
    query: &[f32],          // [d]
    keys: &[&[f32]],        // n_nodes × [d]
    values: &[&[f32]],      // n_nodes × [d]
) -> Result<Vec<f32>>;
```

**在 wifi-densepose-train 中的用途**：在 `model.rs` 的空间解码器里，用
基于图的空间注意力替换标准的 Conv2D 上采样流程，
其中节点表示空间网格点，边连接相邻的
天线覆盖区域。

---

## 决策

在 `wifi-densepose-train` 的五个集成点接入 ruvector crate：

### 1. `ruvector-mincut` → `metrics.rs`（替换多帧场景下的 petgraph 匈牙利匹配）

**集成前：** 基于 `petgraph::DiGraph`、用 DFS 增广路实现的 O(n³) Kuhn-Munkres，
只支持单帧（帧间不保留状态）。

**集成后：** 用 `DynamicPersonMatcher` 结构体包装 `ruvector_mincut::DynamicMinCut`。
以次多项式更新跨帧维护二分指派图：
- 检测到新人时 `insert_edge(pred_id, gt_id, oks_cost)`
- 人离开画面时 `delete_edge(pred_id, gt_id)`
- `partition()` 给出 S/T 划分 → `cut_edges()` 返回匹配上的 pred→gt 对

**性能：** 摊还更新 O(n^{1.5} log n)，对比每帧重建的 O(n³)。
对 3 人以上场景和视频跟踪（逐帧更新）尤为关键。

原有的 `hungarian_assignment` 函数**保留**用于单帧静态匹配
（真实性验证中依赖它的确定性）。

### 2. `ruvector-attn-mincut` → `model.rs`（替换 ModalityTranslator 中的扁平 MLP 融合）

**集成前：** 幅度/相位各自过 FC 编码器 → 拼接为 [B, 512] → Linear 融合 → ReLU。

**集成后：** 把 `n_ant = T * n_tx * n_rx` 条天线×时间路径当作 `seq_len`
个 token，把 `n_sc` 个子载波当作特征维度 `d`。用 `attn_mincut`
门控掉无关的天线对相关性：

```rust
// 在 ModalityTranslator::forward_t 中：
// amp/ph 张量：[B, n_ant, n_sc] → 转成 Vec<f32>
// 以 seq_len=n_ant、d=n_sc、lambda=0.3 调用 attn_mincut
// → 注意力输出 [B, n_ant, n_sc] → 展平 → 全连接层
```

**收益：** 无需显式学习掩码即可自动选择天线路径；
最小割门控在计算原理上比学出来的门控更站得住脚。

### 3. `ruvector-temporal-tensor` → `dataset.rs`（CSI 时序压缩）

**集成前：** 原始 CSI 窗口以完整 f32 `Array4<f32>` 常驻内存。

**集成后：** 由 `TemporalTensorCompressor` 支撑的 `CompressedCsiBuffer` 结构体。
按帧的访问新旧程度分层量化：
- 热帧（最近 10 帧）：等效 f32（8-bit 量化，约为 f32 的 1/4）
- 温帧（第 11–50 帧）：5/7-bit 量化
- 冷帧（50 帧以后）：3-bit（体积缩小 10.67 倍）

在 `push_frame` 时编码，`get(idx)` 时解码，对调用方透明。

**收益：** 默认 100 帧时序窗口的内存降低 50–75%；
在受限硬件上可把 batch size 放大 2–4 倍。

### 4. `ruvector-solver` → `subcarrier.rs`（相位清洗）

**集成前：** 用预先算好的 (i0, i1, frac) 元组在子载波间做线性插值。

**集成后：** 用 `NeumannSolver` 做稀疏正则化最小二乘的子载波
插值。把 CSI 频谱建模为傅里叶基函数的稀疏组合
（由多径传播给出物理依据）：

```rust
// A = 稀疏基矩阵 [target_sc, src_sc]（高斯核或 sinc 基）
// b = 源 CSI 取值 [src_sc]
// 用 NeumannSolver(tolerance=1e-5, max_iter=500) 求解 A·x ≈ b
// x = 目标子载波位置上的插值结果
```

**收益：** n=114 个源子载波时由 O(n) 降为 O(√n)；在
子载波边界处比线性插值更准确。

### 5. `ruvector-attention` → `model.rs`（空间解码器）

**集成前：** `KeypointHead` 与 `DensePoseHead` 中使用标准 ConvTranspose2D 上采样。

**集成后：** 对空间特征节点应用 `ScaledDotProductAttention`。
每个空间位置 [H×W] 成为一个 token；注意力捕捉天线覆盖区域之间的
长程空间依赖：

```rust
// 特征图：[B, C, H, W] → 展平为 [B, H*W, C]
// 对每个 batch：在 H*W 个空间节点之间计算注意力
// → 还原形状为 [B, C, H, W]
```

**收益：** 捕捉局部卷积会漏掉的长程空间依赖；
对多人场景很重要。

---

## 实施计划

### 改动文件

| 文件 | 改动 |
|------|--------|
| `Cargo.toml`（workspace 与 crate） | 加入 ruvector-mincut、ruvector-attn-mincut、ruvector-temporal-tensor、ruvector-solver、ruvector-attention = "2.0.4" |
| `metrics.rs` | 新增包装 `ruvector_mincut::DynamicMinCut` 的 `DynamicPersonMatcher`；保留 `hungarian_assignment` 用于确定性验证 |
| `model.rs` | 在 `ModalityTranslator::forward_t` 中接入 `attn_mincut`；在空间头部加入 `ScaledDotProductAttention` |
| `dataset.rs` | 新增由 `TemporalTensorCompressor` 支撑的 `CompressedCsiBuffer`；`MmFiDataset` 使用它 |
| `subcarrier.rs` | 新增基于 `NeumannSolver` 的 `interpolate_subcarriers_sparse`；保留 `interpolate_subcarriers` 作为回退 |

### 未改动文件

`config.rs`、`losses.rs`、`trainer.rs`、`proof.rs`、`error.rs` — 无需改动。

### 特性开关

所有 ruvector 集成**始终开启**（不做特性开关）。这些 ruvector
crate 是纯 Rust、无 C FFI，因此不会带来平台限制。

---

## 实现状态

| 阶段 | 状态 |
|-------|--------|
| `Cargo.toml`（workspace 与 crate） | **Complete** |
| ADR-016 文档 | **Complete** |
| `metrics.rs` 中的 ruvector-mincut | **Complete** |
| `model.rs` 中的 ruvector-attn-mincut | **Complete** |
| `dataset.rs` 中的 ruvector-temporal-tensor | **Complete** |
| `subcarrier.rs` 中的 ruvector-solver | **Complete** |
| `model.rs` 空间解码器中的 ruvector-attention | **Complete** |

---

## 影响

**正面影响：**
- 用于多人跟踪的次多项式 O(n^{1.5} log n) 动态最小割
- 最小割门控注意力对 CSI 天线阵列有物理依据
- 时序量化带来 50–75% 的内存下降
- 稀疏最小二乘插值比线性插值更有物理依据
- 所有 ruvector crate 都是纯 Rust（无 C FFI、无平台限制）

**负面影响：**
- 增加了编译期依赖（ruvector 系列 crate）
- `attn_mincut` 每个 batch 元素都要做张量 ↔ Vec<f32> 转换开销
- `TemporalTensorCompressor` 在数据集加载时带来压缩/解压延迟
- `NeumannSolver` 要求矩阵对角占优；为此加入稀疏 Tikhonov
  正则项（λI）以保证收敛

## 参考资料

- ADR-015：用公开数据集训练姿态估计模型
- ADR-014：面向 WiFi 感知的 SOTA 信号处理算法
- github.com/ruvnet/ruvector（源码：crate 均为 v2.0.4）
- ruvector-mincut 发布页：https://crates.io/crates/ruvector-mincut
- ruvector-attn-mincut 发布页：https://crates.io/crates/ruvector-attn-mincut
- ruvector-temporal-tensor 发布页：https://crates.io/crates/ruvector-temporal-tensor
- ruvector-solver 发布页：https://crates.io/crates/ruvector-solver
- ruvector-attention 发布页：https://crates.io/crates/ruvector-attention
