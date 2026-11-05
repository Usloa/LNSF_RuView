# RuView ↔ HomePod 接入指南

**面向 Apple 家庭 App 的环境感知。** 把 RuView 作为原生 HomeKit 配件运行，HomePod 就能发现它、Siri 能听懂它、Apple 家庭自动化能调用它 —— 不需要 Home Assistant。

---

## 架构总览

RuView 把 WiFi 无线电反射转换成空间信息（在场、呼吸、跌倒风险、活动规律）。配上一台作为家庭中枢的 HomePod 或 Apple TV，RuView 就成了一个隐形传感器，为 Siri、自动化和场景提供数据：

```
ESP32-C6 CSI 节点（客厅）
  ↓（UDP 特征流）
RuView 感知服务器（上报在场、生命体征、BFLD 事件）
  ↓（HTTP 轮询）
HAP 桥接（通过 mDNS 广播 HomeKit 配件）
  ↓（Bonjour 发现）
HomePod 或 Apple TV（家庭中枢）
  ↓（转发到家庭 App + Siri）
iPhone、iPad、Mac、Watch、Apple 家庭自动化
```

这套接入基于 HomeKit Accessory Protocol（HAP-1.1）—— 与 Philips Hue、Eve、Nanoleaf 用的是同一个标准。桥接启动后几秒内 HomePod 就能发现它，在家庭 App 里点一下即可配对，Siri 查询立刻可用：*"嘿 Siri，客厅有人吗？"*

设计理由与隐私保护见 [ADR-125 — RuView ↔ Apple Home 原生 HAP 桥接](docs/adr/ADR-125-ruview-apple-home-native-hap-bridge.md)。

---

## 目前已交付的功能（第 1 层 + 第 2 层）

PR #797 在 `feat/adr-125-apple-fabric` 分支上分八次迭代落地：

| 迭代 | 能力 | 提交 | 状态 |
|-----------|-----------|--------|--------|
| 1 | 多特征 HomeKit 配件（Motion + Occupancy + StatelessProgrammableSwitch） | `48db60a65` | 运行时已跑通 |
| 2 | 供桥接轮询的感知服务器 HTTP 接口（`/api/v1/vitals`、`/api/v1/bfld`、`/api/v1/semantic-events`） | `194a2e163` | 运行时已跑通，curl 验证过 |
| 3 | 支持 N 个子配件的 HAP 桥接；按房间应答 Siri（给每个房间命名，Siri 会念出来） | `63b77f760` | 运行时已跑通，两个桥接同时广播 |
| 4 | 按 §2.1.d 实现的语义事件接口（`Unknown Presence`、`Unexpected Occupancy`、`Unrecognized Activity Pattern`） | `3d30261e7` | 运行时已跑通，隐私约束 I1 生效 |
| 5 | rvagent MCP 消费端（智能体链路）；面向 Claude Code 的 12 个 MCP 工具 | `c19742d71` | 在真实 C6 上验证过 |
| 6 | PyO3 BFLD PrivacyClass 绑定（把 Rust crate 暴露给 Python） | `de0712d43` | 源码构建通过（`cargo check` 通过） |
| 7 | 用「快捷指令」做粘合（launchd 任务 + 经 iCloud 家庭图谱在 HomePod 上朗读文本，绕开 Bonjour 障碍） | `d0525359d` | 运行时验证过，osascript 触发正常 |
| 8 | 供 Eve.app 展示的自定义特征 UUID 骨架（设计完成；HAP-python JSON 加载器的运行时支持待补） | `3bb8c1621` | 仅完成设计骨架 |

**现在就能做的事：**

- 在 iPhone、iPad 或 Mac 的家庭 App 里配对一个 RuView 桥接。
- 向 Siri 询问具体房间的在场情况（「家里有人吗」「办公室有人吗」「有人摔倒了吗」）。
- 用「检测到在场」「检测到呼吸」「跌倒风险」「活动规律异常」来触发自动化。
- 通过「快捷指令粘合」通路（第 2 层）把 RuView 事件推送到 HomePod 播报。
- 通过智能体 MCP 接口以编程方式查询 RuView 数据（Claude Code 接入）。

---

## 快速上手（5 分钟）

### 前置条件

- **硬件**：运行 CSI 固件（v0.7.0 及以上）的 ESP32-C6，与 Mac、HomePod 在同一 WiFi 网络。
- **软件**：Mac 上装 Python 3.8+，且该 Mac 已登录 iCloud 并加入家庭 App。
- **网络**：Mac、HomePod、ESP32-C6 必须在同一个局域网网段（例如 `192.168.1.0/24`）。

### 第 1 步：配置 ESP32-C6

用 USB 接上 C6，运行配置脚本：

```bash
python firmware/esp32-csi-node/provision.py \
  --port /dev/ttyUSB0 \
  --ssid "YourWiFiSSID" \
  --password "YourWiFiPassword" \
  --target-ip 192.168.1.20
```

确认 C6 已联网启动：

```bash
ping 192.168.1.20
```

### 第 2 步：在 Mac 上建 Python 虚拟环境并安装 HAP-python

```bash
mkdir -p ~/ruview-hap
cd ~/ruview-hap
python3 -m venv venv
source venv/bin/activate
pip install HAP-python
```

### 第 3 步：把 RuView 桥接脚本拷到 Mac

从仓库（例如已克隆到 Mac 上）拷贝这些文件：

```bash
cp scripts/c6-presence-watcher.py ~/ruview-hap/
cp scripts/ruview-sensing-server.py ~/ruview-hap/
cp scripts/ruview-hap-bridge.py ~/ruview-hap/
```

### 第 4 步：按顺序启动三个后台进程

**终端 1：启动 C6 在场监视器**（读取 C6 的 UDP 包，执行 BFLD 隐私门槛）

```bash
cd ~/ruview-hap
source venv/bin/activate
python c6-presence-watcher.py --node-id 1 --esp32-ip 192.168.1.20 --privacy-class 2
```

输出：把在场事件写到 `/tmp/ruview-state.json`。

**终端 2：启动感知服务器**（供 HAP 桥接轮询的 HTTP 接口）

```bash
cd ~/ruview-hap
source venv/bin/activate
python ruview-sensing-server.py --port 3000
```

输出：监听 `http://127.0.0.1:3000/api/v1/...`。

**终端 3：启动 HAP 桥接**（通过 mDNS 广播 HomeKit 配件）

```bash
cd ~/ruview-hap
source venv/bin/activate
python ruview-hap-bridge.py --port 51826 --pin 200-70-910
```

输出：在终端里找配对码，例如 `Setup code: 200-70-910`。

### 第 5 步：用 iPhone 配对桥接

1. 打开 iPhone 上的**家庭** App。
2. 点右上角 **+** → **添加配件**。
3. 扫描配对码（或点**没有配对码或无法扫描？** → **更多选项**）。
4. 从列表里选中 **RuView Sense** 桥接（一般 10 秒内出现）。
5. 分配到某个房间（例如「客厅」）。
6. 点**完成**。

### 第 6 步：用 Siri 测试

配对后，问 Siri：

```
"嘿 Siri，客厅有人吗？"
```

Siri 会回答当前的占用状态。从 C6 前走过再问一次，在场数值应在 1～2 秒内更新。

---

## 扩展到多个房间

要监测多个房间，就运行多个 C6 节点，每个节点配一个独立的 `c6-presence-watcher.py` 实例：

```bash
# 终端：房间 1（客厅，node_id=1）
python c6-presence-watcher.py --node-id 1 --esp32-ip 192.168.1.20 \
  --output /tmp/ruview-state.living-room.json

# 终端：房间 2（卧室，node_id=2）
python c6-presence-watcher.py --node-id 2 --esp32-ip 192.168.1.21 \
  --output /tmp/ruview-state.bedroom.json

# 终端：HAP 桥接（自动发现两个状态文件）
python ruview-hap-bridge.py --port 51826 --rooms "Living Room,Bedroom"
```

HAP 桥接会自动发现 `/tmp/ruview-state*` 下的 `*.json` 文件，并为每个房间创建一个子 HomeKit 配件。每个房间在家庭 App 里单独出现，可分别分配到对应的物理位置。

---

## 隐私语义

RuView 的 BFLD（用于检测的波束成形反馈层）用**隐私等级**门槛来限定哪些数据可以越过 HomeKit 边界。只有 2 级和 3 级（匿名、受限）符合条件；0/1 级（原始身份信息）永不外泄。

### 三种语义事件

HomeKit 暴露的是**经过阈值判断的事件**，不是原始概率：

| 事件 | HomeKit 特征 | 含义 | 自动化示例 |
|-------|----------------------|---------|-------------------|
| **Unknown Presence**（未知在场） | MotionSensor（有状态） | 检测到人，且超过 30 秒没有匹配的身份记录 | 「晚上 9 点后出现未知在场时打开门廊灯」 |
| **Unexpected Occupancy**（意外占用） | OccupancySensor | 占用发生在操作者设定的时段之外 | 「周末办公室有人时发通知」 |
| **Unrecognized Activity Pattern**（未识别的活动规律） | ProgrammableSwitch（瞬时） | 活动发生漂移，或触发重新校准门槛 | 「活动规律变化时重新跑一遍学习流程」 |

### 刻意不外露的内容

以下信息**绝不**暴露给 HomeKit：

- `identity_risk_score`（0～1 的数值置信度）—— 越过边界的只有经过阈值判断的语义事件
- Soul-Signature 匹配概率 —— 属于 BFLD 内部状态
- `rf_signature_hash` —— 加密内部状态

这落实了 **ADR-125 §2.1.d 的约束 I1**：原始身份信息绝不离开节点。采用语义化表述是刻意设计的 —— 「未知在场」读起来是*这里有人、没什么问题、但值得留意*，而不是一种指认。

技术定义见 [ADR-118 — 用于检测的波束成形反馈层](docs/adr/ADR-118-bfld-beamforming-feedback-layer-for-detection.md)。

---

## 按房间应答 Siri

给每个 HomeKit 配件取房间的名字。HAP 桥接从状态文件的前缀里读取房间名：

```bash
python c6-presence-watcher.py --node-id 1 \
  --output /tmp/ruview-state.LIVING_ROOM.json

# HAP 桥接读到后，把配件命名为「客厅」
```

在家庭 App 里配对后，Siri 就知道房间了：

| 问法 | 结果 |
|-------|--------|
| 「客厅有人吗？」 | 查询客厅配件的运动传感器 |
| 「家里有人吗？」 | 查询所有房间配件；任一检测到运动就返回真 |
| 「检测到有人时打开卧室灯」 | 只在卧室配件上触发自动化 |

### 用 StatelessProgrammableSwitch 做自动化

每个房间还会暴露一个 **StatelessProgrammableSwitch**，在语义事件边界（未识别的活动规律、重新校准等）触发。这是 HomeKit 里用于瞬时触发的基础组件：

1. 在家庭 App 里进入**自动化** → **创建自动化** → **当配件被控制时**。
2. 选择**客厅** → **可编程开关** → **单次按下**。
3. 添加动作：*开启场景*、*发送通知*、*设置 HomeKit 安全视频录制*等。

---

## 通过「快捷指令」在 HomePod 上播报（第 2 层通路）

让 HomePod 播报 RuView 事件，最简单的办法是**用快捷指令做粘合** —— 一个 macOS 原生的 launchd 任务监视 RuView 的语义事件，并触发你定义的快捷指令。

这条路径**绕开了 Bonjour 反射障碍**：在某些 Mesh 网络里，该问题会导致 HomePod 无法被发现。它不直接走 mDNS，而是由 Mac 借助家庭图谱（已与 iCloud 配对）联系 HomePod。

### 一次性配置

#### 1. 在「快捷指令」App 里创建快捷指令

1. 在 Mac 上打开**快捷指令** App。
2. 点左上角 **+** → **创建快捷指令**。
3. 点**添加操作** → 搜索 **「朗读文本」** → 添加。
4. 在**「朗读文本」**操作里点**扬声器图标** → 选中你的 **HomePod**（或 HomePod mini）。
5. 把快捷指令命名为 **`RuView Announce`**（名称要完全一致）。
6. 点右上角**存储**。

#### 2. 从终端测试快捷指令

```bash
osascript -e 'tell application "Shortcuts Events" to run shortcut "RuView Announce" with input "Test from RuView"'
```

HomePod 应该用你选的声音念出「Test from RuView」。

#### 3. 安装 launchd 任务

从仓库拷出 launchd plist：

```bash
cp scripts/macos-shortcuts/ruview-watcher.plist \
  ~/Library/LaunchAgents/com.ruvnet.ruview.watcher.plist

launchctl load ~/Library/LaunchAgents/com.ruvnet.ruview.watcher.plist

launchctl list | grep ruvnet  # 确认已加载
```

#### 4. 验证生效

在一个终端里跟踪日志：

```bash
tail -f /tmp/ruview-watcher.log
```

在另一个终端从 C6 前走过，触发一次在场检测。日志里应出现：

```
[17:10:12] unknown_presence 上升沿 → 运行 'RuView Announce'
```

随后 HomePod 会用配置好的声音播报该事件。

### 扩展到多个房间

想让不同房间播报不同事件，就在「快捷指令」App 里创建多个快捷指令：

- `RuView Announce Kitchen`
- `RuView Announce Bedroom`

再用不同的 `--shortcut-name` 参数跑多个监视任务：

```bash
# 厨房事件，由厨房的 HomePod mini 播报
scripts/macos-shortcuts/announce-via-homepod.sh \
  --node-id 1 --event unknown_presence \
  --shortcut-name "RuView Announce Kitchen" \
  --poll-interval 2 &

# 卧室事件，由卧室的 HomePod 播报
scripts/macos-shortcuts/announce-via-homepod.sh \
  --node-id 2 --event unknown_presence \
  --shortcut-name "RuView Announce Bedroom" \
  --poll-interval 2 &
```

### 再往前走一步

快捷指令可以在「快捷指令」App 里由操作者自行修改，因此你可以随意扩展：

- **激活场景**（「检测到跌倒风险时开启睡前场景」）
- 向 Apple Watch **发送通知**
- **调用 Webhook** 对接其他系统
- 给别人 iPhone **发消息**
- **触发 HomeKit 安全摄像头录制**

这正是「快捷指令粘合」的灵活性 —— RuView 不用改一行代码，所有定制都留在操作者自己的快捷指令库里。

完整配置与排障见 [`scripts/macos-shortcuts/README.md`](scripts/macos-shortcuts/README.md)。

---

## 通过 MCP 供智能体调用

RuView 的感知数据流也可以通过 Model Context Protocol（MCP）获取 —— 这是 Claude Code 等 AI 智能体查询 RuView 数据的标准接口。

### `@ruvnet/rvagent` npm 包（v0.1.0）

这个包暴露 **12 个 MCP 工具**，让 Claude Code 智能体可以：

- 查询各房间的在场与占用情况
- 读取呼吸率与心率数据
- 监视 BFLD 语义事件
- 查看应用注册表（边缘模块）
- 启动后台训练任务

### 安装

在你的 Claude Code 项目里：

```bash
npm install -D @ruvnet/rvagent@0.1.0

# 或者通过 MCP 添加：
claude mcp add rvagent -- npx -y @ruvnet/rvagent@0.1.0
```

然后在 Claude Code 对话里：

```
/claude-flow-help  # 列出所有可用的 MCP 工具
```

### 工具说明

| 工具 | 输入 | 输出 |
|------|-------|--------|
| `ruview_csi_latest` | node_id | 最新 CSI 窗口（1024 子载波，30 个 OFDM 符号） |
| `ruview_pose_infer` | CSI 窗口 | 17 关键点骨架（每个关节的 x、y、置信度） |
| `ruview_count_infer` | CSI 窗口 | 人数 + 95% 置信区间 |
| `ruview_registry_list` | query（可选） | 可用的 105+ 个边缘模块列表 |
| `ruview_train_count` | epochs、learning_rate | 启动训练任务，返回任务 ID |
| `ruview_job_status` | job_id | 进度、预计剩余时间、当前损失 |
| `ruview.bfld.last_scan` | node_id | 最新 BFLD 扫描：privacy_class、person_count（按约束 I1，identity_risk_score=null） |
| `ruview.bfld.subscribe` | node_id、event_filter | 持续推送 BFLD 窗口，直到关闭流 |
| `ruview.presence.now` | room（可选） | 各房间当前占用情况 |
| `ruview.vitals.get_breathing` | node_id | 呼吸率（BPM）+ 置信度 |
| `ruview.vitals.get_heart_rate` | node_id | 心率（BPM）+ 置信度 |
| `ruview.vitals.get_all` | node_id | 呼吸 + 心率 + 元数据 |

### 示例：Claude Code 智能体流程

```python
# Claude-flow 智能体伪代码
import claude_code

tools = claude_code.mcp_tools("rvagent")

# 查询最新在场状态
presence = tools["ruview.presence.now"](room="living room")
print(f"Living room occupancy: {presence.occupancy}")  # True/False

# 查看生命体征
vitals = tools["ruview.vitals.get_all"](node_id=1)
print(f"Breathing: {vitals.breathing_bpm} BPM")

# 实时接收 BFLD 事件
for event in tools["ruview.bfld.subscribe"](node_id=1, event_filter="unknown_presence"):
    print(f"Unknown presence detected: privacy_class={event.privacy_class}")
```

完整 MCP 规格见 [ADR-124 — rvagent MCP / RuVector npm 集成](docs/adr/ADR-124-rvagent-mcp-ruvector-npm-integration.md)。

---

## 排障

### 在 Mac 上执行 `dns-sd -B _airplay._tcp local.` 看不到 HomePod

**可能原因**：HomePod 与 Mac 虽然连着同一个 SSID，却处在不同网段。部分 Mesh 网络会把 2.4 GHz 与 5 GHz 分到不同的 `/24` 网段，或把访客设备放进单独的 VLAN。

**排查**：

1. 打开路由器管理页，确认 HomePod 和 Mac 在同一网段内（例如都是 `192.168.1.x`）。
2. 如果确实不同网段（如 `192.168.1.x` 与 `192.168.100.x`），在路由器设置里开启 **IGMP Proxying**（Netgear Nighthawk 上常见）。若有 **Bonjour Repeater** 或 **mDNS Reflector**，优先开这两个。
3. 重启 HomePod 和 Mac。

**注意**：**「快捷指令粘合」通路（第 2 层）不需要这项修复** —— 它经 iCloud 家庭图谱转发播报，不走 mDNS。

### iPhone 配对时报「无法添加配件」

**可能原因**：HAP 桥接的配对状态损坏，或与 mDNS 不同步。

**处理**：

1. 停掉 HAP 桥接进程。
2. 删除配对状态文件：
   ```bash
   rm -rf ~/.ruview-hap-prod/accessory.state
   ```
3. 重启 HAP 桥接 —— 它会生成新的配对码。
4. 在家庭 App 里用新配对码重试**添加配件** → **更多选项**。

### 每次重启配对码都会变

**属于正常现象。** 如果配对持久化文件缺失或损坏，HAP-python 会重新生成配对码。配对成功后，配对密钥单独存放在 `~/.ruview-hap-prod/`，重启不会丢失 —— 配对码本身是临时的，只在首次配对时有用。

如果配对前把配对码弄丢了，删掉状态文件重启即可获得新的。

### 在场状态更新变慢或卡住

**可能原因**：`ruview-sensing-server.py` 的 HTTP 轮询循环被阻塞，或 C6 没有发送 UDP 包。

**排查**：

1. 确认 C6 已启动：`ping 192.168.1.20`。
2. 确认感知服务器收到了包：
   ```bash
   nc -u -l 5005 &  # 监听 UDP 5005
   # 应能偶尔看到来自 C6 的数据包
   ```
3. 手动查询感知服务器：
   ```bash
   curl http://127.0.0.1:3000/api/v1/vitals/latest
   ```
   应返回含呼吸与心率字段的 JSON。
4. 如果轮询后 HAP 桥接仍没反映变化，重启桥接。

---

## 不在本次范围内

以下条目是刻意延后或超出当前版本的：

| 条目 | 状态 | 时间安排 |
|------|--------|----------|
| **Matter 协议（P3）** | 已延后 | 等 `matter-rs` SDK 稳定；HAP-1.1 目前已覆盖 95% 的使用体验 |
| **Rust 原生 HAP（P2）** | 计划中 | 替代 Python 的 `HAP-python` 附属进程；预计在收集 5 次以上真实配对的反馈后推进 |
| **PyO3 BFLD wheel 发布（ADR-117 P5）** | 待办 | 切换运行时导入，让 Python 脚本改用 Rust BFLD crate；源码构建已通过（✅ `cargo check` 通过），wheel 尚未发布 |
| **供 Eve.app 使用的自定义特征 UUID（迭代 8 的运行时部分）** | 已有骨架 | 设计完成，等待 HAP-python 的 JSON 加载器实现（一个小型后续 PR） |
| **AirPlay 2 语音合成（pyatv）** | 受网络条件限制 | 要求 Mac 能通过 Bonjour 看到 HomePod；可用「快捷指令粘合」（第 2 层）作为现成替代 |

---

## 参考资料

- [ADR-125 — RuView ↔ Apple Home 原生 HAP 桥接](docs/adr/ADR-125-ruview-apple-home-native-hap-bridge.md) —— 设计规格、隐私理由、实施顺序
- [ADR-118 — 用于检测的波束成形反馈层](docs/adr/ADR-118-bfld-beamforming-feedback-layer-for-detection.md) —— BFLD 隐私门槛与身份风险语义
- [ADR-124 — rvagent MCP / RuVector npm 集成](docs/adr/ADR-124-rvagent-mcp-ruvector-npm-integration.md) —— MCP 工具规格
- [Issue #796](https://github.com/ruvnet/RuView/issues/796) —— 第 1+2 层冲刺跟踪（结项评论里有各轮实测数据）
- [scripts/macos-shortcuts/README.md](scripts/macos-shortcuts/README.md) —— 「快捷指令粘合」的配置与排障
- [HomeKit Accessory Protocol（非商业版）](https://developer.apple.com/apple-home/) —— HAP-1.1 规格
- [HAP-python on GitHub](https://github.com/ikalchev/HAP-python) —— 实现库
