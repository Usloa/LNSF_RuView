# ADR-011：Python 真实性验证与消除模拟代码

## 状态
Proposed（紧急）

## 日期
2026-02-28

## 背景

### 可信度问题

WiFi-DensePose 的 Python 代码库里既有数学上站得住脚的真实信号处理（FFT、相位解缠、多普勒提取、相关特征），也有严重损害可信度的模拟/占位代码。外部评审者只要在默认执行流程中遇到**任何**模拟路径，就会认定整个系统是造假的。这不是技术问题，而是根源于技术实现的观感问题。

### 模拟/占位代码清单

以下代码路径**在默认配置下**会产生假数据，或容易被误认为功能造假：

#### 严重（默认路径产生假输出）

| 文件 | 行号 | 问题 | 影响 |
|------|------|-------|--------|
| `archive/v1/src/core/csi_processor.py` | 390 | `doppler_shift = np.random.rand(10)  # Placeholder` | **真实特征提取器返回随机多普勒值** —— 使整条特征流水线的可信度归零 |
| `archive/v1/src/hardware/csi_extractor.py` | 83-84 | CSI 提取回退路径中的 `amplitude = np.random.rand(...)` | 解析失败时被静默替换成随机数据 |
| `archive/v1/src/hardware/csi_extractor.py` | 129-135 | `_parse_atheros()` 返回 `np.random.rand()`，注释写着 "placeholder implementation" | 名字像是解析真实数据，实际返回随机数 |
| `archive/v1/src/hardware/router_interface.py` | 211-212 | 回退路径中的 `np.random.rand(3, 56)` | 静默的随机回退 |
| `archive/v1/src/services/pose_service.py` | 431 | `mock_csi = np.random.randn(64, 56, 3)  # Mock CSI data` | 生产代码路径里出现模拟 CSI |
| `archive/v1/src/services/pose_service.py` | 293-356 | `_generate_mock_poses()` 里到处是 `random.randint` | 服务层里有一整套模拟姿态生成器 |
| `archive/v1/src/services/pose_service.py` | 489-607 | 占用率、历史数据里有多处 `random.randint` | API 响应里看似真实的假统计 |
| `archive/v1/src/api/dependencies.py` | 82, 408 | "return a mock user for development" | 默认路径绕过认证 |

#### 中等（模拟受开关控制但易混淆）

| 文件 | 行号 | 问题 |
|------|------|-------|
| `archive/v1/src/config/settings.py` | 144-145 | `mock_hardware=False`、`mock_pose_data=False` 的默认值是对的，但模拟基础设施仍然存在 |
| `archive/v1/src/core/router_interface.py` | 27-300 | 生产代码里有 270 多行的模拟数据生成设施 |
| `archive/v1/src/services/pose_service.py` | 84-88 | 静默条件分支：`if not self.settings.mock_pose_data`，且不记录真实模式 |
| `archive/v1/src/services/hardware_service.py` | 72-375 | 模拟路径与真实路径全程交织 |

#### 轻微（占位/TODO）

| 文件 | 行号 | 问题 |
|------|------|-------|
| `archive/v1/src/core/router_interface.py` | 198 | "Collect real CSI data from router (placeholder implementation)" |
| `archive/v1/src/api/routers/health.py` | 170-171 | `uptime_seconds = 0.0  # TODO` |
| `archive/v1/src/services/pose_service.py` | 739 | `"uptime_seconds": 0.0  # TODO` |

### 根因分析

1. **模拟与真实没有隔离**：模拟生成器和真实处理器放在同一批模块里。评审者读 `csi_processor.py`，在第 390 行撞见 `np.random.rand(10)`，就不再相信前面 400 行的真实信号处理。

2. **静默回退**：真实硬件不可用时，系统悄悄回退到随机数据，而不是明确报错。这意味着默认执行 `docker compose up` 会产出看似合理、实则完全虚假的结果。

3. **没有证明物**：仓库里没有随附的 CSI 采集文件，没有预期输出哈希，评审者无法验证流水线能从真实输入产出确定性结果。

4. **构建环境脆弱**：`Dockerfile` 引用了并不独立存在的 `requirements.txt`；`setup.py` 硬编码了 87 个依赖；容器里没有 ONNX Runtime 和 BLAS。`docker build` 能否成功取决于机器环境。

5. **没有 CI 验证**：没有 GitHub Actions 工作流在真实或确定性输入上运行流水线并校验输出。

## 决策

我们将通过五项具体改动消除可信度缺口：

### 1. 消除所有静默模拟回退（HARD FAIL）

**所有当前返回 `np.random.rand()` 的路径，要么替换为真实计算，要么显式抛错。**

```python
# 修改前（csi_processor.py:390）
doppler_shift = np.random.rand(10)  # Placeholder

# 修改后
def _extract_doppler_features(self, csi_data: CSIData) -> tuple:
    """Extract Doppler and frequency domain features from CSI temporal history."""
    if len(self.csi_history) < 2:
        # 时序分析所需的历史不足 —— 返回零值，而不是随机数
        doppler_shift = np.zeros(self.window_size)
        psd = np.abs(scipy.fft.fft(csi_data.amplitude.flatten(), n=128))**2
        return doppler_shift, psd

    # 从 CSI 时序差分中真实提取多普勒
    history_array = np.array([h.amplitude for h in self.get_recent_history(self.window_size)])
    # 计算随时间变化的相位差（与多普勒频移成正比）
    temporal_phase_diff = np.diff(np.angle(history_array + 1j * np.zeros_like(history_array)), axis=0)
    # 跨天线取平均，沿时间维做 FFT 得到多普勒谱
    doppler_spectrum = np.abs(scipy.fft.fft(temporal_phase_diff.mean(axis=1), axis=0))
    doppler_shift = doppler_spectrum.mean(axis=1)

    psd = np.abs(scipy.fft.fft(csi_data.amplitude.flatten(), n=128))**2
    return doppler_shift, psd
```

```python
# 修改前（csi_extractor.py:129-135）
def _parse_atheros(self, raw_data):
    """Parse Atheros CSI format (placeholder implementation)."""
    # 目前先返回模拟数据用于测试
    return CSIData(amplitude=np.random.rand(3, 56), ...)

# 修改后
def _parse_atheros(self, raw_data: bytes) -> CSIData:
    """Parse Atheros CSI Tool format.

    Format: https://dhalperi.github.io/linux-80211n-csitool/
    """
    if len(raw_data) < 25:  # Minimum Atheros CSI header
        raise CSIExtractionError(
            f"Atheros CSI data too short ({len(raw_data)} bytes). "
            "Expected real CSI capture from Atheros-based NIC. "
            "See docs/hardware-setup.md for capture instructions."
        )
    # 解析真实的 Atheros 二进制格式
    # ... 真实解析实现 ...
```

### 2. 用显式开关隔离模拟代码并加横幅

**所有模拟代码移入专属模块，默认执行绝不触碰模拟路径。**

```
archive/v1/src/
├── core/
│   ├── csi_processor.py        # Real processing only
│   └── router_interface.py     # Real hardware interface only
├── testing/                    # NEW: isolated mock module
│   ├── __init__.py
│   ├── mock_csi_generator.py   # Mock CSI generation (moved from router_interface)
│   ├── mock_pose_generator.py  # Mock poses (moved from pose_service)
│   └── fixtures/               # Test fixtures, not production paths
│       ├── sample_csi_capture.bin  # Real captured CSI data (tiny sample)
│       └── expected_output.json    # Expected pipeline output for sample
```

**运行时强制：**
```python
import os
import sys

MOCK_MODE = os.environ.get("WIFI_DENSEPOSE_MOCK", "").lower() == "true"

if MOCK_MODE:
    # 在每一行日志上打印横幅
    _original_log = logging.Logger._log
    def _mock_banner_log(self, level, msg, args, **kwargs):
        _original_log(self, level, f"[MOCK MODE] {msg}", args, **kwargs)
    logging.Logger._log = _mock_banner_log

    print("=" * 72, file=sys.stderr)
    print("  WARNING: RUNNING IN MOCK MODE - ALL DATA IS SYNTHETIC", file=sys.stderr)
    print("  Set WIFI_DENSEPOSE_MOCK=false for real operation", file=sys.stderr)
    print("=" * 72, file=sys.stderr)
```

### 3. 提供可复现的证明包

一小份真实 CSI 采集文件 + 单命令验证流水线：

```
archive/v1/data/proof/
├── README.md                      # How to verify
├── sample_csi_capture.bin         # Real CSI data (1 second, ~50 KB)
├── sample_csi_capture_meta.json   # Capture metadata (hardware, env)
├── expected_features.json         # Expected feature extraction output
├── expected_features.sha256       # SHA-256 hash of expected output
└── verify.py                      # One-command verification script
```

**verify.py**：
```python
#!/usr/bin/env python3
"""Verify WiFi-DensePose pipeline produces deterministic output from real CSI data.

Usage:
    python archive/v1/data/proof/verify.py

Expected output:
    PASS: Pipeline output matches expected hash
    SHA256: <hash>

If this passes, the signal processing pipeline is producing real,
deterministic results from real captured CSI data.
"""
import hashlib
import json
import sys
import os

# 确保可复现
os.environ["PYTHONHASHSEED"] = "42"
import numpy as np
np.random.seed(42)  # Only affects any remaining random elements

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from src.core.csi_processor import CSIProcessor
from src.hardware.csi_extractor import CSIExtractor

def main():
    # 加载真实采集的 CSI 数据
    capture_path = os.path.join(os.path.dirname(__file__), "sample_csi_capture.bin")
    meta_path = os.path.join(os.path.dirname(__file__), "sample_csi_capture_meta.json")
    expected_hash_path = os.path.join(os.path.dirname(__file__), "expected_features.sha256")

    with open(meta_path) as f:
        meta = json.load(f)

    # 从二进制采集文件中提取 CSI
    extractor = CSIExtractor(format=meta["format"])
    csi_data = extractor.extract_from_file(capture_path)

    # 送入特征流水线处理
    config = {
        "sampling_rate": meta["sampling_rate"],
        "window_size": meta["window_size"],
        "overlap": meta["overlap"],
        "noise_threshold": meta["noise_threshold"],
    }
    processor = CSIProcessor(config)
    features = processor.extract_features(csi_data)

    # 确定性地序列化特征
    output = {
        "amplitude_mean": features.amplitude_mean.tolist(),
        "amplitude_variance": features.amplitude_variance.tolist(),
        "phase_difference": features.phase_difference.tolist(),
        "doppler_shift": features.doppler_shift.tolist(),
        "psd_first_16": features.power_spectral_density[:16].tolist(),
    }
    output_json = json.dumps(output, sort_keys=True, separators=(",", ":"))
    output_hash = hashlib.sha256(output_json.encode()).hexdigest()

    # 与预期哈希比对
    with open(expected_hash_path) as f:
        expected_hash = f.read().strip()

    if output_hash == expected_hash:
        print(f"PASS: Pipeline output matches expected hash")
        print(f"SHA256: {output_hash}")
        print(f"Features: {len(output['amplitude_mean'])} subcarriers processed")
        return 0
    else:
        print(f"FAIL: Hash mismatch")
        print(f"Expected: {expected_hash}")
        print(f"Got:      {output_hash}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
```

### 4. 固定构建环境

**方案 A（推荐）：在全新机器上也能工作的确定性 Dockerfile**

```dockerfile
FROM python:3.11-slim

# 真正需要的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas-dev \
    libfftw3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 锁定的依赖清单（不再引用缺失的文件）
COPY archive/v1/requirements-lock.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY archive/v1/ ./v1/

# 真实性证明：构建时校验流水线
RUN cd archive/v1 && python data/proof/verify.py

EXPOSE 8000
# 默认：真实模式（模拟需显式开启）
ENV WIFI_DENSEPOSE_MOCK=false
CMD ["uvicorn", "v1.src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**关键改动**：把 `RUN python data/proof/verify.py` 放在**构建阶段**，意味着只有流水线能从真实 CSI 数据产出正确结果，镜像才能构建出来。

**依赖锁定文件**（`archive/v1/requirements-lock.txt`）：
```
# 核心（必需）
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.10.4
pydantic-settings==2.7.1
numpy==1.26.4
scipy==1.14.1

# 信号处理（必需）
# 基础流水线校验不需要 ONNX

# 可选（完整功能另装）
# torch>=2.1.0
# onnxruntime>=1.17.0
```

### 5. 用 CI 流水线证明真实性

```yaml
# .github/workflows/verify-pipeline.yml
name: Verify Signal Pipeline

on:
  push:
    paths: ['archive/v1/src/**', 'archive/v1/data/proof/**']
  pull_request:
    paths: ['archive/v1/src/**']

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install minimal deps
        run: pip install numpy scipy pydantic pydantic-settings
      - name: Verify pipeline determinism
        run: python archive/v1/data/proof/verify.py
      - name: Verify no random in production paths
        run: |
          # 若生产代码中出现 np.random（不含 testing/）则失败
          ! grep -r "np\.random\.\(rand\|randn\|randint\)" archive/v1/src/ \
            --include="*.py" \
            --exclude-dir=testing \
            || (echo "FAIL: np.random found in production code" && exit 1)
```

### 需要改动的具体文件

| 文件 | 动作 | 说明 |
|------|--------|-------------|
| `archive/v1/src/core/csi_processor.py:390` | **替换** | 从 CSI 时序历史中真实提取多普勒特征 |
| `archive/v1/src/hardware/csi_extractor.py:83-84` | **替换** | 解析失败时抛出带说明的硬错误 |
| `archive/v1/src/hardware/csi_extractor.py:129-135` | **替换** | 真实 Atheros CSI 解析器，或带硬件指引的硬错误 |
| `archive/v1/src/hardware/router_interface.py:198-212` | **替换** | 未实现的硬件抛硬错误，或接入真实 `iwconfig` + CSI 工具 |
| `archive/v1/src/services/pose_service.py:293-356` | **移动** | 把 `_generate_mock_poses()` 移到 `archive/v1/src/testing/mock_pose_generator.py` |
| `archive/v1/src/services/pose_service.py:430-431` | **移除** | 从生产路径中删掉模拟 CSI 生成 |
| `archive/v1/src/services/pose_service.py:489-607` | **替换** | 从数据库取真实统计，或显式返回「无数据」 |
| `archive/v1/src/core/router_interface.py:60-300` | **移动** | 把模拟生成器移到 `archive/v1/src/testing/mock_csi_generator.py` |
| `archive/v1/src/api/dependencies.py:82,408` | **替换** | 真实鉴权，或带日志记录的显式开发模式绕过 |
| `archive/v1/data/proof/` | **新建** | 证明包（样本采集 + 预期哈希 + 验证脚本） |
| `archive/v1/requirements-lock.txt` | **新建** | 锁定后的最小依赖集 |
| `.github/workflows/verify-pipeline.yml` | **新建** | CI 验证 |

### 硬件文档

```
archive/v1/docs/hardware-setup.md (to be created)

# Supported Hardware Matrix

| Chipset | Tool | OS | Capture Command |
|---------|------|----|-----------------|
| Intel 5300 | Linux 802.11n CSI Tool | Ubuntu 18.04 | `sudo ./log_to_file csi.dat` |
| Atheros AR9580 | Atheros CSI Tool | Ubuntu 14.04 | `sudo ./recv_csi csi.dat` |
| Broadcom BCM4339 | Nexmon CSI | Android/Nexus 5 | `nexutil -m1 -k1 ...` |
| ESP32 | ESP32-CSI | ESP-IDF | `csi_recv --format binary` |

# Calibration
1. Place router and receiver 2m apart, line of sight
2. Capture 10 seconds of empty-room baseline
3. Have one person walk through at normal pace
4. Capture 10 seconds during walk-through
5. Run calibration: `python archive/v1/scripts/calibrate.py --baseline empty.dat --activity walk.dat`
```

## 影响

### 正面影响
- **一条命令完成「克隆、构建、验证」**：`docker build . && docker run --rm wifi-densepose python archive/v1/data/proof/verify.py` 产出确定性的 PASS
- **没有静默造假**：生产输出里不会再出现随机数据
- **CI 强制**：在生产路径引入 `np.random` 的 PR 会自动失败
- **可信度锚点**：来自真实 CSI 采集、经 SHA-256 校验的输出是无可辩驳的证据
- **模拟边界清晰**：模拟代码只存在于 `archive/v1/src/testing/`，生产模块绝不导入

### 负面影响
- **需要真实 CSI 采集**：必须有人采集并提交一份真实 CSI 样本（一次性工作）
- **无硬件时构建可能失败**：没有模拟回退，缺少 WiFi 硬件的机器无法演示，只能改用证明包
- **迁移成本**：把模拟代码移到独立模块需要更新测试文件里的导入
- **开发流程更严格**：开发者必须显式开启模拟模式

### 验收标准

一个陌生人可以：
1. `git clone` 仓库
2. 运行一条命令（`docker build .` 或 `python archive/v1/data/proof/verify.py`）
3. 看到 `PASS: Pipeline output matches expected hash`，并附带具体的 SHA-256
4. 通过 CI 徽章确认任何非测试文件中都没有 `np.random`

如果在干净机器上重复 5 次都 100% 通过，「造假」的说法就不攻自破。

### 回答两个关键问题

**Q1：先做 Docker 还是 Nix？**
建议：**先做 Docker**。Dockerfile 已经存在，只需要修好。Nix 质量更高但受众更小，Docker 能覆盖最广的「克隆即验证」人群。

**Q2：外部 crate 是否公开且有版本？**
Python 依赖都是 PyPI 上的公开包。Rust 的 `ruvector-core` 与 `ruvector-data-framework` 目前在 `Cargo.toml` 里被注释掉（第 83-84 行：`# ruvector-core = "0.1"`），尚未发布到 crates.io，属于 ruvnet 内部 crate。这会阻塞 Rust 路线，但不影响本 ADR 的 Python 真实性验证工作。

## 参考资料

- [Linux 802.11n CSI Tool](https://dhalperi.github.io/linux-80211n-csitool/)
- [Atheros CSI Tool](https://wands.sg/research/wifi/AthesCSI/)
- [Nexmon CSI](https://github.com/seemoo-lab/nexmon_csi)
- [ESP32 CSI](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/wifi.html#wi-fi-channel-state-information)
- [Reproducible Builds](https://reproducible-builds.org/)
- ADR-002：RuVector RVF 集成策略
