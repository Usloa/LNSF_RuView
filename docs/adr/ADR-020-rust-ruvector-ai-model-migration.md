# ADR-020：用 Rust、RuVector 与 ONNX Runtime 承接 AI/模型推理

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted |
| **日期** | 2026-02-28 |
| **决策者** | ruv |
| **关联** | ADR-016（RuVector 集成）、ADR-017（RuVector-Signal-MAT）、ADR-019（仅感知 UI） |

## 背景

当前 Python DensePose 后端需要约 2GB+ 的依赖：

| Python 依赖 | 体积 | 用途 |
|-------------------|------|---------|
| PyTorch | ~2.0 GB | 神经网络推理 |
| torchvision | ~500 MB | 模型加载与变换 |
| OpenCV | ~100 MB | 图像处理 |
| SQLAlchemy + asyncpg | ~20 MB | 数据库 |
| scikit-learn | ~50 MB | 分类 |
| **合计** | **~2.7 GB** | |

这使得 DensePose 后端难以用于边缘部署、CI 流水线，以及只需要 WiFi 感知 + 姿态估计的开发机。

与此同时，`v2/` 中的 Rust 移植版已经具备：

- **12 个 workspace crate**，覆盖 core、signal、nn、api、db、config、hardware、wasm、cli、mat、train
- 已接入 signal、mat、train crate 的 **5 个 RuVector crate**（v2.0.4，已发布到 crates.io）
- **3 种 NN 后端**：ONNX Runtime（默认）、tch（PyTorch C++）、Candle（纯 Rust）
- **Axum Web 框架**，MAT crate 中支持 WebSocket
- **信号处理流水线**：CSI 处理、BVP、菲涅尔几何、频谱图、子载波选择、运动检测、Hampel 滤波器、相位清洗

## 决策

采用 Rust workspace 作为 AI/模型推理与信号处理的**主后端**，在生产部署中取代 Python FastAPI 技术栈。

### 阶段 1：默认使用 ONNX Runtime（不依赖 libtorch）

只启用 `default-features = ["onnx"]` 来使用 `wifi-densepose-nn` crate，从而完全避开 libtorch C++ 依赖。

| 组件 | Rust Crate | 取代的 Python 实现 |
|-----------|-----------|-----------------|
| CSI 处理 | `wifi-densepose-signal::csi_processor` | `archive/v1/src/sensing/feature_extractor.py` |
| 运动检测 | `wifi-densepose-signal::motion` | `archive/v1/src/sensing/classifier.py` |
| BVP 提取 | `wifi-densepose-signal::bvp` | N/A（新增能力） |
| 菲涅尔几何 | `wifi-densepose-signal::fresnel` | N/A（新增能力） |
| 子载波选择 | `wifi-densepose-signal::subcarrier_selection` | N/A（新增能力） |
| 频谱图 | `wifi-densepose-signal::spectrogram` | N/A（新增能力） |
| 姿态推理 | `wifi-densepose-nn::onnx` | PyTorch + torchvision |
| DensePose 映射 | `wifi-densepose-nn::densepose` | Python DensePose |
| REST API | `wifi-densepose-mat::api`（Axum） | FastAPI |
| WebSocket 流 | `wifi-densepose-mat::api::websocket` | `ws_server.py` |
| 幸存者检测 | `wifi-densepose-mat::detection` | N/A（新增能力） |
| 生命体征 | `wifi-densepose-mat::ml` | N/A（新增能力） |

### 阶段 2：RuVector 信号智能

这 5 个 RuVector crate 提供了已接入 Rust 信号处理流水线的次多项式算法：

| Crate | 算法 | 在流水线中的用途 |
|-------|-----------|-----------------|
| `ruvector-mincut` | 次多项式最小割 | 动态划分灵敏/不灵敏子载波 |
| `ruvector-attn-mincut` | 注意力门控最小割 | 生成抑制噪声的频谱图 |
| `ruvector-attention` | 灵敏度加权注意力 | 提取人体速度剖面（BVP） |
| `ruvector-solver` | 稀疏菲涅尔求解器 | 估计 TX-人体-RX 距离 |
| `ruvector-temporal-tensor` | 压缩时序缓冲 | 存储呼吸与心跳频谱图 |

它们以具备硬件感知的子载波级特征提取，取代 Python 的 `RssiFeatureExtractor`。

### 阶段 3：统一的 Axum 服务

用单一 Rust Axum 服务同时取代 Python FastAPI 后端（端口 8000）与 Python 感知 WebSocket（端口 8765）：

```
ESP32 (UDP :5005) ──▶ Rust Axum server (:8000) ──▶ UI (browser)
                          ├── /health/*          (health checks)
                          ├── /api/v1/pose/*     (pose estimation)
                          ├── /api/v1/stream/*   (WebSocket pose stream)
                          ├── /ws/sensing        (sensing WebSocket — replaces :8765)
                          └── /ws/mat/stream     (MAT domain events)
```

### 构建配置

```toml
# 轻量构建 —— 不含 libtorch、不含 OpenBLAS
cargo build --release -p wifi-densepose-mat --no-default-features --features "std,api,onnx"

# 全量构建，启用所有后端
cargo build --release --features "all-backends"
```

### 依赖对比

| | Python 后端 | Rust 后端（仅 ONNX） |
|---|---|---|
| 安装体积 | ~2.7 GB | ~50 MB 二进制 |
| 运行时内存 | ~500 MB | ~20 MB |
| 启动时间 | 3-5s | <100ms |
| 依赖项 | 30+ 个 pip 包 | 单个静态二进制 |
| GPU 支持 | 通过 PyTorch 使用 CUDA | 通过 ONNX Runtime 使用 CUDA |
| 模型格式 | .pt/.pth（PyTorch） | .onnx（可移植） |
| 交叉编译 | 困难 | `cargo build --target` |
| WASM 目标 | 不支持 | 支持（`wifi-densepose-wasm`） |

### 模型转换

把现有 PyTorch 模型导出为 ONNX，供 Rust 后端使用：

```python
# 一次性转换（Python）
import torch
model = torch.load("model.pth")
torch.onnx.export(model, dummy_input, "model.onnx", opset_version=17)
```

`wifi-densepose-nn::onnx` 模块直接加载 `.onnx` 文件。

## 影响

### 正面影响
- 单个约 50MB 静态二进制取代约 2.7GB 的 Python 环境
- 运行时内存约 20MB，对比约 500MB
- 启动低于 100ms，对比 3-5 秒
- 单端口承载所有端点（API、感知 WebSocket、姿态 WebSocket）
- RuVector 次多项式算法原生运行，无 FFI 开销
- WASM 构建目标支持浏览器端推理
- 可交叉编译到 ARM（Raspberry Pi）、ESP32-S3 等

### 负面影响
- 需要 ONNX 模型转换（每个模型一次）
- 开发者改动后端需要 Rust 工具链
- Python 感知流水线（`ws_server.py`）仍适用于快速原型
- 部分 signal crate 的 `ndarray-linalg` 需要 OpenBLAS 或系统 LAPACK

### 迁移路径
1. 保留 Python `ws_server.py` 作为开发/原型阶段的兜底
2. 用 `cargo build --release -p wifi-densepose-mat` 构建 Rust 二进制
3. UI 检测当前运行的后端并适配（沿用既有 `sensingOnlyMode` 逻辑）
4. Rust API 功能对齐后弃用 Python 后端

## 验证

```bash
# 构建 Rust workspace（仅 ONNX，不含 libtorch）
cd v2
cargo check --workspace 2>&1

# 构建 release 二进制
cargo build --release -p wifi-densepose-mat --no-default-features --features "std,api"

# 运行测试
cargo test --workspace

# 二进制体积
ls -lh target/release/wifi-densepose-mat
```
