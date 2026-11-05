# ADR-110 —— 分支状态（截至 2026-05-23，第 22 轮迭代）

给所有参与 ADR-110 或在其附近工作的人看的速查卡。那次收尾固件底座的 /loop SOTA 冲刺撞上了好几次跨分支切换事故（见第 17～19 轮）；写这一页，是为了让下一位协作者不用再从 `git log` 里重新推一遍布局。

## 分支归属

| 分支 | 负责方 | 承载内容 | 不要从哪里合入 |
|---|---|---|---|
| `main` | 共用 | 已发布的发布线 | — |
| `adr-110-esp32c6` | ADR-110 / C6 固件底座 | `WITNESS-LOG-110 §A0.x` 里描述的全部内容（4 个固件标签 v0.6.7 → v0.7.0、Python + Rust 解码器、sensing-server 线上格式、组网对齐时间戳还原、fps EMA、跨语言一致性闸门） | 别把 `feat/adr-115-ha-mqtt-matter` 上未提交的改动误落到这里 |
| `feat/adr-115-ha-mqtt-matter` | ADR-115 / HA-DISCO + HA-FABRIC + HA-MIND | MQTT 发布器（`rumqttc`）、Matter Bridge、语义自动化原语、相关 Cargo feature 与命令行参数 | 别把 ADR-110 对 `wifi-densepose-hardware` 依赖的改动误落到这里 |

## 各分支改动的文件

### `adr-110-esp32c6` —— 主要改动

```
firmware/esp32-csi-node/version.txt                              # 0.6.6 → 0.7.0
firmware/esp32-csi-node/main/c6_*.{c,h}                          # LP 核、TWT、时间同步、soft-AP HE、ESP-NOW 同步
firmware/esp32-csi-node/main/lp_core/main.c                      # 真正的 LP 核轮询程序
firmware/esp32-csi-node/main/csi_collector.c                     # 第 19 字节 bit 4 的 OR 修复；同步包发送
firmware/esp32-csi-node/main/Kconfig.projbuild                   # C6_* 开关
firmware/esp32-csi-node/main/CMakeLists.txt                      # ulp_embed_binary
firmware/esp32-csi-node/sdkconfig.defaults.esp32c6               # C6 覆盖配置

archive/v1/src/hardware/csi_extractor.py                         # SyncPacketParser + SyncPacket dataclass
archive/v1/tests/unit/test_esp32_binary_parser.py                # TestSyncPacketParser（7 个测试）

v2/crates/wifi-densepose-hardware/src/sync_packet.rs             # 新模块（15 个测试）
v2/crates/wifi-densepose-hardware/src/lib.rs                     # 重新导出
v2/crates/wifi-densepose-sensing-server/Cargo.toml               # 只新增 wifi-densepose-hardware 的 path 依赖
v2/crates/wifi-densepose-sensing-server/src/main.rs              # NodeState::{latest_sync, csi_fps_ema,
                                                                 #            mesh_aligned_us_for_csi_frame,
                                                                 #            observe_csi_frame_arrival}
                                                                 # udp_receiver_task 的 magic 分发
                                                                 # fps_ema_tests 模块（4 个测试）

docs/adr/ADR-110-esp32-c6-firmware-extension.md                  # 670 → 约 750 行（P10 + 冲刺总结）
docs/WITNESS-LOG-110.md                                          # 13 条 §A0.x 记录
docs/ADR-110-REVIEW-GUIDE.md                                     # 评审人一页纸
docs/ADR-110-BRANCH-STATE.md                                     # ← 本文件
```

### `feat/adr-115-ha-mqtt-matter` —— 主要改动

```
docs/adr/ADR-115-home-assistant-integration.md                   # 设计文档
v2/crates/wifi-densepose-sensing-server/Cargo.toml               # rumqttc 依赖 + [features] 块
v2/crates/wifi-densepose-sensing-server/src/cli.rs               # --mqtt / --matter / --semantic 参数
```

## 已知重叠点（小心处理）

两个分支都会碰 `v2/crates/wifi-densepose-sensing-server/Cargo.toml` 和 `src/main.rs`。冲突面**按区段是互不重叠的**：

| 文件 | ADR-110 区段 | ADR-115 区段 |
|---|---|---|
| `Cargo.toml` | `[dependencies]` —— 在已有 `wifi-densepose-signal` 那行附近加 `wifi-densepose-hardware = { path = "../wifi-densepose-hardware" }` | `[dependencies]` —— 下方加 `rumqttc` 块，末尾加 `[features]` 块 |
| `main.rs` | `NodeState` 字段 + `impl NodeState` 辅助函数 + 独立函数 `update_csi_fps_ema` + `fps_ema_tests` 模块 + `udp_receiver_task` 的 magic 分发 | （按 ADR-115 的 P 计划待定） |

两个分支合并时应该能**按行干净合并**，因为区段不重叠。如果 git 真在这两个文件里报了冲突，说明某一支已经越界改到了另一支的区段 —— 先查清楚，别盲目解决冲突。

## 快速验证命令（确认任一支是好的）

```bash
# Rust 工作区（在 v2/ 下执行）
cd v2
cargo test --workspace --no-default-features --lib       # 第 22 轮时 1437 个测试，0 失败

# Python 侧 ADR-110 主机解码器（在仓库根执行）
python -m pytest archive/v1/tests/unit/test_esp32_binary_parser.py::TestSyncPacketParser -v

# 跨语言线上格式闸门（第 21 轮钉下的）
cargo test -p wifi-densepose-hardware --no-default-features --lib sync_packet::tests::canonical_wire_bytes_match_python_decoder
python -m pytest archive/v1/tests/unit/test_esp32_binary_parser.py::TestSyncPacketParser::test_canonical_wire_bytes_match_rust_decoder -v
```

如果「规范字节串」这一对测试里只有单独一侧失败，说明**另一侧**的解码器已经偏离线上格式 —— 先去查那个解码器，而不是查失败的测试。

## 后续防坑

- 等 ADR-115 的 agent 把 `feat/adr-115-ha-mqtt-matter` 合进 main、且 ADR-110 也发布后，把 `main` 合进 `adr-110-esp32c6`（或反过来），再重跑两套测试。上面这种区段不重叠的结构，应该能让合并变成无冲突的快进。
- 有第三个 agent 接手任一 ADR 时，先让它看本文件，再动共享文件。
- 如果 /loop 驱动自动迭代时撞上跨分支切换，恢复步骤写在第 18 轮的提交信息里（`2997165bc`）：在异己分支上 stash，`git checkout` 回自己分支，再在本地重放本轮迭代。

## 给以后跑 `/loop` 和 `/loop-worker` 的经验

记于 38 轮 ADR-110 SOTA 冲刺（`/loop 5m until sota. and ultra optmized`）之后：

1. **每轮开头都要确认当前分支** —— /loop 每 5 分钟触发一次、同时另一个 agent 在兄弟分支上活动时，工作区可能在你没操作的情况下自己翻过去。把 `git branch --show-current` 作为每轮的第一行；不是预期的分支就先 stash、切回去，**再**开始改。第 17～19 轮我们为两次静默分支翻转花了约 30 分钟恢复。
2. **切完分支别盲目 `git add <file>`** —— 文件可能带上了异己分支的改动（checkout 时一并带过来的未提交工作）。每次 `git commit` 前都要看 `git diff --cached`。我们曾把 ADR-115 的 Cargo.toml/cli.rs 工作误吞进 ADR-110 的第 18 轮提交，后来补了一个回退提交（`ca2059b07`）加一通 stash 操作才收拾干净。
3. **共享文件里按"兄弟区段"改** —— 两个分支都要碰 `v2/crates/wifi-densepose-sensing-server/Cargo.toml` 或 `src/main.rs` 时，先说好各自占哪个 `[section]`、哪个结构体。把区段记进本文件（见「已知重叠点」）。这样合并就能保持干净的行级快进，不必解冲突。
4. **提交内联状态修改前，先把纯函数抽出来** —— 第 30 轮（`sync_snapshot`）、第 32 轮（`apply_sync_packet`）、第 37 轮（`fleet_role_counts`）都把内联的状态变更改成了有名字、独立、可测试的纯函数。每次都省掉 4 处以上内联重复，而且不用起 axum / tokio 就能测该辅助函数。把这句话写进每一轮的计划：*「这里我能抽出的最小辅助函数是什么？」*
5. **跨语言线上格式闸门** —— 协议解码器同时用 Python 和 Rust 实现时，要在**两边**测试里钉住**同一个**规范字节串（第 21 轮的做法）。哪边漂了，就恰好在漂的那边触发恰好一个具名测试。别拖到"以后" —— 交付第二门语言那一轮就把钉子加上。
6. **状态很重时，辅助函数测试优于集成测试** —— `AppStateInner` 字段太多，测试里根本构造不出来。与其硬刚，不如把逐字段逻辑抽成纯辅助函数（第 30 轮 sync_snapshot 的做法）。测试直接打辅助函数，handler 那层胶水保持很薄、简单到显然正确。
7. **本地 stub 文件会滞后于固件新增内容** —— `firmware/esp32-csi-node/test/stubs/esp_stubs.c` 不会跟着固件一起重新构建，所以往 `*.h` 里加的新符号，要等 CI 跑起来才会以模糊测试目标链接错误的形式暴露。第 38 轮就是这样抓到 `c6_sync_espnow_is_valid` 的。**只要加了一个声明能被 `csi_collector.c` 看到的函数，就在同一次提交里补上 stub。**
8. **基于 cron 的 /loop 会跨过不可逆的检查点累积工作（打标签、发版、PR 就绪）** —— 一旦切了 tag 或把 PR 标成 ready，回退代价就远高于改一行代码。把这些动作留到你信心有余量时再做（本地全套测试绿、上一轮 CI 绿）。第 12 轮（切 v0.7.0）和第 38 轮（PR ready）的时机就是对的：都发生在第 6 轮 / 第 37 轮的证据落地之后。
