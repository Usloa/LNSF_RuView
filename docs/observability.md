# 可观测性：导出 OTLP 日志

感知服务器可以把每一条 `tracing` 日志事件按 OTLP 协议导出为 OpenTelemetry 日志记录。其中精选了一批感知事件（在场状态变化、生命体征估计、节点上/下线、跌倒检测、CSI 采集统计、MQTT 错误、模型加载），事件名和属性都由注册表统一管理，统一放在 `ruview.*` 命名空间下。

## 事件注册表

这些名字不是随手起的，而是在 `semconv/registry/` 下由 weaver 校验过的语义约定注册表里定义的（包含属性和日志事件名，采用 OpenTelemetry 注册表格式）。Rust 常量模块 `v2/crates/wifi-densepose-sensing-server/src/semconv.rs` 是从该注册表**自动生成**的（`weaver registry generate`，模板在 `templates/registry/rust/`）。CI（`.github/workflows/semconv.yml`）会在注册表校验失败、或生成模块与注册表不一致时直接失败。运行 Rust 测试时，任何写死但不在生成注册表里的 `ruview.*` 埋点键也会被拒绝。导出的资源会带上注册表的 schema URL，方便下游确认具体用的是哪一版约定。

精选事件：

| 事件 | 触发时机 |
| --- | --- |
| `ruview.node.online` | 感知节点发来第一帧数据（CSI 或边缘生命体征） |
| `ruview.node.offline` | 节点连续 60 秒无数据后被移除 |
| `ruview.presence.changed` | 平滑后的在场分类发生翻转（只在变化时发） |
| `ruview.vitals.estimate` | 周期性的呼吸 / 心率估计（每 100 个 tick） |
| `ruview.fall.detected` | 边缘生命体征的跌倒标志出现上升沿，按节点分别发 |
| `ruview.csi.stats` | 周期性的采集快照：已处理帧数、活跃节点数 |
| `ruview.mqtt.error` | HA 发布器里的 MQTT 发布/连接错误 |
| `ruview.model.loaded` | 通过模型 API 加载了推理模型 |

## 开启导出

导出有两道开关，因此默认构建和默认运行都不受影响：

1. **构建**时启用 `otel` cargo feature（把 OTLP 导出组件一起编进去，开关思路和 `mqtt` 一样）：

   ```sh
   cargo build --release -p wifi-densepose-sensing-server --features mqtt,otel
   ```

2. **运行**时设置 `OTEL_EXPORTER_OTLP_ENDPOINT`（不设置 ⇒ 根本不构造 OTLP 流水线，日志行为与以前完全一样）：

   ```sh
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
   ./target/release/sensing-server --source simulated
   ```

在不受信任的本地网络之外，请使用 `https://` 的采集器地址。`otel` feature 已包含 Rustls 和原生证书根；标准的 OTLP 环境变量可以用来传认证头。Compose 示例里只在私有网络的容器之间用了明文。

日志导出时带资源属性 `service.name = "ruview"`，schema URL 为 `https://raw.githubusercontent.com/ruvnet/RuView/main/semconv/schema/ruview-0.1.0.yaml`。精选感知事件只会在导出器成功初始化之后才发出；没有导出器时，原有的 stderr 输出保持不变。

## 完整链路：`docker compose`

`docker/otel-compose.yml` 会一次拉起整条链路——感知服务器（默认用合成 CSI）→ OpenTelemetry Collector → [Ourios](https://github.com/jensholdgaard/ourios)（一个原生支持 OTLP 的日志后端，基于 Parquet + 在线日志模板挖掘 + DataFusion）：

```sh
docker compose -f docker/otel-compose.yml up
```

采集器和后端的镜像标签都固定到了不可变的多平台 digest，保证演示用的是经过评审的镜像。

Ourios 按 `service.name` 推导租户，所以所有 RuView 日志都会落到 `ruview` 这个租户下。

## 查询示例

Ourios 在数据接入时就把每一行日志在线归纳成稳定的 `template_id`，因此按模板维度做查询很便宜。它的查询接口支持一种小型日志 DSL：

哪些日志模板在 RuView 的输出里占比最高？

```sh
curl -s http://localhost:4319/v1/query \
  -H 'X-Ourios-Tenant: ruview' \
  -H 'Content-Type: text/plain' \
  -d 'severity >= trace | range(-1h, now) | count by template_id | sort count desc | limit 10'
```

最近的告警和错误（跌倒检测、MQTT 失败）：

```sh
curl -s http://localhost:4319/v1/query \
  -H 'X-Ourios-Tenant: ruview' \
  -H 'Content-Type: text/plain' \
  -d 'severity >= warn | limit 50'
```

某次部署改变了服务打印的日志吗？比较两个时间窗之间的模板漂移（新增 / 消失 / 变化的模板）：

```sh
curl -s http://localhost:4319/v1/query \
  -H 'X-Ourios-Tenant: ruview' \
  -H 'Content-Type: text/plain' \
  -d 'drift from -7d to now'
```
