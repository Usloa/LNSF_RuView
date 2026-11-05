# RuView 排障指南

从上游分支合并（upstream #301）后整理出的已知问题与解决办法。

---

## 1. 节点没有出现在 /api/v1/nodes

**现象：** ESP32-S3 节点已连上 WiFi、指示灯在闪，但服务器收不到 CSI 数据帧，`/api/v1/nodes` 里也没有这个节点。

**先查服务器：** UDP 接收端默认只监听 `127.0.0.1`（ADR-296）。所以直接运行的 `sensing-server` 根本收不到局域网里节点发来的数据，除非启动时加上 `--udp-bind 0.0.0.0 --udp-allow <节点IP或网段>`（或者 `--udp-insecure-lan`）。出现这个问题时，启动日志里 UDP 接收端那一行会写着 `loopback-only`。用 Docker 的话，参见[用户指南](user-guide.md)里的「在 Docker 中接收 ESP32 数据帧」。

**根本原因：** USB 烧录完成后，节点会进入一种"半瘫"状态：WiFi 能连上，但 UDP 的 CSI 发送悄悄失败了。SoftAP + mDNS 都初始化了，可 CSI 回调始终没被触发。

**解决办法：** 给节点断电重启（拔掉 USB，等 2 秒，再插上）。还不行就用串口发 DTR 复位：`python -m serial.tools.miniterm --dtr 0 COMx 115200`，然后按 Ctrl+C。

**预防：** 0.8.0 及以上固件带看门狗，发现 30 秒没有 CSI 帧就会自动软复位。1～10 号节点仍是旧固件，没有这个自恢复能力（OTA 与 BLE 互相依赖的死结，见 issue #6）。

---

## 2. 人数一直卡在 1

**现象：** 不管房间里有多少人，`estimated_persons` 始终返回 1。

**根本原因（ADR-044）：** 八个问题凑到了一起：
1. `score_to_person_count` 的上限写死为 3
2. `fuse_multi_node_features` 用了 `.max()` 而不是求和 —— N 个相同读数被压成 1
3. 四处 `.max(1)` 限制把没人时的最小人数也强制定为 1
4. `field_model.estimate_occupancy` 被 `.min(3)` 截断
5. 归一化饱和（除以写死的阈值，而不是自适应的 p95）
6. 场模型没有自动校准 —— 特征值那条路径从未启用
7. 生命体征通路的两侧限制不对称
8. 层析成像只产出一个连通块（CC=1），去重后人数算错

**已做的修复（第 1～3 批）：**
- 第 1 批（`9cc5f604`）：上限 3→10，`.max()` 改为求和/3 聚合，放宽 `.max(1)` 限制
- 第 2 批（`306f1262`）：RollingP95 自适应归一化、场模型 30 秒自动校准、生命体征限制对称化
- 第 3 批（`c3df375a`+`0d4bfb09`+`6ac70ddf`）：连通块洪泛填充基础设施、lambda 0.1→5.0、阈值 0.01→0.15、CC>1 门控

**当前状态：** 5 个目标（3 人 + 2 只狗）时 `estimated_persons` 为 6～8，偏多。原因是"求和/3"这个去重系数是拍脑袋定的。层析成像仍只产出一个连通块（CC=1），所以 CC 那条路径没被激活。若 lambda 能在运行时调整，就能不重新部署地调优。

---

## 3. 心率 / 呼吸频率跳动

**现象：** HR 和 BR 读数在相邻帧之间剧烈跳动。BR 的变异系数（CV）为 23.3%，HR 为 12.9%。

**根本原因（ADR-045）：** 11 个 ESP32 节点各自独立计算生命体征。服务器采用"最后写入者获胜"——哪个节点的 UDP 包最后到，就覆盖全局生命体征。每个节点约 20 fps，等于每 50ms 就把不同视角的数据随机混在一起。

**已做的修复（`46fbc061`）：** 改为选最优节点。每个节点的生命体征先用中值滤波 + EMA 独立平滑，再选出 `breathing_confidence + heartbeat_confidence` 最高的节点作为权威来源。结果：BR CV 从 23.3% 降到 12.6%，HR CV 从 12.9% 降到 11.6%。

**已知限制：** `wifi-densepose-vitals` crate 里有更好的四级流水线（带通 → 希尔伯特包络 → 自相关 → 峰值检测），但还没接进 sensing server。目前用的 `VitalSignDetector` 是较简单的 FFT 方法，频率分辨率只有 4 BPM。

---

## 4. 信号质量始终显示 50%

**现象：** 仪表盘上的信号质量指示一直卡在约 50%。

**根本原因：** 信号质量是写死的占位值，并不是从真实 CSI 数据算出来的。

**已做的修复：** ADR-044 第 2 批把假表换成了 RollingP95 自适应归一化。界面诚实性整改（`b2070ab4`）又给未经验证的指标加了 beta 标记，把假表换成逐节点的小药丸指示器，并把真实的逐节点信号数据展示出来。

---

## 5. 仪表盘每隔 2～4 秒卡一下

**现象：** 空间视图和仪表盘会卡住，然后重连，每 2～4 秒出现一次明显顿挫。

**根本原因：** 客户端跟不上时，WebSocket 广播通道的 `recv()` 会返回 `Err(Lagged)`。服务器把它当成致命错误，直接断开连接；客户端又立刻重连，于是形成"连上—断开"的循环。

**已做的修复（`581daf4f`）：**
- 服务端：遇到 `Lagged` 改为 `continue`（跳过丢失的帧，而不是断开）
- 服务端：加 30 秒 ping/pong 保活，避免 Caddy 代理因空闲超时断开
- 结果：8 秒内稳定传输 154 帧，零断连

---

## 6. OTA 升级到 59% 时崩溃

**现象：** 通过 `/api/v1/firmware/download` 做 OTA 固件升级，进度到约 59% 时节点崩溃，Core 1 上报 `StoreProhibited`。

**根本原因：** NimBLE 的 BLE 广播/扫描跑在 Core 1 上。OTA 期间 HTTP 客户端也跑在 Core 1。两者争抢栈空间，BLE 扫描回调在 OTA 写 flash 时触发了内存访问违规。

**解决办法：**
1. 调用 `esp_https_ota_begin()` 前先停掉 NimBLE 的广播和扫描
2. 把 httpd 栈从 4KB 加大到 8KB（`CONFIG_HTTPD_MAX_REQ_HDR_LEN` 和任务栈）
3. OTA 完成或失败后再恢复 BLE

**注意：** 跑旧固件的节点（1～10 号）没法通过 OTA 拿到这个修复，因为崩溃就发生在 OTA 过程中。这些节点必须先用 USB 烧录 0.8.0 及以上固件，之后 OTA 才能正常用。11 号节点已用 USB 烧过带看门狗的固件，可以正常 OTA。

---

## 7. 局域网里 SSH 连不上 babycube

**现象：** `ssh thyhack@10.0.10.10` 卡在 banner 交换阶段。ping 能通，TCP 22 端口也开着，但 SSH 握手始终完成不了。

**临时办法：** 改用 Tailscale 的 IP：
```
ssh thyhack@100.90.238.87
```

**排除的原因：** 不是 CrowdSec。10.0.0.0/8 网段在 CrowdSec 里是白名单（`cscli decisions list` 显示局域网 IP 没有生效的封禁）。而且 banner 卡住发生在任何认证尝试之前，所以也不是防火墙拦截。

**怀疑方向：** 未确定。可能是局域网段的 MTU/分片问题，也可能是 babycube 网卡驱动里的协议栈 bug。Tailscale 的叠加网络（WireGuard UDP）绕开了导致局域网 TCP 异常的那个环节。

---

## 8. 部分 ESP32-S3 板子右侧 USB-C 口不能用

**现象：** 插右侧 USB-C 口（面对板子、USB-C 朝向自己时）时，电脑上不出现串口设备。

**解决办法：** 用左侧那个 USB-C 口。多数 ESP32-S3-DevKitC 板子的左口是 USB 转 UART 桥（CP2102/CH340），用于烧录和串口监视；右口是原生 USB（USB-JTAG），需要另外的驱动，RuView 固件也不走这个口。

---

## 9. Windows 上 Docker Desktop 会丢掉多个 ESP32 节点的 UDP 包

**现象：** 两个及以上 ESP32 节点都烧录、配置好了，网络上也确实在发数据——Windows 主机上用 `tcpdump`/Wireshark 能看到每个节点的数据报——但容器里只收到一个来源 IP。`/api/v1/sensing/latest` 只显示单个节点，实时界面卡住或只追踪一个人。#374（四节点台架）报过，#386（六节点演示，RuView v0.7.0）复现过。

**根本原因：** Windows 上的 Docker Desktop 把引擎跑在 WSL2 / Hyper-V 虚拟机里。从主机局域网进来的 UDP 经 `vpnkit` / `vEthernet` 转发时，不同来源 IP 的数据报被并到同一个虚拟套接字上，第一个来源 IP"占住"之后，其余新来源就在虚拟机边界被静默丢弃。这是 Docker Desktop 自身的限制，不是 sensing-server 的 bug——`host.docker.internal` 和 `--network host` 都没用（Windows 上的 Linux 引擎没实现 host 网络）。

**解决办法：** 在主机上跑随仓库提供的 UDP 中继，让所有转发出去的数据报都从同一个回环来源 IP 发出，Docker 就会原样放行。

```powershell
# 1. 启动中继（PowerShell 或任意终端）
python scripts/udp-relay.py --listen-port 5005 --forward-port 5006

# 2. 修改 docker/docker-compose.yml —— 把 ESP32 的 UDP 映射从
#       - "5005:5005/udp"
#    改成
#       - "5006:5005/udp"

# 3. 启动整套服务
docker compose -f docker/docker-compose.yml up
```

ESP32 节点仍然往主机的 `--target-ip <主机IP>:5005` 发，不需要重新配置固件。中继脚本是 `scripts/udp-relay.py`（只用标准库，没有额外依赖）。用 `--verbose` 确认每个节点的来源 IP 至少出现过一次，之后转发会稳定在单个临时中继端口上。

**预防：** Linux 和 macOS 主机不受影响，只有 Windows 上的 Docker Desktop 需要跑中继。等 Docker Desktop 支持按来源转发 UDP（见 [docker/for-win#1144](https://github.com/docker/for-win/issues/1144) 及相关 issue），这个临时办法就可以退休了。

**此前工作：** PR #413（`txhno`）曾提出只写文档的同一套绕过方案，本条目取代它。

---

## 10. 直接运行 sensing-server 时可视化页面报 `404`

**现象：** `sensing-server` 正常启动，日志显示 `HTTP server listening on http://localhost:3000`，但打开 `http://localhost:3000/`（或 `/ui/index.html`）却返回 `404 Not Found`。见 #188。

**根本原因：** 默认的 `--ui-path ../ui` 是相对**当前工作目录**解析的，不是相对可执行文件位置。路径不存在时，服务器还会再试 `./ui` 和 `../../ui`。从 `v2/` 启动没问题；从其他目录（包括 `v2/crates/wifi-densepose-sensing-server/`）启动就会错过仓库里的 UI，或者撞上别的 `ui` 目录，Axum 的静态文件处理于是返回 404。

**解决办法：** 传一个绝对路径、从 `v2/` 启动，或者改用 Docker 镜像（UI 已打包在 `/app/ui`）。

```bash
# 方案 A — 绝对路径（生产环境推荐）
sensing-server --source esp32 --udp-port 5005 --http-port 3000 \
  --ws-port 3001 --ui-path /absolute/path/to/ui

# 方案 B — 从 v2/ 启动（本地开发 / cargo run 可用）
cd v2
cargo run -p wifi-densepose-sensing-server -- --source esp32

# 方案 C — Docker（不用配路径）
docker compose -f docker/docker-compose.yml up sensing-server
```

**预防：** 后续工作记在 #188：当相对当前目录的路径不存在时，改为回退到相对可执行文件位置解析，这样无论从哪启动都能正常用。

---

## 11. 用 `--edge-tier 1` 或 `--edge-tier 2` 时出现启动循环

**现象：** ESP32-S3 用 `--edge-tier 0` 能正常启动，但同一份固件换成 `--edge-tier 1` 或 `2` 烧录后就不断重启。串口输出走到 `cpu_start` 和 `heap_init`，然后反复复位。#438 针对固件 `v0.4.3.1-esp32-3-g66e2fa083-dir` 报过。

**根本原因：** 边缘层级 1 和 2 会在 Core 1 上启用设备端 DSP 流水线。出问题的那个构建里，`edge_dsp` 任务跑的是不让出 CPU 的逐帧紧循环，触发了 Core 1 上的 FreeRTOS 任务看门狗并 panic。层级 0 只做直通、不启用流水线，所以不会触发看门狗。

**解决办法：** 烧录 [v0.4.3.1-esp32](https://github.com/ruvnet/RuView/releases/tag/v0.4.3.1-esp32) 或更新的版本——DSP 任务让出 CPU 的修复已经进了 `main`，晚于报告里那个构建。

```bash
# 确认当前版本（开机时串口输出里的 "App version"）
python -m serial.tools.miniterm COM7 115200
# 期望看到："App version: v0.4.3.1-esp32" 或更高
```

如果正式发布版仍然启动循环，请抓一份完整的串口日志（包含看门狗回溯），并带上新的构建哈希重新开 #438。
