# ADR-001：WiFi-Mat 灾害检测架构

## 状态
Accepted

## 日期
2026-01-13

## 背景

地震、建筑倒塌、雪崩、洪水等自然灾害会把受困人员压在瓦砾或废墟之下。传统的目视检查、热成像仪、声学设备搜救方式存在明显局限：

- **视觉/光学**：无法穿透瓦砾、碎石或坍塌结构
- **热成像**：穿透深度有限，且受环境温度影响
- **声学**：需要受困者发出声音，误报率高
- **搜救犬**：数量有限、易疲劳，现场环境还有危险

基于 WiFi 的感知具备独特优势：**射频信号可以穿透非金属废墟**（混凝土、木材、石膏板），并能通过信道状态信息（CSI）分析检测到包括呼吸节律和心跳在内的细微人体动作。

### 问题陈述

我们需要为 WiFi-DensePose 的 Rust 实现增加一个模块化扩展，使其能够：

1. 在灾害场景中以高灵敏度检测人体存在
2. 在瓦砾/废墟区域内定位幸存者
3. 判定受困者状态（有意识活动、仅有呼吸、危重）
4. 向救援队提供实时告警
5. 在条件恶劣的野外环境中依托便携硬件运行

## 决策

我们将新建一个 crate `wifi-densepose-mat`（大规模伤亡评估工具），作为现有 Rust workspace 的模块化扩展，架构如下：

### 1. 领域驱动设计（DDD）方法

该模块遵循 DDD 原则，划分出清晰的限界上下文：

```
wifi-densepose-mat/
├── src/
│   ├── domain/           # Core domain entities and value objects
│   │   ├── survivor.rs   # Survivor entity with status tracking
│   │   ├── disaster_event.rs  # Disaster event aggregate root
│   │   ├── scan_zone.rs  # Geographic zone being scanned
│   │   └── alert.rs      # Alert value objects
│   ├── detection/        # Life sign detection bounded context
│   │   ├── breathing.rs  # Breathing pattern detection
│   │   ├── heartbeat.rs  # Micro-doppler heartbeat detection
│   │   ├── movement.rs   # Gross/fine movement classification
│   │   └── classifier.rs # Multi-modal victim classifier
│   ├── localization/     # Position estimation bounded context
│   │   ├── triangulation.rs  # Multi-AP triangulation
│   │   ├── fingerprinting.rs # CSI fingerprint matching
│   │   └── depth.rs      # Depth/layer estimation in rubble
│   ├── alerting/         # Notification bounded context
│   │   ├── priority.rs   # Triage priority calculation
│   │   ├── dispatcher.rs # Alert routing and dispatch
│   │   └── protocols.rs  # Emergency protocol integration
│   └── integration/      # Anti-corruption layer
│       ├── signal_adapter.rs  # Adapts wifi-densepose-signal
│       └── nn_adapter.rs      # Adapts wifi-densepose-nn
```

### 2. 核心架构决策

#### 2.1 事件驱动架构
- 所有幸存者检测结果都会发出领域事件
- 事件支持审计追踪与事后复盘重放
- 支持多支扫描队协同的分布式部署

#### 2.2 可配置的检测流水线
```rust
pub struct DetectionPipeline {
    breathing_detector: BreathingDetector,
    heartbeat_detector: HeartbeatDetector,
    movement_classifier: MovementClassifier,
    ensemble_classifier: EnsembleClassifier,
}
```

#### 2.3 分诊分类（兼容 START 协议）
| 状态 | 判定条件 | 优先级 |
|--------|-------------------|----------|
| 立即处置（红） | 检测到呼吸，无活动 | P1 |
| 延迟处置（黄） | 有活动且有呼吸，生命体征平稳 | P2 |
| 轻伤（绿） | 活动有力，有响应性动作模式 | P3 |
| 死亡（黑） | 连续扫描 >30 分钟无任何生命体征 | P4 |

#### 2.4 硬件抽象
支持多种部署场景：
- **便携式**：单个 TX/RX 配手持设备
- **分布式**：在坍塌现场周围部署多个 AP
- **无人机载**：基于 UAV 的大范围扫描
- **车载**：移动指挥所配天线阵列

### 3. 集成策略

该模块通过适配器与现有 crate 集成：

```
┌─────────────────────────────────────────────────────────────┐
│                    wifi-densepose-mat                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Detection  │  │ Localization│  │      Alerting       │  │
│  │  Context    │  │   Context   │  │      Context        │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          │                                   │
│              ┌───────────▼───────────┐                       │
│              │   Integration Layer   │                       │
│              │  (Anti-Corruption)    │                       │
│              └───────────┬───────────┘                       │
└──────────────────────────┼───────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│wifi-densepose │  │wifi-densepose │  │wifi-densepose │
│    -signal    │  │     -nn       │  │   -hardware   │
└───────────────┘  └───────────────┘  └───────────────┘
```

### 4. 性能要求

| 指标 | 目标 | 依据 |
|--------|--------|-----------|
| 检测时延 | <500ms | 为救援人员提供实时反馈 |
| 误报率 | <5% | 减少无效救援投入 |
| 漏报率 | <1% | 不能漏掉幸存者 |
| 穿透深度 | 3-5m | 典型瓦砾堆深度 |
| 电池续航（便携式） | >8 小时 | 满足一个完整班次 |
| 并发区域数 | 16+ | 覆盖大型灾害现场 |

### 5. 安全与可靠性

- **失效安全默认值**：信号不明确时一律假定有生命存在
- **冗余检测**：多个算法对「有人」结果投票
- **持续监测**：周期性重扫各区域
- **离线运行**：无网络时功能完整
- **审计日志**：完整记录每一次检测

## 影响

### 正面影响
- 模块化设计便于独立开发与测试
- DDD 让领域专家能够校验业务逻辑
- 事件驱动支持分布式部署
- 适配器隔离上游变更带来的影响
- 与现有 WiFi-DensePose 基础设施兼容

### 负面影响
- 事件系统带来额外复杂度
- 救援队需要学习成本
- 不同废墟类型需要分别标定
- 灾害现场存在射频干扰

### 风险与缓解措施
| 风险 | 缓解措施 |
|------|------------|
| 金属废墟遮挡信号 | 多角度扫描、自适应频率 |
| 环境射频干扰 | 频谱感知、跳频 |
| 动物造成误报 | 按体型/动作模式分类 |
| 现场供电受限 | 低功耗模式、太阳能充电 |

## 参考资料

- [WiFi-based Vital Signs Monitoring](https://dl.acm.org/doi/10.1145/3130944)
- [Through-Wall Human Sensing](https://ieeexplore.ieee.org/document/8645344)
- [START Triage Protocol](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3088332/)
- [CSI-based Human Activity Recognition](https://arxiv.org/abs/2004.03661)
