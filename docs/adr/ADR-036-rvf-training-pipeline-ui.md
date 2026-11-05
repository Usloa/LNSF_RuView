# ADR-036：RVF 模型训练流水线与 UI 集成

## 状态
Proposed

## 日期
2026-03-02

## 背景

wifi-densepose 系统目前运行在 **signal-derived** 模式 —— `derive_pose_from_sensing()` 用确定性数学式把聚合 CSI 特征（运动功率、呼吸速率、方差）映射到关键点位置。这能给出全身存在与粗略运动，但无法跟踪单个肢体。

**model inference** 模式的基础设施已经存在，但彼此没有连通：

1. **RVF 容器格式**（`rvf_container.rs`，1,102 行）—— 一种 64 字节对齐的二进制格式，支持模型权重（`SEG_VEC`）、元数据（`SEG_MANIFEST`）、量化（`SEG_QUANT`）、LoRA 配置（`SEG_LORA`）、对比嵌入（`SEG_EMBED`）与见证审计轨迹（`SEG_WITNESS`）。构建器与读取器均已完整实现，并带 CRC32 完整性校验。

2. **训练 crate**（`wifi-densepose-train`）—— AdamW 优化器、PCK@0.2/OKS 指标、带预热的学习率调度、早停、CSV 日志与检查点导出。按 ADR-015 支持 `CsiDataset` trait，并计划提供 MM-Fi（114→56 子载波插值）与 Wi-Pose（30→56 补零）加载器。

3. **神经网络推理 crate**（`wifi-densepose-nn`）—— 支持 CPU/GPU 的 ONNX Runtime 后端、动态张量形状、线程安全的 `OnnxBackend` 封装、模型信息检查与预热。

4. **感知服务器 CLI**（`--model <path>`、`--train`、`--pretrain`、`--embed`）—— 模型加载、训练模式与嵌入抽取的参数都已存在，但从原始 CSI → 训练好的 `.rvf` → 实时推理的端到端路径尚未接通。

5. **UI 缺口** —— 没有模型管理、训练进度可视化、LoRA 配置切换或嵌入检查。设置面板缺少模型配置。实时演示无法加载训练好的模型，也无法并排比较信号推导与模型推理的输出。

### 用户需要什么

- 一种能在自己的环境中**采集带标签 CSI 数据**的方式（自监督，或以摄像头作教师模型）。
- 一种无需离开 UI 就能从采集数据**训练 .rvf 模型**的方式。
- 一种能在实时演示中**加载与切换模型**、直观看到质量提升的方式。
- 能查看**训练进度**（损失曲线、验证 PCK、早停）。
- 通过 LoRA 配置实现**环境适配**（办公室 → 家庭 → 仓库），无需完整重训。

## 决策

### 阶段 1：数据采集与自监督预训练

#### 1.1 CSI 录制 API
在感知服务器中增加 REST 端点：
```
POST /api/v1/recording/start   { duration_secs, label?, session_name }
POST /api/v1/recording/stop
GET  /api/v1/recording/list
GET  /api/v1/recording/download/:id
DELETE /api/v1/recording/:id
```
- 把原始 CSI 帧与提取出的特征记录到 `.csi.jsonl` 文件。
- 可选的基于摄像头的标签叠加，由客户端教师模型（Detectron2/MediaPipe）生成。
- 每个录制会话都附带环境元数据标签（房间尺寸、节点位置、AP 数量）。

#### 1.2 对比预训练（ADR-024 阶段 1）
- 自监督 NT-Xent 损失在无需姿态标签的情况下学习 128 维 CSI 嵌入。
- 正样本对：同一人的相邻帧；负样本：不同会话/房间。
- VICReg 正则化防止嵌入坍塌。
- 输出：包含 `SEG_EMBED` + `SEG_VEC` 段的 `.rvf` 容器。
- 通过 `POST /api/v1/train/pretrain { dataset_ids[], epochs, lr }` 触发训练。

### 阶段 2：监督训练流水线

#### 2.1 数据集集成
- **MM-Fi 加载器**：解析 HDF5 文件，用 `ruvector-solver` 稀疏最小二乘做 114→56 子载波插值。
- **Wi-Pose 加载器**：解析 .mat 文件，做 30→56 补零并加 Hann 窗平滑。
- **自采集数据**：阶段 1 录制的 `.csi.jsonl` + 摄像头生成的标签。
- 所有数据集实现 `CsiDataset` trait，产出 `(amplitude[B,T*links,56], phase[B,T*links,56], keypoints[B,17,2], visibility[B,17])`。

#### 2.2 训练 API
```
POST /api/v1/train/start {
  dataset_ids: string[],
  config: {
    epochs: 100,
    batch_size: 32,
    learning_rate: 3e-4,
    weight_decay: 1e-4,
    early_stopping_patience: 15,
    warmup_epochs: 5,
    pretrained_rvf?: string,  // Base model for fine-tuning
    lora_profile?: string,    // Environment-specific LoRA
  }
}
POST /api/v1/train/stop
GET  /api/v1/train/status        // { epoch, train_loss, val_pck, val_oks, lr, eta_secs }
WS   /ws/train/progress          // Real-time streaming of training metrics
```

#### 2.3 RVF 导出
训练完成时：
- 最佳检查点导出为 `.rvf`，包含 `SEG_VEC`（权重）、`SEG_MANIFEST`（元数据）、`SEG_WITNESS`（训练哈希 + 最终指标），以及可选的 `SEG_QUANT`（INT8 量化）。
- 存放在 `data/models/` 目录，按模型 ID 建索引。
- `GET /api/v1/models` 列出可用模型；`POST /api/v1/models/load { model_id }` 热加载到推理流程。

### 阶段 3：LoRA 环境适配

#### 3.1 LoRA 微调
- 给定一个基础 `.rvf` 模型，只用特定环境的录制数据微调 LoRA 适配器权重（rank 4-16）。
- 新环境只需 5-10 分钟的带标签数据即可。
- 新的 LoRA 配置通过 `SEG_LORA` 段追加到已有 `.rvf`。
- 通过 `POST /api/v1/train/lora { base_model_id, dataset_ids[], profile_name, rank: 8, epochs: 20 }` 触发微调。

#### 3.2 配置切换
- `POST /api/v1/models/lora/activate { model_id, profile_name }` —— 热切换 LoRA 权重，无需重新加载基础模型。
- UI 下拉框列出当前已加载模型可用的配置。

### 阶段 4：UI 集成

#### 4.1 模型管理面板（新增：`ui/components/ModelPanel.js`）
- **模型库**：列出已加载与可用的 `.rvf` 模型及其元数据（版本、数据集、PCK 得分、大小、创建日期）。
- **模型检查器**：显示 RVF 分段明细 —— 权重数量、量化类型、LoRA 配置、嵌入配置、见证哈希。
- **加载/卸载**：一键加载模型并显示进度条。
- **对比**：在实时演示中并排切换信号推导与模型推理。

#### 4.2 训练仪表盘（新增：`ui/components/TrainingPanel.js`）
- **录制控制**：开始/停止 CSI 录制，会话列表含时长与帧数。
- **训练进度**：通过 WebSocket 流式推送实时损失曲线（训练损失、验证损失）与指标图（PCK@0.2、OKS）。
- **Epoch 表**：可滚动的逐 epoch 指标表，高亮最佳 epoch。
- **早停指示器**：可视化显示剩余 patience 倒计时。
- **导出按钮**：从浏览器下载训练好的 `.rvf`。

#### 4.3 实时演示增强
- **模型选择器**：工具栏下拉框，在信号推导与已加载 `.rvf` 模型之间切换。
- **LoRA 配置选择器**：二级下拉框，显示当前模型的环境配置。
- **置信度热力图叠加**：加载模型后按关键点显示置信度（在渲染模式下拉框中切换）。
- **姿态拖影**：半透明关键点历史，显示最近 N 帧的运动轨迹。
- **A/B 分屏视图**：左半为信号推导，右半为模型推理，便于比较质量。

#### 4.4 设置面板扩展
- **模型区**：默认模型路径、启动时自动加载、GPU/CPU 切换、推理线程数。
- **训练区**：默认超参数、检查点目录、完成时自动导出。
- **录制区**：默认录制目录、最大时长、用摄像头自动打标签。

#### 4.5 深色模式
所有新面板沿用 ADR-035 确立的深色模式（`#0d1117` 背景、`#e0e0e0` 文字、带彩色强调的半透明深色面板）。

### 阶段 5：推理流水线接线

#### 5.1 模型推理姿态路径
加载 `.rvf` 模型时：
1. CSI 帧到达（UDP 或模拟数据）。
2. 从子载波数据抽取幅度 + 相位张量。
3. 送入 ONNX 会话：`input[1, T*links, 56]` → `output[1, 17, 4]`（x, y, z, conf）。
4. 应用 `pose_tracker.rs` 的卡尔曼平滑。
5. 通过 WebSocket 广播，附带 `pose_source: "model_inference"`。
6. UI 的 Estimation Mode 徽标由绿色 "SIGNAL-DERIVED" 切换为蓝色 "MODEL INFERENCE"。

#### 5.2 渐进式加载（ADR-031 层 A/B/C）
- **层 A**（即时）：信号推导姿态立即启动。
- **层 B**（5-10s）：对比嵌入加载完成，HNSW 索引预热。
- **层 C**（30-60s）：完整姿态模型加载完成，开始推理。
- 各层之间无缝过渡；UI 徽标自动更新。

## 后果

### 正面
- 用户无需外部工具或 Python 依赖，就能在**自己的环境**上训练模型。
- LoRA 配置让单个基础模型在几分钟内适配多个房间，而不是几小时。
- 训练进度实时可见 —— 不再是黑盒等待。
- A/B 对比让用户看到从信号推导到模型推理的质量跃升。
- RVF 容器把权重、元数据、LoRA、见证信息打包进一个可移植文件。
- 自监督预训练不需要标签 —— 让 ESP32 持续运行即可。
- 渐进式加载让 UI 永远不会停在 "loading..." —— 信号推导立即接上。

### 负面
- 训练需要可观的算力：监督训练推荐 GPU（CPU 可行但慢 10-50 倍）。
- MM-Fi 与 Wi-Pose 数据集需另行下载（各 10-50 GB）—— 无法随包分发。
- LoRA rank 必须按环境调整；过低损失表达力，过高则过拟合。
- 启用 GPU 支持时，ONNX Runtime 会让二进制体积增加约 50 MB。
- 10 FPS 实时推理要求每帧约 10ms —— 在 CPU 上预算很紧。
- 师生式打标签（摄像头 → 姿态标签 → CSI 训练）需要摄像头权限，可能与「隐私优先」前提冲突。

### 缓解措施
- 提供可从 releases 下载的预训练基础 `.rvf` 模型（在 MM-Fi + Wi-Pose 上训练）。
- INT8 量化（`SEG_QUANT`）把模型体积缩小 4 倍，CPU 推理提速约 2 倍。
- 基于摄像头的打标签是**可选的** —— 自监督预训练无需摄像头即可工作。
- 训练 API 在启动 GPU 训练前校验显存；不足时回退到 CPU 并给出警告。

## 实施顺序

| 阶段 | 工作量 | 依赖 | 优先级 |
|-------|--------|-------------|----------|
| 1.1 CSI 录制 API | 2-3 天 | 感知服务器 | High |
| 1.2 对比预训练 | 3-5 天 | ADR-024、录制 API | High |
| 2.1 数据集集成 | 3-5 天 | ADR-015、CsiDataset trait | High |
| 2.2 训练 API | 2-3 天 | 训练 crate、数据集加载器 | High |
| 2.3 RVF 导出 | 1-2 天 | RvfBuilder | Medium |
| 3.1 LoRA 微调 | 3-5 天 | 已训练的基础模型 | Medium |
| 3.2 配置切换 | 1 天 | RVF 中的 LoRA | Medium |
| 4.1 模型面板 UI | 2-3 天 | 模型 API | High |
| 4.2 训练仪表盘 UI | 3-4 天 | 训练 API + WS | High |
| 4.3 实时演示增强 | 2-3 天 | 模型加载 | Medium |
| 4.4 设置扩展 | 1 天 | 模型/训练 API | Low |
| 4.5 深色模式 | 0.5 天 | 新面板 | Low |
| 5.1 推理接线 | 3-5 天 | ONNX 后端、姿态跟踪器 | High |
| 5.2 渐进式加载 | 2-3 天 | ADR-031 | Medium |

**总估算：4-6 周**（各阶段可重叠；1+2 与 4 并行）。

## 待新建/修改的文件

### 新建文件
- `ui/components/ModelPanel.js` —— 模型库、检查器、加载/卸载控件
- `ui/components/TrainingPanel.js` —— 录制控制、训练进度、指标图
- `v2/.../sensing-server/src/recording.rs` —— CSI 录制 API 处理器
- `v2/.../sensing-server/src/training_api.rs` —— 训练 API 处理器 + WS 进度流
- `v2/.../sensing-server/src/model_manager.rs` —— 模型加载、热切换、32LoRA 激活
- `data/models/` —— 默认模型存储目录

### 修改的文件
- `v2/.../sensing-server/src/main.rs` —— 接通录制、训练与模型 API
- `v2/.../train/src/trainer.rs` —— 增加 WebSocket 进度回调、LoRA 训练模式
- `v2/.../train/src/dataset.rs` —— MM-Fi 与 Wi-Pose 数据集加载器
- `v2/.../nn/src/onnx.rs` —— LoRA 权重注入、INT8 量化支持
- `ui/components/LiveDemoTab.js` —— 模型选择器、LoRA 下拉框、A/B spsplit 视图
- `ui/components/SettingsPanel.js` —— 模型与训练配置区
- `ui/components/PoseDetectionCanvas.js` —— 姿态拖影渲染、置信度热力图叠加
- `ui/services/pose.service.js` —— 模型推理关键点处理
- `ui/index.html` —— 增加 Training tabhee
- `ui/style.css` —— 新面板样式

## 参考资料
- ADR-015：MM-Fi + Wi-Pose 训练数据集
- ADR-016：RuVector 训练流水线集成
- ADR-024：Project AETHER —— 对比 CSI 嵌入模型
- ADR-029：RuvSense 多基地感知模式
- ADR-031：RuView 感知优先 RF 模式（渐进式加载）
- ADR-035：实时感知 UI 准确性与数据源透明度
- 问题：https://github.com/ruvnet/wifi-densepose/issues/92
- RVF 格式：`crates/wifi-densepose-sensing-server/src/rvf_container.rs`
- 训练 crate：`crates/wifi-densepose-train/src/trainer.rs`
- 神经网络推理：`crates/wifi-densepose-nn/src/onnx.rs`
