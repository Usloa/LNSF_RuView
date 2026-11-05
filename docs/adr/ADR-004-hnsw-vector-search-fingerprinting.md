# ADR-004：用于信号指纹的 HNSW 向量检索

## 状态
部分由 [ADR-024](ADR-024-contrastive-csi-embedding-model.md) 实现；由 [ADR-027](ADR-027-cross-environment-domain-generalization.md) 扩展

> **说明：** ADR-024（AETHER）实现了带 4 种索引类型的 HNSW 兼容指纹索引。ADR-027（MERIDIAN）在此基础上引入领域解耦嵌入，使指纹可以跨环境匹配，而不局限于单个房间。

## 日期
2026-02-28

## 背景

### 当前信号匹配的局限

WiFi-DensePose 系统需要把输入 CSI 模式与已知特征做匹配，用于：

1. **环境识别**：根据 CSI 特征判断设备位于哪个房间/区域
2. **活动分类**：把当前 CSI 模式匹配到已知人体活动（行走、坐下、跌倒）
3. **异常检测**：判断当前读数是否明显偏离基线
4. **幸存者重识别**（MAT 模块）：跨多次扫描会话跟踪同一名幸存者

`CSIProcessor._calculate_detection_confidence()` 中现有的做法：
```python
# 固定阈值，没有相似度检索
amplitude_indicator = np.mean(features.amplitude_mean) > 0.1
phase_indicator = np.std(features.phase_difference) > 0.05
motion_indicator = motion_score > 0.3
confidence = (0.4 * amplitude_indicator + 0.3 * phase_indicator + 0.3 * motion_indicator)
```

这是一个 **O(1) 固定阈值判断**，它：
- 无法从过往观测中学习
- 没有「以前见过相似模式」的概念
- 每个环境都要人工调阈值
- 输出二值指示（高于/低于阈值），丢失了梯度信息

### HNSW 能带来什么

分层可导航小世界（HNSW）图可以在高维向量空间中做近似最近邻检索，具备：

- **O(log n) 查询时间**，对比暴力搜索的 O(n)
- **高召回率**：在精确搜索 10 倍速度下召回率 >95%
- **动态插入**：新增向量无需重建整个索引
- **SIMD 加速**：RuVector 的实现用 AVX2/NEON 计算距离

RuVector 在标准 HNSW 之上扩展了：
- **双曲 HNSW**：在庞加莱球空间中检索，得到层级感知的结果（例如在活动层级中，「行走」比「坐下」更接近「跑步」）
- **GNN 增强**：图神经网络在查询后细化邻居连接
- **分级压缩**：通过自适应量化把内存占用降低 2-32 倍

## 决策

我们将把 RuVector 的 HNSW 实现作为所有 CSI 模式匹配的主检索引擎，用基于相似度的检索取代固定阈值检测。

### 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    HNSW Search Pipeline                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CSI Input     Feature           Vector         HNSW            │
│  ────────▶    Extraction   ────▶ Encode   ────▶ Search          │
│              (existing)        (new)          (new)             │
│                                                  │              │
│                                    ┌─────────────┤              │
│                                    ▼             ▼              │
│                              Top-K Results    Confidence        │
│                              [vec_id, dist,   Score from        │
│                               metadata]       Distance Dist.   │
│                                    │                            │
│                                    ▼                            │
│                              ┌────────────┐                     │
│                              │ Decision   │                     │
│                              │ Fusion     │                     │
│                              └────────────┘                     │
│                               Combines HNSW similarity with     │
│                               existing threshold-based logic    │
└─────────────────────────────────────────────────────────────────┘
```

### 索引配置

```rust
/// 针对 CSI 向量特点调优的 HNSW 配置
pub struct CsiHnswConfig {
    /// 向量维度（与 CsiFeatures 编码一致）
    dim: usize,  // 329 for 64 subcarriers

    /// 每层每个节点的最大连接数
    /// M 越大召回率越高，内存也越多
    /// CSI 向量维度适中，M=16 是比较好的折中
    m: usize,  // 16

    /// 构建期间动态候选列表的大小
    /// ef_construction = 200 时，329 维向量召回率 >99%
    ef_construction: usize,  // 200

    /// 检索期间动态候选列表的大小
    /// ef_search = 64 时，10 万向量下召回率 >95%、时延 <1ms
    ef_search: usize,  // 64

    /// 距离度量
    /// 归一化后的 CSI 特征用余弦相似度效果最好
    metric: DistanceMetric,  // Cosine

    /// 最大元素数（为性能预先分配）
    max_elements: usize,  // 1_000_000

    /// 启用 SIMD 加速
    simd: bool,  // true

    /// 用于降低内存占用的量化级别
    quantization: Quantization,  // PQ8 (product quantization, 8-bit)
}
```

### 多索引策略

不同使用场景需要不同的索引配置：

| 索引名 | 向量数 | 维度 | 距离 | 使用场景 |
|-----------|---------|-----|----------|----------|
| `env_fingerprint` | 10K-1M | 329 | Cosine | 环境/房间识别 |
| `activity_pattern` | 1K-50K | 329 | Euclidean | 活动分类 |
| `temporal_pattern` | 10K-500K | 329 | Cosine | 时序异常检测 |
| `survivor_track` | 100-10K | 329 | Cosine | MAT 幸存者重识别 |

### 基于相似度的检测增强

用基于距离的置信度取代固定阈值：

```rust
/// 使用 HNSW 相似度检索的增强检测
pub struct SimilarityDetector {
    /// 已知「有人」CSI 模式的 HNSW 索引
    human_patterns: HnswIndex,

    /// 已知「空房间」CSI 模式的 HNSW 索引
    empty_patterns: HnswIndex,

    /// 相似度方法与阈值方法之间的融合权重
    fusion_alpha: f64,  // 0.7 = 70% similarity, 30% threshold
}

impl SimilarityDetector {
    /// 结合相似度检索与阈值融合来检测人体存在
    pub fn detect(&self, features: &CsiFeatures) -> DetectionResult {
        let query_vec = features.to_rvf_vector();

        // 检索两个索引
        let human_neighbors = self.human_patterns.search(&query_vec, k=5);
        let empty_neighbors = self.empty_patterns.search(&query_vec, k=5);

        // 基于距离的置信度
        let avg_human_dist = human_neighbors.mean_distance();
        let avg_empty_dist = empty_neighbors.mean_distance();

        // 相似度置信度：相对「有人」模式比「空房间」模式近多少
        let similarity_confidence = avg_empty_dist / (avg_human_dist + avg_empty_dist);

        // 与传统的基于阈值的置信度融合
        let threshold_confidence = self.traditional_threshold_detect(features);
        let fused_confidence = self.fusion_alpha * similarity_confidence
                             + (1.0 - self.fusion_alpha) * threshold_confidence;

        DetectionResult {
            human_detected: fused_confidence > 0.5,
            confidence: fused_confidence,
            similarity_confidence,
            threshold_confidence,
            nearest_human_pattern: human_neighbors[0].metadata.clone(),
            nearest_empty_pattern: empty_neighbors[0].metadata.clone(),
        }
    }
}
```

### 增量学习闭环

每一次确认过的检测都会丰富索引：

```
1. CSI captured → features extracted → vector encoded
2. HNSW search returns top-K neighbors + distances
3. Detection decision made (similarity + threshold fusion)
4. If confirmed (by temporal consistency or ground truth):
   a. Insert vector into appropriate index (human/empty)
   b. GNN layer updates neighbor relationships (ADR-006)
   c. SONA adapts fusion weights (ADR-005)
5. Periodically: prune stale vectors, rebuild index layers
```

### 性能分析

**内存需求**（PQ8 量化）：

| 向量数量 | 原始大小 | PQ8 压缩后 | HNSW 开销 | 合计 |
|-------------|----------|----------------|---------------|-------|
| 10,000 | 12.9 MB | 1.6 MB | 2.5 MB | 4.1 MB |
| 100,000 | 129 MB | 16 MB | 25 MB | 41 MB |
| 1,000,000 | 1.29 GB | 160 MB | 250 MB | 410 MB |

**时延预期**（329 维向量，ef_search=64）：

| 向量数量 | 暴力搜索 | HNSW | 加速比 |
|-------------|-------------|------|---------|
| 10,000 | 3.2 ms | 0.08 ms | 40x |
| 100,000 | 32 ms | 0.3 ms | 107x |
| 1,000,000 | 320 ms | 0.9 ms | 356x |

### 面向活动层级的双曲扩展

WiFi 感知到的活动天然具有层级结构：

```
                    motion
                   /      \
              locomotion   stationary
              /    \         /    \
         walking  running  sitting  lying
         /    \
      normal  shuffling
```

庞加莱球空间中的双曲 HNSW 在检索时会保留这种层级关系，因此即便欧氏距离相近，查询「拖步行走」也会先返回「行走」而不是「坐下」。

```rust
/// 用于层级感知活动匹配的双曲 HNSW
pub struct HyperbolicActivityIndex {
    index: HnswIndex,
    curvature: f64,  // -1.0 for unit Poincaré ball
}

impl HyperbolicActivityIndex {
    pub fn search(&self, query: &[f32], k: usize) -> Vec<SearchResult> {
        // 使用庞加莱距离：d(u,v) = arcosh(1 + 2||u-v||²/((1-||u||²)(1-||v||²)))
        self.index.search_hyperbolic(query, k, self.curvature)
    }
}
```

## 影响

### 正面影响
- **自适应检测**：系统随数据增多而改进，无需人工调阈值
- **亚毫秒检索**：即便 100 万向量，HNSW 查询仍 <1ms
- **内存高效**：PQ8 把存储降低 8 倍，召回率损失 <5%
- **层级感知**：双曲模式尊重活动之间的层级关系
- **增量更新**：新增模式无需重建整个索引
- **可解释**：「本次检测匹配到房间 Y 在时刻 Z 记录的模式 X」

### 负面影响
- **冷启动问题**：相似度检索发挥作用前需要一批初始指纹数据
- **索引维护**：需要定期剪枝与层间再平衡
- **近似性**：HNSW 是近似算法，可能漏掉真正的最近邻（用较大的 ef_search 缓解）
- **索引内存**：HNSW 图结构会在向量之外再增加 2.5 倍开销

### 迁移策略

1. **阶段 1**：HNSW 检索与现有阈值检测并行运行，两者结果都记日志
2. **阶段 2**：在标注数据上对融合权重（alpha 参数）做 A/B 测试
3. **阶段 3**：把 fusion_alpha 从 0.0（纯阈值）逐步提高到 0.7（以相似度为主）
4. **阶段 4**：阈值检测退为冷启动/空索引场景下的兜底方案

## 参考资料

- [HNSW: Efficient and Robust Approximate Nearest Neighbor](https://arxiv.org/abs/1603.09320)
- [Product Quantization for Nearest Neighbor Search](https://hal.inria.fr/inria-00514462)
- [Poincaré Embeddings for Learning Hierarchical Representations](https://arxiv.org/abs/1705.08039)
- [RuVector HNSW Implementation](https://github.com/ruvnet/ruvector)
- ADR-003：面向 CSI 数据的 RVF 认知容器
