# ADR-295：源溯源状态机 —— 合成数据绝不会以“实时”形式呈现

- **状态**：Accepted — initial implementation (this PR)
- **日期**：2026-08-11
- **决策者**：ruv
- **标签**：provenance（溯源）、honesty（诚实）、ui（界面）、sensing-server（感知服务器）、security（安全）

## 背景

2026 年 8 月的一次外部审查在发布路径上
发现了两处溯源缺陷：

1. 位姿融合模拟器以演示模式启动；在任何非 3000 的页面端口上，
   3000 WebSocket 目标会回退到 `localhost:8765`；若
   连接失败，模拟器仍持续运行，而状态仍显示
   “ready”——从而生成一段看似可信的运动可视化，却没有实时 CSI
   （该缺陷登记于 issue 1557）。
2. 主感知客户端在已认证的状态端点因缺少授权而返回错误时，会
   把来源标记为 **live**，直到某一帧真实数据碰巧将其纠正
   （该问题登记于 issue 1526）。

共同的根本原因：来源状态是一个布尔值（live 与非 live），于是“unknown”
就坍缩为“live”。CLAUDE.md 要求对输出做 MEASURED/CLAIMED/SYNTHETIC 标注，
并禁止把合成输出当作真实数据呈现。

## 决策

定义单一的、互斥的 `SourceState` 枚举，由
感知服务器与所有渲染来源的 UI/客户端共享：

- `Synthetic` —— 生成的数据（对合成夹具的模拟器/回放）。
- `LiveVerified` —— 来自已认证、已鉴权的来源帧。
- `LiveUnverified` —— 已到达但溯源尚未确认的帧。
- `Stale` —— 最后一帧早于配置的新鲜度窗口。
- `Disconnected` —— 无来源。

以结构方式强制执行的规则：

- **`Unknown` 不是一个状态。** 任何模糊条件都解析为
  `LiveUnverified`、`Stale` 或 `Disconnected` —— 绝不会是 `LiveVerified`。
- 状态端点错误解析为 `Disconnected`/`LiveUnverified`，绝不会
  是 live-verified。
- 模拟器构造 `Synthetic`，且无法转换到任何 `Live*` 
  状态，除非有经过验证的帧。
- `Synthetic` 在每个视图与每次导出中都被打上水印。
- 转换是（帧龄、认证状态、
  来源种类）的纯函数，因此无需时钟或套接字即可做单元测试。

本 PR 的范围：共享的 `SourceState` 类型 + 转换函数 + 测试
位于感知服务器中，以及对两个已识别表面（位姿融合
模拟器状态、感知客户端来源标签）的接线。更广泛的 UI 采用后续推进。

## 后果

- 关闭了“合成显示为 live”和“unknown 显示为 live”两类问题。
- 对任何当前读取布尔来源
  标志的消费者而言是一次小的破坏性变更；通过在迁移期暴露兼容访问器来缓解。

## 验证

- 为每次转换编写单元测试，尤其是：auth-error → 非 live；
  模拟器 → 没有验证帧就绝不为 live；新鲜度过期 → `Stale`；
  合成导出上带有水印。
- 运行：`cargo test -p wifi-densepose-sensing-server`。
