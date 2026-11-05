# ADR-033：CRV 信号线感知集成 -- 将六阶段坐标遥视映射到 WiFi-DensePose 流水线

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-01 |
| **决策者** | ruv |
| **代号** | **CRV-Sense** -- 面向 WiFi 感知的坐标遥视信号线 |
| **关联文档** | ADR-016（RuVector 集成）、ADR-017（RuVector Signal+MAT）、ADR-024（AETHER 嵌入）、ADR-029（RuvSense 多基地）、ADR-030（持久场模型）、ADR-031（RuView 视点融合）、ADR-032（网格安全） |

---

## 1. 背景

### 1.1 CRV 信号线方法论

坐标遥视（Coordinate Remote Viewing，CRV）是一套结构化的六阶段协议，把感知从粗略的整体印象（Stage I）逐步精炼到感官细节（Stage II）、空间维度（Stage III）、噪声分离（Stage IV）、交叉参照式探询（Stage V），最终形成复合三维模型（Stage VI）。`ruvector-crv` crate（v0.1.1，已发布到 crates.io）把这六个阶段映射到向量数据库的各个子系统：Poincare 球嵌入、多头注意力、GNN 图拓扑、SNN 时间编码、可微搜索与 MinCut 分区。

WiFi-DensePose 感知流水线遵循一条惊人相似的渐进求精路径：

1. 原始 CSI 作为未经区分的信号到达 -- 系统必须首先判定 RF 环境的整体形态特征。
2. 提取每个子载波的幅度、相位与频率特征 -- 对应感官印象。
3. AP 网格以节点位置与链路几何构成空间拓扑 -- 相当于维度草图。
4. 相干性门控把有效信号与噪声、干扰分离 -- 必须检测并剔除分析性叠加产物。
5. 姿态估计回查此前的 CSI 特征以交叉参照 -- 即对累积证据的探询。
6. 最终的多人分区产出复合 DensePose 结果 -- 即三维模型。

这种结构同构并非偶然。CRV 与 WiFi 感知解决的是同一个抽象问题：在含噪的高维信号空间中，通过带显式噪声分离的渐进求精提取结构化信息。

### 1.2 ruvector-crv crate（v0.1.1 版本）

`ruvector-crv` crate 提供以下公共 API：

| 组件 | 用途 | 上游依赖 |
|-----------|---------|-------------------|
| `CrvSessionManager` | 会话生命周期：创建、追加阶段数据、收敛分析 | -- |
| `StageIEncoder` | 用于整体形态原语的 Poincare 球双曲嵌入 | --（内部双曲数学） |
| `StageIIEncoder` | 用于感官向量的多头注意力 | `ruvector-attention` |
| `StageIIIEncoder` | GNN 图拓扑编码 | `ruvector-gnn` |
| `StageIVEncoder` | 用于 AOL（分析性叠加）检测的 SNN 时间编码 | --（内部 SNN） |
| `StageVEngine` | 可微搜索与交叉参照 | --（内部软注意力） |
| `StageVIModeler` | 用于复合模型的 MinCut 分区 | `ruvector-mincut` |
| `ConvergenceResult` | 跨会话一致性分析 | -- |
| `CrvConfig` | 配置（默认 384 维、曲率、AOL 阈值、SNN 参数） | -- |

关键类型：`GestaltType`（Manmade/Natural/Movement/Energy/Water/Land）、`SensoryModality`（Texture/Color/Temperature/Sound/...）、`AOLDetection`（内容 + 异常分数）、`SignalLineProbe`（查询 + 注意力权重）、`TargetPartition`（MinCut 簇 + 质心）。

### 1.3 WiFi-DensePose 中已有的实现

以下模块已经实现了 CRV 各阶段所映射到的流水线环节：

| 现有模块 | 位置 | 对应的 CRV 阶段 |
|----------------|----------|-------------------|
| `multiband.rs` | `wifi-densepose-signal/src/ruvsense/` | Stage I（由多频段 CSI 得出整体形态） |
| `phase_align.rs` | `wifi-densepose-signal/src/ruvsense/` | Stage II（相位特征提取） |
| `multistatic.rs` | `wifi-densepose-signal/src/ruvsense/` | Stage III（AP 网格空间拓扑） |
| `coherence_gate.rs` | `wifi-densepose-signal/src/ruvsense/` | Stage IV（信号与噪声分离） |
| `field_model.rs` | `wifi-densepose-signal/src/ruvsense/` | Stage V（可供查询的持久场） |
| `pose_tracker.rs` | `wifi-densepose-signal/src/ruvsense/` | Stage VI（人员跟踪输出） |
| 视点融合 | `wifi-densepose-ruvector/src/viewpoint/` | 跨会话（多视点收敛） |

`wifi-densepose-ruvector` crate 已在其 `Cargo.toml` 中依赖 `ruvector-crv`。本 ADR 定义如何用 WiFi-DensePose 的领域类型封装 CRV API。

### 1.4 关键洞见：跨会话收敛 = 跨房间身份

CRV 的收敛分析比较针对同一坐标的独立会话，寻找其嵌入之间的一致性。在 WiFi-DensePose 中，不同房间的 AP 簇是同一个人的独立「观察者」。当一个人从房间 A 移动到房间 B 时，CRV 收敛机制可以在房间 A 的嵌入轨迹与房间 B 的初始嵌入之间找到一致性 -- 从而在无需摄像头的情况下确立身份连续性。

---

## 2. 决策

### 2.1 CRV 到 WiFi 的六阶段映射

在 `wifi-densepose-ruvector` crate 中新建 `crv` 模块，用 WiFi-DensePose 的领域类型封装 `ruvector-crv`。每个 CRV 阶段都映射到感知流水线中的一个具体位置。

```
+-------------------------------------------------------------------+
|                 CRV-Sense Pipeline (6 Stages)                      |
+-------------------------------------------------------------------+
|                                                                     |
|  Raw CSI frames from ESP32 mesh (ADR-029)                          |
|       |                                                             |
|       v                                                             |
|  +----------------------------------------------------------+     |
|  | Stage I: CSI Gestalt Classification                       |     |
|  |   CsiGestaltClassifier                                    |     |
|  |   Input: raw CSI frame (amplitude envelope + phase slope) |     |
|  |   Output: GestaltType (Manmade/Natural/Movement/Energy)   |     |
|  |   Encoder: StageIEncoder (Poincare ball embedding)        |     |
|  |   Module: ruvsense/multiband.rs                           |     |
|  +----------------------------+-----------------------------+     |
|                               |                                     |
|                               v                                     |
|  +----------------------------------------------------------+     |
|  | Stage II: CSI Sensory Feature Extraction                  |     |
|  |   CsiSensoryEncoder                                       |     |
|  |   Input: per-subcarrier CSI                               |     |
|  |   Output: amplitude textures, phase patterns, freq colors |     |
|  |   Encoder: StageIIEncoder (multi-head attention vectors)  |     |
|  |   Module: ruvsense/phase_align.rs                         |     |
|  +----------------------------+-----------------------------+     |
|                               |                                     |
|                               v                                     |
|  +----------------------------------------------------------+     |
|  | Stage III: AP Mesh Spatial Topology                       |     |
|  |   MeshTopologyEncoder                                     |     |
|  |   Input: node positions, link SNR, baseline distances     |     |
|  |   Output: GNN graph embedding of mesh geometry            |     |
|  |   Encoder: StageIIIEncoder (GNN topology)                 |     |
|  |   Module: ruvsense/multistatic.rs                         |     |
|  +----------------------------+-----------------------------+     |
|                               |                                     |
|                               v                                     |
|  +----------------------------------------------------------+     |
|  | Stage IV: Coherence Gating (AOL Detection)                |     |
|  |   CoherenceAolDetector                                    |     |
|  |   Input: phase coherence scores, gate decisions           |     |
|  |   Output: AOL-flagged frames removed, clean signal kept   |     |
|  |   Encoder: StageIVEncoder (SNN temporal encoding)         |     |
|  |   Module: ruvsense/coherence_gate.rs                      |     |
|  +----------------------------+-----------------------------+     |
|                               |                                     |
|                               v                                     |
|  +----------------------------------------------------------+     |
|  | Stage V: Pose Interrogation                               |     |
|  |   PoseInterrogator                                        |     |
|  |   Input: pose hypothesis + accumulated CSI features       |     |
|  |   Output: soft attention over CSI history, top candidates |     |
|  |   Engine: StageVEngine (differentiable search)            |     |
|  |   Module: ruvsense/field_model.rs                         |     |
|  +----------------------------+-----------------------------+     |
|                               |                                     |
|                               v                                     |
|  +----------------------------------------------------------+     |
|  | Stage VI: Multi-Person Partitioning                       |     |
|  |   PersonPartitioner                                       |     |
|  |   Input: all person embedding clusters                    |     |
|  |   Output: MinCut-separated person partitions + centroids  |     |
|  |   Modeler: StageVIModeler (MinCut partitioning)           |     |
|  |   Module: training pipeline (ruvector-mincut)             |     |
|  +----------------------------+-----------------------------+     |
|                               |                                     |
|                               v                                     |
|  +----------------------------------------------------------+     |
|  | Cross-Session: Multi-Room Convergence                     |     |
|  |   MultiViewerConvergence                                  |     |
|  |   Input: per-room embedding trails for candidate persons  |     |
|  |   Output: cross-room identity matches + confidence        |     |
|  |   Engine: CrvSessionManager::find_convergence()           |     |
|  |   Module: ruvsense/cross_room.rs                          |     |
|  +----------------------------------------------------------+     |
+-------------------------------------------------------------------+
```

### 2.2 Stage I：CSI 整体形态分类

**CRV 映射：** Stage I 的意符图（ideogram）判定目标的基本性质（Manmade/Natural/Movement/Energy）。在 WiFi 感知中，原始 CSI 帧的幅度包络形状与相位斜率方向提供了对 RF 环境的类似整体形态分类。

**WiFi 领域类型：**

```rust
/// 从 CRV GestaltType 映射而来的 CSI 领域整体形态类型。
///
/// CRV 分类体系对应如下 RF 现象：
/// - Manmade：结构性多径（墙壁、家具、金属反射体）
/// - Natural：漫散射（植被、不规则表面）
/// - Movement：多普勒频移分量（人体运动、风扇、宠物）
/// - Energy：高幅度瞬态（微波炉、电机、干扰）
/// - Water：慢衰落包络（湿度变化、冷凝）
/// - Land：静态基线（空房间、无扰动）
pub struct CsiGestaltClassifier {
    encoder: StageIEncoder,
    config: CrvConfig,
}

impl CsiGestaltClassifier {
    /// 把原始 CSI 帧分类为某种整体形态类型。
    ///
    /// 从 CSI 帧中提取三项特征：
    /// 1. 幅度包络形状（对应意符图笔画）
    /// 2. 相位斜率方向（对应自发描述词）
    /// 3. 子载波相关结构（分类信号）
    ///
    /// 返回 Poincare 球嵌入（默认 384 维），以层级化方式
    /// 编码整体形态分类体系；相比欧氏空间，其失真
    /// 随层级深度呈指数级降低。
    pub fn classify(&self, csi_frame: &CsiFrame) -> CrvResult<(GestaltType, Vec<f32>)>;
}
```

**集成点：** `ruvsense/multiband.rs` 已在处理多频段 CSI。`CsiGestaltClassifier` 通过 `StageIEncoder` 为其加上 Poincare 球嵌入封装，产出可刻画整体形态层级的双曲嵌入。

### 2.3 Stage II：CSI 感官特征提取

**CRV 映射：** Stage II 收集感官印象（纹理、颜色、温度）。在 WiFi 感知中，每个子载波的 CSI 特征就是感官模态：

| CRV 感官模态 | WiFi CSI 对应量 |
|----------------------|-----------------|
| Texture | 跨子载波的幅度方差模式（平滑表面反射与粗糙表面反射之别） |
| Color | 频域频谱形状（哪些子载波承载的能量最多） |
| Temperature | 相位漂移速率（热膨胀改变路径长度） |
| Luminosity | 整体信号功率水平（SNR） |
| Dimension | 时延扩展（多径范围对应房间尺寸） |

**WiFi 领域类型：**

```rust
pub struct CsiSensoryEncoder {
    encoder: StageIIEncoder,
}

impl CsiSensoryEncoder {
    /// 从每个子载波的 CSI 数据中提取感官特征。
    ///
    /// 把 CSI 信号特征映射到 CRV 感官模态：
    /// - 幅度方差 -> Texture
    /// - 频谱形状 -> Color
    /// - 相位漂移速率 -> Temperature
    /// - 信号功率 -> Luminosity
    /// - 时延扩展 -> Dimension
    ///
    /// 使用多头注意力（ruvector-attention）生成统一的
    /// 感官嵌入，用以刻画跨模态之间的
    /// 相关性。
    pub fn encode(&self, csi_subcarriers: &SubcarrierData) -> CrvResult<Vec<f32>>;
}
```

**集成点：** `ruvsense/phase_align.rs` 已在计算逐子载波相位特征。`CsiSensoryEncoder` 把这些特征映射为 `StageIIData` 的感官印象，并通过 `StageIIEncoder` 产出注意力加权的嵌入。

### 2.4 Stage III：AP 网格空间拓扑

**CRV 映射：** Stage III 用几何原语与关系勾画空间布局。在 WiFi 感知中，AP 网格节点及其节点间链路构成了这张空间草图：

| CRV 草图元素 | WiFi 网格对应量 |
|-------------------|-----------------|
| `SketchElement` | AP 节点（位置、天线朝向） |
| `GeometricKind::Point` | 单个 AP 的位置 |
| `GeometricKind::Line` | 两个 AP 之间的双基地链路 |
| `SpatialRelationship` | 链路质量、基线距离、角度间隔 |

**WiFi 领域类型：**

```rust
pub struct MeshTopologyEncoder {
    encoder: StageIIIEncoder,
}

impl MeshTopologyEncoder {
    /// 把 AP 网格编码为 GNN 图拓扑。
    ///
    /// 每个 AP 节点连同其位置与天线数量成为一个
    /// SketchElement；每条双基地链路成为一个
    /// SpatialRelationship，其强度正比于链路 SNR。
    ///
    /// 使用 ruvector-gnn 生成图嵌入，用以刻画网格的
    /// 几何多样性指数（GDI）与有效
    /// 视点数量。
    pub fn encode(&self, mesh: &MultistaticArray) -> CrvResult<Vec<f32>>;
}
```

**集成点：** `ruvsense/multistatic.rs` 负责管理 AP 网格拓扑。`MeshTopologyEncoder` 把 `MultistaticArray` 的几何结构转换为 `StageIIIData` 的草图元素与关系，并通过 `StageIIIEncoder` 产出 GNN 编码的拓扑嵌入。

### 2.5 Stage IV：把相干性门控作为 AOL 检测

**CRV 映射：** Stage IV 检测分析性叠加（AOL）-- 即分析心智用既有假设污染原始信号的那些时刻。在 WiFi 感知中，相干性门控（ADR-030/032）承担相同职能：它识别环境干扰、多径变化或硬件伪影何时污染了 CSI 信号，并标记这些帧予以排除。

| CRV AOL 概念 | WiFi 相干性对应量 |
|-----------------|---------------------|
| AOL 事件 | 低相干性帧（干扰、多径偏移、硬件毛刺） |
| AOL 异常分数 | 相干性度量（0.0 表示完全不相干，1.0 表示完全相干） |
| AOL 中断（标记并搁置） | `GateDecision::Reject` 或 `GateDecision::PredictOnly` |
| 干净信号线 | `GateDecision::Accept` 并附带噪声乘子 |
| 超时后强制接受 | `GateDecision::ForcedAccept`（ADR-032）并放大噪声 |

**WiFi 领域类型：**

```rust
pub struct CoherenceAolDetector {
    encoder: StageIVEncoder,
}

impl CoherenceAolDetector {
    /// 把相干性门控决策映射为 CRV AOL 检测。
    ///
    /// SNN 时间编码对相干性违规随时间的
    /// 尖峰模式建模：
    /// - 低相干性帧突发 -> AOL 异常分数偏高
    /// - 持续相干 -> 异常分数偏低（信号干净）
    /// - 单次瞬态 -> 分数中等（检查后继续）
    ///
    /// 返回编码了信号质量时间模式的嵌入，
    /// 使下游阶段能够依据信号洁净程度调整
    /// 其注意力权重。
    pub fn detect(
        &self,
        coherence_history: &[GateDecision],
        timestamps: &[u64],
    ) -> CrvResult<(Vec<AOLDetection>, Vec<f32>)>;
}
```

**集成点：** `ruvsense/coherence_gate.rs` 已经产出 `GateDecision` 值。`CoherenceAolDetector` 把相干性门控的时间流转换为带 `AOLDetection` 事件的 `StageIVData`，再经 `StageIVEncoder` 的 SNN 时间编码生成信号质量随时间的嵌入。

### 2.6 Stage V：通过可微搜索进行姿态探询

**CRV 映射：** Stage V 是探询阶段 -- 用特定查询探测此前各阶段的数据，以提取目标信息。在 WiFi 感知中，这对应以姿态假设查询累积的 CSI 特征历史，寻找支持或反驳它的证据。

**WiFi 领域类型：**

```rust
pub struct PoseInterrogator {
    engine: StageVEngine,
}

impl PoseInterrogator {
    /// 用 CSI 历史对姿态假设做交叉参照。
    ///
    /// 使用可微搜索（带温度缩放的软注意力）
    /// 找出哪些历史 CSI 帧最能支持当前姿态估计，
    /// 或与之相矛盾。
    ///
    /// 返回：
    /// - CSI 历史缓冲区上的注意力权重
    /// - Top-k 支持帧（注意力最高）
    /// - 把姿态关键点关联到此前阶段特定
    ///   CSI 子载波特征的交叉引用
    pub fn interrogate(
        &self,
        pose_embedding: &[f32],
        csi_history: &[CrvSessionEntry],
    ) -> CrvResult<(StageVData, Vec<f32>)>;
}
```

**集成点：** `ruvsense/field_model.rs` 维护持久电磁场模型（ADR-030）。`PoseInterrogator` 为其加上 CRV Stage V 语义封装 -- 场模型的历史成为 `StageVEngine` 检索的语料，姿态假设则成为探查查询。

### 2.7 Stage VI：通过 MinCut 实现多人分区

**CRV 映射：** Stage VI 通过 MinCut 把累积数据聚类为不同的目标分区，从而产出复合三维模型。在 WiFi 感知中，这对应多人分离 -- 把累积的 CSI 嵌入切分为各人专属的簇。

**WiFi 领域类型：**

```rust
pub struct PersonPartitioner {
    modeler: StageVIModeler,
}

impl PersonPartitioner {
    /// 把累积嵌入划分为不同的人员。
    ///
    /// 使用 MinCut（ruvector-mincut）在嵌入空间中
    /// 寻找自然的簇边界。每个分区对应
    /// 一个人，并带有：
    /// - 质心嵌入（人员签名）
    /// - 成员帧索引（哪些 CSI 帧属于此人）
    /// - 分离强度（此人与他人的区分程度）
    ///
    /// 分区之间的 MinCut 值可作为人员分离质量的
    /// 置信度指标。
    pub fn partition(
        &self,
        person_embeddings: &[CrvSessionEntry],
    ) -> CrvResult<(StageVIData, Vec<f32>)>;
}
```

**集成点：** `wifi-densepose-train` 中的训练流水线已在使用 `ruvector-mincut` 实现 `DynamicPersonMatcher`（ADR-016）。`PersonPartitioner` 为其加上 CRV Stage VI 语义封装，把人员分离表述为复合模型构建。

### 2.8 跨会话收敛：多房间身份匹配

**CRV 映射：** CRV 收敛分析比较针对同一坐标的独立会话所产生的嵌入，以寻找一致性。在 WiFi-DensePose 中，不同房间的独立 AP 簇就是同一个人的独立「观察者」。

**WiFi 领域类型：**

```rust
pub struct MultiViewerConvergence {
    session_manager: CrvSessionManager,
}

impl MultiViewerConvergence {
    /// 通过 CRV 收敛在房间之间匹配人员身份。
    ///
    /// 每个房间的 AP 簇被建模为独立的 CRV 会话。
    /// 当一个人从房间 A 移动到房间 B 时：
    /// 1. 房间 A 会话包含此人的嵌入轨迹（Stages I-VI）
    /// 2. 房间 B 会话开始累积新的嵌入
    /// 3. 收敛分析在房间 A 的最终嵌入与房间 B 的
    ///    初始嵌入之间寻找一致性
    /// 4. 一致性分数超过阈值即确立身份连续性
    ///
    /// 返回 ConvergenceResult，其中包含：
    /// - 已收敛的会话对（房间对）
    /// - 每对会话的相似度分数
    /// - 收敛阶段（哪些 CRV 阶段一致性最强）
    /// - 共识嵌入（合并后的身份签名）
    pub fn match_across_rooms(
        &self,
        room_sessions: &[(RoomId, SessionId)],
        threshold: f32,
    ) -> CrvResult<ConvergenceResult>;
}
```

**集成点：** `ruvsense/cross_room.rs` 已负责跨房间身份连续性（ADR-030）。`MultiViewerConvergence` 为现有 `CrossRoomTracker` 加上 CRV 收敛语义封装，使用 `CrvSessionManager::find_convergence()` 计算嵌入一致性。

### 2.9 WifiCrvSession：统一流水线封装

顶层封装把全部六个阶段串联成一条流水线：

```rust
/// 建模为 CRV 会话的 WiFi-DensePose 感知会话。
///
/// 用 CSI 专用的便捷方法封装 CrvSessionManager。
/// 每次调用 process_frame() 都会推进全部六个 CRV 阶段，
/// 并把各阶段嵌入追加到会话中。
pub struct WifiCrvSession {
    session_manager: CrvSessionManager,
    gestalt: CsiGestaltClassifier,
    sensory: CsiSensoryEncoder,
    topology: MeshTopologyEncoder,
    coherence: CoherenceAolDetector,
    interrogator: PoseInterrogator,
    partitioner: PersonPartitioner,
    convergence: MultiViewerConvergence,
}

impl WifiCrvSession {
    /// 按给定配置创建新的 WiFi CRV 会话。
    pub fn new(config: WifiCrvConfig) -> Self;

    /// 让单个 CSI 帧流经全部六个 CRV 阶段。
    ///
    /// 返回各阶段嵌入与最终的人员分区。
    pub fn process_frame(
        &mut self,
        frame: &CsiFrame,
        mesh: &MultistaticArray,
        coherence_state: &GateDecision,
        pose_hypothesis: Option<&[f32]>,
    ) -> CrvResult<WifiCrvOutput>;

    /// 在房间会话之间寻找收敛以匹配身份。
    pub fn find_convergence(
        &self,
        room_sessions: &[(RoomId, SessionId)],
        threshold: f32,
    ) -> CrvResult<ConvergenceResult>;
}
```

---

## 3. 实施计划（文件级）

### 3.1 阶段 1：CRV 模块核心（新增文件）

| 文件 | 用途 | 上游依赖 |
|------|---------|-------------------|
| `crates/wifi-densepose-ruvector/src/crv/mod.rs` | 模块根，重新导出所有 CRV-Sense 类型 | -- |
| `crates/wifi-densepose-ruvector/src/crv/config.rs` | `WifiCrvConfig` 扩展 `CrvConfig`，加入 WiFi 专用默认值（为匹配 AETHER 采用 128 维而非 384 维） | `ruvector-crv` |
| `crates/wifi-densepose-ruvector/src/crv/session.rs` | 封装 `CrvSessionManager` 的 `WifiCrvSession` | `ruvector-crv` |
| `crates/wifi-densepose-ruvector/src/crv/output.rs` | `WifiCrvOutput` 结构，含各阶段嵌入与诊断信息 | -- |

### 3.2 阶段 2：各阶段编码器（新增文件）

| 文件 | 用途 | 上游依赖 |
|------|---------|-------------------|
| `crates/wifi-densepose-ruvector/src/crv/gestalt.rs` | `CsiGestaltClassifier` -- Stage I 的 Poincare 球嵌入 | `ruvector-crv::StageIEncoder` |
| `crates/wifi-densepose-ruvector/src/crv/sensory.rs` | `CsiSensoryEncoder` -- Stage II 的多头注意力 | `ruvector-crv::StageIIEncoder`、`ruvector-attention` |
| `crates/wifi-densepose-ruvector/src/crv/topology.rs` | `MeshTopologyEncoder` -- Stage III 的 GNN 拓扑 | `ruvector-crv::StageIIIEncoder`、`ruvector-gnn` |
| `crates/wifi-densepose-ruvector/src/crv/coherence.rs` | `CoherenceAolDetector` -- Stage IV 的 SNN 时间编码 | `ruvector-crv::StageIVEncoder` |
| `crates/wifi-densepose-ruvector/src/crv/interrogation.rs` | `PoseInterrogator` -- Stage V 的可微搜索 | `ruvector-crv::StageVEngine` |
| `crates/wifi-densepose-ruvector/src/crv/partition.rs` | `PersonPartitioner` -- Stage VI 的 MinCut 分区 | `ruvector-crv::StageVIModeler`、`ruvector-mincut` |

### 3.3 阶段 3：跨会话收敛

| 文件 | 用途 | 上游依赖 |
|------|---------|-------------------|
| `crates/wifi-densepose-ruvector/src/crv/convergence.rs` | `MultiViewerConvergence` -- 跨房间身份匹配 | `ruvector-crv::CrvSessionManager` |

### 3.4 阶段 4：与现有模块集成（修改现有文件）

| 文件 | 改动 | 说明 |
|------|--------|-------|
| `crates/wifi-densepose-ruvector/src/lib.rs` | 新增 `pub mod crv;` | 暴露新模块 |
| `crates/wifi-densepose-ruvector/Cargo.toml` | 无需改动 | `ruvector-crv` 依赖已存在 |
| `crates/wifi-densepose-signal/src/ruvsense/multiband.rs` | 为 `CrvGestaltSource` 新增 trait 实现 | 使整体形态分类器能够消费多频段输出 |
| `crates/wifi-densepose-signal/src/ruvsense/phase_align.rs` | 为 `CrvSensorySource` 新增 trait 实现 | 使感官编码器能够消费相位特征 |
| `crates/wifi-densepose-signal/src/ruvsense/coherence_gate.rs` | 新增方法，把 `GateDecision` 历史导出为 `Vec<AOLDetection>` | 把相干性门控桥接到 CRV Stage IV |
| `crates/wifi-densepose-signal/src/ruvsense/cross_room.rs` | 新增 `CrvConvergenceAdapter` trait 实现 | 把跨房间跟踪器桥接到 CRV 收敛 |

---

## 4. DDD 设计

### 4.1 新的限界上下文：CrvSensing

**聚合根：`WifiCrvSession`**

```rust
pub struct WifiCrvSession {
    /// 底层 CRV 会话管理器
    session_manager: CrvSessionManager,
    /// 各阶段编码器
    stages: CrvStageEncoders,
    /// 会话配置
    config: WifiCrvConfig,
    /// 收敛质量的运行时统计
    convergence_stats: ConvergenceStats,
}
```

**值对象：**

```rust
/// 单帧流经六阶段流水线的输出。
pub struct WifiCrvOutput {
    /// 各阶段嵌入（6 个向量，每个 CRV 阶段一个）。
    pub stage_embeddings: [Vec<f32>; 6],
    /// 此帧的整体形态分类结果。
    pub gestalt: GestaltType,
    /// AOL 检测（被标记为受噪声污染的帧）。
    pub aol_events: Vec<AOLDetection>,
    /// Stage VI 产出的人员分区。
    pub partitions: Vec<TargetPartition>,
    /// 各阶段处理时延，单位为微秒。
    pub stage_latencies_us: [u64; 6],
}

/// 扩展 CrvConfig 的 WiFi 专用 CRV 配置。
pub struct WifiCrvConfig {
    /// 基础 CRV 配置（维度、曲率、阈值）。
    pub crv: CrvConfig,
    /// AETHER 嵌入维度（默认 128，覆盖 CrvConfig.dimensions）。
    pub aether_dim: usize,
    /// AOL 检测的相干性阈值（对应 aol_threshold）。
    pub coherence_threshold: f32,
    /// Stage V 探询可使用的最大 CSI 历史帧数。
    pub max_history_frames: usize,
    /// 跨房间收敛阈值（默认 0.75）。
    pub convergence_threshold: f32,
}
```

**领域事件：**

```rust
pub enum CrvSensingEvent {
    /// Stage I 完成：已判定整体形态
    GestaltClassified { gestalt: GestaltType, confidence: f32 },
    /// Stage IV：检测到 AOL（噪声污染）
    AolDetected { anomaly_score: f32, flagged: bool },
    /// Stage VI：已完成人员分区
    PersonsPartitioned { count: usize, min_separation: f32 },
    /// 跨会话：跨房间身份匹配成功
    IdentityConverged { room_pair: (RoomId, RoomId), score: f32 },
    /// 单帧的完整流水线处理结束
    FrameProcessed { latency_us: u64, stages_completed: u8 },
}
```

### 4.2 与现有限界上下文的集成

**信号（wifi-densepose-signal）：** 新增 trait `CrvGestaltSource` 与 `CrvSensorySource`，使 CRV 模块无需紧耦合即可消费信号处理输出。signal crate 不依赖 CRV crate -- 依赖方向仅单向流动。

**训练（wifi-densepose-train）：** `PersonPartitioner`（Stage VI）产出的 MinCut 分区与现有 `DynamicPersonMatcher` 相同。共享 trait `PersonSeparator` 使两者可以互换使用。

**硬件（wifi-densepose-hardware）：** 无需改动。CRV 模块消费的是已由硬件层接收并解析完成的 CSI 帧。

---

## 5. RuVector 集成图

CRV-Sense 集成所涉及的七个 `ruvector` crate：

| CRV 阶段 | ruvector crate | 使用的 API | WiFi-DensePose 中的角色 |
|-----------|---------------|----------|-------------------|
| I（整体形态） | --（内部 Poincare 数学） | `StageIEncoder::encode()` | CSI 整体形态分类体系的双曲嵌入 |
| II（感官） | `ruvector-attention` | `StageIIEncoder::encode()` | 子载波特征上的多头注意力 |
| III（维度） | `ruvector-gnn` | `StageIIIEncoder::encode()` | AP 网格拓扑的 GNN 编码 |
| IV（AOL） | --（内部 SNN） | `StageIVEncoder::encode()` | 相干性违规的 SNN 时间编码 |
| V（探询） | --（内部软注意力） | `StageVEngine::search()` | 场模型历史上的可微搜索 |
| VI（复合） | `ruvector-mincut` | `StageVIModeler::partition()` | MinCut 人员分离 |
| 收敛 | --（余弦相似度） | `CrvSessionManager::find_convergence()` | 跨房间身份匹配 |

此外，CRV 模块还受益于工作区中已有的 ruvector 集成：

| 现有集成 | ADR | 对 CRV 阶段的助益 |
|---------------------|-----|-------------------|
| `spectrogram.rs` 中的 `ruvector-attn-mincut` | ADR-016 | Stage II（用于感官特征的子载波注意力） |
| `dataset.rs` 中的 `ruvector-temporal-tensor` | ADR-016 | Stage IV（压缩的相干性历史缓冲区） |
| `subcarrier.rs` 中的 `ruvector-solver` | ADR-016 | Stage III（网格拓扑的稀疏插值） |
| `model.rs` 中的 `ruvector-attention` | ADR-016 | Stage V（姿态探询的空间注意力） |
| `metrics.rs` 中的 `ruvector-mincut` | ADR-016 | Stage VI（人员匹配基线） |

---

## 6. 验收标准

### 6.1 Stage I：CSI 整体形态分类

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S1-1 | `CsiGestaltClassifier::classify()` 对任意格式正确的 CSI 帧返回有效的 `GestaltType` | 单元测试：输入 100 帧合成 CSI 帧，验证全部返回六种整体形态类型之一 |
| S1-2 | Poincare 球嵌入维度正确（与 `WifiCrvConfig.aether_dim` 一致） | 单元测试：验证 `embedding.len() == config.aether_dim` |
| S1-3 | 嵌入范数严格小于 1.0（Poincare 球约束） | 单元测试：验证所有输出的 L2 范数 < 1.0 |
| S1-4 | 带多普勒特征的 CSI 帧被判定为 Movement 整体形态 | 单元测试：合成多普勒频移 CSI -> `GestaltType::Movement` |
| S1-5 | 带瞬态干扰的 CSI 帧被判定为 Energy 整体形态 | 单元测试：合成干扰突发 -> `GestaltType::Energy` |

### 6.2 Stage II：CSI 感官特征

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S2-1 | `CsiSensoryEncoder::encode()` 产出维度正确的嵌入 | 单元测试：验证输出长度 |
| S2-2 | 幅度方差映射到 `StageIIData.impressions` 中的 Texture 模态 | 单元测试：验证非平坦幅度下存在 Texture 条目 |
| S2-3 | 相位漂移速率映射到 Temperature 模态 | 单元测试：注入线性相位漂移，验证存在 Temperature 条目 |
| S2-4 | 每个注意力头的多头注意力权重之和为 1.0 | 单元测试：验证 softmax 归一化 |

### 6.3 Stage III：AP 网格拓扑

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S3-1 | `MeshTopologyEncoder::encode()` 为每个 AP 节点产出一个 `SketchElement` | 单元测试：4 节点网格产出 4 个草图元素 |
| S3-2 | `SpatialRelationship` 数量等于双基地链路数 | 单元测试：4 个节点 -> 6 条链路（全连接）或配置的子集 |
| S3-3 | 关系强度与链路 SNR 成正比 | 单元测试：验证 SNR 与强度之间单调相关 |
| S3-4 | 节点位置变化时 GNN 嵌入随之变化 | 单元测试：扰动一个节点的位置，验证嵌入发生变化 |

### 6.4 Stage IV：相干性 AOL 检测

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S4-1 | `CoherenceAolDetector::detect()` 把低相干性帧标记为 AOL 事件 | 单元测试：注入 10 帧 `GateDecision::Reject`，验证产生 10 条 `AOLDetection` 记录 |
| S4-2 | 异常分数与相干性违规突发的持续长度相关 | 单元测试：5 次连续违规的得分高于单次孤立违规 |
| S4-3 | `GateDecision::Accept` 帧不产生 AOL 检测 | 单元测试：全接受历史产生空的 AOL 列表 |
| S4-4 | SNN 时间编码遵循不应期 | 单元测试：`refractory_period_ms` 内的两次违规只产生单个尖峰 |
| S4-5 | `GateDecision::ForcedAccept`（ADR-032）映射为中等分数的 AOL | 单元测试：强制接受帧被标记，但异常分数不取最大值 |

### 6.5 Stage V：姿态探询

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S5-1 | `PoseInterrogator::interrogate()` 返回 CSI 历史上的注意力权重 | 单元测试：50 帧历史产生 50 个注意力权重，其和为 1.0 |
| S5-2 | Top-k 候选是注意力最高的帧 | 单元测试：验证 `top_candidates` 索引对应最高的 `attention_weights` |
| S5-3 | 交叉引用关联到正确的阶段编号 | 单元测试：验证 `from_stage` 与 `to_stage` 落在 [1..6] 内 |
| S5-4 | 空历史返回空探查结果 | 单元测试：空 `csi_history` 产生零个候选 |

### 6.6 Stage VI：人员分区

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| S6-1 | `PersonPartitioner::partition()` 把两个分离良好的嵌入簇分成两个分区 | 单元测试：两个间距 > 5 sigma 的高斯簇 -> 两个分区 |
| S6-2 | 每个分区都有维度正确的质心嵌入 | 单元测试：验证质心长度与配置一致 |
| S6-3 | 不同人员的 `separation_strength`（MinCut 值）为正 | 单元测试：验证 separation_strength > 0.0 |
| S6-4 | 单人场景恰好产生一个分区 | 单元测试：单簇 -> 一个分区 |
| S6-5 | 分区的 `member_entries` 索引互不重叠且完整覆盖 | 单元测试：所有成员条目的并集覆盖全部输入帧 |

### 6.7 跨会话收敛

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| C-1 | `MultiViewerConvergence::match_across_rooms()` 对同一人出现在两个房间返回正分数 | 单元测试：把相同嵌入轨迹注入两个房间会话，验证分数 > 阈值 |
| C-2 | 不同房间中的不同人员得分低于阈值 | 单元测试：注入不同的嵌入轨迹，验证分数 < 阈值 |
| C-3 | `convergent_stages` 找出跨房间一致性最高的阶段 | 单元测试：令 Stage I 嵌入相同、其余随机，验证 Stage I 出现在 convergent_stages 中 |
| C-4 | 收敛成功时 `consensus_embedding` 维度正确 | 单元测试：在成功匹配时验证共识嵌入长度 |
| C-5 | 阈值参数生效（低于阈值不匹配） | 单元测试：把阈值设为 0.99，验证只有近乎完全相同的会话才匹配 |

### 6.8 端到端流水线

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| E-1 | `WifiCrvSession::process_frame()` 返回的 `WifiCrvOutput` 含全部 6 个阶段嵌入 | 集成测试：处理 10 帧合成帧，验证每帧有 6 个非空嵌入 |
| E-2 | x86 主机上每帧总流水线时延 < 5 ms | 基准测试：处理 1000 帧，验证 p95 时延 < 5 ms |
| E-3 | 缺少姿态假设时流水线优雅降级（跳过 Stage V 或使用默认值） | 单元测试：为 pose_hypothesis 传入 `None`，验证不 panic 且输出有效 |
| E-4 | 空网格（单个 AP）不导致 panic | 单元测试：单节点网格产出有效输出，Stage III 退化处理 |
| E-5 | 会话状态跨帧累积（Stage V 历史增长） | 单元测试：处理 50 帧，验证 Stage V 候选数增加 |

---

## 7. 影响

### 7.1 正面

- **流水线结构化定型**：六阶段 CRV 映射为 WiFi 感知流水线提供了有章可循的渐进求精结构，使数据流显式化，且每个阶段都可独立测试。
- **无需摄像头的跨房间身份**：CRV 收敛分析为跨房间 AP 簇之间的人员身份匹配提供了有数学依据的机制，仅使用 RF 嵌入即可完成。
- **噪声分离成为一等概念**：把相干性门控映射到 CRV Stage IV（AOL 检测），使噪声分离从实现细节上升为拥有独立嵌入与时间模型的核心架构阶段。
- **用双曲嵌入表达整体形态层级**：Stage I 的 Poincare 球嵌入刻画了层级化的 RF 环境分类体系（Manmade > 结构性多径，Natural > 漫散射等），相比欧氏空间失真呈指数级降低。
- **复用 ruvector 生态**：七个 ruvector crate 全部通过一层统一抽象被使用，最大化既有 ruvector 集成（ADR-016）的回报。
- **不引入新的外部依赖**：`ruvector-crv` 已是 `wifi-densepose-ruvector/Cargo.toml` 中的工作区依赖。本 ADR 只新增 Rust 源文件。

### 7.2 负面

- **抽象开销**：CRV 阶段映射在现有信号处理流水线之上增加了一层间接调用。每个阶段封装都要在 WiFi 领域类型与 CRV 类型之间做转换；若映射最终被证明并不贴合，这些代码会成为维护负担。
- **维度不匹配**：`ruvector-crv` 默认 384 维，而 AETHER 嵌入（ADR-024）使用 128 维。`WifiCrvConfig` 会覆盖该默认值，但编码器在非默认维度下的行为必须验证。
- **SNN 开销**：Stage IV 的 SNN 时间编码器为尖峰序列仿真增加了逐帧计算。在嵌入式目标（ESP32）上这可能超出 50 ms 的帧预算。初期部署仅限主机侧（聚合器，而非固件）。
- **收敛误报**：通过嵌入相似度做跨房间身份匹配，可能对体型与运动模式相近、且所在房间几何相似的人员产生错误匹配。需要 ADR-030 的时间邻近约束来限制误报率。
- **测试复杂度**：六个各自带独立编码器的阶段，加上跨会话收敛层，需要一套完整的测试矩阵。第 6 节的验收标准定义了 30 余个独立测试用例。

### 7.3 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| Poincare 球嵌入在边界处不稳定（范数趋近 1.0） | Medium | NaN 沿流水线传播 | 在 `CsiGestaltClassifier` 中把范数钳制到 0.95；在测试套件中加入范数断言 |
| GNN 编码器过慢，无法实时更新网格拓扑 | Low | Stage III 成为瓶颈 | 缓存拓扑嵌入；仅在节点几何变化时重算（较少发生） |
| SNN 不应期对于 20 Hz 相干性门控过短 | Medium | 帧边界处出现错误 AOL 检测 | 把 `refractory_period_ms` 调整为与帧间隔（50 ms）一致，写入 `WifiCrvConfig` 默认值 |
| 跨房间收敛阈值过于宽松 | Medium | 出现跨房间错误身份匹配 | 默认阈值 0.75 偏保守；ADR-030 的时间邻近约束（<60s）提供第二道防线 |
| MinCut 分区产出的人员簇过多或过少 | Medium | 人员数量不匹配 | 使用来自占用检测器的预期人数提示作为 MinCut 约束 |
| 若映射被证明不贴合，CRV 抽象会变成技术债 | Low | 未来 ADR 中删除相关代码 | 所有 CRV 代码集中在独立的 `crv` 模块中；删除时不影响现有流水线 |

---

## 8. 相关 ADR

| ADR | 关系 |
|-----|-------------|
| ADR-016（RuVector 集成） | **扩展**：原有 5 个 ruvector crate 以及 `ruvector-crv`、`ruvector-gnn` 现在都通过 CRV 流水线被使用 |
| ADR-017（RuVector Signal+MAT） | **扩展**：ADR-017 的信号处理输出进入 CRV Stages I-II |
| ADR-024（AETHER 嵌入） | **消费**：逐视点的 AETHER 128 维嵌入是送入 CRV 各阶段的表示 |
| ADR-029（RuvSense 多基地） | **扩展**：多基地网格拓扑编码为 CRV Stage III；TDM 帧是 Stage I 的输入 |
| ADR-030（持久场模型） | **扩展**：场模型历史充当 Stage V 的探询语料；跨房间跟踪器桥接到 CRV 收敛 |
| ADR-031（RuView 视点融合） | **互补**：RuView 在房间内融合视点，CRV 收敛在房间之间匹配身份 |
| ADR-032（网格安全） | **消费**：经认证的信标与帧完整性（ADR-032）确保 CRV Stage IV 的 AOL 检测反映真实信号质量，而非伪造帧 |

---

## 9. 参考资料

1. Swann, I.（1996 年）。"Remote Viewing: The Real Story." 自出版手稿。（CRV 协议原始文档。）
2. Smith, P. H.（2005 年）。"Reading the Enemy's Mind: Inside Star Gate, America's Psychic Espionage Program." Tom Doherty Associates 出版。
3. Nickel, M. & Kiela, D.（2017 年）。"Poincare Embeddings for Learning Hierarchical Representations." NeurIPS 2017 会议论文。
4. Kipf, T. N. & Welling, M.（2017 年）。"Semi-Supervised Classification with Graph Convolutional Networks." ICLR 2017 会议论文。
5. Maass, W.（1997 年）。"Networks of Spiking Neurons: The Third Generation of Neural Network Models." Neural Networks 期刊，10(9):1659-1671。
6. Stoer, M. & Wagner, F.（1997 年）。"A Simple Min-Cut Algorithm." Journal of the ACM 期刊，44(4):585-591。
7. `ruvector-crv` v0.1.1 版 crate。https://crates.io/crates/ruvector-crv
8. `ruvector-attention` v2.0 版 crate。https://crates.io/crates/ruvector-attention
9. `ruvector-gnn` v2.0.1 版 crate。https://crates.io/crates/ruvector-gnn
10. `ruvector-mincut` v2.0.1 版 crate。https://crates.io/crates/ruvector-mincut
11. Geng, J. 等（2023 年）。"DensePose From WiFi." arXiv:2301.00250。
12. ADR-016 至 ADR-032（内部文档）。
