# ADR-015：用公开数据集训练姿态估计模型

## 状态

Accepted

## 背景

WiFi-DensePose 系统已有完整的模型架构（`DensePoseHead`、
`ModalityTranslationNetwork`、`WiFiDensePoseRCNN`）与信号处理流水线，
但没有训练好的权重。没有训练模型，姿态估计无论输入质量如何
都只会输出随机结果。

训练需要成对数据：同步采集的 WiFi CSI 与真值
人体姿态标注。从零采集这类数据要耗费数月人力，
还需要专用硬件（多个 WiFi 节点 + 相机 + 动作捕捉设备）。
已有若干公开数据集可用于启动训练，无需自行采集。

### 教师—学生约束

CMU 的《DensePose From WiFi》论文（2023）采用教师—学生方式训练：
训练时由基于摄像头的 RGB 姿态模型（如 Detectron2 DensePose）生成伪标签，
让 WiFi 模型学会复现这些输出；推理时
摄像头被移除。这意味着只要数据集提供*真值姿态标注*，
*或*同步的 RGB 帧（教师模型可据此
生成标签），就足以用于训练。

### 56 子载波的硬件背景

系统以 56 个子载波为目标，对应使用 Atheros CSI Tool 的
**20 MHz 信道上的 Atheros 802.11n 芯片组**。目前没有任何
带成对姿态标注的公开数据集恰好采集于 56 个子载波：

| 硬件 | 子载波数 | 数据集 |
|----------|-------------|---------|
| Atheros CSI Tool（20 MHz） | **56** | 无带姿态标签的数据集 |
| Atheros CSI Tool（40 MHz） | **114** | MM-Fi |
| Intel 5300 网卡（20 MHz） | **30** | Person-in-WiFi、Widar 3.0、Wi-Pose、XRF55 |
| Nexmon/Broadcom（80 MHz） | **242-256** | 无带姿态标签的数据集 |

MM-Fi 在 40 MHz 下使用同一 Atheros 硬件家族，因此 114→56 的插值
具有物理意义（芯片组相同，只是信道带宽不同）。

## 决策

以 MM-Fi 作为主训练数据集，辅以 Wi-Pose（NjtechCVLab）
增加多样性。XRF55 降为可选（Kinect 标签需要
后处理）。只有骨架关键点时，由教师—学生流水线
补齐 DensePose UV 标签。

### 主数据集：MM-Fi

**论文：**《MM-Fi：面向通用无线感知的多模态非侵入 4D 人体数据集》
（NeurIPS 2023 Datasets & Benchmarks）
**仓库：** https://github.com/ybhbingo/MMFi_dataset
**规模：** 40 名受试者 × 27 类动作 × 约 320,000 帧，4 种环境
**模态：** WiFi CSI、毫米波雷达、LiDAR、RGB-D、IMU
**CSI 格式：** **1 TX × 3 RX 天线**、114 个子载波、100 Hz 采样率、
5 GHz 40 MHz（TP-Link N750 配 Atheros CSI Tool）、原始幅度 + 相位
**数据张量：** 每样本 [3, 114, 10]（天线对 × 子载波 × 时间帧）
**姿态标注：** 17 关键点 COCO 三维骨架 + DensePose UV 表面坐标
**许可：** CC BY-NC 4.0
**选为主数据集的原因：** 最大的公开 WiFi CSI + 姿态数据集；标注最丰富（三维
关键点 + DensePose UV）；与目标系统同属 Atheros 硬件家族；COCO
关键点可直接映射到 `KeypointHead` 的输出格式；维护活跃，
且有 NeurIPS 2023 基准地位。

**天线校正：** MM-Fi 使用 1 TX / 3 RX（3 个天线对），不是 3×3。
现有系统面向 3×3（ESP32 传感网）。3 个 RX 天线是对得上的；TX
数量不同意味着用 MM-Fi 训练出的权重可用，但若再用
3-TX 配置的数据微调会更好。

### 辅助数据集：Wi-Pose（NjtechCVLab）

**论文：** CSI-Former（MDPI Entropy 2023）及相关工作
**仓库：** https://github.com/NjtechCVLab/Wi-PoseDataset
**规模：** 12 名志愿者 × 12 类动作 × 166,600 个数据包
**CSI 格式：** 3 TX × 3 RX 天线、30 个子载波、5 GHz、.mat 格式
**姿态标注：** 18 关键点 AlphaPose 骨架（与 COCO 兼容的子集）
**许可：** 仅供研究使用
**选为辅助数据集的原因：** 3×3 天线阵列与目标 ESP32 传感网硬件完全一致；
完全公开；补充了 MM-Fi 没有的 12 名受试者与环境。
**注意：** 30 个子载波需补零或插值到 56；18→17 的
关键点映射会去掉一个颈部关键点（索引 1），与 COCO-17 兼容。

### 排除或降优先级的数据集

| 数据集 | 原因 |
|---------|--------|
| RF-Pose / RF-Pose3D (MIT) | 定制 FMCW 无线电，非 802.11n CSI；信号物理机制不兼容 |
| Person-in-WiFi (CMU 2019) | 未公开发布（IRB 限制） |
| Person-in-WiFi 3D (CVPR 2024) | 30 个子载波、Intel 5300；半公开获取 |
| DensePose From WiFi (CMU) | 数据集未发布，只有论文与架构 |
| Widar 3.0 | 只有手势标签，没有全身姿态关键点 |
| XRF55 | 以活动标签为主；Kinect 姿态需邮件申请；优先级较低 |
| UT-HAR, WiAR, SignFi | 只有活动/手势标签，无姿态关键点 |

## 实施计划

### 阶段 1：MM-Fi 加载器（Rust `wifi-densepose-train` crate）

在 Rust 中实现 `MmFiDataset`（`crates/wifi-densepose-train/src/dataset.rs`）：
- 读取 MM-Fi 的 numpy .npy 文件：幅度 [N, 3, 3, 114]（天线对平铺）、相位 [N, 3, 3, 114]
- 把子载波从 114 重采样到 56（通过 `subcarrier.rs` 线性插值）
- 用 `wifi-densepose-signal` crate 的 SOTA 算法做相位清洗
- 返回带类型的 `CsiSample` 结构，含幅度、相位、关键点、可见性
- 验证集划分：留出第 33–40 号受试者

### 阶段 2：Wi-Pose 加载器

实现读取 .mat 文件的 `WiPoseDataset`（通过基于 ndarray 的 MATLAB 读取器
或预先转换好的 .npy）。子载波插值：30 → 56（高频部分补零
而非插值，因为 30 子载波的 Intel 数据与 56 子载波的
Atheros 数据频谱占用不同）。

### 阶段 3：教师—学生 DensePose 标签

对于只提供三维关键点、没有完整 DensePose UV 图的 MM-Fi 样本：
- 在配对的 RGB 帧上运行 Detectron2 DensePose，生成 `(part_labels, u_coords, v_coords)`
- 把生成的标签以 .npy 缓存到原始数据旁边
- 这与 CMU 论文中的训练流程完全一致

### 阶段 4：训练流水线（Rust）

- **模型：** `WiFiDensePoseModel`（tch-rs，`crates/wifi-densepose-train/src/model.rs`）
- **损失：** 关键点热力图（MSE）+ DensePose 部位（交叉熵）+ UV（Smooth L1）+ 迁移（MSE）
- **指标：** PCK@0.2 + OKS，配合匈牙利最小代价匹配（`crates/wifi-densepose-train/src/metrics.rs`）
- **优化器：** Adam，lr=1e-3，第 40 与 80 轮做阶梯衰减
- **硬件：** 单张 GPU（RTX 3090 或 A100）；MM-Fi 约占 50 GB 磁盘
- **检查点：** 每轮保存；保留验证 PCK 最优的一份

### 阶段 5：真实性验证

`verify-training` 可执行文件为训练提供「信任保险开关」：
- 固定随机种子（MODEL_SEED=0，PROOF_SEED=42）
- 在确定性 SyntheticDataset 上训练 50 步
- 校验：损失下降 + 最终权重的 SHA-256 与存档哈希一致
- EXIT 0 = PASS，EXIT 1 = FAIL，EXIT 2 = SKIP（无存档哈希）

## 子载波不匹配：MM-Fi（114）与系统（56）

MM-Fi 在 5 GHz、40 MHz 带宽下采集 114 个子载波（Atheros CSI Tool）。
系统配置为 56 个子载波（Atheros，20 MHz）。可选的解决方式：

1. **把 MM-Fi 插值到 56**（阶段 1 采用）：线性插值保留
   频谱包络，速度快，无需改动架构
2. **按原生 114 训练**：修改 `CSIProcessor` 配置；需重新运行
   `verify.py --generate-hash` 更新证明哈希；留作后续选项
3. **采集原生 56 子载波数据**：20 MHz 下的 ESP32 传感网；生产环境最优

方案 1 可立即打通训练。Rust 的 `subcarrier.rs` 模块把插值
作为一等操作处理，并有测试证明其正确性。

## 影响

**正面影响：**
- 立即打通基于真实公开数据的端到端训练
- MM-Fi 的 Atheros 硬件家族与目标系统一致（同一套 CSI Tool）
- 40 名受试者 × 27 类动作，为首版模型提供了足够的多样性
- Wi-Pose 的 3×3 天线配置与 ESP32 传感网硬件完全吻合
- CC BY-NC 许可与研究和内部使用兼容
- Rust 实现与 `wifi-densepose-signal` 流水线原生集成

**负面影响：**
- CC BY-NC 禁止把仅用 MM-Fi 训练的权重用于商业部署；
  商业化前必须自行采集数据
- MM-Fi 是 1 TX / 3 RX，系统面向 3 TX / 3 RX；需要微调
- 114→56 的子载波插值损失频率分辨率；v1 可接受
- MM-Fi 采集于受控实验室环境；在针对特定领域数据微调之前，
  真实场景准确率会更低

## 参考资料

- Yang 等，《MM-Fi：面向通用无线感知的多模态非侵入 4D 人体数据集》（NeurIPS 2023）— arXiv:2305.10345
- Geng 等，《DensePose From WiFi》（CMU，arXiv:2301.00250，2023）
- Yan 等，《Person-in-WiFi 3D》（CVPR 2024）
- NjtechCVLab，《Wi-Pose 数据集》— github.com/NjtechCVLab/Wi-PoseDataset
- ADR-012：面向分布式感知的 ESP32 CSI 传感网（硬件目标）
- ADR-013：在通用商用设备上做特征级感知
- ADR-014：面向 WiFi 感知的 SOTA 信号处理算法
