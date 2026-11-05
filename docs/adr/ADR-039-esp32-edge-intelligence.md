# ADR-039：ESP32-S3 边缘智能流水线

**状态**：Accepted（已在 RuView ESP32-S3 上通过硬件验证）
**日期**：2026-03-02
**决策者**：@ruvnet

## 背景

WiFi-DensePose 从 ESP32-S3 节点采集信道状态信息（CSI），并把原始 I/Q 数据流式发送到主机服务器处理。这一架构存在以下局限：

1. **带宽**：20 Hz × 128 子载波 × 2 字节的原始 CSI ≈ 5 KB/帧 ≈ 100 KB/s 每节点。多节点部署会把低带宽链路打满。
2. **延迟**：服务器端处理会给跌倒检测这类时间敏感信号增加网络往返延迟。
3. **功耗**：持续发送原始数据流使电池供电部署无法做占空比轮休。
4. **可扩展性**：本可跑在 ESP32-S3 双核上的基础信号处理，却让服务器 CPU 随节点数线性增长。

## 决策

在 ESP32-S3 上实现分层的边缘处理流水线，在本地完成信号处理并只发送紧凑结果：

### Tier 0 —— 原始透传（默认，向后兼容）
不做设备端处理。CSI 帧原样流式发送（魔数 `0xC5110001`）。

### Tier 1 —— 基础信号处理
- 从 I/Q 对中提取相位并解缠
- 每个子载波的 Welford 滑动方差
- 按方差挑选 Top-K 子载波
- 差值压缩（XOR + RLE），带宽降低 30-50%（魔数 `0xC5110005`，由 ADR-069 从 `0xC5110003` 重新分配）

### Tier 2 —— 完整边缘智能
包含 Tier 1 的全部内容，另加：
- 双二阶 IIR 带通滤波器：呼吸（0.1-0.5 Hz）、心率（0.8-2.0 Hz）
- 过零法 BPM 估计
- 存在检测，带自适应阈值校准（1200 帧、3-sigma）
- 跌倒检测（相位加速度超过可配置阈值）
- 通过子载波分组聚类实现多人生命体征（最多 4 人）
- 按可配置间隔发送 32 字节生命体征包（魔数 `0xC5110002`）

### 架构

```
Core 0 (WiFi)                    Core 1 (DSP)
┌─────────────────┐              ┌──────────────────────────┐
│ CSI callback     │──SPSC ring──▶│ Phase extract + unwrap   │
│ (wifi_csi_cb)    │   buffer     │ Welford variance         │
│                  │              │ Top-K selection           │
│ UDP raw stream   │              │ Biquad bandpass filters   │
│ (0xC5110001)     │              │ Zero-crossing BPM         │
└─────────────────┘              │ Presence detection        │
                                 │ Fall detection             │
                                 │ Multi-person clustering    │
                                 │ Delta compression          │
                                 │ ──▶ UDP vitals (0xC5110002)│
                                 │ ──▶ UDP compressed (0x05)  │
                                 └──────────────────────────┘
```

### 线路协议

**生命体征包（32 字节，魔数 `0xC5110002`）**：

| 偏移 | 类型 | 字段 |
|--------|------|-------|
| 0-3 | u32 LE | 魔数 `0xC5110002` |
| 4 | u8 | 节点 ID |
| 5 | u8 | 标志位（bit0=presence, bit1=fall, bit2=motion） |
| 6-7 | u16 LE | 呼吸率（BPM × 100） |
| 8-11 | u32 LE | 心率（BPM × 10000） |
| 12 | i8 | RSSI |
| 13 | u8 | 检测到的人数 |
| 14-15 | u8[2] | 保留 |
| 16-19 | f32 LE | 运动能量 |
| 20-23 | f32 LE | 存在得分 |
| 24-27 | u32 LE | 时间戳（自启动起的毫秒数） |
| 28-31 | u32 LE | 保留 |

**压缩帧（魔数 `0xC5110005`，由 ADR-069 从 `0xC5110003` 重新分配）**：

| 偏移 | 类型 | 字段 |
|--------|------|-------|
| 0-3 | u32 LE | 魔数 `0xC5110005` |
| 4 | u8 | 节点 ID |
| 5 | u8 | WiFi 信道 |
| 6-7 | u16 LE | 原始 I/Q 长度 |
| 8-9 | u16 LE | 压缩后长度 |
| 10+ | bytes | RLE 编码的 XOR 差值 |

### 配置

`csi_cfg` 命名空间下有六个 NVS 键：

| NVS 键 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `edge_tier` | u8 | 2 | 处理层级（0/1/2） |
| `pres_thresh` | u16 | 0 | 存在阈值 × 1000（0 = 自动） |
| `fall_thresh` | u16 | 2000 | 跌倒阈值 × 1000（rad/s²） |
| `vital_win` | u16 | 256 | 相位历史窗口 |
| `vital_int` | u16 | 1000 | 生命体征间隔（ms） |
| `subk_count` | u8 | 8 | Top-K 子载波数量 |

全部可通过 `provision.py --edge-tier 2 --pres-thresh 0.05 ...` 配置

### 附加功能

- **OTA 更新**：8032 端口上的 HTTP 服务器（`POST /ota`、`GET /ota/status`），支持回滚
- **电源管理**：WiFi modem sleep + 自动轻睡眠，占空比可配置

## 后果

### 正面
- 跌倒检测延迟从约 500 ms（网络往返）降到 <50 ms（设备端）
- 差值压缩使带宽降低 30-50%，仅发生命体征模式可达 95% 以上
- 配合占空比轻睡眠，电池供电部署成为可能
- 服务器可承载 10 倍节点数（只解析 32 字节生命体征包，而不是约 5 KB 的 CSI）

### 负面
- 固件复杂度上升（edge_processing.c 约 750 行）
- ESP32-S3 的 RAM 占用增加约 12 KB，用于环形缓冲区 + 滤波器状态
- 完整 WASM3 Tier 3 使二进制从约 550 KB 增大到约 925 KB（1 MB 分区中剩余 10% —— 见 ADR-040）

### 风险
- BPM 准确率取决于被测者距离与运动状态，需要真实环境验证
- 跌倒检测启发式会对环境运动（门、宠物）产生误报
- 未做校准时，基于子载波聚类的多人分离只是近似

## 实施

- `firmware/esp32-csi-node/main/edge_processing.c` —— DSP 流水线（约 750 行）
- `firmware/esp32-csi-node/main/edge_processing.h` —— 类型与 API
- `firmware/esp32-csi-node/main/ota_update.c/h` —— HTTP OTA 端点
- `firmware/esp32-csi-node/main/power_mgmt.c/h` —— 电源管理
- `v2/.../wifi-densepose-sensing-server/src/main.rs` —— 生命体征解析器 + REST 端点
- `scripts/provision.py` —— 边缘配置的 CLI 参数
- `.github/workflows/firmware-ci.yml` —— CI 构建 + 体积门限（Tier 3 已上调到 950 KB）

### Tier 3 —— WASM 可编程感知（ADR-040、ADR-041）

关于可热加载的 WASM 模块，见 [ADR-040](ADR-040-wasm-programmable-sensing.md)：
这些模块由 Rust 编译而成，在设备上通过 WASM3 解释器执行。核心模块包括：
手势识别、相干性监测、对抗性检测。

[ADR-041](ADR-041-wasm-module-collection.md) 定义了精选模块集合
（6 个类别共 37 个模块）。阶段 1 已实现的模块：
- `vital_trend.rs` —— 临床生命体征趋势分析（呼吸过缓、呼吸过速、呼吸暂停）
- `intrusion.rs` —— 状态机入侵检测（校准-监测-布防-告警）
- `occupancy.rs` —— 空间占用区域检测，带逐区域方差分析

## 硬件基准测试（RuView ESP32-S3）

在 ESP32-S3 上实测（QFN56 rev v0.2、8 MB flash、160 MHz、ESP-IDF v5.2）。

### 启动耗时

| 里程碑 | 耗时（ms） |
|-----------|-----------|
| `app_main()` | 412 |
| WiFi STA 初始化 | 627 |
| WiFi 已连接 + 获得 IP | 3,732 |
| CSI 采集初始化 | 3,754 |
| 边缘 DSP 任务已启动 | 3,773 |
| WASM 运行时已初始化 | 3,857 |
| **启动到就绪总计** | **~3.9 s** |

### CSI 性能

| 指标 | 值 |
|--------|-------|
| 帧率 | **28.5 Hz**（实测，信道 5 BW20） |
| 帧大小 | 128 / 256 字节 |
| RSSI 范围 | -83 到 -32 dBm（均值 -62 dBm） |
| 每帧间隔 | 平均 30.6 ms |

### 内存

| 区域 | 大小 |
|--------|------|
| RAM（主堆） | 256 KiB |
| RAM（次级） | 21 KiB |
| DRAM | 32 KiB |
| RTC RAM | 7 KiB |
| **可用总量** | **316 KiB** |
| PSRAM | 测试板未装配 |
| WASM arena 回退 | 内部堆（160 KB/槽 × 4） |

### 固件二进制

| 指标 | 值 |
|--------|-------|
| 二进制大小 | **925 KB**（0xE7440 字节） |
| 分区大小 | 1 MB（factory） |
| 剩余空间 | 10%（99 KB） |
| CI 体积门限 | 950 KB (PASS) |
| WASM3 解释器 | 已包含（完整版，约 100 KB） |
| WASM 二进制（7 个模块） | 13.8 KB（wasm32-unknown-unknown release） |

### WASM 运行时

| 指标 | 值 |
|--------|-------|
| 初始化耗时 | **106 ms** |
| 模块槽位 | 4 |
| 每槽位 arena | 160 KB |
| 帧预算 | 10,000 µs（10 ms） |
| 定时器间隔 | 1,000 ms（1 Hz） |

### 发现

1. **跌倒检测阈值过低** —— 默认 `fall_thresh=2000`（2.0 rad/s²）在静态室内环境下每秒误报 6.7 次。建议典型部署上调到 5000-8000。
2. **测试板没有 PSRAM** —— WASM arena 回退到内部堆。带 PSRAM 的板子可支持更大的模块。
3. **CSI 速率超出规格** —— 实测 28.5 Hz，而预期约 20 Hz。性能余量比估算更好。
4. **WiFi 与以太网隔离** —— 部分路由器会阻断 WiFi 客户端与有线客户端之间的 UDP。建议在部署指南中加入同子网校验。
5. **sendto ENOMEM 崩溃（Issue #127）** —— 混杂模式下的 CSI 回调每秒触发 100-500+ 次，耗尽 lwIP pbuf 池并触发 guru meditation 崩溃。采用双管齐下的修复：在 `csi_collector.c` 中加 50 Hz 限速（最小发送间隔 20 ms），并在 `stream_sender.c` 中加 100 ms 的 ENOMEM 退避。修复后二进制为 947 KB。硬件验证 200+ 次 CSI 回调下稳定，ENOMEM 错误为零。
