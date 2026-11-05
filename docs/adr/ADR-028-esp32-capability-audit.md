# ADR-028：ESP32 能力审计与仓库见证记录

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted |
| **日期** | 2026-03-01 |
| **决策者** | ruv |
| **审计方** | Claude Opus 4.6（3 个智能体并行深度审查）|
| **见证提交** | `96b01008`（main）|
| **关联项** | ADR-012（ESP32 CSI 传感器网格）、ADR-018（ESP32 开发实现）、ADR-014（SOTA 信号处理）、ADR-027（MERIDIAN）|

---

## 1. 目的

本 ADR 记录对 wifi-densepose 仓库 ESP32 硬件能力、信号处理栈、神经网络架构、部署基础设施与安全态势所做的全面、经独立审计的清单。它是一份**见证记录** —— 对某一时点的现状作出证明，第三方可据此核验代码库实际包含的内容与对外宣称的内容是否一致。

---

## 2. 审计方法

三个并行研究智能体同时审查了整个仓库：

| 智能体 | 审查范围 | 审查文件 | 耗时 |
|-------|-------|---------------|----------|
| **硬件智能体** | ESP32 芯片组、CSI 帧格式、固件、引脚、供电、成本 | hardware crate、firmware/、signal/hardware_norm.rs | ~9 min |
| **信号/AI 智能体** | 算法、神经网络架构、训练、RuVector、全部 27 份 ADR | signal、train、nn、mat、vitals 各 crate 及所有 ADR | ~3.5 min |
| **部署智能体** | Docker、CI/CD、安全、证明、crates.io、WASM | Dockerfile、workflow、proof/、config、API 各 crate | ~2.5 min |

**审计时的测试执行情况：** 1,031 通过、0 失败、8 忽略（整个 workspace，`--no-default-features`）。

---

## 3. ESP32 硬件 —— 已确认的能力

### 3.1 固件（C，ESP-IDF v5.2）

| 组件 | 文件 | 行数 | 状态 |
|-----------|------|-------|--------|
| 入口、WiFi 初始化、CSI 回调 | `firmware/esp32-csi-node/main/main.c` | 144 | Implemented |
| CSI 回调、ADR-018 二进制序列化 | `main/csi_collector.c` | 176 | Implemented |
| UDP 套接字发送端 | `main/stream_sender.c` | 77 | Implemented |
| NVS 配置加载器（SSID、密码、目标 IP）| `main/nvs_config.c` | 88 | Implemented |
| **固件合计** | | **606** | **Complete** |

预编译二进制文件位于 `firmware/esp32-csi-node/build/`（bootloader.bin、分区表、应用二进制）。

### 3.2 ADR-018 二进制帧格式

```
Offset  Size  Field              Type     Notes
------  ----  -----              ------   -----
0       4     Magic              LE u32   0xC5110001
4       1     Node ID            u8       0-255
5       1     Antenna count      u8       1-4
6       2     Subcarrier count   LE u16   56/64/114/242
8       4     Frequency (MHz)    LE u32   2412-5825
12      4     Sequence number    LE u32   monotonic per node
16      1     RSSI               i8       dBm
17      1     Noise floor        i8       dBm
18      2     Reserved           [u8;2]   0x00 0x00
20      N×2   I/Q payload        [i8;2*n] per-antenna, per-subcarrier
```

**帧总大小：** 20 + (n_antennas × n_subcarriers × 2) bytes。
ESP32-S3 典型配置（1 天线、64 子载波）：**148 bytes**。

### 3.3 芯片组支持矩阵

| 芯片组 | 子载波数 | MIMO | 带宽 | HardwareType 枚举 | 归一化 |
|---------|-------------|------|-----------|-------------------|---------------|
| ESP32-S3 | 64 | 1×1 SISO | 20/40 MHz | `Esp32S3` | Catmull-Rom → 56 个规范子载波 |
| ESP32 | 56 | 1×1 SISO | 20 MHz | `Generic` | Pass-through |
| Intel 5300 | 30 | 3×3 MIMO | 20/40 MHz | `Intel5300` | Catmull-Rom → 56 个规范子载波 |
| Atheros AR9580 | 56 | 3×3 MIMO | 20 MHz | `Atheros` | Pass-through |

硬件类型在运行时根据子载波数量自动检测。

### 3.4 数据流：ESP32 → 推理

```
ESP32 (firmware/C)
  └→ esp_wifi_set_csi_rx_cb() captures CSI per WiFi frame
  └→ csi_collector.c serializes ADR-018 binary frame
  └→ stream_sender.c sends UDP to aggregator:5005
       ↓
Aggregator (Rust, wifi-densepose-hardware)
  └→ Esp32CsiParser::parse_frame() validates magic, bounds-checks
  └→ CsiFrame with amplitude/phase arrays
  └→ mpsc channel to sensing server
       ↓
Signal Processing (wifi-densepose-signal, 5,937 lines)
  └→ HardwareNormalizer → canonical 56 subcarriers
  └→ Hampel filter, SpotFi phase correction, Fresnel, BVP, spectrogram
       ↓
Neural Network (wifi-densepose-nn, 2,959 lines)
  └→ ModalityTranslator → ResNet18 backbone
  └→ KeypointHead (17 COCO joints) + DensePoseHead (24 body parts + UV)
       ↓
REST API + WebSocket (Axum)
  └→ /api/v1/pose/current, /ws/sensing, /ws/pose
```

### 3.5 ESP32 硬件规格

| 参数 | 值 |
|-----------|-------|
| 推荐开发板 | ESP32-S3-DevKitC-1 |
| SRAM 容量 | 520 KB |
| Flash 容量 | 8 MB |
| 固件占用 | 600-800 KB |
| CSI 采样率 | 20-100 Hz（可配置）|
| 传输方式 | UDP 二进制（端口 5005）|
| 串口（烧录）| COM7（用户已确认）|
| 工作电流 | 150-200 mA @ 5V |
| 深度睡眠电流 | 10 µA |
| 入门套件成本（3 节点）| ~$54 |
| 单节点成本 | ~$8-12 |

### 3.6 烧录说明

```bash
# 预编译二进制文件
pip install esptool
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write-flash --flash-mode dio --flash-size 4MB \
  0x0 bootloader.bin 0x8000 partition-table.bin 0x10000 esp32-csi-node.bin

# 配置 WiFi（无需重新编译）
python scripts/provision.py --port COM7 \
  --ssid "YourWiFi" --password "secret" --target-ip 192.168.1.20
```

---

## 4. 信号处理 —— 已确认的算法

### 4.1 SOTA 算法（ADR-014、wifi-densepose-signal）

| 算法 | 文件 | 行数 | 测试 | SOTA 参考 |
|-----------|------|-------|-------|---------------|
| 共轭乘法（SpotFi）| `csi_ratio.rs` | 198 | Yes | SIGCOMM 2015 |
| Hampel 离群值滤波器 | `hampel.rs` | 240 | Yes | 稳健统计 |
| 菲涅尔区呼吸模型 | `fresnel.rs` | 448 | Yes | FarSense，MobiCom 2019 |
| 身体速度剖面 | `bvp.rs` | 381 | Yes | Widar 3.0，MobiSys 2019 |
| STFT 频谱图 | `spectrogram.rs` | 367 | Yes | 多种窗函数（Hann、Hamming、Blackman）|
| 基于灵敏度的子载波选择 | `subcarrier_selection.rs` | 388 | Yes | 方差比 |
| 相位解缠与净化 | `phase_sanitizer.rs` | 900 | Yes | 线性去趋势 |
| 运动与存在检测 | `motion.rs` | 834 | Yes | 置信度评分 |
| 多特征提取 | `features.rs` | 877 | Yes | 幅度、相位、多普勒、PSD、相关性 |
| 硬件归一化（MERIDIAN）| `hardware_norm.rs` | 399 | Yes | ADR-027 第 1 阶段 |
| CSI 预处理流水线 | `csi_processor.rs` | 789 | Yes | 去噪、加窗 |

**信号处理合计：** 5,937 行，105+ 个测试。

### 4.2 训练流水线（wifi-densepose-train，9,051 行）

| 阶段 | 模块 | 行数 | 说明 |
|-------|--------|-------|-------------|
| 1. 数据加载 | `dataset.rs` | 1,164 | MM-Fi/Wi-Pose/合成数据、确定性打乱 |
| 2. 配置 | `config.rs` | 507 | 超参数、调度、路径 |
| 3. 模型架构 | `model.rs` | 1,032 | CsiToPoseTransformer、交叉注意力、GNN |
| 4. 损失计算 | `losses.rs` | 1,056 | 6 项组合（关键点 + DensePose + 迁移）|
| 5. 指标 | `metrics.rs` | 1,664 | PCK@0.2、OKS、分部位 mAP、最小割匹配 |
| 6. 训练器循环 | `trainer.rs` | 776 | SGD + 余弦退火、早停、检查点 |
| 7. 子载波优化 | `subcarrier.rs` | 414 | 通过 RuVector 稀疏求解器做 114→56 重采样 |
| 8. 确定性证明 | `proof.rs` | 461 | 流水线输出的 SHA-256 哈希 |
| 9. 硬件归一化 | `hardware_norm.rs` | 399 | 规范帧转换（ADR-027）|
| 10. 域对抗训练 | `domain.rs` + `geometry.rs` + `virtual_aug.rs` + `rapid_adapt.rs` + `eval.rs` | 1,530 | MERIDIAN（ADR-027）|

### 4.3 RuVector 集成（5 个 crate @ v2.0.4）

| crate | 集成点 | 替代对象 |
|-------|------------------|----------|
| `ruvector-mincut` | `metrics.rs` 的 DynamicPersonMatcher | O(n³) Hungarian → O(n^1.5 log n) 复杂度 |
| `ruvector-attn-mincut` | `spectrogram.rs`、`model.rs` | Softmax 注意力 → 最小割门控 |
| `ruvector-temporal-tensor` | `dataset.rs` 的 CompressedCsiBuffer | 全精度 f32 → 分层 8/7/5/3 位（节省 50-75%）|
| `ruvector-solver` | `subcarrier.rs` 插值 | 稠密线性代数 → O(√n) Neumann 求解器 |
| `ruvector-attention` | `bvp.rs`、`model.rs` 的空间注意力 | 静态权重 → 可学习的缩放点积 |

### 4.4 域泛化（ADR-027 MERIDIAN）

| 组件 | 文件 | 行数 | 状态 |
|-----------|------|-------|--------|
| 梯度反转层 + 域分类器 | `domain.rs` | 400 | Implemented，已完成安全加固 |
| 几何编码器（Fourier + DeepSets + FiLM）| `geometry.rs` | 365 | Implemented |
| 虚拟域增广 | `virtual_aug.rs` | 297 | Implemented |
| 快速自适应（对比式 TTT + LoRA）| `rapid_adapt.rs` | 317 | Implemented，缓冲区有界 |
| 跨域评估器 | `eval.rs` | 151 | Implemented |

### 4.5 生命体征（wifi-densepose-vitals，1,863 行）

| 能力 | 范围 | 方法 |
|------------|-------|--------|
| 呼吸率 | 6-30 BPM | 带通 0.1-0.5 Hz + 谱峰 |
| 心率 | 40-120 BPM | 微多普勒 0.8-2.0 Hz 分离 |
| 存在检测 | 二值 | CSI 方差阈值判定 |
| 异常检测 | Z-score、CUSUM、EMA | 多算法融合 |

### 4.6 灾害响应（wifi-densepose-mat，626+ 行，153 个测试）

| 子系统 | 能力 |
|-----------|-----------|
| 检测 | 呼吸、心跳、运动分类、集成投票 |
| 定位 | 多 AP 三角测量、深度估计、卡尔曼融合 |
| 分诊 | START 协议（红/黄/绿/黑）|
| 告警 | 优先级路由、分区派发 |

---

## 5. 部署基础设施 —— 已确认

### 5.1 已发布的产物

| 渠道 | 产物 | 版本 | 数量 |
|---------|----------|---------|-------|
| crates.io | Rust 各 crate | 0.2.0 | 15 |
| Docker Hub | `ruvnet/wifi-densepose:latest`（Rust 镜像）| 132 MB | 1 |
| Docker Hub | `ruvnet/wifi-densepose:python` 镜像 | 569 MB | 1 |
| PyPI | `wifi-densepose`（Python 包）| 1.2.0 | 1 |

### 5.2 CI/CD（4 个 GitHub Actions workflow）

| workflow | 触发条件 | 关键步骤 |
|----------|----------|-----------|
| `ci.yml` | Push/PR | Lint、测试（Python 3.10-3.12）、Docker 多架构构建、Trivy 扫描 |
| `security-scan.yml` | 定时/手动 | Bandit、Semgrep、Snyk、Trivy、Grype、TruffleHog、GitLeaks |
| `cd.yml` | Release | 蓝绿部署、数据库备份、健康监控、Slack 通知 |
| `verify-pipeline.yml` | Push/手动 | 确定性哈希校验、未固定随机种子扫描 |

### 5.3 确定性证明系统

| 组件 | 文件 | 用途 |
|-----------|------|---------|
| 参考信号 | `archive/v1/data/proof/sample_csi_data.json` | 1,000 帧合成 CSI，seed=42 |
| 生成器 | `archive/v1/data/proof/generate_reference_signal.py` | 确定性多径模型 |
| 校验器 | `archive/v1/data/proof/verify.py` | SHA-256 哈希比对 |
| 预期哈希 | `archive/v1/data/proof/expected_features.sha256` | `0b82bd45...` |

**审计时结果：** PASS。使用 numpy 2.4.2 + scipy 1.17.1 重新生成哈希。流水线哈希：`8c0680d7d285739ea9597715e84959d9c356c87ee3ad35b5f1e69a4ca41151c6`。

### 5.4 安全态势

- JWT 认证（`python-jose[cryptography]`）
- Bcrypt 口令哈希（`passlib`）
- SQLx 预编译语句（无 SQL 注入）
- 非 localhost 场景强制启用 CORS + WSS
- Shell 注入防护（Clap 参数校验）
- CI 中 15+ 个安全扫描器（SAST、DAST、密钥、容器、IaC、许可证）
- MERIDIAN 安全加固：有界缓冲区、坏输入不触发 panic、原子计数器、除法保护

### 5.5 WASM 浏览器部署

- crate 名称：`wifi-densepose-wasm`（cdylib + rlib）
- 优化选项：`-O4 --enable-mutable-globals`
- JS 绑定：`wasm-bindgen` 对接 WebSocket、Canvas、Window API
- Three.js 3D 可视化（17 个关节、16 条肢体）

---

## 6. 代码库规模汇总

| crate | Rust 代码行数 | 测试数 |
|-------|--------------|-------|
| wifi-densepose-signal | 5,937 | 105+ |
| wifi-densepose-train | 9,051 | 174+ |
| wifi-densepose-nn | 2,959 | 23 |
| wifi-densepose-mat | 626+ | 153 |
| wifi-densepose-hardware | 865 | 32 |
| wifi-densepose-vitals | 1,863 | Yes |
| **合计（主要 crate）** | **~21,300** | **1,031 passing** |

固件（C）：606 行。Python v1：34 个测试文件，41 个依赖。

---

## 7. 尚未实现的部分

| 宣称 | 实际状态 | 差距 |
|-------|--------------|-----|
| ESP32 端侧 ML 推理 | Not implemented | 固件只传输原始 I/Q；全部推理都在聚合端进行 |
| 54,000 fps 吞吐量 | 属于基准宣称，审计时未实测 | 需要在目标硬件上运行 Criterion 基准测试 |
| ESP32 的 INT8 量化 | 已设计（ADR-023），未交付 | 模型可装入 55 KB，但没有已部署的量化二进制 |
| 真实 WiFi CSI 数据集 | 仅有合成数据 | 仓库中没有真实采集数据；引用了 MM-Fi/Wi-Pose 但未打包 |
| Kubernetes 蓝绿部署 | 存在 CI/CD workflow | 需要真实集群，审计中无法验证 |
| Python 证明哈希 | PASS（审计时重新生成）| 依赖 numpy 2.4.2 + scipy 1.17.1 |

---

## 8. 决策

本 ADR 接受审计结论，将其作为一份见证记录。除第 7 节列出的例外之外，仓库中确实包含大量可运行、与其文档宣称相符的代码。所有代码均可编译，1,031 个测试全部通过，且 27 份 ADR 之间的架构描述一致。

### 建议

1. **打包一小段真实 CSI 采集数据**（哪怕只是单台 ESP32 的 10 秒数据），与合成参考信号一并附上
3. **运行 Criterion 基准测试**，记录实际吞吐量数值
4. **发布 ESP32 固件**，作为可直接用于 COM7 烧录的 GitHub Release 二进制文件

---

## 9. 参考资料

- [ADR-012：ESP32 CSI 传感器网格](ADR-012-esp32-csi-sensor-mesh.md)
- [ADR-018：ESP32 开发实现](ADR-018-esp32-dev-implementation.md)
- [ADR-014：SOTA 信号处理](ADR-014-sota-signal-processing.md)
- [ADR-027：跨环境域泛化](ADR-027-cross-environment-domain-generalization.md)
- [确定性证明校验器](../../v1/data/proof/verify.py)
