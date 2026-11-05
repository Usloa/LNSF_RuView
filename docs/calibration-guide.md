# 校准与房间训练指南

这份指南讲的是运行 `wifi-densepose calibrate`、`enroll`、`train-room` 时**实际会发生什么**、以及**哪些条件是代码真正强制检查的**。写给布置房间的人看，不是写给开发者看的。

下面每一条都对照过真实的 Rust 实现：`v2/crates/wifi-densepose-calibration/`、`v2/crates/wifi-densepose-signal/src/ruvsense/calibration.rs` 和 `v2/crates/wifi-densepose-cli/`，而不只是看设计文档。如果设计文档（ADR-135、ADR-151）里写的东西其实还没做出来，这里会明确说清楚。

## 三步流程

```
wifi-densepose calibrate --port <PORT>      # 第 1 步：空房间基线（房间里不能有人）
wifi-densepose enroll --room <NAME>         # 第 2+3 步：8 个引导锚点（约 4 分钟）
wifi-densepose train-room --room <NAME>     # 第 4 步：训练专用模型组
wifi-densepose room-status --room <NAME>    # 查看哪些训好了、哪些已过期
wifi-densepose room-watch --room <NAME>     # 实时推断
```

`calibrate` 必须先跑——没有基线文件（默认是 `--baseline ./baseline.bin`）时 `enroll` 会拒绝启动；没有录入文件时 `train-room` 也会拒绝启动。每一步都会写一个文件给下一步读，没法跳步。

---

## 1. 有没有最少要采多少数据的要求？

**有。空房间基线这一条是硬性强制的，不是建议。**

`wifi-densepose calibrate` 在记录帧数少于 **600 帧**时不会生成基线文件（所有物理层档位 HT20、HT40、HE20、HE40 的默认值都一样）。这个值是 `DEFAULT_MIN_FRAMES = 600`，在 `v2/crates/wifi-densepose-signal/src/ruvsense/calibration.rs:48`，由 `CalibrationRecorder::finalize()` 检查（`ruvsense/calibration.rs:532-538`）：如果记录帧数少于 `config.min_frames`，`finalize()` 会返回 `CalibrationError::InsufficientFrames { got, need }`，校准直接失败——不存在"打个折、先给个能用基线"这种退让。有单元测试（`finalize_requires_min_frames`，同一个文件）把它钉住，所以不是偶然行为。

**一个容易踩的坑：** 命令行的 `--duration-s`（默认 30 秒）和 600 帧下限是**各自独立**判断的。`v2/crates/wifi-densepose-cli/src/calibrate.rs:135-183` 里的采集循环，只要"时间到"或"采满 600 帧"里**任一**条件先满足就停。如果你的节点 CSI 出帧速度比假设的 20 Hz 慢（比如 WiFi 拥堵、ESP32 比较忙），30 秒可能凑不够 600 帧，这时 `calibrate` 会明确报 `"insufficient frames: have X, need 600"`，而不是悄悄生成一个短基线。遇到这种情况，把 `--duration-s` 调大，别去改 `--min-frames`。

你**可以**用 `--min-frames <N>` 覆盖 600 帧下限（0 表示用档位默认值）。代码会打印一条明确的警告：

> `[calibrate] WARN: --min-frames=N overrides ADR-135 tier default (600 for
> ht20). This relaxes the phase-concentration guarantee; do not use in
> production.`

（位置：`v2/crates/wifi-densepose-cli/src/calibrate.rs:112-119`）。把它当成调试时用的应急开关，不是缩短安装流程的正规做法。

命令行还会单独拒绝 `--duration-s` 小于 10 秒的情况（`"Fewer frames produce unreliable phase-concentration estimates"`，`calibrate.rs:341-348`），超过 300 秒时只打印警告、不拦截。

**引导录入（`enroll`）的下限低得多，而且是按每个锚点算的。** 8 个引导锚点（`empty`、`stand_still`、`sit`、`lie_down`、`breathe_slow`、`breathe_normal`、`small_move`、`sleep_posture`）的采集时长写死在代码里：静态/动作类锚点 20 秒，两个呼吸锚点和 `sleep_posture` 是 30 秒（`AnchorLabel::duration_s()`，`v2/crates/wifi-densepose-calibration/src/anchor.rs:98-104`）。这**不是**命令行参数——目前没法从命令行单独改某个锚点的采集时长。

在这个固定时长之下，锚点还要通过质量检查才会被**接受**（`AnchorQualityGate`，`v2/crates/wifi-densepose-calibration/src/enrollment.rs:43-53`）：

| 阈值 | 默认值 | 检查什么 |
|---|---|---|
| `min_frames` | **60 帧** | 采到的帧少于 60 就拒绝该锚点——主要是防"采集中途 ESP32 断流"，并不是真的时长要求（按常见速率，60 帧连一秒都不到） |
| `min_presence_z` | 1.5 | 对应该有人在场的锚点，平均幅度 z 分数必须超过这个值，否则按"没检测到人"拒绝 |
| `empty_max_z` | 1.0 | 对 `empty` 锚点，z 分数必须低于这个值，否则按"房间不空"拒绝 |
| `max_still_motion` | 0.6（60%） | 对静止类锚点，被标记为有动作的帧占比超过这个值就按"动作太多"拒绝 |
| `min_move_motion` | 0.3（30%） | 对 `small_move`，有动作的帧占比低于这个值就按"动作不够"拒绝 |

被拒绝的锚点会重新提示采集，最多重试 `--attempts` 次（默认 **2** 次）。如果重试完还是不合格，`enroll` 会跳过它继续往下走，并记录 `"moving on without '<label>'"` —— 录入**不会中止**，你最后拿到的是一组不完整的锚点。

**`train-room` 本身几乎不检查什么。** 它只在录入文件里**一个**合格锚点都没有时才退出（`v2/crates/wifi-densepose-cli/src/room.rs:246-248`，提示 `"no accepted anchors … re-run enroll"`）。除此以外没有"至少要几个锚点"的要求。锚点不全时实际发生的是：某些专用模型悄悄训练失败，最后生成的模型组里干脆没有它——例如（来自 `v2/crates/wifi-densepose-calibration/src/specialist.rs`）：

- **在场检测** 需要 `empty` 锚点，外加至少一个"预期有人在场"的锚点；缺任一个，`PresenceSpecialist::train()` 就返回 `None`，这个模型组里就没有在场检测能力。
- **异常检测** 需要至少 2 个锚点，种类不限。
- **躁动检测** 需要 `sleep_posture`（或退而求其次用 `lie_down`）**以及** `small_move`。
- **姿态识别** 需要至少一个能确定姿态的锚点（`stand_still`、`sit`、`lie_down` 或 `sleep_posture`）。

所以一次"成功"的 `train-room`，如果录入时没采够它需要的锚点，产出的模型组仍可能缺一个或多个专用模型。用 `room-status`（`v2/crates/wifi-densepose-cli/src/room.rs`）查一下到底训出了什么。

### 我们没能核实的部分

ADR-151 设计文档（§2.2）说整个引导录入"约 4 分钟"——按代码里写死的每个锚点时长算，这个数字对得上（5 × 20 秒 + 3 × 30 秒 = 190 秒 ≈ 3.2 分钟，加上每个锚点前 3 秒倒计时约 +24 秒，合计 3.5～4 分钟，与代码一致）。但我们**没有找到任何集成测试或实测数据，能证明这个时长足够让专用模型达到可靠精度**——ADR 自己的状态小节也写明，完整的 `baseline → enroll → train-room → infer` 流程只针对**确定性合成 CSI** 验证过（`tests/full_loop.rs`），还没有在真实硬件的空房间里从头到尾跑过。请把默认时长当成合理的代码默认值，而不是经过验证的"真实场景精度下限"。

---

## 2. 没有硬性下限的地方，建议采多久？

有硬性下限的地方（基线 600 帧、每锚点 60 帧）上面已经写了。除此之外：

- **基线采集**：用命令行默认值（`--duration-s 30`）就行，600 帧下限就是按假设的 20 Hz 感知速率围绕它设计的。ADR-135 §2.3 论证 30 秒是让相位集中度估计的标准差保持在 0.02 rad² 以内的最短时长，引用了已发表的圆形统计误差界——但那只是给**默认值**找的论文依据，除了 600 帧检查之外，代码里并没有据此再加一道时长下限。
- **录入锚点**：用内置的单锚点时长（20 秒 / 30 秒）——反正目前命令行也改不了。

---

## 3. 宠物会被算成"有人"吗？

**如实回答：代码里没有任何办法把宠物（或任何小动物尺度的动作）和人区分开。** 这是真实存在的限制，不是已经解决的问题——这里明确标出来，不做猜测。

在场检测（`PresenceSpecialist`，`v2/crates/wifi-densepose-calibration/src/specialist.rs:100-198`）只用录入期间测到的两个数值通道来训练：

- CSI 幅度序列的**方差**，阈值取 `empty` 锚点方差与"有人"锚点平均方差的中间值；
- **均值偏移** —— `|mean − empty_mean|`，阈值取空房间→有人状态的均值距离的一半。

只要**任一**通道越过阈值，就判定"有人"。两个阈值完全是从你录入锚点的幅度统计里学出来的——这段代码里没有体型、RCS（雷达散射截面）、多普勒特征或任何其他物理量，能用来区分"一个成年人在走动"和"一只猫路过""一条狗跳上沙发"。如果宠物的动作对 CSI 幅度的扰动，跟你录入时 `small_move` 锚点的幅度差不多，`PresenceSpecialist` 就会判成有人，因为这个阈值量到的本来就是这个东西。

最接近"防护"的是 `AnomalySpecialist`（`specialist.rs:386-448`），一个通用的异常检测器：当实时窗口在嵌入距离上离所有已录入锚点都很远时，就标成"异常"。它**不是**验证过的宠物过滤器——任何统计上不寻常的信号都可能被标成异常或正常，取决于它碰巧离你的哪个锚点更近，并不保证能区分物种或动作来源。一只动作模式恰好像 `small_move` 锚点的宠物，根本不会被标成异常。

**家里养宠物的实际结论：** 在场/姿态读数偶尔会因宠物动作而触发，体型大的动物、或靠近传感器的动作尤其容易。目前没有配置项、也没有代码路径可以屏蔽这种情况。

---

## 4. 空房间基线需要"日常状态"（空调开着）还是绝对安静？

简短答案，从基线的实际算法出发：**一个持续运行、位置固定的干扰源（风扇、空调风机、加湿器），只要在整个采集窗口里一直存在，就会被算进"空房间"的含义里，之后自然被减掉** —— 这是统计方式带来的直接结果，不是需要你去配置的功能。

`CalibrationRecorder` 用 Welford 在线算法，对你喂进去的每一帧逐子载波累计滑动均值和方差（`ruvsense/calibration.rs`）。如果采集基线时风扇一直稳定转着，它对每帧的贡献都一样，会被均摊进 `amp_mean` / `amp_variance`，于是得到的基线本来就代表"风扇开着的空房间"；运行时 `BaselineCalibration::subtract()` 减掉的正是这个参考值，所以房间处在同样稳态时会读作安静。ADR-135 §1.1 写明了这个设计意图：基线相减的意义就是去掉"硬件带来的增益偏差和环境里固定的多径"，免得那些一直在的东西把下游的动作检测触发。

**真正要紧的是前后一致，不是安静**：按房间平时真实使用时的背景状态去采基线（空调、风扇照常开），并尽量在整个采集窗口里保持这个稳态不变。代码没法修正的是**采到一半背景变了**（比如 30 秒的采集里，第 15 秒空调启动）——那会把 Welford 均值/方差拉到一个两边都不像的中间态，"空调关"和"空调开"哪个都对不上。

采集过程中有一个**实时保护**能抓到明显的问题：`--abort-z-threshold`（默认 `2.0`）在逐帧幅度 z 分数的中位数连续 20 个横幅周期都超过阈值时中止采集（`v2/crates/wifi-densepose-cli/src/calibrate.rs:82-83, 163-178`）。它是用来抓"采集中途有人走过"的，不一定能抓短时机械噪声——我们没找到专门针对空调启停场景测试过它的用例，所以"采集中途电器启动"时它表现如何，尚未验证。

### 我们没能核实的部分 —— 以及一个值得知道的设计落差

ADR-135 §2.5 描述了一套复杂得多的"基线过期检测"：由持续 z 分数算出 `drift_score`、漂移持续一段时间后发出 `BaselineDrift` 事件、再通过感知 WebSocket 发布 `baseline_stale` 标志。**我们去查了真实的 `calibration.rs` 实现，这些在代码里一个都没有** —— `v2/crates/wifi-densepose-signal/src/ruvsense/calibration.rs` 里既没有 `drift_score` 字段，也没有 `BaselineDrift` 事件，更没有 `baseline_stale` 标志。ADR-135 那部分是设想中的设计，不是已交付的行为。

真正实现了的，是另一层上简单得多的检查，针对**训练好的模型组**（不是原始基线）：`SpecialistBank` 会记下训练时用的 `baseline_id`，`SpecialistBank::is_stale()`（`v2/crates/wifi-densepose-calibration/src/bank.rs:102-104`）在**当前**基线 id 与训练时 id 不一致时就返回 `true`。重跑 `calibrate` 总会生成新的基线 id，所以**任何一次**重新校准——不管是挪了家具、基线确实过期，还是只是把命令又跑了一遍——都会立刻把之前所有训练好的模型组标成过期，之后必须重跑 `enroll` 和 `train-room`。这里没有"过期程度"这种分级信号，只有这个非黑即白的 id 比对。

**实操建议：**

1. 让房间处在平时正常的稳态背景里再校准（空调、风扇、冰箱压缩机等照常运行），并在整个 `--duration-s` 窗口里保持这个状态不变。
2. 以后若明显改变了背景条件（挪家具、添了常开的电器、改了空调作息），或发现感知质量下降，就重跑 `calibrate` —— 这是要人主动做的步骤，代码不会替你自动重校准。
3. 重跑 `calibrate` 会让基于旧基线训练的所有模型组失效（就是上面说的 `baseline_id` 不一致）—— 计划好紧接着重跑 `enroll` 和 `train-room`。

---

## 速查：代码里真实存在的命令与默认值

```bash
# 第 1 步 —— 空房间基线。整个采集窗口里房间必须没人。
wifi-densepose calibrate \
  --udp-port 5005 --duration-s 30 --tier ht20 --output ./baseline.bin
# 硬性要求：记录帧数 >= 600 帧，否则校准失败。

# 第 2+3 步 —— 引导录入（8 个固定锚点，合计约 4 分钟）
wifi-densepose enroll --baseline ./baseline.bin --room living-room \
  --output ./enrollment.json --attempts 2

# 第 4 步 —— 用被接受的锚点训练专用模型组
wifi-densepose train-room --enrollment ./enrollment.json \
  --output ./room-bank.json

# 查看实际训出了什么（以及模型组是否已过期）
wifi-densepose room-status --room living-room
```

以上内容的源码依据：
- `v2/crates/wifi-densepose-cli/src/calibrate.rs`
- `v2/crates/wifi-densepose-cli/src/room.rs`
- `v2/crates/wifi-densepose-signal/src/ruvsense/calibration.rs`
- `v2/crates/wifi-densepose-calibration/src/enrollment.rs`
- `v2/crates/wifi-densepose-calibration/src/anchor.rs`
- `v2/crates/wifi-densepose-calibration/src/specialist.rs`
- `v2/crates/wifi-densepose-calibration/src/bank.rs`
- `docs/adr/ADR-135-empty-room-baseline-calibration.md`
- `docs/adr/ADR-151-room-calibration-specialist-training.md`
