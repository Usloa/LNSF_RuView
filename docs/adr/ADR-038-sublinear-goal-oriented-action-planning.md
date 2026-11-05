# ADR-038：面向项目路线图优化的次线性目标导向动作规划（GOAP）

| 字段 | 值 |
|-------|-------|
| **状态** | Proposed |
| **日期** | 2026-03-02 |
| **决策者** | ruv |
| **关联** | 此前 37 份 ADR；ADR-014（SOTA 信号处理）、ADR-016（RuVector 集成）、ADR-024（AETHER 嵌入）、ADR-027（MERIDIAN 泛化）、ADR-029（RuvSense 多基地）、ADR-037（多人检测） |

---

## 1. 背景

### 1.1 规划问题

WiFi-DensePose 共有 37 份架构决策记录。其中 14 份 Accepted/Complete、4 份 Partially Implemented、19 份 Proposed、1 份 Superseded。拟议中的 ADR 覆盖多种能力：生命体征检测（ADR-021）、多 BSSID 扫描（ADR-022）、对比嵌入（ADR-024）、跨环境泛化（ADR-027）、多基地组网感知（ADR-029）、持久化场模型（ADR-030）、多人姿态检测（ADR-037）等。

单个开发者（或由 AI agent 辅助的小团队）必须在以下条件下决定**下一步做什么**：

- **密集的依赖图**：ADR-037（多人）依赖 ADR-014（信号处理）、ADR-024（AETHER）与 ADR-029（多基地）。ADR-029 依赖 ADR-012（ESP32 组网）、ADR-014、ADR-016 和 ADR-018。许多 ADR 共用前置条件。
- **硬件可变性**：有些 ADR 需要 ESP32 硬件（ADR-021 生命体征、ADR-029 多基地组网），另一些纯软件即可（ADR-024 AETHER、ADR-027 MERIDIAN）。可用硬件每次会话都可能不同。
- **目标漂移**：这次会话用户想提升准确率，下次想支持多人，再下次又想做 WebAssembly 部署。
- **资源约束**：算力预算有限、单人开发吞吐量有限、CI 流水线容量有限。

人工在这个决策空间里导航很容易出错：开发者必须把整张依赖图记在脑子里，目标一变就要重新评估优先级，还要避开会因为硬件不可用而卡死的死胡同计划。

### 1.2 为什么选 GOAP

目标导向动作规划（GOAP）最初由 Jeff Orkin（2003 年）为游戏 AI 提出，它把世界建模为一组布尔/数值状态属性，并用带类型的前置条件与效果定义动作。规划器从当前世界状态搜索到目标状态，产出最优动作序列。GOAP 天然适合这个问题，因为：

1. **ADR 的实现就是动作**，有清晰的前置条件（必须先有哪些 ADR/硬件）和效果（解锁哪些能力）。
2. **世界状态可观测** —— 可以查询 cargo test 结果、检查硬件连接、读取 crate 清单、测量准确率指标。
3. **目标是声明式的** —— 「我想要 20 Hz 的多人跟踪」可直接翻译成 `{multi_person_tracking: true, update_rate_hz: 20}`。
4. **重规划成本很低** —— 硬件到位或用户改目标时，规划器在毫秒级内重跑一次。

### 1.3 为什么要求次线性

朴素的 GOAP 规划器在完整的「动作-状态」图上做 A* 搜索。37 份 ADR 每份可能有多个阶段（ADR-037 有 4 个阶段，ADR-029 有 9 个动作），原始动作数超过 80。N 个布尔属性的完整状态空间是 `2^N`。穷举搜索之所以浪费，是因为：

- 大多数动作与任一给定目标无关（想做生命体征的用户，搜索里不需要 WebAssembly 部署动作）。
- 依赖图是稀疏的 —— 多数动作只依赖 1-3 个前置条件，而不是所有其它动作。
- 许多状态属性彼此独立（生命体征检测与 WebAssembly 编译不相互作用）。

次线性方法正是利用这种稀疏性，避免遍历整个状态空间。

---

## 2. 决策

在 claude-flow swarm 框架内实现一个 GOAP 规划系统，作为协调器模块。规划器以用户目标、当前项目状态和可用硬件为输入，产出有序动作计划，再分派给专用 agent 执行。

### 2.1 世界状态模型

世界状态是一张扁平的带类型属性表，表示项目当前具备的能力。

#### 2.1.1 功能实现标志（布尔）

| 属性 | 判定依据 | 说明 |
|----------|----------------|-------------|
| `sota_signal_processing` | `cargo test -p wifi-densepose-signal` 通过 | ADR-014 SOTA 算法已实现 |
| `ruvector_training_integrated` | `train/` crate 带 ruvector 依赖可构建 | ADR-016 RuVector 训练流水线 |
| `ruvector_signal_integrated` | `signal/src/ruvsense/` 模块存在 | ADR-017 RuVector 信号集成 |
| `esp32_firmware_base` | `firmware/esp32-csi-node/` 可编译 | ADR-018 ESP32 基础固件 |
| `esp32_channel_hopping` | 固件支持多信道 | ADR-029 阶段 1 |
| `multi_band_fusion` | `ruvsense/multiband.rs` 测试通过 | ADR-029 阶段 2 |
| `multistatic_mesh` | 多节点融合可用 | ADR-029 阶段 3 |
| `coherence_gating` | `ruvsense/coherence_gate.rs` 测试通过 | ADR-029 阶段 6-7 |
| `pose_tracker_17kp` | `ruvsense/pose_tracker.rs` 测试通过 | ADR-029 阶段 4 |
| `vital_signs_extraction` | `vitals/` crate 测试通过 | ADR-021 |
| `vital_signs_esp32_validated` | ESP32 呼吸检测已验证 | ADR-021 阶段 2 |
| `multi_bssid_scan` | `wifiscan/` crate 测试通过 | ADR-022 阶段 1 |
| `multi_bssid_concurrent` | 并发 BSSID 扫描可用 | ADR-022 阶段 2 |
| `aether_embeddings` | 对比 CSI 编码器已训练 | ADR-024 |
| `aether_reid` | 基于嵌入的人员重识别可用 | ADR-024 阶段 3 |
| `meridian_generalization` | 跨环境迁移可用 | ADR-027 |
| `persistent_field_model` | 场模型可序列化/反序列化 | ADR-030 |
| `person_count_estimation` | 特征值人数估计器可用 | ADR-037 阶段 1 |
| `signal_decomposition` | NMF 逐人分离可用 | ADR-037 阶段 2 |
| `multi_skeleton_generation` | 每帧可生成多个骨架 | ADR-037 阶段 3 |
| `multi_person_neural` | 多人神经网络模型可用 | ADR-037 阶段 4 |
| `wasm_deployment` | WebAssembly 构建可用 | ADR-025 |
| `mat_survivor_detection` | MAT 灾害检测可用 | ADR-011/ADR-026 |
| `ruview_sensing_ui` | 感知优先 RF UI 模式 | ADR-031 |
| `mesh_security_hardened` | 多基地组网安全层 | ADR-032 |

#### 2.1.2 硬件可用标志（布尔）

| 属性 | 检测方法 | 说明 |
|----------|-----------------|-------------|
| `esp32_connected` | USB 串口探测（`/dev/ttyUSB*` 或 `COM*`） | USB 上至少有一个 ESP32 |
| `esp32_count` | 统计带 ESP32 VID/PID 的 USB 串口设备 | ESP32 节点数量 |
| `esp32_multistatic_ready` | `esp32_count >= 2` | 满足多基地条件 |
| `gpu_available` | `nvidia-smi` 或 CUDA 探测 | 神经网络训练所需 GPU |
| `wifi_adapter_present` | 操作系统 WiFi 接口枚举 | 多 BSSID 所需的主机 WiFi |

#### 2.1.3 质量指标（数值）

| 属性 | 来源 | 说明 |
|----------|--------|-------------|
| `pose_accuracy_pck02` | 基准测试套件输出 | PCK@0.2 准确率（0.0-1.0） |
| `update_rate_hz` | 流水线计时测量 | 有效输出帧率 |
| `max_persons_tracked` | 多人测试结果 | 可同时跟踪的最大人数 |
| `breathing_snr_db` | 生命体征测试输出 | 呼吸检测 SNR |
| `torso_jitter_mm` | 跟踪基准测试 | 躯干关键点 RMS 抖动 |
| `rust_test_count` | `cargo test --workspace` 输出 | 通过的 Rust 测试总数 |

### 2.2 动作定义

每个动作对应一个 ADR 实施阶段。动作用结构体定义，包含前置条件、效果、成本与元数据。

```rust
pub struct GoapAction {
    /// 唯一标识符（例如 "adr029_phase1_channel_hopping"）
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 关联的 ADR（例如 "ADR-029"）
    pub adr: String,
    /// ADR 内的阶段（例如 "Phase 1"）
    pub phase: Option<String>,
    /// 前置条件：必须为 true 或达到阈值的状态属性
    pub preconditions: Vec<Condition>,
    /// 效果：执行成功后设置的状态属性
    pub effects: Vec<Effect>,
    /// 估算工作量（开发者·天）
    pub cost_days: f32,
    /// 该动作是否需要硬件
    pub requires_hardware: Vec<String>,
    /// 执行该动作所需的 agent 类型
    pub agent_types: Vec<String>,
    /// 受影响的 crate/文件
    pub affected_components: Vec<String>,
}

pub enum Condition {
    BoolTrue(String),          // property must be true
    BoolFalse(String),         // property must be false
    NumericGte(String, f64),   // property >= threshold
    NumericLte(String, f64),   // property <= threshold
}

pub enum Effect {
    SetBool(String, bool),     // set boolean property
    SetNumeric(String, f64),   // set numeric property
    IncrementNumeric(String, f64), // add to numeric property
}
```

#### 2.2.1 动作目录（关键 ADR 动作）

| 动作 ID | ADR | 成本（天） | 前置条件 | 效果 | 硬件 |
|-----------|-----|-------------|---------------|---------|----------|
| `adr037_p1_person_count` | 037 | 3 | `sota_signal_processing` | `person_count_estimation = true` | None |
| `adr037_p2_nmf_decomp` | 037 | 5 | `person_count_estimation` | `signal_decomposition = true` | None |
| `adr037_p3_multi_skel` | 037 | 4 | `signal_decomposition`, `pose_tracker_17kp` | `multi_skeleton_generation = true`, `max_persons_tracked += 2` | None |
| `adr037_p4_neural_multi` | 037 | 10 | `signal_decomposition`, `aether_embeddings`, `gpu_available` | `multi_person_neural = true`, `pose_accuracy_pck02 = 0.6` | GPU |
| `adr021_vital_core` | 021 | 3 | `sota_signal_processing` | `vital_signs_extraction = true` | None |
| `adr021_vital_esp32` | 021 | 5 | `vital_signs_extraction`, `esp32_connected` | `vital_signs_esp32_validated = true`, `breathing_snr_db = 10.0` | ESP32 |
| `adr030_persist_field` | 030 | 2 | `ruvector_signal_integrated` | `persistent_field_model = true` | None |
| `adr022_p2_concurrent` | 022 | 4 | `multi_bssid_scan`, `wifi_adapter_present` | `multi_bssid_concurrent = true` | WiFi adapter |
| `adr029_p1_ch_hop` | 029 | 5 | `esp32_firmware_base`, `esp32_connected` | `esp32_channel_hopping = true` | ESP32 |
| `adr029_p2_multiband` | 029 | 5 | `esp32_channel_hopping` | `multi_band_fusion = true` | ESP32 |
| `adr029_p3_multistatic` | 029 | 5 | `multi_band_fusion`, `esp32_multistatic_ready` | `multistatic_mesh = true` | 2+ ESP32 |
| `adr029_p67_coherence` | 029 | 3 | `multi_band_fusion` | `coherence_gating = true` | None |
| `adr029_p4_tracker` | 029 | 3 | `multistatic_mesh`, `coherence_gating` | `pose_tracker_17kp = true`, `torso_jitter_mm = 30.0` | None |
| `adr024_aether_train` | 024 | 8 | `sota_signal_processing`, `gpu_available` | `aether_embeddings = true` | GPU |
| `adr024_aether_reid` | 024 | 4 | `aether_embeddings`, `pose_tracker_17kp` | `aether_reid = true` | None |
| `adr027_meridian` | 027 | 10 | `aether_embeddings`, `gpu_available` | `meridian_generalization = true` | GPU |
| `adr025_wasm` | 025 | 5 | `sota_signal_processing` | `wasm_deployment = true` | None |
| `adr011_mat` | 011 | 8 | `vital_signs_extraction`, `person_count_estimation` | `mat_survivor_detection = true` | None |
| `adr031_ruview` | 031 | 4 | `persistent_field_model`, `coherence_gating` | `ruview_sensing_ui = true` | None |
| `adr032_mesh_security` | 032 | 5 | `multistatic_mesh` | `mesh_security_hardened = true` | None |

### 2.3 目标规格

目标表示为部分世界状态 —— 一组必须被满足的条件。

```rust
pub struct Goal {
    /// 人类可读描述
    pub description: String,
    /// 定义成功的条件
    pub conditions: Vec<Condition>,
    /// 优先级权重（数值越高，竞争时越重要）
    pub priority: f32,
}
```

**预定义目标模板：**

| 目标 | 条件 | 典型计划长度 |
|------|-----------|---------------------|
| 多人跟踪 | `multi_skeleton_generation = true`、`max_persons_tracked >= 3` | 4-6 个动作 |
| 生命体征监测 | `vital_signs_esp32_validated = true`、`breathing_snr_db >= 10` | 2-3 个动作 |
| 生产级准确率 | `pose_accuracy_pck02 >= 0.6`、`torso_jitter_mm <= 30` | 5-8 个动作 |
| 浏览器部署 | `wasm_deployment = true` | 1-2 个动作 |
| 灾害响应（MAT） | `mat_survivor_detection = true`、`multi_skeleton_generation = true` | 5-7 个动作 |
| 完整多基地组网 | `multistatic_mesh = true`、`coherence_gating = true`、`pose_tracker_17kp = true` | 5-7 个动作 |
| 跨环境鲁棒性 | `meridian_generalization = true` | 3-5 个动作 |

### 2.4 次线性规划算法

规划器用三项技术避免在整个状态空间上做穷举 A* 搜索。

#### 2.4.1 反向相关性剪枝

搜索开始前，用反向链式推理找出与目标**相关**的动作：

```
function relevantActions(goal, allActions):
    relevant = {}
    frontier = {conditions in goal that are not satisfied}

    while frontier is not empty:
        pick condition C from frontier
        for each action A in allActions:
            if A.effects satisfies C:
                relevant.add(A)
                for each precondition P of A:
                    if P is not satisfied in current state:
                        frontier.add(P)

    return relevant
```

针对特定目标，这通常把动作集合从约 80 个缩减到 5-15 个。随后搜索只在相关动作上进行。

**复杂度**：O(G * A)，其中 G 是未满足的目标/前置条件属性数，A 是动作总数。由于 G << 2^N 且 A 固定为约 80，相对于状态空间这是常数时间。

#### 2.4.2 分层分解

按 ADR 依赖结构把动作组织成三层：

```
Tier 0 (Foundation):  ADR-014, ADR-016, ADR-018
    No internal prerequisites. Always satisfiable.

Tier 1 (Infrastructure):  ADR-017, ADR-021-core, ADR-022-p1, ADR-029-p1, ADR-030
    Depend only on Tier 0.

Tier 2 (Capability):  ADR-024, ADR-029-p2/p3, ADR-037-p1/p2, ADR-021-esp32
    Depend on Tier 0-1.

Tier 3 (Integration):  ADR-027, ADR-037-p3/p4, ADR-029-p4, ADR-011, ADR-031
    Depend on Tier 0-2.
```

规划器先解决 Tier 0 前置条件（通常已满足），再规划 Tier 1 动作，然后 Tier 2、Tier 3。每一层内部动作相互独立，可并行规划。这把有效搜索深度从约 15（最坏情况的线性链）降到约 4（层数）。

#### 2.4.3 增量式重规划

当世界状态变化（某个测试通过、插入硬件、用户改目标）时，规划器不会从头重规划，而是：

1. **失效标记**：标记当前计划中前置条件已不再满足、或效果已达成的动作。
2. **打补丁**：移除失效动作，只对剩余的未满足目标条件重跑反向相关性剪枝。
3. **合并**：把新动作按依赖顺序插入现有计划的正确位置。

由于只重新检查增量部分，这在动作总数上是次线性的。

#### 2.4.4 启发式代价函数

A* 启发式把剩余代价估计为「满足每个未满足目标条件所需的最小代价动作之和」，再除以可用的最大并行度（空闲 agent 数）。它是可采纳的（绝不高估），因为一个动作可以满足多个条件。

```
h(state, goal) = sum(min_cost_to_satisfy(c) for c in unsatisfied(state, goal)) / max_parallelism
```

#### 2.4.5 复杂度分析

| 组件 | 朴素 GOAP | 次线性 GOAP |
|-----------|-----------|----------------|
| 状态空间 | 2^N（N=25 个布尔量）= 33M | 剪枝到相关子集 |
| 评估的动作数 | 每次扩展约 80 个全部评估 | 5-15 个（反向剪枝） |
| 搜索深度 | 最多 15 | 最多 4（分层分解） |
| 重规划代价 | 完整重搜 | 仅增量打补丁 |
| 典型规划耗时 | ~100ms | <5ms |

### 2.5 状态观测

规划器在规划前查询真实项目状态。每个属性都有明确的观测方法。

| 属性 | 观测命令 | 缓存 TTL |
|----------|-------------------|-----------|
| `sota_signal_processing` | 运行 `cargo test -p wifi-densepose-signal --no-default-features 2>&1 \| grep "test result"` | 10 min |
| `esp32_connected` | 平台相关的 USB 串口探测 | 30 sec |
| `esp32_count` | 统计 ESP32 VID/PID USB 设备 | 30 sec |
| `gpu_available` | 运行 `nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null` 探测 | 5 min |
| `rust_test_count` | 解析 `cargo test --workspace --no-default-features` 输出 | 10 min |
| `wifi_adapter_present` | 操作系统相关的 WiFi 接口枚举 | 5 min |
| 模块存在性标志 | 对关键源文件执行 `test -f <path>` | 1 min |

观测结果按 TTL 缓存，避免每次规划请求都重跑昂贵命令（cargo test）。文件变更事件或用户显式请求会触发缓存失效。

### 2.6 通过 Swarm 执行计划

规划器产出有序动作列表后，执行通过 claude-flow swarm 系统分派。

#### 2.6.1 GOAP 协调器 Agent

规划器作为 `goap-coordinator` agent 运行在分层 swarm 拓扑中：

```
goap-coordinator (planner + dispatcher)
    |
    +-- researcher (dependency analysis, API review)
    +-- coder (implementation)
    +-- tester (validation, state observation)
    +-- reviewer (code review, security check)
```

协调器负责：
1. 观测当前世界状态
2. 接收用户给出的目标
3. 运行次线性规划器，产出动作序列
4. 把每个动作分派给合适的 agent 类型（取自动作的 `agent_types` 字段）
5. 通过 memory 系统监控动作完成情况
6. 每个动作完成后更新世界状态
7. 若世界状态偏离预期则重规划

#### 2.6.2 通过 Memory 持久化状态

世界状态存放在 claude-flow memory 系统的 `goap` 命名空间下：

```bash
# 存储观测到的状态
npx @claude-flow/cli@latest memory store \
  --namespace goap \
  --key "world-state" \
  --value '{"sota_signal_processing": true, "esp32_connected": false, ...}'

# 存储当前计划
npx @claude-flow/cli@latest memory store \
  --namespace goap \
  --key "current-plan" \
  --value '{"goal": "multi-person tracking", "actions": ["adr037_p1", "adr037_p2", ...], "progress": 1}'

# 检索过去成功的计划
npx @claude-flow/cli@latest memory search \
  --namespace goap \
  --query "multi-person tracking plan"
```

#### 2.6.3 动作到 Agent 的路由

每个动作声明所需的 agent 类型。协调器把它们映射到 swarm agent：

| Agent 类型 | 在 GOAP 动作中的职责 | 示例动作 |
|-----------|---------------------|-----------------|
| `researcher` | 分析依赖、查阅论文、检查 API 兼容性 | 任一 ADR 的动作前分析 |
| `coder` | 编写实现代码 | 所有实现动作 |
| `tester` | 跑测试、观测状态、验证效果 | 动作后校验 |
| `reviewer` | 代码审查、安全审计 | ADR-032 组网安全、任意 PR |
| `performance-engineer` | 跑基准、优化延迟 | ADR-029 流水线计时 |
| `security-architect` | 威胁建模、审计 | ADR-032 安全加固 |

#### 2.6.4 执行协议

对计划中的每个动作：

```
1. PRE-CHECK:  Observe preconditions. If any unsatisfied, re-plan.
2. DISPATCH:   Spawn required agents with action context.
3. EXECUTE:    Agents implement the action (write code, run tests).
4. VERIFY:     Tester agent observes the world state.
5. UPDATE:     If effects achieved, mark action complete, update state.
6. REPLAN:     If effects not achieved, flag failure, re-plan with updated state.
```

### 2.7 依赖图可视化

规划器可以把动作图导出为 DOT 格式用于可视化：

```
digraph goap {
    rankdir=LR;
    node [shape=box, style=rounded];

    // Tier 0（绿色 = 已完成）
    adr014 [label="ADR-014\nSOTA Signal", color=green];
    adr016 [label="ADR-016\nRuVector Train", color=green];
    adr018 [label="ADR-018\nESP32 Base", color=green];

    // Tier 1（蓝色 = 进行中）
    adr017 [label="ADR-017\nRuVector Signal", color=blue];
    adr030 [label="ADR-030\nField Model", color=orange];

    // Tier 2（橙色 = 已规划）
    adr037_p1 [label="ADR-037 P1\nPerson Count", color=orange];
    adr037_p2 [label="ADR-037 P2\nNMF Decomp", color=orange];
    adr024 [label="ADR-024\nAETHER", color=orange];

    // Tier 3（灰色 = 未来）
    adr037_p3 [label="ADR-037 P3\nMulti-Skeleton", color=gray];
    adr027 [label="ADR-027\nMERIDIAN", color=gray];

    // 边
    adr014 -> adr037_p1;
    adr037_p1 -> adr037_p2;
    adr037_p2 -> adr037_p3;
    adr014 -> adr024;
    adr024 -> adr037_p3;
    adr024 -> adr027;
    adr014 -> adr017;
    adr017 -> adr030;
}
```

### 2.8 基于 PageRank 的优先级排序

当用户没有给出明确目标，而是问「我接下来该做什么？」时，规划器在动作依赖图上跑 PageRank，找出杠杆最高的动作：

1. 构造邻接矩阵：若动作 j 依赖动作 i（即完成 i 会解锁 j），则 `A[i][j] = 1`。
2. 以阻尼系数 0.85 运行 PageRank。
3. PageRank 得分最高的动作最「承上启下」 —— 它们能解锁最多的下游工作。
4. 过滤出前置条件当前可满足的动作。
5. 返回按 `PageRank_score * (1 / cost_days)`（单位投入价值）排序的 top-K 动作。

这会自然地把基础动作（ADR-014、ADR-016）排在叶子动作（ADR-032 安全）之前，符合「基础设施工作杠杆最高」的直觉。

---

## 3. 实施

### 3.1 模块结构

GOAP 规划器实现为 claude-flow 协调层中的 TypeScript 模块（不放在 Rust workspace 里，因为它编排的是 Rust 开发，而不是 Rust 产品的一部分）。

```
.claude-flow/goap/
    state.ts          -- World state model and observation
    actions.ts        -- Action catalog (all ~80 actions)
    planner.ts        -- Sublinear A* planner with backward pruning
    goals.ts          -- Goal templates and user goal parser
    executor.ts       -- Swarm dispatch and action lifecycle
    pagerank.ts       -- Dependency graph prioritization
    visualize.ts      -- DOT graph export
```

### 3.2 CLI 集成

```bash
# 规划：为目标生成动作序列
npx @claude-flow/cli@latest goap plan --goal "multi-person tracking"

# 观测：快照当前世界状态
npx @claude-flow/cli@latest goap observe

# 排优先级：基于 PageRank 的「接下来做什么」推荐
npx @claude-flow/cli@latest goap prioritize --top-k 5

# 执行：通过 swarm 运行计划
npx @claude-flow/cli@latest goap execute --goal "vital sign monitoring"

# 可视化：导出 DOT 依赖图
npx @claude-flow/cli@latest goap graph --format dot > goap.dot
```

### 3.3 集成点

| 系统 | 集成方式 | 用途 |
|--------|------------|---------|
| claude-flow memory | `goap` 命名空间 | 持久化世界状态、计划与执行历史 |
| claude-flow swarm | 分层协调器 | 把动作分派给 agent 团队 |
| claude-flow hooks | `pre-task` / `post-task` | 工作前后触发状态观测 |
| cargo test | 状态观测 | 检测哪些 crate/模块测试通过 |
| USB 设备枚举 | 硬件观测 | 检测 ESP32 是否可用 |
| Git status | 实现检测 | 检查文件/模块是否存在 |

---

## 4. 后果

### 4.1 正面

- **免去人工优先级分析**：开发者只需陈述目标，规划器就产出具体、按依赖排序的动作清单。
- **硬件感知的规划**：需要 ESP32 或 GPU 的动作在硬件不可用时自动排除，避免死胡同计划。
- **次线性规划耗时**：反向剪枝 + 分层分解让典型目标的规划保持在 5ms 以内，支持交互式重规划。
- **增量式重规划**：状态变化（某个测试开始通过、插入硬件）时，只重新评估增量部分。
- **Swarm 集成**：动作分派给专用 agent，同一层内相互独立的动作可并行执行。
- **跨会话连续性**：世界状态与计划进度持久化在 memory 系统中，规划器能从上次中断处继续。
- **PageRank 优先级**：未给出具体目标时，规划器依据依赖图结构找出杠杆最高的下一个动作。
- **推理透明**：依赖图可导出为 DOT 格式可视化，规划器的推理过程可检查。

### 4.2 负面

- **动作目录维护成本**：每新增一份 ADR 或 ADR 阶段，都要把正确的前置条件与效果加入动作目录。过期动作会产出错误计划。
- **状态观测开销**：某些状态检查（跑 `cargo test`）代价较高。TTL 缓存可缓解，但带来数据陈旧的风险。
- **近似成本模型**：以「开发者·天」计的动作成本是估算值，实际投入随开发者经验与对代码库的熟悉度而变化。
- **布尔状态简化**：有些能力是连续的（准确率逐步提升），却被建模为布尔阈值，丢失了细微差异。

### 4.3 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| 动作目录与实际情况脱节 | Medium | 计划引用不存在或已完成的动作 | 规划时对照 ADR 目录校验动作目录 |
| 状态观测产生误报 | Low | 规划器跳过必要动作 | 用多种观测方法交叉验证 |
| 用户目标相互冲突（准确率 vs 延迟） | Medium | 规划器产出次优折中 | 支持带显式权重的多目标 |
| Swarm agent 执行动作时失败 | Medium | 计划停滞 | 超时 + 自动重规划，并在状态中记录失败 |

---

## 5. 受影响组件

| 组件 | 变更 | 说明 |
|-----------|--------|-------------|
| `.claude-flow/goap/` | New | GOAP 规划器模块（TypeScript） |
| claude-flow memory（`goap` 命名空间） | New | 世界状态与计划持久化 |
| claude-flow swarm 协调器 | Extended | GOAP 协调器 agent 类型 |
| claude-flow CLI | Extended | `goap` 子命令（plan、observe、prioritize、execute、graph） |

---

## 6. 性能预算

| 操作 | 预算 | 方法 |
|-----------|--------|--------|
| 世界状态观测（缓存） | < 100ms | 读取 memory 缓存 |
| 世界状态观测（实时） | < 30s | 运行 cargo test + 硬件探测 |
| 计划生成（次线性） | < 5ms | 反向剪枝 + 分层 A* |
| PageRank 优先级排序 | < 2ms | 稀疏矩阵迭代 |
| 增量重规划 | < 1ms | 在现有计划上打增量补丁 |
| DOT 图生成 | < 1ms | 遍历动作目录 |

---

## 7. 已考虑的备选方案

1. **人工优先级表格**：维护一张 ADR 优先级与依赖的电子表格。已否决：需要人工更新，不能随硬件可用性自适应，也无法被 agent 以编程方式查询。

2. **在原始状态空间上跑完整 `A*` 搜索**：不做次线性优化的标准 GOAP。已否决：当大多数动作与任一给定目标无关时，2^25 个布尔状态的空间大得没有必要。

3. **分层任务网络（HTN）**：HTN 用预定义方法把任务分解为子任务。能力比 GOAP 强，但每个任务都要手工编写分解方法。GOAP 的扁平动作模型 + 自动规划，在 ADR 演进时更易维护。

4. **强化学习规划器**：训练 RL agent 选择动作。已否决：动作空间随 ADR 增加而变化，奖励信号稀疏（项目完成），且对结构已知的规划问题来说样本复杂度过高。

5. **简单拓扑排序**：按依赖顺序排序动作并自顶向下执行。已否决：不考虑目标（会把所有动作都执行）、不处理硬件约束，也不支持重规划。

---

## 8. 参考资料

1. Orkin, J.（2003 年）。"Applying Goal-Oriented Action Planning to Games." AI Game Programming Wisdom 2。
2. Orkin, J.（2006 年）。"Three States and a Plan: The A.I. of F.E.A.R." Game Developers Conference。
3. Page, L., Brin, S., Motwani, R., Winograd, T.（1999 年）。"The PageRank Citation Ranking: Bringing Order to the Web." Stanford InfoLab。
4. Ghallab, M., Nau, D., Traverso, P.（2004 年）。"Automated Planning: Theory and Practice." Morgan Kaufmann。
5. Russell, S., Norvig, P.（2020 年）。"Artificial Intelligence: A Modern Approach." 第 4 版，第 11 章：自动规划。
