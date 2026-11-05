# ADR-017：信号处理与 MAT crate 的 RuVector 集成

## 状态

Accepted

## 日期

2026-02-28

## 背景

ADR-016 已把五个已发布的 ruvector v2.0.4 crate 接入
`wifi-densepose-train` crate（model.rs、dataset.rs、subcarrier.rs、metrics.rs）。
另有两个早于 ADR-016 的生产 crate 尚未集成 ruvector，
尽管它们存在具体且高价值的集成点：

1. **`wifi-densepose-signal`** —— SOTA 信号处理算法（ADR-014）：
   共轭相乘、Hampel 滤波器、菲涅尔区呼吸模型、CSI
   频谱图、子载波灵敏度筛选、人体速度剖面（BVP）。
   这些算法做的是逐元素独立运算或暴力穷举搜索，
   没有用上次多项式优化。

2. **`wifi-densepose-mat`** —— 灾害检测（ADR-001）：多 AP
   三角定位、呼吸/心跳波形检测、分诊分类。
   时序数据未压缩，定位用闭式几何解，
   没有迭代求解方程组。

此外，ADR-002 的依赖策略引用了虚构的 crate 名
（`ruvector-core`、`ruvector-data-framework`、`ruvector-consensus`、
`ruvector-wasm`），版本 `"0.1"` 也并不存在。ADR-016 已核实
实际发布的 crate 为 v2.0.4，必须改用这些。

### 已核实的已发布 crate（v2.0.4）

依据 github.com/ruvnet/ruvector 源码与 crates.io 核查：

| Crate | 关键 API | 算法优势 |
|---|---|---|
| `ruvector-mincut` | `DynamicMinCut`、`MinCutBuilder` | O(n^1.5 log n) 动态图划分 |
| `ruvector-attn-mincut` | `attn_mincut(q,k,v,d,seq,λ,τ,ε)` | 一趟计算内完成注意力 + 最小割门控 |
| `ruvector-temporal-tensor` | `TemporalTensorCompressor`、`segment::decode` | 分层量化：内存降低 50–75% |
| `ruvector-solver` | `NeumannSolver::new(tol,max_iter).solve(&CsrMatrix,&[f32])` | O(√n) 诺依曼级数收敛 |
| `ruvector-attention` | `ScaledDotProductAttention::new(d).compute(q,ks,vs)` | 小 d 下的亚线性注意力 |

## 决策

通过七个定向集成点，把五个 ruvector v2.0.4 crate 接入
`wifi-densepose-signal` 与 `wifi-densepose-mat`。

### 集成映射

```
wifi-densepose-signal/
├── subcarrier_selection.rs  ← ruvector-mincut   (DynamicMinCut partitions)
├── spectrogram.rs           ← ruvector-attn-mincut (attention-gated STFT tokens)
├── bvp.rs                   ← ruvector-attention   (cross-subcarrier BVP attention)
└── fresnel.rs               ← ruvector-solver      (Fresnel geometry system)

wifi-densepose-mat/
├── localization/
│   └── triangulation.rs     ← ruvector-solver      (multi-AP TDoA equations)
└── detection/
    ├── breathing.rs          ← ruvector-temporal-tensor (tiered waveform compression)
    └── heartbeat.rs          ← ruvector-temporal-tensor (tiered micro-Doppler compression)
```

---

### 集成 1：用 DynamicMinCut 做子载波灵敏度筛选

**文件：** `wifi-densepose-signal/src/subcarrier_selection.rs`
**所用 Crate：** `ruvector-mincut`

**当前做法：** 按 `variance_motion / variance_static`
比值给所有子载波排序，取排序后的前 K 个。O(n log n) 排序，静态划分。

**ruvector 集成：** 构建相似度图，子载波为顶点，
边权表示方差比相似度的倒数（|sensitivity_i − sensitivity_j|^−1）。
`DynamicMinCut` 求出最小二分，把高灵敏度
（对运动有响应）与低灵敏度（噪声主导）的子载波分开。随着新的
静态/运动测量到来，`insert_edge`/`delete_edge` 以 O(n^1.5 log n)
摊还复杂度增量更新划分 —— 无需整体重排。

```rust
use ruvector_mincut::{DynamicMinCut, MinCutBuilder};

/// 用最小割把子载波划分为灵敏/不灵敏两组。
/// 返回 (sensitive_indices, insensitive_indices)。
pub fn mincut_subcarrier_partition(
    sensitivity: &[f32],
) -> (Vec<usize>, Vec<usize>) {
    let n = sensitivity.len();
    // 构建全连接相似度图（剪掉低于阈值的边）
    let threshold = 0.1_f64;
    let mut edges = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            let diff = (sensitivity[i] - sensitivity[j]).abs() as f64;
            let weight = if diff > 1e-9 { 1.0 / diff } else { 1e6 };
            if weight > threshold {
                edges.push((i as u64, j as u64, weight));
            }
        }
    }
    let mc = MinCutBuilder::new().exact().with_edges(edges).build();
    let (side_a, side_b) = mc.partition();
    // 平均灵敏度更高的一侧即为灵敏组
    let mean_a: f32 = side_a.iter().map(|&i| sensitivity[i as usize]).sum::<f32>()
        / side_a.len() as f32;
    let mean_b: f32 = side_b.iter().map(|&i| sensitivity[i as usize]).sum::<f32>()
        / side_b.len() as f32;
    if mean_a >= mean_b {
        (side_a.into_iter().map(|x| x as usize).collect(),
         side_b.into_iter().map(|x| x as usize).collect())
    } else {
        (side_b.into_iter().map(|x| x as usize).collect(),
         side_a.into_iter().map(|x| x as usize).collect())
    }
}
```

**优势：** 环境变化（搬动家具、新增人员）时增量更新即可，
不必重新给所有子载波排序。动态划分以 O(n^1.5 log n)
追踪灵敏度变化，对比 O(n²) 的全量重扫。

---

### 集成 2：注意力门控的 CSI 频谱图

**文件：** `wifi-densepose-signal/src/spectrogram.rs`
**所用 Crate：** `ruvector-attn-mincut`

**当前做法：** 对每个子载波独立计算 STFT，堆叠成二维
矩阵 [freq_bins × time_frames]。下游 CNN 对所有单元等权处理。

**ruvector 集成：** STFT 之后，把每个时间帧当作序列 token
（d = n_freq_bins，seq_len = n_time_frames）。用 `attn_mincut` 门控哪些
时频单元可进入频谱图输出 —— 抑制噪声帧与多径伪影，
同时放大人体运动时段。

```rust
use ruvector_attn_mincut::attn_mincut;

/// 对已算好的频谱图做注意力门控。
/// spectrogram：[n_freq_bins × n_time_frames]，行优先 f32。
pub fn gate_spectrogram(
    spectrogram: &[f32],
    n_freq: usize,
    n_time: usize,
    lambda: f32,   // 0.1 = mild gating, 0.5 = aggressive
) -> Vec<f32> {
    // Q = K = V = spectrogram（在时间帧上做自注意力）
    let out = attn_mincut(
        spectrogram, spectrogram, spectrogram,
        n_freq,      // d = feature dimension (freq bins)
        n_time,      // seq_len = number of time frames
        lambda,
        /*tau=*/ 2,
        /*eps=*/ 1e-7,
    );
    out.output
}
```

**优势：** 自注意力 + 最小割能识别出连贯的时间段
（人体运动区间），并门控掉不相关的帧（环境噪声、瞬态
干扰）。lambda 调节门控强度，无需额外的
去噪或时序平滑步骤。

---

### 集成 3：跨子载波 BVP 注意力

**文件：** `wifi-densepose-signal/src/bvp.rs`
**所用 Crate：** `ruvector-attention`

**当前做法：** 把所有子载波的 STFT 幅度等权求和得到人体速度剖面：
`BVP[v,t] = Σ_k |STFT_k[v,t]|`。等权意味着
不灵敏的子载波会稀释速度估计。

**ruvector 集成：** 用 `ScaledDotProductAttention` 计算
跨子载波的加权聚合。每个子载波提供一个 key
（其灵敏度剖面）和一个 value（其 STFT 行）。query 是当前
速度分箱。注意力权重会自动强调对所查询速度区间
有响应的子载波。

```rust
use ruvector_attention::ScaledDotProductAttention;

/// 计算跨子载波的注意力加权 BVP 聚合。
/// stft_rows：n_subcarriers 行，每行 [n_velocity_bins] 个 f32。
/// sensitivity：每个子载波的灵敏度得分 [n_subcarriers] f32。
pub fn attention_weighted_bvp(
    stft_rows: &[Vec<f32>],
    sensitivity: &[f32],
    n_velocity_bins: usize,
) -> Vec<f32> {
    let d = n_velocity_bins;
    let attn = ScaledDotProductAttention::new(d);

    // 以平均灵敏度行作为 query（整体人体运动剖面）
    let query: Vec<f32> = (0..d).map(|v| {
        stft_rows.iter().zip(sensitivity.iter())
            .map(|(row, &s)| row[v] * s)
            .sum::<f32>()
            / sensitivity.iter().sum::<f32>()
    }).collect();

    // Keys = STFT 行（每个子载波的速度剖面）
    // Values = STFT 行（同上，按注意力加权）
    let keys: Vec<&[f32]> = stft_rows.iter().map(|r| r.as_slice()).collect();
    let values: Vec<&[f32]> = stft_rows.iter().map(|r| r.as_slice()).collect();

    attn.compute(&query, &keys, &values)
        .unwrap_or_else(|_| vec![0.0; d])
}
```

**优势：** 用灵敏度感知的加权取代等权求和。落在
多径零点或噪声主导频段的子载波会自动获得较低权重，
无需手工筛选，也不必单独做灵敏度步骤。

---

### 集成 4：用 NeumannSolver 求解菲涅尔区几何系统

**文件：** `wifi-densepose-signal/src/fresnel.rs`
**所用 Crate：** `ruvector-solver`

**当前做法：** 采用闭式菲涅尔区半径公式，假定 TX-RX-人体几何已知。
实际上精确距离 d1（TX→人体）与 d2
（人体→RX）都未知 —— 由 AP 摆放只能知道 TX-RX 直线距离 D。
AP placement.

**ruvector 集成：** 当多个子载波在相同胸腔位移下观测到不同的菲涅尔区
穿越时，可用多次观测构成的超定线性系统解出未知几何
(d1, d2, Δd)。`NeumannSolver` 负责高效求解该系统
对应的稀疏正规方程。

```rust
use ruvector_solver::neumann::NeumannSolver;
use ruvector_solver::types::CsrMatrix;

/// 由多个子载波的菲涅尔观测估计 TX-人体与人体-RX 距离。
/// observations：(wavelength_m, observed_amplitude_variation) 的 Vec。
/// 返回 (d1_estimate_m, d2_estimate_m)。
pub fn solve_fresnel_geometry(
    observations: &[(f32, f32)],
    d_total: f32,  // Known TX-RX straight-line distance in metres
) -> Option<(f32, f32)> {
    let n = observations.len();
    if n < 3 { return None; }

    // 方程组：A·[d1, d2]^T = b
    // 由菲涅尔模型：A_k = |sin(2π·2·Δd / λ_k)|，观测值 ~ A_k
    // 线性化：用对数幅度比作为各行
    // 正规方程：(A^T A + λI) x = A^T b
    let lambda_reg = 0.05_f32;
    let mut coo = Vec::new();
    let mut rhs = vec![0.0_f32; 2];

    for (k, &(wavelength, amplitude)) in observations.iter().enumerate() {
        // 第 k 行：[1/wavelength, -1/wavelength] · [d1; d2] ≈ log(amplitude + 1)
        let coeff = 1.0 / wavelength;
        coo.push((k, 0, coeff));
        coo.push((k, 1, -coeff));
        let _ = amplitude; // used implicitly via b vector
    }
    // 构建正规方程
    let ata_csr = CsrMatrix::<f32>::from_coo(2, 2, vec![
        (0, 0, lambda_reg + observations.iter().map(|(w, _)| 1.0 / (w * w)).sum::<f32>()),
        (1, 1, lambda_reg + observations.iter().map(|(w, _)| 1.0 / (w * w)).sum::<f32>()),
    ]);
    let atb: Vec<f32> = vec![
        observations.iter().map(|(w, a)| a / w).sum::<f32>(),
        -observations.iter().map(|(w, a)| a / w).sum::<f32>(),
    ];

    let solver = NeumannSolver::new(1e-5, 300);
    match solver.solve(&ata_csr, &atb) {
        Ok(result) => {
            let d1 = result.solution[0].abs().clamp(0.1, d_total - 0.1);
            let d2 = (d_total - d1).clamp(0.1, d_total - 0.1);
            Some((d1, d2))
        }
        Err(_) => None,
    }
}
```

**优势：** 把菲涅尔模型从固定几何的单一公式
变成数据驱动的几何估计器。有 3 次以上观测（不同频率的子载波）时，
NeumannSolver 以 O(√n) 次迭代收敛 —— 对 100 Hz 的
实时呼吸检测至关重要。

---

### 集成 5：用 NeumannSolver 做多 AP 三角定位

**文件：** `wifi-densepose-mat/src/localization/triangulation.rs`
**所用 Crate：** `ruvector-solver`

**当前做法：** 多 AP 定位使用成对 TDoA（到达时间差）
转换成的双曲方程。求解 N 个 AP 的方程组需要线性化与最小二乘，
目前以暴力法直接解正规方程，通过高斯消元
完成求解（O(n^3)）。

**ruvector 集成：** 线性化后的 TDoA 系统是稀疏的（每次测量只涉及
2 个 AP，而非全部 N）。`CsrMatrix::from_coo` + `NeumannSolver` 以
O(√nnz) 求解稀疏正规方程，nnz 为非零元数，远小于 N^2。

```rust
use ruvector_solver::neumann::NeumannSolver;
use ruvector_solver::types::CsrMatrix;

/// 求解多 AP TDoA 的幸存者定位。
/// tdoa_measurements：(ap_i_idx, ap_j_idx, tdoa_seconds) 的 Vec。
/// ap_positions：(x, y) 米制坐标的 Vec。
/// 返回估计的 (x, y) 幸存者位置。
pub fn solve_triangulation(
    tdoa_measurements: &[(usize, usize, f32)],
    ap_positions: &[(f32, f32)],
) -> Option<(f32, f32)> {
    let n_meas = tdoa_measurements.len();
    if n_meas < 3 { return None; }

    const C: f32 = 3e8_f32; // speed of light
    let mut coo = Vec::new();
    let mut b = vec![0.0_f32; n_meas];

    // 线性化：每条 TDoA 方程减去参考 AP
    let (x_ref, y_ref) = ap_positions[0];
    for (row, &(i, j, tdoa)) in tdoa_measurements.iter().enumerate() {
        let (xi, yi) = ap_positions[i];
        let (xj, yj) = ap_positions[j];
        // 线性化方程：(xi - xj)·x + (yi - yj)·y ≈ (d_ref_i - d_ref_j + C·tdoa) / 2
        coo.push((row, 0, xi - xj));
        coo.push((row, 1, yi - yj));
        b[row] = C * tdoa / 2.0
            + ((xi * xi - xj * xj) + (yi * yi - yj * yj)) / 2.0
            - x_ref * (xi - xj) - y_ref * (yi - yj);
    }

    // 正规方程：(A^T A + λI) x = A^T b
    let lambda = 0.01_f32;
    let ata = CsrMatrix::<f32>::from_coo(2, 2, vec![
        (0, 0, lambda + coo.iter().filter(|e| e.1 == 0).map(|e| e.2 * e.2).sum::<f32>()),
        (0, 1, coo.iter().filter(|e| e.1 == 0).zip(coo.iter().filter(|e| e.1 == 1)).map(|(a, b2)| a.2 * b2.2).sum::<f32>()),
        (1, 0, coo.iter().filter(|e| e.1 == 1).zip(coo.iter().filter(|e| e.1 == 0)).map(|(a, b2)| a.2 * b2.2).sum::<f32>()),
        (1, 1, lambda + coo.iter().filter(|e| e.1 == 1).map(|e| e.2 * e.2).sum::<f32>()),
    ]);
    let atb = vec![
        coo.iter().filter(|e| e.1 == 0).zip(b.iter()).map(|(e, &bi)| e.2 * bi).sum::<f32>(),
        coo.iter().filter(|e| e.1 == 1).zip(b.iter()).map(|(e, &bi)| e.2 * bi).sum::<f32>(),
    ];

    NeumannSolver::new(1e-5, 500)
        .solve(&ata, &atb)
        .ok()
        .map(|r| (r.solution[0], r.solution[1]))
}
```

**优势：** 灾害现场有 5–20 个 AP 时，TDoA 系统有 N×(N-1)/2
= 10–190 次测量，但未知量只有 2 个（x, y）。正规方程
始终是 2×2，与 N 无关。对条件良好的 2×2 系统，
NeumannSolver 以 O(1) 次迭代收敛 —— 省去高斯消元开销。

---

### 集成 6：呼吸波形压缩

**文件：** `wifi-densepose-mat/src/detection/breathing.rs`
**所用 Crate：** `ruvector-temporal-tensor`

**当前做法：** 呼吸检测器在内存中维护近期 CSI 幅度样本的环形缓冲，
维度为子载波 × 时间。60 秒窗口、100 Hz、56 个子载波时：
60 × 100 × 56 × 4 字节 = **每区域 13.4 MB**。
16 个并发区域：**仅呼吸缓冲就占 214 MB**。

**ruvector 集成：** `TemporalTensorCompressor` 的分层量化
（热 8-bit / 温 5-7-bit / 冷 3-bit）把呼吸波形缓冲
压缩 50–75%：

```rust
use ruvector_temporal_tensor::{TemporalTensorCompressor, TierPolicy};
use ruvector_temporal_tensor::segment;

pub struct CompressedBreathingBuffer {
    compressor: TemporalTensorCompressor,
    encoded: Vec<u8>,
    n_subcarriers: usize,
    frame_count: u64,
}

impl CompressedBreathingBuffer {
    pub fn new(n_subcarriers: usize, zone_id: u64) -> Self {
        Self {
            compressor: TemporalTensorCompressor::new(
                TierPolicy::default(),
                n_subcarriers,
                zone_id,
            ),
            encoded: Vec::new(),
            n_subcarriers,
            frame_count: 0,
        }
    }

    pub fn push_frame(&mut self, amplitudes: &[f32]) {
        self.compressor.push_frame(amplitudes, self.frame_count, &mut self.encoded);
        self.frame_count += 1;
    }

    pub fn flush(&mut self) {
        self.compressor.flush(&mut self.encoded);
    }

    /// 解码全部帧用于频率分析。
    pub fn to_vec(&self) -> Vec<f32> {
        let mut out = Vec::new();
        segment::decode(&self.encoded, &mut out);
        out
    }

    /// 取单帧用于实时显示。
    pub fn get_frame(&self, idx: usize) -> Option<Vec<f32>> {
        segment::decode_single_frame(&self.encoded, idx)
    }
}
```

**内存下降：** 每区域 13.4 MB → 3.4–6.7 MB。16 个区域由 214 MB
降至 54–107 MB。灾害响应硬件（树莓派 4：4–8 GB）
因此可支撑 2–4 倍的并发区域数。

---

### 集成 7：心跳微多普勒压缩

**文件：** `wifi-densepose-mat/src/detection/heartbeat.rs`
**所用 Crate：** `ruvector-temporal-tensor`

**当前做法：** 心跳检测使用微多普勒频谱图：
对 CSI 幅度时序做滑动 STFT。每个区域保存形状为
[n_freq_bins=128, n_time=600] 的频谱图（60 秒，10 Hz 输出率）：
128 × 600 × 4 字节 = **每区域 307 KB**。16 个区域共 4.9 MB —— 尚可接受，
但心跳频谱图是访问最密集的（每次分诊更新都要查询）。
update).

**ruvector 集成：** `TemporalTensorCompressor` 把频谱图各行
存为时序帧（每行 = 一个频率 bin 的时间演化）。热层
（最近 10 秒）8-bit，温层（10–30 秒）5-bit，冷层（>30 秒）3-bit。
近期心跳周期保持高保真；历史数据压缩 5 倍：

```rust
pub struct CompressedHeartbeatSpectrogram {
    /// 每个频率 bin 配一个压缩器
    bin_buffers: Vec<TemporalTensorCompressor>,
    encoded: Vec<Vec<u8>>,
    n_freq_bins: usize,
    frame_count: u64,
}

impl CompressedHeartbeatSpectrogram {
    pub fn new(n_freq_bins: usize) -> Self {
        let bin_buffers: Vec<_> = (0..n_freq_bins)
            .map(|i| TemporalTensorCompressor::new(TierPolicy::default(), 1, i as u64))
            .collect();
        let encoded = vec![Vec::new(); n_freq_bins];
        Self { bin_buffers, encoded, n_freq_bins, frame_count: 0 }
    }

    /// 推入频谱图的一列（一个时间步，含所有频率 bin）。
    pub fn push_column(&mut self, column: &[f32]) {
        for (i, (&val, buf)) in column.iter().zip(self.bin_buffers.iter_mut()).enumerate() {
            buf.push_frame(&[val], self.frame_count, &mut self.encoded[i]);
        }
        self.frame_count += 1;
    }

    /// 从近期帧中提取心跳频段能量（0.8–1.5 Hz）。
    pub fn heartbeat_band_power(&self, low_bin: usize, high_bin: usize) -> f32 {
        (low_bin..=high_bin.min(self.n_freq_bins - 1))
            .map(|b| {
                let mut out = Vec::new();
                segment::decode(&self.encoded[b], &mut out);
                out.iter().rev().take(100).map(|x| x * x).sum::<f32>()
            })
            .sum::<f32>()
            / (high_bin - low_bin + 1) as f32
    }
}
```

---

## 性能汇总

| 集成点 | 文件 | Crate | 集成前 | 集成后 |
|---|---|---|---|---|
| 子载波筛选 | `subcarrier_selection.rs` | ruvector-mincut | O(n log n) 静态排序 | O(n^1.5 log n) 动态划分 |
| 频谱图门控 | `spectrogram.rs` | ruvector-attn-mincut | STFT 单元等权 | 注意力门控抑制噪声 |
| BVP 聚合 | `bvp.rs` | ruvector-attention | 子载波等权求和 | 灵敏度加权注意力 |
| 菲涅尔几何 | `fresnel.rs` | ruvector-solver | 固定几何公式 | 数据驱动的多观测系统 |
| 多 AP 三角定位 | `triangulation.rs`（MAT） | ruvector-solver | O(N^3) 稠密高斯消元 | O(1) 的 2×2 诺依曼系统 |
| 呼吸缓冲 | `breathing.rs`（MAT） | ruvector-temporal-tensor | 每区域 13.4 MB | 每区域 3.4–6.7 MB（降低 50–75%） |
| 心跳频谱图 | `heartbeat.rs`（MAT） | ruvector-temporal-tensor | 每区域 307 KB，无分层 | 热/温/冷分层 |

## 需要改动的依赖

加入 `v2/Cargo.toml` workspace（ADR-016 中已存在）：
```toml
ruvector-mincut = "2.0.4"          # already present
ruvector-attn-mincut = "2.0.4"    # already present
ruvector-temporal-tensor = "2.0.4" # already present
ruvector-solver = "2.0.4"          # already present
ruvector-attention = "2.0.4"       # already present
```

加入 `wifi-densepose-signal/Cargo.toml` 与 `wifi-densepose-mat/Cargo.toml`：
```toml
[dependencies]
ruvector-mincut = { workspace = true }
ruvector-attn-mincut = { workspace = true }
ruvector-temporal-tensor = { workspace = true }
ruvector-solver = { workspace = true }
ruvector-attention = { workspace = true }
```

## 对 ADR-002 依赖策略的更正

ADR-002 的依赖策略一节指定了并不存在的 crate：
```toml
# 错误（ADR-002 原文 —— 这些 crate 在 crates.io 上并不存在）
ruvector-core = { version = "0.1", features = ["hnsw", "sona", "gnn"] }
ruvector-data-framework = { version = "0.1", features = ["rvf", "witness", "crypto"] }
ruvector-consensus = { version = "0.1", features = ["raft"] }
ruvector-wasm = { version = "0.1", features = ["edge-runtime"] }
```

正确的已发布 crate（已在 crates.io 核实，源码见 github.com/ruvnet/ruvector）：
```toml
# 正确（截至 2026-02-28，均为 v2.0.4）
ruvector-mincut = "2.0.4"          # Dynamic min-cut, O(n^1.5 log n) updates
ruvector-attn-mincut = "2.0.4"    # Attention + mincut gating
ruvector-temporal-tensor = "2.0.4" # Tiered temporal compression
ruvector-solver = "2.0.4"          # NeumannSolver, sublinear convergence
ruvector-attention = "2.0.4"       # ScaledDotProductAttention
```

ADR-002 中描述的 RVF 认知容器格式（ADR-003）、HNSW 检索（ADR-004）、SONA
自学习（ADR-005）、GNN 模式（ADR-006）、后量子密码（ADR-007）、
Raft 共识（ADR-008）与 WASM 边缘运行时（ADR-009），
都是 ruvector 内部的架构能力，在 v2.0.4 并未作为独立
crate 发布。这些 ADR 仍作为前瞻性架构指引保留；其实现路径
将视情况采用这五个已发布的 crate
作为基础构件。

## 实施优先级

| 优先级 | 集成项 | 理由 |
|---|---|---|
| P1 | 呼吸 + 心跳压缩（MAT） | 16 区域灾害部署的内存瓶颈 |
| P1 | 多 AP 三角定位（MAT） | 安全攸关的精度提升 |
| P2 | 用 DynamicMinCut 做子载波筛选 | 支持动态适应环境变化 |
| P2 | BVP 注意力聚合 | 直接提升活动分类准确率 |
| P3 | 频谱图注意力门控 | 降低 CNN 输入噪声；需重新训练 CNN |
| P3 | 菲涅尔几何系统 | 在未知几何下改善呼吸检测 |

## 影响

### 正面影响
- 所有生产 crate（train、signal、MAT）的 ruvector 集成方式一致
- 灾害检测内存降低 50–75%，可支撑 2–4 倍并发区域
- 动态子载波划分无需人工调参即可适应环境变化
- 注意力加权 BVP 降低不灵敏子载波带来的速度估计误差
- NeumannSolver 三角定位对 AP 数量是 O(1)（始终解 2×2 系统）

### 负面影响
- ruvector crate 操作 `&[f32]` CPU 切片；MAT 与 signal crate 必须
  从其原生类型（ndarray、复数）做桥接
- `ruvector-temporal-tensor` 压缩是有损的；温/冷层中的心跳幅度值
  可能丢失细粒度细节（由热层的近期数据缓解）
- 基于 DynamicMinCut 的子载波筛选假定近似二分的划分；
  存在 3 组以上不同子载波群的环境可能需要多路割扩展

## 相关 ADR

- ADR-001：WiFi-Mat 灾害检测（目标：MAT 集成 5–7）
- ADR-002：RuVector RVF 集成策略（crate 名已在上面更正）
- ADR-014：面向 WiFi 感知的 SOTA 信号处理算法（目标：signal 集成 1–4）
- ADR-015：用公开数据集训练姿态估计模型（ADR-016 之前的实现）
- ADR-016：训练流水线的 RuVector 集成（已完成的参考实现）

## 参考资料

- [ruvector source](https://github.com/ruvnet/ruvector)
- [DynamicMinCut API](https://docs.rs/ruvector-mincut/2.0.4)
- [NeumannSolver convergence](https://en.wikipedia.org/wiki/Neumann_series)
- [Tiered quantization](https://arxiv.org/abs/2103.13630)
- 参考论文：SpotFi (SIGCOMM 2015)、Widar 3.0 (MobiSys 2019)、FarSense (MobiCom 2019)
