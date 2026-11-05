# ADR-005：用 SONA 自学习做姿态估计

## 状态
部分在 [ADR-023](ADR-023-trained-densepose-model-ruvector-pipeline.md) 中落地；由 [ADR-027](ADR-027-cross-environment-domain-generalization.md) 扩展

> **说明：** ADR-023 用 MicroLoRA rank-4 适配器与 EWC++ 记忆保持实现了 SONA。ADR-027（MERIDIAN）为 SONA 增加了无监督快速适配：在新房间里采集 10 秒无标注 WiFi 数据，即可通过对比式测试时训练自动生成该环境专属的 LoRA 权重。

## 日期
2026-02-28

## 背景

### 静态模型的问题

WiFi-DensePose 的模态转换网络（Python 中为 `ModalityTranslationNetwork`，Rust 中为 `ModalityTranslator`）把 CSI 特征转换成类视觉特征图，交给 DensePose 头部做人体分割与 UV 坐标估计。这些模型离线训练，部署后权重固定不变。

**静态模型的关键局限**：

1. **环境漂移**：家具移动、新增物品或房间人员变化都会改变 CSI 特征。在实验室 A 训练的模型，不重训就会在实验室 B 上退化。

2. **硬件差异**：不同 WiFi 芯片组（Intel AX200、Broadcom BCM4375、Qualcomm WCN6855）产生的 CSI 模式有细微差别，静态模型会过拟合到训练时用的硬件。

3. **时间漂移**：即便在同一环境，CSI 模式也会随温度、湿度以及一天中电磁干扰的变化而偏移。

4. **人群偏差**：只在某一人群上训练的模型，对训练数据中未覆盖的体型、身高或动作模式表现较差。

目前的缓解办法是用新数据人工重训，这需要：
- 在新环境采集标注数据
- GPU 密集训练（数小时到数天）
- 模型导出/部署流程
- 切换期间的停机

### SONA 的机会

RuVector 的自优化神经架构（SONA）通过以下方式实现 <1ms 在线适配：

- **LoRA（低秩适配）**：不更新全部权重（数百万参数），而是把可训练的小型秩分解矩阵注入冻结的模型层。对权重矩阵 W ∈ R^(d×k)，LoRA 学习 A ∈ R^(d×r) 与 B ∈ R^(r×k)，其中 r << min(d,k)，适配后的权重为 W + AB。

- **EWC++（弹性权重巩固）**：通过对「对已学任务重要的参数」的改动施加惩罚，避免灾难性遗忘。每个参数都有按 Fisher 信息加权的重要性分数。

- **在线梯度累积**：小批量实时数据（少至 1-10 个样本）即可参与适配，无需完整反向传播。

## 决策

我们将把 SONA 作为模态转换网络与 DensePose 头部的在线学习引擎，实现持续的、环境专属的适配，无需离线重训。

### 适配架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                    SONA Adaptation Pipeline                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Frozen Base Model                    LoRA Adaptation Matrices       │
│  ┌─────────────────┐                  ┌──────────────────────┐      │
│  │ Conv2d(64,128)  │ ◀── W_frozen ──▶ │ A(64,r) × B(r,128) │      │
│  │ Conv2d(128,256) │ ◀── W_frozen ──▶ │ A(128,r) × B(r,256)│      │
│  │ Conv2d(256,512) │ ◀── W_frozen ──▶ │ A(256,r) × B(r,512)│      │
│  │ ConvT(512,256)  │ ◀── W_frozen ──▶ │ A(512,r) × B(r,256)│      │
│  │ ...             │                  │ ...                  │      │
│  └─────────────────┘                  └──────────────────────┘      │
│         │                                      │                     │
│         ▼                                      ▼                     │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │            Effective Weight = W_frozen + α(AB)           │        │
│  │            α = scaling factor (0.0 → 1.0 over time)     │        │
│  └─────────────────────────────────────────────────────────┘        │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │                    EWC++ Regularizer                      │        │
│  │  L_total = L_task + λ Σ F_i (θ_i - θ*_i)²              │        │
│  │                                                          │        │
│  │  F_i = Fisher information (parameter importance)         │        │
│  │  θ*_i = optimal parameters from previous tasks           │        │
│  │  λ = regularization strength (10-100)                    │        │
│  └─────────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
```

### 逐层 LoRA 配置

```rust
/// WiFi-DensePose 的 SONA LoRA 配置
pub struct SonaConfig {
    /// LoRA 秩（r）：适配矩阵的维度
    /// 编码器层用 r=4（所需变化较少）
    /// 解码器层用 r=8（需要更强表达）
    /// 最终输出层用 r=16（最大适配能力）
    lora_ranks: HashMap<String, usize>,

    /// 缩放因子 alpha：控制适配强度
    /// 从 0.0（纯冻结模型）开始，逐步升到目标值
    alpha: f64,  // Target: 0.3

    /// 达到目标值之前的 alpha 预热步数
    alpha_warmup_steps: usize,  // 100

    /// EWC++ 正则化强度
    ewc_lambda: f64,  // 50.0

    /// Fisher 信息估计所用样本数
    fisher_samples: usize,  // 200

    /// 在线学习率（远小于离线训练）
    online_lr: f64,  // 1e-5

    /// 应用更新前的梯度累积步数
    accumulation_steps: usize,  // 10

    /// 单次适配增量的上限（安全边界）
    max_delta_norm: f64,  // 0.1
}
```

**参数预算**：

| 层 | 原参数量 | LoRA 秩 | LoRA 参数量 | 额外开销 |
|-------|----------------|-----------|-------------|----------|
| 编码器 Conv1 (64→128) | 73,728 | 4 | 768 | 1.0% |
| 编码器 Conv2 (128→256) | 294,912 | 4 | 1,536 | 0.5% |
| 编码器 Conv3 (256→512) | 1,179,648 | 4 | 3,072 | 0.3% |
| 解码器 ConvT1 (512→256) | 1,179,648 | 8 | 6,144 | 0.5% |
| 解码器 ConvT2 (256→128) | 294,912 | 8 | 3,072 | 1.0% |
| 输出 Conv (128→24) | 27,648 | 16 | 2,432 | 8.8% |
| **合计** | **3,050,496** | - | **17,024** | **0.56%** |

SONA 只适配 **0.56% 的参数**，却能获得全量微调 70-90% 的精度提升。

### 适配触发条件

```rust
/// 何时触发 SONA 适配
pub enum AdaptationTrigger {
    /// 检测置信度在 N 个样本内降到阈值以下
    ConfidenceDrop {
        threshold: f64,     // 0.6
        window_size: usize, // 50
    },

    /// CSI 统计相对基线发生漂移（KL 散度）
    DistributionDrift {
        kl_threshold: f64,  // 0.5
        reference_window: usize, // 1000
    },

    /// 检测到新环境（HNSW 中没有相近匹配）
    NewEnvironment {
        min_distance: f64,  // 0.8 (far from all known fingerprints)
    },

    /// 周期性适配（维护）
    Periodic {
        interval_samples: usize, // 10000
    },

    /// 通过 API 手动触发
    Manual,
}
```

### 适配反馈来源

由于 WiFi-DensePose 在部署环境里没有摄像头真值，适配依靠**自监督信号**：

1. **时间一致性**：相邻帧之间的姿态估计应当平滑变化，突兀跳变说明预测有误。
   ```
   L_temporal = ||pose(t) - pose(t-1)||² when Δt < 100ms
   ```

2. **物理合理性**：身体各部位位置必须满足骨骼约束（肢体长度、关节角度）。
   ```
   L_skeleton = Σ max(0, |limb_length - expected_length| - tolerance)
   ```

3. **多视角一致性**（多 AP）：观测同一人的不同 AP 应给出一致的姿态。
   ```
   L_multiview = ||pose_AP1 - transform(pose_AP2)||²
   ```

4. **检测稳定性**：环境稳定时置信度应当较高。
   ```
   L_stability = -log(confidence) when variance(CSI_window) < threshold
   ```

### 安全机制

```rust
/// 防止适配把模型带偏的安全边界
pub struct AdaptationSafety {
    /// 每次更新允许的最大参数变化
    max_step_norm: f64,

    /// 验证损失恶化到该倍数时回滚
    rollback_threshold: f64,  // 1.5 (50% worse = rollback)

    /// 保留 N 个检查点用于回滚
    checkpoint_count: usize,  // 5

    /// 连续回滚 N 次后停用适配
    max_consecutive_rollbacks: usize,  // 3

    /// 两次适配之间的最少样本数
    cooldown_samples: usize,  // 100
}
```

### 通过 RVF 持久化

适配状态保存在模型容器（ADR-003）中：
- LoRA 矩阵 A、B 序列化进 VEC 段
- Fisher 信息矩阵一并序列化
- 每次适配都写一条见证链记录（ADR-010）
- COW 分支可回退到任意历史适配状态

```
model.rvf.model
  ├── main (frozen base weights)
  ├── branch/adapted-office-2024-01 (LoRA deltas)
  ├── branch/adapted-warehouse (LoRA deltas)
  └── branch/adapted-outdoor-disaster (LoRA deltas)
```

## 影响

### 正面影响
- **零停机适配**：模型在运行过程中持续改进
- **开销极小**：1.7 万参数（0.56%）对比 300 万参数的完整模型；每步适配 <1ms
- **不遗忘**：EWC++ 保持在已见过环境上的表现
- **适配结果可移植**：LoRA 增量约 70 KB，便于设备间分发
- **安全回滚**：检查点机制防止模型持续劣化
- **自监督**：部署期间不需要标注数据

### 负面影响
- **表达能力有界**：LoRA 秩限制了适配幅度，环境剧烈变化仍可能需要离线重训
- **反馈噪声**：自监督信号弱于真值标注，适配更慢、精度更低
- **端侧算力**：即便梯度计算很小，推理设备上仍需张量运算
- **复杂度**：调试适配过的模型比调试静态模型更难
- **超参数敏感**：EWC lambda、LoRA 秩、学习率都需要调优

### 验证计划

1. **离线验证**：在环境 A 上训练基础模型，用已知真值测试 SONA 向环境 B 的适配效果，测量姿态估计 MPJPE（平均每关节位置误差）的改善。
2. **A/B 部署**：在同一路 CSI 流上并行运行静态模型与 SONA 适配模型，比较检测率与姿态一致性。
3. **压力测试**：快速切换环境（模拟），验证 EWC++ 能防止灾难性遗忘。
4. **边缘时延**：在目标硬件（Raspberry Pi 4、Jetson Nano、浏览器 WASM）上测适配单步耗时。

## 参考资料

- [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685)
- [Elastic Weight Consolidation (EWC)](https://arxiv.org/abs/1612.00796)
- [Continual Learning with SONA](https://github.com/ruvnet/ruvector)
- [Self-Supervised WiFi Sensing](https://arxiv.org/abs/2203.11928)
- ADR-002：RuVector RVF 集成策略
- ADR-003：面向 CSI 数据的 RVF 认知容器
