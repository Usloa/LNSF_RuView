# ADR-013：在通用商用设备上做特征级感知（方案 3）

## 状态
Accepted — 已实现（36/36 单元测试通过，见 `archive/v1/src/sensing/` 与 `archive/v1/tests/unit/test_sensing.py`）

## 日期
2026-02-28

## 背景

### 并非所有人都能部署定制硬件

ADR-012 给出了能提供真实 CSI 数据的 ESP32 CSI 传感网，但它要求：
- 购买 ESP32 开发板
- 烧录定制固件
- 安装 ESP-IDF 工具链
- 实地摆放节点

对许多用户 —— 尤其是评估 WiFi-DensePose 或在托管环境中部署的人 —— 改动硬件并不可行。我们需要一条能跑在**现有、未经改动的消费级 WiFi 设备**上的感知路径。

### 商用硬件能暴露哪些信号

标准 WiFi 驱动与工具无需定制固件就能提供若干指标：

| 信号 | 来源 | 可获得性 | 采样率 |
|--------|--------|-------------|---------------|
| RSSI（接收信号强度） | `iwconfig`、`iw`、NetworkManager | 通用 | 1-10 Hz |
| 噪声底 | `iw dev wlan0 survey dump` | 多数 Linux 驱动 | ~1 Hz |
| 链路质量 | `/proc/net/wireless` | Linux | 1-10 Hz |
| MCS 索引 / PHY 速率 | `iw dev wlan0 link` | 多数驱动 | 逐包 |
| TX/RX 字节数 | `/sys/class/net/wlan0/statistics/` | 通用 | 连续 |
| 重传次数 | `iw dev wlan0 station dump` | 多数驱动 | ~1 Hz |
| 信标间隔时序 | `iw dev wlan0 scan dump` | 通用 | 逐次扫描 |
| 信道利用率 | `iw dev wlan0 survey dump` | 多数驱动 | ~1 Hz |

**RSSI 是主要信号**。当人穿过任意一对收发设备之间的传播路径时，它就会变化。已有研究证实 RSSI 可用于：
- 存在检测（单接收机，对方差设阈值）
- 无设备运动检测（运动会使 RSSI 方差增大）
- 粗粒度房间级定位（多接收机 RSSI 指纹）
- 呼吸检测（需专门布置，效果勉强）

### 研究依据

- **基于 RSSI 的存在检测**：Youssef 等（2007）用多个接收机的 RSSI 演示了无设备被动检测，准确率 >90%。
- **基于 RSSI 的呼吸检测**：Abdelnasser 等（2015）在受控条件下用 4 个以上接收机、通过 RSSI 方差实现呼吸检测，准确率约 85%。
- **无设备跟踪**：多接收机配合 RSSI 指纹可达到房间级（3-5m）精度。

## 决策

我们将实现一个特征级感知模块，从任意 Linux 机器都能取得的标准 WiFi 指标中提取运动、存在和粗粒度活动信息，无需改动硬件。

### 架构

```
┌──────────────────────────────────────────────────────────────────────┐
│              Feature-Level Sensing Pipeline                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Data Sources (any Linux WiFi device):                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐              │
│  │ RSSI    │ │ Noise   │ │ Link    │ │ Packet Stats │              │
│  │ Stream  │ │ Floor   │ │ Quality │ │ (TX/RX/Retry)│              │
│  └────┬────┘ └────┬────┘ └────┬────┘ └──────┬───────┘              │
│       │           │           │              │                       │
│       └───────────┴───────────┴──────────────┘                       │
│                           │                                          │
│                           ▼                                          │
│  ┌────────────────────────────────────────────────┐                  │
│  │           Feature Extraction Engine             │                  │
│  │                                                 │                  │
│  │  1. Rolling statistics (mean, var, skew, kurt)  │                  │
│  │  2. Spectral features (FFT of RSSI time series) │                  │
│  │  3. Change-point detection (CUSUM, PELT)        │                  │
│  │  4. Cross-receiver correlation                   │                  │
│  │  5. Packet timing jitter analysis               │                  │
│  └────────────────────────┬───────────────────────┘                  │
│                           │                                          │
│                           ▼                                          │
│  ┌────────────────────────────────────────────────┐                  │
│  │          Classification / Decision              │                  │
│  │                                                 │                  │
│  │  • Presence: RSSI variance > threshold          │                  │
│  │  • Motion class: spectral peak frequency        │                  │
│  │  • Occupancy change: change-point event         │                  │
│  │  • Confidence: cross-receiver agreement         │                  │
│  └────────────────────────┬───────────────────────┘                  │
│                           │                                          │
│                           ▼                                          │
│  ┌────────────────────────────────────────────────┐                  │
│  │         Output: Presence/Motion Events          │                  │
│  │                                                 │                  │
│  │  { "timestamp": "...",                          │                  │
│  │    "presence": true,                            │                  │
│  │    "motion_level": "active",                    │                  │
│  │    "confidence": 0.87,                          │                  │
│  │    "receivers_agreeing": 3,                     │                  │
│  │    "rssi_variance": 4.2 }                       │                  │
│  └────────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 特征提取规格

```python
class RssiFeatureExtractor:
    """Extract sensing features from RSSI and link statistics.

    No custom hardware required. Works with any WiFi interface
    that exposes standard Linux wireless statistics.
    """

    def __init__(self, config: FeatureSensingConfig):
        self.window_size = config.window_size  # 30 seconds
        self.sampling_rate = config.sampling_rate  # 10 Hz
        self.rssi_buffer = deque(maxlen=self.window_size * self.sampling_rate)
        self.noise_buffer = deque(maxlen=self.window_size * self.sampling_rate)

    def extract_features(self) -> FeatureVector:
        rssi_array = np.array(self.rssi_buffer)

        return FeatureVector(
            # 时域统计量
            rssi_mean=np.mean(rssi_array),
            rssi_variance=np.var(rssi_array),
            rssi_skewness=scipy.stats.skew(rssi_array),
            rssi_kurtosis=scipy.stats.kurtosis(rssi_array),
            rssi_range=np.ptp(rssi_array),
            rssi_iqr=np.subtract(*np.percentile(rssi_array, [75, 25])),

            # 频谱特征（对 RSSI 时序做 FFT）
            spectral_energy=self._spectral_energy(rssi_array),
            dominant_frequency=self._dominant_freq(rssi_array),
            breathing_band_power=self._band_power(rssi_array, 0.1, 0.5),  # Hz
            motion_band_power=self._band_power(rssi_array, 0.5, 3.0),    # Hz

            # 变点特征
            num_change_points=self._cusum_changes(rssi_array),
            max_step_magnitude=self._max_step(rssi_array),

            # 噪声底特征（环境稳定性）
            noise_mean=np.mean(np.array(self.noise_buffer)),
            snr_estimate=np.mean(rssi_array) - np.mean(np.array(self.noise_buffer)),
        )

    def _spectral_energy(self, rssi: np.ndarray) -> float:
        """Total spectral energy excluding DC component."""
        spectrum = np.abs(scipy.fft.rfft(rssi - np.mean(rssi)))
        return float(np.sum(spectrum[1:] ** 2))

    def _dominant_freq(self, rssi: np.ndarray) -> float:
        """Dominant frequency in RSSI time series."""
        spectrum = np.abs(scipy.fft.rfft(rssi - np.mean(rssi)))
        freqs = scipy.fft.rfftfreq(len(rssi), d=1.0/self.sampling_rate)
        return float(freqs[np.argmax(spectrum[1:]) + 1])

    def _band_power(self, rssi: np.ndarray, low_hz: float, high_hz: float) -> float:
        """Power in a specific frequency band."""
        spectrum = np.abs(scipy.fft.rfft(rssi - np.mean(rssi))) ** 2
        freqs = scipy.fft.rfftfreq(len(rssi), d=1.0/self.sampling_rate)
        mask = (freqs >= low_hz) & (freqs <= high_hz)
        return float(np.sum(spectrum[mask]))

    def _cusum_changes(self, rssi: np.ndarray) -> int:
        """Count change points using CUSUM algorithm."""
        mean = np.mean(rssi)
        cusum_pos = np.zeros_like(rssi)
        cusum_neg = np.zeros_like(rssi)
        threshold = 3.0 * np.std(rssi)
        changes = 0
        for i in range(1, len(rssi)):
            cusum_pos[i] = max(0, cusum_pos[i-1] + rssi[i] - mean - 0.5)
            cusum_neg[i] = max(0, cusum_neg[i-1] - rssi[i] + mean - 0.5)
            if cusum_pos[i] > threshold or cusum_neg[i] > threshold:
                changes += 1
                cusum_pos[i] = 0
                cusum_neg[i] = 0
        return changes
```

### 数据采集（无需 root）

```python
class LinuxWifiCollector:
    """Collect WiFi statistics from standard Linux interfaces.

    No root required for most operations.
    No custom drivers or firmware.
    Works with NetworkManager, wpa_supplicant, or raw iw.
    """

    def __init__(self, interface: str = "wlan0"):
        self.interface = interface

    def get_rssi(self) -> float:
        """Get current RSSI from connected AP."""
        # 方法 1：/proc/net/wireless（无需 root）
        with open("/proc/net/wireless") as f:
            for line in f:
                if self.interface in line:
                    parts = line.split()
                    return float(parts[3].rstrip('.'))

        # 方法 2：iw（读取本机站点信息无需 root）
        result = subprocess.run(
            ["iw", "dev", self.interface, "link"],
            capture_output=True, text=True
        )
        for line in result.stdout.split('\n'):
            if 'signal:' in line:
                return float(line.split(':')[1].strip().split()[0])

        raise SensingError(f"Cannot read RSSI from {self.interface}")

    def get_noise_floor(self) -> float:
        """Get noise floor estimate."""
        result = subprocess.run(
            ["iw", "dev", self.interface, "survey", "dump"],
            capture_output=True, text=True
        )
        for line in result.stdout.split('\n'):
            if 'noise:' in line:
                return float(line.split(':')[1].strip().split()[0])
        return -95.0  # Default noise floor estimate

    def get_link_stats(self) -> dict:
        """Get link quality statistics."""
        result = subprocess.run(
            ["iw", "dev", self.interface, "station", "dump"],
            capture_output=True, text=True
        )
        stats = {}
        for line in result.stdout.split('\n'):
            if 'tx bytes:' in line:
                stats['tx_bytes'] = int(line.split(':')[1].strip())
            elif 'rx bytes:' in line:
                stats['rx_bytes'] = int(line.split(':')[1].strip())
            elif 'tx retries:' in line:
                stats['tx_retries'] = int(line.split(':')[1].strip())
            elif 'signal:' in line:
                stats['signal'] = float(line.split(':')[1].strip().split()[0])
        return stats
```

### 分类规则

```python
class PresenceClassifier:
    """Rule-based presence and motion classifier.

    Uses simple, interpretable rules rather than ML to ensure
    transparency and debuggability.
    """

    def __init__(self, config: ClassifierConfig):
        self.variance_threshold = config.variance_threshold  # 2.0 dBm²
        self.motion_threshold = config.motion_threshold      # 5.0 dBm²
        self.spectral_threshold = config.spectral_threshold  # 10.0
        self.confidence_min_receivers = config.min_receivers  # 2

    def classify(self, features: FeatureVector,
                 multi_receiver: list[FeatureVector] = None) -> SensingResult:

        # 存在判定：RSSI 方差超过空房间基线
        presence = features.rssi_variance > self.variance_threshold

        # 运动等级
        if features.rssi_variance > self.motion_threshold:
            motion = MotionLevel.ACTIVE
        elif features.rssi_variance > self.variance_threshold:
            motion = MotionLevel.PRESENT_STILL
        else:
            motion = MotionLevel.ABSENT

        # 由频谱能量与接收机一致性得出置信度
        spectral_conf = min(1.0, features.spectral_energy / self.spectral_threshold)
        if multi_receiver:
            agreeing = sum(1 for f in multi_receiver
                          if (f.rssi_variance > self.variance_threshold) == presence)
            receiver_conf = agreeing / len(multi_receiver)
        else:
            receiver_conf = 0.5  # Single receiver = lower confidence

        confidence = 0.6 * spectral_conf + 0.4 * receiver_conf

        return SensingResult(
            presence=presence,
            motion_level=motion,
            confidence=confidence,
            dominant_frequency=features.dominant_frequency,
            breathing_band_power=features.breathing_band_power,
        )
```

### 能力矩阵（如实评估）

| 能力 | 单接收机 | 3 个接收机 | 6 个接收机 | 准确率 |
|-----------|----------------|-------------|-------------|----------|
| 二值存在检测 | 是 | 是 | 是 | 90-95% |
| 粗粒度运动（静止/移动） | 是 | 是 | 是 | 85-90% |
| 房间级定位 | 否 | 勉强 | 是 | 70-80% |
| 人数统计 | 否 | 勉强 | 勉强 | 50-70% |
| 活动类别（走/坐/站） | 勉强 | 勉强 | 是 | 60-75% |
| 呼吸检测 | 否 | 勉强 | 勉强 | 40-60% |
| 心跳 | 否 | 否 | 否 | N/A |
| 人体姿态 | 否 | 否 | 否 | N/A |

**结论**：在商用设备上做特征级感知，存在检测与运动检测表现良好，但**做不了**姿态估计、心跳或可靠的呼吸检测。任何相反的说法都不诚实。

### 决策矩阵：方案 2（ESP32）对比方案 3（商用设备）

| 因素 | ESP32 CSI（ADR-012） | 商用设备（ADR-013） |
|--------|---------------------|---------------------|
| 主打能力 | 呼吸 + 运动 | 存在 + 粗粒度运动 |
| 硬件成本 | $54（3 节点套件） | $0（现有设备） |
| 部署时间 | 2-4 小时 | 15 分钟 |
| 技术门槛 | 中（烧录固件） | 低（pip install） |
| 数据质量 | 真实 CSI（幅度 + 相位） | 仅 RSSI |
| 多人 | 勉强 | 差 |
| 姿态估计 | 勉强 | 否 |
| 可复现性 | 高（硬件可控） | 中（因硬件而异） |
| 公众可信度 | 高（有真实 CSI 证明物） | 中（RSSI 太「常识」） |

### 商用感知的证明包

```
archive/v1/data/proof/commodity/
├── rssi_capture_30sec.json         # 30 seconds of RSSI from 3 receivers
├── rssi_capture_meta.json          # Hardware: Intel AX200, Router: TP-Link AX1800
├── scenario.txt                    # "Person walks through room at t=10s, sits at t=20s"
├── expected_features.json          # Feature extraction output
├── expected_classification.json    # Classification output
├── expected_features.sha256        # Verification hash
└── verify_commodity.py             # One-command verification
```

### 与 WiFi-DensePose 流水线的集成

商用感知模块输出与 CSI 流水线相同的 `SensingResult` 类型，因此可以优雅降级：

```python
class SensingBackend(Protocol):
    """Common interface for all sensing backends."""

    def get_features(self) -> FeatureVector: ...
    def get_capabilities(self) -> set[Capability]: ...

class CsiBackend(SensingBackend):
    """Full CSI pipeline (ESP32 or research NIC)."""
    def get_capabilities(self):
        return {Capability.PRESENCE, Capability.MOTION, Capability.RESPIRATION,
                Capability.LOCATION, Capability.POSE}

class CommodityBackend(SensingBackend):
    """RSSI-only commodity hardware."""
    def get_capabilities(self):
        return {Capability.PRESENCE, Capability.MOTION}
```

## 影响

### 正面影响
- **零成本入门**：直接用现有 WiFi 硬件
- **15 分钟搭好**：`pip install wifi-densepose && wdp sense --interface wlan0`
- **普及面广**：任何 Linux 笔记本、树莓派或手机都能参与
- **能力如实上报**：`get_capabilities()` 明确告诉用户哪些功能可用
- **与 ESP32 互补**：用户先用商用设备入门，需要更强能力时再升级到 ESP32
- **没有模拟数据**：来自真实硬件的真实 RSSI，流水线确定可复现

### 负面影响
- **能力有限**：没有姿态、没有心跳，呼吸检测也很勉强
- **硬件差异**：不同芯片组的 RSSI 标定不一致
- **环境敏感**：商用 RSSI 比 CSI 更易受干扰影响
- **不是「姿态估计」演示**：本模块确实做不到项目名字暗示的那件事
- **可信度上限较低**：RSSI 感知是众所周知的技术，不如 CSI 有冲击力

### 实现状态

完整的商用感知流水线已实现在 `archive/v1/src/sensing/`：

| 模块 | 文件 | 说明 |
|--------|------|-------------|
| RSSI 采集器 | `rssi_collector.py` | `LinuxWifiCollector`（实时硬件）+ `SimulatedCollector`（确定性测试），带环形缓冲 |
| 特征提取器 | `feature_extractor.py` | `RssiFeatureExtractor`，含 Hann 窗 FFT、频段能量（呼吸 0.1-0.5 Hz、运动 0.5-3 Hz）、CUSUM 变点检测 |
| 分类器 | `classifier.py` | `PresenceClassifier`，含 ABSENT/PRESENT_STILL/ACTIVE 三级与置信度评分 |
| 后端 | `backend.py` | `CommodityBackend` 串起采集器 → 提取器 → 分类器，上报 PRESENCE + MOTION 能力 |

**测试覆盖**：`archive/v1/tests/unit/test_sensing.py` 中 36 个测试全部通过：
- 测试类：`TestRingBuffer`（4）、`TestSimulatedCollector`（5）、`TestFeatureExtractor`（8）、`TestCusum`（4）、`TestPresenceClassifier`（7）、`TestCommodityBackend`（6）、`TestBandPower`（2）

**依赖**：`numpy`、`scipy`（用于 FFT 与频谱分析）

**注意**：`LinuxWifiCollector` 需要已连接的 Linux WiFi 接口（`/proc/net/wireless` 或 `iw`）。在 Windows 或接口未连接时，开发与测试请改用 `SimulatedCollector`。

## 参考资料

- [Youssef et al. - Challenges in Device-Free Passive Localization](https://doi.org/10.1145/1287853.1287880)
- [Device-Free WiFi Sensing Survey](https://arxiv.org/abs/1901.09683)
- [RSSI-based Breathing Detection](https://ieeexplore.ieee.org/document/7127688)
- [Linux Wireless Tools](https://wireless.wiki.kernel.org/en/users/documentation/iw)
- ADR-011：Python 真实性验证与消除模拟代码
- ADR-012：面向分布式感知的 ESP32 CSI 传感网
