# ADR-287：`wifi-densepose-sar` —— 相干宽带 RF 层析成像研究 crate

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted — implemented (P1), **published** |
| **日期** | 2026-07-30 |
| **父级** | ADR-278（雷达逆渲染研究计划）、ADR-282（强制 L0–L5 证据阶梯）|
| **关联** | ADR-273/274（`ruview-unified` 的 `FmcwRadarCube` 适配器，最终的集成点）、ADR-275（`GaussianMap`，同上）、ADR-286（`wifi-densepose-sar-harness`，为本 crate 铸造的 MetaHarness）|
| **已发布** | [`wifi-densepose-sar` v0.3.1](https://crates.io/crates/wifi-densepose-sar) 已在 crates.io 发布（2026-07-31）|

## 0. PROOF 纪律

本 crate 产出的每一个精度数值都是 **SYNTHETIC / evidence level L0**（ADR-282）：由 crate 自身的正向模拟器（`measurement::simulate_measurement`）生成，并对照其自身已知的真值（`ScatteringTarget` 位置）打分。此处没有任何内容经过真实宽带 RF 硬件验证，crate 也不含任何此类硬件集成。

## 1. 背景

一家获 YC 投资的公司 Applied Electrodynamics（“WaveSight”）公开推出了一款手持式“能看穿墙壁的相机”，采用未公开的无线电成像技术。将其与本仓库的能力对比后，暴露出一个真实的差距：`wifi-densepose-signal::ruvsense::tomography` 实现的是*无线电层析成像*（Wilson & Patwari 2010）——基于 RSS 的固定链路拓扑阴影衰减，没有相干相位、没有多频步进、没有合成孔径。这与 SAR 式穿墙成像仪所需的技术不同：相干、宽带、多位置反向投影。

`ruview-unified` 的 `FmcwRadarCube` 适配器（ADR-274）已经把宽带雷达立方按位置归一化为距离剖面，而 ADR-278 已经把 ADR-276 合成世界生成器的雷达立方输出扩展命名为任何未来雷达逆问题研究的预定沙盒。在此 ADR 之前，两者都不包含真正的反向投影重建核——这正是每个候选技术（匹配滤波 SAR、GPR 成像、RISE/DiffRadar 式反演）所依赖的基本原语。

## 2. 决策

将 `wifi-densepose-sar` 作为一个独立的叶子 crate 发布（采用 `nvsim` 模式：纯 Rust、确定性的 ChaCha20 种子、与 `wifi-densepose-hardware` 或任何真实摄取路径零耦合），实现：

1. **正向测量模型**（`measurement.rs`）：模拟单站合成孔径雷达从已知点散射体记录到的复数、步进频率回波——`y_{m,k} = Σ_j σ_j/R_{m,j}² · exp(-i·4π·f_k·R_{m,j}/c) + noise`。
2. **反向投影重建**（`reconstruct.rs`）：将 (1) 的匹配滤波逆运算投影到 3D 体素网格上，并按体素并行化（rayon）。
3. **点云提取**（`pointcloud.rs`）：从稠密体素图像中做阈值 + 局部极大值提取。
4. **闭式分辨率/相干性公式**（`resolution.rs`）：`ΔR = c/2B`（距离分辨率）、`δ_CR ≈ λR/2L`（交叉距离/合成孔径分辨率）、`Δp ≤ λ/8`（天线位姿相干预算，由四分之一波长往返路径容差推得）——在 `tests/physics_validation.rs` 中对照重建的实际行为进行校验，而非仅停留在文档层面。

这一范围被刻意定在 ADR-278 的 RISE/DiffRadar/GeRaF 复现计划“低一级”：它只是最基础的测量模型 + 反向投影原语，不是对任何已发表特定系统的复现，也不对 Applied Electrodynamics 未公开的产品做出任何声明（其波形、天线数量、带宽与算法均属未知；本 crate 只是把同样成熟的 SAR/GPR 物理——参见 Skolnik 的 *Radar Handbook*——应用到合成数据上）。

## 3. 这明确不是什么

- 不是硬件驱动。本 crate 内任何位置都不存在 VNA/SDR/宽带 RF 前端的代码，也没有往 `wifi-densepose-hardware` 中添加。
- 未接入 `ruview-unified` 的 `FmcwRadarCube` 适配器或 `GaussianMap`。该集成是真正的未来工作（§5），刻意延后，以便重建物理先在隔离环境中得到验证——这与 ADR-278 §2.3 已规定的分阶段策略一致（“先沙盒……再上硬件”）。
- 不是 RISE、DiffRadar 或 GeRaF 的复现。ADR-278 的关卡（G1–G4）不受本 ADR 影响。
- 不是对真实世界穿墙成像性能的声明。正向模型仅为自由空间传播——没有多径、没有按材质衰减、没有天线增益方向图、没有接收机噪声系数。真实世界性能取决于上述所有因素。

## 4. 简化项（诚实边界）

- **单站，而非 MIMO。** 在每个合成孔径位置上，单根天线同时充当发射与接收（标准 stripmap-SAR 简化），而非多单元 MIMO 阵列。在现有测量模型结构下，扩展到双站/MIMO 的 `(m, n)` 发射/接收对是直截了当的，但并未实现。
- **各向同性天线，无增益方向图。** 每个天线位置向所有方向均匀辐射/接收。
- **仅自由空间传播。** 没有多径，没有材质透射/反射/衰减（对比 `ruview-unified::synth::room` 的 Fresnel 材质模型，它是窄带 CW，尚未扩展到宽带——一个自然的后续，见 §5）。
- **`1/R²` 双向幅度衰减，无标定。** 真实接收机具有有限动态范围、噪声系数，并需要与已知参考目标做标定；这些都没有被建模。

## 5. 后续工作（不在本 ADR 范围内）

1. 扩展 `ruview-unified::synth::room` 的像法光线追踪器，使其发射宽带步进频率多位置立方（按 ADR-278 §2.3），并将 `wifi-densepose-sar::reconstruct` 接到那个更丰富（多径感知）的合成生成器上，取代此处的纯自由空间模型。
2. 一个 `ruview-unified` 集成适配器，将 `ReflectivityImage`/`PointCloudPoint` 输出转换为 `RfGaussian`/`GaussianMap` 原语（ADR-278 §2.4 规定的集成契约）。
3. 双站/MIMO 测量模型。
4. ADR-278 中任何真正的“带关卡复现”（先 RISE），若且当该程序推进时——本 crate 将是其中一员，而非替代品。

## 6. 后果

- 工作区获得了一个真实存在（尽管范围被刻意缩小）的相干成像原语，而此前空无一物——若 ADR-278 研究计划推进，它将是有用的基础工作，也是对“本仓库能否造出类似 WaveSight 的设备”的直接、诚实的回答（不能，没有激励性对比中所描述的硬件计划；能，这正是此类计划所需的重建算法基础工作）。
- 对现有的 `wifi-densepose-signal::ruvsense::tomography`（基于 RSS 的 RTI）代码路径或任何生产流水线零风险——本 crate 未被其中任何一个引用。
- 25 个测试（22 单元 + 3 集成物理校验），0 失败，clippy 干净。Criterion 基准：MEASURED 512/4096/32768 体素反向投影重建吞吐（最新记录数字见 crate README）。增量相位旋转优化（§7）将重建时间缩短了约 4.4–4.5 倍，并已证明与被其取代的按频率直接计算等价。

## 7. 后续优化：增量相位旋转（2026-07-30，MEASURED）

`focus_at_point` 原先为每一项（位姿、频率）调用一次 `Complex64::from_polar`（一对 `sin`/`cos`）。由于 [`FrequencySweep::frequencies`](../../v2/crates/wifi-densepose-sar/src/measurement.rs) 按其构造产出等间隔频率，逐项相位是频率索引上的等差数列——因此相位器可每位姿求值一次，再按频率以固定的复数乘法步进推进，用 2 次复数运算取代 K 次三角函数求值。`focus_at_point` 的签名从原始的 `&[f64]` 频率切片改为 `&FrequencySweep`，使该优化所依赖的“频率等间隔”前提从“调用方自行观察”升级为类型级不变量。

**MEASURED（criterion 回归检测，p < 0.001）：跨 512/4096/32768 体素网格快约 4.4–4.5 倍**。**已证明等价**，而非仅仅更快：`reconstruct::tests::backprojection_incremental_rotation_matches_direct_per_frequency_computation` 在四种扫描尺寸（含 `n_steps=1` 退化情况）及在目标与离目标两种求值点上，以 <1e-9 相对误差，将优化路径与独立重实现的按频率直接计算参考进行对照。

## 8. 已发布（2026-07-31）

`wifi-densepose-sar` v0.3.1 已在 [crates.io](https://crates.io/crates/wifi-densepose-sar) 上线——`cargo add wifi-densepose-sar` 可从任意 Rust 项目解析它。为本 crate 铸造的 MetaHarness（ADR-286，`wifi-densepose-sar-harness`）已随之一并发布到 npm。发布发生在本 ADR 的实现与 §7 优化落地之后；发布本身未改动任何代码。
