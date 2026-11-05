# ADR-006：GNN 增强的 CSI 模式识别

## 状态
部分在 [ADR-023](ADR-023-trained-densepose-model-ruvector-pipeline.md) 中落地；由 [ADR-027](ADR-027-cross-environment-domain-generalization.md) 扩展

> **说明：** ADR-023 在 COCO 骨架图上实现了 2 层 GCN 用于空间推理。ADR-027（MERIDIAN）通过梯度反转层加入领域对抗正则，迫使 GCN 学到与环境无关的图特征，剥离房间特有的多径模式。

## 日期
2026-02-28

## 背景

### 独立向量检索的局限

ADR-004 引入了基于 HNSW 的相似度检索来匹配 CSI 模式。HNSW 的最近邻检索很快，但它把每个向量当作彼此独立。而 CSI 模式本身有丰富的关联结构：

1. **时间相邻**：相隔 10ms 采集的 CSI 帧，比相隔 10s 的帧关联更强，连续模式能反映运动轨迹。

2. **空间相关**：相邻子载波的 CSI 读数因频率接近而高度相关，不同天线对则捕捉到不同的空间视角。

3. **跨会话相似**：周二记录到的「走向厨房」模式应当有助于周三的识别，但环境基线可能已经变了。

4. **多人混叠**：多人在场时，CSI 模式是叠加结果，要解耦就得理解哪些模式片段会共同出现。

标准 HNSW 无法表达这些关系。每次查询只按向量距离返回邻居，忽略了模式之间如何关联的图结构。

### RuVector 的 GNN 增强

RuVector 在 HNSW 索引之上实现了一层图神经网络（GNN）：

```
Standard HNSW: Query → Distance-based neighbors → Results
GNN-Enhanced:  Query → Distance-based neighbors → GNN refinement → Improved results
```

GNN 在 <1ms 内完成三步操作：
1. **消息传递**：每个节点聚合其 HNSW 邻居的信息
2. **注意力加权**：多头注意力判断在当前查询语境下哪些邻居最相关
3. **表示更新**：根据邻域上下文细化节点嵌入

此外，**时序学习**会跟踪查询序列，用于发现：
- 会话中经常一起出现的向量
- 时序先后模式（A 通常先于 B 出现）
- 会改变相关性排序的会话上下文

## 决策

我们将集成 RuVector 的 GNN 层，用关系检索、时序序列建模、多人解耦三项核心能力增强 CSI 模式识别。

### 面向 CSI 的 GNN 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                 GNN-Enhanced CSI Pattern Graph                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Layer 1: HNSW Spatial Graph                                        │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  Nodes = CSI feature vectors                          │          │
│  │  Edges = HNSW neighbor connections (distance-based)   │          │
│  │  Node features = [amplitude | phase | doppler | PSD]  │          │
│  └───────────────────────────────────────────────────────┘          │
│                          │                                           │
│                          ▼                                           │
│  Layer 2: Temporal Edges                                            │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  Additional edges between temporally adjacent vectors  │          │
│  │  Edge weight = 1/Δt (closer in time = stronger)       │          │
│  │  Direction = causal (past → future)                    │          │
│  └───────────────────────────────────────────────────────┘          │
│                          │                                           │
│                          ▼                                           │
│  Layer 3: GNN Message Passing (2 rounds)                            │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  Round 1: h_i = σ(W₁·h_i + Σⱼ α_ij · W₂·h_j)       │          │
│  │  Round 2: h_i = σ(W₃·h_i + Σⱼ α'_ij · W₄·h_j)      │          │
│  │  α_ij = softmax(LeakyReLU(a^T[W·h_i || W·h_j]))     │          │
│  │  (Graph Attention Network mechanism)                   │          │
│  └───────────────────────────────────────────────────────┘          │
│                          │                                           │
│                          ▼                                           │
│  Layer 4: Refined Representations                                   │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  Updated vectors incorporate neighborhood context      │          │
│  │  Re-rank search results using refined distances       │          │
│  └───────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### 三种集成模式

#### 模式 1：查询时精化（默认）

GNN 在检索之后精化 HNSW 结果，不改动已存储的向量。

```rust
pub struct GnnQueryRefiner {
    /// GNN 权重（很小：约 5 万参数）
    gnn_weights: GnnModel,

    /// 消息传递轮数
    num_rounds: usize,  // 2

    /// 用于邻居加权的注意力头数
    num_heads: usize,  // 4

    /// GNN 考虑多少个 HNSW 邻居
    neighborhood_size: usize,  // 20 (retrieve 20, GNN selects best 5)
}

impl GnnQueryRefiner {
    /// 用图上下文精化 HNSW 结果
    pub fn refine(&self, query: &[f32], hnsw_results: &[SearchResult]) -> Vec<SearchResult> {
        // 由查询与 HNSW 结果构建局部子图
        let subgraph = self.build_local_subgraph(query, hnsw_results);

        // 运行消息传递
        let refined = self.message_pass(&subgraph, self.num_rounds);

        // 按细化后的表示重新排序
        self.rerank(query, &refined)
    }
}
```

**时延**：在 HNSW 检索之上增加 0.2ms（10 万向量下合计 <1.5ms）。

#### 模式 2：时序序列识别

跟踪 CSI 向量序列，识别跨多帧的活动模式：

```rust
/// 基于 GNN 边的时序模式识别器
pub struct TemporalPatternRecognizer {
    /// 近期查询向量的滑动窗口
    window: VecDeque<TimestampedVector>,

    /// 窗口上限（按帧计）
    max_window: usize,  // 100 (10 seconds at 10 Hz)

    /// 时序边衰减因子
    decay: f64,  // 0.95 (edges weaken with time)

    /// 已知活动序列（从数据中学得）
    activity_templates: HashMap<String, Vec<Vec<f32>>>,
}

impl TemporalPatternRecognizer {
    /// 输入新的 CSI 向量并检查是否匹配活动模式
    pub fn observe(&mut self, vector: &[f32], timestamp: f64) -> Vec<ActivityMatch> {
        self.window.push_back(TimestampedVector { vector: vector.to_vec(), timestamp });

        // 由窗口构建时序子图
        let temporal_graph = self.build_temporal_graph();

        // GNN 聚合时序上下文
        let sequence_embedding = self.gnn_aggregate(&temporal_graph);

        // 与已知活动模板匹配
        self.match_activities(&sequence_embedding)
    }
}
```

**可识别的活动模式**：

| 活动 | 所需帧数 | CSI 特征 |
|----------|--------------|---------------|
| 行走 | 10-30 | 周期性多普勒振荡 |
| 跌倒 | 5-15 | 幅度骤升后归于静止 |
| 坐下 | 10-20 | 反射高度逐渐下降 |
| 呼吸（静止） | 30-100 | 微周期性相位变化 |
| 手势（挥手） | 5-15 | 局部高频幅度变化 |

#### 模式 3：多人解耦

当在场人数 N>1 时，CSI 是叠加信号。GNN 学习把模式片段聚类开：

```rust
/// 用 GNN 聚类做多人 CSI 解耦
pub struct MultiPersonDisentangler {
    /// 预期的最大同时在场人数
    max_persons: usize,  // 10

    /// 基于 GNN 的谱聚类
    cluster_gnn: GnnModel,

    /// 每人的跟踪状态
    person_tracks: Vec<PersonTrack>,
}

impl MultiPersonDisentangler {
    /// 把 CSI 特征拆成按人划分的分量
    pub fn disentangle(&mut self, features: &CsiFeatures) -> Vec<PersonFeatures> {
        // 用 GNN 注意力把 CSI 分解成子载波组
        let subcarrier_graph = self.build_subcarrier_graph(features);

        // GNN 按各人贡献对子载波聚类
        let clusters = self.cluster_gnn.cluster(&subcarrier_graph, self.max_persons);

        // 从聚类后的子载波中提取每人的特征
        clusters.iter().map(|c| self.extract_person_features(features, c)).collect()
    }
}
```

### GNN 学习闭环

借助 RuVector 内置的学习机制，GNN 会在每次查询后改进：

```
Query → HNSW retrieval → GNN refinement → User action (click/confirm/reject)
                                              │
                                              ▼
                                    Update GNN weights via:
                                    1. Positive: confirmed results get higher attention
                                    2. Negative: rejected results get lower attention
                                    3. Temporal: successful sequences reinforce edges
```

在 WiFi-DensePose 中，「用户动作」被替换为：
- **时间一致性**：若第 N+1 帧印证了第 N 帧的检测结果，则强化
- **多 AP 一致**：若两个 AP 的检测结果一致，则同时强化
- **物理合理性**：若姿态满足骨骼约束，则强化

### 性能预算

| 组件 | 参数量 | 内存 | 时延（每次查询） |
|-----------|-----------|--------|-------------------|
| GNN 权重（2 层、4 头） | 52K | 208 KB | 0.15 ms |
| 时序图（100 帧窗口） | 不适用 | ~130 KB | 0.05 ms |
| 多人聚类 | 18K | 72 KB | 0.3 ms |
| **GNN 开销合计** | **70K** | **410 KB** | **0.5 ms** |

## 影响

### 正面影响
- **上下文感知检索**：结果会考虑时间与空间关系，而不只是向量距离
- **活动识别**：时序 GNN 支持序列级模式匹配
- **多人支持**：GNN 聚类可分离相互叠加的 CSI 模式
- **自我改进**：每次查询都提供学习信号来细化注意力权重
- **轻量**：7 万参数、410 KB 内存、0.5ms 时延开销

### 负面影响
- **需要训练数据**：GNN 权重需要先用 CSI 模式图做初始训练
- **复杂度**：三种模式扩大了测试与调试面
- **图维护**：时序边必须定期剪枝，否则会无限增长
- **近似性**：多人场景的 GNN 聚类是近似的，可能错误合并或拆分

### 与其它 ADR 的关系
- **ADR-004**（HNSW）：GNN 运行在 HNSW 图结构之上，依赖 HNSW 可用
- **ADR-005**（SONA）：GNN 权重可通过 SONA LoRA 适配，做环境专属调优
- **ADR-003**（RVF）：GNN 权重与推理权重一起存放在模型容器中
- **ADR-010**（Witness）：GNN 权重更新会记入见证链

## 参考资料

- [Graph Attention Networks (GAT)](https://arxiv.org/abs/1710.10903)
- [Temporal Graph Networks](https://arxiv.org/abs/2006.10637)
- [Spectral Clustering with Graph Neural Networks](https://arxiv.org/abs/1907.00481)
- [WiFi-based Multi-Person Sensing](https://dl.acm.org/doi/10.1145/3534592)
- [RuVector GNN Implementation](https://github.com/ruvnet/ruvector)
- ADR-004：用于信号指纹的 HNSW 向量检索
