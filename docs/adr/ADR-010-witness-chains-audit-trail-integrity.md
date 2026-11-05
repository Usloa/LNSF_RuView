# ADR-010：面向审计链完整性的见证链

## 状态
Proposed

## 日期
2026-02-28

## 背景

### 生命攸关的审计要求

wifi-densepose-mat 灾害检测模块（ADR-001）做出的分诊分类直接影响救援优先级：

| 分诊等级 | 处置 | 出错后果 |
|-------------|--------|---------------------|
| P1 (Immediate/Red) | 立即救援 | 漏检 → 幸存者在等待中死亡 |
| P2 (Delayed/Yellow) | 1 小时内救援 | 误分类 → 救援延误 |
| P3 (Minor/Green) | 资源允许时救援 | 过度分诊 → 资源浪费 |
| P4 (Deceased/Black) | 不实施救援 | 误判为 P4 → 活人被遗弃 |

事后调查、责任认定与行动复盘要求：

1. **不可抵赖**：能证明哪台设备在何时做出了哪次检测
2. **篡改可发现**：能发现记录事后被改动
3. **完整性**：能证明没有检测记录被删除或隐藏
4. **因果链**：能重建每次分诊决策之前的事件序列
5. **跨设备核验**：多个 AP 之间能相互印证检测结果

### 现状

检测结果通过标准 INSERT 操作写入数据库（`wifi-densepose-db`）。这些日志可能：
- 被事后悄悄修改
- 被无痕删除
- 被回填日期或重排顺序
- 在数据库损坏时丢失

目前没有任何密码学完整性机制。

### RuVector 见证链

RuVector 实现了受区块链启发、但没有共识开销的哈希链式审计记录：

- **哈希链**：每条记录都包含上一条的 SHAKE-256 哈希，形成可发现篡改的链
- **签名**：链锚点（每第 N 条）用设备密钥对签名
- **跨链背书**：多台设备可相互引用对方的链
- **紧凑**：每条链上记录约 100-200 字节（哈希 + 元数据 + 签名引用）

## 决策

我们将采用 RuVector 见证链，作为 WiFi-DensePose 中所有检测事件、分诊决策和模型适配事件的主要审计机制。

### 见证链结构

```
┌────────────────────────────────────────────────────────────────────┐
│                      Witness Chain                                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Entry 0          Entry 1          Entry 2          Entry 3        │
│  (Genesis)                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ prev: ∅  │◀───│ prev: H0 │◀───│ prev: H1 │◀───│ prev: H2 │     │
│  │ event:   │    │ event:   │    │ event:   │    │ event:   │     │
│  │  INIT    │    │  DETECT  │    │  TRIAGE  │    │  ADAPT   │     │
│  │ hash: H0 │    │ hash: H1 │    │ hash: H2 │    │ hash: H3 │     │
│  │ sig: S0  │    │          │    │          │    │ sig: S1  │     │
│  │ (anchor) │    │          │    │          │    │ (anchor) │     │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │
│                                                                     │
│  H0 = SHAKE-256(INIT || device_id || timestamp)                    │
│  H1 = SHAKE-256(DETECT_DATA || H0 || timestamp)                   │
│  H2 = SHAKE-256(TRIAGE_DATA || H1 || timestamp)                   │
│  H3 = SHAKE-256(ADAPT_DATA || H2 || timestamp)                    │
│                                                                     │
│  Anchor signature S0 = ML-DSA-65.sign(H0, device_key)             │
│  Anchor signature S1 = ML-DSA-65.sign(H3, device_key)             │
│  Anchor interval: every 100 entries (configurable)                 │
└────────────────────────────────────────────────────────────────────┘
```

### 见证事件类型

```rust
/// 记入见证链的事件
#[derive(Serialize, Deserialize, Clone)]
pub enum WitnessedEvent {
    /// 链初始化（创世记录）
    ChainInit {
        device_id: DeviceId,
        firmware_version: String,
        config_hash: [u8; 32],
    },

    /// 检测到人体存在
    HumanDetected {
        detection_id: Uuid,
        confidence: f64,
        csi_features_hash: [u8; 32],  // Hash of input data, not raw data
        location_estimate: Option<GeoCoord>,
        model_version: String,
    },

    /// 分诊分类被指定或变更
    TriageDecision {
        survivor_id: Uuid,
        previous_level: Option<TriageLevel>,
        new_level: TriageLevel,
        evidence_hash: [u8; 32],  // Hash of supporting evidence
        deciding_algorithm: String,
        confidence: f64,
    },

    /// 误检被更正
    DetectionCorrected {
        detection_id: Uuid,
        correction_type: CorrectionType,  // FalsePositive | FalseNegative | Reclassified
        reason: String,
        corrected_by: CorrectorId,  // Device or operator
    },

    /// 模型经 SONA 适配
    ModelAdapted {
        adaptation_id: Uuid,
        trigger: AdaptationTrigger,
        lora_delta_hash: [u8; 32],
        performance_before: f64,
        performance_after: f64,
    },

    /// 区域扫描完成
    ZoneScanCompleted {
        zone_id: ZoneId,
        scan_duration_ms: u64,
        detections_count: usize,
        coverage_percentage: f64,
    },

    /// 收到跨设备背书
    CrossAttestation {
        attesting_device: DeviceId,
        attested_chain_hash: [u8; 32],
        attested_entry_index: u64,
    },

    /// 操作员动作（人工覆盖）
    OperatorAction {
        operator_id: String,
        action: OperatorActionType,
        target: Uuid,  // What was acted upon
        justification: String,
    },
}
```

### 链上条目结构

```rust
/// 见证链中的单条记录
#[derive(Serialize, Deserialize)]
pub struct WitnessEntry {
    /// 在链中的顺序索引
    index: u64,

    /// 上一条记录的 SHAKE-256 哈希（32 字节）
    previous_hash: [u8; 32],

    /// 被见证的事件
    event: WitnessedEvent,

    /// 创建本条记录的设备
    device_id: DeviceId,

    /// 单调时间戳（设备本地，非墙上时钟）
    monotonic_timestamp: u64,

    /// 墙上时钟时间戳（尽力而为，可能不准）
    wall_timestamp: DateTime<Utc>,

    /// 用于因果排序的向量时钟（见 ADR-008）
    vector_clock: VectorClock,

    /// 本条记录的哈希：SHAKE-256(序列化自身，不含本字段)
    entry_hash: [u8; 32],

    /// 锚点签名（每 N 条出现一次）
    anchor_signature: Option<HybridSignature>,
}
```

### 篡改检测

```rust
/// 校验见证链完整性
pub fn verify_chain(chain: &[WitnessEntry]) -> Result<ChainVerification, AuditError> {
    let mut verification = ChainVerification::new();

    for (i, entry) in chain.iter().enumerate() {
        // 1. 校验哈希链的前后衔接
        if i > 0 {
            let expected_prev_hash = chain[i - 1].entry_hash;
            if entry.previous_hash != expected_prev_hash {
                verification.add_violation(ChainViolation::BrokenLink {
                    entry_index: entry.index,
                    expected_hash: expected_prev_hash,
                    actual_hash: entry.previous_hash,
                });
            }
        }

        // 2. 校验记录自身的哈希
        let computed_hash = compute_entry_hash(entry);
        if computed_hash != entry.entry_hash {
            verification.add_violation(ChainViolation::TamperedEntry {
                entry_index: entry.index,
            });
        }

        // 3. 校验锚点签名
        if let Some(ref sig) = entry.anchor_signature {
            let device_keys = load_device_keys(&entry.device_id)?;
            if !sig.verify(&entry.entry_hash, &device_keys.ed25519, &device_keys.ml_dsa)? {
                verification.add_violation(ChainViolation::InvalidSignature {
                    entry_index: entry.index,
                });
            }
        }

        // 4. 校验单调时间戳的顺序
        if i > 0 && entry.monotonic_timestamp <= chain[i - 1].monotonic_timestamp {
            verification.add_violation(ChainViolation::NonMonotonicTimestamp {
                entry_index: entry.index,
            });
        }

        verification.verified_entries += 1;
    }

    Ok(verification)
}
```

### 跨设备背书

多个 AP 可以互相引用对方的链，以获得更强的保证：

```
Device A's chain:                    Device B's chain:
┌──────────┐                         ┌──────────┐
│ Entry 50 │                         │ Entry 73 │
│ H_A50    │◀────── cross-attest ───▶│ H_B73    │
└──────────┘                         └──────────┘

Device A records: CrossAttestation { attesting: B, hash: H_B73, index: 73 }
Device B records: CrossAttestation { attesting: A, hash: H_A50, index: 50 }

After cross-attestation:
- Neither device can rewrite entries before the attested point
  without the other device's chain becoming inconsistent
- An investigator can verify both chains agree on the attestation point
```

**背书频率**：连接正常时每 5 分钟一次；遇到重大事件（P1 分诊、区域扫描完成）立即触发。

### 存储与检索

见证链存放在 RVF 容器的 WITNESS 段：

```rust
/// 见证链存储管理器
pub struct WitnessChainStore {
    /// 当前正在追加的链
    active_chain: Vec<WitnessEntry>,

    /// 锚点签名间隔
    anchor_interval: usize,  // 100

    /// 设备签名密钥
    device_key: DeviceKeyPair,

    /// 跨设备背书对端
    attestation_peers: Vec<DeviceId>,

    /// 用于持久化的 RVF 容器
    container: RvfContainer,
}

impl WitnessChainStore {
    /// 向链中追加一个事件
    pub fn witness(&mut self, event: WitnessedEvent) -> Result<u64, AuditError> {
        let index = self.active_chain.len() as u64;
        let previous_hash = self.active_chain.last()
            .map(|e| e.entry_hash)
            .unwrap_or([0u8; 32]);

        let mut entry = WitnessEntry {
            index,
            previous_hash,
            event,
            device_id: self.device_key.device_id(),
            monotonic_timestamp: monotonic_now(),
            wall_timestamp: Utc::now(),
            vector_clock: self.get_current_vclock(),
            entry_hash: [0u8; 32],  // Computed below
            anchor_signature: None,
        };

        // 计算本条记录的哈希
        entry.entry_hash = compute_entry_hash(&entry);

        // 按间隔添加锚点签名
        if index % self.anchor_interval as u64 == 0 {
            entry.anchor_signature = Some(
                self.device_key.sign_hybrid(&entry.entry_hash)?
            );
        }

        self.active_chain.push(entry);

        // 持久化到 RVF 容器
        self.container.append_witness(&self.active_chain.last().unwrap())?;

        Ok(index)
    }

    /// 按时间范围查询链上事件
    pub fn query_range(&self, start: DateTime<Utc>, end: DateTime<Utc>)
        -> Vec<&WitnessEntry>
    {
        self.active_chain.iter()
            .filter(|e| e.wall_timestamp >= start && e.wall_timestamp <= end)
            .collect()
    }

    /// 导出链供外部审计
    pub fn export_for_audit(&self) -> AuditBundle {
        AuditBundle {
            chain: self.active_chain.clone(),
            device_public_key: self.device_key.public_keys(),
            cross_attestations: self.collect_cross_attestations(),
            chain_summary: self.compute_summary(),
        }
    }
}
```

### 性能影响

| 操作 | 时延 | 说明 |
|-----------|---------|-------|
| 追加记录 | 0.05 ms | 计算哈希 + 序列化 |
| 追加并做锚点签名 | 0.5 ms | + ML-DSA-65 签名 |
| 校验单条记录 | 0.02 ms | 哈希比对 |
| 校验锚点 | 0.3 ms | ML-DSA-65 验签 |
| 整链校验（1 万条） | 50 ms | 顺序哈希校验 |
| 跨设备背书 | 1 ms | 签名 + 网络往返 |

### 存储需求

| 链活跃度 | 条目/小时 | 体积/小时 | 体积/天 |
|-------------|-------------|-----------|----------|
| 低活动 | ~100 | ~20 KB | ~480 KB |
| 正常运行 | ~1,000 | ~200 KB | ~4.8 MB |
| 灾害响应 | ~10,000 | ~2 MB | ~48 MB |
| 高强度扫描 | ~50,000 | ~10 MB | ~240 MB |

## 影响

### 正面影响
- **篡改可发现**：对历史记录的任何改动都能被检出
- **不可抵赖**：带签名的锚点可证明设备身份
- **历史完整**：每次检测、分诊与更正都有记录
- **交叉核验**：多设备背书增强了保证力度
- **取证可用**：可导出审计包用于法律程序
- **开销低**：每条记录 0.05ms；正常运行下存储占用很小

### 负面影响
- **只增不减**：链单调增长，长期部署需要归档策略
- **密钥管理**：设备密钥必须下发并妥善保护
- **时钟依赖**：墙上时钟时间戳只是尽力而为；单调时间戳是设备本地的
- **校验成本**：长链整链校验耗时可观（1 万条约 50ms）
- **隐私张力**：详细的审计链包含行动情报

### 法规对齐

| 要求 | 见证链如何满足 |
|------------|------------------------------|
| GDPR（删除权） | 存的是事件哈希而非个人数据；原始数据可删除，链仍能证明历史完整性 |
| HIPAA（审计控制） | 完整且不可抵赖的访问/修改日志 |
| ISO 27001（信息安全） | 篡改可发现的记录、访问日志、完整性校验 |
| NIST SP 800-53（AU 控制项） | 具备审计记录生成、保护与复核能力 |
| FEMA ICS（事件指挥） | 所有行动决策都有监管链 |

## 参考资料

- [Witness Chains in Distributed Systems](https://eprint.iacr.org/2019/747)
- [SHAKE-256 (FIPS 202)](https://csrc.nist.gov/pubs/fips/202/final)
- [Tamper-Evident Logging](https://www.usenix.org/legacy/event/sec09/tech/full_papers/crosby.pdf)
- [RuVector Witness Implementation](https://github.com/ruvnet/ruvector)
- ADR-001：WiFi-Mat 灾害检测架构
- ADR-007：面向安全感知的后量子密码
- ADR-008：面向多 AP 的分布式共识
