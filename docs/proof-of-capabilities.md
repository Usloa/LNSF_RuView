# 能力验证 —— 回应「这是假的 / 夸大宣传」的质疑

**一句话版本：别信我们，自己验。** 下面每条说法都附了一条几分钟就能跑完的命令。早期版本里吹过头的地方，我们照直说明，并指出具体改了什么。之所以写这一页，是因为对一个声称「WiFi 能感知人」的项目，怀疑本来就该是默认态度；而面对怀疑，唯一诚实的答案是可复现的证据，不是口头保证。

---

## 1. 外界都说了什么

这个项目（以及更广义的「用 WiFi 做 DensePose」这个思路）火过一阵，也招来了尖锐、而且往往挺在理的批评。最扎心的是这几条：

- **「AI 糊出来的空壳 /  vibe coding 样板代码」** —— 说仓库只有架子，核心信号处理和姿态流水线根本没实现。（[Hacker News](https://news.ycombinator.com/item?id=46388904)、[Cybernews](https://cybernews.com/security/viral-github-project-wifi-see-through-walls/)）
- **「CSI 数据是假的」** —— 说 Python 提取器返回的是随机数组而不是真实硬件数据（例如 `csi_extractor.py` 返回随机幅度/相位）。（[审计 fork](https://github.com/deletexiumu/wifi-densepose)）
- **「没有训练好的模型，指标是编的」** —— 说「94.2% 姿态精度」「96.5% 跌倒灵敏度」「100% 在场/覆盖」这类主打数字背后既没有权重也没有评测。
- **「刷星」**，以及面对批评时**「只会辩解、不肯拿证据」**。
- **「读着像广告文案」** —— 堆满 emoji 的 AI 文档，信息量很低。

这些我们认真对待 —— 但其中大多数，是把**早期但能跑的原型**误认成了不能跑的空壳。最初那个版本是能工作的：它有一条真实、确定性的信号处理流水线（30 秒就能证明，见第 4 节第 1 步），还有一个能从头跑到尾的演示。它**同时**也和所有感知工具一样带了一个**模拟 / 无硬件模式**，好让你没插网卡也能跑；另外确实有几条主打指标吹过头了。那份审计把模拟回退当成了造假，把「缺模型权重」当成了「缺流水线」。下面先如实交代，再给证据。

---

## 2. 哪些批评站得住，哪些不成立

最初的版本是**早期但可用** —— 一个能工作的原型，不是空壳。把在理的批评和归类错误分开看：

| 批评 | 我们如实的立场 |
|-----------|--------------------|
| 「`csi_extractor` 返回随机数组 → 整个东西是假的」 | **归类错误。** 那些数组属于**模拟 / 无硬件模式** —— 就是让你不接网卡也能跑演示的那条路径（每个感知项目都带一个）。真正的 DSP 流水线从一开始就是真实且**确定性**的，`verify.py` 能逐位证明（第 4 节第 1 步）。随机数据不可能复现出固定哈希。 |
| 「核心信号处理 / 姿态没实现」 | **证据本身就能驳倒。** `verify.py` 会把生产流水线（去噪 → 加窗 → FFT 多普勒 → PSD）从头跑到底，并复现一个已公开的 SHA-256。流水线存在、也在跑；早期**缺的是**训练好的模型权重 —— 这和「缺流水线」是两回事。 |
| 「100% 在场精度」没有依据 | **说得对 —— 已正式撤回。** 那个数字是在单一类别录制（只有「有人」样本）上测的。现在所有位置都换成了如实的 **82.3% 留出集时序三元组**准确率。撤回说明就写在 `README.md` / `docs/user-guide.md` 原地。 |
| 部分主打指标（94.2% 姿态、96.5% 跌倒）早期没有公开评测 | **当时说得对。** 那些 aspirational 数字已经删掉；现在的数字都对应**已发布的模型 + 可复现的公开基准评测**（第 4 节第 3 步）。 |
| 文档读着像 AI 广告文案 | **部分说得对。** 现在我们一上来就给能跑的命令，以及一份 openly 列出负面结果的研究，而不是堆形容词 —— 这一页本身也是。 |

如果仓库里有一条说法，背后没有你能跑的命令，就当它是宣传话术，并且告诉我们 —— 我们会修掉或撤回。

---

## 3. 科学本身是真的（这一点从来就不是争议）

用 WiFi CSI 感知人，是十几年同行评审研究的积累，与本仓库无关：

- **CMU《DensePose From WiFi》**（Geng、Huang、De la Torre，2022 年 12 月）—— [arXiv:2301.00250](https://arxiv.org/abs/2301.00250)。
- **MIT CSAIL 的 RF-Pose / RF-Pose3D**（Zhao 等）—— 用无线电穿墙估计骨架姿态。
- **IEEE 802.11bf** —— 把 WiFi 这种用法标准化了的 WLAN 感知修订。
- **MM-Fi**（Yang 等，NeurIPS 2023）—— 我们用来打分的公开多模态 WiFi 感知基准。

真正该问的从来不是「WiFi 感知是不是真的」，而是「**这一份实现**到底做没做到」。下面回答的是后一个问题。

---

## 4. 自己动手验（约 10 分钟，不需要特殊硬件）

### 第 1 步 —— 确定性流水线证明（「信任熔断开关」）

这是对「信号处理是假的」的直接回应。把一段已知的参考信号喂进**生产级** DSP 流水线（去噪 → 汉明窗 → 幅度归一化 → FFT 多普勒 → PSD），再对输出做 SHA-256。如果流水线是随机或打桩的，哈希不可能复现。

```bash
python archive/v1/data/proof/verify.py
# Expect:  VERDICT: PASS
# Pipeline hash: f8e76f21a0f9852b70b6d9dd5318239f6b20cbcb4cdd995863263cecdc446f7a
```

公开的期望哈希提交在 `archive/v1/data/proof/expected_features.sha256`。在你自己的机器上跑一遍 —— 它**跨平台逐位一致**（已在 Windows、两台独立的 Linux 主机和 GitHub Azure CI runner 上验证相同）。唯一**不能**逐位稳定的特征是按峰值归一化的多普勒谱：跨微架构的 FFT 重排会让 argmax 翻转；证明脚本把它排除在哈希之外，同时把其余每个特征与提交的参考向量按严格相对容差逐一比对（`expected_features_reference.npz`），这样真正的回归仍会失败，而 CPU 级的浮点噪声不会。共有 5 个特征（幅度均值/方差、相位差、相关矩阵、基于 FFT 的 PSD）承担这份确定性证明。

**专门说「假数据」这条指控：** 参考信号是**刻意合成**的，而且**自己标得清清楚楚** —— `archive/v1/data/proof/sample_csi_meta.json` 写着：

```json
{ "is_synthetic": true, "is_real_capture": false, "numpy_seed": 42, ... }
```

`generate_reference_signal.py` 的文件头也写明：*"It is NOT a real WiFi capture."*（这不是一次真实 WiFi 采集）。一份带标注、有文档、可复现的测试向量，恰恰和「把假数据冒充真实传感器输出」**相反** —— 它是让 DSP 流水线变得**可被证伪**的手段。把这两件事混为一谈，正是那份「假 CSI」审计最核心的错误。

### 第 2 步 —— 真代码、真测试（回应「核心没实现」）

```bash
cd v2
cargo test --workspace --no-default-features
```

Rust v2 工作区有 **38 个 crate**、**490+ 个文件**里带着测试（数千个测试函数）。这不是空架子 —— 里面有信号处理库（`wifi-densepose-signal`，16 个 RuvSense 模块）、推理栈（`wifi-densepose-nn`）、基于 Axum 的感知服务器、ESP32 硬件/固件 crate 等等。跑一遍测试**就是**证明 —— 别光信这个数字，自己跑。

### 第 3 步 —— 真训练模型，可在公开基准上核验

主打数字**不是**在私有划分上自报的，而是在**公开的 MM-Fi 基准**上测的，权重也已发布，你可以重跑：

```bash
pip install huggingface_hub
huggingface-cli download ruvnet/wifi-densepose-mmfi-pose --local-dir models/mmfi-pose
```

| 指标（MM-Fi，匹配的 `random_split`） | 数值 |
|----------------------------------------|-------|
| 躯干 PCK@20，单模型 | **82.69%** |
| 躯干 PCK@20，3 模型集成 + TTA | **83.59%** |
| 7.5 万参数微型（边缘）版本 | 74.30% |
| 此前公开的 SOTA —— MultiFormer（2025） | 72.25% |
| 此前 —— CSI2Pose | 68.41% |

- 模型卡：[`ruvnet/wifi-densepose-mmfi-pose`](https://huggingface.co/ruvnet/wifi-densepose-mmfi-pose)
- 可自我校正、可审计的排行榜：[AetherArena Space](https://huggingface.co/spaces/ruvnet/aether-arena)
- 预训练编码器（82.3% 留出集时序三元组）：[`ruvnet/wifi-densepose-pretrained`](https://huggingface.co/ruvnet/wifi-densepose-pretrained)

### 第 4 步 —— 来自真实硬件的真实 CSI

一块 9 美元的 ESP32-S3 能产出真正的 802.11 CSI；固件就在本仓库里（`firmware/esp32-csi-node/`）可编译、可烧录。数据通路是 ESP-IDF 的 CSI 回调（或者在树莓派上经 [rvCSI](https://github.com/ruvnet/rvcsi) 运行时读 nexmon_csi 的 `.pcap`）—— 是实测的无线电反射，不是合成数组。编译/烧录/配置步骤见 [`docs/user-guide.md`](user-guide.md) 和 `CLAUDE.local.md`。

---

## 5. 全程公开开发 —— 开发轨迹本身就是凭据

**这个平台的每一步都是公开做出来的** —— 回归、改进、走死的岔路、以及修复，一直到今天这个样子。这条轨迹本身就是反驳「空壳」「一夜刷星、没有提交」最有力的证据，因为**空壳不会把自己的回归亮出来**。你可以从头翻：

- **Git 历史** —— 持续、细粒度的提交（信号 DSP、固件、模型训练、基准跑分），不是丢一个 README 然后就没声了。
- **96 份 ADR**（[`docs/adr/`](adr/README.md)）—— 每个架构决策都记了*理由和取舍*，包括后来被取代、被推翻的那些。
- **CHANGELOG** —— 新增、修复和反转都原地标注日期（比如被撤回的「100% 在场」没有悄悄删掉，撤回这件事本身也写进去了）。
- **公开 issue 列表** —— 真实的部署摩擦、真实的缺陷报告，以及看得见的「发现 → 修好」过程：
  - **#803**（人数一直卡在「1」）—— 定位到服务端两处限制，并用确定性回归测试修好，那些测试**证明**了旧行为是错的。
  - **#872**（`--mqtt` 参数不存在）—— 追到参数定义在死代码里、从没接进可执行文件的解析器；接上之后对着真实 broker 做了端到端验证。

公开做事就是这个样子：你能看着它出错，再看着它改对。这段历史今天任何人用 `git log` 和 issue 列表都能查。

空壳会藏起失败，我们把失败详细写下来：

- **[完整 MM-Fi 研究](benchmarks/mmfi-wifi-sensing-study.md)** —— 直说 WiFi 感知**无法零样本泛化**到新的人/房间（跨环境原始准确率掉到约 17～64%），要靠约 30 秒的室内校准才救得回来。「最尖锐的发现」一节甚至论证编码器*几乎不重要* —— 对想卖模型的人来说，这是个挺难堪的结论。
- **[效率前沿](benchmarks/wifi-pose-efficiency-frontier.md)** —— 20 KB 的 int4 边缘模型做到超越 SOTA 的姿态成绩，量化的取舍也一并列出。
- **撤回记录** —— 「100% 在场」是原地撤回的，不是悄悄编辑掉。
- **[ADR-168 基准证明](adr/ADR-168-benchmark-proof.md)** 和 **[WITNESS-LOG-028](WITNESS-LOG-028.md)** —— 数字是怎么产出的，以及一张 33 行的逐条声明核验矩阵。

---

## 6. 如实的限制（今天依然成立）

- **零样本跨房间 / 跨人表现弱。** 每个部署都要预留约 30 秒做室内校准。
- **单节点空间分辨率有限。** 做多人 / 定位请用 2 个以上 ESP32 节点（或加一台 Cognitum Seed）。
- **多人计数很难。** 曾被服务端两个 bug 钳死在「1」（现已修复 —— 见 CHANGELOG #803）；再往上的精度仍取决于逐节点估计器，需要多人场景的硬件验证。
- **只靠代理标签训练的无摄像头姿态精度低**；要做到好姿态，路径是摄像头监督微调（[ADR-079](adr/ADR-079-camera-ground-truth-training.md)）。
- **测试版软件。** 接口和固件都会变。

---

## 7. 资料来源

- Carnegie Mellon《DensePose From WiFi》 — https://arxiv.org/abs/2301.00250
- IEEE 802.11bf WLAN Sensing — https://www.ieee802.org/11/Reports/tgbf_update.htm
- MM-Fi 基准 — https://github.com/ybhbingo/MMFi_dataset
- Hacker News 讨论 — https://news.ycombinator.com/item?id=46388904
- Cybernews 报道 — https://cybernews.com/security/viral-github-project-wifi-see-through-walls/
- byteiota《Real or AI-Generated Hype?》 — https://byteiota.com/wifi-densepose-hits-github-2-real-or-ai-generated-hype/
- agentpedia《RuView and the Reproducibility Question》 — https://agentpedia.codes/blog/ruview-guide
- 审计 fork（具体指控） — https://github.com/deletexiumu/wifi-densepose

---

*如果本页任何一条命令在你机器上跑不出写的结果，那就是缺陷，我们想知道 —— 请带上输出开个 issue。可复现本来就是全部意义所在。*
