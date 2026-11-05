# ADR-018：ESP32 开发实现路径

## 状态
Proposed

## 日期
2026-02-28

## 背景

ADR-012 确立了 ESP32 CSI 传感网架构：硬件选型依据、固件文件结构、`csi_feature_frame_t` C 结构体、聚合器设计、用特征级融合处理时钟漂移，以及 54 美元的入门 BOM。那份 ADR 回答的是*做什么*和*为什么*。

本 ADR 回答*怎么做* —— 具体的开发顺序、现有代码中的集成点，以及在硬件到手之前如何逐层测试。

### 现状

**已实现：**

| 组件 | 位置 | 状态 |
|-----------|----------|--------|
| 二进制帧解析器 | `wifi-densepose-hardware/src/esp32_parser.rs` | Complete — `Esp32CsiParser::parse_frame()`、`parse_stream()`，7 个测试通过 |
| 帧类型 | `wifi-densepose-hardware/src/csi_frame.rs` | Complete — `CsiFrame`、`CsiMetadata`、`SubcarrierData`、`to_amplitude_phase()` |
| 解析错误类型 | `wifi-densepose-hardware/src/error.rs` | Complete — 含 6 个变体的 `ParseError` 枚举 |
| 信号处理流水线 | `wifi-densepose-signal` crate | Complete — Hampel、Fresnel、BVP、Doppler、频谱图 |
| CSI 提取器（Python） | `archive/v1/src/hardware/csi_extractor.py` | Stub — `_read_raw_data()` 抛出 `NotImplementedError` |
| 路由器接口（Python） | `archive/v1/src/hardware/router_interface.py` | Stub — `_parse_csi_response()` 抛出 `RouterConnectionError` |

**尚未实现：**

- ESP-IDF C 固件（`firmware/esp32-csi-node/`）
- UDP 聚合器可执行文件（`crates/wifi-densepose-hardware/src/aggregator/`）
- `CsiFrame` → `wifi_densepose_signal::CsiData` 桥接
- Python `_read_raw_data()` 的真实 UDP socket 实现
- 面向真实硬件的采集证明工具

### 二进制帧格式（已实现于 `esp32_parser.rs`）

```
Offset  Size  Field
0       4     Magic: 0xC5110001 (LE)
4       1     Node ID (0-255)
5       1     Number of antennas
6       2     Number of subcarriers (LE u16)
8       4     Frequency Hz (LE u32, e.g. 2412 for 2.4 GHz ch1)
12      4     Sequence number (LE u32)
16      1     RSSI (i8, dBm)
17      1     Noise floor (i8, dBm)
18      2     Reserved (zero)
20      N*2   I/Q pairs: (i8, i8) per subcarrier, repeated per antenna
```

帧总长：20 + (n_antennas × n_subcarriers × 2) 字节。

3 根天线、56 个子载波时：20 + 336 = 356 字节/帧。

固件必须严格按此格式写帧。解析器已校验魔数、对 `n_subcarriers` 做边界检查（≤512），并在 `parse_stream()` 中按魔数搜索重新同步数据流。

## 决策

我们将分四个顺序推进的层实现 ESP32 开发栈，每层都能在硬件到位之前独立测试。

### 第 1 层 —— ESP-IDF 固件（`firmware/esp32-csi-node/`）

按 ADR-012 的文件结构实现 C 固件工程。ADR-012 中推迟的关键设计决策如下：

**CSI 回调 → 帧序列化：**

```c
// main/csi_collector.c
static void csi_data_callback(void *ctx, wifi_csi_info_t *info) {
    if (!info || !info->buf) return;

    // 写入二进制帧头（20 字节，小端）
    uint8_t frame[FRAME_MAX_BYTES];
    uint32_t magic = 0xC5110001;
    memcpy(frame + 0,  &magic,              4);
    frame[4] = g_node_id;
    frame[5] = info->rx_ctrl.ant;           // antenna index (1 for ESP32 single-antenna)
    uint16_t n_sub = info->len / 2;         // len = n_subcarriers * 2 (I + Q bytes)
    memcpy(frame + 6,  &n_sub,              2);
    uint32_t freq_mhz = g_channel_freq_mhz;
    memcpy(frame + 8,  &freq_mhz,           4);
    memcpy(frame + 12, &g_seq_num,          4);
    frame[16] = (int8_t)info->rx_ctrl.rssi;
    frame[17] = (int8_t)info->rx_ctrl.noise_floor;
    frame[18] = 0; frame[19] = 0;

    // 从 info->buf 直接写入 I/Q 载荷
    memcpy(frame + 20, info->buf, info->len);

    // 通过 UDP 发给聚合器
    stream_sender_write(frame, 20 + info->len);
    g_seq_num++;
}
```

**设备端不做 FFT**（与 ADR-012 可选的特征提取路径不同）：特征提取由 Rust 聚合器用 SOTA 的 `wifi-densepose-signal` 流水线完成。在 ESP32 采样率下，流式传原始 I/Q 更省（约 100 Hz、56 个子载波 ≈ 每节点 35 KB/s）。

**限流与 ENOMEM 退避**（Issue #127 修复）：

混杂模式下 CSI 回调每秒触发 100-500 次以上。两项保护措施防止 lwIP pbuf 耗尽：

1. **50 Hz 限流器**（`csi_collector.c`）：距上次成功发送不足 20 ms 时跳过 `sendto()`，多余的 CSI 回调静默丢弃。
2. **ENOMEM 退避**（`stream_sender.c`）：当 `sendto()` 返回 `ENOMEM`（errno 12）时，暂停所有发送 100 ms，让 lwIP 回收报文缓冲。否则连续快速失败会触发 guru meditation 崩溃。

`sdkconfig.defaults` 必须启用：

```
CONFIG_ESP_WIFI_CSI_ENABLED=y
CONFIG_LWIP_SO_RCVBUF=y
CONFIG_FREERTOS_HZ=1000
```

**构建工具链**：ESP-IDF v5.2+（锁定版本）。Docker 镜像 `espressif/idf:v5.2` 用于可复现的 CI。

### 第 2 层 —— UDP 聚合器（`crates/wifi-densepose-hardware/src/aggregator/`）

hardware crate 中的新模块，入口为可作二进制 target 调用的 `aggregator_main()`。

```rust
// crates/wifi-densepose-hardware/src/aggregator/mod.rs

pub struct Esp32Aggregator {
    socket: UdpSocket,
    nodes: HashMap<u8, NodeState>,       // keyed by node_id from frame header
    tx: mpsc::SyncSender<CsiFrame>,      // outbound to bridge
}

struct NodeState {
    last_seq: u32,
    drop_count: u64,
    last_recv: Instant,
}

impl Esp32Aggregator {
    /// 绑定 UDP socket 并启动阻塞式接收循环。
    /// 每个合法帧都转发到 `tx`。
    pub fn run(&mut self) -> Result<(), AggregatorError> {
        let mut buf = vec![0u8; 4096];
        loop {
            let (n, _addr) = self.socket.recv_from(&mut buf)?;
            match Esp32CsiParser::parse_frame(&buf[..n]) {
                Ok((frame, _consumed)) => {
                    let state = self.nodes.entry(frame.metadata.node_id)
                        .or_insert_with(NodeState::default);
                    // 通过序列号缺口统计丢帧
                    if frame.metadata.seq_num != state.last_seq + 1 {
                        state.drop_count += (frame.metadata.seq_num
                            .wrapping_sub(state.last_seq + 1)) as u64;
                    }
                    state.last_seq = frame.metadata.seq_num;
                    state.last_recv = Instant::now();
                    let _ = self.tx.try_send(frame); // drop if pipeline is full
                }
                Err(e) => {
                    // 记录日志后继续 —— 绝不因坏 UDP 包崩溃
                    eprintln!("aggregator: parse error: {e}");
                }
            }
        }
    }
}
```

**无需硬件即可测试**：测试套件用 `build_test_frame()`（与 `esp32_parser.rs` 测试相同的辅助模式）生成帧，经回环 UDP socket 发送。聚合器接收并转发，行为与真实硬件帧完全一致。

### 第 3 层 —— CsiFrame → CsiData 桥接

从 `wifi-densepose-hardware::CsiFrame` 桥接到信号处理类型 `wifi_densepose_signal::CsiData`（或 Rust 流水线可消费的兼容中间类型）。

```rust
// crates/wifi-densepose-hardware/src/bridge.rs

use crate::{CsiFrame};

/// 与信号处理流水线兼容的中间类型。
/// 直接由 CsiFrame 映射，不复制 I/Q 存储。
pub struct CsiData {
    pub timestamp_unix_ms: u64,
    pub node_id: u8,
    pub n_antennas: usize,
    pub n_subcarriers: usize,
    pub amplitude: Vec<f64>,   // length: n_antennas * n_subcarriers
    pub phase: Vec<f64>,       // length: n_antennas * n_subcarriers
    pub rssi_dbm: i8,
    pub noise_floor_dbm: i8,
    pub channel_freq_mhz: u32,
}

impl From<CsiFrame> for CsiData {
    fn from(frame: CsiFrame) -> Self {
        let n_ant = frame.metadata.n_antennas as usize;
        let n_sub = frame.metadata.n_subcarriers as usize;
        let (amplitude, phase) = frame.to_amplitude_phase();
        CsiData {
            timestamp_unix_ms: frame.metadata.timestamp_unix_ms,
            node_id: frame.metadata.node_id,
            n_antennas: n_ant,
            n_subcarriers: n_sub,
            amplitude,
            phase,
            rssi_dbm: frame.metadata.rssi_dbm,
            noise_floor_dbm: frame.metadata.noise_floor_dbm,
            channel_freq_mhz: frame.metadata.channel_freq_mhz,
        }
    }
}
```

桥接测试：解析一个已知的二进制帧，转换为 `CsiData`，断言 `amplitude[0]` = √(I₀² + Q₀²)，误差在 f64 精度内。

### 第 4 层 —— Python `_read_raw_data()` 的真实实现

把 `archive/v1/src/hardware/csi_extractor.py` 中抛出 `NotImplementedError` 的桩替换为 UDP socket 读取器。这样在 Rust 流水线集成期间，Python 流水线也能收到来自聚合器的真实 CSI。

```python
# archive/v1/src/hardware/csi_extractor.py
# 替换 _read_raw_data() 桩：

import socket as _socket

class CSIExtractor:
    ...
    def _read_raw_data(self) -> bytes:
        """Read one raw CSI frame from the UDP aggregator.

        Expects binary frames in the ESP32 format (magic 0xC5110001 header).
        Aggregator address configured via AGGREGATOR_HOST / AGGREGATOR_PORT
        environment variables (defaults: 127.0.0.1:5005).
        """
        if not hasattr(self, '_udp_socket'):
            host = self.config.get('aggregator_host', '127.0.0.1')
            port = int(self.config.get('aggregator_port', 5005))
            sock = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
            sock.bind((host, port))
            sock.settimeout(1.0)
            self._udp_socket = sock
        try:
            data, _ = self._udp_socket.recvfrom(4096)
            return data
        except _socket.timeout:
            raise CSIExtractionError(
                "No CSI data received within timeout — "
                "is the ESP32 aggregator running?"
            )
```

单元测试用 mock UDP 服务器（沿用已有的 `test_csi_extractor_tdd.py` 模式），集成测试则对接真实聚合器。

## 开发顺序

```
Phase 1 (Firmware + Aggregator — no pipeline integration needed):
  1. Write firmware/esp32-csi-node/ C project (ESP-IDF v5.2)
  2. Flash to one ESP32-S3-DevKitC board
  3. Verify binary frames arrive on laptop UDP socket using Wireshark
  4. Write aggregator crate + loopback test

Phase 2 (Bridge + Python stub):
  5. Implement CsiFrame → CsiData bridge
  6. Replace Python _read_raw_data() with UDP socket
  7. Run Python pipeline end-to-end against loopback aggregator (synthetic frames)

Phase 3 (Real hardware integration):
  8. Run Python pipeline against live ESP32 frames
  9. Capture 10-second real CSI bundle (firmware/esp32-csi-node/proof/)
  10. Verify proof bundle hash (ADR-011 pattern)
  11. Mark ADR-012 Accepted, mark this ADR Accepted
```

## 无硬件条件下的测试

四层都能在买到第一块 ESP32 之前完成测试：

| 层 | 测试方法 |
|-------|-------------|
| 固件二进制格式 | 在 Rust 中写 `build_test_frame()` 辅助函数，把它的输出与手工算出的参考帧逐字节比对 |
| 聚合器 | 回环 UDP：测试向 127.0.0.1:5005 发送合成帧，聚合器接收并转发到通道 |
| 桥接 | `assert_eq!(csi_data.amplitude[0], f64::sqrt((iq[0].i as f64).powi(2) + (iq[0].q as f64).powi(2)))` |
| Python UDP 读取器 | pytest 中在后台线程用 `socket.socket` 起一个 mock UDP 服务器 |

现有的 `esp32_parser.rs` 测试套件已验证格式正确的二进制帧能被解析。聚合器与桥接测试都基于同一套测试帧构造。

## 影响

### 正面影响
- **分层可测**：采购硬件之前，每层都能独立验证。
- **没有新的外部依赖**：UDP socket 在标准库里（Rust 与 Python 皆是）。固件只用 ESP-IDF 与 esp-dsp 组件。
- **清除桩代码**：把 Python 硬件层最后两个 `NotImplementedError` 桩换成由真实数据支撑的真实代码。
- **真实性证明**：阶段 3 产出采集到的 CSI 包并校验到已知哈希，对硬件来源的数据满足 ADR-011。
- **复用 signal crate**：桥接转换完成后，ADR-014 的 SOTA Hampel/Fresnel/BVP/多普勒处理可原封不动用于真实 ESP32 帧。

### 负面影响
- **固件需要 ESP-IDF 工具链**：没有 2+ GB 的 ESP-IDF 安装就无法构建。CI 必须用官方 Docker 镜像，或跳过固件编译。
- **原始 I/Q 带宽**：以 100 Hz × 3 天线 × 56 子载波流式传输原始 I/Q（而非特征）≈ 每节点 35 KB/s，6 个节点约 210 KB/s。局域网没问题，不适合广域网。
- **现实中是单天线**：多数 ESP32-S3-DevKitC 板载只有一根天线。多天线数据需要外接天线 + 带 U.FL 接口的板子，或专门搭建多无线电方案。

### 暂缓事项
- **多节点时钟漂移补偿**：ADR-012 规定用特征级融合。本 ADR 的聚合器按节点传递原始 `CsiFrame`。漂移补偿留给未来的 `FeatureFuser` 层（不在本次范围内）。
- **ESP-IDF 固件 CI**：在 GitHub Actions 里编译固件需要 ESP-IDF Docker 镜像。CI 集成推迟到阶段 3 完成硬件验证之后。

## 与其它 ADR 的交互

| ADR | 交互 |
|-----|-------------|
| ADR-011 | 阶段 3 产出真实 CSI 证明包，满足消除模拟代码的要求 |
| ADR-012 | 本 ADR 为 ADR-012 的架构给出开发实现路径 |
| ADR-014 | 经过桥接层后，SOTA 信号处理原封不动适用 |
| ADR-008 | 聚合器处理多节点；分布式共识留待后续 |

## 参考资料

- [Espressif ESP-CSI Repository](https://github.com/espressif/esp-csi)
- [ESP-IDF WiFi CSI API Reference](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/wifi.html#wi-fi-channel-state-information)
- `wifi-densepose-hardware/src/esp32_parser.rs` — 二进制帧解析器实现
- `wifi-densepose-hardware/src/csi_frame.rs` — `CsiFrame`、`to_amplitude_phase()` 类型定义
- ADR-012：面向分布式感知的 ESP32 CSI 传感网（架构）
- ADR-011：Python 真实性验证与消除模拟代码
- ADR-014：面向 WiFi 感知的 SOTA 信号处理算法
