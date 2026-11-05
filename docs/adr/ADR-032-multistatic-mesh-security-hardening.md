# ADR-032：多基地网格安全加固

| 字段 | 值 |
|-------|-------|
| **状态** | Accepted |
| **日期** | 2026-03-01 |
| **决策者** | ruv |
| **关联文档** | ADR-029（RuvSense 多基地）、ADR-030（持久场模型）、ADR-031（RuView 感知优先 RF）、ADR-018（ESP32 实现）、ADR-012（ESP32 网格） |

---

## 1. 背景

### 1.1 ADR-029/030/031 的安全审计

对 RuvSense 多基地感知栈（ADR-029 至 ADR-031）的安全审计，在 TDM 同步层、CSI 帧传输、NDP 注入、相干性门控、跨房间跟踪、NVS 凭据处理与固件并发模型中共发现七项问题。严重程度分为三级：HIGH（1 项）、MEDIUM（3 项）、LOW（3 项）。

这些问题分为三类：

1. **缺少密码学认证** -- TDM SyncBeacon 与 CSI 帧格式都没有消息认证，恶意节点可向网格注入伪造的信标或帧。
2. **资源不受限或缺少保护** -- NDP 注入路径没有限速器，相干性门控的重校准状态没有超时上限，跨房间转移日志会无限增长。
3. **嵌入式目标上的内存安全** -- NVS 凭据缓冲区在使用后未清零，CSI 采集器中的静态可变全局变量被 ESP32-S3 的两个核心无同步地访问。

### 1.2 威胁模型

主要威胁主体是位于同一 LAN 子网或网格 WiFi 覆盖范围内的恶意 ESP32 节点。攻击面是用于同步信标、CSI 帧与 NDP 注入的 UDP 广播平面。

| 威胁 | STRIDE | 影响 | 可利用性 |
|--------|--------|--------|----------------|
| 伪造 SyncBeacon 注入 | Spoofing, Tampering | 整个网格失去同步，无姿态输出 | 门槛低，局域网内的恶意 ESP32 |
| CSI 帧伪造 | Spoofing, Tampering | 姿态估计被破坏，出现幽灵人员 | 门槛低，注入 UDP 报文即可 |
| NDP 射频洪泛 | Denial of Service | 信道饱和，CSI 数据丢失 | 门槛低，反复调用 NDP |
| 相干性门控停滞 | Denial of Service | 无限期重校准，输出冻结 | 需要持续干扰 |
| 转移日志耗尽 | Denial of Service | 长时间运行后聚合器 OOM | 被动发生，无需攻击者 |
| 凭据栈残留 | Information Disclosure | 可从 RAM dump 恢复 WiFi 密码 | 需要物理接触设备 |
| 双核数据竞争 | Tampering, DoS | CSI 帧损坏，行为未定义 | 被动发生，无需攻击者 |

### 1.3 设计约束

- ESP32-S3 的 CPU 预算有限：密码学运算必须在 TDM 时隙之间 1 ms 的保护间隔内完成。
- ESP32-S3 上的 HMAC-SHA256（通过 `mbedtls` 硬件加速）对 24 字节载荷约耗时 15 us -- 完全在预算之内。
- SipHash-2-4 在 ESP32-S3 上对 64 字节载荷约耗时 2 us -- 适合做逐帧 MAC。
- 感知数据路径上没有 TLS 或 TCP（为降低延迟而采用 UDP 广播）。
- 预共享密钥（PSK）模型可以接受，因为一次网格部署中的所有节点都由同一运营方配置。

---

## 2. 决策

通过六项措施加固多基地网格：信标认证、帧完整性、NDP 限速、有界缓冲区、内存安全与密钥管理。所有改动都向后兼容：迁移窗口期内仍接受未认证帧，窗口由 `security_level` NVS 参数控制。

### 2.1 信标认证协议（H-1）

**发现的问题：** 16 字节的 `SyncBeacon` 线格式（`crates/wifi-densepose-hardware/src/esp32/tdm.rs`）没有密码学认证。恶意节点可注入伪造信标使 TDM 网格失步。

**解决方案：** 增加 4 字节单调递增 nonce 与 8 字节截断的 HMAC-SHA256 标签，把 SyncBeacon 线格式从 16 字节扩展到 28 字节。

```
Authenticated SyncBeacon wire format (28 bytes):
  [0..7]   cycle_id          (LE u64)
  [8..11]  cycle_period_us   (LE u32)
  [12..13] drift_correction  (LE i16)
  [14..15] reserved
  [16..19] nonce             (LE u32, monotonically increasing)
  [20..27] hmac_tag          (HMAC-SHA256 truncated to 8 bytes)
```

**HMAC 计算：**

```
key     = 16-byte pre-shared mesh key (stored in NVS, namespace "mesh_sec")
message = beacon[0..20]  (first 20 bytes: payload + nonce)
tag     = HMAC-SHA256(key, message)[0..8]  (truncated to 8 bytes)
```

**Nonce 与重放保护：**

- 协调器维护一个单调递增的 32 位 nonce 计数器，每发一个信标加一。
- 每个接收方按发送方维护 `last_accepted_nonce`。仅当 `nonce > last_accepted_nonce - REPLAY_WINDOW` 时才接受信标，其中 `REPLAY_WINDOW = 16`（用于容纳 UDP 报文乱序）。
- nonce 溢出（20 Hz 下经过 2^32 个信标约 6.8 年）会触发强制密钥轮换。

**实现位置：** `crates/wifi-densepose-hardware/src/esp32/tdm.rs` -- 扩展 `SyncBeacon::to_bytes()` 与 `SyncBeacon::from_bytes()` 以产出/消费 28 字节认证格式，并新增 `SyncBeacon::verify()` 方法。

### 2.2 CSI 帧完整性（M-3）

**发现的问题：** ADR-018 的 CSI 帧格式没有密码学 MAC，帧在传输中可被伪造或篡改。

**解决方案：** 在 CSI 帧头增加 8 字节 SipHash-2-4 标签。逐帧 MAC 选择 SipHash 而非 HMAC-SHA256，是因为它在 ESP32 上处理短消息快 7 倍（约 2 us 对 15 us），且对非机密数据已提供足够的完整性保护。

```
Extended CSI frame header (28 bytes, was 20):
  [0..3]   Magic: 0xC5110002  (bumped from 0xC5110001 to signal auth)
  [4]      Node ID
  [5]      Number of antennas
  [6..7]   Number of subcarriers (LE u16)
  [8..11]  Frequency MHz (LE u32)
  [12..15] Sequence number (LE u32)
  [16]     RSSI (i8)
  [17]     Noise floor (i8)
  [18..19] Reserved
  [20..27] siphash_tag  (SipHash-2-4 over [0..20] + IQ data)
```

**SipHash 密钥派生：**

```
siphash_key = HMAC-SHA256(mesh_key, "csi-frame-siphash")[0..16]
```

SipHash 密钥在启动时由网格密钥派生一次并缓存在内存中。

**实现位置：**
- `firmware/esp32-csi-node/main/csi_collector.c` -- 在 `csi_serialize_frame()` 中计算 SipHash 标签，并提升 magic 常量。
- `crates/wifi-densepose-hardware/src/esp32/` -- 在聚合器的帧解析器中增加帧校验。

### 2.3 NDP 注入限速器（M-4）

**发现的问题：** `firmware/esp32-csi-node/main/csi_collector.c` 中的 `csi_inject_ndp_frame()` 没有限速器，不受控的 NDP 注入会淹没 RF 信道。

**解决方案：** 采用令牌桶限速器，可配置参数存放在 NVS 中。

```c
// 令牌桶参数（默认值）
#define NDP_RATE_MAX_TOKENS   20    // burst capacity
#define NDP_RATE_REFILL_HZ    20    // sustained rate: 20 NDP/sec
#define NDP_RATE_REFILL_US    (1000000 / NDP_RATE_REFILL_HZ)

typedef struct {
    uint32_t tokens;          // current token count
    uint32_t max_tokens;      // bucket capacity
    uint32_t refill_interval_us;  // microseconds per token
    int64_t  last_refill_us;  // last refill timestamp
} ndp_rate_limiter_t;
```

`csi_inject_ndp_frame()` 在桶空时返回 `ESP_ERR_NOT_ALLOWED`。限速器参数可通过 NVS 键 `ndp_max_tokens` 与 `ndp_refill_hz` 配置。

**实现位置：** `firmware/esp32-csi-node/main/csi_collector.c` -- 新增 `ndp_rate_limiter_t` 状态，并在 `csi_inject_ndp_frame()` 中检查。

### 2.4 相干性门控重校准超时（M-5）

**发现的问题：** `crates/wifi-densepose-signal/src/ruvsense/coherence_gate.rs` 中的 `Recalibrate` 状态可以无限期保持。持续干扰源可使系统永远处于重校准，导致没有任何输出。

**解决方案：** 为 `GatePolicyConfig` 增加可配置的 `max_recalibrate_duration`（默认 30 秒 = 20 Hz 下 600 帧）。当重校准时长超过该上限，门控转入 `ForcedAccept` 状态并放大噪声（10 倍），提供「降级但可用」的输出。

```rust
pub enum GateDecision {
    Accept { noise_multiplier: f32 },
    PredictOnly,
    Reject,
    Recalibrate { stale_frames: u64 },
    /// 重校准超时。以大幅放大的噪声接受。
    ForcedAccept { noise_multiplier: f32, stale_frames: u64 },
}
```

新增配置字段：

```rust
pub struct GatePolicyConfig {
    // ... 已有字段 ...
    /// 强制接受前 Recalibrate 允许的最大帧数。默认值：600（20 Hz 下 30 秒）。
    pub max_recalibrate_frames: u64,
    /// ForcedAccept 的噪声倍率。默认值：10.0。
    pub forced_accept_noise: f32,
}
```

**实现位置：** `crates/wifi-densepose-signal/src/ruvsense/coherence_gate.rs` -- 扩展 `GateDecision` 枚举，修改 `GatePolicy::evaluate()`。

### 2.5 有界转移日志（L-1）

**发现的问题：** `crates/wifi-densepose-signal/src/ruvsense/cross_room.rs` 中的 `CrossRoomTracker` 把转移事件存放在无界的 `Vec<TransitionEvent>` 中。长时间运行（数天/数周）后会无限增长。

**解决方案：** 用环形缓冲区替换 `transitions: Vec<TransitionEvent>`，达到容量时淘汰最旧的条目。

```rust
pub struct CrossRoomConfig {
    // ... 已有字段 ...
    /// 环形缓冲区保留的最大转移数。默认值：1000。
    pub max_transitions: usize,
}
```

环形缓冲区用 `VecDeque<TransitionEvent>` 实现，在 push 时检查容量。当 `transitions.len() >= max_transitions` 时，先 `transitions.pop_front()` 再压入。这保留了只追加审计轨迹的语义（事件从不被修改，只按新旧淘汰）。

**实现位置：** `crates/wifi-densepose-signal/src/ruvsense/cross_room.rs` -- 把 `transitions: Vec<TransitionEvent>` 改为 `transitions: VecDeque<TransitionEvent>`，并在 `match_entry()` 中加入淘汰逻辑。

### 2.6 NVS 密码缓冲区清零（L-4）

**发现的问题：** `firmware/esp32-csi-node/main/nvs_config.c` 中的 `nvs_config_load()` 把 WiFi 密码读入栈缓冲区 `buf`，使用后未清零。ESP32-S3 的栈内存不会自动清除，凭据可通过物理内存 dump 恢复。

**解决方案：** 每次读取 NVS 字符串后用 `explicit_bzero()`（ESP-IDF 通过 newlib 提供）清零栈缓冲区。若 `explicit_bzero` 不可用，则使用带 volatile 指针的 `memset` 以防编译器优化掉。

```c
/* 在每次可能包含凭据的 nvs_get_str 之后： */
explicit_bzero(buf, sizeof(buf));

/* 可移植的回退实现： */
static void secure_zero(void *ptr, size_t len) {
    volatile unsigned char *p = (volatile unsigned char *)ptr;
    while (len--) { *p++ = 0; }
}
```

对 `nvs_config_load()` 中全部三处 `nvs_get_str` 调用点（ssid、password、target_ip）都应用该处理。

**实现位置：** `firmware/esp32-csi-node/main/nvs_config.c` -- 在每个 `nvs_get_str` 代码块后加入 `explicit_bzero(buf, sizeof(buf))`。

### 2.7 静态可变状态的原子访问（L-5）

**发现的问题：** `csi_collector.c` 使用静态可变全局变量（`s_sequence`、`s_cb_count`、`s_send_ok`、`s_send_fail`、`s_hop_index`），被 ESP32-S3 的两个核心无同步地访问。CSI 回调运行在 WiFi 任务上（默认绑定核心 0），而主应用与跳频定时器可能运行在核心 1。

**解决方案：** 对所有共享计数器使用 C11 `_Atomic` 限定符；对需要多变量一致性的跳频表状态使用 FreeRTOS 互斥锁。

```c
#include <stdatomic.h>

static _Atomic uint32_t s_sequence  = 0;
static _Atomic uint32_t s_cb_count  = 0;
static _Atomic uint32_t s_send_ok   = 0;
static _Atomic uint32_t s_send_fail = 0;
static _Atomic uint8_t  s_hop_index = 0;

/* 跳频表由互斥锁保护（保证多变量一致性） */
static SemaphoreHandle_t s_hop_mutex = NULL;
```

互斥锁在 `csi_collector_init()` 中创建，并在 `csi_hop_next_channel()` 的跳频表读取与 `csi_collector_set_hop_table()` 的写入前后加解锁。

**实现位置：** `firmware/esp32-csi-node/main/csi_collector.c` -- 增加 `_Atomic` 限定符，创建并使用 `s_hop_mutex`。

### 2.8 密钥管理

所有密码学操作共用一把存放在 NVS 中的 16 字节预共享网格密钥。

**配置（Provisioning）：**

```
NVS namespace: "mesh_sec"
NVS key:       "mesh_key"
NVS type:      blob (16 bytes)
```

密钥在节点初始化时通过现有的 `scripts/provision.py` 工具配置；该工具被扩展为生成随机 16 字节密钥并烧写到一次部署中的所有节点。

**密钥派生：**

```
beacon_hmac_key  = mesh_key                                      (direct, 16 bytes)
frame_siphash_key = HMAC-SHA256(mesh_key, "csi-frame-siphash")[0..16]  (derived, 16 bytes)
```

**密钥轮换：**

- 通过管理命令手动轮换：`provision.py rotate-key --deployment <id>`。
- 协调器广播密钥轮换事件（用旧密钥签名），其中包含用旧密钥加密的新密钥。
- 各节点接受新密钥，并在确认下一个信标已用新密钥签名后切换。
- 建议每 90 天轮换一次，或在任何节点退役后轮换。

**安全级别 NVS 参数：**

```
NVS key: "sec_level"
Values:
  0 = permissive  (accept unauthenticated frames, log warning)
  1 = transitional (accept both authenticated and unauthenticated)
  2 = enforcing   (reject unauthenticated frames)
Default: 1 (transitional, for backward compatibility during rollout)
```

---

## 3. 实施计划（文件级）

### 3.1 阶段 1：信标认证与密钥管理

| 文件 | 改动 | 优先级 |
|------|--------|----------|
| `crates/wifi-densepose-hardware/src/esp32/tdm.rs` | 将 `SyncBeacon` 扩展为 28 字节认证格式，新增 `verify()`、nonce 跟踪与重放窗口 | P0 |
| `firmware/esp32-csi-node/main/nvs_config.c` | 增加 `mesh_key` 与 `sec_level` 的 NVS 读取 | P0 |
| `firmware/esp32-csi-node/main/nvs_config.h` | 在 `nvs_config_t` 中增加 `mesh_key[16]` 与 `sec_level` | P0 |
| `scripts/provision.py` | 增加 `--mesh-key` 生成与 `rotate-key` 命令 | P0 |

### 3.2 阶段 2：帧完整性与限速

| 文件 | 改动 | 优先级 |
|------|--------|----------|
| `firmware/esp32-csi-node/main/csi_collector.c` | 在帧序列化中增加 SipHash-2-4 标签、NDP 限速器、`_Atomic` 限定符与跳频互斥锁 | P1 |
| `firmware/esp32-csi-node/main/csi_collector.h` | 把 `CSI_HEADER_SIZE` 更新为 28，增加限速器配置 | P1 |
| `crates/wifi-densepose-hardware/src/esp32/` | 在聚合器解析器中增加帧校验 | P1 |

### 3.3 阶段 3：有界缓冲区与门控加固

| 文件 | 改动 | 优先级 |
|------|--------|----------|
| `crates/wifi-densepose-signal/src/ruvsense/cross_room.rs` | 用 `VecDeque` 替换 `Vec`，增加 `max_transitions` 配置 | P1 |
| `crates/wifi-densepose-signal/src/ruvsense/coherence_gate.rs` | 增加 `ForcedAccept` 变体与 `max_recalibrate_frames` 配置 | P1 |

### 3.4 阶段 4：内存安全

| 文件 | 改动 | 优先级 |
|------|--------|----------|
| `firmware/esp32-csi-node/main/nvs_config.c` | 在读取凭据后增加 `explicit_bzero()` | P2 |
| `firmware/esp32-csi-node/main/csi_collector.c` | `_Atomic` 计数器、`s_hop_mutex`（若阶段 2 未完成） | P2 |

---

## 4. 验收标准

### 4.1 信标认证（H-1）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| H1-1 | `SyncBeacon::to_bytes()` 产出带有效 HMAC 标签的 28 字节输出 | 单元测试：序列化后校验标签与重新计算的 HMAC 一致 |
| H1-2 | `SyncBeacon::verify()` 拒绝 HMAC 标签错误的信标 | 单元测试：翻转标签中的一位，校验返回 `Err` |
| H1-3 | `SyncBeacon::verify()` 拒绝窗口外重放的 nonce | 单元测试：提交 nonce = last_accepted - REPLAY_WINDOW - 1，校验被拒绝 |
| H1-4 | `SyncBeacon::verify()` 接受重放窗口内的信标 | 单元测试：提交 nonce = last_accepted - REPLAY_WINDOW + 1，校验被接受 |
| H1-5 | 协调器 nonce 在各周期间单调递增 | 单元测试：调用 `begin_cycle()` 100 次，校验严格单调 |
| H1-6 | 向后兼容：`sec_level=0` 接受未认证的 16 字节信标 | 集成测试：新旧节点混用 |

### 4.2 帧完整性（M-3）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| M3-1 | magic 为 `0xC5110002` 的 CSI 帧带有有效的 8 字节 SipHash 标签 | 单元测试：序列化帧并校验标签 |
| M3-2 | 帧校验拒绝 IQ 数据被篡改的帧 | 单元测试：翻转 IQ 载荷中的一个字节，校验被拒绝 |
| M3-3 | SipHash 计算在 ESP32-S3 上耗时 < 10 us | 在目标硬件上做基准测试 |
| M3-4 | 当 `sec_level < 2` 时帧解析器接受旧 magic `0xC5110001` | 单元测试：向后兼容性 |

### 4.3 NDP 限速器（M-4）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| M4-1 | `csi_inject_ndp_frame()` 前 `max_tokens` 次调用成功 | 单元测试：快速调用 20 次，全部成功 |
| M4-2 | 桶空时第 21 次调用返回 `ESP_ERR_NOT_ALLOWED` | 单元测试：耗尽令牌桶，校验错误码 |
| M4-3 | 令牌桶按配置速率补充 | 单元测试：耗尽后等待 `refill_interval_us`，校验有一个令牌可用 |
| M4-4 | `ndp_max_tokens` 与 `ndp_refill_hz` 的 NVS 覆盖值生效 | 集成测试：设置 NVS 值并校验行为 |

### 4.4 相干性门控超时（M-5）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| M5-1 | `GatePolicy::evaluate()` 在 `max_stale_frames` 处返回 `Recalibrate` | 单元测试：保持原有行为 |
| M5-2 | `GatePolicy::evaluate()` 在 `max_recalibrate_frames` 处返回 `ForcedAccept` | 单元测试：输入 `max_recalibrate_frames + 1` 个低相干性帧 |
| M5-3 | `ForcedAccept` 的噪声倍率等于 `forced_accept_noise`（默认 10.0） | 单元测试：校验 noise_multiplier 字段 |
| M5-4 | `max_recalibrate_frames` 默认值为 600（20 Hz 下 30 秒） | 单元测试：校验默认配置 |

### 4.5 有界转移日志（L-1）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| L1-1 | `CrossRoomTracker::transition_count()` 从不超过 `max_transitions` | 单元测试：max_transitions=1000 时插入 1500 个转移，校验计数为 1000 |
| L1-2 | 最旧的转移最先被淘汰（FIFO） | 单元测试：校验首个转移是插入的第 (N-999) 个 |
| L1-3 | `max_transitions` 默认值为 1000 | 单元测试：校验默认配置 |

### 4.6 NVS 密码清零（L-4）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| L4-1 | 每次 `nvs_get_str` 调用后栈缓冲区 `buf` 被清零 | 代码评审 + 静态分析（无法做运行时测试） |
| L4-2 | 使用 `explicit_bzero`（而非普通 `memset`）以防止编译器优化 | 代码评审：确认调用的是 `explicit_bzero` 或 volatile 指针模式 |

### 4.7 原子化静态状态（L-5）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| L5-1 | `s_sequence`、`s_cb_count`、`s_send_ok`、`s_send_fail` 均声明为 `_Atomic` | 代码评审 |
| L5-2 | `s_hop_mutex` 在 `csi_collector_init()` 中创建 | 代码评审 + 集成测试：初始化成功 |
| L5-3 | `csi_hop_next_channel()` 与 `csi_collector_set_hop_table()` 会加解锁 | 代码评审 |
| L5-4 | ThreadSanitizer 下未检出数据竞争（主机侧测试构建） | 主机上 `cargo test` 启用 TSAN（Rust 侧）；C 侧用 QEMU 或硬件测试 |

---

## 5. 影响

### 5.1 正面

- **抵御恶意节点**：HMAC 认证的信标可防止未授权节点使网格失步。
- **帧完整性**：SipHash MAC 可检出 CSI 数据在传输中被篡改，防止注入幽灵人员。
- **RF 可用性**：令牌桶限速器可防止 NDP 洪泛耗尽共享无线介质。
- **内存有界**：转移日志的环形缓冲区与重校准的超时上限，可避免长期部署中的资源耗尽。
- **凭据卫生**：缓冲区清零缩小了通过物理内存访问恢复凭据的窗口。
- **线程安全**：原子操作与互斥锁消除了双核 ESP32-S3 上的未定义行为。
- **向后兼容**：`sec_level` 参数支持渐进式上线，不会破坏现有部署。

### 5.2 负面

- **SyncBeacon 增加 12 字节**：28 字节对 16 字节（增加 75%，但仍能轻松放进单个 UDP 报文）。
- **CSI 帧头增加 8 字节**：28 字节对 20 字节（帧头增加 40%；相对 128-512 字节的 IQ 载荷可忽略）。
- **CPU 开销**：HMAC-SHA256 每个信标约增加 15 us（每 50 ms 周期一次 = 0.03% CPU）。SipHash 每帧约增加 2 us（100 Hz 下 = 0.02% CPU）。
- **密钥管理复杂度**：网格密钥必须配置到所有节点并定期轮换。密钥丢失需要重新配置全部节点。
- **互斥锁竞争**：跳频表互斥锁可能给信道跳变路径带来最多 1 us 延迟，仍在保护间隔预算内。

### 5.3 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|-------------|--------|------------|
| 老款 ESP32（非 S3）上 HMAC 计算超出保护间隔 | Low | 传统硬件上信标认证不可用 | 所有 ESP32 型号都有硬件加速 SHA256；基准测试确认 < 50 us |
| ESP32 上通过侧信道泄露密钥 | Very Low | 整个网格认证被绕过 | 密钥存放在 eFuse（ESP32-S3 支持）或加密 NVS 分区 |
| ForcedAccept 模式产生噪声过大的姿态 | Medium | 持续干扰期间姿态质量下降 | 10 倍噪声倍率可配置；运营方可调高或关闭 |
| SipHash 碰撞（64 位标签） | Very Low | 单个伪造帧被接受 | 每帧概率 2^-64；攻击者无法以协议速率穷举 |

---

## 6. QUIC 传输层（ADR-032a 修订）

### 6.1 动机

ADR-032 的原始设计（第 2.1--2.2 节）在裸 UDP 上手工实现 HMAC-SHA256 与 SipHash-2-4。虽然在资源受限的 ESP32 硬件上正确且高效，但这种方式存在运维缺陷：

- **手工密钥轮换**：需要自定义密钥交换协议与协调器广播。
- **没有拥塞控制**：裸 UDP 没有背压，突发 CSI 流量可能压垮聚合器。
- **不支持连接迁移**：节点漫游（例如移动某个 ESP32）需要手动重连。
- **重放窗口代码重复**：自定义 nonce 跟踪与 QUIC 内置的重放保护重复。

### 6.2 决策：为聚合器上行链路引入 `midstreamer-quic`

对于 CPU 与内存充足的聚合器级节点（Raspberry Pi、x86 网关），用 `midstreamer-quic` v0.1.0 替换手工密码层，它提供：

| 能力 | 手工方案（ADR-032 原始设计） | QUIC（`midstreamer-quic`） |
|---|---|---|
| 认证 | 截断为 8 字节的 HMAC-SHA256 | TLS 1.3 AEAD（AES-128-GCM） |
| 帧完整性 | SipHash-2-4 标签 | QUIC 包级 AEAD |
| 重放保护 | 手工 nonce + 窗口 | QUIC 包号（单调递增） |
| 密钥轮换 | 自定义协调器广播 | TLS 1.3 `KeyUpdate` 消息 |
| 拥塞控制 | None | QUIC cubic/BBR |
| 连接迁移 | 不支持 | QUIC 连接 ID 迁移 |
| 多流 | N/A | QUIC 流（信标、CSI、控制） |

**资源受限设备（ESP32-S3）保留第 2.1--2.2 节的手工密码路径**作为回退。由 `SecurityMode` 枚举选择传输方式：

```rust
pub enum SecurityMode {
    /// 裸 UDP 上的手工 HMAC/SipHash（ESP32-S3，ADR-032 原始设计）。
    ManualCrypto,
    /// 采用 TLS 1.3 的 QUIC 传输（聚合器级节点）。
    QuicTransport,
}
```

### 6.3 QUIC 流映射

三条专用 QUIC 流按优先级隔离流量：

| 流 ID | 用途 | 方向 | 优先级 |
|---|---|---|---|
| 0 | 同步信标 | 协调器 -> 各节点 | Highest（TDM 时序关键） |
| 1 | CSI 帧 | 各节点 -> 聚合器 | High（感知数据） |
| 2 | 控制平面 | 双向 | Normal（配置、密钥轮换、健康状态） |

### 6.4 其它 Midstreamer 集成

除 QUIC 传输外，还有三个 midstreamer crate 可增强感知流水线：

1. **`midstreamer-scheduler` v0.1.0** -- 用超低延迟实时任务调度器替代手工定时器式 TDM 时隙调度，提供亚微秒抖动的确定性时隙触发。

2. **`midstreamer-temporal-compare` v0.1.0** -- 用时序比较原语增强手势 DTW 匹配（ADR-030 第 6 层），提供优化过的 Sakoe-Chiba 带 DTW、LCS 与编辑距离核。

3. **`midstreamer-attractor` v0.1.0** -- 用动力系统分析增强纵向漂移检测（ADR-030 第 4 层），在表现为简单指标漂移之前检出预示生物力学状态变化的相空间吸引子偏移。

### 6.5 回退策略

QUIC 传输层是附加能力，而非替换：

- **ESP32-S3 节点**：继续使用 UDP 上的手工 HMAC/SipHash（第 2.1--2.2 节）。这些设备内存不足以容纳完整的 TLS 1.3 协议栈。
- **聚合器节点**：默认使用 `midstreamer-quic`。若 QUIC 握手失败（例如网络分区），回退到手工密码方案。
- **混合部署**：聚合器通过 TLS ClientHello 或 magic 字节自动判断入站连接是 QUIC 还是裸 UDP，并据此路由。

### 6.6 验收标准（QUIC）

| ID | 判据 | 测试方法 |
|----|-----------|-------------|
| Q-1 | 两节点之间在 100 ms 内建立 QUIC 连接 | 集成测试：连接并测量握手耗时 |
| Q-2 | 信标流投递抖动 < 1 ms | 单元测试：发送 1000 个信标，测量到达间隔方差 |
| Q-3 | CSI 流吞吐达到裸 UDP 的 >= 95% | 基准测试：判据对比 |
| Q-4 | 模拟 IP 变更后连接迁移成功 | 集成测试：重新绑定，校验流的连续性 |
| Q-5 | QUIC 不可用时回退到手工密码方案 | 单元测试：拒绝 QUIC，校验 ManualCrypto 路径 |
| Q-6 | SecurityMode::ManualCrypto 产出的线格式与 ADR-032 原始设计完全一致 | 单元测试：逐字节比较 |

---

## 7. 相关 ADR

| ADR | 关系 |
|-----|-------------|
| ADR-029（RuvSense 多基地） | **加固**：TDM 信标与 CSI 帧认证、NDP 限速、QUIC 传输 |
| ADR-030（持久场模型） | **保护**：相干性门控超时；转移日志有界；手势 DTW 增强（midstreamer-temporal-compare）；漂移检测增强（midstreamer-attractor） |
| ADR-031（RuView RF 模式） | **加固**：认证信标通过 QUIC 流保护跨视点同步 |
| ADR-018（ESP32 实现） | **扩展**：CSI 帧头升级到带 SipHash 标签的 v2；向后兼容的 magic 校验 |
| ADR-012（ESP32 网格） | **加固**：网格密钥管理、NVS 凭据清零、固件状态原子化、QUIC 连接迁移 |

---

## 8. 参考资料

1. Aumasson, J.-P. & Bernstein, D.J.（2012 年）。"SipHash: a fast short-input PRF." INDOCRYPT 2012。
2. Krawczyk, H. 等（1997 年）。"HMAC: Keyed-Hashing for Message Authentication." RFC 2104。
3. ESP-IDF mbedtls SHA256 硬件加速说明。Espressif 官方文档。
4. Espressif。"ESP32-S3 Technical Reference Manual." 第 26 章：SHA 加速器。
5. Turner, J.（2006 年）。"Token Bucket Rate Limiting." RFC 2697（改编）。
6. ADR-029 至 ADR-031（内部文档）。
7. `midstreamer-quic` v0.1.0 -- QUIC 多流支持。crates.io。
8. `midstreamer-scheduler` v0.1.0 -- 超低延迟实时任务调度器。crates.io。
9. `midstreamer-temporal-compare` v0.1.0 -- 时序比较。crates.io。
10. `midstreamer-attractor` v0.1.0 -- 动力系统分析。crates.io。
11. Iyengar, J. & Thomson, M.（2021 年）。"QUIC: A UDP-Based Multiplexed and Secure Transport." RFC 9000。
