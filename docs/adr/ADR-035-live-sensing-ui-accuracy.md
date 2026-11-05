# ADR-035：实时感知 UI 的准确性与数据源透明度

## 状态
Accepted

## 日期
2026-03-02

## 背景

Issue #86 报告：尽管 ESP32 正常工作并持续发送真实 CSI 帧，实时演示仍显示一个几乎不动的静态火柴人，感知页面显示的数据也不准确。排查后发现三项根本原因：

1. **Docker 默认使用 `--source simulated`** —— 即使接入了真实 ESP32，服务器仍生成合成的正弦波数据，而不是读取 UDP 帧。
2. **实时演示的姿态是解析计算出来的** —— `derive_pose_from_sensing()` 用与实际信号内容无关的 `sin(tick)` 数学式生成关键点；默认不加载任何训练好的 `.rvf` 模型。
3. **感知特征提取过于简化** —— 服务器用单帧阈值做运动检测，没有时序分析（呼吸 FFT、滑动窗口方差、帧历史）。
4. **没有数据源指示** —— 用户无法判断看到的是真实数据还是模拟数据。

## 决策

### 1. Docker：自动检测数据源
- 默认 `CSI_SOURCE` 由 `simulated` 改为 `auto`。
- `auto` 会探测 UDP 端口 5005 是否有 ESP32；若未发现则回退到模拟数据。
- 用户可用 `CSI_SOURCE=esp32 docker-compose up` 覆盖该设置。

### 2. 随信号变化的姿态推导
- `derive_pose_from_sensing()` 现在读取真实的感知特征：
  - `motion_band_power` 驱动肢体张开与步态检测（> 0.55）。
  - `breathing_band_power` 驱动躯干按呼吸速率相位收缩与扩张。
  - `variance` 为各关节注入噪声种子，使骨架各部位独立运动。
  - `dominant_freq_hz` 驱动躯干侧倾。
  - `change_points` 为末端关键点加入突发抖动。
- Tick 周期由 500ms 缩短到 100ms（2 fps → 10 fps）。
- 每一帧 WebSocket 消息都新增 `pose_source` 字段（`signal_derived` | `model_inference`）。

### 3. 时序特征提取
- 在 `AppStateInner` 中加入 100 帧环形缓冲区（`VecDeque`）。
- 用 Welford 式累加计算每个子载波的时序方差。
- 用 9 候选 Goertzel 滤波器组（0.1–0.5 Hz）估计呼吸速率，并加 3 倍 SNR 门控。
- 用帧间 L2 运动得分取代单帧幅度阈值。
- 信号质量指标基于 SNR（RSSI − 噪声底），并与时序稳定性融合。
- 信号场改由子载波方差的空间映射驱动，不再使用固定动画。

### 4. UI 中的数据源透明度
- **感知标签页**：横幅显示 "LIVE - ESP32"（绿色）、"RECONNECTING..."（黄色）或 "SIMULATED DATA"（红色）。
- **实时演示标签页**："Estimation Mode" 徽标显示 "Signal-Derived"（绿色）或 "Model Inference"（蓝色）。
- **设置指南**面板说明每种 ESP32 数量能提供什么（1x：存在/呼吸，3x：定位，4x+：配合训练模型得到完整姿态）。
- 模拟数据回退由「立即」改为 5 次重连失败后（约 30s）。

## 后果

### 正面
- 拥有真实 ESP32 硬件的用户默认就能拿到真实数据（自动检测）。
- 模拟数据带有清晰标签 —— 不会再对数据真实性产生困惑。
- 姿态骨架会直观响应真实信号变化（运动、呼吸、方差）。
- 特征提取产出具有生理意义的指标（Goertzel 呼吸速率、时序运动检测）。
- 设置指南让用户对各硬件配置能达到的效果有合理预期。

### 负面
- 信号推导的姿态仍是近似，不是神经网络推理。逐肢体跟踪需要训练好的 `.rvf` 模型 + 4 个以上 ESP32 节点。
- Goertzel 滤波器组每帧增加约 O(9×N) 的计算量（在 100 帧下可忽略）。
- 只有 1 个 ESP32 的用户仍可能对「手臂跟踪不可用」感到失望 —— 但现在 UI 会解释原因。

### 5. 深色模式一致性
- 实时演示标签页由浅色主题改为与 UI 其余部分一致的深色模式。
- 所有侧栏面板、徽标、按钮、下拉框都改用深色背景与低饱和文字。

### 6. 渲染模式实现
姿态可视化下拉框中的四种渲染模式现在都能产出各自不同的视觉效果：

| 模式 | 渲染效果 |
|------|-----------|
| **Skeleton** | 连接关节的绿色线条 + 红色关键点圆点 |
| **Keypoints** | 带发光效果与标签的大号彩色圆点，无连接线 |
| **Heatmap** | 每个关键点一个高斯径向色块（按人员区分色相），叠加 25% 不透明度的淡骨架 |
| **Dense** | 身体区域分割，用彩色填充多边形表示 —— 头部（红）、躯干（蓝）、左臂（绿）、右臂（橙）、左腿（紫）、右腿（黄） |

此前 heatmap 与 dense 只是桩实现，会回退到骨架模式。

### 7. pose_source 透传修复
WebSocket 消息中的 `pose_source` 字段此前在 `pose.service.js` 的 `convertZoneDataToRestFormat()` 里被丢弃。现已透传，使 Estimation Mode 徽标能正确显示。

## 变更文件
- `docker/Dockerfile.rust` —— `CSI_SOURCE=auto` 环境变量，用 shell entrypoint 做变量展开
- `docker/docker-compose.yml` —— `CSI_SOURCE=${CSI_SOURCE:-auto}`，shell 命令字符串
- `wifi-densepose-sensing-server/src/main.rs` —— 帧历史缓冲区、Goertzel 呼吸估计、时序运动得分、信号驱动姿态推导、pose_source 字段、100ms tick 默认值
- `ui/services/sensing.service.js` —— `dataSource` 状态、延迟模拟回退、`_simulated` 标记
- `ui/services/pose.service.js` —— 数据转换中的 `pose_source` 透传
- `ui/components/SensingTab.js` —— 数据源横幅、"About This Data" 卡片
- `ui/components/LiveDemoTab.js` —— 估计模式徽标、设置指南面板、深色模式主题
- `ui/utils/pose-renderer.js` —— heatmap（高斯色块）与 dense（身体区域分割）渲染模式
- `ui/style.css` —— 横幅、徽标、指南面板与说明文字样式
- `README.md` —— 实时姿态检测截图
- `assets/screen.png` —— 截图资源

## 参考资料
- 问题：https://github.com/ruvnet/wifi-densepose/issues/86
- ADR-029：RuvSense 多基地感知模式（拟议中 —— 完整流水线集成）
- ADR-014：SOTA 信号处理
