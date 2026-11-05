# ADR-009：面向边缘部署的 RVF WASM 运行时

## 状态
Proposed

## 日期
2026-02-28

## 背景

### WASM 现状

`wifi-densepose-wasm` crate 提供基础的 WebAssembly 绑定，把 Rust 类型暴露给 JavaScript。它支持浏览器端可视化与轻量推理，但有显著局限：

1. **无法独立运行**：WASM 模块依赖通过 `fetch()` 加载的外部模型文件。服务器不可达时，模块就没有用处。

2. **没有持久状态**：浏览器 WASM 没有内建的持久化存储来保存指纹库、模型权重或会话数据。

3. **没有离线能力**：没有网络时，WASM 模块无法加载模型或回传结果。

4. **二进制体积**：当前 WASM 包未做优化，完整推理 + 信号处理编译后约 5-15 MB。

### 边缘部署要求

| 场景 | 平台 | 约束 |
|----------|----------|------------|
| 浏览器仪表盘 | Chrome/Firefox | <10 MB 下载量，无插件 |
| IoT 传感节点 | ESP32/Raspberry Pi | 256 KB - 4 GB RAM，电池供电 |
| 移动应用 | iOS/Android WebView | 后台执行受限 |
| 无人机载荷 | 嵌入式 Linux + WASM | 重量/功耗受限，连接不稳定 |
| 现场平板 | Android 平板 | 灾区需离线运行 |

### RuVector 的边缘运行时

RuVector 提供 5.5 KB 的 WASM 运行时，125ms 内启动，具备：
- 自包含运行（模型 + 数据内嵌在 RVF 容器中）
- 通过 RVF 容器持久化存储（浏览器中写入 IndexedDB，原生环境写入文件系统）
- 离线优先架构
- 可用时启用 SIMD 加速（WASM SIMD 提案）

## 决策

我们将用基于 RVF 的边缘运行时取代当前的 `wifi-densepose-wasm` 方案，把模型、指纹库和推理引擎打包进单个可部署的 RVF 容器。

### 边缘运行时架构

```
┌──────────────────────────────────────────────────────────────────┐
│                RVF Edge Deployment Container                      │
│                    (.rvf.edge file)                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │  WASM    │ │  VEC     │ │  INDEX   │ │  MODEL (ONNX)    │    │
│  │  Runtime │ │  CSI     │ │  HNSW    │ │  + LoRA deltas   │    │
│  │  (5.5KB) │ │  Finger- │ │  Graph   │ │                  │    │
│  │          │ │  prints  │ │          │ │                  │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘    │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │  CRYPTO  │ │  WITNESS │ │  COW_MAP │ │  CONFIG          │    │
│  │  Keys    │ │  Audit   │ │  Branches│ │  Runtime params  │    │
│  │          │ │  Chain   │ │          │ │                  │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘    │
│                                                                   │
│  Total container: 1-50 MB depending on model + fingerprint size  │
└──────────────────────────────────────────────────────────────────┘
        │
        │ Deploy to:
        ▼
┌───────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ Browser │  │   IoT   │  │ Mobile  │  │ Disaster Field  │ │
│  │         │  │ Device  │  │  App    │  │    Tablet       │ │
│  │ IndexedDB  │ Flash   │  │ App     │  │ Local FS        │ │
│  │ for state│  │ for     │  │ Sandbox │  │ for state       │ │
│  │         │  │ state   │  │ for     │  │                 │ │
│  │         │  │         │  │ state   │  │                 │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 分级运行时配置

不同部署目标使用不同的容器配置：

```rust
/// 边缘运行时配置档
pub enum EdgeProfile {
    /// 全功能浏览器部署
    /// 约 10 MB 容器，完整推理 + HNSW + SONA
    Browser {
        model_quantization: Quantization::Int8,
        max_fingerprints: 100_000,
        enable_sona: true,
        storage_backend: StorageBackend::IndexedDB,
    },

    /// 最小化 IoT 部署
    /// 约 1 MB 容器，仅轻量推理
    IoT {
        model_quantization: Quantization::Int4,
        max_fingerprints: 1_000,
        enable_sona: false,
        storage_backend: StorageBackend::Flash,
    },

    /// 移动应用部署
    /// 约 5 MB 容器，推理 + HNSW，受限的 SONA
    Mobile {
        model_quantization: Quantization::Int8,
        max_fingerprints: 50_000,
        enable_sona: true,
        storage_backend: StorageBackend::AppSandbox,
    },

    /// 灾区现场部署（能力最大化）
    /// 约 50 MB 容器，含多 AP 共识的完整技术栈
    Field {
        model_quantization: Quantization::Float16,
        max_fingerprints: 1_000_000,
        enable_sona: true,
        storage_backend: StorageBackend::FileSystem,
    },
}
```

### 容器体积预算

| 段 | 浏览器 | IoT | 移动端 | 现场 |
|---------|---------|-----|--------|-------|
| WASM 运行时 | 5.5 KB | 5.5 KB | 5.5 KB | 5.5 KB |
| 模型（ONNX） | 3 MB (int8) | 0.5 MB (int4) | 3 MB (int8) | 12 MB (fp16) |
| HNSW 索引 | 4 MB | 100 KB | 2 MB | 40 MB |
| 指纹向量 | 2 MB | 50 KB | 1 MB | 10 MB |
| 配置 + 密码材料 | 50 KB | 10 KB | 50 KB | 100 KB |
| **合计** | **~10 MB** | **~0.7 MB** | **~6 MB** | **~62 MB** |

### 离线优先的数据流

```
┌────────────────────────────────────────────────────────────────────┐
│                    Offline-First Operation                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. BOOT (125ms)                                                   │
│     ├── Open RVF container from local storage                      │
│     ├── Memory-map WASM runtime segment                            │
│     ├── Load HNSW index into memory                                │
│     └── Initialize inference engine with embedded model            │
│                                                                     │
│  2. OPERATE (continuous)                                           │
│     ├── Receive CSI data from local hardware interface             │
│     ├── Process through local pipeline (no network needed)         │
│     ├── Search HNSW index against local fingerprints              │
│     ├── Run SONA adaptation on local data                          │
│     ├── Append results to local witness chain                      │
│     └── Store updated vectors to local container                   │
│                                                                     │
│  3. SYNC (when connected)                                          │
│     ├── Push new vectors to central RVF container                  │
│     ├── Pull updated fingerprints from other nodes                 │
│     ├── Merge SONA deltas via Raft (ADR-008)                      │
│     ├── Extend witness chain with cross-node attestation           │
│     └── Update local container with merged state                   │
│                                                                     │
│  4. SLEEP (battery conservation)                                   │
│     ├── Flush pending writes to container                          │
│     ├── Close memory-mapped segments                               │
│     └── Resume from step 1 on wake                                │
└────────────────────────────────────────────────────────────────────┘
```

### 浏览器侧集成

```rust
/// 浏览器 WASM 入口
#[wasm_bindgen]
pub struct WifiDensePoseEdge {
    container: RvfContainer,
    inference_engine: InferenceEngine,
    hnsw_index: HnswIndex,
    sona: Option<SonaAdapter>,
}

#[wasm_bindgen]
impl WifiDensePoseEdge {
    /// 从通过 fetch 或 IndexedDB 加载的 RVF 容器初始化
    #[wasm_bindgen(constructor)]
    pub async fn new(container_bytes: &[u8]) -> Result<WifiDensePoseEdge, JsValue> {
        let container = RvfContainer::from_bytes(container_bytes)?;
        let engine = InferenceEngine::from_container(&container)?;
        let index = HnswIndex::from_container(&container)?;
        let sona = SonaAdapter::from_container(&container).ok();

        Ok(Self { container, inference_engine: engine, hnsw_index: index, sona })
    }

    /// 处理单帧 CSI（由 JavaScript 调用）
    #[wasm_bindgen]
    pub fn process_frame(&mut self, csi_json: &str) -> Result<String, JsValue> {
        let csi_data: CsiData = serde_json::from_str(csi_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let features = self.extract_features(&csi_data)?;
        let detection = self.detect(&features)?;
        let pose = if detection.human_detected {
            Some(self.estimate_pose(&features)?)
        } else {
            None
        };

        serde_json::to_string(&PoseResult { detection, pose })
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// 把当前状态保存到 IndexedDB
    #[wasm_bindgen]
    pub async fn persist(&self) -> Result<(), JsValue> {
        let bytes = self.container.serialize()?;
        // 通过 web-sys 写入 IndexedDB
        save_to_indexeddb("wifi-densepose-state", &bytes).await
    }
}
```

### 模型量化策略

| 量化方式 | 体积缩减 | 精度损失 | 适用场景 |
|-------------|---------------|---------------|-------------|
| Float32（基线） | 1x | 0% | 服务器/桌面 |
| Float16 | 2x | <0.5% | 现场平板、GPU |
| Int8 (PTQ) | 4x | <2% | 浏览器、移动端 |
| Int4 (GPTQ) | 8x | <5% | IoT、资源极度受限设备 |
| Binary (1-bit) | 32x | ~15% | MCU/超边缘（实验性） |

## 影响

### 正面影响
- **单文件部署**：拷贝一个 `.rvf.edge` 文件即可部署到任何地方
- **离线运行**：无网络连接也具备完整功能
- **125ms 启动**：应急场景下近乎即时可用
- **平台通用**：浏览器、IoT、移动端、服务器使用同一容器格式
- **省电**：离线模式无需轮询网络

### 负面影响
- **容器体积**：即便压缩后，现场容器仍超过 50 MB
- **WASM 性能**：计算密集型操作比原生 Rust 慢 2-5 倍
- **浏览器限制**：IndexedDB 有存储配额；WASM SIMD 支持程度不一
- **更新延迟**：离线设备在重连前无法获得更新
- **量化精度**：Int4/Int8 模型会损失部分检测灵敏度

## 参考资料

- [WebAssembly SIMD Proposal](https://github.com/WebAssembly/simd)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
- [Model Quantization Techniques](https://arxiv.org/abs/2103.13630)
- [RuVector WASM Runtime](https://github.com/ruvnet/ruvector)
- ADR-002：RuVector RVF 集成策略
- ADR-003：面向 CSI 数据的 RVF 认知容器
