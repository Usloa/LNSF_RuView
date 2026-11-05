# ADR-019：仅感知 UI 模式与高斯泼溅可视化

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted |
| **日期** | 2026-02-28 |
| **决策者** | ruv |
| **关联** | ADR-013（特征级感知）、ADR-018（ESP32 开发实现） |

## 背景

WiFi-DensePose UI 最初被设计为所有功能都依赖完整的 FastAPI DensePose 后端（`localhost:8000`）。该后端依赖一整套重型 Python 包（PyTorch 约 2GB、torchvision、OpenCV、SQLAlchemy、Redis），因此在用户只想把 ESP32 CSI 或 Windows RSSI 采集器传来的实时 WiFi 信号可视化的轻量「仅感知」部署场景中并不实用。

已有 Rust 移植版（`v2`）采用 Axum，运行占用更轻（约 10MB 二进制、约 5MB RAM），但编译时仍需 libtorch C++ 绑定与 OpenBLAS，构建并不简单。

用户需要一种方式，在**只启用感知流水线**的情况下运行 UI，而不必安装完整的 DensePose 后端技术栈。

## 决策

实现一个**仅感知 UI 模式**，具体要求：

1. **把感知流水线与 DensePose API 后端解耦**。感知 WebSocket 服务（端口 8765 的 `ws_server.py`）独立于 FastAPI 后端（端口 8000）运行。

2. **启动时自动检测仅感知模式**。当 DensePose 后端不可达时，UI 会把 `backendDetector.sensingOnlyMode` 设为 `true`，并：
   - 在 `ApiService.request()` 层面屏蔽所有发往 `localhost:8000` 的 API 请求
   - 跳过依赖 DensePose 的标签页初始化（Dashboard、Hardware、Live Demo）
   - 显示绿色的「Sensing mode」状态提示，而不是错误横幅
   - 停止健康监测轮询

3. **新增「Sensing」标签页**，用 Three.js 做高斯泼溅可视化：
   - 自定义 GLSL `ShaderMaterial`，在 20×20 地面网格上渲染点云泼溅
   - 信号场泼溅按强度着色（蓝 → 绿 → 红）
   - 在估计的运动位置显示人体扰动斑块
   - 检测到呼吸频带功率时调制呼吸环
   - 侧栏展示 RSSI 迷你曲线、特征仪表与分类徽标

4. **Python WebSocket 桥接**（`archive/v1/src/sensing/ws_server.py`）：
   - 自动检测端口 5005 上的 ESP32 UDP CSI 流（ADR-018 二进制帧）
   - 依次回退到 `WindowsWifiCollector` → `SimulatedCollector`
   - 运行 `RssiFeatureExtractor` → `PresenceClassifier` 流水线
   - 每 500ms 在 `ws://localhost:8765` 广播 JSON 感知更新

5. **客户端兜底**：当 WebSocket 服务不可达时，`sensing.service.js` 生成模拟数据，保证可视化始终可用。

## 架构

```
ESP32 (UDP :5005)  ──┐
                     ├──▶  ws_server.py (:8765)  ──▶  sensing.service.js  ──▶  SensingTab.js
Windows WiFi RSSI ───┘         │                          │                      │
                          Feature extraction          WebSocket client      gaussian-splats.js
                          + Classification            + Reconnect            (Three.js ShaderMaterial)
                                                      + Sim fallback
```

### 数据流

| 数据源 | 采集器 | 特征提取 | 输出 |
|--------|-----------|-------------------|--------|
| ESP32 CSI（ADR-018） | `Esp32UdpCollector`（UDP :5005） | 幅度均值 → 伪 RSSI → `RssiFeatureExtractor` | `sensing_update` JSON |
| Windows WiFi | `WindowsWifiCollector`（netsh） | RSSI + 信号百分比 → `RssiFeatureExtractor` | `sensing_update` JSON |
| 模拟 | `SimulatedCollector` | 合成 RSSI 模式 | `sensing_update` JSON |

### 感知更新 JSON 结构

```json
{
  "type": "sensing_update",
  "timestamp": 1234567890.123,
  "source": "esp32",
  "nodes": [{ "node_id": 1, "rssi_dbm": -39, "position": [2,0,1.5], "amplitude": [...], "subcarrier_count": 56 }],
  "features": { "mean_rssi": -39.0, "variance": 2.34, "motion_band_power": 0.45, ... },
  "classification": { "motion_level": "active", "presence": true, "confidence": 0.87 },
  "signal_field": { "grid_size": [20,1,20], "values": [...] }
}
```

## 文件

### 新增
| 文件 | 用途 |
|------|---------|
| `archive/v1/src/sensing/ws_server.py` | 带自动探测采集器的 Python asyncio WebSocket 服务 |
| `ui/components/SensingTab.js` | 集成 Three.js 的 Sensing 标签页 UI |
| `ui/components/gaussian-splats.js` | 自定义 GLSL 高斯泼溅渲染器 |
| `ui/services/sensing.service.js` | 带重连与模拟兜底的 WebSocket 客户端 |

### 修改
| 文件 | 变更 |
|------|--------|
| `ui/index.html` | 新增 Sensing 导航按钮与内容区 |
| `ui/app.js` | 仅感知模式检测、按条件初始化标签页 |
| `ui/style.css` | Sensing 标签页布局与组件样式 |
| `ui/config/api.config.js` | `AUTO_DETECT: false`（感知使用自己的 WebSocket） |
| `ui/services/api.service.js` | 仅感知模式下短路请求 |
| `ui/services/health.service.js` | 后端不可达时跳过轮询 |
| `ui/components/DashboardTab.js` | 仅感知模式下优雅降级 |

## 影响

### 正面影响
- UI 无需任何重型依赖即可运行——只需 `pip install websockets`（numpy/scipy 已安装）
- ESP32 CSI 数据端到端流转，不依赖 PyTorch、OpenCV 或数据库
- 完整后端运行时，既有 DensePose 标签页仍可正常工作
- 控制台输出干净——仅感知模式下不再刷 `ERR_CONNECTION_REFUSED`

### 负面影响
- 两个独立的 WebSocket 端点：`:8765`（感知）与 `:8000/api/v1/stream/pose`（DensePose）
- 仅感知模式下无法使用姿态估计、区域占用与历史数据功能
- 若用户没注意到「Simulated」徽标，客户端模拟兜底可能造成误导

### 中性影响
- Rust Axum 后端仍是未来统一轻量服务的可选方案
- 感知流水线原样复用既有 `RssiFeatureExtractor` 与 `PresenceClassifier` 类

## 备选方案

1. **安装精简版 FastAPI**（`pip install fastapi uvicorn pydantic`）：服务能启动，但缺少 PyTorch 时姿态端点会报错。
2. **构建 Rust 后端**：单一二进制，但需要 libtorch + OpenBLAS 构建工具链。
3. **把感知并入 FastAPI**：即便只用感知功能也必须安装 FastAPI。

方案 1 被否决，因为它仍会展示不可用的标签页。所选方案干净地分离了关注点。
