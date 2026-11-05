# ADR-012：面向分布式感知的 ESP32 CSI 传感网

## 状态
Accepted — 部分实现（固件与聚合器已可用，参见 ADR-018）

## 日期
2026-02-28

## 背景

### 硬件现实缺口

WiFi-DensePose 的 Rust 与 Python 流水线实现了真实的信号处理（FFT、相位解缠、多普勒提取、相关特征），但系统目前没有一条定义清晰的路径，把**物理 WiFi 硬件 → CSI 字节 → 流水线输入**串起来。`csi_extractor.py` 与 `router_interface.py` 里的占位解析器返回的是 `np.random.rand()`，而不是真实解析出的数据（见 ADR-011）。

要补上这个缺口，需要一个具体、买得起、可复现的硬件平台，能产出真实 CSI 数据并流式送入现有流水线。

### 为什么选 ESP32

| 因素 | ESP32/ESP32-S3 | Intel 5300 (iwl5300) | Atheros AR9580 |
|--------|---------------|---------------------|----------------|
| 成本 | ~$5-15/节点 | ~$50-100（二手网卡） | ~$30-60（二手网卡） |
| 可获得性 | 量产、现货 | 已停产，仅 eBay | 已停产，仅 eBay |
| CSI 支持 | 官方 ESP-IDF API | Linux CSI Tool（内核模块） | Atheros CSI Tool |
| 形态 | 独立 MCU | 需要 PCIe/Mini-PCIe 主机 | 需要 PCIe 主机 |
| 部署 | 电池/USB 供电，无线 | 仅台式机/笔记本 | 仅台式机/笔记本 |
| 天线配置 | 1-2 TX, 1-2 RX | 3 TX, 3 RX (MIMO) | 3 TX, 3 RX (MIMO) |
| 子载波 | 52-56 (802.11n) | 30（压缩） | 56（完整） |
| 保真度 | 较低（消费级 SoC） | 较高（专用网卡） | 较高（专用网卡） |

**ESP32 胜在可部署性**：它是唯一能让陌生人在 Amazon 买几个节点、烧好固件、一个下午就搭起可用 CSI 传感网的方案。Intel 5300 与 Atheros 网卡需要特定硬件、内核改动和旧版操作系统。

### ESP-IDF 的 CSI API

Espressif 通过三个关键函数提供官方 CSI 支持：

```c
// 1. 配置要采集哪些 CSI 数据
wifi_csi_config_t csi_config = {
    .lltf_en = true,         // Long Training Field (best for CSI)
    .htltf_en = true,        // HT-LTF
    .stbc_htltf2_en = true,  // STBC HT-LTF2
    .ltf_merge_en = true,    // Merge LTFs
    .channel_filter_en = false,
    .manu_scale = false,
};
esp_wifi_set_csi_config(&csi_config);

// 2. 注册接收 CSI 数据的回调
esp_wifi_set_csi_rx_cb(csi_data_callback, NULL);

// 3. 启用 CSI 采集
esp_wifi_set_csi(true);

// 回调收到的内容：
void csi_data_callback(void *ctx, wifi_csi_info_t *info) {
    // info->rx_ctrl：RSSI、noise_floor、channel、secondary_channel 等
    // info->buf：原始 CSI 数据（每个子载波的 I/Q 对）
    // info->len：CSI 数据缓冲区长度
    // 典型值：112 字节 = 56 个子载波 × 2（I,Q）× 每分量 1 字节
}
```

## 决策

我们将构建 ESP32 CSI 传感网作为主要硬件集成路径，打通固件 → 聚合器 → Rust 流水线 → 可视化的完整链路。

### 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                   ESP32 CSI Sensor Mesh                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                          │
│  │ ESP32    │  │ ESP32    │  │ ESP32    │  ... (3-6 nodes)         │
│  │ Node 1  │  │ Node 2  │  │ Node 3  │                          │
│  │          │  │          │  │          │                          │
│  │ CSI Rx   │  │ CSI Rx   │  │ CSI Rx   │  ← WiFi frames from    │
│  │ FFT      │  │ FFT      │  │ FFT      │     consumer router     │
│  │ Features │  │ Features │  │ Features │                          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                          │
│       │              │              │                                │
│       │    UDP/TCP stream (WiFi or secondary channel)               │
│       │              │              │                                │
│       ▼              ▼              ▼                                │
│  ┌─────────────────────────────────────────┐                        │
│  │           Aggregator                     │                        │
│  │  (Laptop / Raspberry Pi / Seed device)  │                        │
│  │                                          │                        │
│  │  1. Receive CSI streams from all nodes  │                        │
│  │  2. Timestamp alignment (per-node)       │                        │
│  │  3. Feature-level fusion                │                        │
│  │  4. Feed into Rust/Python pipeline      │                        │
│  │  5. Serve WebSocket to visualization    │                        │
│  └──────────────────┬──────────────────────┘                        │
│                      │                                               │
│                      ▼                                               │
│  ┌─────────────────────────────────────────┐                        │
│  │        WiFi-DensePose Pipeline           │                        │
│  │                                          │                        │
│  │  CsiProcessor → FeatureExtractor →      │                        │
│  │  MotionDetector → PoseEstimator →       │                        │
│  │  Three.js Visualization                 │                        │
│  └─────────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 节点固件规格

**ESP-IDF 工程**：`firmware/esp32-csi-node/`

```
firmware/esp32-csi-node/
├── CMakeLists.txt
├── sdkconfig.defaults      # Menuconfig defaults with CSI enabled (gitignored)
├── main/
│   ├── CMakeLists.txt
│   ├── main.c              # Entry point, NVS config, WiFi init, CSI callback
│   ├── csi_collector.c     # CSI collection, promiscuous mode, ADR-018 serialization
│   ├── csi_collector.h
│   ├── nvs_config.c        # Runtime config from NVS (WiFi creds, target IP)
│   ├── nvs_config.h
│   ├── stream_sender.c     # UDP stream to aggregator
│   ├── stream_sender.h
│   └── Kconfig.projbuild   # Menuconfig options
└── README.md               # Flash instructions (verified working)
```

> **实现说明：** 设备端特征提取（`feature_extract.c`）已推迟。
> 当前固件以 ADR-018 二进制格式流式输出原始 I/Q 数据；特征提取
> 在 Rust 聚合器中完成。这样既简化了固件，也让 ESP32 上的 C 代码
> 保持在 200 行以内。

**设备端处理**（降低带宽，节点做预处理）：

```c
// feature_extract.c
typedef struct {
    uint32_t timestamp_ms;      // Local monotonic timestamp
    uint8_t  node_id;           // This node's ID
    int8_t   rssi;              // Received signal strength
    int8_t   noise_floor;       // Noise floor estimate
    uint8_t  channel;           // WiFi channel
    float    amplitude[56];     // |CSI| per subcarrier (from I/Q)
    float    phase[56];         // arg(CSI) per subcarrier
    float    doppler_energy;    // Motion energy from temporal FFT
    float    breathing_band;    // 0.1-0.5 Hz band power
    float    motion_band;       // 0.5-3 Hz band power
} csi_feature_frame_t;
// 每帧约 470 字节
// 100 Hz 时：每节点约 47 KB/s，6 个节点约 280 KB/s
```

**固件关键设计决策**：

1. **设备端特征提取**：原始 CSI I/Q → 幅度 + 相位 + 频段能量。这把带宽从每帧约 11 KB 降到约 470 字节。

2. **单调时间戳**：每个节点使用自己的单调时钟。节点之间不做 NTP 同步 —— 时钟漂移由聚合器通过融合特征而非原始相位来处理（见下文「时钟漂移」一节）。

3. **UDP 流式传输**：低延迟、可容忍丢包。丢帧可以接受，顺序由序列号维护。

4. **采样率可配置**：通过 menuconfig 设为 10-100 Hz。运动检测用 100 Hz，占用检测 10 Hz 已足够。

### 聚合器规格

聚合器可运行在任何能通过 WiFi/以太网连接节点的机器上：

```rust
// 在 v2/ 中新增模块：crates/wifi-densepose-hardware/src/esp32/
pub struct Esp32Aggregator {
    /// 监听节点数据流的 UDP socket
    socket: UdpSocket,

    /// 每节点状态（最近时间戳、特征缓冲、漂移估计）
    nodes: HashMap<u8, NodeState>,

    /// 融合后特征帧的环形缓冲
    fused_buffer: VecDeque<FusedFrame>,

    /// 通往流水线的通道
    pipeline_tx: mpsc::Sender<CsiData>,
}

/// 一个时间窗口内来自所有节点的融合帧
pub struct FusedFrame {
    /// 时间戳（聚合器本地、单调）
    timestamp: Instant,

    /// 各节点特征（节点掉线时可能有空缺）
    node_features: Vec<Option<CsiFeatureFrame>>,

    /// 跨节点相关性（由聚合器计算）
    cross_node_correlation: Array2<f64>,

    /// 融合后的运动能量（跨节点取最大值）
    fused_motion_energy: f64,

    /// 融合后的呼吸频段（相位一致处做相干叠加）
    fused_breathing_band: f64,
}
```

### 时钟漂移处理

ESP32 晶振漂移约 20-50 ppm。运行 1 小时后，两个节点可能相差 72-180ms，因此跨节点做原始相位对齐不可行。

**解决方案**：特征级融合，而非信号级融合。

```
Signal-level (WRONG for ESP32):
  Align raw I/Q samples across nodes → requires <1µs sync → impractical

Feature-level (CORRECT for ESP32):
  Each node: raw CSI → amplitude + phase + spectral features (local)
  Aggregator: collect features → correlate → fuse decisions
  No cross-node phase alignment needed
```

具体来说：
- **运动能量**：跨节点取最大值（任一节点看到运动即为有运动）
- **呼吸频段**：以 SNR 最高的节点为主，其它节点作佐证
- **定位**：用跨节点幅度比估计位置（无需相位）

### 按部署规模划分的感知能力

| 能力 | 1 个节点 | 3 个节点 | 6 个节点 | 证据 |
|-----------|--------|---------|---------|----------|
| 存在检测 | 良好 | 优秀 | 优秀 | 单节点 RSSI 方差 |
| 粗粒度运动 | 良好 | 优秀 | 优秀 | 多普勒能量 |
| 房间级定位 | 无 | 良好 | 优秀 | 幅度比 |
| 呼吸 | 勉强 | 良好 | 良好 | 0.1-0.5 Hz 频段，对摆放敏感 |
| 心跳 | 差 | 差～勉强 | 勉强 | 需要理想摆放与低噪声 |
| 多人计数 | 无 | 勉强 | 良好 | 空间分集 |
| 姿态估计 | 无 | 差 | 勉强 | 需要模型与足够的空间分集 |

**如实评估**：ESP32 CSI 的保真度低于 Intel 5300 或 Atheros。心跳检测对摆放敏感且不可靠；呼吸检测在摆放良好时可行；运动与存在检测则比较扎实。

### 失效模式与缓解措施

| 失效模式 | 严重度 | 缓解措施 |
|-------------|----------|------------|
| 杂乱房间里多径主导 | High | 传感网分集：3 个以上节点、不同角度 |
| 人挡住节点与路由器之间的路径 | Medium | 传感网：其它节点仍有清晰路径 |
| 时钟漂移破坏跨节点融合 | Medium | 只做特征级融合；不做跨节点相位对齐 |
| 高流量时 UDP 丢包 | Low | 序列号；<100ms 的空缺做插值 |
| ESP32 WiFi 驱动在 CSI 上的 bug | Medium | 锁定 ESP-IDF 版本，在已验证可用的板子上测试 |
| 节点断电 | Low | 聚合器优雅处理缺失节点 |

### 物料清单（入门套件）

| 物件 | 数量 | 单价 | 小计 |
|------|----------|-----------|-------|
| ESP32-S3-DevKitC-1 | 3 | $10 | $30 |
| USB-A 转 USB-C 线缆 | 3 | $3 | $9 |
| USB 电源适配器（多口） | 1 | $15 | $15 |
| 家用 WiFi 路由器（任意） | 1 | $0（已有） | $0 |
| 聚合器（笔记本或 Pi 4） | 1 | $0（已有） | $0 |
| **合计** | | | **$54** |

### 最小构建规格（克隆—烧录—运行）

**方案 A：使用预编译固件（无需工具链）**

```bash
# 从 GitHub Release v0.1.0-esp32 下载固件
# 用 esptool 烧录（pip install esptool）
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 4MB \
  0x0 bootloader.bin 0x8000 partition-table.bin 0x10000 esp32-csi-node.bin

# 配置 WiFi 凭据（无需重新编译）
python scripts/provision.py --port COM7 \
  --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20

# 运行聚合器
cargo run -p wifi-densepose-hardware --bin aggregator -- --bind 0.0.0.0:5005 --verbose
```

**方案 B：用 Docker 从源码构建（无需安装 ESP-IDF）**

```bash
# 第 1 步：修改 WiFi 凭据
vim firmware/esp32-csi-node/sdkconfig.defaults

# 第 2 步：用 Docker 构建
cd firmware/esp32-csi-node
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd):/project" -w /project \
  espressif/idf:v5.2 bash -c "idf.py set-target esp32s3 && idf.py build"

# 第 3 步：烧录
cd build
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 4MB \
  0x0 bootloader/bootloader.bin 0x8000 partition_table/partition-table.bin \
  0x10000 esp32-csi-node.bin

# 第 4 步：运行聚合器
cargo run -p wifi-densepose-hardware --bin aggregator -- --bind 0.0.0.0:5005 --verbose
```

**已验证**：20 Hz CSI 流、64/128/192 子载波帧、RSSI -47 至 -88 dBm。
教程见：https://github.com/ruvnet/wifi-densepose/issues/34

### ESP32 的真实性证明

**实机验证**（ESP32-S3-DevKitC-1，CP2102，MAC 3C:0F:02:EC:C2:28）：
- 18 秒内 693 帧（约 21.6 fps）
- 序列号连续（零丢帧）
- 存在检测已确认：结合每秒幅度方差，运动得分 10/10
- 帧类型：64 sc (148 B)、128 sc (276 B)、192 sc (404 B)
- 20 个 Rust 测试 + 6 个 Python 测试通过

预编译固件：https://github.com/ruvnet/wifi-densepose/releases/tag/v0.1.0-esp32

## 影响

### 正面影响
- **54 美元入门套件**：获取真实 CSI 数据的门槛最低
- **硬件随处可见**：ESP32 开发板全球现货供应
- **真实数据通路**：用实际硬件输入消灭每一个 `np.random.rand()` 占位
- **证明物**：采集的 CSI + 预期哈希证明流水线处理的是真实数据
- **可扩展传感网**：增加节点即可扩大覆盖，软件无需改动
- **特征级融合**：绕开了跨节点相位同步这个不可能完成的问题

### 负面影响
- **保真度低于研究级网卡**：ESP32 CSI 比 Intel 5300 噪声更大
- **心跳检测不可靠**：微多普勒分辨率不足以稳定检测心跳
- **ESP-IDF 学习曲线**：固件开发需要嵌入式 C 知识
- **WiFi 干扰**：节点与数据流量共用信道会引入噪声
- **摆放敏感**：呼吸检测需要仔细安排节点位置

### 与其它 ADR 的交互
- **ADR-011**（真实性验证）：ESP32 为证明包提供真实 CSI 采集数据
- **ADR-008**（分布式共识）：传感网节点可用简化的 Raft 分发配置
- **ADR-003**（RVF 容器）：聚合器以 RVF 格式存放 CSI 特征
- **ADR-004**（HNSW）：来自 ESP32 传感网的环境指纹进入 HNSW 索引

## 参考资料

- [Espressif ESP-CSI Repository](https://github.com/espressif/esp-csi)
- [ESP-IDF WiFi CSI API](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/wifi.html#wi-fi-channel-state-information)
- [ESP32 CSI Research Papers](https://ieeexplore.ieee.org/document/9439871)
- [Wi-Fi Sensing with ESP32: A Tutorial](https://arxiv.org/abs/2207.07859)
- ADR-011：Python 真实性验证与消除模拟代码
- ADR-018：ESP32 开发实现（二进制帧格式规范）
- [Pre-built firmware release v0.1.0-esp32](https://github.com/ruvnet/wifi-densepose/releases/tag/v0.1.0-esp32)
- [Step-by-step tutorial (Issue #34)](https://github.com/ruvnet/wifi-densepose/issues/34)
