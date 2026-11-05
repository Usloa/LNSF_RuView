# ADR-002：RuVector RVF 集成策略

## 状态
已由 [ADR-016](ADR-016-ruvector-integration.md) 和 [ADR-017](ADR-017-ruvector-signal-mat-integration.md) 取代

> **说明：** 本 ADR 设想的能力已全部落地。ADR-016 把 5 个 RuVector crate 接入训练流水线，ADR-017 增加了 7 个 signal + MAT 集成点。`wifi-densepose-ruvector` crate 已[发布到 crates.io](https://crates.io/crates/wifi-densepose-ruvector)。关于 RuVector 如何扩展领域泛化，另见 [ADR-027](ADR-027-cross-environment-domain-generalization.md)。

## 日期
2026-02-28

## 背景

### 当前系统的局限

WiFi-DensePose 系统处理 WiFi 信号中的信道状态信息（CSI），用于估计人体姿态。当前架构（Python v1 + Rust 移植版）在智能化程度与性能上有多处可显著提升的地方：

1. **没有持久化向量存储**：CSI 特征向量只是临时处理，历史模式、指纹与学到的表示都没有存入可检索的向量数据库。

2. **推理模型是静态的**：模态转换网络（`ModalityTranslationNetwork`）与 DensePose 头部使用启动时加载的固定权重，没有在线学习、自适应或自我优化。

3. **模式匹配过于简单**：`CSIProcessor` 里的人体检测使用基于固定阈值的置信度打分（`amplitude_indicator`、`phase_indicator`、`motion_indicator`，权重固定为 0.4、0.3、0.3），没有与已知模式做相似度检索。

4. **没有加密审计链**：面向生命安全的灾害检测（wifi-densepose-mat）缺少防篡改日志来记录幸存者检测与分诊结果。

5. **边缘部署能力有限**：WASM crate（`wifi-densepose-wasm`）只提供了基础绑定，缺少可离线运行、内嵌模型的自包含运行时。

6. **单节点架构**：灾害场景下的多 AP 部署需要分布式协同，但跨节点状态管理没有共识机制。

### RuVector 的能力

RuVector（github.com/ruvnet/ruvector）提供了一整套认知计算平台能力：

- **RVF（认知容器）**：自包含文件，含 25 种段类型（VEC、INDEX、KERNEL、EBPF、WASM、COW_MAP、WITNESS、CRYPTO），把向量、模型与运行时打包成单个可部署产物
- **HNSW 向量检索**：分层可导航小世界索引，带 SIMD 加速以及支持层级感知检索的双曲扩展
- **SONA**：自优化神经架构，通过 LoRA 微调与 EWC++ 记忆保持实现 <1ms 自适应
- **GNN 学习层**：图神经网络通过消息传递、注意力加权与表示更新，从每次查询中学习
- **46 种注意力机制**：包括 Flash Attention、Linear Attention、Graph Attention、Hyperbolic Attention、Mincut-gated Attention
- **后量子密码**：ML-DSA-65、Ed25519、SLH-DSA-128s 签名，配合 SHAKE-256 哈希
- **见证链**：防篡改的加密哈希串联审计轨迹
- **Raft 共识**：带多主复制与向量时钟的分布式协同
- **WASM 运行时**：5.5 KB 运行时，125ms 启动，可部署在服务器、浏览器、手机与 IoT 设备
- **类 Git 分支**：写时复制结构（100 万向量 + 100 次编辑 ≈ 2.5 MB 分支）

## 决策

我们将按阶段、模块化的方式，把 RuVector 的 RVF 格式与智能能力集成进 WiFi-DensePose，覆盖 9 个集成领域，每个领域由后续 ADR 详述（ADR-003 至 ADR-010）。

### 集成架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WiFi-DensePose + RuVector                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   CSI Input   │  │  RVF Store   │  │    SONA      │  │   GNN Layer  │   │
│  │   Pipeline    │──▶│  (Vectors,  │──▶│  Self-Learn  │──▶│  Pattern     │   │
│  │              │  │   Indices)   │  │              │  │  Enhancement │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │            │
│         ▼                 ▼                 ▼                 ▼            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Feature     │  │   HNSW       │  │  Adaptive    │  │   Pose       │   │
│  │  Extraction  │  │   Search     │  │  Weights     │  │  Estimation  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │            │
│         └─────────────────┴─────────────────┴─────────────────┘            │
│                                     │                                      │
│                          ┌──────────▼──────────┐                          │
│                          │    Output Layer      │                          │
│                          │  • Pose Keypoints    │                          │
│                          │  • Body Segments     │                          │
│                          │  • UV Coordinates    │                          │
│                          │  • Confidence Maps   │                          │
│                          └──────────┬──────────┘                          │
│                                     │                                      │
│         ┌───────────────────────────┼───────────────────────────┐          │
│         ▼                           ▼                           ▼          │
│  ┌──────────────┐           ┌──────────────┐           ┌──────────────┐   │
│  │  Witness     │           │    Raft       │           │   WASM       │   │
│  │  Chains      │           │  Consensus    │           │   Edge       │   │
│  │  (Audit)     │           │  (Multi-AP)   │           │  Runtime     │   │
│  └──────────────┘           └──────────────┘           └──────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  Post-Quantum Crypto Layer                          │   │
│  │          ML-DSA-65 │ Ed25519 │ SLH-DSA-128s │ SHAKE-256           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 新增 crate：`wifi-densepose-rvf`

新增一个 workspace 成员 crate 作为集成层：

```
crates/wifi-densepose-rvf/
├── Cargo.toml
├── src/
│   ├── lib.rs                 # Public API surface
│   ├── container.rs           # RVF cognitive container management
│   ├── vector_store.rs        # HNSW-backed CSI vector storage
│   ├── search.rs              # Similarity search for fingerprinting
│   ├── learning.rs            # SONA integration for online learning
│   ├── gnn.rs                 # GNN pattern enhancement layer
│   ├── attention.rs           # Attention mechanism selection
│   ├── witness.rs             # Witness chain audit trails
│   ├── consensus.rs           # Raft consensus for multi-AP
│   ├── crypto.rs              # Post-quantum crypto wrappers
│   ├── edge.rs                # WASM edge runtime integration
│   └── adapters/
│       ├── mod.rs
│       ├── signal_adapter.rs  # Bridges wifi-densepose-signal
│       ├── nn_adapter.rs      # Bridges wifi-densepose-nn
│       └── mat_adapter.rs     # Bridges wifi-densepose-mat
```

### 分阶段推进

| 阶段 | 时间 | ADR | 能力 | 优先级 |
|-------|----------|-----|------------|----------|
| 1 | 第 1-3 周 | ADR-003 | 面向 CSI 数据的 RVF 认知容器 | Critical |
| 2 | 第 2-4 周 | ADR-004 | 用于信号指纹的 HNSW 向量检索 | Critical |
| 3 | 第 4-6 周 | ADR-005 | 用于姿态估计的 SONA 自学习 | High |
| 4 | 第 5-7 周 | ADR-006 | GNN 增强的 CSI 模式识别 | High |
| 5 | 第 6-8 周 | ADR-007 | 面向安全感知的后量子密码 | Medium |
| 6 | 第 7-9 周 | ADR-008 | 面向多 AP 的分布式共识 | Medium |
| 7 | 第 8-10 周 | ADR-009 | 面向边缘部署的 RVF WASM 运行时 | Medium |
| 8 | 第 9-11 周 | ADR-010 | 面向审计链完整性的见证链 | High (MAT) |

### 依赖策略

**已核实发布的 crate**（crates.io，截至 2026-02-28 均为 v2.0.4）：

```toml
# 在 Cargo.toml 的 workspace 依赖中
[workspace.dependencies]
ruvector-mincut = "2.0.4"           # Dynamic min-cut, O(n^1.5 log n) graph partitioning
ruvector-attn-mincut = "2.0.4"     # Attention + mincut gating in one pass
ruvector-temporal-tensor = "2.0.4"  # Tiered temporal compression (50-75% memory reduction)
ruvector-solver = "2.0.4"           # NeumannSolver — O(√n) Neumann series convergence
ruvector-attention = "2.0.4"        # ScaledDotProductAttention
```

> **说明（ADR-017 更正）：** 本 ADR 的早期版本曾指定
> `ruvector-core`、`ruvector-data-framework`、`ruvector-consensus` 与
> `ruvector-wasm`，版本为 `"0.1"`。这些 crate 在 crates.io 上并不存在。
> 上面五个 crate 才是 v2.0.4 已核实发布的 API 集合。
> RVF 认知容器（ADR-003）、HNSW 检索（ADR-004）、
> SONA（ADR-005）、GNN 模式（ADR-006）、后量子加密（ADR-007）、
> Raft 共识（ADR-008）、WASM 运行时（ADR-009）等能力属于内部能力，
> 可通过这五个 crate 使用，或仍属前瞻性架构。
> 修正后的集成图见 ADR-017。

特性开关控制哪些 ruvector 能力会被编译进来：

```toml
[features]
default = ["mincut-matching", "solver-interpolation"]
mincut-matching = ["ruvector-mincut"]
attn-mincut = ["ruvector-attn-mincut"]
temporal-compress = ["ruvector-temporal-tensor"]
solver-interpolation = ["ruvector-solver"]
attention = ["ruvector-attention"]
full = ["mincut-matching", "attn-mincut", "temporal-compress", "solver-interpolation", "attention"]
```

## 影响

### 正面影响

- **模式查找快 10-100 倍**：HNSW 取代 CSI 指纹匹配的线性扫描
- **持续改进**：SONA 支持在线自适应，无需全量重训
- **自包含部署**：RVF 容器打包了现场作业所需的全部内容
- **防篡改记录**：见证链为灾害响应审计提供加密证明
- **面向未来的安全性**：后量子签名可抵御量子计算攻击
- **分布式运行**：Raft 共识支撑多 AP 协同感知
- **超轻量边缘端**：5.5 KB WASM 运行时可用于浏览器与 IoT 设备
- **类 Git 版本管理**：COW 分支让模型试验变体只占极少存储

### 负面影响

- **二进制体积增大**：全特性集会引入较多依赖（约 15-30 MB）
- **复杂度**：9 个集成领域需要仔细协调
- **学习成本**：团队需要理解 RuVector 的认知容器范式
- **API 稳定性风险**：RuVector 尚未发布 1.0，API 可能变动
- **测试面扩大**：每个集成点都需要专门的测试套件

### 风险与缓解措施

| 风险 | 严重度 | 缓解措施 |
|------|----------|------------|
| RuVector API 破坏性变更 | High | 锁定版本，用适配器模式隔离影响 |
| 抽象层带来的性能回退 | Medium | 逐个集成点做基准测试，采用零成本抽象 |
| 特性开关组合爆炸 | Medium | 对关键特性组合做 CI 矩阵测试 |
| 相对当前需求过度设计 | Medium | 分阶段推进，每个阶段独立产生价值 |
| 边缘目标二进制膨胀 | Low | 用特性开关确保只编译需要的能力 |

## 相关 ADR

- **ADR-001**：WiFi-Mat 灾害检测架构（已有）
- **ADR-003**：面向 CSI 数据的 RVF 认知容器
- **ADR-004**：用于信号指纹的 HNSW 向量检索
- **ADR-005**：用于姿态估计的 SONA 自学习
- **ADR-006**：GNN 增强的 CSI 模式识别
- **ADR-007**：面向安全感知的后量子密码
- **ADR-008**：面向多 AP 协同的分布式共识
- **ADR-009**：面向边缘部署的 RVF WASM 运行时
- **ADR-010**：面向审计链完整性的见证链

## 参考资料

- [RuVector Repository](https://github.com/ruvnet/ruvector)
- [HNSW Algorithm](https://arxiv.org/abs/1603.09320)
- [LoRA: Low-Rank Adaptation](https://arxiv.org/abs/2106.09685)
- [Elastic Weight Consolidation](https://arxiv.org/abs/1612.00796)
- [Raft Consensus](https://raft.github.io/raft.pdf)
- [ML-DSA (FIPS 204)](https://csrc.nist.gov/pubs/fips/204/final)
- [WiFi-DensePose Rust ADR-001：Workspace 结构](../v2/docs/adr/ADR-001-workspace-structure.md)
