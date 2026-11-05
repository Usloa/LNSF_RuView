# ADR-270 厂商射频数据源

RuView 提供了一层按能力分级的 Rust 适配层，用来接厂商的感知与射频遥测数据。它绝不会把 RSSI、占用情况、位置或网络设备清单伪装成复杂的 CSI。

## 接口

- `GET /api/v1/rf/vendors` —— 所有数据源的描述信息与接入状态。
- `GET /api/v1/rf/vendors/latest` —— 每个数据源最新一条通过校验的事件。
- `GET /api/v1/rf/vendors/:vendor/latest` —— 指定稳定 ID 的数据源最新事件。
- `POST /api/v1/rf/vendors/:vendor/events` —— 用该数据源严格的解码器接收其文档里约定的旁路/回调数据。这条 `/api/v1/*` 路由在配置了令牌时走服务器的 bearer-token 策略。

稳定 ID 有：`origin_ai`、`plume`、`mist`、`netgear`、`electric_imp`、`rf_solutions`、`linksys`、`luma`、`google_nest`、`wifigarden`。

## 确定性模拟器

```bash
cd v2
cargo run -p wifi-densepose-hardware --bin vendor-rf-sim -- \
  --vendor plume --frames 100 --output plume.jsonl

# 把规范的合成事件流推送到感知服务器的 UDP 端口。
cargo run -p wifi-densepose-hardware --bin vendor-rf-sim -- \
  --vendor mist --frames 100 --udp 127.0.0.1:5005 --realtime
```

模拟器支持的名字有 `origin-ai`、`plume`、`mist`、`netgear`、`electric-imp`、`rf-solutions`、`luma`、`google-nest`。Linksys 会被拒绝，因为它的感知服务已停运；Wifigarden 在有正式签约的事件格式之前也会被拒绝。

每条合成事件都带 `synthetic: true`、确定性的序号与时间戳，来源名以 `-sim-01` 结尾。

规范的 UDP JSON 只有在 `synthetic: true` 时才会被接受。真实厂商数据必须走 HTTP 接收接口，这样各厂商的格式、指标白名单、接入状态和取值范围才不会被绕过。

## 真实 / 厂商数据

厂商解码器严格、有边界，会拒绝格式里未知的字段。Origin 的路径和凭据来自商务合同。Plume 使用只读、白名单化的 OVSDB 请求方案。Mist 和 NETGEAR 的配置走分区域的 HTTPS 端点，令牌做了脱敏。Electric Imp、RF Solutions 和 Luma 只接受白名单里的标量指标。Google Nest 仍然只提供网络侧信息。

凭据绝不写进测试夹具或描述信息里。Linksys 返回 `Unsupported`，Wifigarden 返回 `ContractRequired`。这些是有测试覆盖、真实可用的数据源返回结果，不是模拟出来的集成。

## 硬件如实标注

在核实具体的硬件/云版本、合法接入方式、可复现的采集过程、必要的校准以及夹具发布授权之前，所有描述信息都保持 `hardware_validated: false`。通过模拟器和接口测试，只证明 RuView 软件本身没问题。
