# ADR-003：面向 CSI 数据的 RVF 认知容器

## 状态
Proposed

## 日期
2026-02-28

## 背景

### 问题

WiFi-DensePose 通过多级流水线处理 CSI（信道状态信息）数据：原始采集 → 预处理 → 特征提取 → 神经网络推理 → 姿态输出。每一级都会产生中间数据，而目前这些数据都是用完即弃：

1. **原始 CSI 测量值**（`CsiData`）：幅度矩阵（天线数 × 子载波数）、相位数组、SNR 值、元数据。只保存在有上限的 `VecDeque` 中（Python 版最多 500 条，Rust 版类似）。

2. **提取出的特征**（`CsiFeatures`）：幅度均值/方差、相位差、相关矩阵、多普勒频移、功率谱密度。单次推理后即丢弃。

3. **训练好的模型权重**：从磁盘加载的静态 ONNX/PyTorch 文件，没有机制持久化适配后的权重或实验变体。

4. **检测结果**（`HumanDetectionResult`）：置信度分数、运动分数、检测布尔值。只写日志，没有建索引供模式检索。

5. **环境指纹**：每个物理空间都有独特的 CSI 特征，受房间几何、家具、建材影响。目前没有持久化的指纹库。

### 机会

RuVector 的 RVF（认知容器）格式提供单文件打包方案，含 25 种段类型，可以封装 WiFi-DensePose 的全部运行状态：

```
RVF Cognitive Container Structure:
┌─────────────────────────────────────────────┐
│ HEADER    │ Magic, version, segment count   │
├───────────┼─────────────────────────────────┤
│ VEC       │ CSI feature vectors             │
│ INDEX     │ HNSW index over vectors         │
│ WASM      │ Inference runtime               │
│ COW_MAP   │ Copy-on-write branch state      │
│ WITNESS   │ Audit chain entries             │
│ CRYPTO    │ Signature keys, attestations    │
│ KERNEL    │ Bootable runtime (optional)     │
│ EBPF      │ Hardware-accelerated filters    │
│ ...       │ (25 total segment types)        │
└─────────────────────────────────────────────┘
```

## 决策

我们将采用 RVF 认知容器格式作为 WiFi-DensePose 运行数据的主要持久化与部署单元，实现以下几类容器：

### 1. CSI 指纹容器（`.rvf.csi`）

打包环境专属的 CSI 特征，用于位置识别：

```rust
/// 存放环境特征的 CSI 指纹容器
pub struct CsiFingerprintContainer {
    /// 容器元数据
    metadata: ContainerMetadata,

    /// VEC 段：归一化后的 CSI 特征向量
    /// 每个向量 = [amplitude_mean(N) | amplitude_var(N) | phase_diff(N-1) | doppler(10) | psd(128)]
    /// 典型维度：64 个子载波 → 64+64+63+10+128 = 329 维
    fingerprint_vectors: VecSegment,

    /// INDEX 段：用于 O(log n) 近邻查询的 HNSW 索引
    hnsw_index: IndexSegment,

    /// COW_MAP：按不同时段、人员密度分别建立的分支
    branches: CowMapSegment,

    /// 每个向量的元数据：room_id、timestamp、occupancy_count、furniture_hash
    annotations: AnnotationSegment,
}
```

**向量编码**：每个 CSI 快照编码为固定维度的向量：
```
CSI Feature Vector (329-dim for 64 subcarriers):
┌──────────────────┬──────────────────┬─────────────────┬──────────┬─────────┐
│ amplitude_mean   │ amplitude_var    │ phase_diff      │ doppler  │ psd     │
│ [f32; 64]        │ [f32; 64]        │ [f32; 63]       │ [f32; 10]│ [f32;128│
└──────────────────┴──────────────────┴─────────────────┴──────────┴─────────┘
```

### 2. 模型容器（`.rvf.model`）

打包神经网络权重并支持版本管理：

```rust
/// 带版本追踪与 A/B 比较的模型容器
pub struct ModelContainer {
    /// 含模型版本历史的容器元数据
    metadata: ContainerMetadata,

    /// 主模型权重（ONNX 序列化）
    primary_weights: BlobSegment,

    /// SONA 适配增量（LoRA 低秩矩阵）
    adaptation_deltas: VecSegment,

    /// 用于模型实验的 COW 分支
    /// 例如 "baseline"、"adapted-office-env"、"adapted-warehouse"
    branches: CowMapSegment,

    /// 每个分支的性能指标
    metrics: AnnotationSegment,

    /// 见证链：每一次权重更新都会记录
    audit_trail: WitnessSegment,
}
```

### 3. 会话容器（`.rvf.session`）

保存完整的感知会话，供回放与分析：

```rust
/// 用于记录与回放感知会话的会话容器
pub struct SessionContainer {
    /// 会话元数据（开始时间、时长、硬件配置）
    metadata: ContainerMetadata,

    /// 按采集速率保存的时序 CSI 向量
    csi_timeseries: VecSegment,

    /// 与 CSI 时间戳对齐的检测结果
    detections: AnnotationSegment,

    /// 姿态估计输出
    poses: VecSegment,

    /// 用于时间范围查询的索引
    temporal_index: IndexSegment,

    /// 加密完整性证明
    witness_chain: WitnessSegment,
}
```

### 容器生命周期

```
  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │  Create   │───▶│  Ingest  │───▶│  Query   │───▶│  Branch  │
  │ Container │    │ Vectors  │    │  (HNSW)  │    │  (COW)   │
  └──────────┘    └──────────┘    └──────────┘    └──────────┘
       │                                                │
       │         ┌──────────┐    ┌──────────┐          │
       │         │  Merge   │◀───│  Compare │◀─────────┘
       │         │ Branches │    │ Results  │
       │         └────┬─────┘    └──────────┘
       │              │
       ▼              ▼
  ┌──────────┐   ┌──────────┐
  │  Export   │   │  Deploy  │
  │  (.rvf)  │   │  (Edge)  │
  └──────────┘   └──────────┘
```

### 与现有 crate 的集成

容器系统通过适配器 trait 集成：

```rust
/// 可向量化进 RVF 容器的类型所实现的 trait
pub trait RvfVectorizable {
    /// 把自身编码为固定维度的 f32 向量
    fn to_rvf_vector(&self) -> Vec<f32>;

    /// 从 RVF 向量还原出对象
    fn from_rvf_vector(vec: &[f32]) -> Result<Self, RvfError> where Self: Sized;

    /// 向量维度
    fn vector_dim() -> usize;
}

// 针对已有类型的实现
impl RvfVectorizable for CsiFeatures {
    fn to_rvf_vector(&self) -> Vec<f32> {
        let mut vec = Vec::with_capacity(Self::vector_dim());
        vec.extend(self.amplitude_mean.iter().map(|&x| x as f32));
        vec.extend(self.amplitude_variance.iter().map(|&x| x as f32));
        vec.extend(self.phase_difference.iter().map(|&x| x as f32));
        vec.extend(self.doppler_shift.iter().map(|&x| x as f32));
        vec.extend(self.power_spectral_density.iter().map(|&x| x as f32));
        vec
    }

    fn vector_dim() -> usize {
        // 64 + 64 + 63 + 10 + 128 = 329（64 个子载波）
        329
    }
    // ...
}
```

### 存储特征

| 容器类型 | 典型大小 | 向量数量 | 使用场景 |
|----------------|-------------|-------------|----------|
| 指纹 | 5-50 MB | 10K-100K | 房间/建筑指纹库 |
| 模型 | 50-500 MB | 不适用（blob） | 神经网络部署 |
| 会话 | 10-200 MB | 50K-500K | 100 Hz 录制 1 小时 |

### 用 COW 分支做环境适配

写时复制机制让实验几乎不产生额外开销：

```
main (office baseline: 50K vectors)
  ├── branch/morning (delta: 500 vectors, ~15 KB)
  ├── branch/afternoon (delta: 800 vectors, ~24 KB)
  ├── branch/occupied-10 (delta: 2K vectors, ~60 KB)
  └── branch/furniture-moved (delta: 5K vectors, ~150 KB)
```

在 5 万向量的容器上建 4 个分支，总开销约 250 KB（0.5%）。

## 影响

### 正面影响
- **单文件部署**：拷贝一个 `.rvf` 文件就能在站点之间迁移指纹库
- **模型带版本**：A/B 测试模型变体时无需复制整套权重
- **会话回放**：用录制的 CSI 数据复现检测结果
- **原子操作**：容器写入是事务性的，不会出现半截状态损坏
- **跨平台**：同一容器格式在服务器、WASM 与嵌入式设备上通用
- **存储高效**：COW 分支避免重复保存未变化的数据

### 负面影响
- **格式绑定**：RVF 目前还不是广泛采用的标准
- **序列化开销**：原生类型与 RVF 向量之间转换会增加时延（每个向量约 0.1-0.5 ms）
- **学习成本**：团队需要理解段类型与容器生命周期
- **会话文件偏大**：高采样率 CSI（1000 Hz）会生成很大的会话容器

### 性能目标

| 操作 | 目标时延 | 说明 |
|-----------|---------------|-------|
| 打开容器 | <10 ms | 内存映射 I/O |
| 插入向量 | <0.1 ms | 追加到 VEC 段 |
| HNSW 查询（10 万向量） | <1 ms | 见 ADR-004 |
| 创建分支 | <1 ms | 仅改 COW 元数据 |
| 合并分支 | <100 ms | 应用增量 |
| 导出容器 | ~1 ms/MB | 顺序写入 |

## 参考资料

- [RuVector 认知容器规范](https://github.com/ruvnet/ruvector)
- [Rust 中的内存映射 I/O](https://docs.rs/memmap2)
- [写时复制数据结构](https://en.wikipedia.org/wiki/Copy-on-write)
- ADR-002：RuVector RVF 集成策略
