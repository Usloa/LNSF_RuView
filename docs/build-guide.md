# WiFi-DensePose 构建与运行指南

涵盖系统构建、运行与部署的全部方式 —— 从零硬件验证，到带三维可视化的完整 ESP32 组网。

---

## 目录

1. [快速开始（仅验证 —— 无需硬件）](#1-quick-start-verification-only----no-hardware)
2. [Python 流水线（v1/）](#2-python-pipeline-v1)
3. [Rust 流水线（v2）](#3-rust-pipeline-v2)
4. [Three.js 可视化](#4-threejs-visualization)
5. [Docker 部署](#5-docker-deployment)
6. [ESP32 硬件配置](#6-esp32-hardware-setup)
7. [按环境区分的构建方式](#7-environment-specific-builds)

---

<a id="1-quick-start-verification-only----no-hardware"></a>
## 1. 快速开始（仅验证 —— 无需硬件）

这是确认信号处理流水线真实、结果可复现的最快方式。只需 Python 3.8+、numpy 和 scipy，不需要 WiFi 硬件、GPU 或 Docker。

```bash
# 在仓库根目录执行：
./verify
```

它依次运行三个阶段：

1. **环境检查** —— 确认 Python、numpy、scipy 与验证文件齐备。
2. **验证流水线回放** —— 把一份已发布的参考信号送入完整信号处理链（噪声过滤、汉明窗、幅度归一化、基于 FFT 的多普勒提取、通过 scipy.fft 计算功率谱密度），并对输出结果计算 SHA-256 哈希。
3. **生产代码完整性扫描** —— 扫描 `archive/v1/src/`，检查生产代码中是否调用了 `np.random.rand` / `np.random.randn`（测试辅助代码不计入）。

退出码：

- `0` 通过（PASS）—— 流水线哈希与已发布的期望哈希一致
- `1` 失败（FAIL）—— 哈希不匹配或出错
- `2` 跳过（SKIP）—— 没有可供比对的期望哈希文件

附加参数：

```bash
./verify --verbose         # 输出详细的特征统计与多普勒频谱
./verify --verbose --audit # 完整验证 + 代码库审计

# 也可以通过 make 执行：
make verify
make verify-verbose
make verify-audit
```

如果期望哈希文件缺失，可重新生成：

```bash
python3 archive/v1/data/proof/verify.py --generate-hash
```

<a id="minimal-dependencies-for-verification-only"></a>
### 仅做验证时的最小依赖

```bash
pip install numpy==1.26.4 scipy==1.14.1
```

或者安装固定版本组合，以保证哈希可复现：

```bash
pip install -r archive/v1/requirements-lock.txt
```

锁文件固定了这些版本：`numpy==1.26.4`、`scipy==1.14.1`、`pydantic==2.10.4`、`pydantic-settings==2.7.1`。

---

<a id="2-python-pipeline-v1"></a>
## 2. Python 流水线（v1/）

Python 流水线位于 `v1/` 下，提供完整的 API 服务、信号处理、感知模块与 WebSocket 数据流。

### 前置条件

- Python 3.8+
- pip

### 安装（仅验证 —— 轻量）

```bash
pip install -r archive/v1/requirements-lock.txt
```

只安装可复现流水线验证所需的四个包。

### 安装（完整流水线，含 API 服务）

```bash
pip install -r requirements.txt
```

会引入 FastAPI、uvicorn、torch、OpenCV、SQLAlchemy、Redis 客户端以及其余全部运行时依赖。

### 验证流水线

```bash
python3 archive/v1/data/proof/verify.py
```

作用与 `./verify` 相同，但直接调用 Python 脚本，跳过了 bash 包装脚本的代码库扫描阶段。

### 启动 API 服务

```bash
uvicorn v1.src.api.main:app --host 0.0.0.0 --port 8000
```

服务提供：

- REST API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health
- 最新姿态：http://localhost:8000/api/v1/pose/latest
- WebSocket 姿态流：ws://localhost:8000/ws/pose/stream
- WebSocket 分析事件：ws://localhost:8000/ws/analytics/events

开发时启用自动重载：

```bash
uvicorn v1.src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

### 使用普通 WiFi（RSSI 感知 —— 无需专用硬件）

普通设备感知模块（`archive/v1/src/sensing/`）从标准 Linux WiFi 指标（RSSI、噪声底、链路质量）中提取在场与运动特征，无需改动任何硬件。完整设计见 [ADR-013](adr/ADR-013-feature-level-sensing-commodity-gear.md)。

要求：

- 任意带 WiFi 网卡的 Linux 机器（笔记本、树莓派等）
- 已连接 WiFi 接入点（接入点即信号源）
- 通过 `/proc/net/wireless` 读取基础 RSSI 不需要 root 权限

模块提供：

- `LinuxWifiCollector` —— 从 `/proc/net/wireless` 与 `iw` 命令读取真实 RSSI
- `RssiFeatureExtractor` —— 计算滑动统计、FFT 频谱特征、CUSUM 变点检测
- `PresenceClassifier` —— 基于规则的在场/运动分类

能检测的能力：

| 能力 | 单接收端 | 3 个以上接收端 |
|-----------|----------------|-------------|
| 二值在场判断 | 可以（90-95%） | 可以（90-95%） |
| 粗粒度运动（静止/移动） | 可以（85-90%） | 可以（85-90%） |
| 房间级定位 | 不能 | 勉强（70-80%） |

不能检测：人体姿态、心跳、可靠的呼吸。完整的能力边界见 ADR-013。

### Python 项目结构

```
v1/
  src/
    api/
      main.py              # FastAPI 应用入口
      routers/             # REST 路由（姿态、数据流、健康检查）
      middleware/           # 认证、限流
      websocket/           # WebSocket 连接管理、姿态流
    config/                # 设置与领域配置
    sensing/
      rssi_collector.py    # LinuxWifiCollector + SimulatedCollector
      feature_extractor.py # RssiFeatureExtractor（FFT、CUSUM、频谱）
      classifier.py        # PresenceClassifier（基于规则）
      backend.py           # SensingBackend 协议
  data/
    proof/
      sample_csi_data.json       # 确定性参考信号
      expected_features.sha256   # 已发布的期望哈希
      verify.py                  # 一键验证脚本
  requirements-lock.txt          # 固定依赖，保证哈希可复现
```

---

<a id="3-rust-pipeline-v2"></a>
## 3. Rust 流水线（v2）

高性能 Rust 移植版，完整信号处理链相比 Python 流水线约提速 810 倍。

### 前置条件

- Rust 1.70+（通过 [rustup](https://rustup.rs/) 安装）
- cargo（随 Rust 一起安装）
- OpenBLAS 所需的系统依赖（ndarray-linalg 使用）：
  ```bash
  # Ubuntu/Debian
  sudo apt-get install build-essential gfortran libopenblas-dev pkg-config

  # macOS
  brew install openblas
  ```

### 构建

```bash
cd v2
cargo build --release
```

release 配置启用了 LTO、单一 codegen unit 与 `-O3`，以获得最佳性能。

### 测试

```bash
cd v2
cargo test --workspace
```

运行工作区所有 crate 的 107 个测试。

### 性能基准

```bash
cd v2
cargo bench --package wifi-densepose-signal
```

预期吞吐：

| 操作 | 延迟 | 吞吐 |
|-----------|---------|------------|
| CSI 预处理（4x64） | ~5.19 us | 49-66 Melem/s |
| 相位净化（4x64） | ~3.84 us | 67-85 Melem/s |
| 特征提取（4x64） | ~9.03 us | 7-11 Melem/s |
| 运动检测 | ~186 ns | -- |
| 完整流水线 | ~18.47 us | ~54,000 fps |

### 工作区 crate

Rust 工作区在 `crates/` 下包含 10 个 crate：

| Crate | 说明 |
|-------|-------------|
| `wifi-densepose-core` | 核心类型、trait 与领域模型 |
| `wifi-densepose-signal` | 信号处理（FFT、相位解缠、多普勒、相关） |
| `wifi-densepose-nn` | 神经网络推理（ONNX Runtime、candle、tch） |
| `wifi-densepose-api` | 基于 Axum 的 HTTP/WebSocket API 服务 |
| `wifi-densepose-db` | 数据库层（SQLx、PostgreSQL、SQLite、Redis） |
| `wifi-densepose-config` | 配置加载（环境变量、YAML、TOML） |
| `wifi-densepose-hardware` | 硬件适配（ESP32、Intel 5300、Atheros、UDP、PCAP） |
| `wifi-densepose-wasm` | 浏览器部署用的 WebAssembly 绑定 |
| `wifi-densepose-cli` | 命令行接口 |
| `wifi-densepose-mat` | WiFi-Mat 灾害响应模块（搜索与救援） |

单独构建某个 crate：

```bash
# 只构建信号处理
cargo build --release --package wifi-densepose-signal

# API 服务
cargo build --release --package wifi-densepose-api

# 灾害响应模块
cargo build --release --package wifi-densepose-mat

# WASM 目标（完整步骤见第 7 节）
cargo build --release --package wifi-densepose-wasm --target wasm32-unknown-unknown
```

---

<a id="4-threejs-visualization"></a>
## 4. Three.js 可视化

基于浏览器的三维可视化仪表盘，渲染含 24 个身体部位的 DensePose 人体模型、信号可视化与环境场景。

### 运行

直接在浏览器中打开 `ui/viz.html`：

```bash
# macOS
open ui/viz.html

# Linux
xdg-open ui/viz.html

# 或在本地起一个服务
python3 -m http.server 3000 --directory ui
# 然后打开 http://localhost:3000/viz.html
```

### WebSocket 连接

可视化页面连接 `ws://localhost:8000/ws/pose` 获取实时姿态数据。若没有运行中的服务，会回退到使用模拟数据的演示模式，仍可查看三维渲染效果。

查看实时数据：

1. 启动 API 服务（Python 或 Rust 版）
2. 打开 `ui/viz.html`
3. 仪表盘会自动连接

---

<a id="5-docker-deployment"></a>
## 5. Docker 部署

### 开发环境（热重载、Postgres、Redis、Prometheus、Grafana）

```bash
docker compose up
```

会启动：

- `wifi-densepose-dev` —— 带 `--reload`、调试日志、关闭认证的 API 服务（8000 端口）
- `postgres` —— PostgreSQL 15（5432 端口）
- `redis` —— 启用 AOF 持久化的 Redis 7（6379 端口）
- `prometheus` —— 指标抓取（9090 端口）
- `grafana` —— 仪表盘（3000 端口，登录 admin/admin）
- `nginx` —— 反向代理（80、443 端口）

```bash
# 查看日志
docker compose logs -f wifi-densepose

# 在容器内运行测试
docker compose exec wifi-densepose pytest tests/ -v

# 停止全部服务
docker compose down

# 停止并删除数据卷
docker compose down -v
```

### 生产环境

使用 Dockerfile 的 production 阶段，配 4 个 uvicorn worker，启用认证、限流与资源限制。

```bash
# 构建生产镜像
docker build --target production -t wifi-densepose:latest .

# 独立运行
docker run -d \
  --name wifi-densepose \
  -p 8000:8000 \
  -e ENVIRONMENT=production \
  -e SECRET_KEY=your-secret-key \
  wifi-densepose:latest
```

完整生产栈（使用 Docker Swarm secrets）：

```bash
# 先创建所需的 secret
echo "db_password_here" | docker secret create db_password -
echo "redis_password_here" | docker secret create redis_password -
echo "jwt_secret_here" | docker secret create jwt_secret -
echo "api_key_here" | docker secret create api_key -
echo "grafana_password_here" | docker secret create grafana_password -

# 设置必需的环境变量
export DATABASE_URL=postgresql://wifi_user:db_password_here@postgres:5432/wifi_densepose
export REDIS_URL=redis://redis:6379/0
export SECRET_KEY=your-secret-key
export JWT_SECRET=your-jwt-secret
export ALLOWED_HOSTS=your-domain.com
export POSTGRES_DB=wifi_densepose
export POSTGRES_USER=wifi_user

# 用 Docker Swarm 部署
docker stack deploy -c docker-compose.prod.yml wifi-densepose
```

生产版 compose 包含：

- 3 个 API 服务副本，支持滚动更新与回滚
- 资源限制（每副本 2 CPU、4GB 内存）
- 所有服务都配健康检查
- 带轮转的 JSON 文件日志
- 独立的监控网络（overlay）
- 带告警规则与 15 天保留期的 Prometheus
- 预置数据源与仪表盘的 Grafana

### Dockerfile 各阶段

多阶段 `Dockerfile` 提供四个目标：

| 目标 | 用途 | 命令 |
|--------|-----|---------|
| `development` | 本地开发，热重载 | `docker build --target development .` |
| `production` | 优化后的生产镜像 | `docker build --target production .` |
| `testing` | 构建时运行 pytest | `docker build --target testing .` |
| `security` | 运行 safety + bandit 扫描 | `docker build --target security .` |

---

<a id="6-esp32-hardware-setup"></a>
## 6. ESP32 硬件配置

### ESP32-C5 实验性构建

使用 ESP-IDF 6.0.2，并为 C5 使用独立于 S3/C6 的构建目录：

```sh
cd firmware/esp32-csi-node
idf.py -B build-c5 -D IDF_TARGET=esp32c5 -D SDKCONFIG=build-c5/sdkconfig build
python test/test_delivery_contract.py --built-app build-c5/esp32-csi-node.bin --target esp32c5 --flasher-args build-c5/flasher_args.json
```

该配置使用 2.4 GHz、UART 控制台、240 MHz CPU、8 Hz 边缘 DSP 以及 4 MB
OTA 分区布局。显示、WASM 与 PSRAM 均关闭。C5 的 bootloader 应位于
`0x2000`；请按生成的烧录方案操作，不要沿用 S3/C6 的 bootloader 偏移。
esptool 版本至少为 5.3，以匹配修正后的 C5 安全布局。

构建成功不等于板卡能正常运行。需确认具体板型与 flash 容量，
私下保存其原始 flash 内容，并在宣称通过认证前取得真实的启动日志与
持续的 CSI 传输证据。参见 [C5 用户指南](user-guide.md#esp32-c5-experimental-csi-target)
与[认证记录](validation/2026-10-28-esp32-c5-candidate.md)。

以下使用 ESP32-S3 开发板作为 WiFi CSI 传感节点。完整规格见 [ADR-012](adr/ADR-012-esp32-csi-sensor-mesh.md)。

### 物料清单（入门套件 —— 54 美元）

| 物品 | 数量 | 单价 | 小计 |
|------|-----|-----------|-------|
| ESP32-S3-DevKitC-1 | 3 | $10 | $30 |
| USB-A 转 USB-C 数据线 | 3 | $3 | $9 |
| USB 电源适配器（多口） | 1 | $15 | $15 |
| 普通 WiFi 路由器（任意） | 1 | $0（已有） | $0 |
| 汇聚端（笔记本或 Pi 4） | 1 | $0（已有） | $0 |
| **合计** | | | **$54** |

### 前置条件

安装 ESP-IDF（乐鑫官方开发框架）：

```bash
# 克隆 ESP-IDF
mkdir -p ~/esp
cd ~/esp
git clone --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
git checkout v5.2  # 固定到已测试的版本

# 安装工具链
./install.sh esp32s3

# 激活环境（每个会话都要执行一次）
. ./export.sh
```

### 烧录一个节点

```bash
cd firmware/esp32-csi-node

# 设置目标芯片
idf.py set-target esp32s3

# 配置 WiFi SSID/密码与汇聚端 IP
idf.py menuconfig
# 进入：Component config > WiFi-DensePose CSI Node
#   - 设置 WiFi SSID
#   - 设置 WiFi 密码
#   - 设置汇聚端 IP 地址
#   - 设置节点 ID（1、2、3 ……）
#   - 设置采样率（10-100 Hz）

# 构建并烧录（需接上 USB 线）
idf.py build flash monitor
```

`idf.py monitor` 会实时显示串口输出，包括 CSI 回调数据。按 `Ctrl+]` 退出。

每个节点重复一次，节点 ID 依次递增。

### 固件项目结构

```
firmware/esp32-csi-node/
  CMakeLists.txt
  sdkconfig.defaults          # menuconfig 默认值，已启用 CSI
  main/
    main.c                    # 入口、WiFi 初始化、CSI 回调
    csi_collector.c           # CSI 数据采集与缓冲
    feature_extract.c         # 设备端 FFT 与特征提取
    stream_sender.c           # 通过 UDP 向汇聚端发送
    config.h                  # 节点配置
    Kconfig.projbuild         # menuconfig 选项
  components/
    esp_dsp/                  # 用于 FFT 的乐鑫 DSP 库
```

每个节点在设备端完成特征提取（原始 I/Q 转幅度 + 相位 + 频带），把带宽从约 11 KB/帧降到约 470 字节/帧，再通过 UDP 把特征流发送给汇聚端。

### 运行汇聚端

汇聚端收集所有 ESP32 节点的 UDP 流，做特征级融合（不是信号级 —— 原因见 ADR-012），再把融合结果送入 Rust 或 Python 流水线。

```bash
# 通过 Docker 启动汇聚端与流水线
docker compose -f docker-compose.esp32.yml up

# 或直接运行 Rust 汇聚端
cd v2
cargo run --release --package wifi-densepose-hardware -- --mode esp32-aggregator --port 5000
```

### 用真实硬件验证

```bash
docker exec aggregator python verify_esp32.py
```

采集 10 秒数据，生成特征 JSON，并与验证包中的哈希比对。

### ESP32 组网能检测与不能检测的能力

| 能力 | 1 个节点 | 3 个节点 | 6 个节点 |
|-----------|--------|---------|---------|
| 在场检测 | 良好 | 优秀 | 优秀 |
| 粗粒度运动 | 良好 | 优秀 | 优秀 |
| 房间级定位 | 无 | 良好 | 优秀 |
| 呼吸 | 勉强 | 良好 | 良好 |
| 心跳 | 较差 | 较差 | 勉强 |
| 多人计数 | 无 | 勉强 | 良好 |
| 姿态估计 | 无 | 较差 | 勉强 |

---

<a id="7-environment-specific-builds"></a>
## 7. 按环境区分的构建方式

### 浏览器（WASM）

把 Rust 流水线编译为 WebAssembly，在浏览器内执行。边缘部署架构见 [ADR-009](adr/ADR-009-rvf-wasm-runtime-edge-deployment.md)。

前置条件：

```bash
# 安装 wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# 或者通过 cargo 安装
cargo install wasm-pack

# 添加 WASM 目标
rustup target add wasm32-unknown-unknown
```

构建：

```bash
cd v2

# 构建 WASM 包（输出到 pkg/）
wasm-pack build crates/wifi-densepose-wasm --target web --release

# 构建时包含灾害响应模块
wasm-pack build crates/wifi-densepose-wasm --target web --release -- --features mat
```

输出的 `pkg/` 目录包含 `.wasm`、`.js` 胶水代码与 TypeScript 类型定义。在 Web 项目中导入：

```javascript
import init, { WifiDensePoseWasm } from './pkg/wifi_densepose_wasm.js';

async function main() {
  await init();
  const processor = new WifiDensePoseWasm();
  const result = processor.process_frame(csiJsonString);
  console.log(JSON.parse(result));
}
main();
```

运行 WASM 测试：

```bash
wasm-pack test --headless --chrome crates/wifi-densepose-wasm
```

各部署配置的体积目标：

| 配置 | 体积 | 适用场景 |
|---------|------|-------------|
| 浏览器（int8 量化） | ~10 MB | Chrome/Firefox 仪表盘 |
| IoT（int4 量化） | ~0.7 MB | ESP32、资源受限设备 |
| 移动端（int8 量化） | ~6 MB | iOS/Android WebView |
| 现场（fp16 量化） | ~62 MB | 离线救灾平板 |

### IoT（ESP32）

完整 ESP32 配置见[第 6 节](#6-esp32-hardware-setup)。固件运行在设备本机（C 语言，用 ESP-IDF 编译），Rust 汇聚端运行在主机上。

把 WASM 运行时部署到树莓派等设备上：

```bash
# 交叉编译到 ARM
rustup target add aarch64-unknown-linux-gnu
cargo build --release --package wifi-densepose-cli --target aarch64-unknown-linux-gnu
```

### 服务端（Docker）

参见[第 5 节](#5-docker-deployment)。

速查：

```bash
# 开发
docker compose up

# 生产单机
docker build --target production -t wifi-densepose:latest .
docker run -d -p 8000:8000 wifi-densepose:latest

# 生产集群（Swarm）
docker stack deploy -c docker-compose.prod.yml wifi-densepose
```

### 服务端（直接运行 —— 不用 Docker）

```bash
# 1. 安装 Python 依赖
pip install -r requirements.txt

# 2. 设置环境变量（从 example.env 复制）
cp example.env .env
# 按你的情况编辑 .env

# 3. 用 uvicorn 启动（生产）
uvicorn v1.src.api.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 4

# 或者运行 Rust API 服务
cd v2
cargo run --release --package wifi-densepose-api
```

### 开发（本地热重载）

Python：

```bash
# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装全部依赖，含开发工具
pip install -r requirements.txt

# 以自动重载模式运行
uvicorn v1.src.api.main:app --host 0.0.0.0 --port 8000 --reload

# 在另一个终端运行验证
./verify --verbose

# 运行测试
pytest tests/ -v
pytest --cov=wifi_densepose --cov-report=html
```

Rust：

```bash
cd v2

# 以 debug 模式构建（编译更快）
cargo build

# 带输出运行测试
cargo test --workspace -- --nocapture

# 监视模式（需要 cargo-watch）
cargo install cargo-watch
cargo watch -x 'test --workspace' -x 'build --release'

# 运行基准测试
cargo bench --package wifi-densepose-signal
```

两者同时（可视化 + API）：

```bash
# 终端 1：启动 API 服务
uvicorn v1.src.api.main:app --host 0.0.0.0 --port 8000 --reload

# 终端 2：提供可视化页面
python3 -m http.server 3000 --directory ui

# 打开 http://localhost:3000/viz.html —— 它会连接 ws://localhost:8000/ws/pose
```

---

## 附录：关键文件位置

| 文件 | 用途 |
|------|---------|
| `./verify` | 信任开关 —— 一键完成流水线验证 |
| `Makefile` | `make verify`、`make verify-verbose`、`make verify-audit` |
| `archive/v1/requirements-lock.txt` | 固定 Python 依赖，保证哈希可复现 |
| `requirements.txt` | 完整 Python 依赖（API 服务、torch 等） |
| `archive/v1/data/proof/verify.py` | Python 验证脚本 |
| `archive/v1/data/proof/sample_csi_data.json` | 确定性参考信号 |
| `archive/v1/data/proof/expected_features.sha256` | 已发布的期望哈希 |
| `archive/v1/src/api/main.py` | FastAPI 应用入口 |
| `archive/v1/src/sensing/` | 普通 WiFi 感知模块（RSSI） |
| `v2/Cargo.toml` | Rust 工作区根目录 |
| `ui/viz.html` | Three.js 三维可视化 |
| `Dockerfile` | 多阶段 Docker 构建（dev/prod/test/security） |
| `docker-compose.yml` | 开发栈（Postgres、Redis、Prometheus、Grafana） |
| `docker-compose.prod.yml` | 生产栈（Swarm、secrets、资源限制） |
| `docs/adr/ADR-009-rvf-wasm-runtime-edge-deployment.md` | WASM 边缘部署架构 |
| `docs/adr/ADR-012-esp32-csi-sensor-mesh.md` | ESP32 固件与组网规格 |
| `docs/adr/ADR-013-feature-level-sensing-commodity-gear.md` | 普通 WiFi（RSSI）感知 |
