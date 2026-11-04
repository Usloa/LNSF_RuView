# π RuView

<p align="center">
  <a href="https://cognitum.one/seed">
    <img src="assets/ruview-hero-h3-v3.gif" alt="RuView - WiFi DensePose — 通过 WiFi 实现实时姿态估计、呼吸与心率感知的动画可视化" width="100%">
  </a>
</p>

[![RuView：空间化为信号，配以动态概念射频场示意](assets/readme/hero-spatial-v6.svg)](docs/user-guide.md)

<table>
<tr>
<td align="center" width="33%"><a href="docs/user-guide.md"><img src="assets/readme/nav-start-spatial-v4.svg" width="180" alt="从这里开始" /></a><br/><a href="docs/user-guide.md">从这里开始</a></td>
<td align="center" width="33%"><a href="firmware/esp32-csi-node/README.md"><img src="assets/readme/nav-hardware-spatial-v4.svg" width="180" alt="硬件" /></a><br/><a href="firmware/esp32-csi-node/README.md">硬件</a></td>
<td align="center" width="33%"><a href="https://huggingface.co/ruvnet/wifi-densepose-pretrained"><img src="assets/readme/nav-models-spatial-v4.svg" width="180" alt="模型" /></a><br/><a href="https://huggingface.co/ruvnet/wifi-densepose-pretrained">模型</a></td>
</tr>
<tr>
<td align="center" width="33%"><a href="harness/ruview/README.md"><img src="assets/readme/nav-agents-spatial-v4.svg" width="180" alt="AI 工具包" /></a><br/><a href="harness/ruview/README.md">AI 工具包</a></td>
<td align="center" width="33%"><a href="docs/integrations/home-assistant.md"><img src="assets/readme/nav-home-spatial-v4.svg" width="180" alt="智能家居" /></a><br/><a href="docs/integrations/home-assistant.md">智能家居</a></td>
<td align="center" width="33%"><a href="https://cognitum.one/seed"><img src="assets/readme/nav-seed-spatial-v4.svg" width="180" alt="Cognitum Seed" /></a><br/><a href="https://cognitum.one/seed">Cognitum Seed</a></td>
</tr>
</table>

<p align="center">
  <a href="https://ruos.cognitum.one">
    <img src="assets/ruos-animated.svg" alt="RuView — WiFi 化为空间感知能力，配合 Ruflo 协同与 ruOS 感知工作区" width="100%">
  </a>
</p>


<a id="see-through-walls-with-wifi"></a>

## **用 WiFi 看穿墙壁**

**把普通 WiFi 变成空间智能 / 感知系统。** 检测人的存在，测量呼吸与心率，追踪移动，监控房间——可以穿墙、在黑暗中工作，不需要摄像头，也不需要穿戴设备。靠的只是物理规律。

原生支持四大智能家居生态：通过 HA-DISCO MQTT 发布器接入 **[Home Assistant](docs/integrations/home-assistant.md)**；作为可被发现的 HAP-1.1 桥接设备接入 **[Apple Home 与 HomePod](docs/user-guide-apple-homepod.md)**；通过同一个 HA 桥接或 [Matter](docs/adr/ADR-122-bfld-ruview-ha-matter-exposure.md) 端点接入 **[Google Home](docs/integrations/home-assistant.md)** 与 **[Amazon Alexa](docs/integrations/home-assistant.md)**。Siri、Google Assistant 和 Alexa 无需任何自定义技能，即可按房间播报在场状态与生命体征。

[![Works with Home Assistant](https://img.shields.io/badge/Works%20with-Home%20Assistant-blue?logo=home-assistant&logoColor=white&labelColor=41BDF5)](docs/integrations/home-assistant.md) [![Works with Matter](https://img.shields.io/badge/Works%20with-Matter-blue?labelColor=4285F4)](docs/adr/ADR-122-bfld-ruview-ha-matter-exposure.md) [![Works with Apple Home](https://img.shields.io/badge/Works%20with-Apple%20Home-black?logo=apple)](docs/user-guide-apple-homepod.md) [![Works with Google Home](https://img.shields.io/badge/Works%20with-Google%20Home-blue?logo=googlehome)](docs/integrations/home-assistant.md) [![Works with Alexa](https://img.shields.io/badge/Works%20with-Alexa-blue?logo=amazon&logoColor=white&labelColor=00CAFF)](docs/integrations/home-assistant.md)

> 只需一个 `--mqtt` 参数，即可接入任意 **Home Assistant** 安装环境。也可以作为 Matter Bridge 配对到 **Apple Home / Google Home / Alexa / SmartThings**。每个节点出厂提供 21 个实体（11 个原始信号 + 10 个推断出的语义状态：有人正在睡觉、可能处于困境、房间活跃、老人活动异常、会议进行中、卫生间占用、跌倒风险升高、离床、无移动、跨房间转移），另有 3 个入门级 HA Blueprint。参见 [`docs/integrations/home-assistant.md`](docs/integrations/home-assistant.md) · [ADR-115](docs/adr/ADR-115-home-assistant-integration.md)。

<a id="π-ruview-is-a-wifi-sensing-platform-that-turns-radio-signals-into-spatial-intelligence"></a>

### π RuView 是一个把无线电信号转化为空间智能的 WiFi 感知平台。

每一台 WiFi 路由器都在持续用无线电波填满你的空间。当人移动、呼吸，甚至只是静坐时，都会以可测量的方式扰动这些电波。RuView 利用低成本 ESP32 传感器采集的信道状态信息（CSI）捕捉这些扰动，并将其转化为可用的数据：谁在那里、正在做什么、状态是否正常。

[![探索 RuView 的感知、模型与自动化能力](assets/readme/header-features-spatial-v4.svg)](docs/user-guide.md)

**感知能力：**
- **在场与占用** — 穿墙检测人员、统计人数、追踪进出
- **生命体征** — 呼吸频率与心率，非接触式测量，睡眠或静坐时均可
- **活动识别** — 行走、坐下、手势、跌倒——基于 CSI 的时序模式
- **环境建图** — 射频指纹识别房间、检测家具移动、发现新出现的物体
- **睡眠质量** — 整夜监测，包含睡眠阶段分类与呼吸暂停筛查

**此外还包括：**

- **无摄像头姿态估计** — 从 WiFi CSI 估计 17 个人体关键点
- **内置模型工作流** — 录制 CSI、训练模型、加载 RVF 文件、切换 LoRA 配置
- **本地自动化** — HOMECORE 提供状态、历史、自动化、签名 Wasm 插件、语音钩子与 HomeKit 支持
- **统一射频世界模型** — 将 WiFi CSI、雷达、UWB 与蜂窝感知融合进一个隐私受限的场景模型；在真实数据验证前，精度数据仍标注为合成
- **可治理的证据链** — 为感知事件附加隐私策略、不确定性、来源与见证记录
- **RuView MetaHarness** — 用 AI 操作员完成接入、校准、训练、验证与感知结论核查

<!-- ruview-capability-cards -->
<table>
<tr>
<td width="50%"><a href="docs/user-guide.md"><img src="assets/readme/feature-presence-spatial-v4.svg" width="580" alt="在场与运动：打开文档与当前限制说明" /></a><br/><a href="docs/user-guide.md">在场与运动</a></td>
<td width="50%"><a href="v2/crates/wifi-densepose-signal/README.md"><img src="assets/readme/feature-vitals-spatial-v4.svg" width="580" alt="呼吸与生命信号：打开文档与当前限制说明" /></a><br/><a href="v2/crates/wifi-densepose-signal/README.md">呼吸与生命信号</a></td>
</tr>
<tr>
<td width="50%"><a href="docs/benchmarks/pose-estimation-cog.md"><img src="assets/readme/feature-pose-spatial-v6.svg" width="580" alt="姿态研究与限制：打开文档与当前限制说明" /></a><br/><a href="docs/benchmarks/pose-estimation-cog.md">姿态研究与限制</a></td>
<td width="50%"><a href="firmware/esp32-csi-node/README.md"><img src="assets/readme/feature-edge-spatial-v4.svg" width="580" alt="边缘传感器组网：打开文档与当前限制说明" /></a><br/><a href="firmware/esp32-csi-node/README.md">边缘传感器组网</a></td>
</tr>
<tr>
<td width="50%"><a href="docs/integrations/home-assistant.md"><img src="assets/readme/feature-automation-spatial-v4.svg" width="580" alt="本地自动化：打开文档与当前限制说明" /></a><br/><a href="docs/integrations/home-assistant.md">本地自动化</a></td>
<td width="50%"><a href="harness/ruview/README.md"><img src="assets/readme/feature-agents-spatial-v4.svg" width="580" alt="引导式 AI 操作员：打开文档与当前限制说明" /></a><br/><a href="harness/ruview/README.md">引导式 AI 操作员</a></td>
</tr>
</table>

<details>
<summary><strong>RuView MetaHarness</strong> — 面向人类与 AI 智能体的引导式操作</summary>

我们构建的 RuView 专用 metaharness 以 [`@ruvnet/ruview`](harness/ruview/README.md) 发布。它提供：
- 带源码引用的引导；
- CSI 节点、雷达与 LiDAR 的设备访问；
- 带启动证据的固件烧录；
- 一个 MCP 服务器，可经 stdio 或 HTTP 供 ChatGPT 使用，并带实时控制台组件；
- 一个 Claude Code mod；
- 受管控的 Claude Code / Codex 智能体；
- 确定性验证；
- 精度声明的诚实性检查。

配套包：[`homecore`](harness/homecore/README.md)（Homecore 开发者 metaharness）与 [`@ruvnet/ruview-kernel`](harness/ruview-kernel/README.md)（以 WASM 形式提供的生命体征处理流水线）。

```bash
# 检查本地环境并获取带源码引用的引导
npx @ruvnet/ruview@0.9.1 doctor
npx @ruvnet/ruview@0.9.1 guidance --topic sensing --query "model loading"

# 硬件：查看已接入设备、节点实时 CSI、60 GHz 雷达套件
npx @ruvnet/ruview@0.9.1 devices
npx @ruvnet/ruview@0.9.1 esp32 --watch                       # ESP32 + Realtek RAC1 节点，实时视图
npx @ruvnet/ruview@0.9.1 esp32 --seconds 45 --analyze        # 经生命体征内核处理实时 CSI
npx @ruvnet/ruview@0.9.1 mmwave --source esphome --host <kit-ip>

# 智能体：stdio 上的 MCP，或供 ChatGPT 使用的 HTTP（令牌保护，仅只读工具）
npx @ruvnet/ruview@0.9.1 mcp start
RUVIEW_MCP_GRANTS=device-access npx @ruvnet/ruview@0.9.1 mcp start --http

# Claude Code：实时感知面板（/ruview），随包分发
npx @ruvnet/ruview@0.9.1 mod

# 通过 Codex 运行只读的 RuView 智能体
npx @ruvnet/ruview@0.9.1 agent run --host codex --repo . \
  --prompt "Find the nearest tests and cite the source files"

# 核查结论声明、重放确定性证明、搜索已评审知识库
npx @ruvnet/ruview@0.9.1 claim-check --file REPORT.md
npx @ruvnet/ruview@0.9.1 verify
npx @ruvnet/ruview@0.9.1 brain search --query "calibration"
```

**安全约束：**
- 智能体运行默认只读。写入工作区需同时提供 `--allow-write` 与 `--confirm`。
- 读取硬件需要 `device-access` 授权。
- 烧录与校准永不通过 HTTP 传输执行。
- 设备上报的生命体征标记为未验证。
- 检索到的知识库内容属于证据，而非权威指令。

把所有能力打包为单一 `npx ruview` 包的方案已就绪（ADR-376），目前等待 npm 释放该无作用域名称。

完整演练：[用户指南 → RuView npm 工具包](docs/user-guide.md#ruview-npm-toolkit-ruvnetruview)。

</details>

RuView 构建于 [RuVector](https://github.com/ruvnet/ruvector/) 与 [Cognitum Seed](https://cognitum.one) 之上，全部运行在边缘硬件上——一张 ESP32 组网（单节点低至 9 美元）配合一台 Cognitum Seed，提供持久化记忆、密码学证明与 AI 集成。无需云端、无需摄像头、无需联网。

系统在本地用脉冲神经网络学习每个环境，30 秒内即可完成自适应，并通过 6 个 WiFi 信道的多频段组网扫描，把邻居的路由器当作免费的雷达照射源。每一次测量都经 Ed25519 见证链进行密码学证明。

RuView 把普通 WiFi 变成非接触式传感器。一块 9 美元的 ESP32 板读取房间内人体对无线电的反射，一个在 Hugging Face 上发布的 [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained) 小型预训练模型即可判断谁在那里、呼吸状况如何、心率趋势怎样。该模型仅占 8 KB（4 位量化），在树莓派上以微秒级运行。（[v2 编码器](https://huggingface.co/ruvnet/wifi-densepose-pretrained)报告的诚实、无标签留出集**时序三元组准确率为 82.3%**——相比原始 66.4% 有提升；更早的"100% 在场"数字是在单类录制数据上测得，已撤回，以本数据为准。）无摄像头、无穿戴设备、用户手机上无需安装任何应用。

<a id="built-for-low-power-edge-applications"></a>

### 为低功耗边缘应用而设计

[边缘模块](#edge-intelligence-adr-041)是直接运行在 ESP32 传感器上的小程序——无需联网、无云端费用、即时响应。

[![Rust 1.85+](https://img.shields.io/badge/rust-1.85+-orange.svg)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests: 1463](https://img.shields.io/badge/tests-1463%20passed-brightgreen.svg)](https://github.com/ruvnet/RuView)
[![Docker: multi-arch](https://img.shields.io/badge/docker-amd64%20%2B%20arm64-blue.svg)](https://hub.docker.com/r/ruvnet/wifi-densepose)
[![Vital Signs](https://img.shields.io/badge/vital%20signs-breathing%20%2B%20heartbeat-red.svg)](#vital-sign-detection)
[![ESP32 Ready](https://img.shields.io/badge/ESP32--S3-CSI%20streaming-purple.svg)](#esp32-s3-hardware-pipeline)
[![crates.io](https://img.shields.io/crates/v/wifi-densepose-ruvector.svg)](https://crates.io/crates/wifi-densepose-ruvector)
[![Downloads](https://img.shields.io/badge/downloads-10M%2B-brightgreen.svg)](#-edge-module-catalog)

 
> | 能力 | 实现方式 | 速度 / 规模 |
> |------|-----|---------------|
> | 🫁 **呼吸频率** | 对包裹相位做 0.1–0.5 Hz 带通、圆方差、过零 BPM（[#593](https://github.com/ruvnet/RuView/issues/593)） | 6–30 BPM，实时 |
> | 💓 **心率** | 0.8–2.0 Hz 带通、过零 BPM | 40–120 BPM，实时 |
> | 👤 **在场检测** | Hugging Face 上的已训练头部（[`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained)；v2 编码器 = 82.3% 留出集时序三元组准确率，经诚实重测）+ 无需模型的相位方差回退方案 | < 1 ms，约 30 秒环境校准 |
> | 🧬 **CSI 嵌入** | 128 维对比编码器，已在 Hugging Face 发布，4 位量化版本仅 8 KB | M4 Pro 上 **164,183 嵌入/秒** |
> | 🦴 **17 关键点姿态估计** | `cog-pose-estimation` Cog v0.0.1 — 签名 aarch64 + x86_64 二进制发布于 GCS，经 Candle 加载 `pose_v1.safetensors`（仓库内提交的 `pose_v1` 是**初版**端侧模型：PCK@20 = 3.0%，低于 ADR-079 的 ≥35% 目标，其运行时路径仍为 `confidence=0` 的桩实现——参见 [模型权重：哪些是真实的，哪些不是](#model-weights-whats-real-whats-not)；下文 **82.69%** 是另一项已发布的 MM-Fi 基准成绩，并非此实时 cog 的表现）。可在 RTX 5080 上用配对数据 2.1 秒训练自己的模型（[ADR-101](docs/adr/ADR-101-pose-estimation-cog.md)、[基准](docs/benchmarks/pose-estimation-cog.md)）。**MM-Fi 上的 SOTA：** [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose) 在匹配的 MM-Fi `random_split` 协议上达到 **82.69% 躯干 PCK@20**（集成 83.59%），超过 MultiFormer（72.25%）与 CSI2Pose（68.41%）——已在 [AetherArena](https://huggingface.co/spaces/ruvnet/aether-arena) 上自我校正并可审计 | Pi 5 上冷启动 8.4 ms |
> | 🚶 **运动 / 活动** | 运动频段功率 + 相位加速度 | 实时 |
> | 🤸 **跌倒检测** | 相位加速度阈值 + 3 帧去抖 + 5 秒冷却（[#263](https://github.com/ruvnet/RuView/issues/263)） | < 200 ms |
> | 🧮 **多人计数** | 自适应 P95 归一化 + 运行时可调去重因子（`/api/v1/config/dedup-factor`，[#491](https://github.com/ruvnet/RuView/pull/491)）。六个专用学习型计数器以 Cog 形式提供：`occupancy-zones`、`elevator-count`、`queue-length`、`customer-flow`、`clean-room`、`person-matching` | 实时，自校准 |
> | 🌍 **世界模型预测** | OccWorld TransVQVAE — 15 帧未来占用预测，推理 209 ms，RTX 5080 上占用 3.4 GB 显存；可用 `occworld_retrain.py` 针对你的空间微调（[ADR-147](docs/adr/ADR-147-nvidia-cosmos-world-foundation-model-integration.md)） | 15 帧 × 200×200×16 体素 |
> | 🧱 **穿墙感知** | 菲涅尔区几何 + 多径建模 | 约 5 m 以内，取决于信号 |
> | 🧠 **边缘智能** | **105 个 cog 目录**（[ADR-102](docs/adr/ADR-102-edge-module-registry.md)），由 `app-registry.json` 实时提供——涵盖健康、安防、楼宇、零售、工业、研究、AI、集群、信号、网络与开发者模块。可选 Cognitum Seed 提供持久化向量存储 + kNN + 见证链 | 物料清单合计 140 美元 |
> | 🎯 **无摄像头预训练** | 自监督对比编码器，在 6 万帧上训练 1220 万步，已在 Hugging Face 发布 | M4 Pro 上每轮重训 84 秒 |
> | 📷 **摄像头监督微调** | MediaPipe + ESP32 CSI 配对训练，RTX 5080 上端到端 Candle 流水线（[ADR-079](docs/adr/ADR-079-camera-ground-truth-training.md)） | 400 轮 2.1 秒（约 5 ms/轮） |
> | 📡 **多频段组网** | 跨 6 个频段跳信道，TDM 时隙调度（[ADR-029](docs/adr/ADR-029-ruvsense-multistatic-sensing-mode.md)） | 3 倍感知带宽 |
> | 🌐 **3D 点云融合** | 摄像头深度（MiDaS）+ WiFi CSI + 毫米波雷达 → 统一空间模型 | 22 ms 流水线 · 每帧 1.9 万+ 点 |
>
> 在下方 [🧩 边缘模块目录](#-edge-module-catalog)浏览完整的 105 模块清单（含实用说明、体积与难度），或访问 [seed.cognitum.one/store](https://seed.cognitum.one/store)。
>
> 🤗 **预训练权重**：从 [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained) 下载——一条命令即可完成安装，参见下文[加载预训练模型](#loading-the-pretrained-model)。

<details>
<summary><strong>快速开始选项</strong> — Docker、ESP32-S3/C6、Cognitum Seed 与 Python</summary>

```bash
# 选项 1：Docker（模拟数据，无需硬件）
docker pull ruvnet/wifi-densepose:latest
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)   # 必需；缺少时容器以 64 退出
docker run -p 127.0.0.1:3000:3000 -e RUVIEW_API_TOKEN ruvnet/wifi-densepose:latest
# 打开 http://localhost:3000
# Docker 中的 ESP32 节点还需设置 UDP 来源守卫（RUVIEW_UDP_ALLOW）；
# 参见 docs/user-guide.md 的 "Receiving ESP32 frames in Docker"。

# 选项 2a：使用 ESP32-S3 硬件进行实时感知（9 美元）
# 烧录固件、配置 WiFi 并开始感知：
python -m esptool --chip esp32s3 --port COM9 --baud 460800 \
  write_flash 0x0 bootloader.bin 0x8000 partition-table.bin \
  0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin
python firmware/esp32-csi-node/provision.py --port COM9 \
  --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20

# 选项 2b：用 ESP32-C6 进行 WiFi 6 + 802.15.4 研究型感知（6–10 美元，ADR-110）
# 同一份 csi-node 固件为 C6 目标编译——会自动套用 C6
# 覆盖配置（sdkconfig.defaults.esp32c6）。
cd firmware/esp32-csi-node
idf.py set-target esp32c6 && idf.py build
idf.py -p COM6 flash
# C6 启动附加特性（相对 S3）：ADR-018 第 18-19 字节的 HE-LTF 子载波标记、
#   信道 15 上的 802.15.4 组网时间同步、AP 支持时的 TWT 建立、
#   可选的 LP 核动作唤醒（约 5 µA 电池种子节点）。
# v0.6.7 新增：真正的 LP 核 RISC-V 动作门控程序（去抖 + 动作
#   计数）以及带 TWT Responder 的 Wi-Fi 6 软 AP，使两块 C6 板无需
#   购买 11ax 路由器即可实测 iTWT。两者默认关闭，
#   将 CONFIG_C6_{LP_CORE,SOFTAP_HE}_ENABLE 置为开启即可启用。

# 选项 3：配合 Cognitum Seed 的完整系统（140 美元）
# ESP32 推送 CSI → 桥接转发到 Seed，用于持久化存储 + kNN + 见证链
node scripts/rf-scan.js --port 5006           # 实时射频房间扫描
node scripts/snn-csi-processor.js --port 5006  # SNN 实时学习
node scripts/mincut-person-counter.js --port 5006  # 准确的人数统计

# 选项 4：Python — 已在 PyPI 发布（ADR-117）
pip install ruview                        # 或：pip install wifi-densepose
# 两者分发同一份编译好的 PyO3 wheel（约 250 KB，abi3-py310，Linux/macOS/Windows）。
# 加上 [client] 可获得 asyncio WebSocket + paho-mqtt 客户端：
pip install "ruview[client]"              # 或：pip install "wifi-densepose[client]"

# from ruview import BreathingExtractor, HeartRateExtractor   # 等价于：
# from wifi_densepose import BreathingExtractor, HeartRateExtractor
# from ruview.client import SensingClient, RuViewMqttClient
```

</details>

[![PyPI ruview](https://img.shields.io/pypi/v/ruview?label=ruview)](https://pypi.org/project/ruview/) [![PyPI wifi-densepose](https://img.shields.io/pypi/v/wifi-densepose?label=wifi-densepose)](https://pypi.org/project/wifi-densepose/)

> [!NOTE]
> **建议使用支持 CSI 的硬件。** 在场检测、生命体征、穿墙感知及所有高级能力，都需要来自 ESP32-S3（9 美元）或研究级网卡的信道状态信息（CSI）。Docker 镜像以模拟数据运行，供评估使用。消费级 WiFi 笔记本仅能提供基于 RSSI 的在场检测。

> **实时 CSI 采集的硬件选项**：
>
> | 方案 | 硬件 | 成本 | 完整 CSI | 能力 |
> |--------|----------|------|----------|-------------|
> | **ESP32 + Cognitum Seed**（推荐） | ESP32-S3 + [Cognitum Seed](https://cognitum.one) | 约 140 美元 | 是 | 在场、运动、呼吸、心率、跌倒检测、多人计数、17 关键点姿态（签名 Cog 二进制——初版端侧模型，参见[模型权重：哪些是真实的，哪些不是](#model-weights-whats-real-whats-not)）、105 cog 目录、持久化向量存储、kNN 搜索、见证链、MCP 代理 |
> | **ESP32 组网** | 3–6 块 ESP32-S3 + WiFi 路由器 | 约 54 美元 | 是 | 与上述相同的能力，但不含持久化记忆特性 |
> | **ESP32-C6 研究节点**（[ADR-110](docs/adr/ADR-110-esp32-c6-firmware-extension.md)、[见证记录](docs/WITNESS-LOG-110.md)、[评审指南](docs/ADR-110-REVIEW-GUIDE.md)、[固件 v0.7.0](https://github.com/ruvnet/RuView/releases/tag/v0.7.0-esp32)） | ESP32-C6-DevKit（6–10 美元） | 约 10 美元 | 是（支持 Wi-Fi 6） | 双目标 CSI，**实测 ESP-NOW 同步匹配率 99.56%**，在 IDF 5.5.2 上实测到 HE-LTF 采集。TWT 与约 5 µA 运行仍需硬件验证。 |
> | **研究级网卡** | Intel 5300 / Atheros AR9580 | 约 50–100 美元 | 是 | 3x3 MIMO 完整 CSI |
> | **Qualcomm CSI 测试版**（[ADR-268](docs/adr/ADR-268-qualcomm-atheros-csi-platform.md)） | 目前为 QCA9300；QCN9074/QCN9274 实验性支持 | 约 30–200 美元 | 目前为模拟器；硬件适配器受限 | Rust `QCS1` 编解码、确定性重放、UDP/API 集成；现代 ath11k/ath12k 配置不声明可公开导出 CSI |
> | **厂商数据源测试版**（[ADR-270](docs/adr/ADR-270-vendor-rf-sensing-integration-program.md)） | Origin、Plume、Mist、NETGEAR、Electric Imp、RF Solutions、Luma、Nest、Linksys、Wifigarden | 不等 | 取决于能力 | 有界的 Rust 适配器与确定性夹具；仅遥测、仅网络或不支持的状态不得伪装成 CSI |
> | **任意 WiFi** | Windows、macOS 或 Linux 笔记本 | 0 美元 | 否 | 仅 RSSI：粗粒度在场与运动（参见[教程 #36](https://github.com/ruvnet/RuView/issues/36)） |
>
> 没有硬件？用确定性参考信号验证信号处理流水线：`python archive/v1/data/proof/verify.py`
>
---


  <a href="https://ruvnet.github.io/RuView/">
    <img src="assets/v2-screen.png" alt="WiFi DensePose — 带配置指南的实时姿态检测" width="800">
  </a>
  <br>
  <em>基于 WiFi CSI 信号的实时姿态骨架——无摄像头、无穿戴设备（演示可视化；仅用 CSI 的实时单 ESP32 17 关键点模型仍为初版——参见 <a href="#model-weights-whats-real-whats-not">模型权重：哪些是真实的，哪些不是</a>）</em>
  <br><br>
  <a href="https://ruvnet.github.io/RuView/"><strong>▶ 实时观测站演示</strong></a>
  &nbsp;|&nbsp;
  <a href="https://ruvnet.github.io/RuView/pose-fusion.html"><strong>▶ 双模态姿态融合演示</strong></a>
  &nbsp;|&nbsp;
  <a href="https://ruvnet.github.io/RuView/pointcloud/"><strong>▶ 实时 3D 点云</strong></a>
  &nbsp;|&nbsp;
  <a href="https://ruvnet.github.io/RuView/three.js/"><strong>▶ three.js 演示（5 个）</strong></a>

> [服务器](#-quick-start)对可视化与聚合是可选的——ESP32 可[独立运行](#esp32-s3-hardware-pipeline)以完成在场检测、生命体征与跌倒告警。
>
> **实时 ESP32 流水线**：连接一个 ESP32-S3 节点 → 运行[感知服务器](#sensing-server) → 打开[姿态融合演示](https://ruvnet.github.io/RuView/pose-fusion.html)，进行实时双模态姿态估计（摄像头 + WiFi CSI）。参见 [ADR-059](docs/adr/ADR-059-live-esp32-csi-pipeline.md)。（该双模态演示中摄像头提供真值姿态；仅用 CSI 的端侧 17 关键点模型仍为初版——参见[模型权重：哪些是真实的，哪些不是](#model-weights-whats-real-whats-not)。）
>
> **three.js 场景画廊**位于 [`/three.js/`](https://ruvnet.github.io/RuView/three.js/)——五个复杂度递进的 ADR-097 演示：辅助工具、电影化、GLTF 蒙皮、FBX 蒙皮，以及由 ESP32 CSI 驱动的实时 MediaPipe→Mixamo 重定向流。演示 04 与 05 需要本地 Mixamo `X Bot.fbx`（授权边界——不再分发）。

<a id="-pretrained-model-on-hugging-face"></a>

## 🤗 Hugging Face 上的预训练模型

预训练 CSI 权重位于 [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained)——在 6 万帧 / 61 万对比三元组上训练 1220 万步，**留出集时序三元组准确率 82.3%**（相比原始 66.4% 有提升；更早的"100% 在场"数字是在单类录制数据上测得，已撤回），4 位量化版本仅 8 KB。该发布包含一个生成 128 维嵌入的对比式 **CSI 编码器**（M4 Pro 上 164,183 嵌入/秒）与一个**在场检测头部**。还包含按节点使用的 LoRA 适配器，用于环境特定微调。

```bash
# 下载模型包
pip install huggingface_hub
huggingface-cli download ruvnet/wifi-densepose-pretrained --local-dir models/wifi-densepose-pretrained
```

**当前可用的部分与尚待接线的部分：**

| 使用方 | 使用的格式 | 状态 |
|----------|-------------|--------|
| Python 训练 / 评估 / 嵌入提取 | `model.safetensors` | ⚠️ 已发布文件的头部以 NUL 填充，参考实现 `safetensors.torch.load_file` 会拒绝加载（issue [#1522](https://github.com/ruvnet/RuView/issues/1522)）——待修正后重新上传。同仓库的 `csi-embed-v2.safetensors` 不受影响，可正常加载。 |
| 检查 / 重新导出模型包 | `model.rvf.jsonl`（逐行 JSON） | ✅ 可用——纯 JSONL |
| 感知服务器 `--model <PATH>` 参数 | 原生 RVF、`model.safetensors` 或 `model.rvf.jsonl` | ✅ 原生 RVF 可直接加载；safetensors 与 JSONL 在内存中自动转换 |

**加载器范围：** `--model` 现已支持原生 RVF，并可自动转换已发布的 safetensors 或 JSONL 文件。量化的 `model-q*.bin` 文件仍需兼容的读取器；加载权重并不等于提供了匹配的姿态解码器架构，也不等于建立了端到端姿态精度。

**量化选项**（均在 HF 仓库中）：`model-q2.bin`（4 KB）· `model-q4.bin` ⭐ 推荐（8 KB）· `model-q8.bin`（16 KB）· `model.safetensors` 完整版（48 KB）

独立的 **17 关键点姿态估计模型**现已发布于 [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose)——在 MM-Fi 上达到 **82.69% 躯干 PCK@20**（单模型）/ **83.59%**（3 模型集成 + TTA），在匹配的 `random_split` 协议上超过此前已发布的 SOTA MultiFormer（72.25%）与 CSI2Pose（68.41%）。参见下文**结果与证明**。

<a id="results--proof"></a>

### 结果与证明

[![RuView 可视化指南：证据头部](assets/readme/header-evidence-spatial-v4.svg)](docs/benchmarks/pose-estimation-cog.md)

查看实测基准、见证记录与一条命令完成的可复现性检查。

<details>
<summary><strong>查看基准与证明详情</strong></summary>

| 项目 | 位置 | 数值 |
|------|-------|---------|
| **MM-Fi 姿态模型（SOTA）** | [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose) | 82.69% 躯干 PCK@20（单模型）· 83.59%（集成+TTA）· 7.5 万参数微缩版 74.30% |
| **AetherArena 基准 Space** | [`ruvnet/aether-arena`](https://huggingface.co/spaces/ruvnet/aether-arena) | 可自我校正、可审计的 MM-Fi 排行榜 |
| **完整 MM-Fi 研究（诚实的全貌）** | [`docs/benchmarks/mmfi-wifi-sensing-study.md`](docs/benchmarks/mmfi-wifi-sensing-study.md) | 姿态 + 动作；零样本跨受试者约 64%，室内有标签校准后 → 72.2% |
| **效率前沿** | [`docs/benchmarks/wifi-pose-efficiency-frontier.md`](docs/benchmarks/wifi-pose-efficiency-frontier.md) | 约 37 KB int4 模型达到超越 SOTA 的 MM-Fi 姿态成绩；与实时 ESP32 的兼容性尚未建立 |
| **预训练编码器** | [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained) | 82.3% 留出集时序三元组，8 KB int4 |
| **可复现证明（信任熔断开关）** | [`archive/v1/data/proof/verify.py`](archive/v1/data/proof/verify.py) + [`expected_features.sha256`](archive/v1/data/proof/expected_features.sha256) | 一条命令重放确定性流水线（输出 SHA-256 与已发布哈希比对） |
| **基准证明 ADR** | [ADR-168](docs/adr/ADR-168-benchmark-proof.md) | 数字如何产生与验证 |
| **见证证明** | [`docs/WITNESS-LOG-028.md`](docs/WITNESS-LOG-028.md) | 33 行能力证明矩阵，逐条声明附证据 |

```bash
# 自行复现确定性流水线证明（必须打印 VERDICT: PASS）：
python archive/v1/data/proof/verify.py
```

跟踪于 [#509](https://github.com/ruvnet/RuView/issues/509)；摄像头监督微调路径参见 [ADR-079](docs/adr/ADR-079-camera-ground-truth-training.md) 的 P7–P9 阶段。

</details>

<a id="model-weights-whats-real-whats-not"></a>

### 模型权重：哪些是真实的，哪些不是

查看哪些检查点已验证、哪些是实验性的、哪些仅有架构而无权重。

<details>
<summary><strong>查看模型成熟度详情</strong></summary>

在本仓库中，"WiFi → 姿态"意味着三件不同的事，处于三种不同的成熟度层级。请读标签，而不是标题（[ADR-187](docs/adr/ADR-187-archive-v1-deprecation-honest-labeling.md)）：

| 层级 | 检查点 | 诚实状态 |
|------|---------------|---------------|
| **真实且已验证** | [`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained)（CSI 编码器 + 在场检测头）· [`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose)（17 关键点姿态）· `cog-person-count/count_v1` | **MEASURED / 已发布。** 在场 = 82.3% 留出集时序三元组准确率（旧的"100% 在场"数字已撤回）；MM-Fi 姿态 = `random_split` 协议上 82.69% 躯干 PCK@20。这些是项目当前愿意背书的姿态/在场数字。 |
| **真实但较弱（已诚实标注）** | 仓库内提交的 `v2/crates/cog-pose-estimation/cog/artifacts/pose_v1.safetensors` | 初版端侧模型。在 217 个样本的留出集上 **PCK@20 = 3.0% / PCK@50 = 18.5%**——**低于 ADR-079 的 ≥ 35% 目标。** 能学到粗粒度结构（`r_hip` 77% PCK@50）；远端与面部关节接近随机。其在 `cog-pose-estimation/src/inference.rs` 中的运行时路径仍是返回 `confidence=0` 的居中骨架**桩实现**——权重尚未接入。完整披露见 [cog README](v2/crates/cog-pose-estimation/cog/README.md)。 |
| **仅有架构，无权重** | `archive/v1` `DensePoseHead` | 随机 `kaiming_normal_` 初始化，**没有任何检查点**（`archive/v1/` 下零个 `.pth`/`.onnx`/`.safetensors` 文件）。已弃用并被取代——参见 [`archive/v1/DEPRECATED.md`](archive/v1/DEPRECATED.md)。不要指望它输出真实姿态。 |

**关于 ESP32 单天线（SISO）问题（[#509](https://github.com/ruvnet/RuView/issues/509)）：** 单天线、56 子载波、20 帧窗口的 CSI 流，*并不*携带多天线网卡研究所依赖的细粒度空间信息——上述 cog 实测结果显示远端与面部关节接近随机。项目今天能够背书的可交付姿态精度是 **MM-Fi 基准数字**，而不是实时单 ESP32 数字。通向首个*可复现*端侧基线（PCK@20 ≥ 35%）的路径跟踪于 [ADR-079](docs/adr/ADR-079-camera-ground-truth-training.md) / [#645](https://github.com/ruvnet/RuView/issues/645)——在该基线被测量出来之前，宣传实时单 ESP32 17 关键点特性时必须附带"初版、低于目标、运行时桩实现"的说明。

</details>

<a id="-edge-module-catalog"></a>

## 🧩 边缘模块目录

[![RuView 可视化指南：边缘头部](assets/readme/header-edge-spatial-v4.svg)](firmware/esp32-csi-node/README.md)

为健康、安防、楼宇、工业、研究与 AI 等场景添加签名模块。

<details>
<summary><strong>浏览完整的边缘模块目录</strong></summary>

在 [seed.cognitum.one/store](https://seed.cognitum.one/store) 或你的设备上的 `http://<appliance>:9000/cogs` 浏览并安装模块。每个模块都是一个在感知栈旁运行的小型签名二进制文件。设备会通过空中更新目录，并在安装前验证每个模块（[ADR-100](docs/adr/ADR-100-cog-packaging-specification.md)、[ADR-102](docs/adr/ADR-102-edge-module-registry.md)）。

<a id="-health--14-modules"></a>

### 🫀 健康 &mdash; <sub>14 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `air-quality-index` | 借助 CO2 与颗粒物传感器追踪室内空气质量 | 8 KB | 简单 |
| `baby-cry` | 持续中频段能量检测器，用于婴儿房 / 婴幼儿看护。仅音频，无摄像头。 | 451 KB | 简单 |
| `breathing-sync` | 检测两人呼吸是否同步 | 10 KB | 困难 |
| `cardiac-arrhythmia` | 识别不规则心跳与异常心律 | 8 KB | 困难 |
| `cough-detect` | 声学瞬态 + 频谱咳嗽检测器，带 30 秒聚类聚合。呼吸系统疾病的早期预警信号。 | 451 KB | 简单 |
| `dream-stage` | 追踪你的睡眠阶段——浅睡、深睡与做梦 | 14 KB | 困难 |
| `fall-detect` | 两阶段（冲击 + 静止）跌倒检测器，基于环境特征流（ESP32 运动 / 麦克风）。可选 ruview-mode 以 CSI 姿态进行增强。 | 402 KB | 简单 |
| `gait-analysis` | 检测步态问题并评估跌倒风险 | 12 KB | 困难 |
| `health-monitor` | 非接触式心率、呼吸、睡眠与跌倒告警 | 30 KB | 中等 |
| `respiratory-distress` | 呼吸变得费力或异常急促时告警 | 10 KB | 困难 |
| `seizure-detect` | 识别癫痫发作并立即告警 | 10 KB | 困难 |
| `sleep-apnea` | 检测睡眠中呼吸暂停 | 4 KB | 简单 |
| `snore-monitor` | 周期性低频段能量追踪器，用于睡眠质量 / 呼吸暂停风险趋势分析。与 sleep-apnea cog 配套。 | 451 KB | 简单 |
| `vital-trend` | 追踪数周内的呼吸与心率趋势 | 6 KB | 中等 |

<a id="-security--14-modules"></a>

### 🔒 安防 &mdash; <sub>14 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `audit-logger` | 为合规记录每一个操作——防篡改日志 | 8 KB | 简单 |
| `behavioral-profiler` | 学习正常行为并标记任何异常 | 12 KB | 困难 |
| `fleet-auth` | 在所有 seed 间管理设备证书与访问权限 | 12 KB | 中等 |
| `glass-break` | 两阶段（撞击 + 碎裂）声学检测器。可区分玻璃破碎与普通脉冲噪声。 | 451 KB | 简单 |
| `gunshot-detect` | 饱和峰值 + 指数衰减声学检测器，可选 ruview CSI 运动骤降增强。 | 451 KB | 简单 |
| `intrusion` | 未经授权者进入房间时告警 | 6 KB | 中等 |
| `intrusion-detect-ml` | 使用机器学习检测网络攻击 | 14 KB | 困难 |
| `loitering` | 有人在某处徘徊过久时告警 | 3 KB | 简单 |
| `network-firewall` | 按 cog 阻止未授权的网络访问 | 6 KB | 简单 |
| `panic-motion` | 检测突然的惊慌或剧烈动作 | 6 KB | 中等 |
| `perimeter-breach` | 守卫多个区域并显示进入方向 | 10 KB | 中等 |
| `prompt-shield` | 阻止针对 seed 的信号重放与注入攻击 | 10 KB | 中等 |
| `tailgating` | 捕捉尾随持卡人进入的行为 | 6 KB | 中等 |
| `weapon-detect` | 检测人身上的隐匿金属物体 | 8 KB | 困难 |

<a id="-building--11-modules"></a>

### 🏢 楼宇 &mdash; <sub>11 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `beehive-monitor` | 蜂箱状态声学分类器。通过嗡鸣频段能量 + 混沌度 + 振翅自相关，区分健康 / 混乱 / 失王 / 分蜂 / 盗蜂。 | 451 KB | 简单 |
| `elevator-count` | 统计电梯内人数 | 8 KB | 中等 |
| `energy-audit` | 学习你的作息并削减能源浪费 | 6 KB | 中等 |
| `frost-warning` | 通过温度趋势 + 露点差门限提前 6 小时预测霜冻。适用于大田 / 果园农业。 | 451 KB | 简单 |
| `hvac-presence` | 你到家时开启供暖与制冷 | 3 KB | 简单 |
| `lighting-zones` | 随人员跨房间移动开关灯光 | 4 KB | 简单 |
| `meeting-room` | 显示会议室空闲或占用 | 5 KB | 简单 |
| `occupancy-zones` | 穿墙统计每个房间的人数 | 8 KB | 中等 |
| `predictive-maintenance` | 旋转设备振动谐波分析器。追踪 F1 / 2×F1 / 高阶 / 边带能量，评估劣化严重程度。 | 451 KB | 简单 |
| `smoke-fire` | 多信号烟雾与火焰检测器。融合声学噼啪声、热漂移代理指标与可选 ruview CSI 羽流特征。不能替代法规要求的 UL 认证烟雾报警器。 | 451 KB | 简单 |
| `water-leak` | 持续低幅嘶声 + 周期性滴漏声学检测器，带数分钟持续性门限。两阶段：疑似 → 确认。 | 451 KB | 简单 |

<a id="-retail--7-modules"></a>

### 🛍️ 零售 &mdash; <sub>7 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `customer-flow` | 统计各入口的进出客流 | 8 KB | 中等 |
| `dwell-heatmap` | 显示顾客停留最久的区域 | 6 KB | 中等 |
| `package-detect` | 持续 CSI 偏移检测器，用于门廊 / 装卸区包裹到达与离开。需要 ESP32 CSI ruview 输入。 | 451 KB | 简单 |
| `parking-occupancy` | 基于 ESP32 CSI 子载波幅度偏移的分区车位占用检测。追踪利用率与每小时周转率。需要 ruview。 | 451 KB | 简单 |
| `queue-length` | 估算排队长度与等待时间 | 6 KB | 中等 |
| `shelf-engagement` | 检测顾客与商品的互动 | 6 KB | 中等 |
| `table-turnover` | 追踪餐厅餐桌的空闲或占用状态 | 4 KB | 简单 |

<a id="-industrial--7-modules"></a>

### 🏭 工业 &mdash; <sub>7 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `clean-room` | 在受控环境中执行人数上限 | 4 KB | 简单 |
| `confined-space` | 监测狭窄空间内的作业人员安全 | 5 KB | 中等 |
| `forklift-proximity` | 叉车过于接近作业人员时告警 | 10 KB | 困难 |
| `livestock-monitor` | 监测牲畜的应激、逃逸或疾病 | 6 KB | 中等 |
| `ppe-compliance` | Cog 组合层：当 ruview-densepose 检测到受限区域有人、且无配套 PPE 摄像头 cog 的确认向量时告警。 | 387 KB | 简单 |
| `slip-fall-zone` | 跌倒前风险检测器。当运动方差骤降、泼溅音频与可选谨慎步态 CSI 同时指示滑倒风险升高时触发。 | 451 KB | 简单 |
| `structural-vibration` | 检测建筑物或机械的危险振动 | 8 KB | 困难 |

<a id="-research--12-modules"></a>

### 🔬 研究 &mdash; <sub>12 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `emotion-detect` | 从肢体语言与呼吸读取压力与平静状态 | 10 KB | 困难 |
| `energy-harvester` | 为离网 seed 部署优化太阳能与电池 | 6 KB | 中等 |
| `gesture-language` | 实时识别手语手势 | 12 KB | 困难 |
| `ghost-hunter` | 寻找无法解释的环境异常——纯属娱乐 | 10 KB | 困难 |
| `happiness-score` | 从运动与情绪信号估算幸福度 | 8 KB | 中等 |
| `hyperbolic-space` | 将数据映射到双曲空间以表达树状结构 | 12 KB | 困难 |
| `music-conductor` | 读取指挥家的手势以获取速度与力度 | 12 KB | 困难 |
| `plant-growth` | 追踪植物生长速率与昼夜周期 | 8 KB | 中等 |
| `rain-detect` | 检测降雨的开始、停止与强度 | 6 KB | 中等 |
| `ruview-densepose` | 从 WiFi 进行全身姿态追踪——无需摄像头 | 50 KB | 困难 |
| `sound-classifier` | 识别玻璃破碎、警报或婴儿啼哭等声音 | 16 KB | 困难 |
| `time-crystal` | 探索重复时间模式对称性的实验 | 12 KB | 困难 |

<a id="-ai--15-modules"></a>

### 🤖 AI &mdash; <sub>15 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `anomaly-attractor` | 学习何为正常，并捕捉任何异常 | 10 KB | 困难 |
| `cognitive-pipeline` | FastGRNN 异常门控 + SmolLM2 稀疏 LLM 推理，在 Pi Zero 2W 上实现端侧认知事件 | 320 KB | 困难 |
| `dtw-gesture-learn` | 通过示范教自定义手势 | 14 KB | 中等 |
| `ewc-lifelong` | 学习新知识而不遗忘旧经验 | 8 KB | 困难 |
| `federated-learning` | 在 seed 间训练 AI 而不共享原始数据 | 18 KB | 困难 |
| `goap-autonomy` | 自主规划并执行目标 | 14 KB | 困难 |
| `meta-adapt` | 自动调优以获得最佳性能 | 10 KB | 困难 |
| `micro-hnsw` | 端侧快速指纹识别与分类 | 12 KB | 中等 |
| `neural-trader` | 从实时数据中发现市场模式与趋势 | 20 KB | 困难 |
| `pagerank-influence` | 找出群体中最具影响力的人 | 12 KB | 中等 |
| `pattern-sequence` | 检测日常作息与重复习惯 | 10 KB | 中等 |
| `rag-local` | 用 AI 检索你的文档——运行在 seed 上 | 14 KB | 中等 |
| `spiking-tracker` | 可在极小硬件上运行的类脑追踪器 | 16 KB | 困难 |
| `temporal-logic` | 对实时事件流执行安全规则 | 12 KB | 困难 |
| `time-series-forecast` | 利用历史模式预测传感器趋势 | 12 KB | 中等 |

<a id="-swarm--11-modules"></a>

### 🐝 集群 &mdash; <sub>11 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `swarm-backup-restore` | 自动备份数据到其他 seed——一键恢复 | 8 KB | 简单 |
| `swarm-cluster-monitor` | 每个 seed 健康与状态的实时看板 | 6 KB | 简单 |
| `swarm-consensus` | 共同做出关键变更前由 seed 投票 | 16 KB | 困难 |
| `swarm-delta-sync` | 在 seed 间自动同步数据——仅发送变更 | 8 KB | 中等 |
| `swarm-deploy` | 一次性在所有 seed 上安装或移除 cog | 10 KB | 中等 |
| `swarm-distributed-store` | 将数据分散到多个 seed 并一次性全量搜索 | 14 KB | 困难 |
| `swarm-edge-orchestrator` | 从一处管理所有 ESP32 传感器节点 | 14 KB | 困难 |
| `swarm-load-balancer` | 将查询分散到多个 seed，避免单一节点过载 | 10 KB | 中等 |
| `swarm-mesh-manager` | 发现、连接并监控网络上的所有 seed | 12 KB | 简单 |
| `swarm-mqtt-bridge` | 通过 MQTT 消息在 seed 间共享事件 | 6 KB | 简单 |
| `swarm-witness-federation` | 在 seed 间共享防篡改审计轨迹 | 12 KB | 困难 |

<a id="-signal--6-modules"></a>

### 📡 信号 &mdash; <sub>6 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `coherence-gate` | 过滤噪声信号，保留干净信号 | 8 KB | 中等 |
| `flash-attention` | 将感知聚焦于特定区域以提升精度 | 12 KB | 中等 |
| `optimal-transport` | 通过形状感知的信号比较来度量运动 | 12 KB | 困难 |
| `person-matching` | 区分同一房间内的多个个体 | 18 KB | 困难 |
| `sparse-recovery` | 从部分读数中恢复缺失的信号数据 | 16 KB | 困难 |
| `temporal-compress` | 压缩历史数据以节省内存而不丢失语义 | 14 KB | 中等 |

<a id="-network--1-modules"></a>

### 🌐 网络 &mdash; <sub>1 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `tailscale` | 通过私有 WireGuard 组网（Tailscale）从任意位置访问 seed。用户态模式——无需 root。 | 700 KB | 中等 |

<a id="-developer--7-modules"></a>

### 🛠️ 开发者 &mdash; <sub>7 个模块</sub>

| ID | 功能 | 体积 | 难度 |
|----|--------------|-----:|:----------:|
| `adversarial` | 检测被篡改或伪造的传感器信号 | 4 KB | 简单 |
| `coherence` | 跨多个信道监控信号质量 | 4 KB | 简单 |
| `gesture` | 供 cog 使用的核心手势识别构件 | 6 KB | 中等 |
| `interference-search` | 同时搜索多种可能性以快速得到答案 | 14 KB | 困难 |
| `psycho-symbolic` | 以多种风格对知识图谱进行推理 | 16 KB | 困难 |
| `quantum-coherence` | 面向高级信号状态的量子启发模型 | 16 KB | 困难 |
| `self-healing-mesh` | 节点掉线时仍保持传感器组网运行 | 14 KB | 困难 |

> ℹ️ 构建你自己的 cog：打包规范见 [ADR-100](docs/adr/ADR-100-cog-packaging-specification.md)。本仓库向目录提交的第一个 cog 位于 [v2/crates/cog-pose-estimation/](v2/crates/cog-pose-estimation/)（17 关键点 WiFi 姿态，[ADR-101](docs/adr/ADR-101-pose-estimation-cog.md)）。

</details>

<a id="-how-it-works"></a>

## 🔬 工作原理

[![RuView 可视化指南：总览](assets/readme/overview-spatial-v4.svg)](docs/user-guide.md)

WiFi 路由器用电波填满每个房间。当人移动——甚至只是呼吸——这些电波就会以不同方式散射。WiFi DensePose 读取这种散射模式，并重建发生了什么：

```
WiFi 路由器 → 无线电波穿过房间 → 击中人体 → 散射
    ↓
ESP32 组网（4-6 个节点）通过 TDM 协议在信道 1/6/11 上采集 CSI
    ↓
多频段融合：3 个信道 × 56 个子载波 = 每条链路 168 个虚拟子载波
    ↓
多静态融合：N×(N-1) 条链路 → 注意力加权的跨视角嵌入
    ↓
相干门控：接受/拒绝测量 → 无需调参即可稳定数天
    ↓
信号处理：Hampel、SpotFi、菲涅尔、BVP、频谱图 → 干净特征
    ↓
AI 主干（RuVector）：注意力、图算法、压缩、场模型
    ↓
信号线协议（CRV）：6 阶段 格式塔 → 感知 → 拓扑 → 相干 → 搜索 → 模型
    ↓
神经网络：处理后的信号 → 17 个人体关键点 + 生命体征 + 房间模型
    ↓
输出：实时姿态、呼吸、心率、房间指纹、漂移告警
```

[自学习系统（ADR-024）](docs/adr/ADR-024-contrastive-csi-embedding-model.md)提供无摄像头的表示学习组件。跨房间姿态仍是一个独立的、受数据制约的问题：[MERIDIAN（ADR-027）](docs/adr/ADR-027-cross-environment-domain-generalization.md)处于**提议**状态，而实测校准参考需要成对的 CSI/关键点标签与模型专用适配器。参见[模型与采集兼容性边界](docs/user-guide.md#model-and-capture-compatibility)。

---

<a id="-use-cases--applications"></a>

## 🏢 应用场景

> **安全边界：** 以下为研究与原型应用，并非医疗器械、应急系统或经安全认证的控制装置。
> 生命体征与姿态输出，在投入实际运行前，必须在确切的硬件、房间、受试者与故障条件下
> 完成独立验证。

WiFi 感知在有 WiFi 的地方就能工作。多数情况下无需新硬件——只需在现有接入点上部署软件，或加装一块 8 美元的 ESP32。由于没有摄像头，此类部署在设计上即可规避隐私法规（GDPR 视频、HIPAA 医学影像）。

**扩展性：** 每个 AP 可区分约 3–5 人（56 个子载波）。多 AP 呈线性叠加——4 个 AP 的零售组网可覆盖约 15–20 人。软件层面没有硬性上限，实际天花板由信号物理决定。

| | 为什么 WiFi 感知更优 | 传统替代方案 |
|---|----------------------|----------------------|
| 🔒 | **无视频，不受 GDPR/HIPAA 影像规则约束** | 摄像头需要同意书、告示、数据留存策略 |
| 🧱 | **可穿墙、穿透货架与瓦砾** | 摄像头需要每个房间都有视距 |
| 🌙 | **在全黑环境中工作** | 摄像头需要红外或可见光 |
| 💰 | **每区域 0–8 美元**（现有 WiFi 或 ESP32） | 摄像系统：每区域 200–2,000 美元 |
| 🔌 | **WiFi 已普遍部署** | PIR/雷达传感器需要为每个房间新增布线 |

<details>
<summary><strong>🏥 日常场景</strong> — 医疗、零售、办公、酒店（普通 WiFi）</summary>

| 场景 | 功能 | 硬件 | 关键指标 | 边缘模块 |
|----------|-------------|----------|------------|-------------|
| **养老照护 / 辅助生活** | 跌倒检测、夜间活动监测、睡眠期呼吸频率——无需老人配合穿戴 | 每房间 1 块 ESP32-S3（8 美元） | 跌倒告警 <2s | [睡眠呼吸暂停](docs/edge-modules/medical.md)、[步态分析](docs/edge-modules/medical.md) |
| **医院病房监护** | 为非重症床位提供连续呼吸 + 心率监测，无需有线传感器；异常时通知护士 | 每病区 1–2 个 AP | 呼吸：6–30 BPM | [呼吸窘迫](docs/edge-modules/medical.md)、[心律失常](docs/edge-modules/medical.md) |
| **急诊分诊** | 自动占用计数 + 等待时间估算；在候诊区检测患者异常（呼吸异常） | 现有医院 WiFi | 占用准确率 >95% | [队列长度](docs/edge-modules/retail.md)、[惊慌运动](docs/edge-modules/security.md) |
| **零售客流与动线** | 实时客流、分区停留时长、排队长度——无摄像头、无需用户授权、对 GDPR 友好 | 现有门店 WiFi + 1 块 ESP32 | 停留分辨率约 1m | [客流统计](docs/edge-modules/retail.md)、[停留热力图](docs/edge-modules/retail.md) |
| **办公空间利用** | 哪些工位/房间实际被占用、会议室爽约情况、基于真实在场的 HVAC 优化 | 现有企业 WiFi | 在场延迟 <1s | [会议室](docs/edge-modules/building.md)、[HVAC 在场](docs/edge-modules/building.md) |
| **酒店与服务业** | 无需门磁的房间占用检测、迷你吧/卫浴使用模式、空房节能 | 现有酒店 WiFi | HVAC 节能 15–30% | [能耗审计](docs/edge-modules/building.md)、[照明分区](docs/edge-modules/building.md) |
| **餐饮服务** | 餐桌翻台追踪、厨房人员在场、卫生间占用显示——用餐区无摄像头 | 现有 WiFi | 排队等待 ±30s | [餐桌翻台](docs/edge-modules/retail.md)、[队列长度](docs/edge-modules/retail.md) |
| **停车楼** | 楼梯间与电梯内等摄像头盲区的人员在场检测；有人徘徊时安全告警 | 现有 WiFi | 可穿透混凝土墙 | [徘徊检测](docs/edge-modules/security.md)、[电梯计数](docs/edge-modules/building.md) |

</details>

<details>
<summary><strong>🏟️ 专业场景</strong> — 活动、健身、教育、市政（需支持 CSI 的硬件）</summary>

| 场景 | 功能 | 硬件 | 关键指标 | 边缘模块 |
|----------|-------------|----------|------------|-------------|
| **智能家居自动化** | 可穿墙的房间级在场触发（灯光、HVAC、音乐）——无死角、无运动传感器超时 | 2–3 块 ESP32-S3（24 美元） | 穿墙距离约 5m | [HVAC 在场](docs/edge-modules/building.md)、[照明分区](docs/edge-modules/building.md) |
| **健身与运动研究** | 无需穿戴设备或摄像头即可探索运动与呼吸节律；可靠的姿态纠正需要经验证且兼容的姿态模型 | 3 块以上 ESP32-S3 组网 + 边缘主机 | 原型；不声明实时 S3 姿态精度 | [呼吸同步](docs/edge-modules/exotic.md)、[步态分析](docs/edge-modules/medical.md) |
| **托育与学校** | 午睡呼吸监测、操场人数统计、受限区域告警——对未成年人隐私安全 | 每区域 2–4 块 ESP32-S3 | 呼吸：±1 BPM | [睡眠呼吸暂停](docs/edge-modules/medical.md)、[周界入侵](docs/edge-modules/security.md) |
| **场馆与演唱会** | 人群密度建图、通过呼吸压缩检测挤压风险、应急疏散流线追踪 | 多 AP 组网（4–8 个 AP） | 每平方米密度 | [客流统计](docs/edge-modules/retail.md)、[惊慌运动](docs/edge-modules/security.md) |
| **体育场与竞技场** | 分区级占用用于动态定价、餐饮排班、应急疏散流线建模 | 企业级 AP 网格 | 每个 AP 组网 15–20 人 | [停留热力图](docs/edge-modules/retail.md)、[队列长度](docs/edge-modules/retail.md) |
| **宗教场所** | 无需人脸识别的出席统计——适用于隐私敏感的信众群体、多房间园区追踪 | 现有 WiFi | 分区级精度 | [电梯计数](docs/edge-modules/building.md)、[能耗审计](docs/edge-modules/building.md) |
| **仓储与物流** | 作业人员安全区、叉车接近告警、危险区域占用——可穿透货架与托盘 | 工业级 AP 组网 | 告警延迟 <500ms | [叉车接近](docs/edge-modules/industrial.md)、[受限空间](docs/edge-modules/industrial.md) |
| **市政基础设施** | 公共卫生间占用（无法安装摄像头）、地铁站台拥挤度、应急避难场所人数 | 市政 WiFi + ESP32 | 实时人数 | [客流统计](docs/edge-modules/retail.md)、[徘徊检测](docs/edge-modules/security.md) |
| **博物馆与画廊** | 访客动线热力图、展品停留时长、人群瓶颈告警——艺术品附近无摄像头（闪光/盗窃风险） | 现有 WiFi | 分区停留 ±5s | [停留热力图](docs/edge-modules/retail.md)、[货架互动](docs/edge-modules/retail.md) |

</details>

<details>
<summary><strong>🤖 机器人与工业</strong> — 自主系统、制造业、仿生机器人的空间感知</summary>

WiFi 感知为机器人与自主系统提供了一层空间感知能力，可在激光雷达与摄像头失效的环境中工作——穿越粉尘、烟雾、浓雾，绕过拐角。CSI 信号场充当"第六感"，无需视距即可检测环境中的人。

| 场景 | 功能 | 硬件 | 关键指标 | 边缘模块 |
|----------|-------------|----------|------------|-------------|
| **协作机器人安全区** | 检测协作机器人附近的人——在接触前自动减速或停止，即使存在遮挡 | 每个工位 2–3 块 ESP32-S3 | 在场延迟 <100ms | [叉车接近](docs/edge-modules/industrial.md)、[周界入侵](docs/edge-modules/security.md) |
| **仓储 AMR 导航** | 自主移动机器人感知盲区拐角处、货架后方的人——不受激光雷达遮挡影响 | 沿通道布置 ESP32 组网 | 穿架检测 | [叉车接近](docs/edge-modules/industrial.md)、[徘徊检测](docs/edge-modules/security.md) |
| **仿生机器人 / 人形机器人空间感知** | 面向社交机器人的环境人体姿态感知——检测手势、接近方向与个人空间，无需摄像头常开 | 板载 ESP32-S3 模块 | 17 关键点姿态 | [手势语言](docs/edge-modules/exotic.md)、[情绪检测](docs/edge-modules/exotic.md) |
| **产线监测** | 各工位人员在场、人体工学姿态告警、班次合规人数——可穿透设备 | 每区域工业级 AP | 姿态 + 呼吸 | [受限空间](docs/edge-modules/industrial.md)、[步态分析](docs/edge-modules/medical.md) |
| **工地安全** | 重型机械周边禁区管控、脚手架跌落检测、人员清点 | 加固型 ESP32 组网 | 告警 <2s，穿透粉尘 | [惊慌运动](docs/edge-modules/security.md)、[结构振动](docs/edge-modules/industrial.md) |
| **农业机器人** | 在摄像头不可靠的粉尘/雾天田间环境中检测自主收割机附近的农工 | 防水型 ESP32 节点 | 开阔地约 10m | [叉车接近](docs/edge-modules/industrial.md)、[降雨检测](docs/edge-modules/exotic.md) |
| **无人机降落区** | 确认降落区无人——WiFi 感知可在雨、尘与低照度下工作，而朝下摄像头此时失效 | 地面 ESP32 节点 | 在场：>95% 准确率 | [周界入侵](docs/edge-modules/security.md)、[尾随检测](docs/edge-modules/security.md) |
| **洁净室监测** | 无摄像头的人员追踪（避免摄像头风扇带来的颗粒污染风险）——通过姿态检查洁净服合规 | 现有洁净室 WiFi | 无颗粒排放 | [洁净室](docs/edge-modules/industrial.md)、[牲畜监测](docs/edge-modules/industrial.md) |

</details>

<details>
<summary><strong>🔥 极端场景</strong> — 穿墙、灾害、国防、地下</summary>

这些场景利用 WiFi 穿透固体材料的能力——混凝土、瓦砾、土层——到达任何光学或红外传感器都无法企及之处。WiFi-Mat 灾害模块（ADR-001）正是为此层级设计。

| 场景 | 功能 | 硬件 | 关键指标 | 边缘模块 |
|----------|-------------|----------|------------|-------------|
| **搜救（WiFi-Mat）** | 通过呼吸特征在瓦砾/废墟中检测幸存者，START 分诊颜色分级，3D 定位 | 便携式 ESP32 组网 + 笔记本 | 穿透 30cm 混凝土 | [呼吸窘迫](docs/edge-modules/medical.md)、[癫痫检测](docs/edge-modules/medical.md) |
| **消防救援** | 进入前透过烟雾与墙体定位被困人员；呼吸检测可远程确认生命迹象 | 车载便携组网 | 零能见度下工作 | [睡眠呼吸暂停](docs/edge-modules/medical.md)、[惊慌运动](docs/edge-modules/security.md) |
| **监狱与安防设施** | 牢房占用核验、困境检测（生命体征异常）、周界感知——无摄像头盲区 | 专用 AP 基础设施 | 7×24 生命体征 | [心律失常](docs/edge-modules/medical.md)、[徘徊检测](docs/edge-modules/security.md) |
| **军事 / 战术** | 穿墙人员检测、清房确认、对峙距离下的人质生命体征 | 定向 WiFi + 定制固件 | 穿墙 5m | [周界入侵](docs/edge-modules/security.md)、[武器检测](docs/edge-modules/security.md) |
| **边境与周界安防** | 检测隧道内、围栏后、车辆中的人员——被动感知，无主动照明暴露位置 | 隐蔽式 ESP32 组网 | 被动 / 隐蔽 | [周界入侵](docs/edge-modules/security.md)、[尾随检测](docs/edge-modules/security.md) |
| **矿业与地下** | GPS/摄像头失效的巷道内人员在场检测、塌方后呼吸检测、安全点人数清点 | 加固型 ESP32 组网 | 穿透岩石/土层 | [受限空间](docs/edge-modules/industrial.md)、[呼吸窘迫](docs/edge-modules/medical.md) |
| **海事与海军** | 穿透钢质舱壁的甲板下人员追踪（距离有限，需调参）、落水检测 | 船舶 WiFi + ESP32 | 穿透 1–2 道舱壁 | [结构振动](docs/edge-modules/industrial.md)、[惊慌运动](docs/edge-modules/security.md) |
| **野生动物研究** | 在围栏或兽穴中进行非侵入式动物活动监测——无光污染、无视觉干扰 | 防水型 ESP32 节点 | 零光照排放 | [牲畜监测](docs/edge-modules/industrial.md)、[梦境阶段](docs/edge-modules/exotic.md) |

</details>


---

<a id="-self-learning-wifi-ai"></a>

## 🧠 自学习 WiFi AI

[![RuView 可视化指南：学习头部](assets/readme/header-learning-spatial-v4.svg)](docs/user-guide.md)

从原始 CSI 学习紧凑的房间指纹，并让模型适配每个环境。

<details>
<summary><strong>查看自学习架构与命令</strong></summary>

每一个穿过房间的 WiFi 信号，都会形成该空间独有的指纹。WiFi-DensePose 早已用这些指纹追踪人员，但此前每次读取后都会丢弃其内部"理解"。自学习 WiFi AI 捕获并保留这种理解，形成紧凑、可复用的向量——并针对每个新环境持续自我优化。

**用通俗的话说它做了什么：**
- 把任意 WiFi 信号转化为 128 个数字的"指纹"，唯一地描述房间内正在发生的事
- 完全从原始 WiFi 数据自主学习——无需摄像头、无需标注、无需人工监督
- 仅用 WiFi 即可识别房间、检测入侵者、分类活动（具名身份识别是实验性、受数据制约的研究能力——见下文，并非已交付特性）
- 运行在 8 美元的 ESP32 芯片上（整个模型仅占 55 KB 内存）
- 一次计算同时产出人体姿态追踪与环境指纹

**核心能力**

| 能力 | 实现方式 | 价值 |
|------|-------------|----------------|
| **自监督学习** | 模型观察 WiFi 信号，自行学会"相似"与"不同"的样貌，无需任何人工标注数据 | 随处部署——插上 WiFi 传感器，等 10 分钟即可 |
| **房间识别** | 每个房间产生独特的 WiFi 指纹模式 | 无需 GPS 或信标即可知道有人在哪个房间 |
| **异常检测** | 意外的人或事件会产生与以往任何样本都不匹配的指纹 | 自动获得入侵与跌倒检测这一副产品 |
| **人员再识别** *（实验性、研究）* | 真实的逐信道相似度匹配器（Soul Signature §3.6，`wifi-densepose-bfld`）；**实测**结果：仅凭 WiFi 的心搏+呼吸信道，两人*不可*分离（差距约 0.0005） | 诚实的研究能力——**不声明具名身份识别**，且受数据制约，需结合决定性的 AETHER/体共振信道进行注册。参见 [#1021](https://github.com/ruvnet/RuView/issues/1021) |
| **环境自适应** | MicroLoRA 适配器（每房间 1,792 个参数）为新空间微调模型 | 用极少数据适配新房间——比从零重训少 93% |
| **记忆保留** | EWC++ 正则化记住预训练阶段学到的内容 | 切换到新任务不会抹去既有知识 |
| **难负样本挖掘** | 训练聚焦于最易混淆的样本以加快学习 | 同等训练数据量下获得更高精度 |

**架构**

```
WiFi 信号 [56 信道] → Transformer + 图神经网络
                                  ├→ 128 维环境指纹（用于检索 + 识别）
                                  └→ 17 关节人体姿态（用于人员追踪）
```

**快速开始**

```bash
# 步骤 1：从原始 WiFi 数据学习（无需标签）
cargo run -p wifi-densepose-sensing-server -- --pretrain --dataset data/csi/ --pretrain-epochs 50

# 步骤 2：用姿态标签微调以获得完整能力
cargo run -p wifi-densepose-sensing-server -- --train --dataset data/mmfi/ --epochs 100 --save-rvf model.rvf

# 步骤 3：使用模型——从实时 WiFi 提取指纹
cargo run -p wifi-densepose-sensing-server -- --model model.rvf --embed

# 步骤 4：检索——寻找相似环境或检测异常
cargo run -p wifi-densepose-sensing-server -- --model model.rvf --build-index env
```

**训练模式**

| 模式 | 所需数据 | 获得能力 |
|------|--------------|-------------|
| 自监督 | 仅原始 WiFi 数据 | 理解 WiFi 信号结构的模型 |
| 监督 | WiFi 数据 + 人体姿态标签 | 完整姿态追踪 + 环境指纹 |
| 跨模态 | WiFi 数据 + 摄像头画面 | 与视觉理解对齐的指纹 |

**指纹索引类型**

| 索引 | 存储内容 | 实际用途 |
|-------|---------------|----------------|
| `env_fingerprint` | 房间平均指纹 | "这是厨房还是卧室？" |
| `activity_pattern` | 活动边界 | "有人在做菜、睡觉还是锻炼？" |
| `temporal_baseline` | 常态条件 | "这个房间刚刚发生了异常" |
| `person_track` | 个体移动特征 | "A 刚刚进入客厅" |

**模型体积**

| 组件 | 参数量 | 内存（ESP32 上） |
|-----------|-----------|-------------------|
| Transformer 主干 | 约 28,000 | 28 KB |
| 嵌入投影头 | 约 25,000 | 25 KB |
| 每房间 MicroLoRA 适配器 | 约 1,800 | 2 KB |
| **合计** | **约 55,000** | **55 KB**（可用 520 KB） |

自学习系统构建于 [AI 主干（RuVector）](#ai-backbone-ruvector)信号处理层之上——注意力、图算法与压缩——并在其上叠加对比学习。

完整架构细节参见 [`docs/adr/ADR-024-contrastive-csi-embedding-model.md`](docs/adr/ADR-024-contrastive-csi-embedding-model.md)。

</details>

---

<a id="-claude-code--codex-plugin"></a>

## 🧩 Claude Code 与 Codex 插件

使用仓库内插件，在 Claude Code 或 Codex 中获得引导式配置、感知、训练与验证。

<details>
<summary><strong>查看插件安装与命令</strong></summary>

RuView 的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 插件与 Codex 提示镜像覆盖了接入引导、ESP32 配置、感知应用、模型训练、高级感知、CLI/API/WASM、毫米波雷达与见证验证。源码位于 [`plugins/ruview/`](plugins/ruview/README.md)；市场清单为 [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)。

```bash
# 在 Claude Code 中——把本仓库添加为插件市场，然后安装：
/plugin marketplace add ruvnet/RuView
/plugin install ruview@ruview

# 或在不安装的情况下试用一次（在本地克隆的仓库中执行）：
claude --plugin-dir ./plugins/ruview

# 然后在 Claude Code 中：
#   /ruview-start      → 接入引导（Docker 演示 / 仓库构建 / 实时 ESP32）
#   /ruview-flash      → 构建并烧录 ESP32 固件
#   /ruview-provision  → 配置 WiFi 凭据、接收端 IP、信道/MAC、组网时隙
#   /ruview-app        → 运行感知应用（在场 / 生命体征 / 姿态 / 睡眠 / MAT / 点云）
#   /ruview-train      → 训练 / 评估 / 发布模型（含 GCloud 上的 GPU）
#   /ruview-advanced   → 多静态 / 层析成像 / 跨视角 / 组网安全
#   /ruview-verify     → 测试 + 确定性证明 + 见证包
```

**Codex（OpenAI CLI）：** `cp plugins/ruview/codex/prompts/*.md ~/.codex/prompts/` ——七个 `/ruview-*` 命令已镜像为 Codex 提示；[`plugins/ruview/codex/AGENTS.md`](plugins/ruview/codex/AGENTS.md) 载有项目规则。参见 [`plugins/ruview/codex/README.md`](plugins/ruview/codex/README.md)。

验证插件结构：`bash plugins/ruview/scripts/smoke.sh`。完整说明：[`plugins/ruview/README.md`](plugins/ruview/README.md)。

**实时感知面板（Claude Code mod）：** 同一市场还列出 `ruview-live`，一个 Claude Code mod。
- 用 `/plugin install ruview-live@ruview` 安装，或运行 `npx @ruvnet/ruview@0.9.1 mod` 查看其在 npm 包内的路径。
- `/ruview` 会在对话记录旁打开一个面板，显示你的 CSI 节点与雷达，按定时器刷新，并附一行状态。
- 它是只读的。
- Mod 属于早期访问；若 `/ruview` 缺失，请以 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 启动 Claude Code。参见 [ADR-377](docs/adr/ADR-377-ruview-live-claude-code-mod.md)。

要使用可移植的 RuView MetaHarness，请执行 `npx @ruvnet/ruview@0.9.1`。快捷命令与更完整的说明见本 README 顶部的 MetaHarness 折叠章节、[`harness/ruview/`](harness/ruview/README.md) 以及[用户指南](docs/user-guide.md#ruview-npm-toolkit-ruvnetruview)。

</details>

---

<a id="-documentation"></a>

## 📖 文档

[![RuView 可视化指南：文档头部](assets/readme/header-docs-spatial-v4.svg)](docs/user-guide.md)

从用户、构建与校准指南入手；展开可查看完整参考地图。

<details>
<summary><strong>浏览全部文档</strong></summary>

| 文档 | 说明 |
|----------|-------------|
| [用户指南](docs/user-guide.md) | 分步指南：安装、首次运行、API 使用、硬件配置、训练 |
| [构建指南](docs/build-guide.md) | 从源码构建（Rust 与 Python） |
| [校准与房间训练指南](docs/calibration-guide.md) | `calibrate`/`enroll`/`train-room` 实际强制执行的内容：最小帧数、逐锚点质量门限、宠物/微小动作在场检测的注意事项、空房间基线条件——以真实代码为依据，而不仅是 ADR-135/151 |
| [信任状态与引擎错误](docs/trust-and-engine-errors.md) | `/api/v1/status` 上的 `engine_error_count` 与 `demoted` 含义、确切触发条件、当前诊断缺口（无逐因拆分）、`WDP_GUARD_INTERVAL_US` 恢复路径，以及为何代码中无法证明转换后的 Hugging Face 模型是原因 |
| [**Home Assistant + Matter 集成**](docs/integrations/home-assistant.md) | 通过 MQTT 自动发现实现 **Works with Home Assistant** + **Works with Matter**（Apple Home / Google Home / Alexa / SmartThings）——完整实体目录、3 个入门 Blueprint、Lovelace 仪表盘、隐私模式、阈值调优（[ADR-115](docs/adr/ADR-115-home-assistant-integration.md)）。 |
| [**BFLD — 面向检测的波束成形反馈层**](v2/crates/wifi-densepose-bfld/README.md) | 新的隐私门控 WiFi 感知层，可测量并从结构上防止 802.11ac/ax 波束成形反馈信息导致的身份泄露。三条类型强制不变式（原始 BFI 永不离开节点、身份嵌入仅驻留内存、跨站点关联通过每站点 BLAKE3 键控哈希 + 每日轮换在密码学上不可行）。提供完整操作面（`BfldPipeline`、`BfldPipelineHandle`、Soul Signature §3.6 逐信道匹配器 `EnrolledMatcher`/`SoulMatchOracle`——实验性；具名身份受数据制约，**实测**为在仅 WiFi 信道上不可分离）、MQTT 主题路由 + HA-DISCO + 可用性 + LWT、3 个操作员 HA Blueprint、两个可运行示例、eclipse-mosquitto:2 CI 服务容器。327+ 测试。[ADR-118](docs/adr/ADR-118-bfld-beamforming-feedback-layer-for-detection.md) 总纲 + 子 ADR [119](docs/adr/ADR-119-bfld-frame-format-and-wire-protocol.md)/[120](docs/adr/ADR-120-bfld-privacy-class-and-hash-rotation.md)/[121](docs/adr/ADR-121-bfld-identity-risk-scoring.md)/[122](docs/adr/ADR-122-bfld-ruview-ha-matter-exposure.md)/[123](docs/adr/ADR-123-bfld-capture-path-nexmon-and-esp32.md)。研究档案：[`docs/research/BFLD/`](docs/research/BFLD/)（11 个文件，13,544 词）。 |
| [**SENSE-BRIDGE — rvagent MCP 服务器**](tools/ruview-mcp/README.md) | 双传输 MCP 服务器（`@ruvnet/rvagent`），将 RuView 感知栈桥接到 AI 智能体（Claude Code、Cursor、ruflo 集群）。已接入 6 个工具：`ruview.presence.now`、`ruview.vitals.get_{breathing,heart_rate,all}`、`ruview.bfld.last_scan`、`ruview.bfld.subscribe`。stdio + Streamable HTTP（`POST /mcp`，Origin 校验，Bearer 令牌认证，绑定 `127.0.0.1`）。完整 20 工具 Zod schema 桶 + 5 个 RUVIEW-POLICY 治理工具。93 个测试。[ADR-124](docs/adr/ADR-124-rvagent-mcp-ruvector-npm-integration.md)。试用：`npx @ruvnet/rvagent stdio`。 |
| [语义原语 — 精确率/召回率](docs/integrations/semantic-primitives-metrics.md) | 留出配对采集集上逐原语的 F1：有人正在睡觉、可能处于困境、房间活跃、老人活动异常、会议、卫生间、跌倒风险、离床、无移动、跨房间。 |
| [Claude Code / Codex 插件](plugins/ruview/README.md) | `ruview` 插件 + 市场——技能、`/ruview-*` 命令、智能体与 Codex 提示镜像 |
| [可移植 harness — `npx @ruvnet/ruview`](harness/ruview/README.md) | 由 MetaHarness 铸出、可跨主机移植的 RuView 操作员 harness——`ruview.*` MCP 工具 + 在代码中强制执行的 MEASURED 与 CLAIMED 诚实性护栏（[ADR-182](docs/adr/ADR-182-npx-ruview-harness-via-metaharness.md)）。是仓库内插件的更轻量、多主机配套方案。 |
| [CSI 帧选择 — 实测](docs/csi-frame-selection-measured.md) | 哪种速率门控真正换来了跨节点配对：在九节点 ESP32-C6 集群上以 2x2 因子设计、三个拉丁方区组实测。按 802.11 `rx_seq` 选帧使配对率约翻倍（+31.7 个百分点），而组网时间对齐仅带来 +0.5 个百分点，落在噪声范围内。文中包含它所做的取舍、一个被证伪的预测、测量的局限，以及 `run_arms.py`，使该对比可被复跑而非凭信接受。 |
| [ESP32-C6 固件运行手册](firmware/esp32-csi-node/RUNBOOK.md) | 该运行什么、以何顺序、该检查什么：保留 OTA 回滚的三文件构建、五项预烧录门检、OTA 可达与不可达的烧录区域、带回退路径的单板诊断烧录，以及那些正确取值取决于你的房子而非芯片的可调参数。 |
| [架构决策](docs/adr/README.md) | 205 份 ADR——每项技术选择背后的原因，按领域组织（硬件、信号处理、机器学习、平台、基础设施） |
| [领域模型](docs/ddd/README.md) | 8 个 DDD 模型（RuvSense、信号处理、训练流水线、硬件平台、感知服务器、WiFi-Mat、CHCI、rvCSI）——限界上下文、聚合、领域事件与统一语言 |
| [rvCSI — 边缘射频感知运行时](https://github.com/ruvnet/rvcsi) | Rust 优先 / TypeScript 可访问 / 硬件抽象化的 CSI 运行时：多源接入（含来自 **树莓派 5** / Pi 4 / Pi 3B+ 的真实 nexmon_csi `.pcap`——CYW43455 / BCM43455c0）→ 校验 → DSP → 类型化事件 → RuVector 射频记忆（[ADR-095](docs/adr/ADR-095-rvcsi-edge-rf-sensing-platform.md)、[ADR-096](docs/adr/ADR-096-rvcsi-ffi-crate-layout.md)、[领域模型](docs/ddd/rvcsi-domain-model.md)）。现为独立仓库——[`ruvnet/rvcsi`](https://github.com/ruvnet/rvcsi)——以 vendored 形式置于 `vendor/rvcsi`；crates.io 上有 9 个 `rvcsi-*` crate，npm 上有 `@ruv/rvcsi`，另有一个 Claude Code 插件。 |
| [桌面应用](v2/crates/wifi-densepose-desktop/README.md) | **进行中** — Tauri v2 桌面应用，用于节点管理、OTA 更新、WASM 部署与组网可视化 |
| `ruview-swarm` | 无人机集群控制系统（ADR-148）——层级组网拓扑、Raft 共识、MARL、CSI 感知载荷、MAVLink/PX4/ArduPilot 兼容、Ruflo AI 智能体集成 |
| `ruview-unified` | 统一射频空间世界模型（[ADR-273](docs/adr/ADR-273-unified-rf-spatial-world-model.md)..[277](docs/adr/ADR-277-edge-sensing-control-plane.md)）——规范化射频张量 + 硬件适配器（WiFi CSI / FMCW 雷达 / UWB / 5G SRS）、带 ≤1% 任务适配器的通用射频基础编码器、支持信道增益查询与逆更新的射频感知高斯空间记忆、物理引导的合成射频世界，以及对齐 802.11bf/ETSI-ISAC 的感知策略平面（原始射频在结构上不可导出）。在真实数据验证前，所有精度数字均为 SYNTHETIC。 |
| [医疗示例](examples/medical/README.md) | 通过 60 GHz 毫米波雷达实现非接触式血压、心率、呼吸频率——15 美元硬件，无需穿戴设备 |
| [扩展文档](docs/readme-details.md) | 最新新增、核心特性、安装、快速开始、信号处理、训练、CLI、测试、部署与变更日志 |

</details>

---

<a id="-beta-software"></a>

## 🚧 测试版软件

> **测试版软件** — 正在积极开发中。API 与固件可能变更。已知限制：
> - 不支持 ESP32-C3 与初代 ESP32（单核，不足以承载 CSI DSP）
> - 单 ESP32 部署的空间分辨率有限——建议使用 2 个以上节点，或加装 [Cognitum Seed](https://cognitum.one) 以获得最佳效果
> - 无摄像头姿态精度有限（使用代理标签时 PCK@20 约 2.5%）——[摄像头真值训练](docs/adr/ADR-079-camera-ground-truth-training.md)的目标是 **PCK@20 35%+**；流水线已实现，但数据采集与评估阶段（ADR-079 P7–P9）仍待完成。
>
> 欢迎在 [Issues](https://github.com/ruvnet/RuView/issues) 提交贡献与缺陷报告。

[![Cognitum One：物理世界边缘的环境智能](assets/readme/cognitum-spatial-v4.svg)](https://cognitum.one)

<a id="-license"></a>

## 📄 许可证

MIT 许可证——详见 [LICENSE](LICENSE)。

<a id="-creator-affiliate-program"></a>

## 🤝 创作者联盟计划

**面向 TikTok · Instagram · YouTube 创作者** — 你推荐的每一笔 Cognitum 销售可获 **25% 分成**。你已经在制作的 RuFlo、RuView 与 RuVector 视频已获得数百万次播放；让它们带来的订单为你创造收入。点击追踪即时生效；佣金在快速人工审核后激活（通常 24 小时内）。

[立即申请 → cognitum.one/affiliate](https://cognitum.one/affiliate)

<a id="-support"></a>

## 📞 支持

[GitHub Issues](https://github.com/ruvnet/RuView/issues) | [Discussions](https://github.com/ruvnet/RuView/discussions) | [PyPI](https://pypi.org/project/wifi-densepose/)

---

**WiFi DensePose** — 通过 WiFi 信号实现保护隐私的人体姿态估计。
