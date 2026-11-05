# 信任状态与引擎错误

如果你在 sensing-server 日志里看到 `engine_error_count` 一直在涨，或者发现状态接口返回 `"demoted": true`，这一页依据**真实代码**（不是设计文档）说明这两样东西分别是什么意思、什么会触发、在哪里能看到，以及你实际有哪些办法。

下面每一条都能在以下文件里查到：
`v2/crates/wifi-densepose-sensing-server/src/engine_bridge.rs`、
`v2/crates/wifi-densepose-sensing-server/src/main.rs`、
`v2/crates/wifi-densepose-engine/src/lib.rs`，以及
`v2/crates/wifi-densepose-signal/src/ruvsense/multistatic.rs`。

## 两件不同的事，很容易混为一谈

感知服务器在每个感知 tick 都会跑一轮"受管信任循环"（`StreamingEngine::process_cycle`，由 `engine_bridge.rs:193-223` 的 `EngineBridge::observe_cycle` 驱动）。每轮只会产生**两种结果之一**，而且是分开各自统计的：

1. **这一轮直接失败**（`Result::Err(EngineError)`）—— 这个 tick 什么都不发布。这会让 `engine_error_count` 加一，它是一个只增不减的计数器。
2. **这一轮成功，但隐私等级被降级**（`Result::Ok(TrustedOutput { demoted: true, .. })`）—— 结论**照常发布**，只是用的隐私等级比平时更严格。这会置上 `demoted` 标志，每轮成功都会重新算一次。

所以可能出现：`engine_error_count` 很高但 `demoted: false`（很多轮失败了，但成功的那些都干净）；也可能 `demoted: true` 而 `engine_error_count: 0`（每轮都成功，只是隐私等级降了一档）；还可能两者同时出现 —— 提 issue 的人遇到的就是最后这种。

## 1. 各自的确切触发条件

### 引擎错误（`engine_error_count`）

只有当 `StreamingEngine::process_cycle` 返回 `Err(EngineError::Fusion(..))` 时，`engine_error_count` 才会加一（`engine_bridge.rs:198-222`）。`EngineError` 包着 `wifi_densepose_signal::ruvsense::multistatic::MultistaticError`（`wifi-densepose-engine/src/lib.rs:54-69`），后者恰好只有四种（`multistatic.rs:36-56`）：

| 类型 | 触发条件 |
|---|---|
| `NoFrames` | 没有把任何节点帧交给融合器。实际上经桥接层走不到这一步：如果没有帧，`process_cycle_from_states` 会先返回 `None`（不算错误、也不计数），根本不会调用引擎（`engine_bridge.rs:168-171`）。 |
| `InsufficientNodes(n)` | 多静态模式下参与的节点少于 2 个。 |
| `TimestampMismatch { spread_us, guard_us }` | 参与节点之间的帧时间戳差值超过**硬保护间隔**，默认 **60,000 µs（60 ms）**（`MultistaticConfig::default()`，`multistatic.rs:133`）。 |
| `DimensionMismatch { node_idx, expected, got }` | 某个节点的子载波数与其他节点对不上。自 #1170 起，实时桥接层会在融合前把所有节点统一到公共的 56 子载波栅格，所以真实硬件上现在已经很少见 —— 参见 `engine_bridge.rs` 里 `observe_cycle_counts_engine_errors` 的注释。 |

不管原因是什么，错误在**日志里是限流的**：每 10 秒最多打一条 `tracing::warn!`（`ENGINE_ERROR_WARN_INTERVAL`，`engine_bridge.rs:50, 206-219`）。注意每一轮仍然会计数，被限制的是**日志行**，所以 20 Hz 的循环持续失败也不会把日志刷成每秒 20 条。

### 信任降级（`demoted`）

这是和引擎错误**完全分开**的一套机制：它发生在**成功**的那些轮次上，不改失败与否，只把输出所用的隐私等级往下降一档。来自 `wifi-densepose-engine/src/lib.rs:514-515`：

```rust
let demoted = quality.forces_privacy_demotion() || array_contradiction || mesh_at_risk;
let effective_class = if demoted { demote_one(base_class) } else { base_class };
```

有三个互不依赖的条件能触发它：

- **`quality.forces_privacy_demotion()`** —— 只要融合质量记录里带着非空的 `contradiction_flags` 就为真（`fusion_quality.rs:111-118`）。这些是**可以容忍**的分歧，和硬性融合失败不是一回事：
  - `TimestampMismatch` —— 差值在**硬**保护间隔之内、但超过了**软**保护间隔（默认 **20,000 µs / 20 ms**，`soft_guard_us`，`multistatic.rs:104-113`），也就是时间对齐偏松但还过得去。
  - `CalibrationIdMismatch` —— 参与的各帧对"自己是在哪一次校准（基线）下采集的"说法不一致。
  - `PhaseAlignmentFailed`、`DriftProfileConflict`、`CoherenceDrop`、`GeometryInsufficient` —— 由上游的阵列协调器 / 基线漂移检查抛出。
- **`array_contradiction`** —— 另一套阵列级的方向融合矛盾检查。
- **`mesh_at_risk`** —— 组网快要分裂了（`mesh_guard.rs`）。

`demote_one()`（`lib.rs:688-690`）只把隐私等级朝 `Restricted` 降**恰好一档**（绝不会一次跳多档，也不会在同一轮里把等级放宽 —— `forced_contradiction_never_relaxes_class` 测试证明了这一点）。到了 `PrivacyClass::Restricted`，`EngineBridge::suppress_raw_outputs()` 就为真，`main.rs` 会从发布的 `SensingUpdate` 里去掉逐节点的原始幅度向量（`engine_bridge.rs:251-260`）。

**关键一点：`demoted` 不会"卡住"。** 每轮成功都会用**这一轮自己**的结果覆盖它（`self.demoted = trust.demoted;`，`engine_bridge.rs:203`）。如果造成降级的矛盾只是暂时的，下一轮干净的结果就会重新报 `demoted: false`，不需要你做任何事。如果你看到 `demoted: true` **一直不变**，说明底层条件本身（通常是时钟漂移超过保护间隔，或几何/校准不一致）一直存在，而不是什么东西"卡死了"。

## 2. 这些信息在哪里能看到

`GET /health/ready` 和 `GET /api/v1/status` 接的是同一个处理函数（`health_ready`，`main.rs:8128,8133`），都会返回一个 `trust` 块（`main.rs:4589-4606`）：

```json
{
  "status": "ready",
  "source": "esp32",
  "source_state": "live_unverified",
  "waiting_for_frames": false,
  "last_frame_age_ms": 42,
  "trust": {
    "node_positions": { "1": [0.5, 0.0, 1.0], "2": [4.0, 3.0, 1.0] },
    "last_witness": "…64 hex chars or null…",
    "effective_class": "Anonymous | Restricted | …",
    "demoted": false,
    "recalibration_recommended": false,
    "engine_error_count": 0,
    "raw_outputs_suppressed": false
  }
}
```

`node_positions` 是受管融合器持有的 `--node-positions` 映射，按节点 id 索引。没配位置时它是 `{}`，此时所有节点都在原点做融合；映射里没写到的节点也一样在原点融合。

**这是当前确实上线了的诊断接口 —— 但要如实说明，它的能力有限。** 它能告诉你"有错误在发生""当前等级被降级了"以及总次数，但**说不出你这次具体是为什么**：

- `engine_error_count` 只是一个累计总数。接口和 `EngineBridge` 的状态里都**没有按错误类型拆分** —— 光看 `/health/ready`，你分不清那 20,000 次错误全是 `TimestampMismatch`，还是全是 `DimensionMismatch`。
- `demoted` 只是个布尔值，没有附上"到底哪几个 `ContradictionFlag` 触发了"。底层 `contradiction_flags` 向量存在于 `QualityScore`（`fusion_quality.rs:106`），但在我们能找到的范围里，没有通过接口传出来。
- 没有错误历史 / 时间线，也没有按节点拆分（比如看不出是哪个节点的时钟在漂）。

**目前最接近"真正诊断"的，反而是那条被限流的日志行。** 和接口不同，日志消息里带着实际 `EngineError` 的 `Display` 文本，对 `TimestampMismatch` 和 `DimensionMismatch` 会给出具体数字（例如 `"Timestamp spread 87000 us exceeds guard interval 60000 us"`、`"Dimension mismatch: node 2 has 114 subcarriers, expected 56"`）。今天要排查某一次降级/错误，在 sensing-server 日志里搜 `"governed trust cycle failed"` 是最具体的办法 —— 单看状态接口不会告诉你底层原因。请把这当成诊断能力的真实现状，我们不会假装有某个其实不存在的功能。

## 3. 降级 / 出错状态是永久的吗？能重置吗？

**`demoted` 根本不需要重置** —— 如上所述，每轮成功都会按那一轮自己的矛盾/组网状态重算。代码里既没有持久化，也没有计数器或冷却计时器。

**`engine_error_count` 则完全没有重置机制。** 它只是 `EngineBridge` 上一个普通的 `u64` 字段，在 `EngineBridge::new` 里初始化为 `0`（`engine_bridge.rs:111`），之后只做加法（`self.engine_error_count += 1;`，第 207 行）—— 整个 crate 里找不到任何方法、管理接口或定时器会减少或清空它。想让它归零，唯一办法是**重启 sensing-server 进程**，那会重新构造一个全新的 `EngineBridge`。如果计数在涨、你想确认修复是否真的生效，就重启服务器再看计数会不会重新往上爬 —— 目前没有比重启更轻的"清计数器"办法。

**如果降级（或错误）是持续性的、不是偶发**，最常见的原因是节点间时钟漂移超过写死的 60 ms 硬保护间隔；有文档记载、也确实有效的办法是改环境变量，不是重启、也不是等着：

- `WDP_GUARD_INTERVAL_US` —— 直接覆盖硬保护间隔（例如 `WDP_GUARD_INTERVAL_US=200000` 表示 200 ms）。这正是真实部署（issue #1049）需要的应急开关：经 WiFi/ESP-NOW 同步的 ESP32 节点实测会漂 10～150 ms，公开的 60 ms 默认值吸收不了，导致**每一轮**都降级，而且"没有出口"（见 `main.rs:8336-8339` 的注释）。
- `WDP_SOFT_GUARD_US` —— 可选，覆盖软保护间隔（即"可容忍矛盾"那条线），且始终被限制在硬保护间隔之下。
- `WDP_TDM_SLOTS` + `WDP_TDM_SLOT_US` —— 不直接设值，改为按你实际的 TDM 调度推算出保护间隔。

确切的优先级规则见 `multistatic_guard_config_from_env` / `multistatic_guard_config_from`（`main.rs:6791-6856`）：直接给的 `WDP_GUARD_INTERVAL_US` 永远优先于由 TDM 推算出的值。

## 4. 转换过的 Hugging Face 模型能解释这些吗？

**我们没找到任何把 `--convert-model` 和引擎错误、信任降级连起来的代码路径 —— 看起来它们是完全独立的两套子系统。** 如实说明，不做猜测：

- `--convert-model`（`main.rs:6976-7028`，对应 `run_convert_model` / `load_or_convert_model`，位于 `main.rs:6925-6974`）是把**姿态模型的权重文件**（Hugging Face 的 `safetensors` 或 `jsonl` 清单）转成本项目自己的 RVF 二进制容器格式，好让 `--model` 能加载它。整件事只关系到姿态估计器用哪份神经网络权重。
- `engine_error_count` 和 `demoted` 来自 `wifi-densepose-engine` 的 `StreamingEngine::process_cycle`，它做的是**多静态 CSI 传感器融合** —— 检查节点数、逐节点的时间戳差值、以及各 ESP32 节点之间的子载波维度。这条代码路径不依赖加载了哪个姿态模型，而 `load_or_convert_model` / `run_convert_model` 也完全不会调用 `engine_bridge` 或 `StreamingEngine`。

既然代码里看不出两者有关联，我们就不硬编一个出来。如果你同时遇到两种症状，代码没排除、但也没证实的可能性有两个：

- **碰巧** —— 那次加载/使用转换模型出问题的部署，另外还碰上了融合时序或节点数问题（例如类似 #1049 的时钟漂移，或活跃节点不足 2 个），与模型转换本身无关。
- **换模型时顺手改了配置** —— 比如在切换模型的同时改了节点数、几何布局或保护间隔参数，于是两种症状一起出现，但成因并不是模型。

真遇到这种情况，按代码能给出的可执行建议是：**不管加载了什么模型**，都单独去查 `engine_error_count` 和日志行里的错误文本（按上面第 2 节）。如果错误是 `TimestampMismatch` / `DimensionMismatch` / `InsufficientNodes`，那要修的是传感器融合这一侧（第 3 节），不是模型那一侧 —— 与出报告的是哪个模型无关。

## 速查

```bash
# 查看当前信任状态
curl -s http://localhost:3000/api/v1/status | jq .trust

# 留意那条被限流的错误日志（目前最具体的诊断线索）
# —— 在 sensing-server 的 stderr/日志里找 "governed trust cycle failed"。

# 如果降级/错误是节点时钟漂移造成的持续问题，把保护间隔调大：
WDP_GUARD_INTERVAL_US=200000 wifi-densepose-sensing-server ...

# 让 engine_error_count 归零的唯一办法是重启进程。
```

以上内容的源码依据：
- `v2/crates/wifi-densepose-sensing-server/src/engine_bridge.rs`
- `v2/crates/wifi-densepose-sensing-server/src/main.rs`（搜 `trust`、`health_ready`、`multistatic_guard_config_from`、`convert_model`）
- `v2/crates/wifi-densepose-engine/src/lib.rs`
- `v2/crates/wifi-densepose-engine/src/mesh_guard.rs`
- `v2/crates/wifi-densepose-signal/src/ruvsense/multistatic.rs`
- `v2/crates/wifi-densepose-signal/src/ruvsense/fusion_quality.rs`
