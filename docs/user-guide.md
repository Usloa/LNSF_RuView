# WiFi DensePose 用户指南

WiFi DensePose 把普通 WiFi 信号转换成实时人体姿态估计、生命体征监测与在场检测。本指南带你完成安装、首次运行、API 使用、硬件配置与模型训练。

---

## 目录

1. [前置条件](#prerequisites)
2. [安装](#installation)
   - [Docker（推荐）](#docker-recommended)
   - [从源码构建（Rust）](#from-source-rust)
   - [从 crates.io 安装（单个 crate）](#from-cratesio-individual-crates)
   - [从源码安装（Python）](#from-source-python)
   - [引导式安装器](#guided-installer)
3. [快速上手](#quick-start)
   - [30 秒演示（Docker）](#30-second-demo-docker)
   - [确认系统正常工作](#verify-the-system-works)
4. [数据源](#data-sources)
   - [模拟模式（无需硬件）](#simulated-mode-no-hardware)
   - [Windows WiFi（仅 RSSI）](#windows-wifi-rssi-only)
   - [ESP32-S3（完整 CSI）](#esp32-s3-full-csi)
   - [ESP32-C5（实验性 CSI 目标）](#esp32-c5-experimental-csi-target)
   - [ESP32 多静态组网（进阶）](#esp32-multistatic-mesh-advanced)
   - [MediaTek 路由器 CSI（实验性）](#mediatek-router-csi-experimental)
   - [把组网数据接到仪表盘与观测站](#connect-mesh-data-to-the-dashboard-and-observatory)
   - [启用 Cognitum Spaces](#cognitum-spaces-activation)
   - [Cognitum Seed 集成（ADR-069）](#cognitum-seed-integration-adr-069)
5. [REST API 参考](#rest-api-reference)
6. [WebSocket 数据流](#websocket-streaming)
7. [RuView npm 工具包（`@ruvnet/ruview`）](#ruview-npm-toolkit-ruvnetruview)
   - [用命令行查看硬件](#hardware-from-the-command-line)
   - [面向智能体、ChatGPT 与 MCP 应用的 MCP](#mcp-for-agents-chatgpt-and-mcp-apps)
   - [Claude Code 扩展：实时感知面板](#claude-code-mod-live-sensing-pane)
   - [Homecore 与生命体征内核](#homecore-and-the-vitals-kernel)
8. [Web 界面](#web-ui)
8. [生命体征检测](#vital-sign-detection)
9. [命令行参考](#cli-reference)
10. [观测站可视化](#observatory-visualization)
11. [从 Hugging Face 加载预训练模型](#loading-the-pretrained-model-from-hugging-face)
12. [自适应分类器](#adaptive-classifier)
    - [录制训练数据](#recording-training-data)
    - [训练模型](#training-the-model)
    - [使用训练好的模型](#using-the-trained-model)
13. [世界模型预测（OccWorld）](#world-model-prediction-occworld)
14. [训练模型](#training-a-model)
    - [CRV 信号线协议](#crv-signal-line-protocol)
14. [RVF 模型容器](#rvf-model-containers)
14. [感知证书链（开发者预览，ADR-300）](#perception-certificate-spine-developer-preview-adr-297)
14. [硬件配置](#hardware-setup)
    - [ESP32-S3 组网](#esp32-s3-mesh)
    - [Intel 5300 / Atheros 网卡](#intel-5300--atheros-nic)
15. [无摄像头姿态训练](#camera-free-pose-training)
16. [ruvllm 训练流水线](#ruvllm-training-pipeline)
17. [Docker Compose（多服务）](#docker-compose-multi-service)
16. [无硬件测试固件（QEMU）](#testing-firmware-without-hardware-qemu)
    - [需要准备什么](#what-you-need)
    - [第一次测试运行](#your-first-test-run)
    - [看懂测试输出](#understanding-the-test-output)
    - [一次测试多个节点（集群）](#testing-multiple-nodes-at-once-swarm)
    - [集群预设](#swarm-presets)
    - [编写自己的集群配置](#writing-your-own-swarm-config)
    - [在 QEMU 中调试固件](#debugging-firmware-in-qemu)
    - [运行完整测试套件](#running-the-full-test-suite)
17. [排障](#troubleshooting)
18. [常见问题](#faq)

---

<a id="prerequisites"></a>
## 前置条件

| 项目 | 最低要求 | 推荐配置 |
|-------------|---------|-------------|
| **操作系统** | Windows 10/11、macOS 10.15、Ubuntu 18.04 | 最新稳定版 |
| **内存** | 4 GB | 8 GB 以上 |
| **磁盘** | 可用 2 GB | 可用 5 GB |
| **Docker**（走 Docker 路线时） | Docker 20+ | Docker 24+ |
| **Rust**（从源码构建时） | 1.70+ | 1.85+ |
| **Python**（旧版 v1） | 3.10+ | 3.13+ |

**实时感知所需硬件（可选）：**

| 方案 | 成本 | 能力 |
|--------|------|-------------|
| ESP32-S3 组网（3-6 块板） | ~$54 | 采集 CSI 用于在场、运动与生命体征的启发式判断；实时 17 关键点姿态尚未达标，不属于已验证能力 |
| Intel 5300 / Atheros AR9580 | $50-100 | 完整 CSI，3x3 MIMO（仅 Linux） |
| 任意带 WiFi 的笔记本 | $0 | 仅 RSSI：粗粒度的在场与运动检测 |

没有硬件？系统可以用合成的 CSI 数据运行在**模拟模式**下。

---

<a id="installation"></a>
## 安装

<a id="docker-recommended"></a>
### Docker（推荐）

最快的路径，不需要安装任何工具链。

```bash
docker pull ruvnet/wifi-densepose:latest
```

多架构镜像（amd64 + arm64），可用于 Intel/AMD 与 Apple Silicon Mac。内含 Rust 感知服务器、Three.js 界面和全部信号处理功能。

**选择数据源：** 用 `CSI_SOURCE` 环境变量选择感知模式：

| 取值 | 说明 |
|-------|-------------|
| `auto` | （默认）探测 UDP 5005 上的 ESP32，找不到就回退到模拟 |
| `esp32` | 通过 UDP 接收 ESP32 设备的真实 CSI 帧 |
| `simulated` | 生成合成 CSI 帧（无需硬件） |
| `wifi` | 宿主机 Wi-Fi RSSI（容器内不可用） |

示例：`docker run -e RUVIEW_API_TOKEN -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW=<node-ip-or-cidr> -p 127.0.0.1:3000:3000 -p 5005:5005/udp ruvnet/wifi-densepose:latest`。未设置 `RUVIEW_API_TOKEN` 时容器会以退出码 64 结束；未配置 UDP 来源防护时也收不到任何 ESP32 帧，参见[在 Docker 中接收 ESP32 帧](#receiving-esp32-frames-in-docker)。

<a id="from-source-rust"></a>
### 从源码构建（Rust）

在基于 Debian/Ubuntu 的 Linux 上，首次做 Rust release 构建前，先装好桌面端所需的原生依赖：

```bash
sudo apt update
sudo apt install -y \
  build-essential pkg-config \
  libglib2.0-dev libgtk-3-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libwebkit2gtk-4.1-dev
```

这一步用于准备本工作区 desktop/Tauri crate 所需的 GTK/WebKit 原生依赖。

```bash
git clone https://github.com/ruvnet/RuView.git
cd RuView/v2

# 构建
cargo build --release

# 验证（运行 1,400+ 项测试）
cargo test --workspace --no-default-features
```

编译产物位于 `target/release/sensing-server`。

<a id="from-cratesio-individual-crates"></a>
### 从 crates.io 安装（单个 crate）

工作区里的 crate 各自独立发布，因此版本互不相同（撰写本文时 `wifi-densepose-core` 为 0.3.2、`wifi-densepose-signal` 为 0.3.6 等）—— `cargo add` 默认会为每个 crate 解析到各自的最新版，你不必自己记准确版本号。把需要的 crate 加到自己的 Rust 项目里：

```bash
# 核心类型与 trait
cargo add wifi-densepose-core

# 信号处理（含 RuvSense 多静态感知）
cargo add wifi-densepose-signal

# 神经网络推理
cargo add wifi-densepose-nn

# 大规模伤员评估工具
cargo add wifi-densepose-mat

# ESP32 硬件 + TDM 协议 + QUIC 传输
cargo add wifi-densepose-hardware

# RuVector 集成（加 --features crv 启用 CRV 信号线协议）
cargo add wifi-densepose-ruvector --features crv

# WebAssembly 绑定
cargo add wifi-densepose-wasm

# WASM 边缘运行时（轻量，面向嵌入式/IoT）
cargo add wifi-densepose-wasm-edge

# 相干宽带射频层析研究 crate（ADR-287）—— 合成
# 步进频率反投影重建。仅 SYNTHETIC/L0 证据
# 等级；未接入上述任何感知流水线。见其自身 README。
cargo add wifi-densepose-sar
```

完整 crate 清单与依赖顺序见 [CLAUDE.md](../CLAUDE.md#crate-publishing-order)。

### Python wheel（pip）—— ADR-117

Python API 以**两个可互换的 PyPI 包**发布 —— 两者是同一个
编译好的 PyO3 wheel，只是名字不同；按你代码里读起来更顺的
导入名挑一个即可：

| PyPI | 安装命令 | 最新版 | 导入方式 |
|---|---|---|---|
| [`ruview`](https://pypi.org/project/ruview/) | `pip install ruview` | `2.0.0a1` | `from ruview import ...` |
| [`wifi-densepose`](https://pypi.org/project/wifi-densepose/) | `pip install wifi-densepose` | `2.0.0a1` | `from wifi_densepose import ...` |

```bash
pip install ruview                        # core DSP (~250 KB compiled wheel)
pip install "ruview[client]"              # + asyncio WebSocket + paho-mqtt
```

```python
# 生命体征
from ruview import BreathingExtractor, HeartRateExtractor
br = BreathingExtractor.esp32_default()   # 56 subcarriers @ 100 Hz, 30s window

# 实时感知服务器数据流
from ruview.client import SensingClient, EdgeVitalsMessage
async with SensingClient("ws://localhost:8765/ws/sensing") as c:
    async for msg in c.stream():
        if isinstance(msg, EdgeVitalsMessage):
            print(msg.breathing_rate_bpm, msg.heartrate_bpm)

# Home Assistant 语义原语（ADR-115 HA-MIND）
from ruview.client import (
    RuViewMqttClient, SemanticPrimitive, SemanticPrimitiveListener,
)
```

wheel 覆盖 Linux（x86_64；aarch64 走 sdist）、macOS（sdist）
与 Windows（amd64 wheel）。采用稳定 ABI（`abi3-py310`）—— 一个二进制
即可覆盖 Python 3.10+。多架构原生 wheel 由
[pip-release.yml](../.github/workflows/pip-release.yml) 的 cibuildwheel
矩阵在每个 `v*-pip` 标签上产出。

> **从 v1.x 迁移？** 旧版 `wifi-densepose==1.1.0` 的 FastAPI
> 服务已停止维护。`wifi-densepose==1.99.0` 是墓碑版本，会
> 抛出带迁移链接的 `ImportError`；请升级到 `>=2.0.0a1`
> （或改用 `ruview`）。

从源码构建 wheel（例如本地改动后）：

```bash
git clone https://github.com/ruvnet/RuView.git
cd RuView/python
pip install maturin>=1.7
maturin develop --release
pytest tests/                              # 183 tests
pytest bench/ --benchmark-only             # 12 hot-path benchmarks
```

完整 API 与测试说明见 PyPI 首页：
[wifi-densepose 的 PyPI 页面](https://pypi.org/project/wifi-densepose/) ·
[ruview 的 PyPI 页面](https://pypi.org/project/ruview/)。

<a id="guided-installer"></a>
### 引导式安装器

交互式安装器会检测你的硬件并推荐一套配置：

```bash
git clone https://github.com/ruvnet/RuView.git
cd RuView
./install.sh
```

可选配置：`verify`、`python`、`rust`、`browser`、`iot`、`docker`、`field`、`full`。

非交互模式：
```bash
./install.sh --profile rust --yes
```

---

<a id="quick-start"></a>
## 快速上手

<a id="30-second-demo-docker"></a>
### 30 秒演示（Docker）

```bash
# 拉取并运行（未设 API 令牌时容器以退出码 64 结束）
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
docker run -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -e RUVIEW_API_TOKEN ruvnet/wifi-densepose:latest

# 在浏览器中打开界面
# http://localhost:3000
```

你会看到一个 Three.js 可视化界面，包含：
- 三维人体骨架（17 个 COCO 关键点）
- 信号幅度热力图
- 相位图
- 生命体征面板（呼吸 + 心跳）

<a id="verify-the-system-works"></a>
### 确认系统正常工作

另开一个终端测试 API：

```bash
# 健康检查
curl http://localhost:3000/health
# 预期：{"status":"ok","source":"simulated","clients":0}

# 最新感知帧
curl http://localhost:3000/api/v1/sensing/latest

# 生命体征
curl http://localhost:3000/api/v1/vital-signs

# 姿态估计（17 个 COCO 关键点）
curl http://localhost:3000/api/v1/pose/current

# 服务构建信息
curl http://localhost:3000/api/v1/info
```

所有接口都返回 JSON。模拟模式下，数据由一份确定性的参考信号生成。

---

<a id="data-sources"></a>
## 数据源

`--source` 参数决定 CSI 数据来自哪里。可用取值有
`auto`、`esp32`、`wifi` 与 `simulated`（别名 `simulate`），另外还有厂商
数据源 `mediatek`、`qualcomm`、`realtek`（RTL8720F 雷达）与 `realtek_csi`
（RTL8721Dx CSI），它们和 `esp32` 一样会绑定 UDP 接收端。填其他值
会让服务在启动时报错退出，错误信息里会列出所有合法取值。

<a id="simulated-mode-no-hardware"></a>
### 模拟模式（无需硬件）

Docker 下的默认值。生成合成 CSI 数据，把整条流水线跑通。

```bash
# Docker
docker run -p 3000:3000 ruvnet/wifi-densepose:latest
# (--source auto is the default; falls back to simulate when no hardware detected)

# 从源码运行
./target/release/sensing-server --source simulate --http-port 3000 --ws-port 3001
```

<a id="windows-wifi-rssi-only"></a>
### Windows WiFi（仅 RSSI）

用 `netsh wlan` 采集附近接入点的 RSSI，不需要专用硬件。支持在场检测、运动分类与粗粒度呼吸率估计，不支持姿态估计（那需要 CSI）。

```bash
# 从源码运行（仅 Windows）
./target/release/sensing-server --source wifi --http-port 3000 --ws-port 3001 --tick-ms 500

# Docker（Windows 上需要 --network host）
docker run --network host ruvnet/wifi-densepose:latest --source wifi --tick-ms 500
```

> **社区已验证：** 在 Windows 10 (10.0.26200)、Intel Wi-Fi 6 AX201 160MHz、Python 3.14、StormFiber 5 GHz 网络环境下实测，教程 7 个步骤全部通过，RSSI 读数稳定在 -48 dBm。完整操作过程与测试结果见[教程 #36](https://github.com/ruvnet/RuView/issues/36)。

**用 RSSI 测生命体征：** 感知服务器现在支持由 RSSI 方差模式估计呼吸率（需要受试者在 AP 附近保持静止），也能做带置信度评分的运动分类。基于 RSSI 的生命体征检测精度低于 ESP32 CSI —— 更适合做在场检测与粗粒度运动分类。

### macOS WiFi（仅 RSSI）

通过一个 Swift 辅助程序调用 CoreWLAN。macOS Sonoma 14.4+ 会隐去真实 BSSID，适配器会生成确定性的合成 MAC，让多 BSSID 流水线仍能工作。在 macOS 上 `--source wifi` 就是选用 CoreWLAN 扫描器，没有单独的 `macos` 取值。

```bash
# 编译 Swift 辅助程序（只需一次）
swiftc -O archive/v1/src/sensing/mac_wifi.swift -o mac_wifi

# 直接运行
./target/release/sensing-server --source wifi --http-port 3000 --ws-port 3001 --tick-ms 500
```

细节见 [ADR-025](adr/ADR-025-macos-corewlan-wifi-sensing.md)。

### Linux WiFi（仅 RSSI）

感知服务器目前还没有 Linux RSSI 数据源。`--source wifi`
在 Linux 上会去调用 Windows 的 `netsh` 扫描器，而那里并没有这个命令；
`--source linux` 会在启动时被拒绝。在 Linux 上请改用 ESP32 节点（`--source esp32`）。


<a id="esp32-s3-full-csi"></a>
### ESP32-S3（完整 CSI）

20 Hz 的真实信道状态信息，含 56-192 个子载波。姿态估计、生命体征与穿墙感知都需要它。

```bash
# 从源码运行
./target/release/sensing-server --source esp32 --udp-port 5005 --http-port 3000 --ws-port 3001 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>

# Docker（用 CSI_SOURCE 环境变量）
docker run -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 5005:5005/udp \
  -e RUVIEW_API_TOKEN -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW=<node-ip-or-cidr> \
  ruvnet/wifi-densepose:latest
```

ESP32 节点通过 UDP 把二进制 CSI 帧推送到 5005 端口。烧录步骤见[硬件配置](#esp32-s3-mesh)。

除非另行指定，服务只在 `127.0.0.1` 上监听这些帧（ADR-296）。因此直接运行二进制时要加 `--udp-bind 0.0.0.0` 才能收到局域网里节点的数据，还要用 `--udp-allow` 写明它们的 IP 或网段（例如 `192.168.1.0/24`）。少了这些参数，服务能正常启动，但永远看不到节点。如果你在可信网络里想接受任意来源，可以用 `--udp-insecure-lan` 代替 `--udp-allow`。

<a id="receiving-esp32-frames-in-docker"></a>
#### 在 Docker 中接收 ESP32 帧

感知服务器默认把 UDP 接收端绑在 `127.0.0.1`（ADR-296）。容器里这个地址收不到从 `5005/udp` 映射进来的数据，所以节点一直不出现。镜像的入口脚本只有在你设置了来源防护时才会把 UDP 绑到 `0.0.0.0`；没设置的话启动时会打印一条提示：

| 变量 | 作用 |
|----------|--------|
| `RUVIEW_API_TOKEN` | 必填。缺少它（或 `RUVIEW_ALLOW_UNAUTHENTICATED=1`）时容器以退出码 64 结束。 |
| `RUVIEW_UDP_ALLOW=<ip-or-cidr>` | 只接受来自这些来源的帧。推荐做法。 |
| `RUVIEW_UDP_INSECURE_LAN=true` | 接受任意来源的帧。UDP 数据面没有认证，请只在可信网络中使用。 |
| `RUVIEW_UDP_BIND` | 显式指定 UDP 绑定地址，覆盖入口脚本的选择。 |
| `SENSING_ALLOWED_HOSTS=<host-ip>` | 从别的机器打开界面时需要，否则服务返回 421。同时还要把 TCP 端口映射到 `127.0.0.1` 之外。 |

**macOS（Docker Desktop、OrbStack）：** 数据报是从 Docker 网桥网关进入容器的，而不是节点的局域网地址，所以白名单里只写局域网网段会把所有帧都丢掉。请改成允许网关：

```bash
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
GW=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
docker run --rm -d --name ruview \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 5005:5005/udp \
  -e RUVIEW_API_TOKEN -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW="$GW/32" \
  ruvnet/wifi-densepose:latest
curl -s -H "Authorization: Bearer $RUVIEW_API_TOKEN" localhost:3000/api/v1/nodes
```

允许网关等于放开了所有能访问该端口的来源，因此不要在不信任的网络里暴露 `5005/udp`。节点身份仍由帧内容决定。使用 Docker Compose 时服务跑在项目网络（`<project>_default`）上，要查看的是该网络的网关而不是 `bridge`。Windows 上的 Docker Desktop 有类似的源地址问题，见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

<a id="esp32-c5-experimental-csi-target"></a>
### ESP32-C5（实验性 CSI 目标）

C5 配置是无外设的：2.4 GHz 关联、240 MHz 应用 CPU、
8 Hz 边缘 DSP 与 4 MB OTA 分区布局。做可复现构建请用 `c5` 变体、
ESP-IDF 6.0.2 以及 esptool 5.3 以上版本。该配置不启用
5 GHz 与 PSRAM。目前没有确立任何 C5 提速或感知精度的结论。
C5 也跳过了默认的毫米波探测：S3 的 GPIO17/18 传感器引脚对
与 C5 的 flash/PSRAM 冲突。不要把 S3 的传感器引脚分配照搬到 C5。
真实板卡测试确认了启动与 CSI 传输解码，但测试用的 AP
未能持续稳定达到每秒 20 包的验收目标，即便
加了额外流量也一样。部署时请自行核对节奏；仅安装成功
并不能证明感知精度或长期可靠性。

确认具体的板型与量产芯片，核实 flash 至少 4 MB，
并在安装前私下保存一份完整 flash 备份。C5 的 bootloader
地址是 **`0x2000`**，与 S3/C6 不同。校验哈希并查看烧录方案：

```sh
node harness/ruview/bin/cli.js flash-plan --port COM8 --bundle ./c5-bundle --variant c5
```

选你自己板子实际的串口。看到 CP210x 只说明识别到了 USB 转串口芯片，
不代表认出了 ESP 芯片。若识别时收不到串口数据，按住 BOOT、点一下
RESET、松开 BOOT，再重试。烧录与配置完成后，必须取得
`CSI cb #1`（或更晚）的正向回调，以及持续有效的接收端数据包。
只有初始化信息不算硬件验证。凭据与
原始采集数据请勿外传。

参见 [C5 安装说明](../firmware/esp32-csi-node/README.md#esp32-c5-candidate-installation-and-qualification)
与[对比及认证记录](validation/2026-10-28-esp32-c5-candidate.md)。

<a id="esp32-multistatic-mesh-advanced"></a>
### ESP32 多静态组网（进阶）

想让穿墙追踪更准，可以部署 3-6 个 ESP32-S3 节点组成**多静态组网**。每个节点既发射又接收，在环境中形成多条感知路径。

```bash
# 以多静态模式启动汇聚端
./target/release/sensing-server --source esp32 --udp-port 5005 --http-port 3000 --ws-port 3001 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>
```

组网使用**时分复用（TDM）**协议，让节点轮流发射以避免自干扰。主要特性：

| 特性 | 说明 |
|---------|-------------|
| TDM 协调 | 节点按收发时隙轮转（保护间隔可配） |
| 跳频 | 自动在 2.4/5 GHz 频段间切换，用于多频融合 |
| QUIC 传输 | 汇聚节点上使用 TLS 1.3 加密流（ADR-032a） |
| 手工加密回退 | 资源受限的 ESP32-S3 节点用 HMAC-SHA256 信标认证 |
| 注意力加权融合 | 带几何多样性偏置的跨视角注意力 |

完整设计见 [ADR-029](adr/ADR-029-ruvsense-multistatic-sensing-mode.md) 与 [ADR-032](adr/ADR-032-multistatic-mesh-security-hardening.md)。

<a id="mediatek-router-csi-experimental"></a>
### MediaTek 路由器 CSI（实验性）

搭载 MT7981B + MT7976C 射频芯片的 OpenWrt 路由器（在 Wavlink WL-WN586X3 Rev A 上测过）打上 MediaTek 厂商 CSI 补丁后即可上报 CSI。主机侧的桥接程序把它转成 MTC1（ADR-267）交给感知服务器：

```bash
./target/release/sensing-server --source mediatek --udp-port 5005 --http-port 3000 --ws-port 3001
```

这些帧带有 `mediatek:physical-unvalidated` 标签。该数据源上的在场与活动输出是未校准的启发式结果，没有做过感知质量验证。只有已关联客户端在发送数据时才有 CSI。OpenWrt 构建、启用 CSI、桥接与限制见 [MediaTek 路由器 CSI 指南](mediatek-router-csi.md)。

<a id="connect-mesh-data-to-the-dashboard-and-observatory"></a>
### 把组网数据接到仪表盘与观测站

如果独立的 `aggregator` 命令能打印实时数据包，说明 ESP32 设备群已经能到达那台主机。要把同一份数据可视化，先停掉独立汇聚端，再在同一台主机、同一个 UDP 端口上运行 `sensing-server`。REST API、WebSocket 流、仪表盘与观测站用的汇聚端就是这个感知服务器。

```bash
# 从源码构建运行
cd v2
cargo run -p wifi-densepose-sensing-server -- \
  --source esp32 \
  --udp-port 5005 \
  --udp-bind 0.0.0.0 \
  --udp-allow <node-ip-or-cidr> \
  --http-port 3000 \
  --ws-port 3001 \
  --ui-path ../ui

# Docker
docker run --rm \
  -e RUVIEW_API_TOKEN \
  -e CSI_SOURCE=esp32 \
  -e RUVIEW_UDP_ALLOW=<node-ip-or-cidr> \
  -p 127.0.0.1:3000:3000 \
  -p 127.0.0.1:3001:3001 \
  -p 5005:5005/udp \
  ruvnet/wifi-densepose:latest
```

在 macOS 的 Docker 上，白名单必须写网桥网关，见[在 Docker 中接收 ESP32 帧](#receiving-esp32-frames-in-docker)。

请从感知服务器打开界面，不要用本地文件方式：

| 视图 | 地址 |
|------|-----|
| 仪表盘 | `http://localhost:3000/ui/index.html` |
| 观测站 | `http://localhost:3000/ui/observatory.html` |

排查浏览器问题前先做这几项检查：

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/status
curl http://localhost:3000/api/v1/nodes
curl http://localhost:3000/api/v1/sensing/latest
```

`/api/v1/status` 会说明帧是否真的在到达：

| `source_state` | 含义 |
|---|---|
| `disconnected` | 配了实时数据源，但还没有帧到达。此时 `waiting_for_frames` 为 `true`，`last_frame_age_ms` 为 `null`。 |
| `live_unverified` | 帧正在到达，`last_frame_age_ms` 小于 5000。 |
| `stale` | 曾有帧到达，随后中断超过 5 秒。硬件数据源的 `source` 会加上 `:offline` 后缀（例如 `esp32:offline`）。 |
| `synthetic` | 模拟数据，永远不会显示为实时。 |

如果 ESP32 节点用 `--target-ip <AGGREGATOR_HOST>` 配置过，这个 IP 必须是运行 `sensing-server` 的机器。同一时刻只能有一个进程接收 UDP `:5005`，所以仪表盘或观测站开着时，请关掉独立的硬件 `aggregator`。

<a id="cognitum-spaces-activation"></a>
### 启用 Cognitum Spaces

Cognitum Spaces 为 RuView 提供按租户/工作区隔离的语义世界模型，
不需要上传原始射频/CSI、录制文件、姿态帧、生命体征波形，
也不需要上传身份观测数据。它描述站点、建筑、楼层、有界的
房间/空间、区域、匿名实体、语义事件与告警。

用授权码 + PKCE 激活公开的 RuView OAuth 客户端：

```bash
wifi-densepose login --spaces
wifi-densepose whoami
wifi-densepose spaces --resource sites --limit 50
wifi-densepose spaces --resource events --limit 25
```

登录会申请 `sensing:read spaces:read`。该授权是只读的，
不授予发布、配对、策略批准、命令或执行器
权限。带版本的集合包括 `sites`、`buildings`、`floors`、
`spaces`、`zones`、`entities`、`events` 与 `alerts`。返回的
`nextCursor` 是不透明值，且只对同一集合有效。

零依赖的贡献者工具也提供同样的读取路径：

```bash
npx @ruvnet/ruview@0.9.1 spaces --resource alerts --limit 25
npx @ruvnet/ruview@0.9.1 mcp start
```

它的 MCP 工具是 `ruview_spaces_list`。MCP 读取只走 OAuth，使用固定的
Cognitum API 来源，并要求显式开启受保护工具。该工具
不接受任意指定的凭据路径或 API 来源。

为兼容服务端，`wifi-densepose spaces` 可在请求时读取
`COGNITUM_SPACES_API`。用 API key 访问带版本的集合时，
还需要 `--workspace <uuid>`；OAuth 则从签名令牌里
推导工作区。两种凭据都不要打印或提交。

每个响应都有大小限制并会重新校验。原始感知别名、格式错误的
层级、非匿名的人员/轨迹实体、无效时间戳、过期的
置信度，以及超大的结构都会按失败关闭处理。空数据只表示没有
已授权的状态，并不能证明某个物理站点是空的。

RuVector 的空间记忆在物理上按租户与工作区隔离。
智能体默认只能观察或建议。任何有实际后果的执行都需要
单独一次策略/授权/批准决策，并产生带签名、哈希链式的
回执；Spaces 的只读令牌永远无法通过这道门槛。

启用、记忆与受治理动作的决策见 ADR-325、ADR-326、ADR-327
三份 ADR。

<a id="cognitum-seed-integration-adr-069"></a>
### Cognitum Seed 集成（ADR-069）

把 ESP32-S3 接到 [Cognitum Seed](https://cognitum.one)（Pi Zero 2 W，约 $15），即可获得持久化向量存储、kNN 相似检索、密码学见证链，以及通过 MCP 代理供 AI 访问的感知能力。

**Seed 带来了什么：**
- **RVF 向量库** —— 持久化 8 维特征向量，带内容寻址 ID 与 kNN 检索（余弦、L2、点积）
- **见证链** —— 每次写入操作都有 SHA-256 防篡改审计轨迹
- **Ed25519 保管** —— 设备绑定的密钥对，用于感知数据的密码学证明
- **传感器融合** —— BME280（温湿度/气压）、PIR 运动、干簧管、4 通道 ADC 提供环境真值
- **MCP 代理** —— 通过 JSON-RPC 2.0 暴露 114 个工具，让 AI 助手（Claude、GPT）直接查询感知状态
- **反射规则** —— 按脆弱度、漂移与异常阈值自动触发告警

**配置步骤：**

```bash
# 1. 用 USB 接上 Cognitum Seed —— 会显示为 169.254.42.1 的网络适配器

# 2. 配对客户端（开启 30 秒窗口，出于安全只走 USB）
curl -sk -X POST https://169.254.42.1:8443/api/v1/pair/window
curl -sk -X POST https://169.254.42.1:8443/api/v1/pair \
  -H 'Content-Type: application/json' -d '{"client_name":"my-laptop"}'
# 保存返回的令牌 —— 只显示一次

# 3. 配置 ESP32，把特征发到运行桥接程序的笔记本
python firmware/esp32-csi-node/provision.py --port COM9 \
  --ssid "YourWiFi" --password "secret" \
  --target-ip 192.168.1.20 --target-port 5006 --node-id 1

# 4. 运行桥接（接收 ESP32 的 UDP 数据，经 HTTPS 写入 Seed）
export SEED_TOKEN="your-pairing-token"
python scripts/seed_csi_bridge.py \
  --seed-url https://169.254.42.1:8443 --token "$SEED_TOKEN" \
  --udp-port 5006 --batch-size 10 --validate

# 5. 查看 Seed 状态
python scripts/seed_csi_bridge.py --token "$SEED_TOKEN" --stats

# 6. 触发压缩（回收已删除向量占用的磁盘空间）
python scripts/seed_csi_bridge.py --token "$SEED_TOKEN" --compact
```

**特征向量各维（magic `0xC5110003`，48 字节，1 Hz）：**

| 维度 | 特征 | 范围 | 来源 |
|-----|---------|-------|--------|
| 0 | 在场得分 | 0.0–1.0 | `s_presence_score / 10.0` |
| 1 | 运动能量 | 0.0–1.0 | `s_motion_energy / 10.0` |
| 2 | 呼吸率 | 0.0–1.0 | `s_breathing_bpm / 30.0` |
| 3 | 心率 | 0.0–1.0 | `s_heartrate_bpm / 120.0` |
| 4 | 相位方差 | 0.0–1.0 | top-K 子载波的 Welford 方差均值 |
| 5 | 人数 | 0.0–1.0 | 活跃人数 / 4 |
| 6 | 检测到跌倒 | 0.0 或 1.0 | 二值跌倒标志 |
| 7 | RSSI | 0.0–1.0 | `(rssi + 100) / 100` |

**架构：**

```
ESP32-S3 ($9)  ──UDP:5006──>  Host (bridge)  ──HTTPS──>  Cognitum Seed ($15)
  CSI @ 100 Hz                seed_csi_bridge.py           RVF vector store
  Features @ 1 Hz            Batches, validates            kNN graph + boundary
  Vitals @ 1 Hz              NaN rejection                 Witness chain
                              Source IP filtering           114-tool MCP proxy
```

完整设计、验证结果与安全分析见 [ADR-069](adr/ADR-069-cognitum-seed-csi-pipeline.md)。

---

<a id="rest-api-reference"></a>
## REST API 参考

基础地址：Docker 为 `http://localhost:3000`，直接运行二进制时默认 `http://localhost:8080`。

| 方法 | 接口 | 说明 | 响应示例 |
|--------|----------|-------------|-----------------|
| `GET` | `/health` | 服务健康检查 | `{"status":"ok","source":"simulated","clients":0}` |
| `GET` | `/api/v1/sensing/latest` | 最新 CSI 感知帧（幅度、相位、运动） | 含子载波数组的 JSON |
| `GET` | `/api/v1/vital-signs` | 呼吸率 + 心率 + 置信度 | `{"breathing_bpm":16.2,"heart_bpm":72.1,"confidence":0.87}` |
| `GET` | `/api/v1/pose/current` | 17 个 COCO 关键点（x、y、z、置信度） | 17 个关节位置的数组 |
| `GET` | `/api/v1/info` | 服务版本、构建信息、运行时长 | JSON 元数据 |
| `GET` | `/api/v1/bssid` | 多 BSSID WiFi 登记表 | 检测到的接入点列表 |
| `GET` | `/api/v1/model/layers` | 模型渐进加载状态 | A/B/C 各层加载情况 |
| `GET` | `/api/v1/model/sona/profiles` | SONA 自适应配置档 | 环境配置档列表 |
| `POST` | `/api/v1/model/sona/activate` | 为指定房间启用某个 SONA 配置档 | `{"profile":"kitchen"}` |
| `GET` | `/api/v1/models` | 列出可用的 RVF 模型文件 | `{"models":[...],"count":0}` |
| `GET` | `/api/v1/models/active` | 当前加载的模型（或 null） | `{"model":null}` |
| `POST` | `/api/v1/models/load` | 按 ID 加载模型 | `{"status":"loaded","model_id":"..."}` |
| `POST` | `/api/v1/models/unload` | 卸载当前模型 | `{"status":"unloaded"}` |
| `DELETE` | `/api/v1/models/:id` | 从磁盘删除模型文件 | `{"status":"deleted"}` |
| `GET` | `/api/v1/models/lora/profiles` | 列出 LoRA 适配器配置档 | `{"profiles":[]}` |
| `POST` | `/api/v1/models/lora/activate` | 启用某个 LoRA 配置档 | `{"status":"activated"}` |
| `GET` | `/api/v1/recording/list` | 列出 CSI 录制会话 | `{"recordings":[...],"count":0}` |
| `POST` | `/api/v1/recording/start` | 开始把 CSI 帧录制为 JSONL | `{"status":"recording","session_id":"..."}` |
| `POST` | `/api/v1/recording/stop` | 停止当前录制 | `{"status":"stopped","duration_secs":...}` |
| `DELETE` | `/api/v1/recording/:id` | 删除录制文件 | `{"status":"deleted"}` |
| `GET` | `/api/v1/train/status` | 训练任务状态 | `{"phase":"idle"}` |
| `POST` | `/api/v1/train/start` | 启动一次训练 | `{"status":"started"}` |
| `POST` | `/api/v1/train/stop` | 停止当前训练 | `{"status":"stopped"}` |
| `POST` | `/api/v1/adaptive/train` | 用录制数据训练自适应分类器 | `{"success":true,"accuracy":0.85}` |
| `GET` | `/api/v1/adaptive/status` | 自适应模型状态与准确率 | `{"loaded":true,"accuracy":0.85}` |
| `POST` | `/api/v1/adaptive/unload` | 卸载自适应模型 | `{"success":true}` |
| `GET` | `/api/v1/mesh` | ADR-110 全设备组网同步图（[第 29 轮](adr/ADR-110-esp32-c6-firmware-extension.md)） | `{"nodes":{"9":{...},"12":{...}},"total":2}` |
| `GET` | `/api/v1/nodes/:id/sync` | 单节点组网同步快照（或 404） | `{"offset_us":1163565,"is_leader":false,...}` |
| `GET` | `/api/v1/mesh/metrics` | Prometheus 文本格式的 ADR-110 组网状态（[第 36 轮](adr/ADR-110-esp32-c6-firmware-extension.md)） | `wifi_densepose_mesh_offset_us{node="9"} 1163565\n…` |
| `GET` | `/api/field` | ADR-262 P3 —— 实时感知周期里最新的**已签名 RuField `FieldEvent`**，外加签名者公钥与 `dev_signing_key` 标志。只暴露可外发的（P1/P2）事件；身份/生物特征（P4/P5）与原始（P0）数据留在边缘端 | `{"spec":"rufield","signer_pubkey_hex":"…","dev_signing_key":true,"events":[…]}` |

录制与模型文件都放在服务的 `--data-dir` 下（环境变量 `RUVIEW_DATA_DIR`，默认 `data`，相对于服务启动时所在目录解析）：录制文件在 `<data-dir>/recordings/`，`.rvf` 模型在 `<data-dir>/models/`（除非设置了 `MODELS_DIR`），自适应分类器在 `<data-dir>/adaptive_model.json`。

### RuField 接口（ADR-262 P3）

RuView 的实时 WiFi-CSI 感知现在也支持独立的 **RuField MFS** 线上格式。每个受治理的感知周期都会经 `wifi-densepose-rufield` 防腐层转换成**带签名的** `FieldEvent`（`Modality::WifiCsi`、ed25519 `ProvenanceRef`），并通过两个新增接口暴露：

- `GET /api/field` —— 最近的已签名事件（JSON）。
- `GET /ws/field` —— 按周期推送已签名事件的 WebSocket（与 `/ws/sensing` 对应）。

```bash
curl -s http://localhost:3000/api/field | python -m json.tool          # 最近的已签名 FieldEvent
python -c "import asyncio,websockets; asyncio.run((lambda: websockets.connect('ws://localhost:8765/ws/field'))())"  # 数据流
```

隐私按失败关闭设计：只有可外发的 **P1/P2** 事件会离开设备 —— 原始（P0）与身份/生物特征/聚合（P3–P5）周期都留在**边缘端**，绝不会出现在这些接口上；无人周期**不产生任何事件**。

**签名密钥：** 该接口用一把**专用的开发/感知密钥**签名，种子来自 `WDP_RUFIELD_SIGNING_SEED`（64 字符十六进制串，或不少于 32 字节的值）；未设置时回退到确定性的开发默认值并打印一条 `WARN`（`/api/field` 里的 `dev_signing_key` 标志会反映这一点）。在 ADR-262 §8 Q1 确定密钥归属之前，这是一把临时独立密钥 —— 任何真实部署都应设置 `WDP_RUFIELD_SIGNING_SEED`。

> **如实说明（ADR-262 §0/§6）：** 这是跑在真实接口上的实际链路，**不是精度宣称**。它仍是单链路 CSI 感知，原有局限都在（房间坐标精度未经验证 —— 位置取的是「最强的场峰」，并非校准过的三角定位）。

### 示例：获取全设备组网状态（ADR-110）

```bash
curl -s http://localhost:3000/api/v1/mesh | python -m json.tool
```

```json
{
    "nodes": {
        "9": {
            "offset_us":       1163565,
            "is_leader":       false,
            "is_valid":        true,
            "smoothed":        true,
            "sequence":        20,
            "csi_fps_ema":     10.0,
            "csi_fps_samples": 47
        },
        "12": {
            "offset_us":       -7,
            "is_leader":       true,
            "is_valid":        true,
            "smoothed":        false,
            "sequence":        20,
            "csi_fps_ema":     10.0,
            "csi_fps_samples": 51
        }
    },
    "total": 2
}
```

返回空的 `{"nodes": {}, "total": 0}` 表示没有可达的组网节点。
尚未发出同步包的节点不会出现在图里。

### 示例：获取单个节点的同步状态

```bash
curl -s http://localhost:3000/api/v1/nodes/9/sync | python -m json.tool
```

200 → 结构与 `/api/v1/mesh` 里的 `NodeSyncSnapshot` 或
WebSocket 的 `sync` 字段相同。各字段含义见
[逐节点组网同步（ADR-110）](#per-node-mesh-sync-adr-110)。

404（未知节点）：
```json
{"error": "unknown_node", "node_id": 99}
```

404（节点存在但尚未同步）：
```json
{
    "error":   "no_sync",
    "node_id": 9,
    "hint":    "node hasn't emitted a sync packet yet (no mesh peer or not v0.6.9+)"
}
```

适合 Home Assistant 的 REST 传感器、Prometheus exporter、
自动化规则探测与 curl 调试 —— 凡是需要
一次性拿到组网状态、又不想保持 WebSocket 连接的场合。

### 示例：获取生命体征

```bash
curl -s http://localhost:3000/api/v1/vital-signs | python -m json.tool
```

```json
{
    "breathing_bpm": 16.2,
    "heart_bpm": 72.1,
    "breathing_confidence": 0.87,
    "heart_confidence": 0.63,
    "motion_level": 0.12,
    "timestamp_ms": 1709312400000
}
```

### 示例：获取姿态

```bash
curl -s http://localhost:3000/api/v1/pose/current | python -m json.tool
```

```json
{
    "persons": [
        {
            "id": 0,
            "keypoints": [
                {"name": "nose", "x": 0.52, "y": 0.31, "z": 0.0, "confidence": 0.91},
                {"name": "left_eye", "x": 0.54, "y": 0.29, "z": 0.0, "confidence": 0.88}
            ]
        }
    ],
    "frame_id": 1024,
    "timestamp_ms": 1709312400000
}
```

---

<a id="websocket-streaming"></a>
## WebSocket 数据流

实时感知数据可通过 WebSocket 获取。

**地址：** `ws://localhost:3000/ws/sensing`（与 HTTP 同端口 —— 推荐）或 `ws://localhost:3001/ws/sensing`（专用 WS 端口）。

> **说明：** `/ws/sensing` WebSocket 接口在 HTTP 端口（3000）和专用 WebSocket 端口（3001/8765）上都可用。Web 界面走 HTTP 端口，这样只需暴露一个端口。专用 WS 端口保留是为了向后兼容。

### Python 示例

```python
import asyncio
import websockets
import json

async def stream():
    uri = "ws://localhost:3001/ws/sensing"
    async with websockets.connect(uri) as ws:
        async for message in ws:
            data = json.loads(message)
            persons = data.get("persons", [])
            vitals = data.get("vital_signs", {})
            print(f"Persons: {len(persons)}, "
                  f"Breathing: {vitals.get('breathing_bpm', 'N/A')} BPM")

asyncio.run(stream())
```

### JavaScript 示例

```javascript
const ws = new WebSocket("ws://localhost:3001/ws/sensing");

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Persons:", data.persons?.length ?? 0);
    console.log("Breathing:", data.vital_signs?.breathing_bpm, "BPM");
};

ws.onerror = (err) => console.error("WebSocket error:", err);
```

### curl（单帧）

```bash
# 需要 wscat（npm install -g wscat）
wscat -c ws://localhost:3001/ws/sensing
```

<a id="per-node-mesh-sync-adr-110"></a>
### 逐节点组网同步（ADR-110）

自固件 **v0.7.0-esp32** 与感知服务器第 23 轮起，
凡节点参与 [ADR-110](adr/ADR-110-esp32-c6-firmware-extension.md) 组网的
`sensing_update`，每个节点都会带一个可选的 `sync` 对象：

```json
{
  "type": "sensing_update",
  "nodes": [
    {
      "node_id": 9,
      "rssi_dbm": -38.0,
      "amplitude": [...],
      "subcarrier_count": 64,
      "sync": {
        "offset_us":       1163565,
        "is_leader":       false,
        "is_valid":        true,
        "smoothed":        true,
        "sequence":        20,
        "csi_fps_ema":     10.0,
        "csi_fps_samples": 47
      }
    }
  ]
}
```

字段含义：

| 字段 | 类型 | 含义 |
|---|---|---|
| `offset_us` | i64 | 本机相对组网时钟的平滑后偏移，单位微秒。该节点落后于主节点时为负。台架 §A0.10 实测两块 C6 板启动相差约 1.16 s。 |
| `is_leader` | bool | 该节点被选为组网主节点（组内 EUI-64 最小者）时为真。 |
| `is_valid` | bool | 该节点在固件的 `VALID_WINDOW_MS = 3 s` 新鲜度窗口内收到过主节点信标时为真。 |
| `smoothed` | bool | 固件侧 EMA 滤波器完成初始化后为真（约 8 个信标，跟随模式下约 0.8 s）。 |
| `sequence` | u32 | 发出该同步包时打上的 CSI 序列号高水位。配合收到的 CSI 逐帧 `sequence` 字段，可为任意帧插值出与组网对齐的时间戳。 |
| `csi_fps_ema` | f64 | 逐节点的 CSI 帧率 EMA。台架典型值约 10 Hz。 |
| `csi_fps_samples` | u32 | EMA 已看到的帧间间隔数量。小于 5 时视为「尚不可信」，回退到 20 Hz。 |
| `staleness_ms` | u64（可选） | 距主机上次收到该节点同步包的毫秒数（[第 34 轮](adr/ADR-110-esp32-c6-firmware-extension.md)）。超过 5 000 ms 时让界面徽标淡出；≥ 9 000 ms 时按固件 `c6_sync_espnow_is_valid()` 返回 `false` 的同一条件处理。 |

**完全不带 `sync` 时**：说明该节点不在组网里（或
还没听到其他节点）。非 ESP32 路径 —— 多 BSSID 路由器扫描、
合成 RSSI 回退、模拟 —— 同样不带 `sync`。第 23 轮之前的
界面客户端本来就不读这个字段，因此会自然忽略它。


**界面上怎么呈现**：
- `is_leader === true` → 给节点加「主节点」标记
- `is_valid === false` → 置灰 / 「同步丢失」
- `csi_fps_samples < 5` → 标为「校准中」，直到达到 5 帧
- `|offset_us|` 趋势 → 画抖动直方图，用于展示 §A0.10 中
  EMA 抑制在实时运行中的效果

**如何从该节点任意一帧 CSI 还原与组网对齐的时间戳**：
取该帧自身的 `sequence` u32，减去 `sync.sequence`，
再除以 `sync.csi_fps_ema`（`csi_fps_samples < 5` 时用 20.0），
乘以 1 000 000 µs —— 这就是相对同步包发出时刻的
组网时间差。用它把同一批板子的多静态帧对齐。

---

## Home Assistant + Matter 集成

完整设计与运维指南：[`docs/integrations/home-assistant.md`](integrations/home-assistant.md)（ADR-115）。

### 30 秒 Mosquitto 插件流程

1. 在 Home Assistant 内，从插件商店安装 **Mosquitto broker** 插件并启动。
2. 在 HA 中，**Settings → Devices & Services → Add Integration → MQTT**，指向该 broker。
3. 以 MQTT 方式启动 sensing-server：

   ```bash
   docker run --rm --net=host ruvnet/wifi-densepose:0.7.0 \
       --source esp32 --mqtt --mqtt-host <ha-host-ip>
   ```
4. 约 5 秒内，HA 会为每个 RuView 节点自动创建一个**设备**，包含 21 个实体：11 个原始信号（存在、人数、心率、呼吸率、运动、跌倒、RSSI、区域、姿态……）以及 10 个语义原语（有人在睡觉、可能遇险、房间活跃、老人久坐异常、会议、浴室、跌倒风险、离床、无运动、多房间转移）。

### 医疗 / 适老化（AAL）场景的隐私模式

```bash
sensing-server --mqtt --mqtt-host <broker> --mqtt-tls --privacy-mode
```

`--privacy-mode`（环境变量 `RUVIEW_PRIVACY_MODE`）是一个服务级开关。它会从所有输出中剔除心率、呼吸率与姿态关键点：

- REST 响应：这些字段会从每个 JSON 响应体中移除（`/api/v1/sensing/latest`、`/api/v1/vital-signs`、`/api/v1/edge-vitals`、`/api/v1/pose/current` …）。`/api/v1/pose/current?view=both|refined` 会返回 `403`，附带 `"code": "privacy_mode"`。
- WebSocket 流：`/ws/sensing` 与 `/api/v1/stream/pose` 帧以同样方式被过滤。
- 通过 `POST /api/v1/recording/start` 启动的录制，写入时已是被过滤后的内容。
- MQTT 与 Matter：这些实体既不被宣告也不被发布。

存在、运动、人数、区域以及粗略姿态标签仍会输出，语义原语也照常发布——因为它们推断的是*状态*而非生物特征*数值*。其中部分状态（睡眠、可能遇险）源自生命体征，因此仍属健康相关信息。隐私模式只是减少了离开服务的数据，本身并不能让部署符合任何法规。

### Matter 桥接（Apple Home / Google Home / Alexa / SmartThings）

暂不可用。ADR-115 里的 `--matter` 与 `--matter-setup-file` 标志虽在该 crate 的库级 CLI 中定义，但 `sensing-server` 二进制并不接受（`error: unexpected argument '--matter' found`），因此目前无法启动 Matter 桥接。暂请使用上文的 MQTT 集成对接 Home Assistant。

实体详细参考、蓝图目录、排障配方矩阵见 [`docs/integrations/home-assistant.md`](integrations/home-assistant.md)。

### BFLD —— 隐私门控的 WiFi BFI 感知层（ADR-118）

`wifi-densepose-bfld` crate 在感知流水线上方增加了一层显式的隐私门控。它摄取 802.11ac/ax 波束成形反馈信息（BFI），并输出有界、已分类的感知事件，HA / Matter / MQTT 消费方可在**不泄露**可鉴别身份数据的前提下读取。

类型系统强制保证三项结构性不变量：

- **I1** —— 原始 BFI 永不离开节点（`Sink` 标记 trait 体系）
- **I2** —— 身份嵌入仅存于内存（无 `Serialize`/`Clone`/`Copy`；`Drop` 时清零）
- **I3** —— 跨站点身份关联在密码学上不可能（每站点 BLAKE3 密钥哈希 + 每日周期轮换）

#### 运维者最简快速上手

该 crate 自带两个可运行示例：

```bash
# 进程内消费方：构建流水线、发送一帧、打印事件 JSON
cargo run -p wifi-densepose-bfld --example bfld_minimal

# 工作线程 + HA-DISCO：完整发布生命周期（可用性 + 发现 + 状态 + LWT）
cargo run -p wifi-densepose-bfld --example bfld_handle
```

#### 生产发布生命周期（HA-DISCO + MQTT）

```rust
// 引导（启动时执行一次，retain=true 消息）：
publish_availability_online(&mut retained_pub, "seed-01")?;
publish_discovery(&mut retained_pub, "seed-01", PrivacyClass::Anonymous)?;

// 每帧：
let handle = BfldPipelineHandle::spawn(pipeline, state_pub);
handle.send(PipelineInput { inputs, embedding })?;
```

每个节点自动创建 6 个 HA 实体（`binary_sensor.*_bfld_presence`、`sensor.*_bfld_motion`/`person_count`/`zone_activity`/`confidence`/`identity_risk`）。`identity_risk` 实体**仅在 `PrivacyClass::Anonymous` 时存在**；`Restricted` 级别部署（养老院、受监管环境）会在发现与状态主题中整体剔除它。

#### 三个运维者 HA 蓝图

位于 `v2/crates/cog-ha-matter/blueprints/bfld/`：

- `presence-lighting.yaml` —— `binary_sensor.*_bfld_presence` ⇒ `light.turn_on/off`，保持时长可配置
- `motion-hvac.yaml` —— `sensor.*_bfld_motion > threshold` ⇒ `climate.set_temperature`，调整 ΔT
- `identity-risk-anomaly.yaml` —— 滚动 7 天 z-score 告警（需要 HA Statistics 辅助实体）

通过 HA 界面导入：Settings → Automations & Scenes → Blueprints → Import。

#### 隐私等级部署矩阵

| 等级 | 身份字段 | 用途 |
|-------|-----------------|----------|
| `Raw` | 完整 BFI 矩阵 | 仅本地研究（永不联网） |
| `Derived` | 降采样角度 + 风险评分 | 运维者确认的局域网研究模式 |
| `Anonymous`（默认） | 仅聚合感知 + 风险评分 + 轮换哈希 | 生产环境 HA / Matter 部署 |
| `Restricted` | 仅聚合感知，身份字段已剥离 | 养老院、类 GDPR/HIPAA 受监管环境 |

`BfldPipeline` 上的 `enable_privacy_mode()` 运行时开关，可在不重启流水线的情况下从任意基线切换到 `Restricted`——适用于安全事件响应。

#### MQTT 主题树

```
ruview/<node_id>/bfld/availability         online / offline
ruview/<node_id>/bfld/presence/state       true / false
ruview/<node_id>/bfld/motion/state         0.000000..1.000000
ruview/<node_id>/bfld/person_count/state   integer
ruview/<node_id>/bfld/confidence/state     0.000000..1.000000
ruview/<node_id>/bfld/zone_activity/state  "<zone_name>"  (if configured)
ruview/<node_id>/bfld/identity_risk/state  0.000000..1.000000  (class 2 only)
```

`rumqttc 0.24`（`use-rustlis`）后端随 `mqtt` 特性一同提供；`RumqttPublisher::connect_with_lwt(node_id, opts, capacity)` 会预先配置遗嘱（Last Will and Testament），从而在会话断开时由 broker 自动发布 `"offline"`。

详见：[`v2/crates/wifi-densepose-bfld/README.md`](../v2/crates/wifi-densepose-bfld/README.md)、[`docs/research/BFLD/`](research/BFLD/)（11 个文件，13,544 词）、[ADR-118 至 ADR-123](adr/ADR-118-bfld-beamforming-feedback-layer-for-detection.md)。

### SENSE-BRIDGE —— 面向 AI 智能体的 rvagent MCP 服务（ADR-124）

`@ruvnet/rvagent` 是一个双传输 MCP 服务，让 Claude Code、Cursor 与 ruflo 集群无需定制 HTTP 客户端代码即可调用 RuView 的感知原语。

**安装（Claude Code）**：

```bash
claude mcp add rvagent -- npx @ruvnet/rvagent stdio
# With a remote sensing-server:
RUVIEW_SENSING_SERVER_URL=http://cognitum-v0:3000 claude mcp add rvagent -- npx @ruvnet/rvagent stdio
```

**可用工具（v0.1.0 共 20 个中的 6 个）**：

| Tool | Returns |
|------|---------|
| `ruview.presence.now` | `present`, `n_persons`, `confidence`, `timestamp_ms` |
| `ruview.vitals.get_breathing` | `breathing_rate_bpm` (null if unavailable), `confidence` |
| `ruview.vitals.get_heart_rate` | `heartrate_bpm` (null if unavailable), `confidence` |
| `ruview.vitals.get_all` | Full `EdgeVitalsMessage` (all vitals in one call) |
| `ruview.bfld.last_scan` | `identity_risk_score`, `privacy_class`, `n_frames`, `timestamp_ms` |
| `ruview.bfld.subscribe` | `subscription_id`, `expires_at`, `topic` (MQTT wildcard) |

**可流式 HTTP**（用于远程 ruflo 集群）：

```bash
RVAGENT_HTTP_TOKEN=secret npx @ruvnet/rvagent http --port 3001
# 向 http://127.0.0.1:3001/mcp 发送 JSON-RPC
# 跨域请求会被 403 拒绝；token 缺失或错误 → 401。
```

来源：[`tools/ruview-mcp/`](../tools/ruview-mcp/README.md)。跟踪 issue：[#787](https://github.com/ruvnet/RuView/issues/787)。完整 ADR：[ADR-124](adr/ADR-124-rvagent-mcp-ruvector-npm-integration.md)。

---

<a id="ruview-npm-toolkit-ruvnetruview"></a>
## RuView npm 工具包（`@ruvnet/ruview`）

`@ruvnet/ruview` 是 RuView 在 npm 上的运维工具包，无任何运行时
依赖，可运行于 Node 20+，已在 Windows 与 Linux 上测试。单个工具
注册表同时提供：
- 一个 CLI；
- 一个 MCP 服务（stdio，或面向 ChatGPT 的 HTTP）；
- 一个带类型的 SDK；
- 一个 Claude Code 插件。

所有结果都如实标注其来源：
- **MEASURED**（来自本机真实数据包时）；
- **SYNTHETIC**（模拟器与自测时）；
- **device-reported**（雷达自带固件算出的数值，此类数值
  未经参照基准校验）。

```bash
npx @ruvnet/ruview@0.9.1 --help
npx @ruvnet/ruview@0.9.1 doctor          # what works on this machine, with fixes
```

在终端中，命令会打印格式化视图；通过管道或 `--json` 则打印 JSON，
便于脚本处理。

<a id="hardware-from-the-command-line"></a>
### 通过命令行操作硬件

请在这些命令所连硬件所在的机器上运行。

```bash
# 查看已接入的设备（USB VID:PID → ESP32、Realtek RTL8721Dx、雷达、LiDAR）
npx @ruvnet/ruview@0.9.1 devices

# 向本机推流的 CSI 节点（UDP 5005）：ESP32 的 ADR-018 帧，以及
# Realtek RAC1 帧，含每节点速率、丢包、RSSI 与 CSI 形态
npx @ruvnet/ruview@0.9.1 esp32 --seconds 10
npx @ruvnet/ruview@0.9.1 esp32 --watch                 # live view, redrawn every few seconds
npx @ruvnet/ruview@0.9.1 esp32 --seconds 45 --analyze  # live CSI through the vitals kernel

# 开发板的串口控制台，且不会复位它
npx @ruvnet/ruview@0.9.1 monitor --port COM9
npx @ruvnet/ruview@0.9.1 monitor --port COM10 --baud 1500000   # Realtek Ameba

# 60 GHz / 24 GHz 雷达：原始 UART，或你网络中的 ESPHome 套件
npx @ruvnet/ruview@0.9.1 mmwave --port COM5 --model auto
npx @ruvnet/ruview@0.9.1 mmwave --source esphome --host 192.168.1.50

# 烧录 ESP32 固件：先 plan，再用 --confirm 写入（记录启动证据）
npx @ruvnet/ruview@0.9.1 flash-plan --port COM16 --bundle firmware/esp32-csi-node/release_bins/c6-adr110 --variant c6
npx @ruvnet/ruview@0.9.1 flash --port COM16 --bundle firmware/esp32-csi-node/release_bins/c6-adr110 --variant c6 --confirm
```

**各告警含义：**

| 告警 | 含义 |
|---|---|
| `heartbeat-only sender` | 开发板在线但不发送 CSI。若是 Realtek 板，运行 `monitor --baud 1500000`；若显示 `lack of csi buf`，说明 CSI 报告缓冲区耗尽（`csi_buffer_starvation`）。请复位。 |
| `port_in_use` | 感知服务已占用 UDP 5005。请停止它，或改用节点指向的其他端口抓包。 |
| `no_decodable_packets` | 收到了数据包，但没有一个符合已知的 RuView 格式。请检查发送方。 |
| `seqReordered` / `seqStrays` | 乱序或游离的序列号。这些不计入丢包。 |

**ESPHome 雷达套件**（如 Seeed MR60BHA2）：套件固件
直接掌控雷达，因此需通过 `--source esphome` 经网络读取。
- 若套件无法接入你的 WiFi，它会启动一个应急热点。连接该热点，
  在其强制门户 `http://192.168.4.1` 中设置你的网络。
- 仅接受私有网络地址。
- 加密或带密码的 ESPHome API 会被报告为不支持。

<a id="mcp-for-agents-chatgpt-and-mcp-apps"></a>
### 面向智能体、ChatGPT 与 MCP 应用的 MCP

```bash
# Claude Code、Codex 或任意 MCP 客户端（stdio）
claude mcp add ruview -- npx -y @ruvnet/ruview@0.9.1 mcp start

# HTTP，用于 ChatGPT 与远程客户端
export RUVIEW_MCP_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
RUVIEW_MCP_GRANTS=device-access npx @ruvnet/ruview@0.9.1 mcp start --http --port 8790
```

**接入 ChatGPT。** 能发送请求头的客户端使用
`Authorization: Bearer <token>`。ChatGPT 连接器做不到这一点，因此：
1. 通过隧道或反向代理以 HTTPS 暴露该端口。
2. 将 `https://<your-host>/mcp/<token>` 添加为连接器 URL。

**最小权限原则：**
- 硬件工具需要 `device-access` 授权。
- HTTP 传输默认绑定到 localhost。
- 它会拒绝未知的浏览器来源。
- 无论授予何种权限，它都绝不允许烧录或校准。

节点抓包、雷达读数、设备扫描与诊断结果都会在
**RuView 控制台**中渲染：这是 ChatGPT 及其他 MCP 应用以内联方式展示的组件，
带有一个「刷新」按钮可重新运行该工具。

<a id="claude-code-mod-live-sensing-pane"></a>
### Claude Code 插件：实时感知面板

该包附带 `ruview-live` 这一 Claude Code 插件。`/ruview` 会在对话旁打开一个面板，
并按计时器刷新，展示：
- 你的 CSI 节点；
- 可选的 ESPHome 雷达；
- 告警信息。

它还会维护一行状态，例如 `RuView · 2 nodes · radar present`。

按键 `1`、`2`、`3` 在三种视图间切换（ADR-378）：
- **概览**：卡片视图。
- **CSI 瀑布图**：各子载波随时间的幅度，标注为 MEASURED 或
  SYNTHETIC；按 `n` 切换节点。
- **雷达**：带动态 ping 的距离扇形，外加心率、呼吸与
  距离图表。这些数值为 device-reported（设备上报），未经校验，且套件
  报告的是距离而非方位。

这两个实时视图在终端单元格中绘制并就地动画。

```bash
npx @ruvnet/ruview@0.9.1 mod           # prints the mod's path in your install and how to load it
claude --plugin-dir "<that path>"       # try it for one session
# or from the RuView marketplace, inside Claude Code:
#   /plugin marketplace add ruvnet/RuView
#   /plugin install ruview-live@ruview
```

| 在 Claude Code 中 | 作用 |
|---|---|
| `/ruview` | 打开或关闭面板 |
| `/ruview refresh` | 立即执行一次抓包，结果进入状态行 |
| `/ruview off` | 关闭面板 |
| `/ruview waterfall` / `/ruview radar` | 以对应视图打开 |

**设置**（`claude plugin configure ruview-live`）：`udpPort`、`radarHost`、
`refreshSeconds`、`captureSeconds` 与 `liveRefreshSeconds`（实时视图，
默认 4 秒）。

该插件只运行本包的只读 CLI 命令。插件尚处早期访问阶段：
若 `/ruview` 不可用，请使用以下环境变量启动 Claude Code：
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`。

<a id="homecore-and-the-vitals-kernel"></a>
### Homecore 与生命体征内核

```bash
npx homecore@0.1.0 guidance --topic plugins --query Wasmtime   # Homecore developer metaharness
npx @ruvnet/ruview-kernel@0.1.0 selftest                       # vitals pipeline as WASM (SYNTHETIC self-test)
```

`esp32 --analyze` 在安装了该内核时会调用它。其心率与呼吸
估计附带「无参照测量」标注：它们只说明信号链路通畅，
并不意味着读数准确。

设计记录：
- [ADR-373](adr/ADR-373-host-device-access-layer.md)：设备访问；
- [ADR-375](adr/ADR-375-ruview-mcp-apps-console-http-transport-and-terminal-ui.md)：
  MCP 应用控制台、HTTP 传输与终端界面；
- [ADR-376](adr/ADR-376-ruview-umbrella-npm-package.md)：一键安装
  的 `ruview` 包（npm 名称待定）；
- [ADR-377](adr/ADR-377-ruview-live-claude-code-mod.md)：Claude Code 插件。
- [ADR-378](adr/ADR-378-ruview-live-showcase-views.md)：插件的 CSI 瀑布图与雷达视图（按键 1/2/3、`esp32 --spectrum`）。

---

<a id="web-ui"></a>
## Web 界面

内置的 Three.js 界面由 `http://localhost:3000/ui/`（Docker）或配置的 HTTP 端口提供。

**两种可视化模式：**

| 页面 | URL | 用途 |
|------|-----|---------|
| **仪表盘** | `/ui/index.html` | 带标签页的监控仪表盘，含人体模型、信号热力图、相位图、生命体征 |
| **观测台** | `/ui/observatory.html` | 沉浸式 3D 房间可视化，带电影级光照与线框人物 |

**仪表盘面板：**

| 面板 | 说明 |
|-------|-------------|
| 3D 人体视图 | 可旋转线框骨架，含 17 个 COCO 关键点 |
| 信号热力图 | 56 个子载波按幅度着色 |
| 相位图 | 各子载波相位随时间变化 |
| 多普勒条 | 运动频段能量指示 |
| 生命体征 | 实时呼吸率（BPM）与心率（BPM） |
| 仪表盘 | 系统统计、吞吐量、已连接的 WebSocket 客户端 |

两个界面都通过 WebSocket 实时更新，并自动发现同源的感知服务。

---

## 稠密点云（摄像头 + WiFi CSI 融合）

RuView 可通过融合摄像头深度估计与 WiFi CSI 空间感知，生成实时 3D 点云，从而构建一个实时更新的环境空间模型。

### 环境搭建

```bash
# 构建 pointcloud 二进制
cd v2
cargo build --release -p wifi-densepose-pointcloud

# 启动服务（自动检测摄像头 + CSI）。默认仅回环。
./target/release/ruview-pointcloud serve --bind 127.0.0.1:9880
```

打开 `http://localhost:9880` 即可使用交互式 Three.js 3D 查看器。

> **安全提示。** 该服务通过 HTTP 暴露实时摄像头、骨架、生命体征与占用信息。`--bind` 默认值为 `127.0.0.1:9880`（仅回环）。绑定到 `0.0.0.0` 或局域网 IP 需显式开启——此时服务会记录一条警告，但没有鉴权/TLS 层。如需远程访问，请在前面加一层反向代理。

> **Brain URL。** 观测数据默认以 POST 方式发往 `http://127.0.0.1:9876`。可通过 `RUVIEW_BRAIN_URL` 环境变量或 `serve` / `train` 的 `--brain <url>` 参数覆盖。

### 传感器

| 传感器 | 自动检测 | 数据 |
|--------|--------------|------|
| 摄像头（`/dev/video0`） | 是（Linux UVC） | RGB 帧 → MiDaS 深度 → 3D 点 |
| ESP32 CSI（UDP:3333） | 是（若已配网） | ADR-018 二进制 → 占用 + 姿态 + 生命体征 |
| MiDaS 深度服务（端口 9885） | 可选 | GPU 加速的神经深度估计 |

### 命令

| 命令 | 说明 |
|---------|-------------|
| `ruview-pointcloud serve --bind 127.0.0.1:9880` | 启动 HTTP 服务 + Three.js 查看器（默认仅回环） |
| `ruview-pointcloud demo` | 生成合成点云（无需硬件） |
| `ruview-pointcloud capture --output room.ply` | 将单帧捕获为 PLY 文件 |
| `ruview-pointcloud cameras` | 列出可用摄像头 |
| `ruview-pointcloud train --data-dir ./data [--brain URL]` | 深度标定 + 占用训练（写入规范化后的 `data-dir`；拒绝 `..` 越界路径） |
| `ruview-pointcloud csi-test --count 100` | 发送测试 CSI 帧（无需 ESP32） |
| `ruview-pointcloud fingerprint <name> [--seconds 5]` | 记录带名称的 CSI 房间指纹，供后续匹配 |

### 流水线组件

1. **ADR-018 解析器** —— 从 UDP 解码 ESP32 CSI 二进制帧（原始 CSI 魔数 `0xC5110001`、特征状态 `0xC5110006`），提取 I/Q 子载波幅度与相位。代码位于 `parser.rs`，并针对手写测试向量做了单元测试。
2. **姿态（占位）** —— 由 `heuristic_pose_from_amplitude` 根据 CSI 幅度能量生成的 17 个 COCO 关键点*布局*。这**不是**训练好的 WiFlow 模型，只是一个占位，让查看器有骨架可渲染。接入 `wifi-densepose-nn` crate 的真实 Candle/ONNX 推理是后续计划。
3. **生命体征** —— 由 CSI 相位分析得到呼吸率（在稳定子载波上做峰值计数）
4. **运动检测** —— CSI 幅度在 20 帧内的方差，触发自适应抓拍
5. **射频层析** —— 由各节点 RSSI 反投影到 8×8×4 占用栅格
6. **摄像头深度** —— MiDaS 单目深度（GPU），并以亮度+边缘作为回退
7. **传感器融合** —— 摄像头深度 + CSI 占用的体素栅格合并
8. **Brain 桥接** —— 每 60 秒将空间观测存入 ruOS brain

### API 端点

| 端点 | 方法 | 返回 |
|----------|--------|---------|
| `/health` | GET | `{"status": "ok"}` |
| `/api/status` | GET | 摄像头、CSI、流水线状态、生命体征、运动 |
| `/api/cloud` | GET | 点云（最多 1000 点）+ 流水线数据 |
| `/api/splats` | GET | 供 Three.js 渲染的高斯泼溅 |
| `/` | GET | 交互式 Three.js 3D 查看器 |

### 训练

训练流水线会标定深度估计与占用检测：

```bash
ruview-pointcloud train --data-dir ~/.local/share/ruview/training --brain http://127.0.0.1:9876
```

它会捕获帧、执行深度标定（对 scale/offset/gamma 做网格搜索）、训练占用阈值、导出 DPO 偏好对，并将结果提交给 ruOS brain。

### 输出格式

- **PLY** —— 标准 3D 点云（ASCII，带 RGB 颜色）
- **高斯泼溅** —— 供 Three.js 渲染的 JSON 格式
- **Brain 记忆** —— 空间观测，存储为 `spatial-observation`、`spatial-motion`、`spatial-vitals`

### 深度房间扫描

捕获房间的高质量 3D 模型：

```bash
# 先停止实时服务（释放摄像头）
# 再捕获 20 帧并用 MiDaS 处理
ruview-pointcloud capture --frames 20 --output room_model.ply
```

结果：5cm 分辨率下 40,000+ 体素、12,000+ 高斯泼溅。

### ESP32 的 CSI 配网

要将 CSI 数据发往 pointcloud 服务：

```bash
python3 firmware/esp32-csi-node/provision.py \
    --port /dev/ttyACM0 \
    --ssid "YourWiFi" --password "YourPassword" \
    --target-ip 192.168.1.123 --target-port 3333 \
    --node-id 1
```

---

<a id="vital-sign-detection"></a>
## 生命体征检测

系统利用 FFT 峰值检测，从 CSI 信号波动中提取呼吸率与心率。

| 体征 | 频带 | 范围 | 方法 |
|------|---------------|-------|--------|
| 呼吸 | 0.1-0.5 Hz | 6-30 BPM | 带通滤波 + FFT 峰值 |
| 心率 | 0.8-2.0 Hz | 40-120 BPM | 带通滤波 + FFT 峰值 |

**要求：**
- 支持 CSI 的硬件（ESP32-S3 或科研级网卡）以获得准确读数
- 被测者距接入点约 3-5 米（多静态网格下可达约 8 米）
- 被测者相对静止（大幅度动作会掩盖生命体征振荡）

**信号平滑：** 生命体征估计会经过一个三阶段平滑流水线（ADR-048）：离群值剔除（每帧 ±8 BPM 心率、±2 BPM 呼吸率）、21 帧截尾均值，以及 α=0.02 的 EMA。这样得到的读数能稳定保持 5-10 秒以上，而不是逐帧跳动。详见 [自适应分类器](#adaptive-classifier)。

**模拟模式**会生成合成的生命体征数据用于测试。

---

<a id="cli-reference"></a>
## CLI 参考

Rust 感知服务二进制接受以下标志：

| 标志 | 默认值 | 说明 |
|------|---------|-------------|
| `--source` | `auto` | 数据源：`auto`、`esp32`、`wifi`、`simulated`（别名 `simulate`）、`mediatek`、`qualcomm`、`realtek`、`realtek_csi`。其它取值在启动时会被拒绝 |
| `--http-port` | `8080` | REST API 与 UI 的 HTTP 端口 |
| `--ws-port` | `8765` | WebSocket 端口 |
| `--udp-port` | `5005` | 接收 ESP32 CSI 帧的 UDP 端口 |
| `--udp-bind` | `127.0.0.1` | UDP 接收方监听的地址。用 `0.0.0.0` 可接收来自局域网节点的帧，但还需 `--udp-allow` 或 `--udp-insecure-lan` |
| `--udp-allow` | （无） | 允许发送 CSI 帧的逗号分隔 IP/CIDR 列表，例如 `192.168.1.0/24` |
| `--udp-insecure-lan` | off | 在可路由绑定上接受任意来源的帧（UDP 数据面未经鉴权） |
| `--ui-path` | `../ui` | UI 静态文件目录路径（若不存在则回退到 `./ui` 或 `../../ui`） |
| `--tick-ms` | `100` | 模拟帧间隔（毫秒） |
| `--benchmark` | off | 运行生命体征基准测试（1000 帧）后退出 |
| `--train` | off | 从数据集训练模型 |
| `--dataset` | （无） | 数据集目录路径（MM-Fi 或 Wi-Pose） |
| `--dataset-type` | `mmfi` | 数据集格式：`mmfi` 或 `wipose` |
| `--epochs` | `100` | 训练轮数 |
| `--export-rvf` | （无） | 导出一个**占位**的 RVF 容器格式演示并退出——**并非训练好的模型**。要得到真实模型，请用 `--train`（+ `--save-rvf`）或下载预训练编码器。 |
| `--save-rvf` | （无） | 关闭时把模型状态保存到 RVF |
| `--model` | （无） | 加载训练好的 `.rvf` 模型用于推理 |
| `--load-rvf` | （无） | 从 RVF 容器加载模型配置 |
| `--progressive` | off | 启用渐进式三层模型加载 |

### 常见调用方式

```bash
# 模拟模式 + UI（开发用）
./target/release/sensing-server --source simulate --http-port 3000 --ws-port 3001 --ui-path ../ui

# ESP32 硬件模式
./target/release/sensing-server --source esp32 --udp-port 5005 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>

# Windows WiFi RSSI
./target/release/sensing-server --source wifi --tick-ms 500

# 运行基准测试
./target/release/sensing-server --benchmark

# 训练并导出模型
./target/release/sensing-server --train --dataset data/ --epochs 100 --save-rvf model.rvf

# 以渐进式加载方式载入训练好的模型
./target/release/sensing-server --model model.rvf --progressive
```

---

<a id="observatory-visualization"></a>
## 观测台可视化

观测台是一个沉浸式 Three.js 可视化，将 WiFi 感知数据渲染成电影级的 3D 体验，包含房间尺度道具、线框人物、WiFi 信号动画以及实时数据 HUD。

**URL：** `http://localhost:3000/ui/observatory.html`

**特性：**

| 特性 | 说明 |
|---------|-------------|
| 房间场景 | 家具、墙壁、地板采用自发光材质与 6 点光照 |
| 线框人物 | 最多 4 个骨架，关节脉动与呼吸同步 |
| 信号场 | 体素化 WiFi 波可视化 |
| 实时 HUD | 心率、呼吸率、置信度、RSSI、运动强度 |
| 自动检测 | 感知服务运行时自动连接实时 ESP32 数据 |
| 场景循环 | 6 个预设场景平滑切换（演示模式） |

**键盘快捷键：**

| 按键 | 操作 |
|-----|--------|
| `1-6` | 切换场景 |
| `A` | 切换自动循环 |
| `P` | 暂停/继续 |
| `S` | 打开设置 |
| `R` | 重置相机 |

**实时数据自动检测：** 当由感知服务提供时，观测台会探测同源的 `/health` 并自动通过 WebSocket 连接。HUD 徽标会从 `DEMO` 切换为 `LIVE`，无需任何配置。

---

<a id="loading-the-pretrained-model-from-hugging-face"></a>
## 从 Hugging Face 加载预训练模型

一个预训练的 CSI 编码器 + 存在检测头已发布于 Hugging Face 的 [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained)，基于 60,630 帧 / 610,615 组对比三元组训练（12.2M 步，最终 loss 0.065），报告 **82.3% 留出时间三元组准确率**（较早「100% 存在」数字是在单类录音上测得、已被撤回），在 Apple M4 Pro 上约 164k 嵌入/秒。

> **结果与证据。** 最先进的 17 关键点姿态模型单独发布于 [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose)——在 MM-Fi 上 **82.69% torso-PCK@20**（83.59% 集成 + TTA），超越 MultiFormer（72.25%）与 CSI2Pose（68.41%）。可查阅可审计的 [AetherArena 排行榜 Space](https://huggingface.co/spaces/ruvnet/aether-arena)、完整的 [MM-Fi 研究](benchmarks/mmfi-wifi-sensing-study.md)，以及 [效率前沿](benchmarks/wifi-pose-efficiency-frontier.md)。用 `python archive/v1/data/proof/verify.py` 复现确定性流水线证明（必须打印 `VERDICT: PASS`；参见 [ADR-168 基准证明](adr/ADR-168-benchmark-proof.md) 与 [WITNESS-LOG-028](WITNESS-LOG-028.md)）。

它包含什么（以及不包含什么）：

| 能力 | 状态 |
|------------|--------|
| 存在检测（有人 / 无人） | ✅ 已训练检测头 —— v2 编码器报告 82.3% 留出时间三元组准确率（v1 的「100% 验证准确率」为单类录音测得，已撤回，[#882](https://github.com/ruvnet/RuView/issues/882)） |
| 128 维 CSI 嵌入（re-ID、相似度、下游训练） | ✅ 已训练编码器 |
| 单人呼吸 / 心率 | ⚠️ 服务仍使用启发式 DSP —— 模型尚未取代它 |
| 17 关键点全身姿态 | 🔬 此 HF 包不含关键点检测头 —— 但真实的姿态权重在别处；见下方层级表 |

### 模型权重：真实与不实

在本仓库中，「WiFi → 姿态」指三种不同的事，处于三种不同的成熟度
级别。请看标签而非标题（[ADR-187](adr/ADR-187-archive-v1-deprecation-honest-labeling.md)）：

| 层级 | 检查点 | 如实状态 |
|------|---------------|---------------|
| **真实且已验证** | [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained)（编码器 + 存在检测头）· [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose)（17 关键点姿态）· `cog-person-count/count_v1` | **MEASURED / 已发布。** 存在检测 = 82.3% 留出时间三元组准确率（旧的「100% 存在」数字已撤回）；MM-Fi 姿态 = `random_split` 协议下 82.69% torso-PCK@20。 |
| **真实但较弱（已如实标注）** | 已提交的 `v2/crates/cog-pose-estimation/cog/artifacts/pose_v1.safetensors` | 第一版设备端模型。在 217 样本留出集上 **PCK@20 = 3.0% / PCK@50 = 18.5%** —— **低于 ADR-079 设定的 ≥ 35% 目标。** 学到了粗略结构（`r_hip` 为 77% PCK@50）；远端/面部关节近乎随机。其在 `cog-pose-estimation/src/inference.rs` 中的运行时路径仍是居中骨架的**占位，返回 `confidence=0`**。完整披露见 [cog README](../v2/crates/cog-pose-estimation/cog/README.md)。宣传实时单 ESP32 17 关键点功能时务必带上此声明。 |
| **仅架构，无权重** | `archive/v1` `DensePoseHead` | 随机 `kaiming_normal_` 初始化，**无任何检查点**（`archive/v1/` 下零个 `.pth`/`.onnx`/`.safetensors` 文件）。已弃用并被取代 —— 见 [`archive/v1/DEPRECATED.md`](../archive/v1/DEPRECATED.md)。不要期望它输出真实姿态。 |

**它真的能跑吗？单个 ESP32 能做姿态吗？([#509](https://github.com/ruvnet/RuView/issues/509)、[#1125](https://github.com/ruvnet/RuView/issues/1125))** 能跑，且结果可复现：确定性的信号流水线证明（`python archive/v1/data/proof/verify.py`，必须打印 `VERDICT: PASS`）、已提交的姿态训练转储（`v2/crates/cog-pose-estimation/cog/artifacts/train_results.json`），以及可审计的 MM-Fi arena 都为具体数字提供了支撑。但单天线、56 子载波、20 帧窗口的 CSI 流*并不*携带多天线网卡研究所依赖的细粒度空间信息——因此项目目前背书的可交付姿态精度是 **MM-Fi 基准数字**，而不是实时单 ESP32 数字。通往首个可复现设备端基线（PCK@20 ≥ 35%）的路径记录在 [ADR-079](adr/ADR-079-camera-ground-truth-training.md) / [#645](https://github.com/ruvnet/RuView/issues/645)。

<a id="model-and-capture-compatibility"></a>
### 模型与采集兼容性

这些制品共享同一个姿态目标，但输入契约与适配器格式并不相同。一个检查点
只有在采集预处理、张量形状、架构与运行时全部匹配时才可用。

| 制品/路径 | 所需输入 | 实测状态 | 实时 ESP32 兼容性 |
|---------------|----------------|-----------------|--------------------------|
| MM-Fi 旗舰与 `micro` transformer | `[N,3,114,10]` 幅度 | 在 MM-Fi `random_split` 上 **MEASURED**；标定参照为 Python `.npz` LoRA | 未验证任何直接的 S3/C6 路径；对 56 音 SISO 流重采样无法重建三天线 MM-Fi 输入 |
| Cog `pose_v1.safetensors` | `[N,56,20]` 幅度 | **MEASURED** PCK@20 = 3.0%，低于 ≥35% 目标；cog 格式 LoRA 为 `.safetensors` | 形状与规范窗口匹配，但文档化的实时运行时仍低于目标/为占位，并非可靠的姿态声明 |
| 查看器 `heuristic_pose_from_amplitude` | 实时规范幅度 | 骨架布局占位，并非训练好的姿态模型 | 仅渲染演示骨架；不构成姿态精度证据 |
| MERIDIAN 自动无标签标定 | 拟议的约 200 帧目标房间采集 | 在 ADR-027 中 **PROPOSED**；无已验证的端到端命令 | 不可用。当前标定工具需要配对的 CSI/关键点标签以及模型特定输入 |

标定文件不可互换：`calibrate.py` 面向 MM-Fi transformer，而
`cog_calibrate.py` 面向 cog 的 conv+MLP。参见
[标定参考](../aether-arena/calibration/README.md) 了解其确切 schema。

### 下载

```bash
pip install huggingface_hub
huggingface-cli download ruvnet/wifi-densepose-pretrained \
    --local-dir models/wifi-densepose-pretrained
```

下载会得到少量文件（`.rvf.jsonl` 是感知服务读取的规范容器）：

```
models/wifi-densepose-pretrained/
  model.rvf.jsonl       # RVF container (encoder + presence head + lora)
  model.safetensors     # 48 KB — same encoder weights, safetensors format
  model-q4.bin          # 8 KB — recommended quantization for edge
  presence-head.json    # presence classifier head
  config.json           # sona-lora rank=8 alpha=16, target encoder + task_heads
```

### 使用权重

HF 制品采用 **JSONL RVF** 格式（每行一个 JSON 对象：`metadata`、`encoder`、`lora`）。目前你可以用它做：

| 消费方 | 读取格式 | 状态 |
|----------|-----------------|--------|
| Python / PyTorch 训练流水线 | `model.safetensors` | ✅ 可用 —— 用 `safetensors.torch.load_file` 加载 |
| RVF JSONL 检查 / 再导出 | `model.rvf.jsonl` | ✅ 可用 —— 纯 JSONL，逐行解析 |
| 感知服务 `--model <PATH>` 标志 | 二进制 RVF（`RVFS` 魔数） | ⚠️ 暂**不**接受 JSONL 文件 —— 见下文缺口 |

**已知缺口（已跟踪）：** `v2/crates/wifi-densepose-sensing-server/src/rvf_container.rs` 只解析二进制 RVF 段格式（魔数 `0x52564653`）。把 `--model` 指向 `model.rvf.jsonl` 会让渐进式加载器报错 `invalid magic at offset 0: expected 0x52564653, got 0x7974227B`（`0x7974227B` 是 JSONL 头的 ASCII 字节 `{"ty…`），且实时流水线会退化为空输出，而不是回退到启发式模式。在 JSONL 适配器落地（或模型重新发布为二进制 RVF）之前，请**不带** `--model` 运行感知服务，并从 Python 或训练流水线消费 HF 权重。

```bash
# Works today — Python side (training, evaluation, embedding extraction):
python -c "
from safetensors.torch import load_file
state = load_file('models/wifi-densepose-pretrained/model.safetensors')
print({k: tuple(v.shape) for k, v in state.items()})
"

# Sensing server — run heuristic for now:
cargo run -p wifi-densepose-sensing-server --release -- \
    --source esp32 --udp-port 5005 --http-port 3000
```

加载器期望的二进制格式见 [RVF 模型容器](#rvf-model-containers)；把编码器作为环境特定微调起点的方法见 [训练模型](#training-a-model)。

---

<a id="adaptive-classifier"></a>
## 自适应分类器

自适应分类器（ADR-048）从带标签的录音中学习你所在环境特定的 WiFi 信号模式。它用一个训练好的逻辑回归模型取代基于静态阈值的分类，该模型使用 15 个特征（7 个由服务计算 + 8 个由子载波派生的统计量）。

### 信号平滑流水线

所有 CSI 派生的指标在到达 UI 之前，都要经过一个三阶段流水线：

| 阶段 | 作用 | 关键参数 |
|-------|-------------|----------------|
| **自适应基线** | 学习安静房间的噪声基底，扣除漂移 | α=0.003，50 帧预热 |
| **EMA + 中值滤波** | 平滑运动分数与生命体征 | 运动 α=0.15；生命体征：21 帧截尾均值，α=0.02 |
| **滞回去抖** | 防止状态快速闪烁 | 状态切换需 4 帧（约 0.4 秒） |

生命体征另有额外的稳定措施：

| 参数 | 值 | 作用 |
|-----------|-------|--------|
| 心率死区 | ±2 BPM | 防止微漂移 |
| 呼吸死区 | ±0.5 BPM | 防止微漂移 |
| 心率最大跳变 | 8 BPM/帧 | 剔除噪声尖峰 |
| 呼吸最大跳变 | 2 BPM/帧 | 剔除噪声尖峰 |

<a id="recording-training-data"></a>
### 录制训练数据

在进行不同活动时录制带标签的 CSI 会话。每次录制会以约 10-25 FPS 捕获完整的感知帧（特征 + 原始子载波幅度）。

```bash
# 1. 录制空房间（离开房间 30 秒）
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_empty_room"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop

# 2. 录制静坐（在 ESP32 旁坐 30 秒）
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_sitting_still"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop

# 3. 录制走动（在房间内走动 30 秒）
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_walking"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop

# 4. 录制主动运动（开合跳、挥臂 30 秒）
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_active"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop
```

录音以 JSONL 文件保存在服务 `--data-dir` 下的 `recordings/` 目录中（默认 `data`，即相对于服务启动目录的 `data/recordings/`）。文件名须以 `train_` 开头并包含类别关键字：

| Filename pattern | Class |
|-----------------|-------|
| `*empty*` or `*absent*` | absent |
| `*still*` or `*sitting*` | present_still |
| `*walking*` or `*moving*` | present_moving |
| `*active*` or `*exercise*` | active |

<a id="training-the-model"></a>
### 训练模型

用你的带标签录音训练自适应分类器：

```bash
curl -X POST http://localhost:3000/api/v1/adaptive/train
```

服务使用 mini-batch SGD（200 轮）在 15 个特征上训练一个多类逻辑回归。对典型录音集，训练在 1 秒内完成。训练好的模型保存到 `--data-dir` 下的 `adaptive_model.json`（默认 `data/adaptive_model.json`），并在服务重启时自动加载。

**查看模型状态：**

```bash
curl http://localhost:3000/api/v1/adaptive/status
```

**卸载模型（回退到阈值分类）：**

```bash
curl -X POST http://localhost:3000/api/v1/adaptive/unload
```

<a id="using-the-trained-model"></a>
### 使用训练好的模型

一旦训练完成，自适应模型会自动运行：

1. 每帧 CSI 不再使用静态阈值，而是用学习到的权重分类
2. 模型置信度与平滑后的阈值置信度混合（70/30 分配）
3. 模型跨服务重启保持存在（从 `<data-dir>/adaptive_model.json` 加载）

**提高准确度的建议：**

- 录制活动时要明确区分（“空房间”就真的离开房间）
- 每项活动录制 30-60 秒（数据越多模型越好）
- 若移动 ESP32 或重新布置房间，请重新录制并训练
- 模型与特定环境绑定 —— 物理布置变动时需重新训练

### 自适应分类器 API

| 方法 | 端点 | 说明 |
|--------|----------|-------------|
| `POST` | `/api/v1/adaptive/train` | 从 `train_*` 录音训练 |
| `GET` | `/api/v1/adaptive/status` | 模型状态、准确率、类别统计 |
| `POST` | `/api/v1/adaptive/unload` | 卸载模型，回退到阈值 |
| `POST` | `/api/v1/recording/start` | 开始录制 CSI 帧 |
| `POST` | `/api/v1/recording/stop` | 停止录制 |
| `GET` | `/api/v1/recording/list` | 列出录音 |

---

<a id="world-model-prediction-occworld"></a>
## 世界模型预测（OccWorld）

RuView 集成了 [OccWorld](https://github.com/wzzheng/OccWorld)（ECCV 2024）来预测
基于 WiFi CSI 的未来 3D 占用——把 Kalman 跟踪器的 5 帧视野扩展到
15 个预测帧（约 7 秒）。详见 [ADR-147](adr/ADR-147-nvidia-cosmos-world-foundation-model-integration.md)
与 [基准证明](adr/ADR-168-benchmark-proof.md) 了解全部细节。

**硬件要求：** NVIDIA GPU，显存 ≥4 GB（已验证：RTX 5080 下 209 ms / 3.4 GB）。

**启动推理服务：**
```bash
# Requires ml-env with PyTorch 2.7+ and mmcv/mmdet3d installed (see ADR-147 §3)
~/ml-env/bin/python3 scripts/occworld_server.py /tmp/occworld.sock
```

Rust crate `wifi-densepose-worldmodel` 通过该 Unix 套接字连接，并在服务运行时自动向姿态跟踪器注入
轨迹先验。

**为你的空间积累训练数据并微调（提升预测精度）：**
```bash
# 1. 当有人在空间中活动时录制 WorldGraph 快照（至少约 1 小时）
python3 scripts/occworld_retrain.py record \
    --server http://localhost:8080 \
    --out-dir /tmp/snapshots/scene_live \
    --duration 3600

# 2. 在室内占用上微调 VQVAE tokenizer
python3 scripts/occworld_retrain.py vqvae \
    --snapshots /tmp/snapshots/ \
    --work-dir out/ruview_vqvae

# 3. 微调自回归 transformer
python3 scripts/occworld_retrain.py transformer \
    --snapshots /tmp/snapshots/ \
    --vqvae-checkpoint out/ruview_vqvae/latest.pth \
    --work-dir out/ruview_occworld

# 4. 用你的检查点重启服务
~/ml-env/bin/python3 scripts/occworld_server.py /tmp/occworld.sock out/ruview_occworld/latest.pth
```

`scripts/ruview_occ_dataset.py` 是重训练流水线内部使用的领域适配器，
它将 WorldGraph JSON 快照转换为 OccWorld 格式的张量，并做室内
类别重映射与零 ego-poses。详见 ADR-147 第三阶段。

---

<a id="training-a-model"></a>
## 训练模型

训练流水线用纯 Rust 实现（7,832 行，零外部 ML 依赖）。

### 步骤 1：获取数据

系统支持两个公开 WiFi CSI 数据集：

| 数据集 | 来源 | 格式 | 受试者 | 环境 | 下载 |
|---------|--------|--------|----------|-------------|----------|
| [MM-Fi](https://ntu-aiot-lab.github.io/mm-fi) | NeurIPS 2023 | `.npy` | 40 | 4 个房间 | [GitHub 仓库](https://github.com/ybhbingo/MMFi_dataset)（内含 Google Drive / 百度网盘链接） |
| [Wi-Pose](https://github.com/NjtechCVLab/Wi-PoseDataset) | Entropy 2023 | `.mat` | 12 | 1 个房间 | [GitHub 仓库](https://github.com/NjtechCVLab/Wi-PoseDataset)（内含 Google Drive / 百度网盘链接） |

下载数据集文件并放入 `data/` 目录。

### 步骤 2：训练

```bash
# 从源码运行
./target/release/sensing-server --train --dataset data/ --dataset-type mmfi --epochs 100 --save-rvf model.rvf

# Via Docker (mount your data directory)
# Note: Training mode requires overriding the default entrypoint
docker run --rm \
  -v $(pwd)/data:/data \
  -v $(pwd)/output:/output \
  --entrypoint /app/sensing-server \
  ruvnet/wifi-densepose:latest \
  --train --dataset /data --epochs 100 --save-rvf /output/model.rvf
```

流水线运行 10 个阶段：
1. 数据集加载（MM-Fi `.npy` 或 Wi-Pose `.mat`）
2. 硬件归一化（Intel 5300 / Atheros / ESP32 → 规范 56 子载波）
3. 子载波重采样（通过 Catmull-Rom 插值，114→56 或 30→56）
4. 图 transformer 构建（17 个 COCO 关键点、16 条骨骼边）
5. 交叉注意力训练（CSI 特征 → 身体姿态）
6. 实验性域对抗组件（MERIDIAN 研究模块；非已验证的自动部署路径）
7. 复合损失优化（MSE + CE + UV + 时序 + 骨骼 + 对称）
8. SONA 适配（micro-LoRA + EWC++）
9. 稀疏推理优化（热/冷神经元划分）
10. RVF 模型打包

### 步骤 3：使用训练好的模型

```bash
./target/release/sensing-server --model model.rvf --progressive --source esp32 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>
```

渐进式加载可实现即时启动（层 A 在 <5ms 内完成基础推理），完整模型在后台加载。

### 跨环境适配（MERIDIAN）

在一个房间训练的模型，到了新房间可能因多径
分布改变而显著掉点。ADR-027 提出了自动适配设计，Rust 代码树中也包含
各自独立的研究组件，但 RuView 目前**并未**提供一条已验证的命令，能把
约 200 帧无标签数据变成一个可用的房间适配器。

当前可测试标定是独立的**带标签**参考，位于
`aether-arena/calibration/`：收集配对的 CSI/关键点样本，再拟合一个模型特定的 LoRA
适配器。MM-Fi transformer 期望 `[N,3,114,10]`；cog 期望 `[N,56,20]`。两个适配器
都不能载入对方模型，且在没有无泄漏的留出采集与均值姿态基线的情况下，两者都无法
确立实时 ESP32 姿态精度。

ADR-027 研究组件：

| 组件 | 作用 |
|-----------|-------------|
| 硬件归一化器 | 将任意 WiFi 芯片重采样到规范 56 子载波 |
| 域分解器 | 分离姿态相关特征与房间特定特征 |
| 几何编码器 | 编码 AP 位置（基于 DeepSets 的 FiLM 条件化） |
| 虚拟增强器 | 生成合成环境以增强训练鲁棒性 |
| 快速适配 | 提出的无标签对比式 TTT；尚未接入已验证的部署流程 |

完整设计见 [ADR-027](adr/ADR-027-cross-environment-domain-generalization.md)。

<a id="crv-signal-line-protocol"></a>
### CRV 信号线协议

CRV（Coordinate Remote Viewing，坐标式远程感知）信号线协议（ADR-033）将一套 6 阶段认知感知方法论映射到 WiFi CSI 处理上，从而实现结构化的异常分类与多人消歧。

| 阶段 | CRV 术语 | WiFi 映射 |
|-------|----------|-------------|
| I | Gestalt（完形） | 去趋势自相关 → 周期性 / 混沌 / 瞬态分类 |
| II | Sensory（感官） | 6 模态 CSI 特征编码（纹理、温度、亮度等） |
| III | Topology（拓扑） | 带链路质量权重的 AP 网格拓扑图 |
| IV | Coherence（相干） | 相位相量相干门（Accept/PredictOnly/Reject/Recalibrate） |
| V | Interrogation（探询） | 通过定向子载波选择提取个人特定信号 |
| VI | Partition（划分） | 多人划分并做跨房间收敛评分 |

```bash
# 在你的 Cargo.toml 中启用 CRV
cargo add wifi-densepose-ruvector --features crv
```

完整设计见 [ADR-033](adr/ADR-033-crv-signal-line-sensing-integration.md)。

---

<a id="rvf-model-containers"></a>
## RVF 模型容器

RuVector 格式（RVF）将训练好的模型打包为单一自包含二进制文件。

### 导出

```bash
./target/release/sensing-server --export-rvf model.rvf
```

### 加载

```bash
./target/release/sensing-server --model model.rvf --progressive
```

### 内容

RVF 文件包含：模型权重、HNSW 向量索引、量化码本、SONA 适配配置、Ed25519 训练证明，以及生命体征滤波参数。

### 部署目标

| 目标 | 量化 | 大小 | 加载时间 |
|--------|-------------|------|-----------|
| ESP32 / IoT | int4 | ~0.7 MB | <5ms |
| 移动端 / WASM | int8 | ~6-10 MB | ~200-500ms |
| 现场（WiFi-Mat） | fp16 | ~62 MB | ~2s |
| 服务 / 云端 | f32 | ~50+ MB | ~3s |

---

## 感知证书链（开发者预览，ADR-300）

RuView 的感知基底程序（ADR-300）正在构建一条 `signal → observation →
标定 → 推理 → 不确定性 → 证据 → 证书 → 策略 →
governed action`（受治理动作）流水线，下游消费者要么得到一份经过标定、带溯源背书的
答案，要么得到明确的 `UNKNOWN`——绝不会在传感器
既有工作包络之外给出看似可信的猜测。

**状态：开发者预览，已于 crate 级别接通。** 第一阶段交付了 9 个新
crate。`ruview-certify` 与 `ruview-policy` 现在依赖 `ruview-ood`，并提供一个
真正的适配器（`impl From<ruview_ood::DomainState> for _`）以及一个组合入口点，
`ruview_policy::authorize_from_certificate`，它接受一个真实签名的
`CapabilityCertificate` 与一个真实的 `ruview_ood::DomainState`，并驱动它们通过
`authorize()`——而非手工拼凑的 `AssuranceInputs`。一个跨 crate 集成测试
（`ruview-policy` 的 `acceptance_test_b_real_integration` 模块）会签发一个真实签名的
证书，并证明在真实漂移后 `Unknown` 会拒绝一个 `SafetyCritical`（安全关键）动作
——且是经由那一条组合流水线完成的。

**仍有未竟之事：** 这些都不会在实时
`sensing-server` 请求路径中自动运行——目前没有一条接入运行中服务、能对实时传感器数据
调用该流水线的持续标定 / OOD 监控循环。请将
`authorize_from_certificate` 视为一个真实、经过测试的库级入口点，你今天就可以从自己的
集成里调用，而不是服务为你每次请求自动调用的东西。
这剩下的一步是真正独立、更大的工程（决定轮询节奏、
标定状态存于何处、什么触发重新认证）——详见 ADR-300 的
分阶段计划。

### 相关 crate

| Crate | 角色 |
|---|---|
| `ruview-ontology` | 规范的 `Site → … → Event` 类型 |
| `ruview-attest` | 签名测量 / RF 监管链 |
| `ruview-evidence` | 每上下文只追加账本（无合并、无证据升级） |
| `wifi-densepose-calibration` | 签名、可作废漂移的标定证书 |
| `ruview-ood` | `Known` / `Degraded` / `Unknown` 过期防护域门控 |
| `ruview-witness` | 哈希链接的分级溯源链 |
| `ruview-certify` | 能力证书，以实时域签名为条件 |
| `ruview-scorecard` | 多域记分卡，最差域晋升门槛 |
| `ruview-policy` | 失败关闭的动作授权门控 |

### 签发与校验证书

```rust
use ruview_certify::{mint, CapabilityCertificate, DomainState};

// `signer`、`request` 与 `evidence_slice` 来自你自己的标定运行 ——
// see each crate's README for how to build them.
let cert = mint(&signer, request, &evidence_slice)?;

// 证书只在特定瞬间**且**特定域状态下有效 —— 同一份
// 签名证书，一旦实时域降级便立即被拒绝：
assert!(cert.is_valid(now_ms, DomainState::Known));
assert!(!cert.is_valid(now_ms, DomainState::Degraded));
assert!(!cert.is_valid(now_ms, DomainState::Unknown));
```

### 基于真实证书 + 真实 OOD 读数门控动作

```rust
use ruview_policy::authorize_from_certificate;

// `cert`（ruview_certify::CapabilityCertificate）与 `domain`
// （ruview_ood::DomainState）来自你自己的 certify/OOD 调用。
let decision = authorize_from_certificate(
    ActionClass::SafetyCritical,
    &cert, &verifier, now_unix_s, domain,
    certificate_class, uncertainty, evidence_level,
);
// 以具名的 FailedCondition（如 DomainNotKnown）拒绝 —— 而非静默的
// 误报 —— 一旦 `domain` 降级，即便 `cert` 本身
// 仍有效签名且未过期，也会被拒绝。
```

`ruview_certify::DomainState` 与 `ruview_policy::DomainState` 目前仍各自是独立
类型（`ruview-ood` 的 `Degraded`/`Unknown` 还额外携带 `DomainCause`），但
它们之间的转换已不再需要你亲自编写 ——
`authorize_from_certificate` 会通过各 crate 自带的 `From<ruview_ood::DomainState>`
实现来完成。

### 当前真正强制执行的项（对比）

并非所有 ADR-295–296 的整改项都只是预览。目前已有三项生效：

- **UDP 数据面绑定加固（ADR-296）** —— `sensing-server` 的 `UdpSourceAllowlist`
  会在每个入站数据包上被检查（`main.rs`），而非仅定义。
- **CSI 数据事件仓库管控（ADR-299）** —— `scripts/csi-data-policy-check.sh`
  在每次 push/PR 的 CI 中运行，策略违规即令构建失败。
- **合成导出水印（ADR-295）** —— `start_recording` 会在录制元数据上加盖 `SYNTHETIC`
  水印（当实时源为合成数据时，`GET /api/v1/recordings` 的
  起始录制响应中均会如此）——这样操作员
  在浏览或脚本处理录音时，就不会把生成数据误当成真实采集。

---

<a id="hardware-setup"></a>
## 硬件搭建

### 支持的目标

| 目标 | 用途 | 源目标标志 | 备注 |
|---|---|---|---|
| **ESP32-S3**（默认） | 生产级 CSI 采集网格；存在/运动/生命体征启发式 | `idf.py set-target esp32s3` | 双核 240 MHz、PSRAM、原生 USB-OTG、DVP 摄像头通道；实时 17 关键点姿态未经验证 |
| **ESP32-C6**（[ADR-110](adr/ADR-110-esp32-c6-firmware-extension.md)） | Wi-Fi 6 / 802.15.4 研究、电池供电 Seed 节点 | `idf.py set-target esp32c6` | 单核 160 MHz、无 PSRAM、802.11ax HE PHY、802.15.4（Thread/Zigbee）、LP 核休眠约 5 µA |

同一个 `firmware/esp32-csi-node` 源码树可同时构建两者。当目标设为 `esp32c6` 时，ESP-IDF 会自动选用 `sdkconfig.defaults.esp32c6`；否则使用 `sdkconfig.defaults`（S3）。所有 C6 专属模块都由 `#ifdef` 门控，因此 S3 构建与当前字节级一致。

<a id="esp32-s3-mesh"></a>
### ESP32-S3 网格

3-6 个节点的 ESP32-S3 网格可在 20 Hz 下提供完整 CSI。总成本：3 节点方案约 $54。

**你需要：**
- 3-6 块 ESP32-S3 开发板（每块约 $8）
- 一台 WiFi 路由器（CSI 来源）
- 一台运行感知服务（聚合器）的计算机

**烧录固件：**

请使用 [Releases](https://github.com/ruvnet/RuView/releases) 中带版本的固件包，
而非 `firmware/esp32-csi-node/release_bins/` 中的历史二进制。
0.8.16 预发布版在前一版的 USB 身份识别基础上，新增了保守的 MR60BHA2 识别，
以及 OTA 配网与 CSI 可靠性修复。
它具备 CI 构建/主机测试覆盖；但新的物理板卡资质认证
尚待完成。上一稳定固件为 0.8.8。

| 版本 | 包含内容 | 标签 |
|---------|-----------------|-----|
| [v0.8.16](https://github.com/ruvnet/RuView/releases/tag/v0.8.16-esp32) | **预发布：** 保守的 MR60BHA2 识别；具备 CI/主机测试覆盖，但无新的物理固件资质认证 | `v0.8.16-esp32` |
| [v0.8.14](https://github.com/ruvnet/RuView/releases/tag/v0.8.14-esp32) | **预发布：** 修正 C6 基础 MAC 身份、无需主机密钥缓存的 OTA 密钥配网；物理资质认证待完成 | `v0.8.14-esp32` |
| [v0.8.8](https://github.com/ruvnet/RuView/releases/tag/v0.8.8-esp32) | 上一稳定固件：一致的占用检测与速率感知的 C6 处理；见 [发布证据](releases/v0.8.8-esp32.md) | `v0.8.8-esp32` |
| [v0.7.0](https://github.com/ruvnet/RuView/releases/tag/v0.7.0-esp32) | 历史 ADR-110 固件侧基础：ESP-NOW 同步与同步包 UDP 发射（[WITNESS-LOG-110 §A0.7-§A0.13](WITNESS-LOG-110.md)） | `v0.7.0-esp32` |
| [v0.6.9](https://github.com/ruvnet/RuView/releases/tag/v0.6.9-esp32) | 同步包 UDP 发射，可调节奏的 `CONFIG_C6_SYNC_EVERY_N_FRAMES` | `v0.6.9-esp32` |
| [v0.6.8](https://github.com/ruvnet/RuView/releases/tag/v0.6.8-esp32) | ESP-NOW 经 EMA 平滑的跨板偏移（3.95× 抑制、104 µs 标准差） | `v0.6.8-esp32` |
| [v0.6.7](https://github.com/ruvnet/RuView/releases/tag/v0.6.7-esp32) | 真实 LP 核运动门控 RISC-V 程序（B4 代码路径完整）+ 带 TWT Responder 的 Wi-Fi 6 软 AP，用于双板 iTWT 基准（解锁 B1/B2） | `v0.6.7-esp32` |
| [v0.5.0](https://github.com/ruvnet/RuView/releases/tag/v0.5.0-esp32) | 历史 S3 网格发布 —— 毫米波传感器融合（MR60BHA2/LD2410 自动检测）、48 字节融合生命体征、所有 v0.4.3.1 修复 | `v0.5.0-esp32` |
| [v0.4.3.1](https://github.com/ruvnet/RuView/releases/tag/v0.4.3.1-esp32) | 跌倒检测修复（[#263](https://github.com/ruvnet/RuView/issues/263)）、4MB flash（[#265](https://github.com/ruvnet/RuView/issues/265)）、看门狗修复（[#266](https://github.com/ruvnet/RuView/issues/266)） | `v0.4.3.1-esp32` |
| [v0.4.1](https://github.com/ruvnet/RuView/releases/tag/v0.4.1-esp32) | CSI 构建修复、编译守卫、AMOLED 显示屏、边缘智能（[ADR-057](../docs/adr/ADR-057-firmware-csi-build-guard.md)） | `v0.4.1-esp32` |
| [v0.3.0-alpha](https://github.com/ruvnet/RuView/releases/tag/v0.3.0-alpha-esp32) | Alpha —— 新增设备端边缘智能（ADR-039） | `v0.3.0-alpha-esp32` |
| [v0.2.0](https://github.com/ruvnet/RuView/releases/tag/v0.2.0-esp32) | 原始 CSI 流式传输、TDM、信道跳变、QUIC 网格 | `v0.2.0-esp32` |

对于 0.8.14，请选择正确的归档，校验其发布文件 `SHA256SUMS.txt`，
解压到独立目录，再校验内含的校验和：

| 归档 | 板型配置 |
|---------|---------------------|
| `esp32-csi-node-firmware-8mb.tar.gz` | ESP32-S3 带屏构建，8 MB flash |
| `esp32-csi-node-firmware-4mb.tar.gz` | ESP32-S3 无屏构建，4 MB 布局 |
| `esp32-csi-node-firmware-c6-4mb.tar.gz` | ESP32-C6 研究目标，4 MB 布局 |

裸 8 MB DevKitC 板需要源码中的 `sdkconfig.defaults.devkitc` 覆盖层；
不要使用带屏构建。参见 [固件指南](../firmware/esp32-csi-node/README.md#0-download-a-versioned-firmware-bundle)
了解板型选择、C6 文件名、备份与 OTA 指引。

```bash
# From the extracted ESP32-S3 display / 8 MB bundle:
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 8MB --flash-freq 80m \
  0x0 bootloader.bin 0x8000 partition-table.bin \
  0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin
```

**4 MB 无屏 S3 开发板：** 使用对应的应用程序和分区表，
取自 [0.8.16 预发布版](https://github.com/ruvnet/RuView/releases/tag/v0.8.16-esp32)
中的 `esp32-csi-node-firmware-4mb.tar.gz`，
并选择 `--flash-size 4MB`：

```bash
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 4MB --flash-freq 80m \
  0x0 bootloader.bin 0x8000 partition-table-4mb.bin \
  0xF000 ota_data_initial.bin 0x20000 esp32-csi-node-4mb.bin
```

**配网：**

```bash
python firmware/esp32-csi-node/provision.py --port COM7 \
  --ssid "YourWiFi" --password "YourPassword" --target-ip 192.168.1.20
```

将 `192.168.1.20` 替换为运行感知服务的机器 IP。
要启用带认证的 OTA 更新，请加上 `--ota-psk-file` 并提供一个私有
64 位十六进制密钥文件。后续 NVS 写入时必须重新提供该密钥；它绝不会
被缓存进主机状态。参见 [OTA 密钥配网](../firmware/esp32-csi-node/README.md#ota-key-provisioning)。

**网格密钥配网：** ADR-032 描述了给多静态网格中每个节点分配共享网格密钥，但该能力尚未接通。`provision.py` 没有 `--mesh-key` 选项，固件也不会从 NVS 读取网格密钥，因此目前无可配置项。

### ESP32-C6（Wi-Fi 6 + 802.15.4 研究目标 — ADR-110）

C6 构建为现有 csi-node 固件新增四项能力，均可通过 `idf.py menuconfig → ESP32-C6 capabilities (ADR-110)` 选择性开启：

| 能力 | Kconfig | 作用 |
|---|---|---|
| **Wi-Fi 6 HE-LTF 标记** | `CSI_FRAME_HE_TAGGING`（默认开启） | 每个 ADR-018 帧原先保留的字节 18-19 现在携带 PPDU 类型（HT / HE-SU / HE-MU / HE-TB）+ 带宽标志。魔数保持 `0xC5110001` —— 旧聚合器读到的是 0 因而忽略。 |
| **802.15.4 网格时间同步** | `C6_TIMESYNC_ENABLE`（默认开启，信道 15） | 基于信标在 802.15.4 射频上做跨节点时钟对齐。让 WiFi 信道摆脱协调流量 —— 解决了 ADR-029/030 多静态时钟同步问题。 |
| **TWT（目标唤醒时间）** | `C6_TWT_ENABLE`（默认开启，唤醒间隔 10 ms） | WiFi 连接后，与 AP 协商独立的 TWT 协议以获得确定性的 CSI 节奏。若 AP 不支持 11ax TWT，则优雅降级为 NACK。 |
| **LP 核运动唤醒休眠** | `C6_LP_CORE_ENABLE`（默认关闭） | LP RISC-V 核上常驻的运动门控；HP 核保持深度睡眠，直到配置的 GPIO 将其唤醒。面向电池供电的 Cognitum Seed 节点，目标约 5 µA。 |

**构建 + 烧录：**

```bash
cd firmware/esp32-csi-node
idf.py set-target esp32c6
idf.py build                    # ~1.0 MB binary, 46% partition slack on 4 MB flash
idf.py -p COM6 flash
# 之后以与 S3 相同的方式配网（provision.py 对两类目标都适用）：
python provision.py --port COM6 --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20
```

**验证 C6 模块已启动** —— `idf.py -p COM6 monitor` 应显示：

```
I (353) main: ESP32-C6 CSI Node (ADR-018 / ADR-110) — v0.6.7 — Node ID: 1
I (413) c6_ts: init done: channel=15 EUI=<your-EUI64> leader=yes(candidate)
I (463) wifi: mac_version:HAL_MAC_ESP32AX_761      ← 802.11ax MAC firmware loaded
```

出现 `c6_ts: init done` 这一行说明 802.15.4 协议栈已启动；若 TWT 协商成功，WiFi 连接完成后你还会看到 `iTWT setup event received from AP` 这一行。

**多房间时间对齐的多静态采集（预览）：**

烧录两块或更多 C6 开发板，让它们保持在同一 802.15.4 信道（默认 15）。其中一块会自举为 leader（EUI-64 最小者），每 100 ms 广播 `TS_BEACON` 帧；其余节点计算并应用偏移。跟随者发出的每个 CSI 帧都带有 `c6_timesync_get_epoch_us()` 的墙上时钟估计，与 leader 的单调时间对齐在 ±100 µs 以内。目标用例：ADR-029/030 多静态融合，且不在协调上消耗 WiFi 空口时间。

**电池 Seed 节点模式（v0.6.7 —— 真实的 LP 核程序）：**

```bash
# 在 menuconfig 中启用 LP 核休眠：
#   ESP32-C6 capabilities (ADR-110) → 启用 LP 核运动唤醒休眠
#   → LP 核唤醒 GPIO（默认 4 —— 在此连接 PIR 或加速度计 INT 引脚）
#   → LP 核轮询周期（默认 10 ms）
#   → LP 核去抖采样次数（默认连续匹配 3 次）
idf.py menuconfig
idf.py build flash
```

启用后，C6 的 LP RISC-V 协处理器会运行一个真实的轮询程序
（`firmware/esp32-csi-node/main/lp_core/main.c`）以设定的节奏轮询唤醒 GPIO，
按设定的节奏去抖 N 次连续匹配，并唤醒
HP 核（`ulp_lp_core_wakeup_main_processor()`）。`esp_sleep_get_wakeup_cause()`
返回 `ESP_SLEEP_WAKEUP_ULP`，而 `c6_lp_core_motion_count()` /
`c6_lp_core_poll_count()` 会暴露 LP 侧的计数器供见证测试工具使用。
目标待机电流约 5 µA（数据手册值；INA 实测待进行）。

**双板 iTWT 基准（v0.6.7 —— 软 AP HE/TWT，无需路由器）：**

将两块 C6 开发板配对 —— 一块充当支持 iTWT 的 AP，另一块作为 STA
负责协商并对 TWT 协议进行基准测试。

```bash
# 开发板 #1（AP 角色）：追加到 sdkconfig.defaults.esp32c6：
CONFIG_C6_SOFTAP_HE_ENABLE=y
CONFIG_C6_SOFTAP_HE_SSID="ruview-c6-twt"
CONFIG_C6_SOFTAP_HE_PSK="ruviewtwt"
CONFIG_C6_SOFTAP_HE_CHANNEL=6

idf.py set-target esp32c6 && idf.py build && idf.py -p COM6 flash
```

开发板 #1 以 `WIFI_MODE_APSTA` 模式启动，广播 HE 能力与 TWT
Responder=1（信道 6）。开发板 #2 配网以关联到该 SSID：

```bash
python firmware/esp32-csi-node/provision.py --port COM9 \
  --ssid "ruview-c6-twt" --password "ruviewtwt" --target-ip 192.168.1.20
```

开发板 #2 在连接时运行已有的 `c6_twt_setup_default()`，现在
会与协作的 AP 协商真正的 iTWT 协议 ——
`iTWT setup queued: wake_interval=10000 µs` 日志行之后应当出现
`iTWT setup event received from AP`，而不是 `INVALID_ARG` 那种优雅
降级 —— 后者是针对本基准中仅支持 11n 的 `ruv.net` AP 时触发的。

AP 角色的 NVS 覆盖项（命名空间 `ruview`）：`softap_ssid`、`softap_psk`、
`softap_chan` —— 只需配网一次，这些值在固件更新后依然保留。

**C6 构建中不包含的内容**（对比 S3 生产版）：无 AMOLED 显示屏（ADR-045 需要 8 MB + LCD 触摸驱动），无 WASM3（ADR-040 需要 PSRAM），无 Seeed 毫米波融合（独立板卡）。C6 是研究与 Seed 目标，并非 S3 生产节点的直接替代。

**TDM 时隙分配：**

多静态网格中的每个节点都需要一个唯一的 TDM 时隙 ID（从 0 开始）：

```bash
# 节点 0（时隙 0）—— 第一台发射器
python firmware/esp32-csi-node/provision.py --port COM7 --tdm-slot 0 --tdm-total 3

# 节点 1（时隙 1）
python firmware/esp32-csi-node/provision.py --port COM8 --tdm-slot 1 --tdm-total 3

# 节点 2（时隙 2）
python firmware/esp32-csi-node/provision.py --port COM9 --tdm-slot 2 --tdm-total 3
```

**边缘智能（v0.3.0-alpha，[ADR-039](../docs/adr/ADR-039-esp32-edge-intelligence.md)）：**

v0.3.0-alpha 固件新增了设备端信号处理，直接在 ESP32-S3 上运行 —— 基础的存在感与生命体征检测无需主机 PC。为保持完全向后兼容，边缘处理默认关闭。

| 层级 | 作用 | 额外内存 |
|------|-------------|-----------|
| **0** | 禁用（默认）—— 向聚合器流式传输原始 CSI | 0 KB |
| **1** | 相位解缠、滚动统计、Top-K 子载波选择、增量压缩 | ~30 KB |
| **2** | 包含层级 1 的全部功能，外加存在检测、呼吸/心率、运动评分、跌倒检测 | ~33 KB |

通过 NVS 启用（无需重新烧录）：

```bash
# 在已烧录的节点上启用层级 2（完整生命体征）
python firmware/esp32-csi-node/provision.py --port COM7 \
  --ssid "YourWiFi" --password "YourPassword" --target-ip 192.168.1.20 \
  --edge-tier 2
```

边缘处理的关键 NVS 设置：

| NVS 键 | 默认值 | 控制内容 |
|---------|---------|-----------------|
| `edge_tier` | 0 | 处理层级（0=关闭，1=统计，2=生命体征） |
| `pres_thresh` | 50 | 存在检测的灵敏度（数值越低越灵敏） |
| `fall_thresh` | 15000 | 跌倒检测阈值，单位毫（15000 = 15.0 rad/s²）。正常行走为 2-5，真实跌倒为 20 以上。调高可减少误报。 |
| `vital_win` | 300 | 为呼吸/心率提取保留多少帧相位历史 |
| `vital_int` | 1000 | 发送生命体征数据包的频率，单位毫秒 |
| `subk_count` | 32 | 保留的最优子载波数量（共 56 个） |

层级 2 激活时，节点以 1 Hz（可配置）发送一个 32 字节的生命体征数据包，内含存在状态、运动评分、呼吸 BPM、心率 BPM、置信度、跌倒标志与占用估计。该包使用魔数 `0xC5110002`，并发送到与原始 CSI 帧相同的聚合器 IP 与端口。

二进制大小：990 KB（8MB flash，52% 空闲）或 773 KB（4MB flash）。v0.5.0 新增毫米波传感器融合（约大 12 KB）。

> **Alpha 提示**：生命体征估计采用启发式 BPM 提取。在受控环境中、被测对象静止时精度最佳。不可用于医疗。

**启动聚合器：**

```bash
# 从源码运行（--udp-bind/--udp-allow 让它能接收你网络中的节点）
./target/release/sensing-server --source esp32 --udp-port 5005 --http-port 3000 --ws-port 3001 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>

# Docker（关于 UDP 源防护，参见“在 Docker 中接收 ESP32 帧”）
docker run -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 5005:5005/udp \
  -e RUVIEW_API_TOKEN -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW=<node-ip-or-cidr> \
  ruvnet/wifi-densepose:latest
```

参见 [ADR-018](../docs/adr/ADR-018-esp32-dev-implementation.md)、[ADR-029](../docs/adr/ADR-029-ruvsense-multistatic-sensing-mode.md) 以及 [教程 #34](https://github.com/ruvnet/RuView/issues/34)。

<a id="intel-5300--atheros-nic"></a>
### Intel 5300 / Atheros 网卡

这些研究用网卡在 Linux 上借助固件/驱动修改可提供完整 CSI。

| 网卡 | 驱动 | 平台 | 配置 |
|-----|--------|----------|-------|
| Intel 5300 | `iwl-csi` | Linux | 自定义固件，二手约 $15 |
| Atheros AR9580 | `ath9k` 补丁 | Linux | 内核补丁，二手约 $20 |

这些都是进阶配置。安装方法请参阅各自的驱动文档。

---

<a id="camera-free-pose-training"></a>
## 无摄像头姿态训练

RuView 可在**完全不使用摄像头**的情况下训练 17 关键点 COCO 姿态模型，方法是融合来自 ESP32 节点与 Cognitum Seed 的 10 路传感器信号：

| 信号 | 来源 | 提供内容 |
|--------|--------|-----------------|
| PIR 传感器 | Seed GPIO 6 | 二值存在真值 |
| BME280 温度 | Seed I2C | 占用代理（有人时温度上升） |
| BME280 湿度 | Seed I2C | 呼吸确认 |
| 跨节点 RSSI | 2x ESP32 | 粗略 XY 位置（三角定位） |
| 生命体征稳定性 | ESP32 DSP | 活动强度（心率稳定 = 静止） |
| 时序 CSI 模式 | ESP32 DSP | 行走（周期性）、坐（稳定）、空（平稳） |
| kNN 聚类 | Seed 向量库 | 自然状态分组 |
| 边界脆弱性 | Seed 图分析 | 状态切换（进入/离开） |
| 干簧管开关 | Seed GPIO 5 | 门开/关事件 |
| 振动传感器 | Seed GPIO 13 | 脚步检测 |

### 工作原理

该流水线先从传感器融合生成弱标签，再分 5 个阶段训练：

1. **多模态采集** —— 将 CSI 帧与 Seed 传感器事件同步
2. **弱标签生成** —— 用 RSSI 三角定位确定头部位置，子载波不对称性确定手部，振动确定脚部
3. **5 关键点姿态代理** —— 从融合信号训练头部/手部/脚部位置
4. **17 关键点插值** —— 利用骨骼长度约束推导完整的 COCO 骨架
5. **自精炼** —— 从高置信度预测自举（3 轮）

```bash
# 已连接 Cognitum Seed 时（全部 10 路信号）：
node scripts/train-camera-free.js \
  --data data/recordings/pretrain-*.csi.jsonl \
  --seed-url https://169.254.42.1:8443 \
  --seed-token "$SEED_TOKEN"

# 无 Seed 时（仅 CSI，3 路信号 —— 仍可用）：
node scripts/train-camera-free.js \
  --data data/recordings/pretrain-*.csi.jsonl --no-seed
```

**输出：** 82.8 KB 模型（4-bit 下 8 KB），含 17 关键点预测、0 处骨架违规、每节点 LoRA 适配器，以及防止遗忘的 EWC 保护。

完整流程请参阅 [ADR-071](adr/ADR-071-ruvllm-training-pipeline.md) 与 [预训练教程](tutorials/cognitum-seed-pretraining.md)。

---

## 摄像头监督的姿态训练（v0.7.0）

为获得明显更高的精度，可在训练期间将网络摄像头用作**临时教师**。摄像头通过 MediaPipe 捕捉真实的 17 关键点姿态，与同步采集的 ESP32 CSI 数据配对。训练结束后不再需要摄像头 —— 模型仅依赖 CSI 运行。

> **精度说明（2026-06-10）：** 此前引用的“92.9% PCK@20”数据
> 已被撤回 —— 对留存评估留出集的法证复核显示，它来自
> 一个恒定输出模型，并以绝对（非躯干归一化）
> 阈值在 69 帧近乎静止的画面下打分，而在该协议下，
> 一个普通的平均姿态预测器就能得 100%。目前尚无实测的摄像头监督 PCK@20
> 公开发布（参见 CHANGELOG、PR #535）。请将此工作流视为数据
> 采集机制；精度声明将基于一次 ≥35 分钟、多姿态的
> 采集会话，并以躯干归一化 PCK 评估后给出。

### 环境要求

- Python 3.9+，并安装 `mediapipe` 与 `opencv-python`（`pip install mediapipe opencv-python`）
- ESP32-S3 节点通过 UDP 流式传输 CSI（端口 5005）
- 一个网络摄像头（笔记本、USB，或通过 Tailscale 连接的 Mac 摄像头）

### 步骤 0：检查 CSI 速率并规划采集时长

窗口产量为 `csi_frames / 20` —— **CSI 数据包速率决定了你必须
记录多久。** 先检查（10 秒探测）：

```bash
python - <<'EOF'
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('0.0.0.0', 5005)); s.settimeout(2)
n, t0 = 0, time.time()
while time.time() - t0 < 10:
    try: s.recvfrom(4096); n += 1
    except socket.timeout: pass
print(f"{n/10:.1f} Hz -> {n/10*60/20:.0f} windows/min")
EOF
```

| CSI 速率 | 窗口/分钟 | 达到 2,000 窗口（最少可训练量）所需分钟数 |
|---|---|---|
| ~13 Hz（空闲网络） | ~39 | ~52 分钟 |
| ~53 Hz（主动自 ping，#985 固件） | ~160 | ~13 分钟 —— 为丰富姿态仍建议录制 35–40 分钟 |

5 分钟的采集**不足以用于训练** —— 它只能产生几百个
同一姿态上下文的窗口，以此训练的模型只会死记而不是
泛化（这也正是此前精度数据失效的原因）。

### 步骤 1：（推荐）校准摄像头 ↔ 房间

双棋盘格校准（ADR-152 §2.1.3）将标签置于共享的 3D
房间坐标系，而非原始摄像头坐标，这正是已发表的针对
“坐标过拟合”（布局脆弱）的防御手段（PerceptAlign，MobiCom'26）：

```bash
python scripts/calibrate-camera-room.py   # < 5 min, two checkerboards + a few photos
```

没有它，采集依然可行，但标签仅为摄像头坐标系，
所训练的模型在摄像头/节点移位后无法保持有效。

### 步骤 2：同时采集摄像头 + CSI

同时运行两个脚本（在各自独立的终端中）：

```bash
# 终端 1：录制 ESP32 CSI（2400 s = 40 分钟）
python scripts/record-csi-udp.py --duration 2400

# 终端 2：捕捉摄像头关键点
python scripts/collect-ground-truth.py --duration 2400 --preview \
  --calibration data/calibration/camera-room.json   # 若跳过步骤 1 则省略
```

采集期间：让**全身入镜**并保持良好的光照（MediaPipe
置信度必须保持在 0.5 以上 —— 低置信度帧会在
对齐时被丢弃），并**每 1–2 分钟变换一次活动**：走、举手、
蹲、举双手、踢、挥手、转身、跳、坐、站立不动。姿态的多样性
正是模型学习的内容；连续 40 分钟只坐着会产生一个恒定姿态
预测器。

### 步骤 3：对齐与训练

```bash
# 将摄像头关键点与 CSI 窗口对齐（打印保留/丢弃的窗口数 ——
# 预期约保留 csi_frames/20 个；若远低于此请排查）
node scripts/align-ground-truth.js \
  --gt data/ground-truth/*.jsonl \
  --csi data/recordings/csi-*.csi.jsonl

# 训练（选择与实际窗口数匹配的预设）
node scripts/train-wiflow-supervised.js \
  --data data/paired/*.jsonl \
  --scale small \
  --epochs 50

# 评估 —— 在时序切分上用躯干归一化 PCK
node scripts/eval-wiflow.js \
  --model models/wiflow-supervised/wiflow-v1.json \
  --data data/paired/*.jsonl
```

> **模型格式边界：** `train-wiflow-supervised.js` 生成的是
> JavaScript WiFlow 模型 `wiflow-v1.json`。目前没有任何受支持
> 的命令能将该 JSON 模型转换为感知服务器的二进制 RVF
> 容器，且将文件重命名为 `.rvf` 并不会转换它。请使用 JSON
> 模型配合 JavaScript 评估/推理工具。若要训练一个 Rust 感知
> 服务器可加载的模型，请使用其原生训练路径，它会直接写出
> RVF：
>
> ```bash
> cargo run -p wifi-densepose-sensing-server --release -- \
>   --train --dataset data/mmfi --dataset-type mmfi \
>   --epochs 100 --save-rvf models/room-model.rvf
> ```
>
> 摄像头 + CSI 配对的 JSONL 工作流与原生 RVF 训练器目前
> 是相互独立的两条流水线。JSON 到 RVF 的导出器为未来工作。

**评估协议很重要。** 请使用 `eval-wiflow.js`（躯干归一化
PCK@20，即可与已发表的 WiFi 姿态结果对比的指标）在时序
留出集上评估，并抽查预测是否真的在帧间变化
（`pred std > 0`）—— 恒定姿态模型在
较弱协议下的近乎静止数据上可能得到虚高的分数。参见
`benchmarks/wiflow-std/RESULTS.md` 了解这一法证案例研究。

### 规模预设

| 预设 | 参数量 | 训练时间 | 适用场景 |
|--------|--------|---------------|----------|
| `--scale lite` | 189K | ~19 分钟 | 仅用于冒烟测试（< 2K 窗口训练效果差） |
| `--scale small` | 474K | ~1 小时 | 2K-10K 窗口（一次 40 分钟采集） |
| `--scale medium` | 800K | ~2 小时 | 10K-50K 窗口（多次采集/多个房间） |
| `--scale full` | 7.7M | ~8 小时 | 50K+ 窗口（建议使用 GPU） |

完整设计与优化细节请参阅 [ADR-079](adr/ADR-079-camera-ground-truth-training.md)，ADR-152 §2.2 则给出了这些数字应参照的外部 WiFlow-STD 基准。

---

## 预训练模型（无需训练）

预训练模型可在 HuggingFace 上获取：
- **CSI 编码器 + 存在头** —— https://huggingface.co/ruvnet/wifi-densepose-pretrained
- **SOTA MM-Fi 姿态模型**（82.69% torso-PCK@20）—— https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose
- **AetherArena 排行榜 Space** —— https://huggingface.co/spaces/ruvnet/aether-arena

编码器产物可按其文档化推理路径下载使用，无需重新训练。
MM-Fi 姿态检查点是基准证据，并非可直接使用的实时 ESP32 模型；它需要
严格符合 [模型与采集兼容性](#model-and-capture-compatibility) 中描述的输入契约与运行环境。
该确定性的信号处理流水线证明可通过 `python archive/v1/data/proof/verify.py` 复现
（参见 [ADR-168](adr/ADR-168-benchmark-proof.md)），但该证明并不验证姿态精度。

### 预训练模型快速上手

```bash
# 安装 huggingface CLI
pip install huggingface_hub

# 下载全部模型
huggingface-cli download ruvnet/wifi-densepose-pretrained --local-dir models/pretrained

# 模型包含：
#   model.safetensors    —— 48 KB 对比编码器
#   model-q4.bin         —— 8 KB 量化版（推荐）
#   model-q2.bin         —— 4 KB 超紧凑版（ESP32 边缘）
#   presence-head.json   —— 存在检测头（v2 编码器：留出集三元组准确率 82.3%）
#   node-1.json          —— 房间 1 的 LoRA 适配器
#   node-2.json          —— 房间 2 的 LoRA 适配器
```

### 模型的作用

预训练编码器将 8 维 CSI 特征向量转换为 128 维嵌入。这些嵌入驱动全部 17 项感知应用：

- **存在检测** —— v2 编码器：留出集时序三元组准确率 82.3%（v1 的“100%”是单类录制 —— 已撤回，[#882](https://github.com/ruvnet/RuView/issues/882)）
- **环境指纹** —— kNN 检索可找到“与此相似的状态”
- **异常检测** —— 与已知簇不匹配的嵌入即异常
- **活动分类** —— 不同活动在嵌入空间中聚成不同簇
- **房间自适应** —— 无需重新训练即可为不同房间切换 LoRA 适配器

### 用自己的数据重新训练

若想针对你的特定环境提升精度：

```bash
# 从你的 ESP32 采集 2 分钟以上的 CSI
python scripts/collect-training-data.py --port 5006 --duration 120

# 重新训练（使用 ruvllm，无需 PyTorch）
node scripts/train-ruvllm.js --data data/recordings/*.csi.jsonl

# 对你的重新训练模型做基准测试
node scripts/benchmark-ruvllm.js --model models/csi-ruvllm
```

---

## 健康与养生应用

WiFi 感知可在无需任何可穿戴设备或摄像头的情况下监测健康指标：

```bash
# 睡眠质量监测（通宵运行）
node scripts/sleep-monitor.js --port 5006

# 呼吸障碍初筛
node scripts/apnea-detector.js --port 5006

# 通过心率变异性检测压力
node scripts/stress-monitor.js --port 5006

# 行走分析 + 震颤检测
node scripts/gait-analyzer.js --port 5006

# 回放一段录制（无需实时硬件）
node scripts/sleep-monitor.js --replay data/recordings/<recording>.csi.jsonl
```

> **注意：** 这些只是初筛工具，并非医疗器械。诊断请咨询专业医疗人员。

---

<a id="ruvllm-training-pipeline"></a>
## ruvllm 训练流水线

全部训练都使用 **ruvllm** —— 一个原生 Rust 的 ML 运行时。无需 Python、PyTorch 或 GPU 驱动，可在任何装有 Node.js 的机器上运行。

### 5 阶段训练

| 阶段 | 内容 | 耗时（M4 Pro） |
|-------|------|--------------------|
| 对比预训练 | 对 CSI 嵌入使用 Triplet + InfoNCE 损失 | ~5s |
| 任务头训练 | 存在、活动、生命体征分类器 | ~10s |
| LoRA 精调 | 每节点房间自适应（rank-4） | ~4s |
| TurboQuant 量化 | 2/4/8-bit，质量损失 <0.5% | <1s |
| EWC 整合 | 防止灾难性遗忘 | <1s |

```bash
# 基础训练
node scripts/train-ruvllm.js --data data/recordings/pretrain-*.csi.jsonl

# 基准测试
node scripts/benchmark-ruvllm.js --model models/csi-ruvllm
```

### 量化选项

| 位数 | 大小 | 压缩比 | 质量损失 | 适用场景 |
|------|------|-------------|-------------|----------|
| fp32 | 48 KB | 1x | 0% | 开发 |
| 8-bit | 16 KB | 4x | <0.01% | Cognitum Seed 推理 |
| 4-bit | 8 KB | 8x | <0.1% | 推荐用于部署 |
| 2-bit | 4 KB | 16x | <1% | ESP32-S3 SRAM（边缘推理） |

### 主要特性

- **SONA 自适应** —— 无需重新训练即可在 <1ms 内适配新房间
- **LoRA 适配器** —— 每房间 2,048 个参数，可热插拔
- **EWC 保护** —— 学习新房间而不会遗忘之前的内容
- **确定性** —— 相同种子总是产生相同模型（可复现）
- **10 倍数据增强** —— 时序插值、噪声注入、跨节点混合

---

<a id="docker-compose-multi-service"></a>
## Docker Compose（多服务）

适用于同时包含 Rust 与 Python 服务的生产部署：

```bash
cd docker
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
export RUVIEW_UDP_ALLOW=<node-ip-or-cidr>   # macOS Docker: <gateway>/32
docker compose up
```

这会启动：
- Rust 感知服务器，端口 3000（HTTP）、3001（WS）、5005（UDP）
- Python 旧版服务器，端口 8080（HTTP）、8765（WS）

当 `RUVIEW_API_TOKEN` 未设置时，感知服务器会以退出码 64 退出。若没有 `RUVIEW_UDP_ALLOW` 或 `RUVIEW_UDP_INSECURE_LAN=true`，它会启动但收不到任何 ESP32 帧。`docker/docker-compose.yml` 会将这些变量连同 `RUVIEW_UDP_BIND` 与 `SENSING_ALLOWED_HOSTS` 一起从你的 shell 透传。参见 [在 Docker 中接收 ESP32 帧](#receiving-esp32-frames-in-docker)。

---

<a id="testing-firmware-without-hardware-qemu"></a>
## 无需硬件测试固件（QEMU）

你可以在自己的电脑上测试 ESP32-S3 固件，而无需任何实体硬件。本项目使用 **QEMU** —— 一个模拟 ESP32-S3 芯片的模拟器，可在你的 PC 上的虚拟机中运行真正的固件代码。

以下场景很有用：
- 你还没有 ESP32-S3 开发板
- 你想在烧录到真实硬件前先测试固件改动
- 你在 CI/CD 中运行自动化测试
- 你想模拟多个 ESP32 节点互相通信

<a id="what-you-need"></a>
### 你需要准备

**必需：**
- Python 3.8+（你很可能已经装了）
- 支持 ESP32-S3 的 QEMU（Espressif 的分支）

**安装 QEMU（一次性配置）：**

```bash
# 最简单：使用自动安装脚本（安装 QEMU + Python 工具）
bash scripts/install-qemu.sh

# 或检查已安装的内容：
bash scripts/install-qemu.sh --check
```

安装脚本会检测你的操作系统（Ubuntu、Fedora、macOS 等），安装构建依赖，克隆 Espressif 的 QEMU 分支，编译它并加入你的 PATH。它还会安装 Python 工具（`esptool`、`pyyaml`、`esp-idf-nvs-partition-gen`）。

<details>
<summary>手动安装（如果你愿意）</summary>

```bash
# 从源码构建
git clone https://github.com/espressif/qemu.git
cd qemu
./configure --target-list=xtensa-softmmu --enable-slirp
make -j$(nproc)
export QEMU_PATH=$(pwd)/build/qemu-system-xtensa

# 安装 Python 工具
pip install esptool pyyaml esp-idf-nvs-partition-gen
```

</details>

**用于多节点测试（可选）：**

```bash
# Linux only — needed for virtual network bridges
sudo apt install socat bridge-utils iproute2
```

### `qemu-cli.sh` 命令

所有 QEMU 测试都可通过一条命令完成：

```bash
bash scripts/qemu-cli.sh <command>
```

| 命令 | 作用 |
|---------|-------------|
| `install` | 安装 QEMU（运行上面的安装脚本） |
| `test` | 运行单节点固件测试 |
| `swarm --preset smoke` | 快速 2 节点集群测试 |
| `swarm --preset standard` | 标准 3 节点测试 |
| `mesh 3` | 多节点网格测试 |
| `chaos` | 故障注入韧性测试 |
| `fuzz --duration 60` | 运行模糊测试 |
| `status` | 显示已安装且就绪的内容 |
| `help` | 显示所有命令 |

<a id="your-first-test-run"></a>
### 你的第一次测试运行

测试固件最简单的方式：

```bash
# 使用 CLI：
bash scripts/qemu-cli.sh test

# 或直接：
bash scripts/qemu-esp32s3-test.sh
```

**背后发生了什么：**
1. 固件以“mock CSI”模式编译 —— 不再读取真实 WiFi 信号，而是生成模拟真人行走、跌倒或呼吸的合成测试数据
2. 编译后的固件被加载进 QEMU，后者像启动真实 ESP32-S3 那样启动它
3. 模拟器的串口输出（也就是你在 USB 线上会看到的内容）被捕获
4. 校验脚本检查输出中是否存在预期行为与错误

如果你已经构建过固件并想跳过重新构建：

```bash
SKIP_BUILD=1 bash scripts/qemu-esp32s3-test.sh
```

若想给它更多时间（在较慢机器上很有用）：

```bash
QEMU_TIMEOUT=120 bash scripts/qemu-esp32s3-test.sh
```

<a id="understanding-the-test-output"></a>
### 理解测试输出

该测试对固件输出运行 16 项检查。一次成功运行的结果如下：

```
=== QEMU ESP32-S3 Firmware Test (ADR-061) ===

[PASS] Boot: Firmware booted successfully
[PASS] NVS config: Configuration loaded from flash
[PASS] Mock CSI: Synthetic WiFi data generator started
[PASS] Edge processing: Signal analysis pipeline running
[PASS] Frame serialization: Data packets formatted correctly
[PASS] No crashes: No error conditions detected
...

16/16 checks passed
=== Test Complete (exit code: 0) ===
```

**退出码说明：**

| 代码 | 含义 | 处理方式 |
|------|---------|-----------|
| 0 | **PASS** —— 一切正常 | 无需处理，一切就绪！ |
| 1 | **WARN** —— 轻微问题 | 查看输出；通常可继续 |
| 2 | **FAIL** —— 出现损坏 | 查看 `[FAIL]` 行了解出错位置 |
| 3 | **FATAL** —— 甚至无法启动 | 通常是缺少工具或构建失败；请查看错误信息 |

<a id="testing-multiple-nodes-at-once-swarm"></a>
### 一次测试多个节点（集群）

真实部署使用 3-8 个 ESP32 节点。**swarm 配置器**可让你在电脑上模拟多个节点，每个节点扮演不同角色：

- **传感器节点** —— 生成 WiFi 信号数据（类似环绕房间布置的 ESP32）
- **协调器节点** —— 从所有传感器收集数据并运行分析
- **网关节点** —— 将数据桥接到你的电脑

```bash
# 快速 2 节点冒烟测试（15 秒）
python3 scripts/qemu_swarm.py --preset smoke

# 标准 3 节点测试：2 传感器 + 1 协调器（60 秒）
python3 scripts/qemu_swarm.py --preset standard

# 查看可用项
python3 scripts/qemu_swarm.py --list-presets

# 预览将运行的内容（不实际运行）
python3 scripts/qemu_swarm.py --preset standard --dry-run
```

**注意：** 使用虚拟网桥的多节点测试需要 Linux 与 `sudo`。在其他系统上，节点使用更简单的网络模式：每个节点都能连到协调器，但彼此之间不能通信。

<a id="swarm-presets"></a>
### 集群预设

| 预设 | 节点数 | 时长 | 适用场景 |
|--------|-------|----------|----------|
| `smoke` | 2 | 15s | 快速验证是否可用 |
| `standard` | 3 | 60s | 常规开发测试 |
| `ci_matrix` | 3 | 30s | CI/CD 流水线 |
| `large_mesh` | 6 | 90s | 大规模测试 |
| `line_relay` | 4 | 60s | 多跳中继测试 |
| `ring_fault` | 4 | 75s | 容错测试 |
| `heterogeneous` | 5 | 90s | 混合场景测试 |

<a id="writing-your-own-swarm-config"></a>
### 编写你自己的集群配置

创建一个描述测试场景的 YAML 文件：

```yaml
# my_test.yaml（我的测试配置）
swarm:
  name: my-custom-test
  duration_s: 45
  topology: star       # star、mesh、line 或 ring
  aggregator_port: 5005

nodes:
  - role: coordinator
    node_id: 0
    scenario: 0        # 0=空房间（基线）
    channel: 6
    edge_tier: 2

  - role: sensor
    node_id: 1
    scenario: 2        # 2=行走的人
    channel: 6
    tdm_slot: 1

  - role: sensor
    node_id: 2
    scenario: 3        # 3=跌倒事件
    channel: 6
    tdm_slot: 2

assertions:
  - all_nodes_boot           # 每个节点都启动了吗？
  - no_crashes               # 有无错误/崩溃？
  - all_nodes_produce_frames # 每个传感器都在生成数据吗？
  - fall_detected_by_node_2  # 节点 2 检测到跌倒了吗？
```

**可用场景**（生成何种伪造 WiFi 数据）：

| # | 场景 | 描述 |
|---|----------|-------------|
| 0 | 空房间 | 仅含噪声的基线 |
| 1 | 静止的人 | 某人站立不动 |
| 2 | 行走 | 某人在房间中走动 |
| 3 | 跌倒 | 某人摔倒 |
| 4 | 多人 | 房间中有两人 |
| 5 | 信道扫描 | 循环遍历 WiFi 信道 |
| 6 | MAC 过滤 | 测试设备过滤 |
| 7 | 环形溢出 | 突发数据压力测试 |
| 8 | RSSI 扫描 | 信号强度从弱到强 |
| 9 | 零长度 | 边界情况：空数据包 |

**拓扑选项：**

| 拓扑 | 形状 | 使用时机 |
|----------|-------|-------------|
| `star` | 所有传感器连到一个协调器 | 最常见的配置 |
| `mesh` | 每个节点都能与其他节点通信 | 测试全连接网络 |
| `line` | 节点排成链状（A → B → C → D） | 测试中继/转发 |
| `ring` | 首尾相连的链 | 测试环形路由 |

运行你的自定义配置：

```bash
python3 scripts/qemu_swarm.py --config my_test.yaml
```

<a id="debugging-firmware-in-qemu"></a>
### 在 QEMU 中调试固件

如果出了问题，你可以把调试器挂到模拟出来的 ESP32 上：

```bash
# 终端 1：以调试支持启动 QEMU（启动时暂停）
qemu-system-xtensa -machine esp32s3 -nographic \
  -drive file=firmware/esp32-csi-node/build/qemu_flash.bin,if=mtd,format=raw \
  -s -S

# 终端 2：连接调试器
xtensa-esp-elf-gdb firmware/esp32-csi-node/build/esp32-csi-node.elf \
  -ex "target remote :1234" \
  -ex "break app_main" \
  -ex "continue"
```

或使用 VS Code：打开项目，按 **F5**，并选择 **“QEMU ESP32-S3 Debug”**。

<a id="running-the-full-test-suite"></a>
### 运行完整测试套件

在提交 pull request 之前进行全面验证：

```bash
# 1. 单节点测试（2 分钟）
bash scripts/qemu-esp32s3-test.sh

# 2. 多节点集群测试（1 分钟）
python3 scripts/qemu_swarm.py --preset standard

# 3. 模糊测试 —— 发现边界情况崩溃（1-5 分钟）
cd firmware/esp32-csi-node/test
make all CC=clang
make run_serialize FUZZ_DURATION=60
make run_edge FUZZ_DURATION=60
make run_nvs FUZZ_DURATION=60

# 4. NVS 配置矩阵 —— 测试 14 种配置组合
python3 scripts/generate_nvs_matrix.py --output-dir build/nvs_matrix

# 5. 混沌测试 —— 注入故障以测试韧性（2 分钟）
bash scripts/qemu-chaos-test.sh
```

当你向 `firmware/` 推送改动时，以上所有内容也会在 CI 中自动运行。

---

<a id="troubleshooting"></a>
## 故障排查

### Docker：macOS 上出现 "no matching manifest for linux/arm64"

`latest` 标签同时支持 amd64 与 arm64。请拉取最新镜像：

```bash
docker pull ruvnet/wifi-densepose:latest
```

如果仍看到该错误，你的本地 Docker 可能缓存了过期的 manifest。可尝试：

```bash
docker pull --platform linux/arm64 ruvnet/wifi-densepose:latest
```

### Docker：localhost:3000 上出现 "Connection refused"

请确保端口映射正确：

```bash
docker run -p 3000:3000 -p 3001:3001 ruvnet/wifi-densepose:latest
```

`-p 3000:3000` 将主机端口 3000 映射到容器端口 3000。

### Docker：UI 中没有 WebSocket 数据

请添加 WebSocket 端口映射：

```bash
docker run -p 3000:3000 -p 3001:3001 ruvnet/wifi-densepose:latest
```

### ESP32："CSI not enabled in menuconfig"

v0.4.1 之前的固件版本在构建配置中禁用了 `CONFIG_ESP_WIFI_CSI_ENABLED`。请升级到 [v0.4.1](https://github.com/ruvnet/RuView/releases/tag/v0.4.1-esp32) 或更高版本。若从源码构建，请确保存在 `sdkconfig.defaults`（而不仅仅是 `sdkconfig.defaults.template`）。参见 [ADR-057](../docs/adr/ADR-057-firmware-csi-build-guard.md)。

### ESP32：没有数据到达

1. 确认固件为 v0.4.1+（旧版本禁用了 CSI —— 见上）
2. 确认 ESP32 连接到同一个 WiFi 网络
3. 检查目标 IP 是否与感知服务器所在机器一致：`python firmware/esp32-csi-node/provision.py --port COM7 --target-ip <YOUR_IP>`
4. 确认 UDP 端口 5005 未被防火墙拦截
5. 测试方式：`nc -lu 5005`（Linux）或类似的 UDP 监听器

### 构建：Rust 编译错误

请确保已安装 Rust 1.75+（推荐 1.85+）：
```bash
rustup update stable
rustc --version
```

### 构建：Linux 原生桌面前置依赖

如果你在基于 Debian/Ubuntu 的 Linux 系统上编译 Rust 工作区，请先安装原生桌面开发包：

```bash
sudo apt update
sudo apt install -y \
  build-essential pkg-config \
  libglib2.0-dev libgtk-3-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libwebkit2gtk-4.1-dev
```

然后重新运行：

```bash
cargo build --release
```

这与 Rust 源码构建章节提到的 Linux 前置步骤相同，涵盖了桌面构建所需的常见 GTK/WebKit `pkg-config` 依赖。

### Windows：RSSI 模式没有数据显示

请以管理员身份运行终端（访问 `netsh wlan` 所需）。已在 Windows 10 与 11 上，配合 Intel AX201 与 Intel BE201 适配器验证可用。

### 生命体征显示 0 BPM

- 生命体征检测需要支持 CSI 的硬件（ESP32 或研究网卡）
- 仅 RSSI 模式（Windows WiFi）分辨率不足以支持生命体征
- 在模拟模式下，合成生命体征会在数秒预热后生成
- 使用真实 ESP32 数据时，生命体征约需 5 秒稳定（平滑流水线预热）

### 生命体征跳动不稳

服务器采用了 3 段式平滑流水线（ADR-048）。若读数仍然不稳：
- 确保被测对象相对静止（大幅动作会掩盖生命体征的振荡）
- 为你的特定环境训练自适应分类器：`curl -X POST http://localhost:3000/api/v1/adaptive/train`
- 检查信号质量：`curl http://localhost:3000/api/v1/sensing/latest` —— 寻找 `signal_quality > 0.4`

### Observatory 显示 DEMO 而非 LIVE

- 确认感知服务器正在运行：`curl http://localhost:3000/health`
- 通过服务器 URL 访问 Observatory：`http://localhost:3000/ui/observatory.html`（而非 file:// URL）
- 若独立的 `aggregator` 命令已在 UDP `:5005` 上监听，请停止它，改为运行 `sensing-server --source esp32 --udp-port 5005 --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>`；Observatory 读取的是服务器 WebSocket，而非独立 aggregator 的输出
- 在原生运行时，请确保服务器以 `--udp-bind 0.0.0.0` 和 `--udp-allow`（或 `--udp-insecure-lan`）启动。它默认监听 `127.0.0.1`，否则来自你节点的帧永远无法到达
- 确认 ESP32 节点已配网到运行 `sensing-server` 的机器 IP 地址
- 按 Ctrl+Shift+R 强制刷新以清除缓存设置
- 自动检测会在同源下探测 `/health` —— 跨源不会生效

### QEMU："qemu-system-xtensa: command not found"

面向 ESP32-S3 的 QEMU 必须从 Espressif 的分支构建 —— 它不在标准包管理器中：

```bash
git clone https://github.com/espressif/qemu.git
cd qemu && ./configure --target-list=xtensa-softmmu && make -j$(nproc)
export QEMU_PATH=$(pwd)/build/qemu-system-xtensa
```

或指向已有的构建：`QEMU_PATH=/path/to/qemu-system-xtensa bash scripts/qemu-esp32s3-test.sh`

### QEMU：测试超时且无输出

模拟器比真实硬件慢。请增大超时时间：

```bash
QEMU_TIMEOUT=120 bash scripts/qemu-esp32s3-test.sh
```

如果确实完全没有任何输出，可能是固件构建失败。请在不带 `SKIP_BUILD` 的情况下重新构建：

```bash
bash scripts/qemu-esp32s3-test.sh   # without SKIP_BUILD
```

### QEMU："esptool not found"

用 pip 安装：`pip install esptool`

### QEMU 集群："Must be run as root"

使用虚拟网桥的多节点集群测试在 Linux 上需要 root 权限。有两种做法：

1. 用 sudo 运行：`sudo python3 scripts/qemu_swarm.py --preset standard`
2. 跳过网桥（节点使用更简单的网络）：该工具在非 root 系统上会自动降级，但节点之间无法通信（只能与聚合器通信）

### QEMU 集群："yaml module not found"

安装 PyYAML：`pip install pyyaml`

---

<a id="faq"></a>
## 常见问题

**问：试用它需要特殊硬件吗？**
不需要。运行 `docker run -p 3000:3000 ruvnet/wifi-densepose:latest` 并打开 `http://localhost:3000`。模拟模式会用合成数据跑通整套流水线。

**问：消费级 WiFi 笔记本能做姿态估计吗？**
不能。消费级 WiFi 只暴露 RSSI（每个接入点一个数值），而非 CSI（每帧 56+ 个复子载波值）。RSSI 仅支持粗略的存在与运动检测。完整的姿态估计需要支持 CSI 的硬件，如 ESP32-S3（$8）或研究网卡。

**问：姿态估计有多准？**
RuView 已发表最强的结果是 MM-Fi transformer 基准（在匹配的
`random_split` 协议下，torso-PCK@20 为 82.69%），而非实时 ESP32 结果。已提交的 cog 模型在其留出集上测得
PCK@20 为 3.0%，低于 ≥35% 的目标，且查看器的实时骨架只是启发式
占位。目前没有任何实测结论表明 3 节点 ESP32 网格能可靠跟踪 17 个关键点。
ADR-027 的 10 秒无标签 MERIDIAN 自适应处于 Proposed 状态；现有可用的实测校准
参考使用的是带标签、模型特定的样本。

**问：它能穿透墙壁工作吗？**
可以。WiFi 信号能穿透非金属材料（石膏板、木材、最厚约 30cm 的混凝土）。金属墙/门会显著衰减信号。使用单个 AP 时，有效穿墙距离约 5 米。使用 3-6 节点多静态网格（ADR-029），注意力加权的跨视角融合可将有效距离扩展到标准住宅墙体后的约 8 米。

**问：它能跟踪多少人？**
每个接入点借助 56 个子载波可区分约 3-5 人。多 AP 部署呈线性倍增（例如 4 个 AP 可覆盖约 15-20 人）。软件上没有硬性上限；实际天花板取决于信号物理特性。

**问：这保护了隐私吗？**
该系统使用 WiFi 无线电信号，而非摄像头。不会采集或存储任何图像或视频。但它确实会跟踪人的位置、运动和生命体征，这些属于受适用隐私法规约束的个人数据。

**问：Python 与 Rust 有什么区别？**
对于完整的 CSI 流水线，Rust 实现（v2）比 Python（v1）快 810 倍。Docker 镜像分别为 132 MB 与 569 MB。Rust 是主要且推荐的运行时。Python v1 仍保留用于遗留工作流。

**问：我能用 ESP8266 代替 ESP32-S3 吗？**
不能。ESP8266 的 SDK 不暴露 WiFi 信道状态信息（CSI），RAM 不足（约 80 KB 对 512 KB），且运行单核 80 MHz CPU，无法承载信号处理流水线。ESP32-S3 是受支持的最低 CSI 采集设备。备选方案（包括用廉价 Android TV 盒子作聚合中枢）参见 [Issue #138](https://github.com/ruvnet/RuView/issues/138)。

**问：Windows WiFi 教程在 Windows 10 上能用吗？**
可以。社区已在 Windows 10（build 26200）上，配合 Intel Wi-Fi 6 AX201 160MHz 适配器、5 GHz 网络验证通过。全部 7 个教程步骤在 Python 3.14 下均通过。完整测试结果参见 [Issue #36](https://github.com/ruvnet/RuView/issues/36)。

**问：我能在 ARM 设备（树莓派、TV 盒子）上运行感知服务器吗？**
ARM64 部署已在规划中（[ADR-046](adr/ADR-046-android-tv-box-armbian-deployment.md)），但尚未提供预编译二进制。如果你已配置好 Rust 交叉编译工具链，可从源码交叉编译：`cross build --release --target aarch64-unknown-linux-gnu -p wifi-densepose-sensing-server`。

---

## 延伸阅读

- [架构决策记录](../docs/adr/) - 涵盖全部设计决策的 48 篇 ADR
- [WiFi-Mat 灾害响应指南](wifi-mat-user-guide.md) - 搜索与救援模块
- [构建指南](build-guide.md) - 详细构建说明
- [RuVector](https://github.com/ruvnet/ruvector) - 信号智能 crate 生态
- [CMU DensePose From WiFi](https://arxiv.org/abs/2301.00250) - 奠基性研究论文
