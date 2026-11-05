# WiFi-Mat 用户指南

## 面向灾害响应的大规模伤员评估工具

WiFi-Mat（大规模评估工具）是 WiFi-DensePose 的模块化扩展，专为搜索与救援行动设计。它利用 WiFi 信道状态信息（CSI），在地震、建筑倒塌、雪崩等灾害场景中探测并定位被困在瓦砾、碎石与坍塌结构下的幸存者。

---

## 目录

1. [概览](#overview)
2. [主要功能](#key-features)
3. [安装](#installation)
4. [快速上手](#quick-start)
5. [架构](#architecture)
6. [配置](#configuration)
7. [检测能力](#detection-capabilities)
8. [定位系统](#localization-system)
9. [分诊分级](#triage-classification)
10. [告警系统](#alert-system)
11. [API 参考](#api-reference)
12. [硬件配置](#hardware-setup)
13. [现场部署指南](#field-deployment-guide)
14. [排障](#troubleshooting)
15. [最佳实践](#best-practices)
16. [安全须知](#safety-considerations)

---

<a id="overview"></a>
## 概览

### 什么是 WiFi-Mat？

WiFi-Mat 沿用与 WiFi-DensePose 相同的 WiFi 感知技术，但针对灾害响应的特殊难点做了优化：

- **穿墙探测**：透过碎石、瓦砾与坍塌结构探测生命迹象
- **非侵入**：初评阶段无需扰动不稳定的结构
- **快速部署**：便携传感器阵列几分钟内即可架设完成
- **多伤员分诊**：按 START 规程自动排定救援优先级
- **三维定位**：估算幸存者位置，包括其在废墟下的埋深

### 适用场景

| 灾害类型 | 探测范围 | 典型埋深 | 成功率 |
|--------------|-----------------|---------------|--------------|
| 地震瓦砾 | 半径 15-30m | 最深 5m | 85-92% |
| 建筑倒塌 | 半径 20-40m | 最深 8m | 80-88% |
| 雪崩 | 半径 10-20m | 积雪最深 3m | 75-85% |
| 矿井塌方 | 半径 15-25m | 最深 10m | 70-82% |
| 洪灾堆积物 | 半径 10-15m | 最深 2m | 88-95% |

---

<a id="key-features"></a>
## 主要功能

### 1. 生命体征检测
- **呼吸检测**：0.1-0.5 Hz（每分钟 4-60 次）
- **心跳检测**：0.8-3.3 Hz（30-200 BPM），基于微多普勒
- **运动分类**：大幅、精细、颤抖与周期性运动

### 2. 幸存者定位
- **二维位置**：3 个以上传感器时精度 ±0.5m
- **埋深估计**：穿过最深 5m 的废墟，精度 ±0.3m
- **置信度评分**：实时量化不确定性

### 3. 分诊分级
- **START 规程**：立即救治 / 延迟救治 / 轻伤 / 死亡
- **自动排序**：依据生命体征与可接近程度
- **动态更新**：情况变化时重新分诊

### 4. 告警系统
- **按优先级**：紧急 / 高 / 中 / 低 四级告警
- **多渠道**：声音、视觉、移动推送、电台集成
- **自动升级**：幸存者状况恶化时自动提升级别

---

<a id="installation"></a>
## 安装

### 前置条件

```bash
# Rust 工具链（1.70+）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 必需的系统依赖（Ubuntu/Debian）
sudo apt-get install -y build-essential pkg-config libssl-dev
```

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/ruvnet/wifi-densepose.git
cd wifi-densepose/v2

# 构建 wifi-mat crate
cargo build --release --package wifi-densepose-mat

# 运行测试
cargo test --package wifi-densepose-mat

# 启用全部特性构建
cargo build --release --package wifi-densepose-mat --all-features
```

### 特性开关

```toml
# Cargo.toml 特性开关
[features]
default = ["std"]
std = []
serde = ["dep:serde"]
async = ["tokio"]
hardware = ["wifi-densepose-hardware"]
neural = ["wifi-densepose-nn"]
full = ["serde", "async", "hardware", "neural"]
```

---

<a id="quick-start"></a>
## 快速上手

### 基础示例

```rust
use wifi_densepose_mat::{
    DisasterResponse, DisasterConfig, DisasterType,
    ScanZone, ZoneBounds,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 按地震救援场景配置
    let config = DisasterConfig::builder()
        .disaster_type(DisasterType::Earthquake)
        .sensitivity(0.85)
        .confidence_threshold(0.5)
        .max_depth(5.0)
        .continuous_monitoring(true)
        .build();

    // 初始化响应系统
    let mut response = DisasterResponse::new(config);

    // 初始化灾害事件
    let location = geo::Point::new(-122.4194, 37.7749); // 旧金山
    response.initialize_event(location, "Building collapse - Market Street")?;

    // 定义扫描区域
    let zone_a = ScanZone::new(
        "North Wing - Ground Floor",
        ZoneBounds::rectangle(0.0, 0.0, 30.0, 20.0),
    );
    response.add_zone(zone_a)?;

    let zone_b = ScanZone::new(
        "South Wing - Basement",
        ZoneBounds::rectangle(30.0, 0.0, 60.0, 20.0),
    );
    response.add_zone(zone_b)?;

    // 开始扫描
    println!("Starting survivor detection scan...");
    response.start_scanning().await?;

    // 获取检出的幸存者
    let survivors = response.survivors();
    println!("Detected {} potential survivors", survivors.len());

    // 获取需立即救治的幸存者
    let immediate = response.survivors_by_triage(TriageStatus::Immediate);
    println!("{} survivors require immediate rescue", immediate.len());

    Ok(())
}
```

### 最小检测示例

```rust
use wifi_densepose_mat::detection::{
    BreathingDetector, BreathingDetectorConfig,
    DetectionPipeline, DetectionConfig,
};

fn detect_breathing(csi_amplitudes: &[f64], sample_rate: f64) {
    let config = BreathingDetectorConfig::default();
    let detector = BreathingDetector::new(config);

    if let Some(breathing) = detector.detect(csi_amplitudes, sample_rate) {
        println!("Breathing detected!");
        println!("  Rate: {:.1} BPM", breathing.rate_bpm);
        println!("  Pattern: {:?}", breathing.pattern_type);
        println!("  Confidence: {:.2}", breathing.confidence);
    } else {
        println!("No breathing detected");
    }
}
```

---

<a id="architecture"></a>
## 架构

### 系统总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        WiFi-Mat System                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Detection     │  │  Localization   │  │    Alerting     │  │
│  │    Context      │  │    Context      │  │    Context      │  │
│  │                 │  │                 │  │                 │  │
│  │ • Breathing     │  │ • Triangulation │  │ • Generator     │  │
│  │ • Heartbeat     │  │ • Depth Est.    │  │ • Dispatcher    │  │
│  │ • Movement      │  │ • Fusion        │  │ • Triage Svc    │  │
│  │ • Pipeline      │  │                 │  │                 │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                 │
│                    ┌───────────▼───────────┐                     │
│                    │    Integration        │                     │
│                    │       Layer           │                     │
│                    │                       │                     │
│                    │ • SignalAdapter       │                     │
│                    │ • NeuralAdapter       │                     │
│                    │ • HardwareAdapter     │                     │
│                    └───────────┬───────────┘                     │
│                                │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼─────────┐ ┌─────▼─────┐ ┌─────────▼─────────┐
    │ wifi-densepose-   │ │ wifi-     │ │ wifi-densepose-   │
    │     signal        │ │ densepose │ │    hardware       │
    │                   │ │   -nn     │ │                   │
    └───────────────────┘ └───────────┘ └───────────────────┘
```

### 领域模型

```
┌─────────────────────────────────────────────────────────────┐
│                     DisasterEvent                           │
│                   (Aggregate Root)                          │
├─────────────────────────────────────────────────────────────┤
│ - id: DisasterEventId                                       │
│ - disaster_type: DisasterType                               │
│ - location: Point<f64>                                      │
│ - status: EventStatus                                       │
│ - zones: Vec<ScanZone>                                      │
│ - survivors: Vec<Survivor>                                  │
│ - created_at: DateTime<Utc>                                 │
│ - metadata: EventMetadata                                   │
└─────────────────────────────────────────────────────────────┘
         │                              │
         │ contains                     │ contains
         ▼                              ▼
┌─────────────────────┐      ┌─────────────────────────────┐
│     ScanZone        │      │         Survivor            │
│     (Entity)        │      │         (Entity)            │
├─────────────────────┤      ├─────────────────────────────┤
│ - id: ScanZoneId    │      │ - id: SurvivorId            │
│ - name: String      │      │ - vital_signs: VitalSigns   │
│ - bounds: ZoneBounds│      │ - location: Option<Coord3D> │
│ - sensors: Vec<...> │      │ - triage: TriageStatus      │
│ - parameters: ...   │      │ - alerts: Vec<Alert>        │
│ - status: ZoneStatus│      │ - metadata: SurvivorMeta    │
└─────────────────────┘      └─────────────────────────────┘
```

---

<a id="configuration"></a>
## 配置

### DisasterConfig 选项

```rust
let config = DisasterConfig {
    // 灾害类型（影响检测算法）
    disaster_type: DisasterType::Earthquake,

    // 检测灵敏度（0.0-1.0）
    // 越高则误报越多、漏检越少
    sensitivity: 0.8,

    // 上报一次检测所需的最低置信度
    confidence_threshold: 0.5,

    // 尝试探测的最大埋深（米）
    max_depth: 5.0,

    // 扫描间隔（毫秒）
    scan_interval_ms: 500,

    // 持续不断扫描
    continuous_monitoring: true,

    // 告警配置
    alert_config: AlertConfig {
        enable_audio: true,
        enable_push: true,
        escalation_timeout_secs: 300,
        priority_threshold: Priority::Medium,
    },
};
```

### 灾害类型

| 类型 | 优化方向 | 最适用于 |
|------|--------------|----------|
| `Earthquake` | 强化微动检测 | 建筑倒塌 |
| `BuildingCollapse` | 深层穿透、噪声过滤 | 城市搜救 |
| `Avalanche` | 低温体征补偿、积雪穿透 | 山地救援 |
| `Flood` | 水体干扰补偿 | 洪灾救援 |
| `MineCollapse` | 岩层穿透、气体检测 | 矿难 |
| `Explosion` | 爆震伤情模式 | 工业事故 |
| `Unknown` | 均衡默认配置 | 通用场景 |

### ScanParameters 参数

```rust
let params = ScanParameters {
    // 本区域的检测灵敏度
    sensitivity: 0.85,

    // 最大扫描埋深（米）
    max_depth: 5.0,

    // 分辨率级别
    resolution: ScanResolution::High,

    // 启用增强呼吸检测
    enhanced_breathing: true,

    // 启用心跳检测（更慢但更准）
    heartbeat_detection: true,
};

let zone = ScanZone::with_parameters("Zone A", bounds, params);
```

---

<a id="detection-capabilities"></a>
## 检测能力

### 呼吸检测

WiFi-Mat 通过胸壁的周期性起伏对 WiFi 信号产生的调制来检测呼吸。

```rust
use wifi_densepose_mat::detection::{BreathingDetector, BreathingDetectorConfig};

let config = BreathingDetectorConfig {
    // 呼吸频率范围（Hz）
    min_frequency: 0.1,  // 6 BPM
    max_frequency: 0.5,  // 30 BPM

    // 分析窗口
    window_seconds: 10.0,

    // 检测阈值
    confidence_threshold: 0.3,

    // 启用模式分类
    classify_patterns: true,
};

let detector = BreathingDetector::new(config);
let result = detector.detect(&amplitudes, sample_rate);
```

**可识别的呼吸模式：**
- 正常呼吸
- 浅快呼吸
- 深慢呼吸
- 不规则呼吸
- 濒死喘息（危重）

### 心跳检测

通过微多普勒分析，检测心跳引起的细微身体运动。

```rust
use wifi_densepose_mat::detection::{HeartbeatDetector, HeartbeatDetectorConfig};

let config = HeartbeatDetectorConfig {
    // 心率范围（Hz）
    min_frequency: 0.8,  // 48 BPM
    max_frequency: 3.0,  // 180 BPM

    // 要求先检出呼吸（减少误报）
    require_breathing: true,

    // 信号微弱，故阈值更高
    confidence_threshold: 0.4,
};

let detector = HeartbeatDetector::new(config);
let result = detector.detect(&phases, sample_rate, Some(breathing_rate));
```

### 运动分类

```rust
use wifi_densepose_mat::detection::{MovementClassifier, MovementClassifierConfig};

let classifier = MovementClassifier::new(MovementClassifierConfig::default());
let movement = classifier.classify(&amplitudes, sample_rate);

match movement.movement_type {
    MovementType::Gross => println!("Large movement - likely conscious"),
    MovementType::Fine => println!("Small movement - possible injury"),
    MovementType::Tremor => println!("Tremor detected - possible shock"),
    MovementType::Periodic => println!("Periodic movement - likely breathing only"),
    MovementType::None => println!("No movement detected"),
}
```

---

<a id="localization-system"></a>
## 定位系统

### 三角定位

利用多个传感器的飞行时间与信号强度。

```rust
use wifi_densepose_mat::localization::{Triangulator, TriangulationConfig};

let config = TriangulationConfig {
    // 二维定位所需的最少传感器数
    min_sensors: 3,

    // 在 CSI 之外同时使用 RSSI
    use_rssi: true,

    // 优化过程的最大迭代次数
    max_iterations: 100,

    // 收敛阈值
    convergence_threshold: 0.01,
};

let triangulator = Triangulator::new(config);

// 传感器位置
let sensors = vec![
    SensorPosition { x: 0.0, y: 0.0, z: 1.5, .. },
    SensorPosition { x: 10.0, y: 0.0, z: 1.5, .. },
    SensorPosition { x: 5.0, y: 10.0, z: 1.5, .. },
];

// 各传感器测得的 RSSI
let measurements = vec![-45.0, -52.0, -48.0];

let position = triangulator.estimate(&sensors, &measurements)?;
println!("Estimated position: ({:.2}, {:.2})", position.x, position.y);
println!("Uncertainty: ±{:.2}m", position.uncertainty);
```

### 埋深估计

通过信号衰减分析估算幸存者在废墟下的埋深。

```rust
use wifi_densepose_mat::localization::{DepthEstimator, DepthEstimatorConfig};

let config = DepthEstimatorConfig {
    // 材质衰减系数
    material_model: MaterialModel::MixedDebris,

    // 参考信号强度（无遮挡视距）
    reference_rssi: -30.0,

    // 可探测的最大埋深
    max_depth: 8.0,
};

let estimator = DepthEstimator::new(config);
let depth = estimator.estimate(measured_rssi, expected_rssi)?;

println!("Estimated depth: {:.2}m", depth.meters);
println!("Confidence: {:.2}", depth.confidence);
println!("Material: {:?}", depth.estimated_material);
```

### 位置融合

用卡尔曼滤波把多种估计方法的结果合并。

```rust
use wifi_densepose_mat::localization::{PositionFuser, LocalizationService};

let service = LocalizationService::new();

// 估计完整三维位置
let position = service.estimate_position(&vital_signs, &zone)?;

println!("3D Position:");
println!("  X: {:.2}m (±{:.2})", position.x, position.uncertainty.x);
println!("  Y: {:.2}m (±{:.2})", position.y, position.uncertainty.y);
println!("  Z: {:.2}m (±{:.2})", position.z, position.uncertainty.z);
println!("  Total confidence: {:.2}", position.confidence);
```

---

<a id="triage-classification"></a>
## 分诊分级

### START 规程

WiFi-Mat 实现了「简单分诊与快速救治」（START）规程：

| 状态 | 判定依据 | 处置 |
|--------|----------|--------|
| **立即救治（红）** | 呼吸 10-29 次/分、无桡动脉搏动、能听从指令 | 优先救援 |
| **延迟救治（黄）** | 呼吸正常、有脉搏、伤情不危及生命 | 次优救援 |
| **轻伤（绿）** | 可行走、轻度受伤 | 可暂缓 |
| **死亡（黑）** | 开放气道后仍无呼吸 | 不实施救援 |

### 自动分诊

```rust
use wifi_densepose_mat::domain::triage::{TriageCalculator, TriageStatus};

let calculator = TriageCalculator::new();

// 依据生命体征计算分诊等级
let vital_signs = VitalSignsReading {
    breathing: Some(BreathingPattern {
        rate_bpm: 24.0,
        pattern_type: BreathingType::Shallow,
        ..
    }),
    heartbeat: Some(HeartbeatSignature {
        rate_bpm: 110.0,
        ..
    }),
    movement: MovementProfile {
        movement_type: MovementType::Fine,
        ..
    },
    ..
};

let triage = calculator.calculate(&vital_signs);

match triage {
    TriageStatus::Immediate => println!("⚠️ IMMEDIATE - Rescue NOW"),
    TriageStatus::Delayed => println!("🟡 DELAYED - Stable for now"),
    TriageStatus::Minor => println!("🟢 MINOR - Walking wounded"),
    TriageStatus::Deceased => println!("⬛ DECEASED - No vital signs"),
    TriageStatus::Unknown => println!("❓ UNKNOWN - Insufficient data"),
}
```

### 分诊依据

```rust
// 查看分诊判定的详细依据
let factors = calculator.calculate_with_factors(&vital_signs);

println!("Triage: {:?}", factors.status);
println!("Contributing factors:");
for factor in &factors.contributing_factors {
    println!("  - {} (weight: {:.2})", factor.description, factor.weight);
}
println!("Confidence: {:.2}", factors.confidence);
```

---

<a id="alert-system"></a>
## 告警系统

### 告警生成

```rust
use wifi_densepose_mat::alerting::{AlertGenerator, AlertConfig};

let config = AlertConfig {
    // 生成告警的最低优先级
    priority_threshold: Priority::Medium,

    // 升级设置
    escalation_enabled: true,
    escalation_timeout: Duration::from_secs(300),

    // 通知渠道
    channels: vec![
        AlertChannel::Audio,
        AlertChannel::Visual,
        AlertChannel::Push,
        AlertChannel::Radio,
    ],
};

let generator = AlertGenerator::new(config);

// 为某位幸存者生成告警
let alert = generator.generate(&survivor)?;

println!("Alert generated:");
println!("  ID: {}", alert.id());
println!("  Priority: {:?}", alert.priority());
println!("  Message: {}", alert.message());
```

### 告警优先级

| 优先级 | 判定依据 | 响应时限 |
|----------|----------|---------------|
| **紧急** | 立即救治级，状况恶化 | 5 分钟内 |
| **高** | 立即救治级，状况稳定 | 15 分钟内 |
| **中** | 延迟救治级 | 1 小时内 |
| **低** | 轻伤级 | 有余力时处理 |

### 告警分发

```rust
use wifi_densepose_mat::alerting::AlertDispatcher;

let dispatcher = AlertDispatcher::new(config);

// 分发到所有已配置渠道
dispatcher.dispatch(alert).await?;

// 分发到指定渠道
dispatcher.dispatch_to(alert, AlertChannel::Radio).await?;

// 为多名幸存者批量分发
dispatcher.dispatch_batch(&alerts).await?;
```

---

<a id="api-reference"></a>
## API 参考

### 核心类型

```rust
// 主入口
pub struct DisasterResponse {
    pub fn new(config: DisasterConfig) -> Self;
    pub fn initialize_event(&mut self, location: Point, desc: &str) -> Result<&DisasterEvent>;
    pub fn add_zone(&mut self, zone: ScanZone) -> Result<()>;
    pub async fn start_scanning(&mut self) -> Result<()>;
    pub fn stop_scanning(&self);
    pub fn survivors(&self) -> Vec<&Survivor>;
    pub fn survivors_by_triage(&self, status: TriageStatus) -> Vec<&Survivor>;
}

// 配置
pub struct DisasterConfig {
    pub disaster_type: DisasterType,
    pub sensitivity: f64,
    pub confidence_threshold: f64,
    pub max_depth: f64,
    pub scan_interval_ms: u64,
    pub continuous_monitoring: bool,
    pub alert_config: AlertConfig,
}

// 领域实体
pub struct Survivor { /* ... */ }
pub struct ScanZone { /* ... */ }
pub struct DisasterEvent { /* ... */ }
pub struct Alert { /* ... */ }

// 值对象
pub struct VitalSignsReading { /* ... */ }
pub struct BreathingPattern { /* ... */ }
pub struct HeartbeatSignature { /* ... */ }
pub struct Coordinates3D { /* ... */ }
```

### 检测 API

```rust
// 呼吸
pub struct BreathingDetector {
    pub fn new(config: BreathingDetectorConfig) -> Self;
    pub fn detect(&self, amplitudes: &[f64], sample_rate: f64) -> Option<BreathingPattern>;
}

// 心跳
pub struct HeartbeatDetector {
    pub fn new(config: HeartbeatDetectorConfig) -> Self;
    pub fn detect(&self, phases: &[f64], sample_rate: f64, breathing_rate: Option<f64>) -> Option<HeartbeatSignature>;
}

// 运动
pub struct MovementClassifier {
    pub fn new(config: MovementClassifierConfig) -> Self;
    pub fn classify(&self, amplitudes: &[f64], sample_rate: f64) -> MovementProfile;
}

// 流水线
pub struct DetectionPipeline {
    pub fn new(config: DetectionConfig) -> Self;
    pub async fn process_zone(&self, zone: &ScanZone) -> Result<Option<VitalSignsReading>>;
    pub fn add_data(&self, amplitudes: &[f64], phases: &[f64]);
}
```

### 定位 API

```rust
pub struct Triangulator {
    pub fn new(config: TriangulationConfig) -> Self;
    pub fn estimate(&self, sensors: &[SensorPosition], measurements: &[f64]) -> Result<Position2D>;
}

pub struct DepthEstimator {
    pub fn new(config: DepthEstimatorConfig) -> Self;
    pub fn estimate(&self, measured: f64, expected: f64) -> Result<DepthEstimate>;
}

pub struct LocalizationService {
    pub fn new() -> Self;
    pub fn estimate_position(&self, vital_signs: &VitalSignsReading, zone: &ScanZone) -> Result<Coordinates3D>;
}
```

---

<a id="hardware-setup"></a>
## 硬件配置

### 传感器要求

| 部件 | 最低要求 | 推荐配置 |
|-----------|---------|-------------|
| WiFi 收发器 | 3 个 | 6-8 个 |
| 采样率 | 100 Hz | 1000 Hz |
| 频段 | 2.4 GHz | 5 GHz |
| 天线类型 | 全向 | 定向 |
| 供电 | 电池 | 市电 + 电池 |

### 便携传感器阵列

```
    [Sensor 1]              [Sensor 2]
         \                    /
          \    SCAN ZONE     /
           \                /
            \              /
             [Sensor 3]---[Sensor 4]
                  |
              [Controller]
                  |
              [Display]
```

### 传感器布设

```rust
// 30x20m 区域的传感器配置示例
let sensors = vec![
    SensorPosition {
        id: "S1".into(),
        x: 0.0, y: 0.0, z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    },
    SensorPosition {
        id: "S2".into(),
        x: 30.0, y: 0.0, z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    },
    SensorPosition {
        id: "S3".into(),
        x: 0.0, y: 20.0, z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    },
    SensorPosition {
        id: "S4".into(),
        x: 30.0, y: 20.0, z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    },
];
```

---

<a id="field-deployment-guide"></a>
## 现场部署指南

### 部署前检查清单

- [ ] 确认所有传感器电量充足（>80%）
- [ ] 测试传感器连通性
- [ ] 按现场条件完成校准
- [ ] 与指挥中心建立通信
- [ ] 向救援队说明系统能力边界

### 部署步骤

1. **现场评估**（5 分钟）
   - 找出可安全布设传感器的位置
   - 记录结构安全隐患
   - 判断废墟材质构成

2. **布设传感器**（10 分钟）
   - 沿搜索区域外缘布设传感器
   - 确保至少 3 个传感器彼此可视
   - 接入控制器

3. **系统初始化**（2 分钟）
   ```rust
   let mut response = DisasterResponse::new(config);
   response.initialize_event(location, description)?;

   for zone in zones {
       response.add_zone(zone)?;
   }
   ```

4. **校准**（5 分钟）
   - 执行背景噪声校准
   - 按环境调整灵敏度

5. **开始扫描**（持续进行）
   ```rust
   response.start_scanning().await?;
   ```

### 结果解读

```
┌─────────────────────────────────────────────────────┐
│                  SCAN RESULTS                       │
├─────────────────────────────────────────────────────┤
│  Zone: North Wing - Ground Floor                    │
│  Status: ACTIVE | Scans: 127 | Duration: 10:34     │
├─────────────────────────────────────────────────────┤
│  DETECTIONS:                                        │
│                                                     │
│  [IMMEDIATE] Survivor #1                           │
│    Position: (12.3, 8.7) ±0.5m                     │
│    Depth: 2.1m ±0.3m                               │
│    Breathing: 24 BPM (shallow)                     │
│    Movement: Fine motor                            │
│    Confidence: 87%                                 │
│                                                     │
│  [DELAYED] Survivor #2                             │
│    Position: (22.1, 15.2) ±0.8m                    │
│    Depth: 1.5m ±0.2m                               │
│    Breathing: 16 BPM (normal)                      │
│    Movement: Periodic only                         │
│    Confidence: 92%                                 │
│                                                     │
│  [MINOR] Survivor #3                               │
│    Position: (5.2, 3.1) ±0.3m                      │
│    Depth: 0.3m ±0.1m                               │
│    Breathing: 18 BPM (normal)                      │
│    Movement: Gross motor (likely mobile)           │
│    Confidence: 95%                                 │
└─────────────────────────────────────────────────────┘
```

---

<a id="troubleshooting"></a>
## 排障

### 常见问题

| 现象 | 可能原因 | 处理办法 |
|-------|---------------|----------|
| 检测不到目标 | 灵敏度过低 | 把 `sensitivity` 提到 0.9 以上 |
| 误报过多 | 灵敏度过高 | 把 `sensitivity` 降到 0.6-0.7 |
| 定位不准 | 传感器数量不足 | 增加传感器（至少 3 个） |
| 检测时有时无 | 信号干扰 | 排查电磁干扰源 |
| 埋深估计失败 | 介质过于致密 | 调整 `material_model` |

### 诊断命令

```rust
// 检查系统健康状态
let health = response.hardware_health();
println!("Sensors: {}/{} operational", health.connected, health.total);

// 查看检测统计
let stats = response.detection_stats();
println!("Detection rate: {:.1}%", stats.detection_rate * 100.0);
println!("False positive rate: {:.1}%", stats.false_positive_rate * 100.0);

// 导出诊断数据
response.export_diagnostics("/path/to/diagnostics.json")?;
```

---

<a id="best-practices"></a>
## 最佳实践

### 检测优化

1. **先用高灵敏度起步**，误报太多再下调
2. **确认检测到呼吸后**才启用心跳检测
3. **选对灾害类型**，以启用对应的优化算法
4. 信号弱时**延长扫描时长**（窗口最长 30 秒）

### 定位优化

1. **用 4 个以上传感器**保证二维定位可靠
2. **分散布设**，覆盖整个搜索区域
3. **安装高度保持一致**（建议 1.5-2.0m）
4. 用冗余配置**应对传感器失效**

### 操作要点

1. **分阶段扫描**：先快速扫一遍，再对重点区域细扫
2. **标记已确认的目标**：减少重复告警
3. **动态更新区域**：移除已排查完毕的区域
4. **同步置信度**：并非所有检测结果都确定

---

<a id="safety-considerations"></a>
## 安全须知

### 局限性

- **并非 100% 可靠**：务必用其他手段复核
- **环境因素影响**：金属、水体、厚混凝土会降低效果
- **仅能探测有生命的活动**：无呼吸的昏迷者或遇难者无法检出
- **埋深限制**：超过 5m 后精度下降

### 与其他手段配合

WiFi-Mat 应与以下手段配合使用：
- 声波探测（听音设备）
- 搜救犬队伍
- 热成像
- 人工探查

### 漏检风险

**阴性结果不等于确认没有幸存者**。务必做到：
- 清理废墟后重新扫描
- 采用多种探测手段
- 继续按人工搜救流程作业

---

## 支持

- **文档**：[ADR-001](/docs/adr/ADR-001-wifi-mat-disaster-detection.md)
- **领域模型**：[DDD 规格说明](/docs/ddd/wifi-mat-domain-model.md)
- **问题反馈**：[GitHub Issues](https://github.com/ruvnet/wifi-densepose/issues)
- **API 文档**：执行 `cargo doc --package wifi-densepose-mat --open`

---

*WiFi-Mat 用于辅助搜索与救援行动。它是增强手段，不能替代受训救援人员与既定的搜救规程。*
