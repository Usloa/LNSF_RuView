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

## Home Assistant + Matter integration

Full design + operator guide: [`docs/integrations/home-assistant.md`](integrations/home-assistant.md) (ADR-115).

### 30-second Mosquitto-add-on flow

1. Inside Home Assistant, install the **Mosquitto broker** add-on from the Add-on Store and start it.
2. In HA, **Settings → Devices & Services → Add Integration → MQTT**, point at the broker.
3. Start the sensing-server with MQTT:

   ```bash
   docker run --rm --net=host ruvnet/wifi-densepose:0.7.0 \
       --source esp32 --mqtt --mqtt-host <ha-host-ip>
   ```
4. Within ~5 seconds HA auto-creates one **device** per RuView node with 21 entities: 11 raw signals (presence, person count, HR, BR, motion, fall, RSSI, zones, pose, …) plus 10 semantic primitives (someone-sleeping, possible-distress, room-active, elderly-inactivity-anomaly, meeting, bathroom, fall-risk, bed-exit, no-movement, multi-room-transition).

### Privacy mode for healthcare / AAL

```bash
sensing-server --mqtt --mqtt-host <broker> --mqtt-tls --privacy-mode
```

`--privacy-mode` (env `RUVIEW_PRIVACY_MODE`) is a server-wide flag. It withholds heart rate, breathing rate, and pose keypoints from every output:

- REST responses: the fields are removed from every JSON body (`/api/v1/sensing/latest`, `/api/v1/vital-signs`, `/api/v1/edge-vitals`, `/api/v1/pose/current`, ...). `/api/v1/pose/current?view=both|refined` returns `403` with `"code": "privacy_mode"`.
- WebSocket streams: `/ws/sensing` and `/api/v1/stream/pose` frames are filtered the same way.
- Recordings started with `POST /api/v1/recording/start` are written already filtered.
- MQTT and Matter: those entities are neither announced nor published.

Presence, motion, person count, zones and the coarse posture label are still served, and semantic primitives stay published because they're inferred *states*, not biometric *values*. Some of those states (sleeping, possible distress) are derived from vitals, so they are still health-related information. Privacy mode reduces what leaves the server. It does not by itself make a deployment compliant with any regulation.

### Matter Bridge (Apple Home / Google Home / Alexa / SmartThings)

Not available yet. The `--matter` and `--matter-setup-file` flags from ADR-115 are defined in the crate's library CLI, but the `sensing-server` binary doesn't accept them (`error: unexpected argument '--matter' found`), so there's no way to start the Matter bridge today. Use the MQTT integration above for Home Assistant in the meantime.

Detailed entity reference, blueprint catalog, troubleshooting recipe matrix: see [`docs/integrations/home-assistant.md`](integrations/home-assistant.md).

### BFLD — privacy-gated WiFi BFI sensing layer (ADR-118)

The `wifi-densepose-bfld` crate adds an explicit privacy-gating layer on top of the sensing pipeline. It ingests 802.11ac/ax Beamforming Feedback Information (BFI) and emits bounded, classified sensing events that HA / Matter / MQTT consumers can read **without** leaking identity-discriminative data.

Three structural invariants enforced by the type system:

- **I1** — Raw BFI never exits the node (`Sink` marker-trait hierarchy)
- **I2** — Identity embedding is in-RAM-only (no `Serialize`/`Clone`/`Copy`; `Drop` zeroizes)
- **I3** — Cross-site identity correlation is cryptographically impossible (per-site BLAKE3-keyed hash + daily epoch rotation)

#### Minimal operator quickstart

Two runnable examples ship with the crate:

```bash
# In-process consumer: build pipeline, send one frame, print event JSON
cargo run -p wifi-densepose-bfld --example bfld_minimal

# Worker thread + HA-DISCO: full publish lifecycle (availability + discovery + state + LWT)
cargo run -p wifi-densepose-bfld --example bfld_handle
```

#### Production publish lifecycle (HA-DISCO + MQTT)

```rust
// Bootstrap (once at startup, retain=true messages):
publish_availability_online(&mut retained_pub, "seed-01")?;
publish_discovery(&mut retained_pub, "seed-01", PrivacyClass::Anonymous)?;

// Per-frame:
let handle = BfldPipelineHandle::spawn(pipeline, state_pub);
handle.send(PipelineInput { inputs, embedding })?;
```

Six HA entities are auto-created per node (`binary_sensor.*_bfld_presence`, `sensor.*_bfld_motion`/`person_count`/`zone_activity`/`confidence`/`identity_risk`). The `identity_risk` entity is **only present at `PrivacyClass::Anonymous`**; class `Restricted` deployments (care homes, regulated environments) drop it entirely from both discovery and state topics.

#### Three operator HA blueprints

Under `v2/crates/cog-ha-matter/blueprints/bfld/`:

- `presence-lighting.yaml` — `binary_sensor.*_bfld_presence` ⇒ `light.turn_on/off` with configurable hold time
- `motion-hvac.yaml` — `sensor.*_bfld_motion > threshold` ⇒ `climate.set_temperature` ΔT
- `identity-risk-anomaly.yaml` — rolling 7-day z-score notification (requires HA Statistics helper)

Import via HA UI: Settings → Automations & Scenes → Blueprints → Import.

#### Privacy class deployment matrix

| Class | Identity fields | Use case |
|-------|-----------------|----------|
| `Raw` | full BFI matrix | local-only research (never networked) |
| `Derived` | downsampled angles + risk score | operator-acknowledged LAN research mode |
| `Anonymous` (default) | aggregate sensing only + risk score + rotating hash | production HA / Matter deployments |
| `Restricted` | aggregate sensing only, identity fields stripped | care homes, GDPR/HIPAA-style regulated environments |

The `enable_privacy_mode()` runtime toggle on `BfldPipeline` engages `Restricted` from any baseline without restarting the pipeline — useful for security-incident response.

#### MQTT topic tree

```
ruview/<node_id>/bfld/availability         online / offline
ruview/<node_id>/bfld/presence/state       true / false
ruview/<node_id>/bfld/motion/state         0.000000..1.000000
ruview/<node_id>/bfld/person_count/state   integer
ruview/<node_id>/bfld/confidence/state     0.000000..1.000000
ruview/<node_id>/bfld/zone_activity/state  "<zone_name>"  (if configured)
ruview/<node_id>/bfld/identity_risk/state  0.000000..1.000000  (class 2 only)
```

The `rumqttc 0.24` (`use-rustls`) backend ships behind the `mqtt` feature; `RumqttPublisher::connect_with_lwt(node_id, opts, capacity)` pre-configures the Last Will and Testament so the broker auto-publishes `"offline"` on session drop.

Detailed surface: [`v2/crates/wifi-densepose-bfld/README.md`](../v2/crates/wifi-densepose-bfld/README.md), [`docs/research/BFLD/`](research/BFLD/) (11 files, 13,544 words), [ADR-118 through ADR-123](adr/ADR-118-bfld-beamforming-feedback-layer-for-detection.md).

### SENSE-BRIDGE — rvagent MCP server for AI agents (ADR-124)

`@ruvnet/rvagent` is a dual-transport MCP server that makes RuView sensing primitives callable by Claude Code, Cursor, and ruflo swarms without bespoke HTTP client code.

**Install (Claude Code)**:

```bash
claude mcp add rvagent -- npx @ruvnet/rvagent stdio
# With a remote sensing-server:
RUVIEW_SENSING_SERVER_URL=http://cognitum-v0:3000 claude mcp add rvagent -- npx @ruvnet/rvagent stdio
```

**Available tools (6 of 20 in v0.1.0)**:

| Tool | Returns |
|------|---------|
| `ruview.presence.now` | `present`, `n_persons`, `confidence`, `timestamp_ms` |
| `ruview.vitals.get_breathing` | `breathing_rate_bpm` (null if unavailable), `confidence` |
| `ruview.vitals.get_heart_rate` | `heartrate_bpm` (null if unavailable), `confidence` |
| `ruview.vitals.get_all` | Full `EdgeVitalsMessage` (all vitals in one call) |
| `ruview.bfld.last_scan` | `identity_risk_score`, `privacy_class`, `n_frames`, `timestamp_ms` |
| `ruview.bfld.subscribe` | `subscription_id`, `expires_at`, `topic` (MQTT wildcard) |

**Streamable HTTP** (for remote ruflo swarms):

```bash
RVAGENT_HTTP_TOKEN=secret npx @ruvnet/rvagent http --port 3001
# POST JSON-RPC to http://127.0.0.1:3001/mcp
# Cross-origin requests are rejected with 403; missing/wrong token → 401.
```

Source: [`tools/ruview-mcp/`](../tools/ruview-mcp/README.md). Tracking issue: [#787](https://github.com/ruvnet/RuView/issues/787). Full ADR: [ADR-124](adr/ADR-124-rvagent-mcp-ruvector-npm-integration.md).

---

<a id="ruview-npm-toolkit-ruvnetruview"></a>
## RuView npm toolkit (`@ruvnet/ruview`)

`@ruvnet/ruview` is RuView's operator toolkit on npm. It has no runtime
dependencies and runs on Node 20+. It is tested on Windows and Linux. One tool
registry serves:
- a CLI;
- an MCP server (stdio, or HTTP for ChatGPT);
- a typed SDK;
- a Claude Code mod.

Every result is honest about what it is:
- **MEASURED** when it comes from live packets on your machine;
- **SYNTHETIC** for simulators and self-tests;
- **device-reported** for values a radar's own firmware computes, which are
  not validated against a reference.

```bash
npx @ruvnet/ruview@0.9.1 --help
npx @ruvnet/ruview@0.9.1 doctor          # what works on this machine, with fixes
```

In a terminal, commands print a formatted view. Pipes and `--json` print JSON,
for scripts.

<a id="hardware-from-the-command-line"></a>
### Hardware from the command line

Run these on the machine the hardware is plugged into.

```bash
# What is plugged in (USB VID:PID → ESP32, Realtek RTL8721Dx, radar, LiDAR)
npx @ruvnet/ruview@0.9.1 devices

# CSI nodes streaming to this machine (UDP 5005): ESP32 ADR-018 frames and
# Realtek RAC1 frames, per node rate, loss, RSSI and CSI shape
npx @ruvnet/ruview@0.9.1 esp32 --seconds 10
npx @ruvnet/ruview@0.9.1 esp32 --watch                 # live view, redrawn every few seconds
npx @ruvnet/ruview@0.9.1 esp32 --seconds 45 --analyze  # live CSI through the vitals kernel

# A board's serial console, without resetting it
npx @ruvnet/ruview@0.9.1 monitor --port COM9
npx @ruvnet/ruview@0.9.1 monitor --port COM10 --baud 1500000   # Realtek Ameba

# 60 GHz / 24 GHz radar: raw UART, or an ESPHome kit on your network
npx @ruvnet/ruview@0.9.1 mmwave --port COM5 --model auto
npx @ruvnet/ruview@0.9.1 mmwave --source esphome --host 192.168.1.50

# Flash ESP32 firmware: plan first, then write with --confirm (records boot evidence)
npx @ruvnet/ruview@0.9.1 flash-plan --port COM16 --bundle firmware/esp32-csi-node/release_bins/c6-adr110 --variant c6
npx @ruvnet/ruview@0.9.1 flash --port COM16 --bundle firmware/esp32-csi-node/release_bins/c6-adr110 --variant c6 --confirm
```

**What the alerts mean:**

| Alert | Meaning |
|---|---|
| `heartbeat-only sender` | A board is alive but sends no CSI. On a Realtek board, run `monitor --baud 1500000`. If it shows `lack of csi buf`, the board ran out of CSI report buffers (`csi_buffer_starvation`). Reset it. |
| `port_in_use` | The sensing server already holds UDP 5005. Stop it, or capture on another port your nodes target. |
| `no_decodable_packets` | Packets arrived, but none were in a known RuView format. Check the sender. |
| `seqReordered` / `seqStrays` | Out-of-order or stray sequence numbers. These are not counted as loss. |

**ESPHome radar kits** (for example the Seeed MR60BHA2): the kit's firmware
owns the radar, so read it over the network with `--source esphome`.
- If the kit cannot join your WiFi, it starts a fallback hotspot. Join it and
  set your network in its captive portal, at `http://192.168.4.1`.
- Only private-network addresses are accepted.
- Encrypted or password-protected ESPHome APIs are reported as unsupported.

<a id="mcp-for-agents-chatgpt-and-mcp-apps"></a>
### MCP for agents, ChatGPT and MCP Apps

```bash
# Claude Code, Codex or any MCP client (stdio)
claude mcp add ruview -- npx -y @ruvnet/ruview@0.9.1 mcp start

# HTTP, for ChatGPT and remote clients
export RUVIEW_MCP_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
RUVIEW_MCP_GRANTS=device-access npx @ruvnet/ruview@0.9.1 mcp start --http --port 8790
```

**Connecting ChatGPT.** Clients that can send headers use
`Authorization: Bearer <token>`. ChatGPT connectors cannot, so:
1. Expose the port over HTTPS, with a tunnel or reverse proxy.
2. Add `https://<your-host>/mcp/<token>` as the connector URL.

**Least authority:**
- Hardware tools need the `device-access` grant.
- The HTTP transport binds to localhost by default.
- It refuses unknown browser origins.
- It never allows flashing or calibration, whatever grants are set.

Node captures, radar reads, device scans and doctor results render in the
**RuView console**: a widget that ChatGPT and other MCP Apps hosts show inline,
with a Refresh button that re-runs the tool.

<a id="claude-code-mod-live-sensing-pane"></a>
### Claude Code mod: live sensing pane

The package ships `ruview-live`, a Claude Code mod. `/ruview` opens a pane
beside the conversation, refreshed on a timer, showing:
- your CSI nodes;
- an optional ESPHome radar;
- alerts.

It also keeps a status line such as `RuView · 2 nodes · radar present`.

Keys `1`, `2` and `3` switch between three views (ADR-378):
- **Overview**: the cards.
- **CSI waterfall**: per-subcarrier amplitude over time, labelled MEASURED or
  SYNTHETIC; `n` cycles nodes.
- **Radar**: a range fan with an animated ping, plus heart, breathing and
  distance charts. The values are device-reported and not validated, and the
  kit reports range, not bearing.

The two live views draw in terminal cells and animate in place.

```bash
npx @ruvnet/ruview@0.9.1 mod           # prints the mod's path in your install and how to load it
claude --plugin-dir "<that path>"       # try it for one session
# or from the RuView marketplace, inside Claude Code:
#   /plugin marketplace add ruvnet/RuView
#   /plugin install ruview-live@ruview
```

| In Claude Code | Does |
|---|---|
| `/ruview` | Open or close the pane |
| `/ruview refresh` | Run one capture now; the result goes in the status line |
| `/ruview off` | Close the pane |
| `/ruview waterfall` / `/ruview radar` | Open on that view |

**Settings** (`claude plugin configure ruview-live`): `udpPort`, `radarHost`,
`refreshSeconds`, `captureSeconds` and `liveRefreshSeconds` (live views,
default 4 s).

The mod only runs the package's read-only CLI commands. Mods are early access:
if `/ruview` is missing, start Claude Code with
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

<a id="homecore-and-the-vitals-kernel"></a>
### Homecore and the vitals kernel

```bash
npx homecore@0.1.0 guidance --topic plugins --query Wasmtime   # Homecore developer metaharness
npx @ruvnet/ruview-kernel@0.1.0 selftest                       # vitals pipeline as WASM (SYNTHETIC self-test)
```

`esp32 --analyze` uses the kernel when it is installed. Its heart and breathing
estimates carry "no reference measurement": they show the signal path works,
not that the readings are accurate.

Design records:
- [ADR-373](adr/ADR-373-host-device-access-layer.md): device access;
- [ADR-375](adr/ADR-375-ruview-mcp-apps-console-http-transport-and-terminal-ui.md):
  MCP Apps console, HTTP transport and terminal UI;
- [ADR-376](adr/ADR-376-ruview-umbrella-npm-package.md): the one-install
  `ruview` package, pending the npm name;
- [ADR-377](adr/ADR-377-ruview-live-claude-code-mod.md): the Claude Code mod.
- [ADR-378](adr/ADR-378-ruview-live-showcase-views.md): the mod's CSI waterfall and radar views (keys 1/2/3, `esp32 --spectrum`).

---

<a id="web-ui"></a>
## Web UI

The built-in Three.js UI is served at `http://localhost:3000/ui/` (Docker) or the configured HTTP port.

**Two visualization modes:**

| Page | URL | Purpose |
|------|-----|---------|
| **Dashboard** | `/ui/index.html` | Tabbed monitoring dashboard with body model, signal heatmap, phase plot, vital signs |
| **Observatory** | `/ui/observatory.html` | Immersive 3D room visualization with cinematic lighting and wireframe figures |

**Dashboard panels:**

| Panel | Description |
|-------|-------------|
| 3D Body View | Rotatable wireframe skeleton with 17 COCO keypoints |
| Signal Heatmap | 56 subcarriers color-coded by amplitude |
| Phase Plot | Per-subcarrier phase values over time |
| Doppler Bars | Motion band power indicators |
| Vital Signs | Live breathing rate (BPM) and heart rate (BPM) |
| Dashboard | System stats, throughput, connected WebSocket clients |

Both UIs update in real-time via WebSocket and auto-detect the sensing server on the same origin.

---

## Dense Point Cloud (Camera + WiFi CSI Fusion)

RuView can generate real-time 3D point clouds by fusing camera depth estimation with WiFi CSI spatial sensing. This creates a spatial model of the environment that updates in real-time.

### Setup

```bash
# Build the pointcloud binary
cd v2
cargo build --release -p wifi-densepose-pointcloud

# Start the server (auto-detects camera + CSI). Loopback-only by default.
./target/release/ruview-pointcloud serve --bind 127.0.0.1:9880
```

Open `http://localhost:9880` for the interactive Three.js 3D viewer.

> **Security note.** The server exposes live camera, skeleton, vitals, and occupancy over HTTP. The `--bind` flag defaults to `127.0.0.1:9880` (loopback-only). Exposing on `0.0.0.0` or a LAN IP is opt-in — the server logs a warning when it does, but there is no auth/TLS layer. Put a reverse proxy in front if you need remote access.

> **Brain URL.** Observations are POSTed to `http://127.0.0.1:9876` by default. Override via the `RUVIEW_BRAIN_URL` environment variable or the `--brain <url>` flag on `serve` / `train`.

### Sensors

| Sensor | Auto-detected | Data |
|--------|--------------|------|
| Camera (`/dev/video0`) | Yes (Linux UVC) | RGB frames → MiDaS depth → 3D points |
| ESP32 CSI (UDP:3333) | Yes (if provisioned) | ADR-018 binary → occupancy + pose + vitals |
| MiDaS depth server (port 9885) | Optional | GPU-accelerated neural depth estimation |

### Commands

| Command | Description |
|---------|-------------|
| `ruview-pointcloud serve --bind 127.0.0.1:9880` | Start HTTP server + Three.js viewer (loopback-only by default) |
| `ruview-pointcloud demo` | Generate synthetic point cloud (no hardware needed) |
| `ruview-pointcloud capture --output room.ply` | Capture single frame to PLY file |
| `ruview-pointcloud cameras` | List available cameras |
| `ruview-pointcloud train --data-dir ./data [--brain URL]` | Depth calibration + occupancy training (writes under canonicalized `data-dir`; refuses `..` traversal) |
| `ruview-pointcloud csi-test --count 100` | Send test CSI frames (no ESP32 needed) |
| `ruview-pointcloud fingerprint <name> [--seconds 5]` | Record a named CSI room fingerprint for later matching |

### Pipeline Components

1. **ADR-018 Parser** — Decodes ESP32 CSI binary frames from UDP (magic `0xC5110001` raw CSI and `0xC5110006` feature state), extracts I/Q subcarrier amplitudes and phases. Lives in `parser.rs`; unit-tested against hand-rolled test vectors.
2. **Pose (stub)** — 17 COCO keypoint *layout* generated by `heuristic_pose_from_amplitude` from CSI amplitude energy. This is **not** the trained WiFlow model — it is a placeholder so the viewer has a skeleton to render. Wiring to real Candle/ONNX inference from the `wifi-densepose-nn` crate is a planned follow-up.
3. **Vital Signs** — Breathing rate from CSI phase analysis (peak counting on stable subcarrier)
4. **Motion Detection** — CSI amplitude variance over 20 frames, triggers adaptive capture
5. **RF Tomography** — Backprojection from per-node RSSI to 8×8×4 occupancy grid
6. **Camera Depth** — MiDaS monocular depth (GPU) with luminance+edge fallback
7. **Sensor Fusion** — Voxel-grid merging of camera depth + CSI occupancy
8. **Brain Bridge** — Stores spatial observations in the ruOS brain every 60 seconds

### API Endpoints

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/health` | GET | `{"status": "ok"}` |
| `/api/status` | GET | Camera, CSI, pipeline state, vitals, motion |
| `/api/cloud` | GET | Point cloud (up to 1000 points) + pipeline data |
| `/api/splats` | GET | Gaussian splats for Three.js rendering |
| `/` | GET | Interactive Three.js 3D viewer |

### Training

The training pipeline calibrates depth estimation and occupancy detection:

```bash
ruview-pointcloud train --data-dir ~/.local/share/ruview/training --brain http://127.0.0.1:9876
```

This captures frames, runs depth calibration (grid search over scale/offset/gamma), trains occupancy thresholds, exports DPO preference pairs, and submits results to the ruOS brain.

### Output Formats

- **PLY** — Standard 3D point cloud (ASCII, with RGB color)
- **Gaussian Splats** — JSON format for Three.js rendering
- **Brain Memories** — Spatial observations stored as `spatial-observation`, `spatial-motion`, `spatial-vitals`

### Deep Room Scan

Capture a high-quality 3D model of the room:

```bash
# Stop the live server first (frees the camera)
# Then capture 20 frames and process with MiDaS
ruview-pointcloud capture --frames 20 --output room_model.ply
```

Result: 40,000+ voxels at 5cm resolution, 12,000+ Gaussian splats.

### ESP32 Provisioning for CSI

To send CSI data to the pointcloud server:

```bash
python3 firmware/esp32-csi-node/provision.py \
    --port /dev/ttyACM0 \
    --ssid "YourWiFi" --password "YourPassword" \
    --target-ip 192.168.1.123 --target-port 3333 \
    --node-id 1
```

---

<a id="vital-sign-detection"></a>
## Vital Sign Detection

The system extracts breathing rate and heart rate from CSI signal fluctuations using FFT peak detection.

| Sign | Frequency Band | Range | Method |
|------|---------------|-------|--------|
| Breathing | 0.1-0.5 Hz | 6-30 BPM | Bandpass filter + FFT peak |
| Heart rate | 0.8-2.0 Hz | 40-120 BPM | Bandpass filter + FFT peak |

**Requirements:**
- CSI-capable hardware (ESP32-S3 or research NIC) for accurate readings
- Subject within ~3-5 meters of an access point (up to ~8 m with multistatic mesh)
- Relatively stationary subject (large movements mask vital sign oscillations)

**Signal smoothing:** Vital sign estimates pass through a three-stage smoothing pipeline (ADR-048): outlier rejection (±8 BPM HR, ±2 BPM BR per frame), 21-frame trimmed mean, and EMA with α=0.02. This produces stable readings that hold steady for 5-10+ seconds instead of jumping every frame. See [Adaptive Classifier](#adaptive-classifier) for details.

**Simulated mode** produces synthetic vital sign data for testing.

---

<a id="cli-reference"></a>
## CLI Reference

The Rust sensing server binary accepts the following flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--source` | `auto` | Data source: `auto`, `esp32`, `wifi`, `simulated` (alias `simulate`), `mediatek`, `qualcomm`, `realtek`, `realtek_csi`. Other values are rejected at startup |
| `--http-port` | `8080` | HTTP port for REST API and UI |
| `--ws-port` | `8765` | WebSocket port |
| `--udp-port` | `5005` | UDP port for ESP32 CSI frames |
| `--udp-bind` | `127.0.0.1` | Address the UDP receiver listens on. Use `0.0.0.0` to receive frames from nodes on your network; that also needs `--udp-allow` or `--udp-insecure-lan` |
| `--udp-allow` | (none) | Comma-separated IPs/CIDRs allowed to send CSI frames, e.g. `192.168.1.0/24` |
| `--udp-insecure-lan` | off | Accept frames from any source on a routable bind (the UDP data plane is not authenticated) |
| `--ui-path` | `../ui` | Path to UI static files directory (falls back to `./ui` or `../../ui` if it doesn't exist) |
| `--tick-ms` | `100` | Simulated frame interval (milliseconds) |
| `--benchmark` | off | Run vital sign benchmark (1000 frames) and exit |
| `--train` | off | Train a model from dataset |
| `--dataset` | (none) | Path to dataset directory (MM-Fi or Wi-Pose) |
| `--dataset-type` | `mmfi` | Dataset format: `mmfi` or `wipose` |
| `--epochs` | `100` | Training epochs |
| `--export-rvf` | (none) | Export a **placeholder** RVF container-format demo and exit — **not a trained model**. For a real model use `--train` (+ `--save-rvf`) or download a pretrained encoder. |
| `--save-rvf` | (none) | Save model state to RVF on shutdown |
| `--model` | (none) | Load a trained `.rvf` model for inference |
| `--load-rvf` | (none) | Load model config from RVF container |
| `--progressive` | off | Enable progressive 3-layer model loading |

### Common Invocations

```bash
# Simulated mode with UI (development)
./target/release/sensing-server --source simulate --http-port 3000 --ws-port 3001 --ui-path ../ui

# ESP32 hardware mode
./target/release/sensing-server --source esp32 --udp-port 5005 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>

# Windows WiFi RSSI
./target/release/sensing-server --source wifi --tick-ms 500

# Run benchmark
./target/release/sensing-server --benchmark

# Train and export model
./target/release/sensing-server --train --dataset data/ --epochs 100 --save-rvf model.rvf

# Load trained model with progressive loading
./target/release/sensing-server --model model.rvf --progressive
```

---

<a id="observatory-visualization"></a>
## Observatory Visualization

The Observatory is an immersive Three.js visualization that renders WiFi sensing data as a cinematic 3D experience. It features room-scale props, wireframe human figures, WiFi signal animations, and a live data HUD.

**URL:** `http://localhost:3000/ui/observatory.html`

**Features:**

| 特性 | 说明 |
|---------|-------------|
| Room scene | Furniture, walls, floor with emissive materials and 6-point lighting |
| Wireframe figures | Up to 4 human skeletons with joint pulsation synced to breathing |
| Signal field | Volumetric WiFi wave visualization |
| Live HUD | Heart rate, breathing rate, confidence, RSSI, motion level |
| Auto-detect | Automatically connects to live ESP32 data when sensing server is running |
| Scenario cycling | 6 preset scenarios with smooth transitions (demo mode) |

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `1-6` | Switch scenario |
| `A` | Toggle auto-cycle |
| `P` | Pause/resume |
| `S` | Open settings |
| `R` | Reset camera |

**Live data auto-detect:** When served by the sensing server, the Observatory probes `/health` on the same origin and automatically connects via WebSocket. The HUD badge switches from `DEMO` to `LIVE`. No configuration needed.

---

<a id="loading-the-pretrained-model-from-hugging-face"></a>
## Loading the Pretrained Model from Hugging Face

A pretrained CSI encoder + presence-detection head is published on Hugging Face at [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained). It was trained on 60,630 frames / 610,615 contrastive triplets (12.2M steps, final loss 0.065) and reports **82.3% held-out temporal-triplet accuracy** (the older "100% presence" figure was measured on a single-class recording and has been retracted) and ~164k embeddings/sec on an Apple M4 Pro.

> **Results & proof.** The SOTA 17-keypoint pose model is published separately at [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose) — **82.69% torso-PCK@20** on MM-Fi (83.59% ensemble + TTA), beating MultiFormer (72.25%) and CSI2Pose (68.41%). Browse the auditable [AetherArena leaderboard Space](https://huggingface.co/spaces/ruvnet/aether-arena), the full [MM-Fi study](benchmarks/mmfi-wifi-sensing-study.md), and the [efficiency frontier](benchmarks/wifi-pose-efficiency-frontier.md). Reproduce the deterministic pipeline proof with `python archive/v1/data/proof/verify.py` (must print `VERDICT: PASS`; see [ADR-168 benchmark proof](adr/ADR-168-benchmark-proof.md) and [WITNESS-LOG-028](WITNESS-LOG-028.md)).

What it ships (and what it does not):

| Capability | Status |
|------------|--------|
| Presence detection (occupied / empty) | ✅ Trained head — v2 encoder reports 82.3% held-out temporal-triplet acc (v1's "100% on validation" was a single-class recording — retracted, [#882](https://github.com/ruvnet/RuView/issues/882)) |
| 128-dim CSI embeddings (re-ID, similarity, downstream training) | ✅ Trained encoder |
| Single-person breathing / heart-rate | ⚠️ Server still uses heuristic DSP — model does not replace this yet |
| 17-keypoint full-body pose | 🔬 This HF bundle ships no keypoint head — but real pose weights exist elsewhere; see the tier table below |

### Model weights: what's real, what's not

"WiFi → pose" means three different things in this repo, at three different maturity
levels. Read the label, not the headline ([ADR-187](adr/ADR-187-archive-v1-deprecation-honest-labeling.md)):

| Tier | Checkpoint(s) | Honest status |
|------|---------------|---------------|
| **Real & validated** | [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained) (encoder + presence head) · [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose) (17-keypoint pose) · `cog-person-count/count_v1` | **MEASURED / published.** Presence = 82.3% held-out temporal-triplet accuracy (the old "100% presence" figure was retracted); MM-Fi pose = 82.69% torso-PCK@20 on the `random_split` protocol. |
| **Real but weak (honestly labeled)** | committed `v2/crates/cog-pose-estimation/cog/artifacts/pose_v1.safetensors` | First-cut on-device model. **PCK@20 = 3.0% / PCK@50 = 18.5%** on a 217-sample holdout — **below the ADR-079 target of ≥ 35%.** Learns coarse structure (`r_hip` 77% PCK@50); distal/face joints near-random. Its runtime path in `cog-pose-estimation/src/inference.rs` is still a centred-skeleton **stub returning `confidence=0`**. Full disclosure in the [cog README](../v2/crates/cog-pose-estimation/cog/README.md). Do not advertise the live single-ESP32 17-keypoint feature without this caveat. |
| **Architecture only, no weights** | `archive/v1` `DensePoseHead` | Random `kaiming_normal_` init, **no checkpoint of any kind** (zero `.pth`/`.onnx`/`.safetensors` files under `archive/v1/`). Deprecated and superseded — see [`archive/v1/DEPRECATED.md`](../archive/v1/DEPRECATED.md). Do not expect real pose output from it. |

**Does it actually run, and can a single ESP32 do pose? ([#509](https://github.com/ruvnet/RuView/issues/509), [#1125](https://github.com/ruvnet/RuView/issues/1125))** Yes, it runs, and the results are reproducible: the deterministic signal-pipeline proof (`python archive/v1/data/proof/verify.py`, must print `VERDICT: PASS`), the committed pose training dump (`v2/crates/cog-pose-estimation/cog/artifacts/train_results.json`), and the auditable MM-Fi arena all back specific numbers. But a single-antenna, 56-subcarrier CSI stream at a 20-frame window does *not* carry the fine-grained spatial information the multi-antenna NIC research relies on — so the shippable pose accuracy the project stands behind today is the **MM-Fi benchmark number**, not a live single-ESP32 number. The path to a first reproducible on-device baseline (PCK@20 ≥ 35%) is tracked in [ADR-079](adr/ADR-079-camera-ground-truth-training.md) / [#645](https://github.com/ruvnet/RuView/issues/645).

<a id="model-and-capture-compatibility"></a>
### Model and capture compatibility

These artifacts share a pose objective, but not an input contract or adapter format. A checkpoint
is usable only when capture preprocessing, tensor shape, architecture, and runtime all match.

| Artifact/path | Required input | Measured status | Live ESP32 compatibility |
|---------------|----------------|-----------------|--------------------------|
| MM-Fi flagship and `micro` transformer | `[N,3,114,10]` amplitude | **MEASURED** on MM-Fi `random_split`; calibration reference is Python `.npz` LoRA | No direct S3/C6 path is validated; resampling a 56-tone SISO stream does not recreate three-antenna MM-Fi input |
| Cog `pose_v1.safetensors` | `[N,56,20]` amplitude | **MEASURED** PCK@20 = 3.0%, below the ≥35% target; cog-format LoRA is `.safetensors` | Shape matches the canonical window, but the documented live runtime remains below-target/stub and is not a reliable pose claim |
| Viewer `heuristic_pose_from_amplitude` | live canonical amplitude | Skeleton-layout placeholder, not a trained pose model | Renders a demonstrator skeleton only; it is not pose accuracy evidence |
| MERIDIAN automatic unlabeled calibration | proposed ~200-frame target-room capture | **PROPOSED** in ADR-027; no validated end-to-end command | Not available. The current calibration tools require paired CSI/keypoint labels and model-specific inputs |

Calibration files are not interchangeable: `calibrate.py` targets the MM-Fi transformer, while
`cog_calibrate.py` targets the cog conv+MLP. See the
[calibration reference](../aether-arena/calibration/README.md) for their exact schemas.

### Download

```bash
pip install huggingface_hub
huggingface-cli download ruvnet/wifi-densepose-pretrained \
    --local-dir models/wifi-densepose-pretrained
```

The download yields a small set of files (the `.rvf.jsonl` is the canonical container the sensing server reads):

```
models/wifi-densepose-pretrained/
  model.rvf.jsonl       # RVF container (encoder + presence head + lora)
  model.safetensors     # 48 KB — same encoder weights, safetensors format
  model-q4.bin          # 8 KB — recommended quantization for edge
  presence-head.json    # presence classifier head
  config.json           # sona-lora rank=8 alpha=16, target encoder + task_heads
```

### Using the weights

The HF artifact is in **JSONL RVF** format (one JSON object per line: `metadata`, `encoder`, `lora`). What you can do with it today:

| Consumer | Format it reads | Status |
|----------|-----------------|--------|
| Python / PyTorch training pipeline | `model.safetensors` | ✅ Works — load with `safetensors.torch.load_file` |
| RVF JSONL inspection / re-export | `model.rvf.jsonl` | ✅ Works — plain JSONL, parse line-by-line |
| Sensing-server `--model <PATH>` flag | binary RVF (`RVFS` magic) | ⚠️ Does **not** accept the JSONL file yet — see gap below |

**Known gap (tracked):** `v2/crates/wifi-densepose-sensing-server/src/rvf_container.rs` only parses the binary RVF segment format (magic `0x52564653`). Pointing `--model` at `model.rvf.jsonl` causes the progressive loader to error with `invalid magic at offset 0: expected 0x52564653, got 0x7974227B` (`0x7974227B` is the ASCII bytes `{"ty…` from the JSONL header), and the live pipeline degrades to null output rather than falling back to heuristic mode. Until a JSONL adapter lands (or the model is re-published as binary RVF), run the sensing-server **without** `--model` and consume the HF weights from Python or the training pipeline.

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

See [RVF Model Containers](#rvf-model-containers) for the binary format the loader expects, and [Training a Model](#training-a-model) for using the encoder as a starting point for environment-specific fine-tuning.

---

<a id="adaptive-classifier"></a>
## Adaptive Classifier

The adaptive classifier (ADR-048) learns your environment's specific WiFi signal patterns from labeled recordings. It replaces static threshold-based classification with a trained logistic regression model that uses 15 features (7 server-computed + 8 subcarrier-derived statistics).

### Signal Smoothing Pipeline

All CSI-derived metrics pass through a three-stage pipeline before reaching the UI:

| Stage | What It Does | Key Parameters |
|-------|-------------|----------------|
| **Adaptive baseline** | Learns quiet-room noise floor, subtracts drift | α=0.003, 50-frame warm-up |
| **EMA + median filter** | Smooths motion score and vital signs | Motion α=0.15; Vitals: 21-frame trimmed mean, α=0.02 |
| **Hysteresis debounce** | Prevents rapid state flickering | 4 frames (~0.4s) required for state transition |

Vital signs use additional stabilization:

| Parameter | Value | Effect |
|-----------|-------|--------|
| HR dead-band | ±2 BPM | Prevents micro-drift |
| BR dead-band | ±0.5 BPM | Prevents micro-drift |
| HR max jump | 8 BPM/frame | Rejects noise spikes |
| BR max jump | 2 BPM/frame | Rejects noise spikes |

<a id="recording-training-data"></a>
### Recording Training Data

Record labeled CSI sessions while performing distinct activities. Each recording captures full sensing frames (features + raw subcarrier amplitudes) at ~10-25 FPS.

```bash
# 1. Record empty room (leave the room for 30 seconds)
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_empty_room"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop

# 2. Record sitting still (sit near ESP32 for 30 seconds)
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_sitting_still"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop

# 3. Record walking (walk around the room for 30 seconds)
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_walking"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop

# 4. Record active movement (jumping jacks, arm waving for 30 seconds)
curl -X POST http://localhost:3000/api/v1/recording/start \
  -H "Content-Type: application/json" -d '{"id":"train_active"}'
# ... wait 30 seconds ...
curl -X POST http://localhost:3000/api/v1/recording/stop
```

Recordings are saved as JSONL files in `recordings/` under the server's `--data-dir` (default `data`, so `data/recordings/` relative to the directory the server was started from). Filenames must start with `train_` and contain a class keyword:

| Filename pattern | Class |
|-----------------|-------|
| `*empty*` or `*absent*` | absent |
| `*still*` or `*sitting*` | present_still |
| `*walking*` or `*moving*` | present_moving |
| `*active*` or `*exercise*` | active |

<a id="training-the-model"></a>
### Training the Model

Train the adaptive classifier from your labeled recordings:

```bash
curl -X POST http://localhost:3000/api/v1/adaptive/train
```

The server trains a multiclass logistic regression on 15 features using mini-batch SGD (200 epochs). Training completes in under 1 second for typical recording sets. The trained model is saved to `adaptive_model.json` in the `--data-dir` (default `data/adaptive_model.json`) and automatically loaded on server restart.

**Check model status:**

```bash
curl http://localhost:3000/api/v1/adaptive/status
```

**Unload the model (revert to threshold-based classification):**

```bash
curl -X POST http://localhost:3000/api/v1/adaptive/unload
```

<a id="using-the-trained-model"></a>
### Using the Trained Model

Once trained, the adaptive model runs automatically:

1. Each CSI frame is classified using the learned weights instead of static thresholds
2. Model confidence is blended with smoothed threshold confidence (70/30 split)
3. The model persists across server restarts (loaded from `<data-dir>/adaptive_model.json`)

**Tips for better accuracy:**

- Record with clearly distinct activities (actually leave the room for "empty")
- Record 30-60 seconds per activity (more data = better model)
- Re-record and retrain if you move the ESP32 or rearrange the room
- The model is environment-specific — retrain when the physical setup changes

### Adaptive Classifier API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/adaptive/train` | Train from `train_*` recordings |
| `GET` | `/api/v1/adaptive/status` | Model status, accuracy, class stats |
| `POST` | `/api/v1/adaptive/unload` | Unload model, revert to thresholds |
| `POST` | `/api/v1/recording/start` | Start recording CSI frames |
| `POST` | `/api/v1/recording/stop` | Stop recording |
| `GET` | `/api/v1/recording/list` | List recordings |

---

<a id="world-model-prediction-occworld"></a>
## World Model Prediction (OccWorld)

RuView integrates [OccWorld](https://github.com/wzzheng/OccWorld) (ECCV 2024) to predict
future 3D occupancy from WiFi CSI — extending the Kalman tracker's 5-frame horizon to
15 predicted frames (~7 s). See [ADR-147](adr/ADR-147-nvidia-cosmos-world-foundation-model-integration.md)
and the [benchmark proof](adr/ADR-168-benchmark-proof.md) for full details.

**Hardware requirement:** NVIDIA GPU with ≥4 GB VRAM (validated: RTX 5080 at 209 ms / 3.4 GB).

**Start the inference server:**
```bash
# Requires ml-env with PyTorch 2.7+ and mmcv/mmdet3d installed (see ADR-147 §3)
~/ml-env/bin/python3 scripts/occworld_server.py /tmp/occworld.sock
```

The Rust crate `wifi-densepose-worldmodel` connects over that Unix socket and injects
trajectory priors into the pose tracker automatically when the server is running.

**Accumulate training data and fine-tune for your space (improves prediction accuracy):**
```bash
# 1. Record WorldGraph snapshots while people move through the space (~1 hour minimum)
python3 scripts/occworld_retrain.py record \
    --server http://localhost:8080 \
    --out-dir /tmp/snapshots/scene_live \
    --duration 3600

# 2. Fine-tune VQVAE tokenizer on indoor occupancy
python3 scripts/occworld_retrain.py vqvae \
    --snapshots /tmp/snapshots/ \
    --work-dir out/ruview_vqvae

# 3. Fine-tune autoregressive transformer
python3 scripts/occworld_retrain.py transformer \
    --snapshots /tmp/snapshots/ \
    --vqvae-checkpoint out/ruview_vqvae/latest.pth \
    --work-dir out/ruview_occworld

# 4. Restart the server with your checkpoint
~/ml-env/bin/python3 scripts/occworld_server.py /tmp/occworld.sock out/ruview_occworld/latest.pth
```

`scripts/ruview_occ_dataset.py` is the domain adapter used internally by the retraining
pipeline — it converts WorldGraph JSON snapshots to OccWorld-format tensors with indoor
class remapping and zero ego-poses. See ADR-147 Phase 3 for details.

---

<a id="training-a-model"></a>
## Training a Model

The training pipeline is implemented in pure Rust (7,832 lines, zero external ML dependencies).

### Step 1: Obtain a Dataset

The system supports two public WiFi CSI datasets:

| Dataset | Source | Format | Subjects | Environments | Download |
|---------|--------|--------|----------|-------------|----------|
| [MM-Fi](https://ntu-aiot-lab.github.io/mm-fi) | NeurIPS 2023 | `.npy` | 40 | 4 rooms | [GitHub repo](https://github.com/ybhbingo/MMFi_dataset) (Google Drive / Baidu links inside) |
| [Wi-Pose](https://github.com/NjtechCVLab/Wi-PoseDataset) | Entropy 2023 | `.mat` | 12 | 1 room | [GitHub repo](https://github.com/NjtechCVLab/Wi-PoseDataset) (Google Drive / Baidu links inside) |

Download the dataset files and place them in a `data/` directory.

### Step 2: Train

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

The pipeline runs 10 phases:
1. Dataset loading (MM-Fi `.npy` or Wi-Pose `.mat`)
2. Hardware normalization (Intel 5300 / Atheros / ESP32 -> canonical 56 subcarriers)
3. Subcarrier resampling (114->56 or 30->56 via Catmull-Rom interpolation)
4. Graph transformer construction (17 COCO keypoints, 16 bone edges)
5. Cross-attention training (CSI features -> body pose)
6. Experimental domain-adversarial components (MERIDIAN research modules; not a validated automatic deployment path)
7. Composite loss optimization (MSE + CE + UV + temporal + bone + symmetry)
8. SONA adaptation (micro-LoRA + EWC++)
9. Sparse inference optimization (hot/cold neuron partitioning)
10. RVF model packaging

### Step 3: Use the Trained Model

```bash
./target/release/sensing-server --model model.rvf --progressive --source esp32 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>
```

Progressive loading enables instant startup (Layer A loads in <5ms with basic inference), with full model loading in the background.

### Cross-Environment Adaptation (MERIDIAN)

Models trained in one room can lose substantial accuracy in a new room because the multipath
distribution changes. ADR-027 proposes an automatic adaptation design, and the Rust tree contains
individual research components, but RuView does **not** currently provide a validated command that
turns ~200 unlabeled frames into a working room adapter.

Current, testable calibration is the separate **labeled** reference in
`aether-arena/calibration/`: collect paired CSI/keypoint samples, then fit a model-specific LoRA
adapter. The MM-Fi transformer expects `[N,3,114,10]`; the cog expects `[N,56,20]`. Neither adapter
loads into the other model, and neither result establishes live ESP32 pose accuracy without a
leakage-free held-out capture and mean-pose baseline.

ADR-027 research components:

| Component | What it does |
|-----------|-------------|
| Hardware Normalizer | Resamples any WiFi chipset to canonical 56 subcarriers |
| Domain Factorizer | Separates pose-relevant from room-specific features |
| Geometry Encoder | Encodes AP positions (FiLM conditioning with DeepSets) |
| Virtual Augmentor | Generates synthetic environments for robust training |
| Rapid Adaptation | Proposed unlabeled contrastive TTT; not wired as a validated deployment workflow |

See [ADR-027](adr/ADR-027-cross-environment-domain-generalization.md) for the full design.

<a id="crv-signal-line-protocol"></a>
### CRV Signal-Line Protocol

The CRV (Coordinate Remote Viewing) signal-line protocol (ADR-033) maps a 6-stage cognitive sensing methodology onto WiFi CSI processing. This enables structured anomaly classification and multi-person disambiguation.

| Stage | CRV Term | WiFi Mapping |
|-------|----------|-------------|
| I | Gestalt | Detrended autocorrelation → periodicity / chaos / transient classification |
| II | Sensory | 6-modality CSI feature encoding (texture, temperature, luminosity, etc.) |
| III | Topology | AP mesh topology graph with link quality weights |
| IV | Coherence | Phase phasor coherence gate (Accept/PredictOnly/Reject/Recalibrate) |
| V | Interrogation | Person-specific signal extraction with targeted subcarrier selection |
| VI | Partition | Multi-person partition with cross-room convergence scoring |

```bash
# Enable CRV in your Cargo.toml
cargo add wifi-densepose-ruvector --features crv
```

See [ADR-033](adr/ADR-033-crv-signal-line-sensing-integration.md) for the full design.

---

<a id="rvf-model-containers"></a>
## RVF Model Containers

The RuVector Format (RVF) packages a trained model into a single self-contained binary file.

### Export

```bash
./target/release/sensing-server --export-rvf model.rvf
```

### Load

```bash
./target/release/sensing-server --model model.rvf --progressive
```

### Contents

An RVF file contains: model weights, HNSW vector index, quantization codebooks, SONA adaptation profiles, Ed25519 training proof, and vital sign filter parameters.

### Deployment Targets

| Target | Quantization | Size | Load Time |
|--------|-------------|------|-----------|
| ESP32 / IoT | int4 | ~0.7 MB | <5ms |
| Mobile / WASM | int8 | ~6-10 MB | ~200-500ms |
| Field (WiFi-Mat) | fp16 | ~62 MB | ~2s |
| Server / Cloud | f32 | ~50+ MB | ~3s |

---

## Perception Certificate Spine (Developer Preview, ADR-300)

RuView's perception substrate program (ADR-300) is building a `signal → observation →
calibration → inference → uncertainty → evidence → certificate → policy → governed
action` pipeline, where a downstream consumer either gets a calibrated, provenance-backed
answer or an explicit `UNKNOWN` — never a confident-looking guess outside the sensor's
proven operating envelope.

**Status: developer preview, now wired at the crate level.** Phase 1 shipped nine new
crates. `ruview-certify` and `ruview-policy` now depend on `ruview-ood` and provide a
real adapter (`impl From<ruview_ood::DomainState> for _`) plus a composed entry point,
`ruview_policy::authorize_from_certificate`, that takes a real signed
`CapabilityCertificate` and a real `ruview_ood::DomainState` and drives them through
`authorize()` — not a hand-built `AssuranceInputs`. A cross-crate integration test
(`ruview-policy`'s `acceptance_test_b_real_integration` module) mints an actual signed
certificate and proves a real post-drift `Unknown` denies a `SafetyCritical` action
through that one composed pipeline.

**What's still not done:** none of this runs automatically inside the live
`sensing-server` request path yet — there is no continuous calibration/OOD-monitoring
loop wired into the running server that calls this pipeline on live sensor data. Treat
`authorize_from_certificate` as a real, tested library entry point you can call from your
own integration today, not something the server invokes for you on every request yet.
That remaining step is a genuinely separate, larger effort (deciding polling cadence,
where calibration state lives, what triggers re-certification) — see ADR-300 for the
phased plan.

### The crates

| Crate | Role |
|---|---|
| `ruview-ontology` | Canonical `Site → … → Event` types |
| `ruview-attest` | Signed measurement / RF chain-of-custody |
| `ruview-evidence` | Append-only per-context ledger (no pooling, no evidence upgrade) |
| `wifi-densepose-calibration` | Signed, drift-invalidatable calibration certificate |
| `ruview-ood` | `Known` / `Degraded` / `Unknown` staleness-guard domain gating |
| `ruview-witness` | Hash-linked staged provenance chain |
| `ruview-certify` | Capability certificate, conditional on a live domain signature |
| `ruview-scorecard` | Multi-domain scorecard, worst-domain promotion gate |
| `ruview-policy` | Fail-closed action authorization gate |

### Minting and checking a certificate

```rust
use ruview_certify::{mint, CapabilityCertificate, DomainState};

// `signer`, `request`, and `evidence_slice` come from your own calibration run —
// see each crate's README for how to build them.
let cert = mint(&signer, request, &evidence_slice)?;

// A certificate is only valid at a given instant AND domain state — the same
// signed certificate is rejected the moment the live domain degrades:
assert!(cert.is_valid(now_ms, DomainState::Known));
assert!(!cert.is_valid(now_ms, DomainState::Degraded));
assert!(!cert.is_valid(now_ms, DomainState::Unknown));
```

### Gating an action from a real certificate + a real OOD reading

```rust
use ruview_policy::authorize_from_certificate;

// `cert` (ruview_certify::CapabilityCertificate) and `domain`
// (ruview_ood::DomainState) come from your own certify/OOD calls.
let decision = authorize_from_certificate(
    ActionClass::SafetyCritical,
    &cert, &verifier, now_unix_s, domain,
    certificate_class, uncertainty, evidence_level,
);
// Deny with a named FailedCondition (e.g. DomainNotKnown) — not a silent
// false-positive — the moment `domain` degrades, even though `cert` itself
// is still validly signed and unexpired.
```

`ruview_certify::DomainState` and `ruview_policy::DomainState` are still each their own
type (`ruview-ood`'s `Degraded`/`Unknown` additionally carry a `DomainCause`), but the
conversion between them is no longer something you have to write yourself —
`authorize_from_certificate` does it via the crates' own `From<ruview_ood::DomainState>`
impls.

### What's genuinely enforced today, for comparison

Not every ADR-295–296 remediation item is preview-only. Three are live now:

- **UDP data-plane bind hardening (ADR-296)** — `sensing-server`'s `UdpSourceAllowlist`
  is checked on every incoming packet (`main.rs`), not just defined.
- **CSI data-incident repo controls (ADR-299)** — `scripts/csi-data-policy-check.sh`
  runs in CI on every push/PR and fails the build on a policy violation.
- **Synthetic-export watermarking (ADR-295)** — `start_recording` stamps a `SYNTHETIC`
  watermark on a recording's metadata (`GET /api/v1/recordings`, the start-recording
  response) whenever it captures while the live source is synthetic — an operator
  browsing or scripting against recordings can't mistake generated data for a capture.

---

<a id="hardware-setup"></a>
## Hardware Setup

### Supported targets

| Target | Use case | Source target flag | Notes |
|---|---|---|---|
| **ESP32-S3** (default) | Production CSI capture mesh; presence/motion/vital heuristics | `idf.py set-target esp32s3` | Dual-core 240 MHz, PSRAM, native USB-OTG, DVP camera path; live 17-keypoint pose is not validated |
| **ESP32-C6** ([ADR-110](adr/ADR-110-esp32-c6-firmware-extension.md)) | Wi-Fi 6 / 802.15.4 research, battery seed nodes | `idf.py set-target esp32c6` | Single-core 160 MHz, no PSRAM, 802.11ax HE PHY, 802.15.4 (Thread/Zigbee), LP-core hibernation ~5 µA |

The same `firmware/esp32-csi-node` source tree builds for both. ESP-IDF picks up `sdkconfig.defaults.esp32c6` automatically when the target is set to `esp32c6`; otherwise it uses `sdkconfig.defaults` (S3). All C6-only modules are `#ifdef`-gated, so the S3 build is byte-identical to today.

<a id="esp32-s3-mesh"></a>
### ESP32-S3 Mesh

A 3-6 node ESP32-S3 mesh provides full CSI at 20 Hz. Total cost: ~$54 for a 3-node setup.

**What you need:**
- 3-6x ESP32-S3 development boards (~$8 each)
- A WiFi router (the CSI source)
- A computer running the sensing server (aggregator)

**Flashing firmware:**

Use versioned bundles from [Releases](https://github.com/ruvnet/RuView/releases),
not the historical binaries in `firmware/esp32-csi-node/release_bins/`.
The 0.8.16 prerelease adds conservative MR60BHA2 identification to the prior
USB identity, OTA provisioning, and CSI reliability fixes.
It has CI build/host-test coverage; new physical-board qualification remains
pending. The previous stable firmware is 0.8.8.

| Release | What It Includes | Tag |
|---------|-----------------|-----|
| [v0.8.16](https://github.com/ruvnet/RuView/releases/tag/v0.8.16-esp32) | **Prerelease:** conservative MR60BHA2 identification; CI/host-test coverage, without new physical firmware qualification | `v0.8.16-esp32` |
| [v0.8.14](https://github.com/ruvnet/RuView/releases/tag/v0.8.14-esp32) | **Prerelease:** corrected C6 base-MAC identity, OTA key provisioning without a host key cache; physical qualification pending | `v0.8.14-esp32` |
| [v0.8.8](https://github.com/ruvnet/RuView/releases/tag/v0.8.8-esp32) | Previous stable firmware: consistent occupancy and rate-aware C6 processing; see [release evidence](releases/v0.8.8-esp32.md) | `v0.8.8-esp32` |
| [v0.7.0](https://github.com/ruvnet/RuView/releases/tag/v0.7.0-esp32) | Historical ADR-110 firmware-side substrate: ESP-NOW synchronization and sync-packet UDP emission ([WITNESS-LOG-110 §A0.7-§A0.13](WITNESS-LOG-110.md)) | `v0.7.0-esp32` |
| [v0.6.9](https://github.com/ruvnet/RuView/releases/tag/v0.6.9-esp32) | Sync-packet UDP emission, `CONFIG_C6_SYNC_EVERY_N_FRAMES` tunable cadence | `v0.6.9-esp32` |
| [v0.6.8](https://github.com/ruvnet/RuView/releases/tag/v0.6.8-esp32) | ESP-NOW EMA-smoothed cross-board offset (3.95× suppression, 104 µs stdev) | `v0.6.8-esp32` |
| [v0.6.7](https://github.com/ruvnet/RuView/releases/tag/v0.6.7-esp32) | Real LP-core motion-gate RISC-V program (B4 code path complete) + Wi-Fi 6 soft-AP with TWT Responder for two-board iTWT benches (B1/B2 unblock) | `v0.6.7-esp32` |
| [v0.5.0](https://github.com/ruvnet/RuView/releases/tag/v0.5.0-esp32) | Historical S3 mesh release — mmWave sensor fusion (MR60BHA2/LD2410 auto-detect), 48-byte fused vitals, all v0.4.3.1 fixes | `v0.5.0-esp32` |
| [v0.4.3.1](https://github.com/ruvnet/RuView/releases/tag/v0.4.3.1-esp32) | Fall detection fix ([#263](https://github.com/ruvnet/RuView/issues/263)), 4MB flash ([#265](https://github.com/ruvnet/RuView/issues/265)), watchdog fix ([#266](https://github.com/ruvnet/RuView/issues/266)) | `v0.4.3.1-esp32` |
| [v0.4.1](https://github.com/ruvnet/RuView/releases/tag/v0.4.1-esp32) | CSI build fix, compile guard, AMOLED display, edge intelligence ([ADR-057](../docs/adr/ADR-057-firmware-csi-build-guard.md)) | `v0.4.1-esp32` |
| [v0.3.0-alpha](https://github.com/ruvnet/RuView/releases/tag/v0.3.0-alpha-esp32) | Alpha — adds on-device edge intelligence (ADR-039) | `v0.3.0-alpha-esp32` |
| [v0.2.0](https://github.com/ruvnet/RuView/releases/tag/v0.2.0-esp32) | Raw CSI streaming, TDM, channel hopping, QUIC mesh | `v0.2.0-esp32` |

For 0.8.14, select the correct archive, verify its release `SHA256SUMS.txt`,
extract into a separate directory, then verify the enclosed checksums:

| Archive | Board configuration |
|---------|---------------------|
| `esp32-csi-node-firmware-8mb.tar.gz` | ESP32-S3 display build, 8 MB flash |
| `esp32-csi-node-firmware-4mb.tar.gz` | ESP32-S3 headless build, 4 MB layout |
| `esp32-csi-node-firmware-c6-4mb.tar.gz` | ESP32-C6 research target, 4 MB layout |

Bare 8 MB DevKitC boards need the source `sdkconfig.defaults.devkitc` overlay;
do not use the display build. See the [firmware guide](../firmware/esp32-csi-node/README.md#0-download-a-versioned-firmware-bundle)
for board selection, C6 filenames, backup and OTA guidance.

```bash
# From the extracted ESP32-S3 display / 8 MB bundle:
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 8MB --flash-freq 80m \
  0x0 bootloader.bin 0x8000 partition-table.bin \
  0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin
```

**4 MB headless S3 boards:** use the matching application and partition table
from `esp32-csi-node-firmware-4mb.tar.gz` on the
[0.8.16 prerelease](https://github.com/ruvnet/RuView/releases/tag/v0.8.16-esp32)
and select `--flash-size 4MB`:

```bash
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 4MB --flash-freq 80m \
  0x0 bootloader.bin 0x8000 partition-table-4mb.bin \
  0xF000 ota_data_initial.bin 0x20000 esp32-csi-node-4mb.bin
```

**Provisioning:**

```bash
python firmware/esp32-csi-node/provision.py --port COM7 \
  --ssid "YourWiFi" --password "YourPassword" --target-ip 192.168.1.20
```

Replace `192.168.1.20` with the IP of the machine running the sensing server.
To enable authenticated OTA updates, add `--ota-psk-file` with a private
64-hex key file. The key must be resupplied on later NVS writes; it is never
cached in host state. See [OTA key provisioning](../firmware/esp32-csi-node/README.md#ota-key-provisioning).

**Mesh key provisioning:** ADR-032 describes giving every node in a multistatic mesh a shared mesh key, but that isn't wired up yet. `provision.py` has no `--mesh-key` option and the firmware doesn't read a mesh key from NVS, so there's nothing to provision for now.

### ESP32-C6 (Wi-Fi 6 + 802.15.4 research target — ADR-110)

The C6 build adds four capabilities to the existing csi-node firmware, all opt-in via `idf.py menuconfig → ESP32-C6 capabilities (ADR-110)`:

| Capability | Kconfig | What it does |
|---|---|---|
| **Wi-Fi 6 HE-LTF tagging** | `CSI_FRAME_HE_TAGGING` (default on) | Each ADR-018 frame's previously-reserved bytes 18-19 now carry PPDU type (HT / HE-SU / HE-MU / HE-TB) + bandwidth flags. Magic stays `0xC5110001` — old aggregators see zeros and ignore. |
| **802.15.4 mesh time-sync** | `C6_TIMESYNC_ENABLE` (default on, channel 15) | Beacon-based cross-node clock alignment over the 802.15.4 radio. Frees the WiFi channel from coordination traffic — solves the ADR-029/030 multistatic clock-sync problem. |
| **TWT (Target Wake Time)** | `C6_TWT_ENABLE` (default on, 10 ms wake interval) | After WiFi connect, negotiates an individual TWT agreement with the AP for deterministic CSI cadence. Graceful NACK fallback if the AP doesn't support 11ax TWT. |
| **LP-core wake-on-motion hibernation** | `C6_LP_CORE_ENABLE` (default off) | Always-on motion gate on the LP RISC-V core; HP core stays in deep sleep until the configured GPIO wakes it. Targets ~5 µA for battery-powered Cognitum Seed nodes. |

**Build + flash:**

```bash
cd firmware/esp32-csi-node
idf.py set-target esp32c6
idf.py build                    # ~1.0 MB binary, 46% partition slack on 4 MB flash
idf.py -p COM6 flash
# Then provision the same way as S3 (provision.py works for both targets):
python provision.py --port COM6 --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20
```

**Verifying the C6 modules came up** — `idf.py -p COM6 monitor` should show:

```
I (353) main: ESP32-C6 CSI Node (ADR-018 / ADR-110) — v0.6.7 — Node ID: 1
I (413) c6_ts: init done: channel=15 EUI=<your-EUI64> leader=yes(candidate)
I (463) wifi: mac_version:HAL_MAC_ESP32AX_761      ← 802.11ax MAC firmware loaded
```

The `c6_ts: init done` line confirms the 802.15.4 stack is up; if TWT succeeds you'll also see an `iTWT setup event received from AP` line after the WiFi connect completes.

**Multi-room time-aligned multistatic capture (preview):**

Flash two or more C6 boards, leave them on the same 802.15.4 channel (default 15). One will elect itself leader (lowest EUI-64) and broadcast `TS_BEACON` frames every 100 ms; the others compute and apply offsets. Each CSI frame from a follower carries a `c6_timesync_get_epoch_us()` wall-clock estimate aligned to within ±100 µs of the leader's monotonic time. Target use case: ADR-029/030 multistatic fusion without burning WiFi airtime on coordination.

**Battery seed-node mode (v0.6.7 — real LP-core program):**

```bash
# Enable LP-core hibernation in menuconfig:
#   ESP32-C6 capabilities (ADR-110) → Enable LP-core wake-on-motion hibernation
#   → LP-core wake GPIO (default 4 — connect a PIR or accelerometer INT line here)
#   → LP-core poll period (default 10 ms)
#   → LP-core debounce sample count (default 3 consecutive matches)
idf.py menuconfig
idf.py build flash
```

When enabled, the C6 LP RISC-V coprocessor runs a real polling program
(`firmware/esp32-csi-node/main/lp_core/main.c`) that polls the wake GPIO at
the configured cadence, debounces N consecutive matching reads, and wakes the
HP core via `ulp_lp_core_wakeup_main_processor()`. `esp_sleep_get_wakeup_cause()`
returns `ESP_SLEEP_WAKEUP_ULP`, and `c6_lp_core_motion_count()` /
`c6_lp_core_poll_count()` expose the LP-side counters for the witness harness.
Target standby current ~5 µA (datasheet; pending INA measurement).

**Two-board iTWT bench (v0.6.7 — soft-AP HE/TWT, no router required):**

Pair two C6 boards — one acts as the iTWT-capable AP, the other as the STA
that negotiates and benchmarks the TWT agreement.

```bash
# Board #1 (AP role): append to sdkconfig.defaults.esp32c6:
CONFIG_C6_SOFTAP_HE_ENABLE=y
CONFIG_C6_SOFTAP_HE_SSID="ruview-c6-twt"
CONFIG_C6_SOFTAP_HE_PSK="ruviewtwt"
CONFIG_C6_SOFTAP_HE_CHANNEL=6

idf.py set-target esp32c6 && idf.py build && idf.py -p COM6 flash
```

Board #1 boots in `WIFI_MODE_APSTA`, advertising HE capabilities and TWT
Responder=1 on channel 6. Board #2 provisions to associate with that SSID:

```bash
python firmware/esp32-csi-node/provision.py --port COM9 \
  --ssid "ruview-c6-twt" --password "ruviewtwt" --target-ip 192.168.1.20
```

Board #2 runs the existing `c6_twt_setup_default()` on connect and now
negotiates a real iTWT agreement against the cooperative AP — the
`iTWT setup queued: wake_interval=10000 µs` log line should be followed by an
`iTWT setup event received from AP` instead of the `INVALID_ARG` graceful
fallback that fired against the bench's 11n-only `ruv.net` AP.

NVS overrides for AP role (namespace `ruview`): `softap_ssid`, `softap_psk`,
`softap_chan` — provision once and the values survive firmware updates.

**What's NOT on the C6 build** (vs S3 production): no AMOLED display (ADR-045 needs 8 MB + LCD touch driver), no WASM3 (ADR-040 needs PSRAM), no Seeed mmWave fusion (separate board). The C6 is a research/seed target, not a drop-in replacement for the S3 production node.

**TDM slot assignment:**

Each node in a multistatic mesh needs a unique TDM slot ID (0-based):

```bash
# Node 0 (slot 0) — first transmitter
python firmware/esp32-csi-node/provision.py --port COM7 --tdm-slot 0 --tdm-total 3

# Node 1 (slot 1)
python firmware/esp32-csi-node/provision.py --port COM8 --tdm-slot 1 --tdm-total 3

# Node 2 (slot 2)
python firmware/esp32-csi-node/provision.py --port COM9 --tdm-slot 2 --tdm-total 3
```

**Edge Intelligence (v0.3.0-alpha, [ADR-039](../docs/adr/ADR-039-esp32-edge-intelligence.md)):**

The v0.3.0-alpha firmware adds on-device signal processing that runs directly on the ESP32-S3 — no host PC needed for basic presence and vital signs. Edge processing is disabled by default for full backward compatibility.

| Tier | What It Does | Extra RAM |
|------|-------------|-----------|
| **0** | Disabled (default) — streams raw CSI to the aggregator | 0 KB |
| **1** | Phase unwrapping, running statistics, top-K subcarrier selection, delta compression | ~30 KB |
| **2** | Everything in Tier 1, plus presence detection, breathing/heart rate, motion scoring, fall detection | ~33 KB |

Enable via NVS (no reflash needed):

```bash
# Enable Tier 2 (full vitals) on an already-flashed node
python firmware/esp32-csi-node/provision.py --port COM7 \
  --ssid "YourWiFi" --password "YourPassword" --target-ip 192.168.1.20 \
  --edge-tier 2
```

Key NVS settings for edge processing:

| NVS Key | Default | What It Controls |
|---------|---------|-----------------|
| `edge_tier` | 0 | Processing tier (0=off, 1=stats, 2=vitals) |
| `pres_thresh` | 50 | Sensitivity for presence detection (lower = more sensitive) |
| `fall_thresh` | 15000 | Fall detection threshold in milli-units (15000 = 15.0 rad/s²). Normal walking is 2-5, real falls are 20+. Raise to reduce false positives. |
| `vital_win` | 300 | How many frames of phase history to keep for breathing/HR extraction |
| `vital_int` | 1000 | How often to send a vitals packet, in milliseconds |
| `subk_count` | 32 | Number of best subcarriers to keep (out of 56) |

When Tier 2 is active, the node sends a 32-byte vitals packet at 1 Hz (configurable) containing presence state, motion score, breathing BPM, heart rate BPM, confidence values, fall flag, and occupancy estimate. The packet uses magic `0xC5110002` and is sent to the same aggregator IP and port as raw CSI frames.

Binary size: 990 KB (8MB flash, 52% free) or 773 KB (4MB flash). v0.5.0 adds mmWave sensor fusion (~12 KB larger).

> **Alpha notice**: Vital sign estimation uses heuristic BPM extraction. Accuracy is best with stationary subjects in controlled environments. Not for medical use.

**Start the aggregator:**

```bash
# From source (--udp-bind/--udp-allow let it hear nodes on your network)
./target/release/sensing-server --source esp32 --udp-port 5005 --http-port 3000 --ws-port 3001 \
  --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>

# Docker (see "Receiving ESP32 frames in Docker" for the UDP source guard)
docker run -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 5005:5005/udp \
  -e RUVIEW_API_TOKEN -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW=<node-ip-or-cidr> \
  ruvnet/wifi-densepose:latest
```

See [ADR-018](../docs/adr/ADR-018-esp32-dev-implementation.md), [ADR-029](../docs/adr/ADR-029-ruvsense-multistatic-sensing-mode.md), and [Tutorial #34](https://github.com/ruvnet/RuView/issues/34).

<a id="intel-5300--atheros-nic"></a>
### Intel 5300 / Atheros NIC

These research NICs provide full CSI on Linux with firmware/driver modifications.

| NIC | Driver | Platform | Setup |
|-----|--------|----------|-------|
| Intel 5300 | `iwl-csi` | Linux | Custom firmware, ~$15 used |
| Atheros AR9580 | `ath9k` patch | Linux | Kernel patch, ~$20 used |

These are advanced setups. See the respective driver documentation for installation.

---

<a id="camera-free-pose-training"></a>
## Camera-Free Pose Training

RuView can train a 17-keypoint COCO pose model **without any camera** by fusing 10 sensor signals from the ESP32 nodes and Cognitum Seed:

| Signal | Source | What it provides |
|--------|--------|-----------------|
| PIR sensor | Seed GPIO 6 | Binary presence ground truth |
| BME280 temperature | Seed I2C | Occupancy proxy (temp rises with people) |
| BME280 humidity | Seed I2C | Breathing confirmation |
| Cross-node RSSI | 2x ESP32 | Rough XY position (triangulation) |
| Vitals stability | ESP32 DSP | Activity level (stable HR = stationary) |
| Temporal CSI patterns | ESP32 DSP | Walk (periodic), sit (stable), empty (flat) |
| kNN clusters | Seed vector store | Natural state groupings |
| Boundary fragility | Seed graph analysis | Regime changes (enter/exit) |
| Reed switch | Seed GPIO 5 | Door open/close events |
| Vibration sensor | Seed GPIO 13 | Footstep detection |

### How It Works

The pipeline generates weak labels from sensor fusion, then trains in 5 phases:

1. **Multi-modal collection** — Syncs CSI frames with Seed sensor events
2. **Weak label generation** — RSSI triangulation for head position, subcarrier asymmetry for hands, vibration for feet
3. **5-keypoint pose proxy** — Trains head/hands/feet positions from fused signals
4. **17-keypoint interpolation** — Derives full COCO skeleton using bone length constraints
5. **Self-refinement** — Bootstraps from confident predictions (3 rounds)

```bash
# With Cognitum Seed connected (all 10 signals):
node scripts/train-camera-free.js \
  --data data/recordings/pretrain-*.csi.jsonl \
  --seed-url https://169.254.42.1:8443 \
  --seed-token "$SEED_TOKEN"

# Without Seed (CSI-only, 3 signals — still works):
node scripts/train-camera-free.js \
  --data data/recordings/pretrain-*.csi.jsonl --no-seed
```

**Output:** 82.8 KB model (8 KB at 4-bit) with 17-keypoint predictions, 0 skeleton violations, LoRA per-node adapters, and EWC protection against forgetting.

See [ADR-071](adr/ADR-071-ruvllm-training-pipeline.md) and the [pretraining tutorial](tutorials/cognitum-seed-pretraining.md) for the full walkthrough.

---

## Camera-Supervised Pose Training (v0.7.0)

For significantly higher accuracy, use a webcam as a **temporary teacher** during training. The camera captures real 17-keypoint poses via MediaPipe, paired with simultaneous ESP32 CSI data. After training, the camera is no longer needed — the model runs on CSI only.

> **Accuracy note (2026-06-10):** the previously cited "92.9% PCK@20" figure is
> retracted — a forensic recheck of the surviving eval holdout showed it came
> from a constant-output model scored with an absolute (non-torso-normalized)
> threshold on 69 nearly-static frames, a protocol under which a trivial
> mean-pose predictor scores 100%. No measured camera-supervised PCK@20 is
> currently published (see CHANGELOG, PR #535). Treat this workflow as a data
> collection mechanism; accuracy claims will follow a ≥35-minute multi-pose
> collection session evaluated with torso-normalized PCK.

### Requirements

- Python 3.9+ with `mediapipe` and `opencv-python` (`pip install mediapipe opencv-python`)
- ESP32-S3 node streaming CSI over UDP (port 5005)
- A webcam (laptop, USB, or Mac camera via Tailscale)

### Step 0: Check your CSI rate and plan the session length

Window yield is `csi_frames / 20` — **your CSI packet rate sets how long you
must record.** Check it first (10-second probe):

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

| CSI rate | Windows/min | Minutes for 2,000 windows (minimum trainable) |
|---|---|---|
| ~13 Hz (idle network) | ~39 | ~52 min |
| ~53 Hz (active self-ping, #985 firmware) | ~160 | ~13 min — record 35–40 min anyway for pose variety |

A 5-minute session is **not enough to train on** — it produces a few hundred
windows of one pose context, and models trained on it memorize rather than
generalize (this is what invalidated the earlier accuracy figure).

### Step 1: (Recommended) calibrate camera ↔ room

The two-checkerboard calibration (ADR-152 §2.1.3) puts labels in a shared 3D
room frame instead of raw camera coordinates, which is the published defense
against layout-brittle "coordinate overfitting" (PerceptAlign, MobiCom'26):

```bash
python scripts/calibrate-camera-room.py   # < 5 min, two checkerboards + a few photos
```

Without it, collection still works but labels are camera-frame only and the
trained model will not survive camera/node relocation.

### Step 2: Capture Camera + CSI Simultaneously

Run both scripts at the same time (in separate terminals):

```bash
# Terminal 1: Record ESP32 CSI (2400 s = 40 min)
python scripts/record-csi-udp.py --duration 2400

# Terminal 2: Capture camera keypoints
python scripts/collect-ground-truth.py --duration 2400 --preview \
  --calibration data/calibration/camera-room.json   # omit if you skipped Step 1
```

During capture: keep your **full body in frame** with good lighting (MediaPipe
confidence must stay above 0.5 — low-confidence frames are dropped at
alignment), and **change activity every 1–2 minutes**: walk, raise hands,
squat, hands up, kick, wave, turn, jump, sit, stand still. Pose variety is
what the model learns from; 40 minutes of sitting produces a constant-pose
predictor.

### Step 3: Align and Train

```bash
# Align camera keypoints with CSI windows (prints kept/dropped window counts —
# expect roughly csi_frames/20 kept; investigate if far below)
node scripts/align-ground-truth.js \
  --gt data/ground-truth/*.jsonl \
  --csi data/recordings/csi-*.csi.jsonl

# Train (pick the preset matching your window count)
node scripts/train-wiflow-supervised.js \
  --data data/paired/*.jsonl \
  --scale small \
  --epochs 50

# Evaluate — torso-normalized PCK on a TEMPORAL split
node scripts/eval-wiflow.js \
  --model models/wiflow-supervised/wiflow-v1.json \
  --data data/paired/*.jsonl
```

> **Model format boundary:** `train-wiflow-supervised.js` produces the
> JavaScript WiFlow model `wiflow-v1.json`. There is currently no supported
> command that converts that JSON model into the sensing server's binary RVF
> container, and renaming the file to `.rvf` does not convert it. Use the JSON
> model with the JavaScript evaluation/inference tools. To train a model that
> the Rust sensing server can load, use its native training path, which writes
> RVF directly:
>
> ```bash
> cargo run -p wifi-densepose-sensing-server --release -- \
>   --train --dataset data/mmfi --dataset-type mmfi \
>   --epochs 100 --save-rvf models/room-model.rvf
> ```
>
> The camera+CSI paired JSONL workflow and the native RVF trainer are separate
> pipelines today. A JSON-to-RVF exporter is future work.

**Evaluation protocol matters.** Use `eval-wiflow.js` (torso-normalized
PCK@20, the metric comparable to published WiFi-pose results) on a temporal
hold-out, and sanity-check that predictions actually vary across frames
(`pred std > 0`) — a constant-pose model can score deceptively well on
near-static data under weaker protocols. See
`benchmarks/wiflow-std/RESULTS.md` for the forensic case study.

### Scale Presets

| Preset | Params | Training Time | Best For |
|--------|--------|---------------|----------|
| `--scale lite` | 189K | ~19 min | sanity runs only (< 2K windows trains poorly) |
| `--scale small` | 474K | ~1 hr | 2K-10K windows (one 40-min session) |
| `--scale medium` | 800K | ~2 hrs | 10K-50K windows (multiple sessions/rooms) |
| `--scale full` | 7.7M | ~8 hrs | 50K+ windows (GPU recommended) |

See [ADR-079](adr/ADR-079-camera-ground-truth-training.md) for the full design and optimization details, and ADR-152 §2.2 for the external WiFlow-STD benchmark these numbers should be read against.

---

## Pre-Trained Models (No Training Required)

Pre-trained models are available on HuggingFace:
- **CSI encoder + presence head** — https://huggingface.co/ruvnet/wifi-densepose-pretrained
- **SOTA MM-Fi pose model** (82.69% torso-PCK@20) — https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose
- **AetherArena leaderboard Space** — https://huggingface.co/spaces/ruvnet/aether-arena

The encoder artifact can be downloaded for its documented inference path without retraining. The
MM-Fi pose checkpoint is benchmark evidence, not a drop-in live ESP32 model; it requires its exact
input contract and runtime described in [Model and capture compatibility](#model-and-capture-compatibility).
The deterministic signal-pipeline proof is reproducible via `python archive/v1/data/proof/verify.py`
(see [ADR-168](adr/ADR-168-benchmark-proof.md)), but that proof does not validate pose accuracy.

### Quick Start with Pre-Trained Models

```bash
# Install huggingface CLI
pip install huggingface_hub

# Download all models
huggingface-cli download ruvnet/wifi-densepose-pretrained --local-dir models/pretrained

# The models include:
#   model.safetensors    — 48 KB contrastive encoder
#   model-q4.bin         — 8 KB quantized (recommended)
#   model-q2.bin         — 4 KB ultra-compact (ESP32 edge)
#   presence-head.json   — presence detection head (v2 encoder: 82.3% held-out triplet acc)
#   node-1.json          — LoRA adapter for room 1
#   node-2.json          — LoRA adapter for room 2
```

### What the Models Do

The pre-trained encoder converts 8-dim CSI feature vectors into 128-dim embeddings. These embeddings power all 17 sensing applications:

- **Presence detection** — v2 encoder: 82.3% held-out temporal-triplet accuracy (v1's "100%" was a single-class recording — retracted, [#882](https://github.com/ruvnet/RuView/issues/882))
- **Environment fingerprinting** — kNN search finds "states like this one"
- **Anomaly detection** — embeddings that don't match known clusters = anomaly
- **Activity classification** — different activities cluster in embedding space
- **Room adaptation** — swap LoRA adapters for different rooms without retraining

### Retraining on Your Own Data

If you want to improve accuracy for your specific environment:

```bash
# Collect 2+ minutes of CSI from your ESP32
python scripts/collect-training-data.py --port 5006 --duration 120

# Retrain (uses ruvllm, no PyTorch needed)
node scripts/train-ruvllm.js --data data/recordings/*.csi.jsonl

# Benchmark your retrained model
node scripts/benchmark-ruvllm.js --model models/csi-ruvllm
```

---

## Health & Wellness Applications

WiFi sensing can monitor health metrics without any wearable or camera:

```bash
# Sleep quality monitoring (run overnight)
node scripts/sleep-monitor.js --port 5006

# Breathing disorder pre-screening
node scripts/apnea-detector.js --port 5006

# Stress detection via heart rate variability
node scripts/stress-monitor.js --port 5006

# Walking analysis + tremor detection
node scripts/gait-analyzer.js --port 5006

# Replay one recording (no live hardware needed)
node scripts/sleep-monitor.js --replay data/recordings/<recording>.csi.jsonl
```

> **Note:** These are pre-screening tools, not medical devices. Consult a healthcare professional for diagnosis.

---

<a id="ruvllm-training-pipeline"></a>
## ruvllm Training Pipeline

All training uses **ruvllm** — a Rust-native ML runtime. No Python, no PyTorch, no GPU drivers required. Runs on any machine with Node.js.

### 5-Phase Training

| Phase | What | Duration (M4 Pro) |
|-------|------|--------------------|
| Contrastive pretraining | Triplet + InfoNCE loss on CSI embeddings | ~5s |
| Task head training | Presence, activity, vitals classifiers | ~10s |
| LoRA refinement | Per-node room adaptation (rank-4) | ~4s |
| TurboQuant quantization | 2/4/8-bit with <0.5% quality loss | <1s |
| EWC consolidation | Prevent catastrophic forgetting | <1s |

```bash
# Basic training
node scripts/train-ruvllm.js --data data/recordings/pretrain-*.csi.jsonl

# Benchmark
node scripts/benchmark-ruvllm.js --model models/csi-ruvllm
```

### Quantization Options

| Bits | Size | Compression | Quality Loss | Use Case |
|------|------|-------------|-------------|----------|
| fp32 | 48 KB | 1x | 0% | Development |
| 8-bit | 16 KB | 4x | <0.01% | Cognitum Seed inference |
| 4-bit | 8 KB | 8x | <0.1% | Recommended for deployment |
| 2-bit | 4 KB | 16x | <1% | ESP32-S3 SRAM (edge inference) |

### Key Features

- **SONA adaptation** — Adapts to new rooms in <1ms without retraining
- **LoRA adapters** — 2,048 parameters per room, hot-swappable
- **EWC protection** — Learns new rooms without forgetting previous ones
- **Deterministic** — Same seed always produces same model (reproducible)
- **10x data augmentation** — Temporal interpolation, noise injection, cross-node blending

---

<a id="docker-compose-multi-service"></a>
## Docker Compose (Multi-Service)

For production deployments with both Rust and Python services:

```bash
cd docker
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
export RUVIEW_UDP_ALLOW=<node-ip-or-cidr>   # macOS Docker: <gateway>/32
docker compose up
```

This starts:
- Rust sensing server on ports 3000 (HTTP), 3001 (WS), 5005 (UDP)
- Python legacy server on ports 8080 (HTTP), 8765 (WS)

The sensing server exits with code 64 when `RUVIEW_API_TOKEN` is unset. Without `RUVIEW_UDP_ALLOW` or `RUVIEW_UDP_INSECURE_LAN=true` it starts but receives no ESP32 frames. `docker/docker-compose.yml` passes these variables through from your shell, along with `RUVIEW_UDP_BIND` and `SENSING_ALLOWED_HOSTS`. See [Receiving ESP32 frames in Docker](#receiving-esp32-frames-in-docker).

---

<a id="testing-firmware-without-hardware-qemu"></a>
## Testing Firmware Without Hardware (QEMU)

You can test the ESP32-S3 firmware on your computer without any physical hardware. The project uses **QEMU** — an emulator that pretends to be an ESP32-S3 chip, running the real firmware code inside a virtual machine on your PC.

This is useful when:
- You don't have an ESP32-S3 board yet
- You want to test firmware changes before flashing to real hardware
- You're running automated tests in CI/CD
- You want to simulate multiple ESP32 nodes talking to each other

<a id="what-you-need"></a>
### What You Need

**Required:**
- Python 3.8+ (you probably already have this)
- QEMU with ESP32-S3 support (Espressif's fork)

**Install QEMU (one-time setup):**

```bash
# Easiest: use the automated installer (installs QEMU + Python tools)
bash scripts/install-qemu.sh

# Or check what's already installed:
bash scripts/install-qemu.sh --check
```

The installer detects your OS (Ubuntu, Fedora, macOS, etc.), installs build dependencies, clones Espressif's QEMU fork, builds it, and adds it to your PATH. It also installs the Python tools (`esptool`, `pyyaml`, `esp-idf-nvs-partition-gen`).

<details>
<summary>Manual installation (if you prefer)</summary>

```bash
# Build from source
git clone https://github.com/espressif/qemu.git
cd qemu
./configure --target-list=xtensa-softmmu --enable-slirp
make -j$(nproc)
export QEMU_PATH=$(pwd)/build/qemu-system-xtensa

# Install Python tools
pip install esptool pyyaml esp-idf-nvs-partition-gen
```

</details>

**For multi-node testing (optional):**

```bash
# Linux only — needed for virtual network bridges
sudo apt install socat bridge-utils iproute2
```

### The `qemu-cli.sh` Command

All QEMU testing is available through a single command:

```bash
bash scripts/qemu-cli.sh <command>
```

| Command | What it does |
|---------|-------------|
| `install` | Install QEMU (runs the installer above) |
| `test` | Run single-node firmware test |
| `swarm --preset smoke` | Quick 2-node swarm test |
| `swarm --preset standard` | Standard 3-node test |
| `mesh 3` | Multi-node mesh test |
| `chaos` | Fault injection resilience test |
| `fuzz --duration 60` | Run fuzz testing |
| `status` | Show what's installed and ready |
| `help` | Show all commands |

<a id="your-first-test-run"></a>
### Your First Test Run

The simplest way to test the firmware:

```bash
# Using the CLI:
bash scripts/qemu-cli.sh test

# Or directly:
bash scripts/qemu-esp32s3-test.sh
```

**What happens behind the scenes:**
1. The firmware is compiled with a "mock CSI" mode — instead of reading real WiFi signals, it generates synthetic test data that mimics real people walking, falling, or breathing
2. The compiled firmware is loaded into QEMU, which boots it like a real ESP32-S3
3. The emulator's serial output (what you'd see on a USB cable) is captured
4. A validation script checks the output for expected behavior and errors

If you already built the firmware and want to skip rebuilding:

```bash
SKIP_BUILD=1 bash scripts/qemu-esp32s3-test.sh
```

To give it more time (useful on slower machines):

```bash
QEMU_TIMEOUT=120 bash scripts/qemu-esp32s3-test.sh
```

<a id="understanding-the-test-output"></a>
### Understanding the Test Output

The test runs 16 checks on the firmware's output. Here's what a successful run looks like:

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

**Exit codes explained:**

| Code | Meaning | What to do |
|------|---------|-----------|
| 0 | **PASS** — everything works | Nothing, you're good! |
| 1 | **WARN** — minor issues | Review the output; usually safe to continue |
| 2 | **FAIL** — something broke | Check the `[FAIL]` lines for what went wrong |
| 3 | **FATAL** — can't even start | Usually a missing tool or build failure; check error messages |

<a id="testing-multiple-nodes-at-once-swarm"></a>
### Testing Multiple Nodes at Once (Swarm)

Real deployments use 3-8 ESP32 nodes. The **swarm configurator** lets you simulate multiple nodes on your computer, each with a different role:

- **Sensor nodes** — generate WiFi signal data (like ESP32s placed around a room)
- **Coordinator node** — collects data from all sensors and runs analysis
- **Gateway node** — bridges data to your computer

```bash
# Quick 2-node smoke test (15 seconds)
python3 scripts/qemu_swarm.py --preset smoke

# Standard 3-node test: 2 sensors + 1 coordinator (60 seconds)
python3 scripts/qemu_swarm.py --preset standard

# See what's available
python3 scripts/qemu_swarm.py --list-presets

# Preview what would run (without actually running)
python3 scripts/qemu_swarm.py --preset standard --dry-run
```

**Note:** Multi-node testing with virtual bridges requires Linux and `sudo`. On other systems, nodes use a simpler networking mode where each node can reach the coordinator but not each other.

<a id="swarm-presets"></a>
### Swarm Presets

| Preset | Nodes | Duration | Best for |
|--------|-------|----------|----------|
| `smoke` | 2 | 15s | Quick check that things work |
| `standard` | 3 | 60s | Normal development testing |
| `ci_matrix` | 3 | 30s | CI/CD pipelines |
| `large_mesh` | 6 | 90s | Testing at scale |
| `line_relay` | 4 | 60s | Multi-hop relay testing |
| `ring_fault` | 4 | 75s | Fault tolerance testing |
| `heterogeneous` | 5 | 90s | Mixed scenario testing |

<a id="writing-your-own-swarm-config"></a>
### Writing Your Own Swarm Config

Create a YAML file describing your test scenario:

```yaml
# my_test.yaml
swarm:
  name: my-custom-test
  duration_s: 45
  topology: star       # star, mesh, line, or ring
  aggregator_port: 5005

nodes:
  - role: coordinator
    node_id: 0
    scenario: 0        # 0=empty room (baseline)
    channel: 6
    edge_tier: 2

  - role: sensor
    node_id: 1
    scenario: 2        # 2=walking person
    channel: 6
    tdm_slot: 1

  - role: sensor
    node_id: 2
    scenario: 3        # 3=fall event
    channel: 6
    tdm_slot: 2

assertions:
  - all_nodes_boot           # Did every node start up?
  - no_crashes               # Any error/panic?
  - all_nodes_produce_frames # Is each sensor generating data?
  - fall_detected_by_node_2  # Did node 2 detect the fall?
```

**Available scenarios** (what kind of fake WiFi data to generate):

| # | Scenario | Description |
|---|----------|-------------|
| 0 | Empty room | Baseline with just noise |
| 1 | Static person | Someone standing still |
| 2 | Walking | Someone walking across the room |
| 3 | Fall | Someone falling down |
| 4 | Multiple people | Two people in the room |
| 5 | Channel sweep | Cycling through WiFi channels |
| 6 | MAC filter | Testing device filtering |
| 7 | Ring overflow | Stress test with burst of data |
| 8 | RSSI sweep | Signal strength from weak to strong |
| 9 | Zero-length | Edge case: empty data packet |

**Topology options:**

| Topology | Shape | When to use |
|----------|-------|-------------|
| `star` | All sensors connect to one coordinator | Most common setup |
| `mesh` | Every node can talk to every other | Testing fully connected networks |
| `line` | Nodes in a chain (A → B → C → D) | Testing relay/forwarding |
| `ring` | Chain with ends connected | Testing circular routing |

Run your custom config:

```bash
python3 scripts/qemu_swarm.py --config my_test.yaml
```

<a id="debugging-firmware-in-qemu"></a>
### Debugging Firmware in QEMU

If something goes wrong, you can attach a debugger to the emulated ESP32:

```bash
# Terminal 1: Start QEMU with debug support (paused at boot)
qemu-system-xtensa -machine esp32s3 -nographic \
  -drive file=firmware/esp32-csi-node/build/qemu_flash.bin,if=mtd,format=raw \
  -s -S

# Terminal 2: Connect the debugger
xtensa-esp-elf-gdb firmware/esp32-csi-node/build/esp32-csi-node.elf \
  -ex "target remote :1234" \
  -ex "break app_main" \
  -ex "continue"
```

Or use VS Code: open the project, press **F5**, and select **"QEMU ESP32-S3 Debug"**.

<a id="running-the-full-test-suite"></a>
### Running the Full Test Suite

For thorough validation before submitting a pull request:

```bash
# 1. Single-node test (2 minutes)
bash scripts/qemu-esp32s3-test.sh

# 2. Multi-node swarm test (1 minute)
python3 scripts/qemu_swarm.py --preset standard

# 3. Fuzz testing — finds edge-case crashes (1-5 minutes)
cd firmware/esp32-csi-node/test
make all CC=clang
make run_serialize FUZZ_DURATION=60
make run_edge FUZZ_DURATION=60
make run_nvs FUZZ_DURATION=60

# 4. NVS configuration matrix — tests 14 config combinations
python3 scripts/generate_nvs_matrix.py --output-dir build/nvs_matrix

# 5. Chaos testing — injects faults to test resilience (2 minutes)
bash scripts/qemu-chaos-test.sh
```

All of these also run automatically in CI when you push changes to `firmware/`.

---

<a id="troubleshooting"></a>
## Troubleshooting

### Docker: "no matching manifest for linux/arm64" on macOS

The `latest` tag supports both amd64 and arm64. Pull the latest image:

```bash
docker pull ruvnet/wifi-densepose:latest
```

If you still see this error, your local Docker may have a stale cached manifest. Try:

```bash
docker pull --platform linux/arm64 ruvnet/wifi-densepose:latest
```

### Docker: "Connection refused" on localhost:3000

Make sure you're mapping the ports correctly:

```bash
docker run -p 3000:3000 -p 3001:3001 ruvnet/wifi-densepose:latest
```

The `-p 3000:3000` maps host port 3000 to container port 3000.

### Docker: No WebSocket data in UI

Add the WebSocket port mapping:

```bash
docker run -p 3000:3000 -p 3001:3001 ruvnet/wifi-densepose:latest
```

### ESP32: "CSI not enabled in menuconfig"

Firmware versions prior to v0.4.1 had `CONFIG_ESP_WIFI_CSI_ENABLED` disabled in the build config. Upgrade to [v0.4.1](https://github.com/ruvnet/RuView/releases/tag/v0.4.1-esp32) or later. If building from source, ensure `sdkconfig.defaults` exists (not just `sdkconfig.defaults.template`). See [ADR-057](../docs/adr/ADR-057-firmware-csi-build-guard.md).

### ESP32: No data arriving

1. Verify firmware is v0.4.1+ (older versions had CSI disabled — see above)
2. Verify the ESP32 is connected to the same WiFi network
3. Check the target IP matches the sensing server machine: `python firmware/esp32-csi-node/provision.py --port COM7 --target-ip <YOUR_IP>`
4. Verify UDP port 5005 is not blocked by firewall
5. Test with: `nc -lu 5005` (Linux) or similar UDP listener

### Build: Rust compilation errors

Ensure Rust 1.75+ is installed (1.85+ recommended):
```bash
rustup update stable
rustc --version
```

### Build: Linux native desktop prerequisites

If you are compiling the Rust workspace on a Debian/Ubuntu-based Linux system, install the native desktop development packages first:

```bash
sudo apt update
sudo apt install -y \
  build-essential pkg-config \
  libglib2.0-dev libgtk-3-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libwebkit2gtk-4.1-dev
```

Then rerun:

```bash
cargo build --release
```

This is the same Linux pre-step referenced in the Rust source build section and covers the common GTK/WebKit `pkg-config` requirements used by the desktop build.

### Windows: RSSI mode shows no data

Run the terminal as Administrator (required for `netsh wlan` access). Verified working on Windows 10 and 11 with Intel AX201 and Intel BE201 adapters.

### Vital signs show 0 BPM

- Vital sign detection requires CSI-capable hardware (ESP32 or research NIC)
- RSSI-only mode (Windows WiFi) does not have sufficient resolution for vital signs
- In simulated mode, synthetic vital signs are generated after a few seconds of warm-up
- With real ESP32 data, vital signs take ~5 seconds to stabilize (smoothing pipeline warm-up)

### Vital signs jumping around

The server applies a 3-stage smoothing pipeline (ADR-048). If readings are still unstable:
- Ensure the subject is relatively still (large movements mask vital sign oscillations)
- Train the adaptive classifier for your specific environment: `curl -X POST http://localhost:3000/api/v1/adaptive/train`
- Check signal quality: `curl http://localhost:3000/api/v1/sensing/latest` — look for `signal_quality > 0.4`

### Observatory shows DEMO instead of LIVE

- Verify the sensing server is running: `curl http://localhost:3000/health`
- Access Observatory via the server URL: `http://localhost:3000/ui/observatory.html` (not a file:// URL)
- If a standalone `aggregator` command is already listening on UDP `:5005`, stop it and run `sensing-server --source esp32 --udp-port 5005 --udp-bind 0.0.0.0 --udp-allow <node-ip-or-cidr>` instead; the Observatory reads the server WebSocket, not the standalone aggregator output
- On a native run, make sure the server was started with `--udp-bind 0.0.0.0` and `--udp-allow` (or `--udp-insecure-lan`). It listens on `127.0.0.1` by default, so frames from your nodes never reach it otherwise
- Verify the ESP32 nodes are provisioned to the IP address of the machine running `sensing-server`
- Hard refresh with Ctrl+Shift+R to clear cached settings
- The auto-detect probes `/health` on the same origin — cross-origin won't work

### QEMU: "qemu-system-xtensa: command not found"

QEMU for ESP32-S3 must be built from Espressif's fork — it is not in standard package managers:

```bash
git clone https://github.com/espressif/qemu.git
cd qemu && ./configure --target-list=xtensa-softmmu && make -j$(nproc)
export QEMU_PATH=$(pwd)/build/qemu-system-xtensa
```

Or point to an existing build: `QEMU_PATH=/path/to/qemu-system-xtensa bash scripts/qemu-esp32s3-test.sh`

### QEMU: Test times out with no output

The emulator is slower than real hardware. Increase the timeout:

```bash
QEMU_TIMEOUT=120 bash scripts/qemu-esp32s3-test.sh
```

If there's truly no output at all, the firmware build may have failed. Rebuild without `SKIP_BUILD`:

```bash
bash scripts/qemu-esp32s3-test.sh   # without SKIP_BUILD
```

### QEMU: "esptool not found"

Install it with pip: `pip install esptool`

### QEMU Swarm: "Must be run as root"

Multi-node swarm tests with virtual network bridges require root on Linux. Two options:

1. Run with sudo: `sudo python3 scripts/qemu_swarm.py --preset standard`
2. Skip bridges (nodes use simpler networking): the tool automatically falls back on non-root systems, but nodes can't communicate with each other (only with the aggregator)

### QEMU Swarm: "yaml module not found"

Install PyYAML: `pip install pyyaml`

---

<a id="faq"></a>
## FAQ

**Q: Do I need special hardware to try this?**
No. Run `docker run -p 3000:3000 ruvnet/wifi-densepose:latest` and open `http://localhost:3000`. Simulated mode exercises the full pipeline with synthetic data.

**Q: Can consumer WiFi laptops do pose estimation?**
No. Consumer WiFi exposes only RSSI (one number per access point), not CSI (56+ complex subcarrier values per frame). RSSI supports coarse presence and motion detection. Full pose estimation requires CSI-capable hardware like an ESP32-S3 ($8) or a research NIC.

**Q: How accurate is the pose estimation?**
The strongest published RuView result is the MM-Fi transformer benchmark (82.69% torso-PCK@20 on
the matched `random_split` protocol), not a live ESP32 result. The committed cog model measured
3.0% PCK@20 on its holdout, below the ≥35% target, and the viewer's live skeleton is a heuristic
placeholder. No measured claim currently shows a 3-node ESP32 mesh reliably tracking 17 keypoints.
ADR-027's 10-second unlabeled MERIDIAN adaptation is Proposed; the available measured calibration
reference uses labeled, model-specific samples.

**Q: Does it work through walls?**
Yes. WiFi signals penetrate non-metallic materials (drywall, wood, concrete up to ~30cm). Metal walls/doors significantly attenuate the signal. With a single AP the effective through-wall range is approximately 5 meters. With a 3-6 node multistatic mesh (ADR-029), attention-weighted cross-viewpoint fusion extends the effective range to ~8 meters through standard residential walls.

**Q: How many people can it track?**
Each access point can distinguish ~3-5 people with 56 subcarriers. Multi-AP deployments multiply linearly (e.g., 4 APs cover ~15-20 people). There is no hard software limit; the practical ceiling is signal physics.

**Q: Is this privacy-preserving?**
The system uses WiFi radio signals, not cameras. No images or video are captured or stored. However, it does track human position, movement, and vital signs, which is personal data subject to applicable privacy regulations.

**Q: What's the Python vs Rust difference?**
The Rust implementation (v2) is 810x faster than Python (v1) for the full CSI pipeline. The Docker image is 132 MB vs 569 MB. Rust is the primary and recommended runtime. Python v1 remains available for legacy workflows.

**Q: Can I use an ESP8266 instead of ESP32-S3?**
No. The ESP8266 does not expose WiFi Channel State Information (CSI) through its SDK, has insufficient RAM (~80 KB vs 512 KB), and runs a single-core 80 MHz CPU that cannot handle the signal processing pipeline. The ESP32-S3 is the minimum supported CSI capture device. See [Issue #138](https://github.com/ruvnet/RuView/issues/138) for alternatives including using cheap Android TV boxes as aggregation hubs.

**Q: Does the Windows WiFi tutorial work on Windows 10?**
Yes. Community-tested on Windows 10 (build 26200) with an Intel Wi-Fi 6 AX201 160MHz adapter on a 5 GHz network. All 7 tutorial steps passed with Python 3.14. See [Issue #36](https://github.com/ruvnet/RuView/issues/36) for full test results.

**Q: Can I run the sensing server on an ARM device (Raspberry Pi, TV box)?**
ARM64 deployment is planned ([ADR-046](adr/ADR-046-android-tv-box-armbian-deployment.md)) but not yet available as a pre-built binary. You can cross-compile from source using `cross build --release --target aarch64-unknown-linux-gnu -p wifi-densepose-sensing-server` if you have the Rust cross-compilation toolchain set up.

---

## Further Reading

- [Architecture Decision Records](../docs/adr/) - 48 ADRs covering all design decisions
- [WiFi-Mat Disaster Response Guide](wifi-mat-user-guide.md) - Search & rescue module
- [Build Guide](build-guide.md) - Detailed build instructions
- [RuVector](https://github.com/ruvnet/ruvector) - Signal intelligence crate ecosystem
- [CMU DensePose From WiFi](https://arxiv.org/abs/2301.00250) - The foundational research paper
