# ADR-040：WASM 可编程感知（第 3 层）

**状态**：Accepted
**日期**：2026-03-02
**决策者**：@ruvnet

## 背景

ADR-039 实现了 ESP32-S3 边缘智能流水线的第 0–2 层：
- **第 0 层**：原始 CSI 透传（魔数 `0xC5110001`）
- **第 1 层**：基础 DSP——相位解卷绕、Welford 统计、Top-K、增量压缩
- **第 2 层**：完整流水线——生命体征、在位检测、跌倒检测、多人检测

固件占用约 820 KB flash，在 1 MB OTA 分区中仅剩约 80 KB 余量。ESP32-S3 具备 8 MB PSRAM 可用于运行时数据。新的感知算法（手势识别、信号相干性监测、对抗检测）当前需要整片固件重刷——对已经部署的传感器网络而言不切实际。

项目已有 35+ 个 RuVector WASM crate 和 28 个预编译的 `.wasm` 二进制，但都没有集成进 ESP32 固件。

## 决策

新增一个**第 3 层 WASM 可编程感知层**，执行由 Rust 编译到 `wasm32-unknown-unknown` 的热加载算法，在设备上通过 WASM3 运行时解释执行。

### 架构

```
Core 1 (DSP Task)
┌──────────────────────────────────────────────────┐
│ Tier 2 Pipeline (existing)                       │
│   Phase extract → Welford → Top-K → Biquad →    │
│   BPM → Presence → Fall → Multi-person           │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ Tier 3 WASM Runtime (new)                    │ │
│ │   WASM3 Interpreter (MIT, ~100 KB flash)     │ │
│ │   ┌────────────┐ ┌────────────┐              │ │
│ │   │ Module 0   │ │ Module 1   │ ...×4        │ │
│ │   │ gesture.wm │ │ coherence  │              │ │
│ │   └─────┬──────┘ └─────┬──────┘              │ │
│ │         │               │                     │ │
│ │    Host API ("csi" namespace)                 │ │
│ │    csi_get_phase, csi_get_amplitude, ...      │ │
│ └──────────────────────────────────────────────┘ │
│                      │                           │
│              UDP output (0xC5110004)              │
└──────────────────────────────────────────────────┘
```

### 组件

| 组件 | 文件 | 说明 |
|-----------|------|-------------|
| WASM3 组件 | `components/wasm3/CMakeLists.txt` | ESP-IDF 托管组件，从 GitHub 拉取 WASM3 |
| 运行时宿主 | `main/wasm_runtime.c/h` | WASM3 环境、模块槽位、宿主 API 绑定 |
| HTTP 上传 | `main/wasm_upload.c/h` | 端口 8032 上用于模块管理的 REST 端点 |
| Rust WASM crate | `wifi-densepose-wasm-edge/` | 编译为 WASM 的 `no_std` 感知算法 |

### 宿主 API（“csi” 命名空间）

| 导入 | 签名 | 说明 |
|--------|-----------|-------------|
| `csi_get_phase` | `(i32) -> f32` | 指定子载波索引的当前相位 |
| `csi_get_amplitude` | `(i32) -> f32` | 当前幅度 |
| `csi_get_variance` | `(i32) -> f32` | Welford 运行方差 |
| `csi_get_bpm_breathing` | `() -> f32` | 来自第 2 层的呼吸 BPM |
| `csi_get_bpm_heartrate` | `() -> f32` | 来自第 2 层的心率 BPM |
| `csi_get_presence` | `() -> i32` | 在位标志（0/1） |
| `csi_get_motion_energy` | `() -> f32` | 运动能量标量 |
| `csi_get_n_persons` | `() -> i32` | 检测到的人数 |
| `csi_get_timestamp` | `() -> i32` | 自启动以来的毫秒数 |
| `csi_emit_event` | `(i32, f32) -> void` | 向宿主发出自定义事件 |
| `csi_log` | `(i32, i32) -> void` | 来自 WASM 内存的调试日志 |
| `csi_get_phase_history` | `(i32, i32) -> i32` | 复制相位历史环形缓冲 |

### 模块生命周期

| 导出 | 调用时机 | 说明 |
|--------|--------|-------------|
| `on_init()` | 模块启动时，一次 | 初始化模块状态 |
| `on_frame(n_sc: i32)` | 每 CSI 帧（约 20 Hz） | 处理当前帧 |
| `on_timer()` | 可配置间隔 | 周期性任务 |

### 线协议（魔数 `0xC5110004`）

| 偏移 | 类型 | 字段 |
|--------|------|-------|
| 0-3 | u32 LE | 魔数 `0xC5110004` |
| 4 | u8 | 节点 ID |
| 5 | u8 | 模块 ID（槽位索引） |
| 6-7 | u16 LE | 事件计数 |
| 8+ | Event[] | (u8 类型, f32 值) 元组数组 |

### HTTP 端点（端口 8032）

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST` | `/wasm/upload` | 上传 .wasm 二进制（最大 128 KB） |
| `GET` | `/wasm/list` | 列出已加载模块及其状态 |
| `POST` | `/wasm/start/:id` | 启动一个模块 |
| `POST` | `/wasm/stop/:id` | 停止一个模块 |
| `DELETE` | `/wasm/:id` | 卸载一个模块 |

### WASM Crate 模块

| 模块 | 来源 | 事件 | 说明 |
|--------|--------|--------|-------------|
| `gesture.rs` | `ruvsense/gesture.rs` | 1（核心） | 用于手势识别的 DTW 模板匹配 |
| `coherence.rs` | `ruvector/viewpoint/coherence.rs` | 2（核心） | 相位相量相干性监测 |
| `adversarial.rs` | `ruvsense/adversarial.rs` | 3（核心） | 信号异常/对抗检测 |
| `vital_trend.rs` | ADR-041 第 1 阶段 | 100-111（医疗） | 临床生命体征趋势分析（呼吸过缓、呼吸过速、心动过缓、心动过速、呼吸暂停） |
| `occupancy.rs` | ADR-041 第 1 阶段 | 300-302（楼宇） | 带分区方差分析的空间占用区域检测 |
| `intrusion.rs` | ADR-041 第 1 阶段 | 200-203（安防） | 状态机入侵检测器（校准-监测-布防-告警） |

### 内存预算

| 组件 | SRAM | PSRAM | Flash |
|-----------|------|-------|-------|
| WASM3 解释器 | ~10 KB | — | ~100 KB |
| WASM 模块存储（×4） | — | 512 KB | — |
| WASM 执行栈 | 8 KB | — | — |
| 宿主 API 绑定 | 2 KB | — | ~15 KB |
| HTTP 上传处理 | 1 KB | — | ~8 KB |
| RVF 解析器 + 校验器 | 1 KB | — | ~6 KB |
| **第 3 层合计** | **~22 KB** | **512 KB** | **~129 KB** |
| **累计（第 0–3 层）** | **~34 KB** | **512 KB** | **~925 KB** |

**实测二进制体积**：925 KB（0xE7440 字节），在 1 MB OTA 分区中剩余 10% 空间。

### NVS 配置

| 键 | 类型 | 默认值 | 说明 |
|-----|------|---------|-------------|
| `wasm_max` | u8 | 4 | 最大并发 WASM 模块数 |
| `wasm_verify` | u8 | 1 | 是否要求签名验证（默认安全） |
| `wasm_pubkey` | blob(32) | — | 用于 WASM 验证的签名公钥 |

## 后果

### 正面
- 无需重刷固件即可向 1000+ 节点部署新感知算法
- 20 年的可扩展周期——通过 .wasm 上传引入新算法
- 算法在 Rust 中开发/测试，编译为可移植的 WASM
- 利用 PSRAM（此前闲置的 8 MB）存储模块
- 在生产部署中对算法做热插拔以进行 A/B 测试
- 同一份 `no_std` Rust 代码可在 ESP32（WASM3）与浏览器（wasm-pack）上运行

### 负面
- WASM3 解释器开销：计算密集型代码比原生 C 慢约 10×
- 增加约 123 KB flash 占用（固件逼近 1 MB 上限的 950 KB）
- 通过 WASM 模块上传端点新增了攻击面
- 在 ESP32 上调试 WASM 模块比原生 C 更难

### 风险

| 风险 | 缓解措施 |
|------|------------|
| WASM3 内存管理可能随时间碎片化石英 PSRAM | 每个槽位在启动时预分配固定的 160 KB 竞技场——无运行时的 malloc/free 循环 |
| 复杂 WASM 模块（>64 KB）可能导致解释器栈溢出 | `WASM_STACK_SIZE` = 8 KB，`d_m3MaxFunctionStackHeight` = 128；模块在加载时校验 |
| HTTP 上传端点需要网络安全 | 默认启用 Ed25519 签名验证（`wasm_verify=1`）；仅可通过 NVS 在实验室/开发环境禁用 |
| 失控的 WASM 模块阻塞 DSP 流水线 | 逐帧预算守卫（默认 10 ms）；连续 10 次故障后模块自动停止 |
| 通过快速上传/卸载循环发起拒绝服务 | 最多 4 个并发槽位；上传处理在复制到 PSRAM 前先校验大小 |

## 实现

- `firmware/esp32-csi-node/components/wasm3/CMakeLists.txt` —— WASM3 的 ESP-IDF 组件
- `firmware/esp32-csi-node/main/wasm_runtime.c/h` —— 带 12 个 API 绑定与清单的运行时宿主
- `firmware/esp32-csi-node/main/wasm_upload.c/h` —— HTTP REST 端点（RVF 感知）
- `firmware/esp32-csi-node/main/rvf_parser.c/h` —— RVF 容器解析器与校验器
- `v2/.../wifi-densepose-wasm-edge/` —— Rust WASM crate，提供 gesture、coherence、adversarial、rvf、occupancy、vital_trend、intrusion 等模块
- `v2/.../wifi-densepose-sensing-server/src/main.rs` —— `0xC5110004` 解析器
- `docs/adr/ADR-039-esp32-edge-intelligence.md` —— 已更新以引用第 3 层

---

## 附录 A：生产环境加固

第 3 层的初始实现解决了五个生产就绪性问题：

### A.1 固定 PSRAM 竞技场

在 PSRAM 上连续运行数天，`heap_caps_malloc` / `free` 循环会
造成内存碎片。取而代之，每个模块槽位在启动时预分配一块**160 KB 的固定竞技场**
（`WASM_ARENA_SIZE`）。WASM 二进制与 WASM3 运行时堆都位于
该竞技场之内。卸载模块会把竞技场清零但绝不释放它——该槽位
会在下一次 `wasm_runtime_load()` 时被复用。

```
Boot:  [arena0: 160 KB][arena1: 160 KB][arena2: 160 KB][arena3: 160 KB]
                                                   Total: 640 KB PSRAM
Load:  [module0 binary | wasm3 heap | ...padding... ]
Unload:[zeroed .......................................]  ← slot reusable
```

这消除了碎片问题，代价是启动时预留 640 KB PSRAM
（8 MB 的 8%）。剩余的 7.36 MB 可供将来使用。

### A.2 逐帧预算守卫

每次 `on_frame()` 调用都用 `esp_timer_get_time()` 计时。若执行
超过 `WASM_FRAME_BUDGET_US`（默认 10 ms = 10,000 us），则记录一次预算故障；
在**连续 10 次故障**之后，模块会被自动停止，进入
`WASM_MODULE_ERROR` 状态。这能防止失控的 WASM 模块阻塞
第 2 层 DSP 流水线。

```c
int64_t t_start = esp_timer_get_time();
m3_CallV(slot->fn_on_frame, n_sc);
uint32_t elapsed_us = (uint32_t)(esp_timer_get_time() - t_start);

slot->total_us += elapsed_us;
if (elapsed_us > slot->max_us) slot->max_us = elapsed_us;

if (elapsed_us > WASM_FRAME_BUDGET_US) {
    slot->budget_faults++;
    if (slot->budget_faults >= 10) {
        slot->state = WASM_MODULE_ERROR;  // auto-stop
    }
}
```

该预算可通过 `WASM_FRAME_BUDGET_US`（Kconfig 或 NVS 覆盖）配置。

### A.3 每模块遥测

`/wasm/list` 端点与 `wasm_module_info_t` 结构体暴露了每模块的
遥测数据：

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `frame_count` | u32 | 自启动以来的 on_frame 总调用次数 |
| `event_count` | u32 | csi_emit_event 总调用次数 |
| `error_count` | u32 | WASM3 运行时错误数 |
| `total_us` | u32 | 累计执行时间（微秒） |
| `max_us` | u32 | 最坏情况下的单帧执行时间 |
| `budget_faults` | u32 | 超出帧预算的次数 |

平均执行时间 = `total_us / frame_count`。这使得远程监测
模块健康状态与性能回归成为可能。

### A.4 默认安全

在 Kconfig 与 NVS 回退路径中，`wasm_verify` 默认值均为 **1**。
上传的 `.wasm` 二进制必须包含有效的 Ed25519 签名（与
OTA 固件相同的密钥）。仅在实验室/开发环境通过以下方式禁用：

```bash
python provision.py --port COM7 --wasm-verify  # NVS: wasm_verify=1 (default)
# To disable in dev: write wasm_verify=0 to NVS directly
```

---

## 附录 B：自适应预算架构（最小割驱动）

### B.1 设计原则

一个控制回路把**感知转化为有界的计算预算**，将预算
花在**稀疏或脉冲式推理**上，并且只**导出增量**。该
预算由**最小割特征值间隙**（CSI 图拉普拉斯的 Δλ = λ₂ − λ₁）驱动，
它反映了场景复杂度：安静的房间 Δλ ≈ 0，
喧闹的房间 Δλ 较大。

### B.2 控制回路

```
                  ┌─────────────────────────────────┐
  CSI frames ───→ │ Tier 2 DSP (existing)            │
                  │  Welford stats, top-K, presence   │
                  └──────────┬────────────────────────┘
                             │
              ┌──────────────▼──────────────────────┐
              │ Budget Controller                    │
              │                                      │
              │  Inputs:                             │
              │    Δλ  = mincut eigenvalue gap        │
              │    A   = anomaly_score (adversarial)  │
              │    T   = thermal_pressure (0.0-1.0)   │
              │    P   = battery_pressure (0.0-1.0)   │
              │                                      │
              │  Output:                             │
              │    B   = frame compute budget (μs)    │
              │                                      │
              │  B = clamp(B₀ + k₁·max(0,Δλ)        │
              │            + k₂·A                    │
              │            − k₃·T                    │
              │            − k₄·P,                   │
              │       B_min, B_max)                   │
              └──────────────┬──────────────────────┘
                             │
              ┌──────────────▼──────────────────────┐
              │ WASM Module Dispatch                 │
              │  Budget B split across active modules│
              │  Each module gets B/N μs per frame   │
              └──────────────┬──────────────────────┘
                             │
              ┌──────────────▼──────────────────────┐
              │ Delta Export                          │
              │  Only emit events when Δ > threshold │
              │  Quiet room → near-zero UDP traffic   │
              └─────────────────────────────────────┘
```

### B.3 预算公式

```
B = clamp(B₀ + k₁·max(0, Δλ) + k₂·A − k₃·T − k₄·P, B_min, B_max)
```

| 符号 | 默认值 | 说明 |
|--------|---------|-------------|
| B₀ | 5,000 μs | 基础预算（5 ms） |
| k₁ | 2,000 | Δλ 敏感度（场景变化越多 → 预算越多） |
| k₂ | 3,000 | 异常 Boost（检测到异常 → 更多计算） |
| k₃ | 4,000 | 温度惩罚（芯片过热 → 更少计算） |
| k₄ | 3,000 | 电池惩罚（电量低 → 更少计算） |
| B_min | 1,000 μs | 下限：始终至少运行 1 ms |
| B_max | 15,000 μs | 上限：绝不超过 15 ms |

### B.4 Δλ 从何而来

最小割图就是第 1/2 层 DSP 已经在维护的**Top-K 子载波相关图**：
子载波是节点；边权是
Welford 窗口上的两两 Pearson 相关幅值。该图的拉普拉斯
该图的拉普拉斯代数连通度（Fiedler 值 λ₂）
近似于最小割值。在 K=8 子载波的 ESP32-S3 上，这
是一个 8×8 特征值问题——可用幂迭代在 <100 μs 内求解。

### B.5 脉冲与稀疏优化

当预算紧张（Δλ ≈ 0，安静房间）时，WASM 模块应当：

1. 若 Δλ < ε，**完全跳过 on_frame**（无场景变化 → 无需计算）
2. **稀疏推理**：仅处理发生变化的最 Top-K 个子载波
   （第 1 层的增量压缩已在跟踪）
3. **脉冲语义**：模块仅在状态发生转移时发出事件，
   而非每一帧都发。宿主跟踪每个模块的“上次发出”
   状态并抑制重复事件。

### B.6 温度与功耗钩子

ESP32-S3 提供：
- `temp_sensor_read()` —— 片上温度（°C）
- 电池电压的 ADC 读数（若已接线）

温度压力：`T = clamp((temp_celsius - 60) / 20, 0, 1)` —— 从
60°C 时的 0 线性上升到 80°C 时的 1.0（过热降频区）。

电池压力：`P = clamp((3.3 - battery_volts) / 0.6, 0, 1)` —— 从
3.3V 时的 0 线性上升到 2.7V 时的 1.0（掉电区）。

### B.7 传输策略

WASM 输出包（`0xC5110004`）采用**仅增量导出**：

- 仅当数值变化超过可配置的死区时才发出事件，
  默认死区为前一值的 5%。
- 安静房间 = 零个 WASM UDP 包（仅有第 2 层生命体征以 1 Hz 输出）
- 喧闹房间 = 突发的 WASM 事件，自然受预算 B 限流

未来工作：采用 QUIC-lite 传输，支持 0-RTT 连接恢复与
拥塞感知的步速控制，以取代 WASM 事件流的原始 UDP。

---

## 附录 C：硬件基准测试（RuView ESP32-S3）

测量于 ESP32-S3（QFN56 rev v0.2、8 MB flash、160 MHz、ESP-IDF v5.2、
无 PSRAM 的开发板）。WiFi 连接到 AP，RSSI -25 dBm，信道 5 BW20。

### WASM 运行时性能

| Metric | Value |
|--------|-------|
| WASM 运行时初始化 | **106 ms** |
| 总启动到就绪 | **3.9 s**（含 WiFi 连接） |
| 模块槽位 | 4 × 160 KB（堆回退，无 PSRAM） |
| WASM 二进制体积（7 个模块） | **13.8 KB**（wasm32-unknown-unknown release） |
| 帧预算 | 10,000 µs（10 ms） |
| 定时器间隔 | 1,000 ms（1 Hz） |

### CSI 吞吐

| Metric | Value |
|--------|-------|
| 帧率 | **28.5 Hz**（超过 20 Hz 的估计值） |
| 帧大小 | 128 / 256 字节 |
| 单帧间隔 | 平均 30.6 ms |
| RSSI 范围 | -83 至 -32 dBm（均值 -62 dBm） |

### Rust 测试结果

| Crate | 测试 | 状态 |
|-------|-------|--------|
| wifi-densepose-wasm-edge (std) | 14 | 全部通过，0 警告 |
| 完整工作区 | 1,411 | 全部通过，0 失败 |

### 已知问题

1. **跌倒阈值过于敏感** —— 默认 2.0 rad/s² 在静态环境中产生 6.7 次/秒的误报。部署建议 5.0–8.0。
2. **测试板无 PSRAM** —— WASM 竞技场回退到内部堆（共 316 KiB）。带 8 MB PSRAM 的生产板将使用专用 PSRAM 竞技场。
3. **WiFi-以太网隔离** —— 部分消费级路由器会阻止 WiFi 与有线客户端之间的桥接。部署时请验证网络路径。

### B.8 实现计划

| 步骤 | 范围 | 工作量 |
|------|-------|--------|
| 1 | 在 `edge_processing.c` 中新增 `edge_compute_fiedler()` —— 对 8×8 拉普拉斯做幂迭代 | 约 50 行 C |
| 2 | 在 `wasm_runtime.c` 中新增预算控制器结构体并更新公式 | 约 30 行 C |
| 3 | 将温度/电池传感器接入预算输入 | 约 20 行 C |
| 4 | 在 `wasm_runtime_on_frame()` 中新增增量导出死区滤波器 | 约 15 行 C |
| 5 | 为 k₁–k₄、B_min、B_max、死区阈值新增 NVS 键 | 约 10 行 C |

总计：约 125 行 C，无新文件。所有常量均可通过 NVS 配置。

### B.9 失效模式

| Failure | Behavior |
|---------|----------|
| Δλ 估计错误（相关噪声） | 预算振荡——被 B_min/B_max 钳制 |
| 温度传感器缺失 | T 默认 0（不降频） |
| 电池 ADC 未接线 | P 默认 0（常开模式） |
| 所有 WASM 模块均预算故障 | DSP 流水线仅运行第 2 层——优雅降级 |

---

## 附录 C：RVF 容器格式

### C.1 问题

通过 HTTP 上传原始 `.wasm` 等同于远程代码执行。签名解决了
真实性问题，但没有清单，宿主就无法强制执行预算、
检查 API 兼容性，或识别它正在运行什么。RVF 把 WASM
负载连同治理元数据封装进单一制品中。

### C.2 二进制布局

```
Offset  Size   Type     Field
────────────────────────────────────────────
0       4      [u8;4]   Magic "RVF\x01" (0x01465652 LE)
4       2      u16 LE   format_version (1)
6       2      u16 LE   flags (bit 0: has_signature, bit 1: has_test_vectors)
8       4      u32 LE   manifest_len (always 96)
12      4      u32 LE   wasm_len
16      4      u32 LE   signature_len (0 or 64)
20      4      u32 LE   test_vectors_len (0 if none)
24      4      u32 LE   total_len (header + manifest + wasm + sig + tvec)
28      4      u32 LE   reserved (0)
────────────────────────────────────────────
32      96     struct   Manifest (see below)
128     N      bytes    WASM payload ("\0asm" magic)
128+N   0|64   bytes    Ed25519 signature (signs bytes 0..128+N-1)
128+N+S M      bytes    Test vectors (optional)
```

总开销：32（头部）+ 96（清单）+ 64（签名）= **192 字节**。

### C.3 清单（96 字节，紧凑布局）

| 偏移 | 大小 | 类型 | 字段 |
|--------|------|------|-------|
| 0 | 32 | char[] | `module_name` —— 以 null 结尾的 ASCII |
| 32 | 2 | u16 | `required_host_api` —— 版本号（1 = 当前） |
| 34 | 4 | u32 | `capabilities` —— RVF_CAP_* 位掩码 |
| 38 | 4 | u32 | `max_frame_us` —— 请求的每帧预算（0 = 使用默认） |
| 42 | 2 | u16 | `max_events_per_sec` —— 速率限制（0 = 不限） |
| 44 | 2 | u16 | `memory_limit_kb` —— 最大 WASM 堆（0 = 使用默认） |
| 46 | 2 | u16 | `event_schema_version` —— 用于接收端兼容性 |
| 48 | 32 | [u8;32] | `build_hash` —— WASM 负载的 SHA-256 |
| 80 | 2 | u16 | `min_subcarriers` —— 最小要求（0 = 任意） |
| 82 | 2 | u16 | `max_subcarriers` —— 最大预期（0 = 任意） |
| 84 | 10 | char[] | `author` —— 以 null 填充的 ASCII |
| 94 | 2 | [u8;2] | 保留（0） |

### C.4 能力位掩码

| 位 | 标志 | 宿主 API 函数 |
|-----|------|--------------------|
| 0 | `READ_PHASE` | `csi_get_phase` |
| 1 | `READ_AMPLITUDE` | `csi_get_amplitude` |
| 2 | `READ_VARIANCE` | `csi_get_variance` |
| 3 | `READ_VITALS` | `csi_get_bpm_*`, `csi_get_presence`, `csi_get_n_persons` |
| 4 | `READ_HISTORY` | `csi_get_phase_history` |
| 5 | `EMIT_EVENTS` | `csi_emit_event` |
| 6 | `LOG` | `csi_log` |

模块声明它们需要哪些宿主 API。未来的固件版本可能
拒绝链接未在 capabilities 中声明的导入——这是针对
供应链攻击的纵深防御。

### C.5 设备端流程

```
HTTP POST /wasm/upload
     │
     ▼
 ┌────────────────────────┐
 │ Check first 4 bytes    │
 │  "RVF\x01" → RVF path │
 │  "\0asm"   → raw path  │
 └───────┬────────────────┘
         │
    ┌────▼────┐     ┌───────────┐
    │ RVF     │     │ Raw WASM  │
    │ parse   │     │ (dev only,│
    │ header  │     │ verify=0) │
    └────┬────┘     └─────┬─────┘
         │                │
    ┌────▼────┐           │
    │ Verify  │           │
    │ SHA-256 │           │
    │ hash    │           │
    └────┬────┘           │
         │                │
    ┌────▼────┐           │
    │ Verify  │           │
    │ Ed25519 │           │
    │ sig     │           │
    └────┬────┘           │
         │                │
    ┌────▼────┐           │
    │ Check   │           │
    │ host API│           │
    │ version │           │
    └────┬────┘           │
         │                │
         ├────────────────┘
         ▼
 ┌───────────────────┐
 │ wasm_runtime_load │
 │ set_manifest      │
 │ start module      │
 └───────────────────┘
```

### C.6 回滚支持

每个槽位都从清单中保存 SHA-256 构建哈希。`/wasm/list` 端点会返回该哈希。
机群管理系统可以：

1. 向节点推送一个 RVF
2. 通过 GET `/wasm/list` 验证已安装哈希一致
3. 推送上一个 RVF 来回滚（卸载后复用同一槽位）

双槽策略：将槽位 0 保持为“最后已知良好”，槽位 1 作为
“候选”。通过停止槽位 0、启动槽位 1 来提升。

### C.7 Rust 构建器

`wifi-densepose-wasm-edge` crate 提供 `rvf::builder::build_rvf()`
（位于 `std` 特性之后），用于将 `.wasm` 二进制打包为 `.rvf`：

```rust
use wifi_densepose_wasm_edge::rvf::builder::{build_rvf, RvfConfig};

let wasm = std::fs::read("target/wasm32-unknown-unknown/release/module.wasm")?;
let rvf = build_rvf(&wasm, &RvfConfig {
    module_name: "gesture".into(),
    author: "rUv".into(),
    capabilities: CAP_READ_PHASE | CAP_EMIT_EVENTS,
    max_frame_us: 5000,
    ..Default::default()
});
std::fs::write("gesture.rvf", &rvf)?;
// Then sign externally with Ed25519 and patch_signature()
```

### C.8 实现文件

| File | Description |
|------|-------------|
| `firmware/.../main/rvf_parser.h` | RVF 类型、能力标志、解析/校验 API |
| `firmware/.../main/rvf_parser.c` | 头部/清单解析、SHA-256 哈希校验 |
| `wifi-densepose-wasm-edge/src/rvf.rs` | 格式常量、构建器（std）、测试 |

### C.9 失效模式

| Failure | Behavior |
|---------|----------|
| RVF 超出 PSRAM 缓冲区容量 | 接收时以 400 拒绝 |
| 构建哈希不匹配 | 解析时以 `ESP_ERR_INVALID_CRC` 拒绝 |
| `wasm_verify=1` 时缺少签名 | 以 403 拒绝 |
| 宿主 API 版本过新 | 以 `ESP_ERR_NOT_SUPPORTED` 拒绝 |
| `wasm_verify=1` 时的原始 WASM | 以 403 拒绝 |
