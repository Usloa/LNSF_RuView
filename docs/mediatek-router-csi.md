# MediaTek 路由器 CSI（MT7981，实验性）

RuView 可以从 MediaTek Filogic 路由器读取信道状态信息（CSI），例如运行 OpenWrt
并打上 MediaTek 厂商 CSI 补丁、搭载 MT7976C 射频芯片的 MT7981B。路由器负责上报 CSI，
主机侧的桥接程序把它转换成 RuView 的 MTC1 线上格式（ADR-267），感知服务器再像处理
其他 UDP 数据源一样接收。

**状态：实验性。** 本页记录的是一条跑通了的数据通路，仅在一种板型上实测过，
**不对感知质量作任何宣称**。这条通路产出的帧带有来源标签 `mediatek:physical-unvalidated`。
ADR-266 的硬件关卡仍未关闭：校准、序号、时间戳、可重复性。

开发工作源自 whitsentry，一个基于 RuView 的项目。

下文用到的证据标记：**MEASURED**（带复现步骤）、**CODE-DERIVED**
（从源码或构建脚本读出，未在此处运行）、**CLAIMED**（有说法但未独立核实）、
**SYNTHETIC**（模拟或人为构造的数据）。

## 目录

- [支持的硬件](#supported-hardware)
- [数据通路是怎么走的](#how-the-path-works)
- [构建 OpenWrt 镜像](#build-the-openwrt-image)
- [在路由器上启用 CSI](#arm-csi-on-the-router)
- [运行桥接程序](#run-the-bridge)
- [启动感知服务器](#start-the-sensing-server)
- [这些数据是什么、不是什么](#what-the-data-is-and-is-not)
- [证据](#evidence)
- [排障](#troubleshooting)
- [参考资料](#reference)

<a id="supported-hardware"></a>
## 支持的硬件

| 板型 | SoC + 射频 | 状态 |
|---|---|---|
| Wavlink WL-WN586X3 **Rev A** | MT7981BA + MT7976CN（交换芯片 MT7531AE） | 在两台设备上跑过。两台采集到的 CSI 在下文做了离线分析（MEASURED）。向感知服务器的实时投递属于 CLAIMED，依据是本地运行日志，而日志不在仓库里。 |
| OpenWrt One | MT7981B + MT7976C | CLAIMED：按 OpenWrt 硬件表与 ADR-266 属于同款芯片，但未用这套补丁跑过。 |
| Xiaomi AX3000T | MT7981B + MT7976C | CLAIMED：按 OpenWrt 硬件表属于同款芯片，未用这套补丁跑过。 |
| 其他 MT7981/MT7986 板卡 | — | 未测试。CSI 补丁针对 `mt7915` 驱动系列，其他 Filogic 射频芯片也许能用，但这里没有任何证据。 |

`firmware/openwrt-wn586x3/` 里的板级补丁只适用于 WN586X3
**Rev A**。CSI 驱动补丁和两个用户态修复不依赖具体板型。

每颗 MT7976C 有**两条接收链**。WN586X3 的四根外置天线是一对 2.4 GHz 和一对 5 GHz，
并不是 4x4 阵列；两台路由器是两个独立接收机，不是一个相控阵。

<a id="how-the-path-works"></a>
## 数据通路是怎么走的

```
 路由器（OpenWrt 24.10.8）                         主机
 ┌────────────────────────────────┐               ┌──────────────────────────────┐
 │ mt76 + MediaTek CSI 补丁       │               │ wifi-densepose-mtk-bridge    │
 │   固件 MCU 事件 0xc2           │  JSON 转储    │   把各接收链组成帧，         │
 │ mt76-vendor dump csi  ─────────┼──────────────►│   执行来源门槛检查，         │
 │ CSIdump（UDP，可选） ──────────┼──── UDP ─────►│   输出 ADR-267 MTC1          │
 └────────────────────────────────┘               └──────────────┬───────────────┘
                                                                 │ UDP :5005
                                                  ┌──────────────▼───────────────┐
                                                  │ sensing-server               │
                                                  │   --source mediatek          │
                                                  │   /api/v1/csi/mediatek/*     │
                                                  └──────────────────────────────┘
```

从路由器出来有两条传输路径：

- **`mt76-vendor <iface> dump csi <n> <file>`** 写出一个 JSON 数组，每条记录对应
  一个接收链：时间戳、发射端地址、RSSI、SNR、带宽、PPDU 模式、收/发链编号、
  链标记以及 I/Q。这条路径信息更全，也是持续使用过的那条。你需要把文件拷到主机
  （例如用 SSH 循环拷贝），再通过桥接程序回放。
- **`CSIdump`**（MtkCSIdump）每个 UDP 数据报只发一根天线的数据，并且丢掉了
  RSSI、PPDU 模式和发射端身份。桥接程序对每个数据报输出一个 1x1 帧。这条路径
  曾以录制的形式端到端验证过一次，尚未作为常驻服务运行。

<a id="build-the-openwrt-image"></a>
## 构建 OpenWrt 镜像

补丁集位于 [`firmware/openwrt-wn586x3/`](../firmware/openwrt-wn586x3/README.md)。
它不是现成的固件镜像，请自行构建并核对哈希。

| 补丁 | 作用于 |
|---|---|
| `1001-mtk-mt76-mt7915-csi-implement-csi-support-REBASED.patch` | `mt76` 包（`package/kernel/mt76/patches/`） |
| `mt76-vendor-csi-dump-bounds.patch` | `mt76-vendor` 源码（`mediatek/mtk-openwrt-feeds` 里的 `feed/app/mt76-vendor/src/csi.c`） |
| `csidump-nl80211-attr-enum.patch` | MtkCSIdump 的 `src/wifi_drv_api/mt76_api.cpp`（仅在使用 CSIdump 时需要） |
| `0001-wn586x3-reva-single-image-sysupgrade-and-generic-spi-nor.patch` | `target/linux/mediatek`（仅 WN586X3 Rev A） |

产出已测镜像的路线（依据其构建脚本，属 CODE-DERIVED）使用原版 OpenWrt
**24.10.8** 的 `mediatek/filogic` SDK 与 ImageBuilder，在 x86_64 Linux 容器中完成：

1. **SDK。** 解压 `openwrt-sdk-24.10.8-mediatek-filogic`，然后执行
   `./scripts/feeds update -a && ./scripts/feeds install -a`。
2. **CSI 驱动。** 把 rebase 后的 `1001-...` 补丁拷入
   `feeds/base/package/kernel/mt76/patches/`。把该包的 `Makefile` 里 `PKG_RELEASE`
   调高（已测构建用的是 `99`），让 ImageBuilder 优先选用你构建的版本，而不是
   CDN 上同版本号的包。
3. **mt76-vendor。** 从 `mtk-openwrt-feeds` 加入 MediaTek 的 `mt76-vendor` 包，
   放为 `package/mt76-vendor`，并对 `src/csi.c` 应用边界补丁。
4. **配置与编译。** 选中 `CONFIG_TARGET_mediatek_filogic_DEVICE_wavlink_wl-wn586x3`、
   `kmod-mt7915e`、`mt76-vendor`、`libnl-tiny`，然后执行
   `make package/feeds/base/mt76/compile package/mt76-vendor/compile`。
5. **出镜像。** 把构建好的 `.ipk` 文件拷进 ImageBuilder 的 `packages/`，再执行：
   ```bash
   make image PROFILE=wavlink_wl-wn586x3 \
     PACKAGES="kmod-mt7915e kmod-mt7981-firmware mt7981-wo-firmware mt76-vendor libnl-tiny"
   ```
6. **核对清单。** 镜像的 `.manifest` 里，`kmod-mt7915e` 必须是你调高后的发行号
   （例如 `-r99`），并且要有 `mt76-vendor`。如果列的是 CDN 发行号，这个镜像就没有 CSI。

**Rev A 板级补丁。** ImageBuilder 不能编译设备树，它的 `make image` 会复用预构建的
DTB 与 FIT 内核。已测的 Rev A 构建自行编译了打补丁的 DTB，围绕它重建 FIT 内核，
把打过补丁的 `lib/upgrade/platform.sh` 作为 rootfs 覆盖层加入，最后确认最终的
sysupgrade 镜像确实内嵌了该 DTB。完整的 OpenWrt buildroot 会直接应用 `target/`
补丁，可以省掉这些步骤，但这条路线在此处未测试。

只给 Rev A 设备刷机，保留原厂固件备份，并遵循该板型的 OpenWrt wiki 与论坛帖操作。
本指南和补丁集都不提供 LAN 地址、账号或密码。

**固件 blob。** CSI 上报对应 MCU 事件 `0xc2`。已测镜像里的 MT7981 固件
（来自 OpenWrt 24.10.8 的 `kmod-mt7981-firmware`、`mt7981-wo-firmware`）本身就会
发出该事件，因此在已测板卡上无需替换固件 blob。其他固件版本未测试。

<a id="arm-csi-on-the-router"></a>
## 在路由器上启用 CSI

CSI 跟随**已关联客户端**的流量。若没有设备关联并在发送数据，就没有 CSI。
以下命令在路由器上以 root 身份、针对 AP 接口执行（已测板卡的 2.4 GHz AP 是
`phy0-ap0`）。下面这套顺序依据已测板卡所用的采集脚本，属 CODE-DERIVED：

```sh
mt76-vendor phy0-ap0 set csi ctrl=0,0,0,0      # 解除启用并复位
mt76-vendor phy0-ap0 set csi interval=1000
mt76-vendor phy0-ap0 set csi ctrl=2,3,0,34     # 帧类型过滤，按已测板卡
mt76-vendor phy0-ap0 set csi ctrl=2,9,1,0      # 所用写法（数据帧）
mt76-vendor phy0-ap0 set csi ctrl=1,0,0,0      # 启用
```

确认驱动正在采集：

```sh
cat /sys/kernel/debug/ieee80211/phy0/mt76/csi_stats   # data_cnt 应持续增长
iw dev phy0-ap0 station dump | grep -E "Station|signal"
```

拉取一批数据：

```sh
rm -f /tmp/csi.json                         # 该工具是追加写入；先删掉旧文件
mt76-vendor phy0-ap0 dump csi 64 /tmp/csi.json
```

`dump csi` 必须带文件名参数，否则工具不返回任何内容。

<a id="run-the-bridge"></a>
## 运行桥接程序

```bash
cd v2
cargo build --release -p wifi-densepose-mtk-bridge
B=./target/release/wifi-densepose-mtk-bridge
```

**转储路径（推荐）。** 把 `/tmp/csi.json` 拷到主机后回放。文件本身无法证明它来自
真实射频，因此 `--replay` 在你明确声明硬件来源或声明文件为合成数据之前会拒绝启动：

```bash
$B --replay csi.json --captured-on <model>/<firmware> \
   --node <node-name> --center-freq-khz <khz> --sink 127.0.0.1:5005
```

- `--node` 会被哈希进 64 位的 `device_id`，请给每台路由器起各自的名字。
- `--center-freq-khz` 是 AP 信道的中心频率，例如 2.4 GHz 第 6 信道为 `2437000`。
- `--captured-on` 接受 `<model>/<firmware>`，例如
  `WN586X3-RevA/openwrt-24.10.8-csi`，启动时会写入日志。

需要连续数据时，把「转储 → 拷贝 → 回放」循环执行，每台路由器一个循环。
只在确有需要时保留转储副本，且**绝不要提交**（见下文）。

**流式路径（CSIdump）。** 在路由器上启动 `CSIdump phy0-ap0 <rate> 8888`，
然后在主机上执行：

```bash
$B --listen 0.0.0.0:8888 --csidump <router-ip>:8888 --listen-allow <router-ip> \
   --node <node-name> --center-freq-khz <khz> --sink 127.0.0.1:5005 \
   --record captures/<node-name>.mtkcap
```

`--listen-allow` 是必填项。来自其他来源的数据报会被丢弃并计数。CSIdump 收到
SIGTERM 时会关闭 CSI。转储路径与 CSIdump 不能共用驱动的环形缓冲区，只能二选一。

**没有路由器。** 人为构造的样例可以跑通整条主机侧链路。回放时必须带 `--synthetic`，
服务器会把它标为 `mediatek:simulated`：

```bash
$B --replay crates/wifi-densepose-mtk-bridge/fixtures/FABRICATED-mt76-vendor-dump-mt7981-bw80.synthetic.json \
   --synthetic --node demo --sink 127.0.0.1:5005
```

ADR-266 模拟器是另一个合成数据源：

```bash
cargo run -p wifi-densepose-hardware --bin mediatek-csi-sim -- \
  --profile mt7981 --udp 127.0.0.1:5005 --frames 1000 --realtime
```

完整参数说明见 [`v2/crates/wifi-densepose-mtk-bridge/README.md`](../v2/crates/wifi-densepose-mtk-bridge/README.md)。

<a id="start-the-sensing-server"></a>
## 启动感知服务器

```bash
cd v2
cargo run --release -p wifi-densepose-sensing-server -- --source mediatek \
  --activity-state <state-dir>/activity-floor.json
```

- `--source mediatek` 会绑定 UDP 接收端（默认回环地址，ADR-296），并且**不会**
  启动 ESP32 形态的模拟器。在这个数据源出现之前，`--source mediatek` 不绑定任何东西。
- 若桥接程序运行在另一台主机上，用 `--udp-bind` 绑定可路由地址，并用 `--udp-allow`
  指明桥接程序所在主机。
- `--activity-state` 可选。它把每台设备学到的「安静房间活动基线」持久化，重启后
  无需重新学习。
- `--csi-ring <n>` 设置每台设备保留供查看的帧数（默认 256；64 子载波的 2x2
  设备约占 0.5 MiB）。

接口：

| 路由 | 返回内容 |
|---|---|
| `GET /api/v1/csi/mediatek/latest` | 最新一帧 MTC1 快照，不限设备 |
| `GET /api/v1/csi/mediatek/devices` | 每个 `device_id` 一份快照，附 `age_ms`。静默超过 30 秒的设备不列出 |
| `GET /api/v1/csi/mediatek/devices/:device_id/frames?n=&fields=amp,phase` | 最新 `n` 帧的逐链接、逐子载波幅度与相位 |
| `GET /api/v1/csi/mediatek/devices/:device_id/summary` | 逐链接逐子载波的幅度均值/标准差、各 Rx 链 RSSI、帧率、启发式窗口统计 |
| `GET /api/v1/csi/mediatek/activity?seconds=300` | 约 1 Hz 的相对活动指数历史 |
| `GET /api/v1/sensing/latest` | 房间状态更新。在此数据源上 `classifier` 为 `mediatek-amplitude-heuristic-v0` |

每份快照都要核对标签：

| `source` | 含义 |
|---|---|
| `mediatek:simulated` | 已置 `SYNTHETIC` 标记，下游任何环节都无法清除 |
| `mediatek:physical-unvalidated` | 真实芯片，但未校准。这条通路目前产出的全部数据都属于此类 |
| `mediatek` | 真实且已校准。保留值，目前没有任何来源会输出它 |

<a id="what-the-data-is-and-is-not"></a>
## 这些数据是什么、不是什么

**它是**：来自真实 MT7976C 射频芯片、按接收链给出的复信道估计，并在端到端传输中
完整保留了来源标记。

**它不是**：

- **自带时钟的传感器。** 上报速率取决于客户端的流量速率。闲置手机每秒只有几帧，
  忙的时候可以有几百帧；没有已关联且在发送的客户端，就没有数据。持续向 AP 发送的
  固定设备（「照明源」，例如稳定发包流的 ESP32）能给出规律速率
  （CLAIMED：下文 09-20 与 09-24 的采集包含照明源的帧，但本次分析未复核发射端身份）。
- **已校准。** `scale` 为原始固件单位下的 1.0，没有与任何基准比对过。ADR-266 的
  关卡仍然开放。
- **在场、运动或生命体征方面经过验证。** 此数据源上的房间输出来自
  `mediatek-amplitude-heuristic-v0`（由平均幅度判断在场与运动）和
  `activity-index-v0`（相对已学到的基线做波动判断）。两者都是 **CLAIMED**，
  都没有拿标注好的真值打过分。`activity` 数据块带有
  `is_occupancy_estimate: false`。这些输出不会进入已经验证过的 ESP32 生命体征流水线。
- **跨路由器相干。** 每台射频芯片有自己的振荡器。跨链相位在同一台设备内有意义，
  在两台设备之间没有意义。
- **不含个人数据。** 原始转储里有客户端发射端地址（MAC）以及能反映移动的信道采样。
  RuView 的规定（ADR-299）禁止提交采集文件。把它们挡在仓库之外，并在涉及采集目录
  的提交前运行 `scripts/csi-data-policy-check.sh --staged`。

<a id="evidence"></a>
## 证据

| 结论 | 标记 | 依据 |
|---|---|---|
| 一帧真实的 WL-WN586X3 数据能解码并以 `mediatek:physical-unvalidated` 送达服务器 | MEASURED (path) | 2026-09-19 首条记录：legacy OFDM、20 MHz、64 子载波、单链接。其形状由 `wifi-densepose-mtk-bridge/tests/hardware_capture.rs` 固定，该测试用的是构造记录。采集文件本身不在仓库里。 |
| 单颗 MT7976C 上的跨链相位逐帧稳定，而逐链原始相位不稳定 | MEASURED (offline) | 见下文 |
| `mediatek-amplitude-heuristic-v0`、`activity-index-v0` | CLAIMED | 无标注评估 |
| ADR-266 模拟器与桥接样例文件 | SYNTHETIC | 在线路上已标注 |

**跨链相位稳定性。** 数据来自两台 WN586X3 的六次本地转储采集，2.4 GHz、
20 MHz HT 帧，携带 (tx0, rx0) 与 (tx0, rx1) 两条链，相邻帧间隔小于 100 ms，
56 个子载波（排除 DC 与保护频点）。两次 2026-09-19 的采集做了全量分析，
09-20 与 09-24 的四次各取前 20 MB。

| 相邻帧步进上的量 | 采样充分的发射端（6 个，各 825 至 14,104 帧） |
|---|---|
| 逐链原始相位 `arg(H0[k])`，逐频点 p50 | 1.557 至 1.601 rad，其中 49.6% 至 50.9% 的步进超过 π/2 |
| 跨链相位 `arg(H0[k]·conj(H1[k]))`，逐频点 p50 | 0.023 至 0.056 rad |
| 跨链相位按频点相干求和，p50 / p90 / p99 | 0.014–0.039 / 0.205–0.358 / 0.437–0.820 rad |

均匀分布随机相位的步进 p50 为 π/2 = 1.571 rad，且有一半步进超过 π/2。
逐链原始相位与之无法区分，这符合逐包 CFO 与相位偏移的预期；在跨链项里这些偏移
相互抵消，步进降到百分之几弧度。步进做了相位回绕，因此 p99 永远不会超过 π，
这一点本身不构成证据。

帧数少且不规律的发射端（229 至 595 帧）表现明显更差：相干求和 p50 为
0.177 至 0.456 rad，p99 为 1.857 至 2.849 rad。所以上述结论只在帧率稳定时成立。

这说明单台设备内部**存在一个稳定的可观测量**，但**并不能**说明这个可观测量
能追踪人的活动、呼吸或任何其他东西。

在自己的采集上复现（每行一个 `dump csi` 数组）：

```bash
python3 scripts/mediatek-csi-phase-stability.py <capture.jsonl> [max_MB]
```

脚本把发射端输出为 `TX-A`、`TX-B` 等，从不输出地址。

<a id="troubleshooting"></a>
## 排障

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `csi_stats` 的 `data_cnt` 一直是 0 | 没有已关联并在发送的客户端，或 CSI 未启用 | 关联一个客户端并产生流量，然后重跑启用序列 |
| 客户端漫游或过滤条件变更后 `data_cnt` 不再增长 | 改动 CSI 过滤条件会停止采集 | 重跑以 `ctrl=1,0,0,0` 结尾的启用序列。定期重新启用是合理的防护做法 |
| `mt76-vendor dump csi` 什么也不输出 | 没给文件名参数 | 用 `dump csi <n> <file>` |
| `mt76-vendor dump csi` 段错误 | 工具未打补丁：驱动可能返回 n+1 条记录 | 用 `mt76-vendor-csi-dump-bounds.patch` 重新构建 |
| 桥接程序警告 `(ta, ts, tx_idx, rx_idx)` 链重复 | 两次转储之间没删文件，而工具是追加写入 | 每次转储前 `rm -f` 该文件 |
| `--replay` 拒绝启动 | 未声明来源 | 加 `--captured-on <model>/<firmware>`；构造数据则加 `--synthetic` |
| `--captured-on` 被拒绝 | 输入自己声明为合成数据（sidecar、文件名含 `.synthetic.`、或采集头部） | 符合预期。合成标记是粘性的，请改用 `--synthetic` |
| `--listen` 拒绝启动 | 缺 `--listen-allow` | 指明路由器地址或网段 |
| `--listen` 上 `rejected_source` 计数增长 | 路由器地址不在 `--listen-allow` 里 | 修正允许列表 |
| CSIdump 在跑但收不到数据 | 未打补丁的 CSIdump 对本驱动用了差一位的 netlink 属性枚举 | 用 `csidump-nl80211-attr-enum.patch` 重新构建 |
| CSIdump 退出后 CSI 停了 | CSIdump 在 SIGTERM 时会关闭 CSI | 重跑启用序列 |
| `/api/v1/csi/mediatek/devices` 为空 | 服务器没用 `--source mediatek`（或用了 `auto` 但没开 UDP）、`--sink` 端口不对、或桥接程序不在回环地址却没进 `--udp-allow` | 检查 `--source`、5005 端口、`--udp-bind` 与 `--udp-allow` |
| 两台路由器显示成一台设备 | 两个桥接程序用了同一个 `--node` | 给每台路由器各自的 `--node`（或 `--device-id`） |
| 某帧显示 `ppdu_type: legacy` | 正常。关联与管理流量本就是 pre-HT | 无需处理。ADR-267 修订 1 会携带这些帧而不是丢弃 |
| 某设备的房间状态是 `unknown` | 启发式判断低于置信阈值而弃权 | 帧稀疏时属正常，这不等于判定「无人」 |
| 房间显示 `absent` 且 `confidence: 0.0` | 所有设备都弃权，等于没有任何证据 | 把置信度 0 当成「无信息」，而不是「房间空的」 |
| 镜像刷进去了，却没有 `mt76-vendor` 或 CSI | ImageBuilder 用了 CDN 上的 `kmod-mt7915e` | 核对清单里是不是你调高后的 `PKG_RELEASE` |

<a id="reference"></a>
## 参考资料

- [ADR-266：MediaTek Filogic CSI 平台](adr/ADR-266-mediatek-filogic-csi-platform.md)（修订 1：MT7981 上的厂商 CSI）
- [ADR-267：MediaTek MIMO CSI 线上协议](adr/ADR-267-mediatek-mimo-csi-wire-protocol.md)（修订 1：`Legacy` 与 `Unknown` PPDU 类型）
- [`firmware/openwrt-wn586x3/`](../firmware/openwrt-wn586x3/README.md)：补丁、许可与来源
- [`v2/crates/wifi-densepose-mtk-bridge/`](../v2/crates/wifi-densepose-mtk-bridge/README.md)：桥接传输方式、来源规则、帧映射
- [MediaTek OpenWrt feeds](https://git01.mediatek.com/openwrt/feeds/mtk-openwrt-feeds/)、[MtkCSIdump](https://github.com/MtkWifiRev/MtkCSIdump)、[OpenWrt One](https://openwrt.org/toh/openwrt/one)
