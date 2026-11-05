# ADR-008：面向多 AP 的分布式共识

## 状态
Proposed

## 日期
2026-02-28

## 背景

### 多 AP 感知架构

WiFi-DensePose 通过多个接入点（AP）从不同角度观测同一空间，可获得更高精度与更大覆盖范围。灾害检测模块（wifi-densepose-mat，ADR-001）明确要求分布式部署：

- **便携式**：在坍塌现场周围布设单个 TX/RX 单元
- **分布式**：多个 AP 覆盖大面积灾区
- **机载**：无人机按协同航迹从空中扫描

每个 AP 独立采集 CSI 数据、提取特征并运行本地推理。但分布式系统需要协调：

1. **一致的幸存者名录**：所有节点必须对已发现的幸存者集合、位置和分诊分类达成一致。记录冲突会浪费救援队时间。

2. **协同扫描**：避免对同一区域重复扫描；区域清理完成后动态重新分配 AP。

3. **模型同步**：当某个节点上的 SONA 完成模型适配（ADR-005）时，其它节点应能受益，无需重新学习。

4. **时钟同步**：多视角姿态融合要求各节点的 CSI 时间戳对齐（ADR-006 中用于多人解耦的 GNN 要求时间对齐）。

5. **分区容忍**：灾害场景下网络连接不可靠，系统必须在网络分区期间继续工作，并在恢复连通后完成对账。

### 现状

目前没有任何分布式协调机制，各节点独立运行，Rust workspace 中也没有共识 crate。

### RuVector 的分布式能力

RuVector 提供：
- **Raft 共识**：领导者选举与复制日志，提供强一致性
- **向量时钟**：无需同步物理时钟即可确定因果顺序的逻辑时间戳
- **多主复制**：并发写入并解决冲突
- **增量共识**：追踪跨节点的行为变化以检测异常
- **自动分片**：按访问模式分布数据

## 决策

我们将接入 RuVector 的 Raft 共识实现，作为多 AP 部署的协调主干，用向量时钟做因果排序，用基于 CRDT 的冲突解决实现分区容忍。

### 共识架构

```
┌─────────────────────────────────────────────────────────────────────┐
│              Multi-AP Coordination Architecture                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Normal Operation (Connected):                                      │
│                                                                      │
│  ┌─────────┐     Raft      ┌─────────┐     Raft      ┌─────────┐  │
│  │  AP-1   │◀────────────▶│  AP-2   │◀────────────▶│  AP-3   │  │
│  │ (Leader)│    Replicated  │(Follower│   Replicated  │(Follower│  │
│  │         │       Log      │        )│      Log      │        )│  │
│  └────┬────┘               └────┬────┘               └────┬────┘  │
│       │                         │                         │        │
│       ▼                         ▼                         ▼        │
│  ┌─────────┐              ┌─────────┐              ┌─────────┐    │
│  │ Local   │              │ Local   │              │ Local   │    │
│  │ RVF     │              │ RVF     │              │ RVF     │    │
│  │Container│              │Container│              │Container│    │
│  └─────────┘              └─────────┘              └─────────┘    │
│                                                                      │
│  Partitioned Operation (Disconnected):                              │
│                                                                      │
│  ┌─────────┐                              ┌──────────────────────┐  │
│  │  AP-1   │  ← operates independently →  │  AP-2    AP-3       │  │
│  │         │                              │  (form sub-cluster)  │  │
│  │ Local   │                              │  Raft between 2+3    │  │
│  │ writes  │                              │                      │  │
│  └─────────┘                              └──────────────────────┘  │
│       │                                            │                 │
│       └──────── Reconnect: CRDT merge ─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

### 复制状态机

Raft 日志在各节点间复制以下操作：

```rust
/// 通过 Raft 共识复制的操作
#[derive(Serialize, Deserialize, Clone)]
pub enum ConsensusOp {
    /// 检测到新的幸存者
    SurvivorDetected {
        survivor_id: Uuid,
        location: GeoCoord,
        triage: TriageLevel,
        detecting_ap: ApId,
        confidence: f64,
        timestamp: VectorClock,
    },

    /// 幸存者状态更新（例如重新分诊）
    SurvivorUpdated {
        survivor_id: Uuid,
        new_triage: TriageLevel,
        updating_ap: ApId,
        evidence: DetectionEvidence,
    },

    /// 区域分配变更
    ZoneAssignment {
        zone_id: ZoneId,
        assigned_aps: Vec<ApId>,
        priority: ScanPriority,
    },

    /// 共享模型适配增量
    ModelDelta {
        source_ap: ApId,
        lora_delta: Vec<u8>,  // Serialized LoRA matrices
        environment_hash: [u8; 32],
        performance_metrics: AdaptationMetrics,
    },

    /// AP 加入或离开集群
    MembershipChange {
        ap_id: ApId,
        action: MembershipAction,  // Join | Leave | Suspect
    },
}
```

### 用向量时钟做因果排序

由于各 AP 的物理时钟可能不同步，向量时钟提供因果排序：

```rust
/// 用于跨 AP 因果排序的向量时钟
#[derive(Clone, Serialize, Deserialize)]
pub struct VectorClock {
    /// AP ID 到逻辑时间戳的映射
    clocks: HashMap<ApId, u64>,
}

impl VectorClock {
    /// 递增本 AP 的时钟
    pub fn tick(&mut self, ap_id: &ApId) {
        *self.clocks.entry(ap_id.clone()).or_insert(0) += 1;
    }

    /// 与另一个时钟合并（每个分量取最大值）
    pub fn merge(&mut self, other: &VectorClock) {
        for (ap_id, &ts) in &other.clocks {
            let entry = self.clocks.entry(ap_id.clone()).or_insert(0);
            *entry = (*entry).max(ts);
        }
    }

    /// 判断自身是否发生在 other 之前
    pub fn happened_before(&self, other: &VectorClock) -> bool {
        self.clocks.iter().all(|(k, &v)| {
            other.clocks.get(k).map_or(false, |&ov| v <= ov)
        }) && self.clocks != other.clocks
    }
}
```

### 基于 CRDT 的冲突解决

网络分区期间并发更新可能冲突。我们使用 CRDT（无冲突复制数据类型）自动解决：

```rust
/// 基于 LWW 寄存器 CRDT 的幸存者名录
pub struct SurvivorRegistry {
    /// LWW-Element-Set：每个幸存者都有带时间戳的状态
    survivors: HashMap<Uuid, LwwRegister<SurvivorState>>,
}

/// 分诊采用「最紧急者胜出」语义：
/// 若分区 A 判定 P1（红色/立即），分区 B 判定 P2（黄色/延迟），
/// 合并后该幸存者归类为 P1（更紧急者优先）
/// 理由：漏报（漏掉危重者）比误报更糟
impl CrdtMerge for TriageLevel {
    fn merge(a: Self, b: Self) -> Self {
        // 数值优先级越低 = 越紧急
        if a.urgency() >= b.urgency() { a } else { b }
    }
}
```

**按数据类型划分的 CRDT 合并策略**：

| 数据类型 | CRDT 类型 | 合并策略 | 理由 |
|-----------|-----------|---------------|-----------|
| 幸存者集合 | OR-Set | 取并集（绝不丢失检测结果） | 漏掉幸存者是致命的 |
| 分诊等级 | Max-Register | 最紧急者胜出 | 宁可保守 |
| 位置 | LWW-Register | 最新时间戳胜出 | 幸存者可能移动 |
| 区域分配 | LWW-Map | 领导者的分配胜出 | 需要权威协调 |
| 模型增量 | G-Set | 累积全部增量 | 所有适配都有价值 |

### 节点发现与健康检查

```rust
/// AP 集群管理
pub struct ApCluster {
    /// 本节点的身份标识
    local_ap: ApId,

    /// Raft 共识引擎
    raft: RaftEngine<ConsensusOp>,

    /// 故障检测器（phi-accrual）
    failure_detector: PhiAccrualDetector,

    /// 集群成员
    members: HashSet<ApId>,
}

impl ApCluster {
    /// 用于故障检测的心跳间隔
    const HEARTBEAT_MS: u64 = 500;

    /// 判定节点故障的 phi 阈值
    const PHI_THRESHOLD: f64 = 8.0;

    /// Raft 所需的最小集群规模（需要多数派）
    const MIN_CLUSTER_SIZE: usize = 3;
}
```

### 性能特征

| 操作 | 时延 | 说明 |
|-----------|---------|-------|
| Raft 心跳 | 500 ms 间隔 | 可配置 |
| 日志复制 | 1-5 ms（局域网） | 取决于载荷大小 |
| 领导者选举 | 1-3 秒 | 在检测到领导者失效后 |
| CRDT 合并（分区愈合） | 10-100 ms | 与分歧程度成正比 |
| 向量时钟比较 | <0.01 ms | O(n)，n 为集群规模 |
| 模型增量复制 | 50-200 ms | 约 70 KB 的 LoRA 增量 |

### 部署配置

| 场景 | 节点数 | 共识 | 分区策略 |
|----------|-------|-----------|-------------------|
| 单个房间 | 1-2 | 无（仅本地） | N/A |
| 楼层 | 3-5 | Raft（3 节点法定人数） | 愈合时做 CRDT 合并 |
| 灾害现场 | 5-20 | Raft（5 节点法定人数）+ 分区 | 区域级子集群 |
| 城市搜救 | 20-100 | 分层 Raft | 区域领导者 |

## 影响

### 正面影响
- **状态一致**：所有 AP 通过 Raft 对幸存者名录达成一致
- **分区容忍**：CRDT 合并使断连期间仍可工作
- **因果排序**：向量时钟无需 NTP 即可提供逻辑时间
- **自动故障转移**：Raft 领导者选举可处理 AP 失效
- **模型共享**：SONA 适配结果在集群内传播

### 负面影响
- **至少 3 个节点**：Raft 需要奇数法定人数才能选出领导者
- **网络开销**：心跳与日志复制占用带宽（每节点约 1-10 KB/s）
- **复杂度**：分布式系统天然更难调试
- **写入延迟**：Raft 需多数派确认后才能提交（局域网 1-5ms）
- **脑裂风险**：若集群均分（2+2），两个分区都无法形成法定人数

### 灾害场景专项考量

| 挑战 | 缓解措施 |
|-----------|------------|
| 间歇性连通 | 重连时积极做 CRDT 合并；分区期间本地运行 |
| 断电 | Raft 日志持久化到本地 SSD；重启后恢复 |
| 节点损毁 | Raft 容忍少数节点失效；数据在存活节点间复制 |
| 无人机移动 | 机载 AP 视为临时成员；降落时同步数据 |
| 带宽受限 | 只复制增量；压缩 LoRA 增量 |

## 参考资料

- [Raft Consensus Algorithm](https://raft.github.io/raft.pdf)
- [CRDTs: Conflict-free Replicated Data Types](https://hal.inria.fr/inria-00609399)
- [Vector Clocks](https://en.wikipedia.org/wiki/Vector_clock)
- [Phi Accrual Failure Detector](https://www.computer.org/csdl/proceedings-article/srds/2004/22390066/12OmNyQYtlC)
- [RuVector Distributed Consensus](https://github.com/ruvnet/ruvector)
- ADR-001：WiFi-Mat 灾害检测架构
- ADR-002：RuVector RVF 集成策略
