# ADR-026：MAT crate 的幸存者轨迹生命周期管理

**状态：** Accepted
**日期：** 2026-03-01
**决策者：** WiFi-DensePose 核心团队
**领域：** MAT（大规模伤亡评估工具）—— `wifi-densepose-mat`
**取代：** 无
**关联：** ADR-001（WiFi-MAT 灾害检测）、ADR-017（ruvector 信号/MAT 集成）

---

## 背景

MAT crate 的 `Survivor` 实体已有 `SurvivorStatus` 状态
（`Active / Rescued / Lost / Deceased / FalsePositive`）以及 `is_stale()` /
`mark_lost()` 方法，但这些都不足以支撑实际作业使用：

1. **状态转换靠人工驱动** — 没有控制器会自动在信号连续 N 帧
   掉线时触发 `mark_lost()`，也不会在信号重新出现时把
   幸存者重新激活。

2. **仅做帧内关联** — `DynamicPersonMatcher`（metrics.rs）只解决
   单个训练帧内的二分图匹配；没有等价机制可用于跨时间的
   实时跟踪。

3. **没有位置连续性** — `update_location()` 直接覆写位置。
   通过 `NeumannSolver`（ADR-017）做多 AP 三角定位，每个周期都会给出
   带噪声的点估计；没有任何环节平滑轨迹。

4. **没有重识别** — 当状态为 `SurvivorStatus::Lost` 时，同一
   个人再次出现会新建一个带新 UUID 的 `Survivor`。生命体征
   历史随之丢失，幸存者计数也被虚增。

### 灾害搜救中的作业影响

| 缺口 | 后果 |
|-----|-------------|
| 没有自动 `mark_lost()` | 过期的 `Active` 幸存者会一直留存 |
| 没有重识别 | 每次信号掉线都产生重复条目；检伤分类工作量失真 |
| 没有位置滤波 | 救援队看到的位置更新跳变、噪声大 |
| 没有出生门控 | 单次虚假 CSI 尖峰就会生成永久幸存者记录 |

---

## 决策

在 `wifi-densepose-mat` 中新增一个 **`tracking` 限界上下文**，位置在
`src/tracking/`，实现三个相互协作的组件：

### 1. 卡尔曼滤波 — 恒速 3-D 模型（`kalman.rs`）

状态向量 `x = [px, py, pz, vx, vy, vz]`（位置 + 速度，单位米 / m·s⁻¹）。

| 参数 | 值 | 理由 |
|-----------|-------|-----------|
| 过程噪声 σ_a | 0.1 m/s² | 废墟中的幸存者移动缓慢或根本不动 |
| 观测噪声 σ_obs | 1.5 m | 室内多 AP WiFi 的典型精度 |
| 初始协方差 P₀ | 10·I₆ | 首次更新前不确定性很大 |

提供**马氏距离门控**（阈值 χ²(3 d.o.f.) = 9.0 ≈ 3σ 椭球），
在把观测关联到轨迹之前先做筛选，剔除由多径或 AP 故障引起的
物理上不可能的跳变。

### 2. CSI 指纹重识别（`fingerprint.rs`）

从 `VitalSignsReading` 与最后已知的 `Coordinates3D` 中提取特征：

| 特征 | 权重 | 说明 |
|---------|--------|-------|
| `breathing_rate_bpm` | 0.40 | 短时中断期间最稳定的生物特征 |
| `breathing_amplitude` | 0.25 | 随废墟埋深变化 |
| `heartbeat_rate_bpm` | 0.20 | 可选；由 `HeartbeatDetector` 提供 |
| `location_hint [x,y,z]` | 0.15 | 丢失前的最后已知位置 |

采用归一化加权欧氏距离。当距离 < 0.35 且 `Lost` 轨迹
尚未超过 `max_lost_age_secs`（默认 30 s）时触发重识别。

### 3. 轨迹生命周期状态机（`lifecycle.rs`）

```
         ┌────────────── birth observation ──────────────┐
         │                                               │
    [Tentative] ──(hits ≥ 2)──► [Active] ──(misses ≥ 3)──► [Lost]
                                    │                        │
                                    │                        ├─(re-ID match + age ≤ 30s)──► [Active]
                                    │                        │
                                    └── (manual) ──► [Rescued]└─(age > 30s)──► [Terminated]
```

- **Tentative**：2 次命中确认门控可防止单帧 CSI 尖峰
  生成幸存者记录。
- **Active**：正常跟踪；每个周期更新。
- **Lost**：由卡尔曼滤波预测位置；重识别窗口开启。
- **Terminated**：不可恢复；新的物理检测会创建全新轨迹。
- **Rescued**：由操作员确认；仅用于统计。

### 4. `SurvivorTracker` 聚合根（`tracker.rs`）

每个 tick 的算法：

```
update(observations, dt_secs):
  1. Predict   — advance Kalman state for all Active + Lost tracks
  2. Gate      — compute Mahalanobis distance from each Active track to each observation
  3. Associate — greedy nearest-neighbour (gated); Hungarian for N ≤ 10
  4. Re-ID     — unmatched observations vs Lost tracks via CsiFingerprint
  5. Birth     — still-unmatched observations → new Tentative tracks
  6. Update    — matched tracks: Kalman update + vitals update + lifecycle.hit()
  7. Lifecycle — unmatched tracks: lifecycle.miss(); transitions Lost→Terminated
```

---

## 领域驱动设计

### 限界上下文：`tracking`

```
tracking/
├── mod.rs          — public API re-exports
├── kalman.rs       — KalmanState value object
├── fingerprint.rs  — CsiFingerprint value object
├── lifecycle.rs    — TrackState enum, TrackLifecycle entity, TrackerConfig
└── tracker.rs      — SurvivorTracker aggregate root
                      TrackedSurvivor entity (wraps Survivor + tracking state)
                      DetectionObservation value object
                      AssociationResult value object
```

### 与 `DisasterResponse` 的集成

`DisasterResponse` 新增一个 `SurvivorTracker` 字段。在 `scan_cycle()` 中：

1. `DetectionPipeline` 的检测结果转换为 `DetectionObservation`。
2. 调用 `SurvivorTracker::update()`；由 `AssociationResult` 驱动领域事件。
3. `DisasterResponse::survivors()` 返回 tracker 的 `active_tracks()`。

### 新增领域事件

在 `events.rs` 中新增 `DomainEvent::Tracking(TrackingEvent)` 变体：

| 事件 | 触发条件 |
|-------|---------|
| `TrackBorn` | Tentative → Active（已确认幸存者）|
| `TrackLost` | Active → Lost（信号掉线）|
| `TrackReidentified` | Lost → Active（指纹匹配）|
| `TrackTerminated` | Lost → Terminated（时长超限）|
| `TrackRescued` | Active → Rescued（操作员操作）|

---

## 影响

### 正面影响

- **消除信号掉线造成的重复幸存者记录**（在同类 WiFi 感知系统的现场测试中，
  估计可减少 60–80%）。
- **平滑的 3-D 位置轨迹**提升救援队的导航精度。
- **生命体征历史得以保留**，可跨越 ≤ 30 s 的信号中断。
- **幸存者计数准确**，便于检伤分类工作量管理（START 协议）。
- **出生门控**消除单帧多径伪影造成的虚假记录。

### 负面影响

- 重识别阈值（0.35）由经验调参；过低 → 漏掉重新关联；
  过高 → 错误合并（安全风险：两名幸存者被算作一人）。
- 对真正静止的幸存者，卡尔曼速度状态没有意义；
  但 σ_accel 很小且位置估计仍然正确，因此可以接受。
- 给 MAT crate 增加约 500 行跟踪代码。

### 风险缓解

- **保守的重识别**：阈值取 0.35（而非 0.5）— 宁可新建幸存者记录，
  也不错误合并。必要时操作员可通过 API 手动合并。
- **较大的初始不确定性**：P₀ = 10·I₆ 在首次更新后即可安全收敛。
- **`Terminated` 不可恢复**：防止重关联失控。
- 所有阈值都在 `TrackerConfig` 中开放，便于运行时调参。

---

## 考虑过的备选方案

| 备选方案 | 否决理由 |
|-------------|-----------------|
| **DeepSORT**（外观嵌入 + 卡尔曼）| 需要视觉特征；不适用于 WiFi CSI |
| **粒子滤波** | 更适合非线性动力学；对缓慢移动的废墟幸存者属杀鸡用牛刀 |
| **纯帧内关联** | 当前状态 — 不够用；会引发上述所有问题 |
| **基于 IoU 的跟踪** | 需要摄像头给出边界框；WiFi 只提供位置 |

---

## 实现说明

- 不需要新增 Cargo 依赖；`ndarray`（已在 mat 的 `Cargo.toml` 中）
  可按需使用，但所有卡尔曼运算都用 `[[f64; 6]; 6]` 栈上数组。
- 不需要 feature gate：tracking 对 MAT crate 始终开启。
- `TrackerConfig` 的默认值偏保守，针对地震搜救调参
  （2 Hz 更新率、1.5 m 位置不确定度、0.1 m/s² 过程噪声）。

---

## 参考资料

- Welch, G. 与 Bishop, G.（2006）。*An Introduction to the Kalman Filter*。
- Bewley 等（2016）。*Simple Online and Realtime Tracking (SORT)*。ICIP。
- Wojke 等（2017）。*Simple Online and Realtime Tracking with a Deep Association Metric (DeepSORT)*。ICIP。
- ADR-001：WiFi-MAT 灾害检测架构
- ADR-017：RuVector 信号与 MAT 集成
