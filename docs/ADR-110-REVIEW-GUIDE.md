# ADR-110 评审速览

这是给 `adr-110-esp32c6` 分支 / 草稿 PR 评审人看的**一页纸**。正式记录是 [`docs/WITNESS-LOG-110.md`](WITNESS-LOG-110.md)；本页只是让你更快上手。

## 这个分支交付了什么

给 `firmware/esp32-csi-node` 做了一套双目标构建：同一份源码，既能编译成 `esp32s3`（现有量产目标），也能编译成 `esp32c6`（新增研究目标，带 Wi-Fi 6 / 802.15.4 / TWT / LP 核）。所有仅 C6 可用的模块都用 `#ifdef CONFIG_IDF_TARGET_ESP32C6` 包住，因此 S3 的构建路径与之前逐字节一致。

## 五分钟评审路线

1. **读 ADR**：[`docs/adr/ADR-110-esp32-c6-firmware-extension.md`](adr/ADR-110-esp32-c6-firmware-extension.md) —— 设计、阶段划分、取舍。
2. **读见证记录**：[`docs/WITNESS-LOG-110.md`](WITNESS-LOG-110.md) —— 4 个部分（A = 已实测验证、B = 架构上已具备但未实测、C = 已修的缺陷、D = 发现但尚未修的缺陷、D-workaround = 转向 ESP-NOW 的绕行方案）。
3. **扫一遍新增固件模块**：`firmware/esp32-csi-node/main/c6_{twt,timesync,lp_core,sync_espnow}.{h,c}`。
4. **扫一遍新增的主机解码器和测试**：
   - Rust：`v2/crates/wifi-densepose-hardware/src/{csi_frame,esp32_parser}.rs`（搜 `PpduType`、`Adr018Flags`、`adr110_*` 开头的测试名）
   - Python：`archive/v1/src/hardware/csi_extractor.py` + `archive/v1/tests/unit/test_esp32_binary_parser.py`（搜 `TestAdr110ByteEncoding`）
5. **看一眼 CI**：`firmware-ci.yml` 的 `c6-4mb` 矩阵行会在 Ubuntu 上同时跑 C6 构建和主机单元测试 —— 整个分支期间两项都是绿的。

## 实测评分表（哪些是真测过的）

| 维度 | 状态 |
|---|---|
| C6 构建 + 启动 + 双目标 | ✅ 已在 3 块板（COM6/COM9/COM12）验证，CI 矩阵全绿，S3 回归全绿 |
| HE-LTF 线上格式（ADR-018 第 18-19 字节） | ✅ 已在固件 / Rust / Python 之间端到端验证（17 个单元测试） |
| HE-LTF 实时采集 | ⏸ 受阻 —— 需要 11ax AP（台架上只有 11n AP） |
| TWT 优雅回绝 | ✅ 已实时验证 —— 捕获并妥善处理了 `c6_twt: iTWT setup failed: ESP_ERR_INVALID_ARG` |
| TWT 节拍确定性 | ⏸ 受阻 —— 同样卡在缺 11ax AP |
| ESP-NOW 传输发送 + 稳定性 | ✅ 已验证 —— 120 秒 + 300 秒浸泡，累计 4102 次发送，0 失败 |
| ESP-NOW 跨板接收 | ⏸ 受阻 —— 4 块板里有 3 块在实验中途掉出 USB 枚举 |
| 原生 802.15.4 跨节点同步 | ❌ 坏掉 —— IDF v5.4 驱动缺陷，测试并排除了 5 个假设；已用 ESP-NOW 绕行 |
| 5 µA 休眠 | ⏸ 受阻 —— 那是数据手册数字，需要 INA / Joulescope 才能实测 |
| 见证包可重新生成且干净 | ✅ 6/7 通过（1 项失败是既有的 Python 证明环境问题，与 ADR-110 无关），哈希全部记录，敏感信息已脱敏 |

## 如实的结论

协议层和传输底座已经做得很扎实。**四个主打的 SOTA 维度，一个都没有实测数据** —— 每一个都卡在台架没有的硬件上。每个阻塞项都在 `WITNESS-LOG-110.md` §B 里写明了，还写了具体需要什么仪器才能解锁。**这个分支是"用来做测量的地基"，不是测量本身。**

过程中发现并修好的五个具体缺陷（MAC/EUI 重复插入 FFFE、`wifi_pkt_rx_ctrl_t` 两套结构体变体、C6 上的 LED GPIO 38、TWT 的 INVALID_ARG 向上传播、见证包泄露密钥）本身都是真实且有用的成果，与 SOTA 那条叙事最后成不成立无关。

## 给操作者的安全提示（不是给评审人的）

见证包里的 Python 证明步骤，曾经通过 Pydantic 校验错误的报错输出，把 `.env` 内容漏进打包日志。推送前已把该包销毁，并加了 `scripts/redact-secrets.py` 过滤器（提交 `f8a2e3695`）。**此前暴露过的 Docker Hub 与 PI 集群令牌应当轮换** —— 它们出现在本地会话日志里，虽然从没到过 `origin`。

## 本分支的提交（按时间）

| # | SHA 前缀 | 内容 |
|---|---|---|
| 1 | `f23e34e` | ADR-110 初始固件 + ADR + 测试 + 文档 + 见证脚手架 |
| 2 | `6652384` | TWT INVALID_ARG 优雅处理 + 诊断计数器 |
| 3 | `4c39e28` | PAN 匹配 + 4 组实验的 D1 记录 |
| 4 | `f8a2e36` | **安全**：见证包敏感信息脱敏 |
| 5 | `88be283` | ESP-NOW 传输（D1 绕行方案） |
| 6 | `3959fab` | Rust 主机解码器 + 6 个单元测试 |
| 7 | `8eaa92c` | Python 主机解码器 + 5 个单元测试 |
| 8 | `b808a63` | 120 秒 ESP-NOW 浸泡见证 |
| 9 | `89972c0` | 扩充 CHANGELOG |
| 10 | `fc75a8a` | 模糊测试脚手架扩展到第 18-19 字节 |
| 11 | `9de34ba` | ADR-110 收录进 docs/adr/README.md |
| 12 | `553b07d` | 收紧 README 的 C6 行（从「已实现」改成「线上格式已就绪」） |
| 13 | `e255b7d` | firmware/README 说明同时支持 S3+C6 |
| 14 | `9a46fc8` | 300 秒 ESP-NOW 浸泡见证（样本量 2.5 倍） |
| 15 | _(本次提交)_ | 本评审速览 |
