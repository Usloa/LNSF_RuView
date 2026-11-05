# ADR-030：RuvSense 持久场模型 —— 纵向漂移检测与进阶感知层级

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-02 |
| **决策者** | ruv |
| **代号** | **RuvSense Field** —— 持久化电磁世界模型 |
| **关联项** | ADR-029（RuvSense 多基地）、ADR-005（SONA 自学习）、ADR-024（AETHER 嵌入）、ADR-016（RuVector 集成）、ADR-026（幸存者轨迹生命周期）、ADR-027（MERIDIAN 泛化）|

---

## 1. 背景

### 1.1 超越姿态估计

ADR-029 把 RuvSense 确立为感知优先的多基地网格，可实现 20 Hz DensePose、抖动 <30mm。这仍把 WiFi 当作**瞬时姿态估计器**。下一步的跃迁是：把电磁场当作一个会记忆、会预测、能解释的**持久化世界模型**。

最前沿的能力来自抽象层级的这一转变：
- 房间本身就是模型，而不是人
- 人是基线之上的结构化扰动
- 变化是相对已知状态的增量，而不是原始测量值
- 时间成为一等维度 —— 系统记住的是「天」，不是「帧」

### 1.2 七层能力分级

| 层级 | 能力 | 基础 |
|------|-----------|-----------|
| 1 | **场正则模** —— 房间的电磁本征结构 | 基线标定 + SVD |
| 2 | **粗粒度 RF 层析** —— 由链路衰减重建三维占据体积 | 稀疏层析反演 |
| 3 | **意图先导信号** —— 运动前预测（提前 200-500ms）| 时序嵌入轨迹分析 |
| 4 | **纵向生物力学漂移** —— 个人基线在数天尺度上的偏离 | Welford 统计 + HNSW 记忆 |
| 5 | **跨房间连续性** —— 无光学条件下的跨空间身份保持 | 环境指纹 + 转移图 |
| 6 | **隐形交互层** —— 隔墙/黑暗环境下的多人手势控制 | 逐人 CSI 扰动分类 |
| 7 | **对抗检测** —— 识别物理上不可能的信号 | 多链路一致性 + 场模型约束 |

### 1.3 是信号，不是诊断

RF 感知检测的是**生物物理代理指标**，而不是疾病本身：

| 可检测信号 | 不可检测 |
|-------------------|---------------|
| 呼吸率变异性 | COPD 诊断 |
| 步态不对称偏移（14 天内 18%）| 帕金森病 |
| 姿态稳定性下降 | 神经系统疾病 |
| 微震颤出现 | 特定震颤病因 |
| 活动水平下降 | 抑郁或疼痛诊断 |

输出形如："您的动作对称性在 14 天内偏移了 18%。" 这具备可操作性，但不构成诊断。证据链（已存储的嵌入、漂移统计、相干性得分）全程可追溯。

### 1.4 验收测试

**Tier 0（ADR-029）：** 两人、20 Hz、10 分钟稳定轨迹、零 ID 互换、躯干抖动 <30mm。

**Tier 1-4（本 ADR）：** 连续运行七天，不做人工调参。系统须标记出一次真实环境变化与一次真实人体漂移事件，并利用已存储的嵌入与图约束给出可追溯的解释。

**Tier 5-7（设备形态）：** 本地连续运行三十天，无摄像头。在误报率 <5% 的前提下检测出有意义的漂移。

---

## 2. 决策

### 2.1 以场正则模作为基础

在 `wifi-densepose-signal/src/ruvsense/` 中新增 `field_model` 模块：在房间无人期间学习其电磁基线，并把此后所有观测分解为环境漂移 + 人体扰动。

```
wifi-densepose-signal/src/ruvsense/
├── mod.rs                // (existing, extend)
├── field_model.rs        // NEW: Field normal mode computation + perturbation extraction
├── tomography.rs         // NEW: Coarse RF tomography from link attenuations
├── longitudinal.rs       // NEW: Personal baseline + drift detection
├── intention.rs          // NEW: Pre-movement lead signal detector
├── cross_room.rs         // NEW: Cross-room identity continuity
├── gesture.rs            // NEW: Gesture classification from CSI perturbations
├── adversarial.rs        // NEW: Physically impossible signal detection
└── (existing files...)
```

### 2.2 核心架构：持久化场模型

```
                    Time
                     │
                     ▼
    ┌────────────────────────────────┐
    │     Field Normal Modes (Tier 1) │
    │     Room baseline + SVD modes   │
    │     ruvector-solver             │
    └────────────┬───────────────────┘
                 │ Body perturbation (environmental drift removed)
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
    ┌──────────┐   ┌──────────────┐
    │ Pose     │   │ RF Tomography│
    │ (ADR-029)│   │ (Tier 2)     │
    │ 20 Hz    │   │ Occupancy vol│
    └────┬─────┘   └──────────────┘
         │
         ▼
    ┌──────────────────────────────┐
    │  AETHER Embedding (ADR-024)  │
    │  128-dim contrastive vector  │
    └────────────┬─────────────────┘
                 │
         ┌───────┼───────┐
         │       │       │
         ▼       ▼       ▼
    ┌────────┐ ┌─────┐ ┌──────────┐
    │Intention│ │Track│ │Cross-Room│
    │Lead    │ │Re-ID│ │Continuity│
    │(Tier 3)│ │     │ │(Tier 5)  │
    └────────┘ └──┬──┘ └──────────┘
                  │
                  ▼
    ┌──────────────────────────────┐
    │  RuVector Longitudinal Memory │
    │  HNSW + graph + Welford stats│
    │  (Tier 4)                     │
    └──────────────┬───────────────┘
                   │
           ┌───────┴───────┐
           │               │
           ▼               ▼
    ┌──────────────┐ ┌──────────────┐
    │ Drift Reports│ │ Adversarial  │
    │ (Level 1-3)  │ │ Detection    │
    │              │ │ (Tier 7)     │
    └──────────────┘ └──────────────┘
```

### 2.3 场正则模（Tier 1）

**是什么：** 房间的电磁本征结构 —— 无人时稳定的传播路径、反射系数与干涉图样。

**工作原理：**
1. 在安静时段（空房间、夜间）采集全链路 10 分钟 CSI
2. 计算逐链路基线（CSI 均值向量）
3. 通过 SVD 计算环境变化模式（温度、湿度、时段效应）
4. 保存 top-K 个模式（K=3-5 通常即可覆盖 >95% 的环境方差）
5. 运行时：减去基线、投影去除环境模式、保留人体扰动

```rust
pub struct FieldNormalMode {
    pub baseline: Vec<Vec<Complex<f32>>>,      // [n_links × n_subcarriers]
    pub environmental_modes: Vec<Vec<f32>>,    // [n_modes × n_subcarriers]
    pub mode_energies: Vec<f32>,               // eigenvalues
    pub calibrated_at: u64,
    pub geometry_hash: u64,
}
```

**RuVector 集成：**
- `ruvector-solver` → 用低秩 SVD 提取模式
- `ruvector-temporal-tensor` → 压缩存储基线历史
- `ruvector-attn-mincut` → 判定各子载波归属于哪个模式

### 2.4 纵向漂移检测（Tier 4）

**可自证清白的流水线：**

```
RF → AETHER contrastive embedding
   → RuVector longitudinal memory (HNSW + graph)
     → Coherence-gated drift detection (Welford statistics)
       → Risk flag with traceable evidence
```

**三级监控：**

| 级别 | 信号类型 | 输出示例 |
|-------|------------|----------------|
| **1：生理指标** | 原始生物物理指标 | "Breathing rate: 18.3 BPM today, 7-day avg: 16.1" |
| **2：漂移** | 个人基线偏离 | "Gait symmetry shifted 18% over 14 days" |
| **3：风险关联** | 模式匹配到的关注项 | "Pattern consistent with increased fall risk" |

**存储模型：**

```rust
pub struct PersonalBaseline {
    pub person_id: PersonId,
    pub gait_symmetry: WelfordStats,
    pub stability_index: WelfordStats,
    pub breathing_regularity: WelfordStats,
    pub micro_tremor: WelfordStats,
    pub activity_level: WelfordStats,
    pub embedding_centroid: Vec<f32>,  // [128]
    pub observation_days: u32,
    pub updated_at: u64,
}
```

**RuVector 集成：**
- `ruvector-temporal-tensor` → 压缩每日摘要（节省 50-75% 内存）
- HNSW → 在纵向记录中做嵌入相似度检索
- `ruvector-attention` → 逐指标漂移显著性加权
- `ruvector-mincut` → 时序分段（检测指标序列中的变点）

### 2.5 监管分类

| 分类 | 主张内容 | 监管路径 |
|---------------|---------------|-----------------|
| **消费级健康产品**（建议优先）| 活动指标、呼吸率、稳定性评分 | 自我声明符合性，FCC Part 15 |
| **临床决策支持**（未来）| 跌倒风险告警、呼吸模式异常提示 | FDA Class II 510(k) 或 De Novo |
| **受监管医疗器械**（需临床合作方）| 针对特定病症的诊断主张 | FDA Class II/III + 临床试验 |

**决策：先从消费级健康产品起步。** 积累 12+ 个月的真实世界纵向数据，数据集本身就成为未来监管申报的资产。

---

## 3. 设备化产品品类

### 3.1 隐形守护者

壁挂式健康监测仪，面向养老与独立生活场景。无摄像头、无麦克风、无可重建数据，只存储嵌入与结构化增量。

| 规格 | 值 |
|------|-------|
| 节点 | 每房间 4 个 ESP32-S3 感知点 |
| 处理 | 中央中枢（RPi 5 或 x86）|
| 供电 | PoE 或 USB-C |
| 输出 | 风险标记、漂移告警、占用时间线 |
| BOM | $73-91（ESP32 网格）+ $35-80（中枢）|
| 验证 | 30 天自主运行，误报率 <5% |

### 3.2 空间数字孪生节点

面向智慧楼宇与工作场所分析的实时电磁房间模型。

| 规格 | 值 |
|------|-------|
| 输出 | 占用热力图、流向矢量、停留时长、异常事件 |
| 集成 | 面向 BMS 与 CAFM 的 MQTT/REST API |
| 留存 | 30 天滚动，符合 GDPR |
| 适用行业 | 智慧楼宇、零售、工作空间优化 |

### 3.3 RF 交互表面

多人手势交互界面。无摄像头，在黑暗、烟雾中以及隔着衣物均可工作。

| 规格 | 值 |
|------|-------|
| 手势 | 挥手、指向、招手、推、画圈 + 自定义 |
| 用户数 | 最多 4 人同时使用 |
| 时延 | 手势识别 <100ms |
| 适用行业 | 智能家居、酒店、无障碍辅助 |

### 3.4 事发前漂移监测仪

面向康复与职业健康场景的纵向生物力学跟踪器。

| 规格 | 值 |
|------|-------|
| 基线 | 每人 7 天标定 |
| 告警 | 指标漂移 >2sigma 且持续 >3 天 |
| 证据 | 已存储的嵌入轨迹 + 统计报告 |
| 适用行业 | 养老、康复、职业健康 |

### 3.5 首款硬件 SKU 的行业建议

**Invisible Guardian** —— 面向养老的健康监测仪。理由：
1. 可触达市场最大、能立即产生收入（老龄化人口、养老机构需求）
2. 监管门槛最低（消费级健康产品，不作诊断主张）
3. 相对摄像头的隐私优势是卖点，而不是限制
4. 30 天自主运行即可验证所有层级（场模型、漂移检测、相干性门控）
5. $108-171 的 BOM 可支撑 $299-499 零售价并保持健康毛利

---

## 4. RuVector 集成映射（扩展）

五个 crate 全部在进阶层级中得到运用：

| 层级 | crate | API | 作用 |
|------|-------|-----|------|
| 1（场）| `ruvector-solver` | `NeumannSolver` + SVD | 环境模式分解 |
| 1（场）| `ruvector-temporal-tensor` | `TemporalTensorCompressor` | 基线历史存储 |
| 1（场）| `ruvector-attn-mincut` | `attn_mincut` | 模式与子载波归属分配 |
| 2（层析）| `ruvector-solver` | `NeumannSolver` (L1) | 稀疏层析反演 |
| 3（意图）| `ruvector-attention` | `ScaledDotProductAttention` | 时序轨迹加权 |
| 3（意图）| `ruvector-temporal-tensor` | `CompressedCsiBuffer` | 2 秒嵌入历史 |
| 4（漂移）| `ruvector-temporal-tensor` | `TemporalTensorCompressor` | 每日摘要压缩 |
| 4（漂移）| `ruvector-attention` | `ScaledDotProductAttention` | 指标漂移显著性 |
| 4（漂移）| `ruvector-mincut` | `DynamicMinCut` | 时序变点检测 |
| 5（跨房间）| `ruvector-attention` | HNSW | 房间与人员指纹匹配 |
| 5（跨房间）| `ruvector-mincut` | `MinCutBuilder` | 转移图划分 |
| 6（手势）| `ruvector-attention` | `ScaledDotProductAttention` | 手势模板匹配 |
| 7（对抗）| `ruvector-solver` | `NeumannSolver` | 物理合理性校验 |
| 7（对抗）| `ruvector-attn-mincut` | `attn_mincut` | 多链路一致性检查 |

---

## 5. 实施优先级

| 优先级 | 层级 | 模块 | 周数 | 依赖 |
|----------|------|--------|-------|------------|
| P0 | 1 | `field_model.rs` | 2 | ADR-029 多基地网格可用 |
| P0 | 4 | `longitudinal.rs` | 2 | Tier 1 基线 + AETHER 嵌入 |
| P1 | 2 | `tomography.rs` | 1 | Tier 1 扰动提取 |
| P1 | 3 | `intention.rs` | 2 | Tier 1 + 时序嵌入历史 |
| P2 | 5 | `cross_room.rs` | 2 | Tier 4 个人画像 + 多房间部署 |
| P2 | 6 | `gesture.rs` | 1 | Tier 1 扰动 + 逐人分离 |
| P3 | 7 | `adversarial.rs` | 1 | Tier 1 场模型 + 多链路一致性 |

**进阶层级总计：ADR-029 验收测试通过后约 ~11 周。**

---

## 6. 影响

### 6.1 正面

- **房间具备自感知能力**：场正则模提供持久基线，把变化解释为结构化增量
- **7 天自主运行**：相干性门控 + SONA 自适应 + 纵向记忆，免除人工调参
- **隐私内置**：无图像、无音频、无可重建数据 —— 只有嵌入与统计摘要
- **证据可追溯**：每条漂移告警都能关联到已存储的嵌入、时间戳与图约束
- **多种产品品类**：同一套软件栈、不同封装 —— Guardian、Twin、Interaction、Drift Monitor
- **监管路径清晰**：先做消费级健康产品，积累数据集后再进入临床决策支持
- **安全原语**：相干性门控能检出对抗注入，而不只是质量问题

### 6.2 负面

- **需要 7 天标定**才能建立个人基线（初始阶段系统用处有限）
- **需要空房间标定**才能建立场正则模（未必总能具备该条件）
- **存储增长**：纵向记忆约以 ~1 KB/人/天 增长（可控但非零）
- **统计功效**：漂移检测需要 14+ 天数据才能得到有意义的 z-score
- **多房间**：跨房间连续性要求每个房间都部署硬件（成本线性增长）

### 6.3 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| 场模式漂移快于预期 | Medium | 误报人体扰动 | 把模式更新间隔从 24h 缩短到 4h |
| 个人基线波动过大 | Medium | 漂移误报率高 | 把 sigma 阈值从 2σ 放宽到 3σ；要求 5+ 天数据 |
| 体型相近时跨房间匹配失败 | Low | 身份混淆 | 同时要求时间邻近（<60s）与空间相邻 |
| 手势识别 SNR 不足 | Medium | 准确率 <80% | 初期只支持近场（<2m）|
| 协同 WiFi 注入实施对抗攻击 | Very Low | 伪造占用状态 | 多链路一致性检查可检出单链路伪造 |

---

## 7. 相关 ADR

| ADR | 关系 |
|-----|-------------|
| ADR-029 | **前置条件**：多基地网格是所有进阶层级的感知底座 |
| ADR-005 (SONA) | **扩展**：SONA 重校准原先由相干性门控触发，现在也由漂移事件触发 |
| ADR-016 (RuVector) | **扩展**：5 个 crate 全部运用到 7 个进阶层级 |
| ADR-024 (AETHER) | **关键依赖**：嵌入是所有纵向记忆的表示形式 |
| ADR-026 (Tracking) | **扩展**：为漂移检测，轨迹生命周期现在以天计（而非分钟）|
| ADR-027 (MERIDIAN) | **使用**：房间几何编码用于场正则模的条件化 |

---

## 8. 参考资料

1. IEEE 802.11bf-2024. "WLAN Sensing." IEEE 标准协会。
2. FDA. "General Wellness: Policy for Low Risk Devices." 指导文件，2019 年。
3. EU MDR 2017/745. "Medical Device Regulation." 《欧盟官方公报》。
4. Welford, B.P.（1962 年）。"Note on a Method for Calculating Corrected Sums of Squares." Technometrics。
5. Chen, L. 等（2026 年）。"PerceptAlign: Geometry-Aware WiFi Sensing." arXiv:2601.12252。
6. AM-FM（2026 年）。"A Foundation Model for Ambient Intelligence Through WiFi." arXiv:2602.11200。
7. Geng, J. 等（2023 年）。"DensePose From WiFi." arXiv:2301.00250。
