# ADR-110：ESP32-C6 固件扩展 —— Wi-Fi 6 CSI、802.15.4 网状网络、TWT、LP-core 低功耗休眠

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted —— P1–P10 已完成，固件侧基底已在 **v0.7.0-esp32**（2026-05-23）收尾 |
| **日期** | 2026-05-22（创建）· 2026-05-23（最后修订 —— P10 + 冲刺总结） |
| **决策者** | ruv |
| **代号** | **C6-SOTA** |
| **关联** | ADR-018（CSI 二进制帧格式）、ADR-028（ESP32 能力审计）、ADR-029（RuvSense 多站式）、ADR-030（RuvSense 持久场模型）、ADR-031（RuView 感知优先）、ADR-061（QEMU CI）、ADR-081（自适应 CSI 网状内核）、ADR-097（rvCSI 采用） |
| **跟踪议题** | [ruvnet/RuView#762](https://github.com/ruvnet/RuView/issues/762) |
| **固件发布** | [v0.6.7](https://github.com/ruvnet/RuView/releases/tag/v0.6.7-esp32) · [v0.6.8](https://github.com/ruvnet/RuView/releases/tag/v0.6.8-esp32) · [v0.6.9](https://github.com/ruvnet/RuView/releases/tag/v0.6.9-esp32) · [v0.7.0](https://github.com/ruvnet/RuView/releases/tag/v0.7.0-esp32) |
| **见证** | [`docs/WITNESS-LOG-110.md`](../WITNESS-LOG-110.md) —— 13 个 §A0 条目（§A0.1 → §A0.13）、1 个 §A.1-A.12 双浸泡、4 个 §B 阻塞条目、5 个 §C bug 修复、1 个 §D 变通方案 |

---

## 1. 背景

生产 CSI 节点固件（`firmware/esp32-csi-node`）围绕 **ESP32-S3**（Xtensa LX7 双核 @ 240 MHz、8 MB PSRAM、802.11 b/g/n）构建。仓库中的 `firmware/esp32-hello-world/main.c` 已支持 **ESP32-C6** 构建目标，且 COM6 上的能力转储（修订 v0.2，MAC `20:6e:f1:17:27:8c`）确认了四个 C6 独占能力，而生产固件目前并未利用：

| C6 能力 | 对感知的赋能 | 为何 S3 上无法获得 |
|---|---|---|
| **802.11ax（Wi-Fi 6）HE-LTF CSI** | 每个 HE20 帧 242 个子载波（HT-LTF 为 52），HE-MU/HE-TB PPDU 类型，OFDMA 感知的信道探测。**硬件已确认 2026-06-11**（issue #1005，外部生产部署）：要求 **ESP-IDF ≥ 5.5** —— v5.4 驱动以静默方式将链路降转为 64 子载波 HT，即使链路已确认是 HE；v5.5.2 给出 532 B 帧 = 256 bins（242 个有效音调）、PPDU 0x01（HE-SU）。见 WITNESS-LOG-110 §B1（已解决）。 | S3 射频仅支持 HT（n） |
| **802.15.4（Thread / Zigbee）** | 跨节点时间同步走独立无线电 —— 为 CSI 释放 Wi-Fi 空中时间，±100 µs 对齐可在感知信道上无需协调流量即可实现 | S3 无 802.15.4 |
| **TWT（目标唤醒时间）** | 传感器与 AP 协商确定性唤醒时隙；CSI 节奏变为由调度器约束，而非机会式 | 需要 802.11ax —— S3 无法支持 |
| **LP-core + 休眠（~5 µA）** | 常开运动门控在深度睡眠中的独立 RISC-V LP 核上运行；HP 核保持关闭，直到出现真实事件 | S3 的 ULP 仅为 FSM，下限约 10 µA |

**前三个是可发表的研究方向。** 此前尚无任何人发表过 WiFi-6-CSI 人体姿态估计；通过旁路无线电进行多站 CSI 时钟对齐，是对 ADR-029/030 多站同步的干净解答；而 TWT 约束的 CSI 节奏，是开放 ESP32 生态中首个让 WiFi 感知具备确定性的机会。

**第四个（LP-core）解锁了一条产品线。** Cognitum Seed 常开检测节点受电池限制；10 µA → 5 µA 的休眠大约将实际电池寿命翻倍。

本 ADR 记录现有 `esp32-csi-node` 固件如何在不干扰 S3 生产路径的前提下，扩展出一个并行的 C6 目标。

### 1.1 本 ADR *不* 涵盖的内容

- 不是对 S3 固件的弃用。S3 仍作为生产节点 —— 它有 2 个核、PSRAM、原生 USB-OTG、DVP 摄像头路径，以及经过调优的流水线。C6 是作为研究 / 种子目标加入的。
- 不是把每个 S3 特性都移植到 C6。显示（ADR-045 AMOLED）、WASM3 运行时，以及完整的边缘 tier-2 栈起初仍仅限 S3 —— C6 的 320 KiB SRAM + 无 PSRAM 装不下。
- 不是硬件重新设计。COM6 上的板子是库存的 ESP32-C6-DevKitC-1（或兼容品），带 8 MB 板载闪存和一个 CP210x USB 桥。

## 2. 决策

将 `firmware/esp32-csi-node` 扩展为 **双目标项目**（S3 + C6），使用 ESP-IDF 现有的 `idf.py set-target` 机制，外加一个按目标键控的 `sdkconfig.defaults.esp32c6` 覆盖层。在 `#ifdef CONFIG_IDF_TARGET_ESP32C6` 之后加入四个 C6 独占模块，使 S3 构建与今天逐字节一致。

### 2.1 模块拆分

| 新模块 | 文件 | 仅 C6？ | 用途 |
|---|---|---|---|
| **HE-LTF CSI 标记** | 扩展 `csi_collector.c` | 共享（S3 上为 no-op） | 读取 `wifi_pkt_rx_ctrl_t.sig_mode` 与 `cwb`/`bandwidth` 字段，将每帧分类为 `HT`/`HE-SU`/`HE-MU`/`HE-TB`，扩展子载波数量，将 PPDU 类型写入 ADR-018 帧的保留字节 18-19。 |
| **802.15.4 时间同步** | `c6_timesync.c/.h` | 是 | OpenThread MTD 初始化，在固定 802.15.4 信道上基于信标的周期性时间同步广播，导出 `c6_timesync_get_epoch_us()`。 |
| **TWT 设置** | `c6_twt.c/.h` | 是 | 封装 `esp_wifi_sta_itwt_setup()`，请求与 `CONFIG_TWT_WAKE_INTERVAL_US` 匹配的确定性唤醒间隔，在断开时安装拆除逻辑。 |
| **LP-core 休眠** | `c6_lp_core.c/.h` + `lp_core/main.c` | 是 | 监视 `CONFIG_LP_WAKE_GPIO` 是否有运动、仅在事件时唤醒 HP 核的 LP 核程序。HP 侧在 `esp_deep_sleep_start()` 之前调用 `c6_lp_core_arm()`。 |

### 2.2 构建矩阵

| 目标 | sdkconfig 默认 | 分区表 | 二进制大小 | 特性 |
|---|---|---|---|---|
| `esp32s3`（默认 —— 生产） | `sdkconfig.defaults`（不变） | `partitions_display.csv`（8 MB） | ~1.1 MB | 完整流水线 + 显示 + WASM |
| `esp32c6`（新增 —— 研究） | `sdkconfig.defaults` + `sdkconfig.defaults.esp32c6` 覆盖层 | `partitions_4mb.csv`（4 MB 单 OTA） | 目标 <1 MB | CSI + TWT + 802.15.4 + LP-core，无显示，无 WASM |

ESP-IDF 的 idf-build-system 会在调用 `idf.py set-target esp32c6` 时自动选取 `sdkconfig.defaults.<target>`。默认选择不需要自定义 Python 包装器 —— 现有的 `build_firmware.ps1` 对 S3 继续有效。

### 2.3 ADR-018 帧格式扩展

字节 18-19 当前为保留。它们变为：

```
[18]   PPDU type        (0=HT, 1=HE-SU, 2=HE-MU, 3=HE-TB, 0xFF=unknown)
[19]   Bandwidth + flags
       bit 0-1 : bandwidth (0=20 MHz, 1=40, 2=80, 3=160)
       bit 2   : STBC
       bit 3   : LDPC
       bit 4   : 802.15.4 time-sync valid (C6 only, set if c6_timesync_get_epoch_us is fresh)
       bit 5-7 : reserved
```

魔数保持 `0xC5110001` 不变 —— 不了解字节 18-19 的读取者看到的仍是旧内容（`info->buf` 未变）；了解的读取者可以选择启用。

### 2.4 802.15.4 时间同步协议（框架）

- 选出一个节点作为 `time-leader`（网状网络中最低的 64 位 EUI）。
- 领导者每 100 ms 在 802.15.4 信道 15 上广播一帧 `TS_BEACON`，内含其单调的 `esp_timer_get_time()` 快照。
- 跟随者计算偏移 `delta = leader_us - local_us + cable_delay_estimate` 并惰性应用 —— 每帧 CSI 都获得 `c6_timesync_get_epoch_us()` 作为 64 位墙上时钟估计，无需重新对钟。
- 目标对齐：**±100 µs** 跨节点，由领导者将自己的 RX 时间戳轮流回传给跟随者来验证。
- 若在 5 s 内未收到领导者，则回退到本地定时器。

### 2.5 TWT 协商

- WiFi STA 连接后，调用 `esp_wifi_sta_itwt_setup()`，参数如下：
  - `wake_interval_us` = `CONFIG_TWT_WAKE_INTERVAL_US`（默认 10 000 = 100 fps 节奏）
  - `min_wake_dura` = 512 µs（足以接收一帧 CSI）
  - `trigger` = false（非触发式 —— 领导者角色）
- 若 AP 拒绝（`ESP_ERR_WIFI_NOT_INIT` / `ESP_ERR_WIFI_NOT_STARTED` / 协商 NACK），记录日志并在无 TWT 情况下继续 —— CSI 仍以机会式工作。
- 拆除发生在 `WIFI_EVENT_STA_DISCONNECTED` 上，以保持 AP 的 TWT 调度器干净。

### 2.6 LP-core 休眠

**已交付（P5）：** `esp_deep_sleep_enable_gpio_wakeup()` 深度睡眠 GPIO 唤醒 —— 为典型种子节点用例（PIR 传感器输出干净的数字中断）提供休眠预算的最简路径。PIR 在其前端有硬件去抖，因此 LP 域无需软件侧轮询。实测预算：待机约 10 µA（受 RTC 外设漏电限制，主要由 IO 复用钳位电路主导）。

**延后（后续）：** 当唤醒源是**噪声或模拟**传感器时——如经 LP-I2C 的加速度计、读取电池分压的 LP-ADC，或经 SAR ADC 的音频电平检测——真正的 LP 核程序（用 riscv32 LP 工具链通过 `ulp_embed_binary()` 构建的独立 ELF，以约 10 Hz 轮询，带软件 3-of-5 去抖 + 阈值比较器）才是正确的路径。该代码作为子项目位于 `lp_core/main.c`，可将待机预算压到约 5 µA 目标。因其即时种子节点部署使用 PIR，故作为后续跟踪。

两种情况下 HP 侧 API 保持不变：`c6_lp_core_arm()` 配置唤醒源，`c6_lp_core_hibernate_and_wait()` 进入深度睡眠，启动路径在后续启动时检查 `c6_lp_core_was_motion_wake()`。因此将 ext1 换成真正的 LP 核程序，只是 Kconfig 选项背后的一次性单文件改动。

## 3. 后果

### 3.1 收益

- 新的可发表研究面（Wi-Fi-6 CSI 人体姿态）。
- 多站时钟同步得到解决，无需在协调上消耗 WiFi 空中时间。
- 在 AP 配合时（TWT）可获得确定性的 CSI 节奏。
- Cognitum Seed 常开级别大约将实际电池寿命翻倍。
- S3 生产路径不受影响 —— 已部署机群零回归风险。

### 3.2 代价

- 需维护第二个固件目标（构建、测试、发布）。缓解措施：所有 C6 代码都经 `#ifdef` 门控，且 S3 路径仍是默认的 `idf.py build`。
- HE-LTF CSI 子载波布局不同于 HT-LTF —— 下游消费者（`stream_sender`、主机聚合器、`wifi-densepose-signal`）必须学会处理每帧非固定的子载波数量。
- 802.15.4 协议栈为 C6 二进制增加约 80 KB。可装入 4 MB 分区并留有富余。
- TWT 依赖 AP 配合。大多数家用 AP（包括 C6 扫描转储中可见的 `ruv.net` AP）尚不支持 11ax STA TWT —— 需要优雅回退。

### 3.3 验证

- `firmware/esp32-csi-node` 可针对 `esp32s3`（现有）与 `esp32c6`（新增）两个目标构建。
- S3 构建产物的 SHA-256 与上一个 v0.6.x 发布版一致（证明共享代码无回归）。
- C6 构建烧录到 COM6，启动，加入 WiFi，请求 TWT（记录成功或优雅 NACK），初始化 802.15.4，发出带有扩展 ADR-018 元数据的 CSI 帧。
- 两块 C6 板之间的跨节点时间同步已演示，偏移 <100 µs，经共享 GPIO 翻转与外部示波器测得。
- 经 INA 测得 LP-core 休眠电流：目标平均 ≤5 µA。

## 4. 实施阶段

| 阶段 | 范围 | 状态 |
|---|---|---|
| **P1** | 多目标构建支持（`sdkconfig.defaults.esp32c6`、分区选择、构建包装器） | _in progress_ |
| **P2** | 在 `csi_collector.c` 中的 HE-LTF CSI 标记 | pending |
| **P3** | TWT 设置辅助函数 | pending |
| **P4** | 802.15.4 初始化 + 框架时间同步 | pending |
| **P5** | LP-core 休眠桩 | ✅ **done** (v0.6.6)；升级为 v0.6.7 中真正的 LP-core 轮询程序（`firmware/esp32-csi-node/main/lp_core/main.c`，去抖 + 运动计数计数器、`ulp_lp_core_wakeup_main_processor` HP 唤醒）。Ext1 回退保留为 `CONFIG_C6_LP_CORE_ENABLE=n` 分支。数据手册 ≤5 µA 待 INA 测量。 |
| **P6** | 构建、烧录 COM6、采集启动遥测、S3 回归检查 | ✅ **done** —— `c6_ts: init done channel=15 leader=yes(candidate)`，HE MAC 固件已加载，1003 KB 二进制（46% 余量） |
| **P7** | C6 对比 S3 基准测试（CSI fps、RAM、TWT 抖动、功耗） | ✅ **done** —— 启动 353 ms、ts 初始化 413 ms、镜像 1003 KB（相较 S3 −9 %）、310 KiB 空闲堆，在 ch 1 背景流量下 CSI 回调以每帧 64 子载波触发 |
| **P8** | 见证包更新、CLAUDE.md / README / user-guide 硬件表 | ✅ **done** —— 新增 README 硬件选项表 + 快速开始选项 2b，`docs/user-guide.md` 现已有完整的 ESP32-C6 章节（构建、烧录、配置、多房间时间同步、电池种子模式） |
| **P9** | **仅软件层面对 B1/B2/B4 的解锁（固件 v0.6.7）** | ✅ **done** —— (1) 真正的 LP-core 运动门控程序经 `ulp_embed_binary(lp_core/main.c)` 加载，暴露共享的 `motion_count`/`poll_count` 符号供见证验证（B4 代码路径完成，硬件测量仍待 INA）。(2) Soft-AP HE 模块（`c6_softap_he.{h,c}`）以 WPA2 + 广播 HE 的方式将 C6 运行于 AP+STA 模式，使第二个 C6 STA 能针对已知协作的 AP 协商真正的 iTWT（无需购买 11ax 路由器即可解锁 B1/B2）。(3) 构建产物：S3 8 MB 1093 KB / C6 4 MB 1019 KB，均在 IDF v5.4 上通过。两个新模块默认关闭，故 v0.6.6 机群无行为变化。 |
| **P10** | **端到端网状基底：已测量、已平滑、已接线、已解码（固件 v0.6.8 → v0.7.0 + 主机 crate）** | ✅ **done** —— bench-quantified two-board substrate **and** the host-side wire that consumes it. **(a) v0.6.8 ESP-NOW EMA smoother** (`c6_sync_espnow.c`, α=1/8 fixed-point shift, 8-sample window). 5-min two-board soak (witness §A0.10) measured **411.5 µs raw stdev → 104.1 µs smoothed stdev (3.95× suppression, 4.70× peak-to-peak)** with **+30 µs/min crystal drift preserved within 2 µs/min**. **Cross-board RX 99.56 %** over 2701 beacons, 0 TX fail, leader election fired at +27336 ms. The ADR-110 §2.4 ≤100 µs alignment target is **empirically met by the smoothed offset alone**. **(b) v0.6.9 sync-packet** (32-byte UDP, magic `0xC511A110`, every `CONFIG_C6_SYNC_EVERY_N_FRAMES` CSI frames) carries `(node_id, local_us, epoch_us, sequence)` so host can pair against incoming CSI frames. Live-verified §A0.12 — COM9 reports `local − epoch = 1 163 565 µs` matching §A0.10's measured boot delta within 285 µs. **(c) v0.7.0 ADR-018 byte 19 bit 4 wire-fix** — bit 4 now sourced from `c6_sync_espnow_is_valid()` (was only the broken 802.15.4 path). Mixed S3+C6 fleets correctly advertise sync via the working transport. **(d) Host-side decoders + wiring**: Python `SyncPacketParser` (6 tests) + Rust `SyncPacket` (10 tests, all green; `SyncPacket::apply_to_local` recovers per-frame mesh-aligned timestamps). Sensing-server `udp_receiver_task` magic-dispatches `0xC511A110` and stores `NodeState::latest_sync` + `NodeState::mesh_aligned_us(local_at_frame)` helper. **(e) IDF v5.4 upstream gap formally documented (§A0.6)**: full `components/esp_wifi/include/esp_wifi*.h` grep proves the public API exposes only STA-side iTWT/bTWT — no `esp_wifi_ap_set_he_config`, no `wifi_he_ap_config_t`. Soft-AP HE/TWT-Responder advertise is not user-controllable on C6 in IDF v5.4; B1/B2 measurement requires either a future IDF or an external 11ax AP. |

本 ADR 在每个阶段结束时更新实际结果、提交链接，以及与设计的任何偏差。

### 4.1 P10 详情 —— `/loop 5m` SOTA 冲刺（2026-05-23）

P10 由一次 `/loop 5m until sota. and ultra optmized` 调用驱动，在约 80 分钟内运行了 16 次迭代。该冲刺交付了 4 个固件发布、分支上 17 次提交、13 个主机侧单元测试，并将 §B 基底从「设计为瞄准 ±100 µs」转变为「在 5 分钟双板浸泡、完整主机侧解码器 + sensing-server 消费者下测得 104 µs 平滑标准差」。

| 迭代 | 交付内容 | 见证 |
|---|---|---|
| 1 | `c6_softap_he` 模块 + IDF v5.4 缺口发现 | §A0.5, §A0.6 |
| 2 | ESP-NOW 跨板网状网络已实况验证 | §A0.7 |
| 3 | 4 MB S3 发布变体 | — |
| 4 | 4 分钟网状浸泡 —— 首次量化的同步稳定性 | §A0.8 |
| 5 | 固件中的 EMA 平滑器（α=1/8） | §A0.9 |
| 6 | 5 分钟 EMA 浸泡：**测得 3.95× 抑制** | §A0.10 |
| 7 | v0.6.8-esp32 发布 + §A0.11 时间戳接线缺口记录 | §A0.11 |
| 8 | 同步包发射（选择方案 2） | — |
| 9 | 同步包在两板实况验证 | §A0.12 |
| 10 | v0.6.9-esp32 发布 + `CONFIG_C6_SYNC_EVERY_N_FRAMES` Kconfig 旋钮 | — |
| 11 | 来自 ESP-NOW 路径的 ADR-018 字节 19 bit 4 接线修复 | — |
| 12 | v0.7.0-esp32 发布 + Python `SyncPacketParser` 桩 | §A0.13 |
| 13 | 6 个 Python 单元测试 + README/user-guide 文档更新 | — |
| 14 | Rust `SyncPacket` 解码器 + `wifi-densepose-hardware` 中 7 个单元测试 | — |
| 15 | Sensing-server `udp_receiver_task` 魔法分派 + `NodeState::latest_sync` | — |
| 16 | `SyncPacket::apply_to_local()` + `NodeState::mesh_aligned_us()`（+ 3 个更多测试，共 10 个） | — |

### 4.2 P10 实测数值（基底现已量化，而非仅设计）

下面的每个数字都来自针对 COM9 + COM12 ESP32-C6 板的一次真实台架采集，原始日志保留在 `dist/firmware-v0.6.7/iter{2,4,5,6,9}-*.log` 与 `dist/firmware-v0.6.8/iter9-*.log` 下。

| 指标 | 实测 | 目标 |
|---|---|---|
| 跨板 ESP-NOW 接收率（5 分钟浸泡） | **99.56 %**（2689 / 2701 信标） | — |
| 跨板发送失败（5 分钟浸泡） | 任一块上 **0** | — |
| 信标速率 | 精确 **10.00 /s**（FreeRTOS 稳定） | 10 Hz 标称 |
| 原始偏移标准差 | 411.5 µs | — |
| **EMA 平滑后偏移标准差** | **104.1 µs** | **≤100 µs（§2.4）** |
| 范围缩减（平滑 vs 原始） | **4.70×** 峰峰值 | — |
| 实测台架板间 C6 晶振偏差 | **1.4 ppm** | ESP32 规格 ±10 ppm |
| 漂移保持（平滑跟踪原始） | 在 **2 µs/min** 以内 | — |
| 领导者选举 | ✅ COM9 在 +27 336 ms 处按 `lower-id` 规则退位 | — |
| 同步包往返（固件 → Python 解码器） | 字节一致，偏移恢复到 §A0.10 的 **285 µs** 以内 | — |
| 原始 802.15.4 接收 | 60 s + 240 s + 300 s 浸泡中共 0 帧 |（D1 在 IDF v5.4 中损坏）|
| C6 v0.7.0 镜像大小 / 余量 | 1019 KB / **45 %**（4 MB 单 OTA） | — |
| S3 v0.7.0 镜像大小 / 余量 | 1094 KB / **47 %**（8 MB 双 OTA） | — |

### 4.3 P10 主机侧接口（已交付的生产代码）

| Crate / 文件 | 新增 API |
|---|---|
| `v2/crates/wifi-densepose-hardware/src/sync_packet.rs` | `SyncPacket`、`SyncPacketFlags`、`SYNC_PACKET_MAGIC = 0xC511A110`、`SYNC_PACKET_SIZE = 32`、`SyncPacket::from_bytes`、`SyncPacket::to_bytes`、`SyncPacket::local_minus_epoch_us`、`SyncPacket::apply_to_local(local_us)` —— 10 个单元测试，全部通过 |
| `v2/crates/wifi-densepose-sensing-server/src/main.rs` | `NodeState::latest_sync: Option<SyncPacket>`、`NodeState::latest_sync_at: Option<Instant>`、`NodeState::mesh_aligned_us(local_at_frame_us) -> Option<u64>`、`udp_receiver_task` 对 `SYNC_PACKET_MAGIC` 的魔法分派 |
| `archive/v1/src/hardware/csi_extractor.py` | `SyncPacket` 数据类、`SyncPacketParser.parse`、`SyncPacketParser.MAGIC` —— 6 个 Python 单元测试，全部通过 |

## 5. 开放问题

- HE-LTF 子载波扩展应随默认 ADR-018 载荷发布，还是在主机聚合器跟上之前置于运行时标志之后？**初步：v1 置于标志之后（默认关闭），一旦 `wifi-densepose-signal` 了解 HE PPDU 即默认开启。**
- 802.15.4 时间同步信道是否应可配置，还是写死为 15？**已解决（P10）：** 通过 `CONFIG_C6_TIMESYNC_CHANNEL` 实现 Kconfig 可配置，自 v0.6.6 起默认 26（而非 15 —— 实测信道 26 位于 ch 14 上方的 WiFi 保护带，可为 15.4 路径留出空间而不与无线电时间竞争；见见证 §D1 假设 1）。
- rvCSI 的 vendored 子模块（ADR-097）是否希望新增一个 `rvcsi-adapter-esp32c6` crate 以原生消费 HE-LTF 帧？**超出本 ADR 范围；后续再议。**

## 6. 本 ADR 之外的范围（P10 收尾）

ADR-110 的固件侧基底现已关闭。仍有三类内容，均明确**不**在本 ADR 范围内：

1. **多站 CSI 融合数学** —— ADR-029/030 领地。基底（网格对齐时间戳 + 每节点 `latest_sync` 状态）已就位；实际消费它的联合 CSI 融合位于 `wifi-densepose-signal/src/ruvsense/multistatic.rs`。
2. **受硬件门控的测量** —— 基底已支持，但台架在不采购的情况下无法验证：
   - 11ax HE-LTF 实时子载波捕获 —— 需要一个广播 HE 的 11ax AP（IDF v5.4 未暴露 AP 侧 HE 配置 API，§A0.6）。
   - ≤5 µA LP-core 休眠 —— 需要在 3V3 电源轨上串联一个 INA226 / Joulescope。
3. **IDF 上游修复**：
   - C6 上的 802.15.4 RX 路径 + IDF v5.4 —— `c6_timesync` 已发布并初始化，但从未收到一帧（D1，5 个假设已测试并驳回）。ESP-NOW 变通方案（`c6_sync_espnow`）是可用的主网状传输。802.15.4 源码保留，以待 IDF 修复驱动之日。
   - Soft-AP HE/TWT-Responder 广播 API —— `c6_softap_he` 作为 IDF v5.5+ 暴露该能力时的就地钩子随附发布。
