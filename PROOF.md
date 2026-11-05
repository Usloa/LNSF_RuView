# 验证文档 —— 逐条复现每个说法，或找出还做不到的一条

本项目（RuView / wifi-densepose）曾被公开质疑是「AI 糊弄出来的」、是「假的」。这份文档就是回应：**持怀疑态度的人可以克隆仓库、跑一条命令，让每一条主打说法要么在自己的机器上被验证，要么被明确标成「CLAIMED，尚未复现（这里写清还缺什么）」**。下面没有任何一条说法是缺少可运行命令的。

```bash
git clone https://github.com/ruvnet/RuView && cd RuView
bash scripts/prove.sh          # 核心门槛 + 反糊弄断言测试
bash scripts/prove.sh --full   # 另外尝试需要开关的那部分
```

只有所有**无门槛**的说法都通过，`prove.sh` 才会以 0 退出。有门槛的说法不会让整轮失败；它会打印缺少的前提（GPU、数据集、真实硬件、训练好的检查点），方便你自己去复现。

## 分级

- **MEASURED** —— 在我们的硬件上复现过，记录了确切命令，并且有一个在*修复前代码上会失败*的测试把它钉住。`prove.sh` 会重跑这些。
- **CLAIMED** —— 引用自某个来源，或由该来源测得，但没有在本仓库的自动化流程里复现。
- **DATA-GATED / HARDWARE-GATED** —— *代码路径*真实存在且经过测试，但*精度/吞吐量说法*需要我们没有随仓库提供的数据或硬件。我们绝不编造数字；代码里改用带类型的错误，或 `weights_trained` / 来源标记来表达。

## 硬门槛（任何装了 Rust + Python 的机器都能跑）

| 说法 | 等级 | 复现方式 |
|---|---|---|
| Rust 工作区：3,128 个测试，0 失败 | **MEASURED** | `cd v2 && cargo test --workspace --no-default-features` |
| 确定性 CSI 流水线证明（逐位一致的 SHA-256） | **MEASURED** | `python archive/v1/data/proof/verify.py` → `VERDICT: PASS` |

## 反糊弄断言测试（每条在修复前代码上都会失败）

| 说法 | 等级 | 测试（用 `cargo test -p <crate> <name>` 运行） |
|---|---|---|
| 融合模块特制输入导致的 DoS 崩溃已封堵（ADR-156 §2.2） | **MEASURED** | `wifi-densepose-ruvector :: triangulation_out_of_range_index_returns_none_no_panic` |
| **「Soul Signature」身份识别说法被如实限定：** 仅靠 WiFi 的心搏 + 呼吸信道，两个人**无法区分**（差距约 0.0005） | **MEASURED** | `wifi-densepose-bfld :: cardiac_alone_cannot_separate_identity_matches_audit` |
| OccWorld 的 `predict()` 是真实的（随输入变化），不是随机噪声 | **MEASURED** | `wifi-densepose-occworld-candle :: predict_is_deterministic_for_same_input` |
| 姿态运行时在自身默认配置下确实会输出帧（ADR-159 A1） | **MEASURED** | `cog-pose-estimation :: default_config_emits_frames_with_real_model` |
| 人数统计会标出未训练的类别 —— 不虚增人数（ADR-159 A2） | **MEASURED** | `cog-person-count :: untrained_class_argmax_is_flagged_low_confidence` |
| 医疗类边缘技能带有「非医疗器械」免责声明（ADR-160 A1） | **MEASURED** | `wifi-densepose-wasm-edge :: a1_med_modules_have_clinical_disclaimer`（`--features std`） |
| 幸存者去重 3→1，人数虚增已消除（ADR-158 §2） | **MEASURED** | `wifi-densepose-mat :: test_identical_vitals_no_location_dedup_to_one`（`--features mat`） |

## 已测性能（criterion；可在自己机器上复现）

| 说法 | 等级 | 复现方式 |
|---|---|---|
| PSD FFT 规划器缓存 2.0–3.1×，DTW 带宽 2.4–4.1×（ADR-154） | **MEASURED** | `cd v2 && cargo bench -p wifi-densepose-signal` |
| 去掉 `fuse()` 的双重克隆，数据整理约快 2.17×（ADR-156） | **MEASURED** | `cd v2 && cargo bench -p wifi-densepose-ruvector --bench fusion_bench` |
| 零拷贝 ORT 输入约快 1.48×（ADR-155） | **MEASURED** | `cd v2 && cargo bench -p wifi-densepose-nn --features onnx --bench onnx_bench` |
| 点云 splats 从 9 遍降到 2 遍，约快 1.24×（ADR-160 研究） | **MEASURED** | `cd v2 && cargo bench -p wifi-densepose-pointcloud --bench splats_bench` |
| 原生 wlanapi 多 BSSID 扫描 9.74 Hz（对比 netsh 约 2 Hz） | **MEASURED（Windows）** | `cd v2 && cargo test -p wifi-densepose-wifiscan -- --ignored measure_native_scan_rate` |
| wasm-edge `process_frame` 热路径延迟（宿主机代理值，ADR-163） | **MEASURED-on-host**（不是 ESP32/WASM3 的预算值 —— 需要硬件） | `cd v2/crates/wifi-densepose-wasm-edge && cargo bench --features std` |
| cog 稳态 CPU 推理延迟约 305 µs（ADR-163；不是清单里的冷启动值） | **MEASURED-on-host** | `cd v2 && cargo bench -p cog-person-count -p cog-pose-estimation --no-default-features --bench infer_bench` |

## 我们**不**声称做到了什么（如实列出负面结论 —— 最强的反糊弄信号）

| 能力 | 状态 |
|---|---|
| **凭 WiFi 识别具名人员身份** | **没做到，而且测出了原因。** §3.6 的匹配器是真实的，但仅靠 WiFi 信道，身份无法锁定（差距 0.0005）。DATA-GATED：需要真实注册数据接入 AETHER / 体共振信道 —— 从未做过。不做任何具名身份识别的声明。 |
| WiFlow-STD 约 96% PCK@20 | **CLAIMED-reproduced**：在我们的 RTX 5080 上复现（`benchmarks/wiflow-std/RESULTS.md`）；对你而言是 HARDWARE-GATED（需要 NVIDIA GPU + MM-Fi 数据集）。上游**随包发布的检查点**已被**证伪**（0.08% PCK）—— 我们把这一点也公开了。 |
| OccWorld 轨迹精度 | DATA-GATED：需要训练好的检查点；在加载之前 `predict()` 一直带着 `weights_trained=false` —— 绝不悄悄造假。 |
| 边缘技能检测精度（癫痫、武器、情绪等） | UNVALIDATED —— 现在每个这类模块都加了实验/研究性质的免责开关；DSP 是真的，精度不作声明。 |
| 802.11bf-2025 空口一致性 | 截至 2026 年，没有商用芯片提供符合规范的接口；我们的是经过仿真测试的前向兼容协议模型，不是认证过的实现。 |

## 出处

上面每条说法都能追到已提交的 ADR（`docs/adr/ADR-154`…`ADR-163`）、某个测试、criterion 基准、`benchmarks/wiflow-std/RESULTS.md` 或 `benchmarks/edge-latency/RESULTS.md`。提交历史里还包含公开的**撤回记录**（92.9% PCK 的撤回、WiFlow-STD 随包检查点被证伪、NV 色心物料清单的现实核查）—— 造假的人会藏起失败，我们把它们提交进来。
