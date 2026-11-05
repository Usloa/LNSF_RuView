# RuView 流式引擎 v0.3.0 —— 可审计的环境智能

## 这是什么

多数 WiFi 感知方案只吐一个数字，然后指望你信它。**RuView 的流式引擎设计成不需要你盲信。** 它给出的每一个结论 ——「客厅里有人」「跌倒风险升高」「房间布局变了」—— 都带着完整的证据链：哪些传感器看到了、彼此有多大程度一致、由哪次校准和哪个模型产出、以及是在什么隐私策略下发布的。

贯穿始终的是**信任**。如果你问「它说有人摔了，我凭什么信？」—— 引擎回答的是信号证据、传感器一致性、校准来源和一套可审计的隐私处置，而不只是一个置信度分数。

这个版本落地了 ADR-135→146 系列：数据契约、信任/隐私/审计机制，以及各类算法 —— 全都是真实实现、经过测试，并组合成一条端到端的流水线循环。

## 让它可审计的两层

- **WorldGraph（`wifi-densepose-worldgraph`）** —— 回答「在哪、为什么」的图。一张带类型的图，节点是房间、传感器、射频链路、人员轨迹、物体锚点、事件和信念，边也带类型：`observes`、`located_in`、`derived_from`、`contradicts`、`privacy_limited_by`。隐私处置**直接看得见地留在持久化后的图里** —— 审计者能准确读出哪些被压掉了、为什么。
- **可信语义记录** —— 回答「此刻我们相信什么」的记录。每条语义状态都带着模型版本、校准版本、证据引用、置信度、过期时间和隐私动作。高风险动作（例如通知照护人）要求**多信号一致**，不能靠单个带噪声的原语触发。

## v0.3.0 新增内容

| 领域 | 能力 |
|------|-----------|
| 帧契约（ADR-136） | `ComplexSample`（小端规范）、每帧的来源字段、`CanonicalFrame` 的 BLAKE3 见证、`Stage`/`Versioned`/`QualityScored` trait |
| 校准（ADR-135） | `BaselineCalibration::apply()` 给每帧盖上确定性的 `calibration_id` |
| 融合质量（ADR-137） | `QualityScore` 带逐节点权重、证据引用与矛盾标记；能检测校准不一致 |
| 阵列协调（ADR-138） | 时钟质量 + 几何门控；退化的节点转为「只观察」 |
| WorldGraph（ADR-139） | 带类型的数字孪生 + 隐私汇总 + 确定性持久化 |
| 语义记录（ADR-140） | 可审计的状态记录 + 多信号 agent 路由 |
| 隐私控制面（ADR-141） | 具名模式 + 动作 + BLAKE3 哈希链、可防篡改的证明 |
| 演进 + VoxelMap（ADR-142） | 链路间「房间变了」检测 + 贝叶斯占用，按隐私门控降为直方图 |
| RF-SLAM（ADR-143） | 持续发现反射体 → 学出静态锚点 |
| UWB 融合（ADR-144） | 带异常值剔除的距离约束精修（前瞻性） |
| 消融测试脚手架（ADR-145） | 特征矩阵指标，含成员推断隐私泄露 |
| RF 编码器（ADR-146） | 多头任务、每头各自的不确定性 + 对比批处理器（前瞻性） |
| **引擎（`wifi-densepose-engine`）** | 组合根：一次 `process_cycle()` 跑完整条信任流水线 |

## 快速上手

```rust
use wifi_densepose_engine::StreamingEngine;
use wifi_densepose_bfld::PrivacyMode;
use wifi_densepose_geo::types::GeoRegistration;
use wifi_densepose_signal::ruvsense::fusion_quality::CalibrationId;

// 1. 用隐私处置 + 模型版本构造引擎。
let mut engine = StreamingEngine::new(PrivacyMode::PrivateHome, 1, GeoRegistration::default());

// 2. 描述空间（房间 + 传感器都是 WorldGraph 节点）。
let room = engine.add_room("living_room", "Living Room");
let sensor = engine.add_sensor("esp32-com9", room);
engine.register_node_geometry(0, 1.0, 0.0, 0.0);   // ADR-138 阵列几何（可选）

// 3. 每个 50 ms 循环：喂入逐节点 CSI 帧 + 校准纪元。
let out = engine.process_cycle(&node_frames, CalibrationId(0xABCD), room, now_ms)?;

// 4. 结果是*可信*的信念 —— 全程可追溯。
println!("class={:?} demoted={} evidence={:?}",
         out.effective_class, out.demoted, out.provenance.evidence);
assert_eq!(out.quality.calibration_id, Some(CalibrationId(0xABCD)));

// 5. 持久化世界模型；重新加载后同样的查询会得到同样的结果。
let snapshot = engine.snapshot_json()?;        // RVF 载荷 —— 绝不写原始射频帧
```

逐节点校准（不一致会自动降级隐私等级）：

```rust
let out = engine.process_cycle_calibrated(
    &node_frames,
    &[Some(CalibrationId(1)), Some(CalibrationId(2))], // 不一致 → CalibrationIdMismatch
    room, now_ms)?;
assert!(out.demoted);                          // 隐私等级降到 Restricted
assert_eq!(out.quality.calibration_id, None);  // 不存在单一校准纪元
```

## 已验证（能证明这套架构的验收测试）

- **ADR-137** `两帧各自校准 → 校准不一致 → QualityScore 矛盾 → Restricted → calibration_id 为 None → 见证稳定`
- **ADR-139** `实时帧 → 融合 → worldgraph 更新 → 隐私汇总 → 持久化 → 重新加载 → 内容一致`（不持久化原始射频）
- **ADR-140** `原始快照 → 语义原语 → SemanticStateRecord → 一致性规则 → 过期记录被拒`
- **ADR-142** `3 条链路漂移 30 帧 → ChangePoint → VoxelMap 累积 → 低置信度被压掉 → VoxelGate 的 Restricted 直方图 → ADR-137 矛盾`

## 性能与安全

- **完整一轮约 6.35 µs**（4 节点 / 56 子载波）—— 约为 50 ms / 20 Hz 预算的 1/7800（criterion：`cargo bench -p wifi-densepose-engine`）。
- 新 crate 一律 `#![forbid(unsafe_code)]`；没有写死的密钥；输入在边界处校验；隐私降级只能单向收紧；模式变更有哈希链证明。
- `wifi-densepose-core` 和 `wifi-densepose-bfld` 为 ESP32-S3 设备端路径构建 `#![no_std]`。

## 构建与测试

```bash
cd v2
cargo build --release --workspace --no-default-features    # 优化构建
cargo test --workspace --no-default-features                # 全套测试
cargo test -p wifi-densepose-engine                         # 13 个集成测试
cargo bench -p wifi-densepose-engine                        # 每轮延迟
```

## 状态（如实说明）

已通过 `wifi-densepose-engine` 组合根完成端到端集成与验证：ADR-135/136/137/138/139/141/142/143。前瞻性 / 待办：实时 20 Hz 的 sensing-server 循环接线、UWB 硬件（ADR-144）、RF 编码器模型训练（ADR-146）。每个 GitHub issue（#840–#850）都列明了哪些是*已建成*、哪些还是*集成胶水*。
