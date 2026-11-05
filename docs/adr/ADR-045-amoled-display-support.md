# ADR-045：ESP32-S3 CSI 节点的 AMOLED 显示支持

## 状态

Proposed

## 背景

ESP32-S3 开发板（LilyGO T-Display-S3 AMOLED）集成了一块 RM67162 QSPI AMOLED 显示屏（536x240）与 8MB octal PSRAM，此前未被 CSI 固件使用。用户希望在不依赖外部服务器的情况下，在设备端实时可视化 CSI 统计、生命体征与系统健康状态。

### 约束条件

- 二进制在 1 MB 分区中为 947 KB —— 需要 8MB flash + 自定义分区表
- 尽管硬件具备 8MB PSRAM，sdkconfig 中 SPIRAM 仍被禁用
- Core 1 固定给 DSP（边缘处理）—— 显示必须使用 Core 0
- 现有的 CSI 流水线不得受影响

### 可用 API

线程安全的边缘 API 已经存在（`edge_get_vitals()`、`edge_get_multi_person()`）—— 显示任务只从中读取，无需新的同步机制。

## 决策

新增可选的 AMOLED 显示支持，采用如下架构：

### 硬件抽象层

- `display_hal.c/h`：RM67162 QSPI 面板驱动 + 经 I2C 的 CST816S 电容触摸
- 启动时自动探测：探测 RM67162 并检查 SPIRAM；若缺失则记录警告并跳过

### UI 层

- `display_ui.c/h`：LVGL 8.3，通过 tileview 控件提供 4 个可滑动视图
- 深色主题（#0a0a0f），以青色（#00d4ff）作为强调色，营造类似 three.js 的美感
- 视图：Dashboard（CSI 振幅图 + 统计）、Vitals（呼吸 + 心率折线图）、Presence（4x4 占用网格）、System（CPU、heap、PSRAM、WiFi、uptime、FPS）

### 任务层

- `display_task.c/h`：运行于 Core 0 的 FreeRTOS 任务，优先级 1（最低）
- LVGL 泵循环以可配置 FPS（默认 30）运行
- 双缓冲绘制缓冲在 SPIRAM 中分配

### 编译期控制

- `CONFIG_DISPLAY_ENABLE=y`（默认）：编译显示代码，启动时自动探测硬件
- `CONFIG_DISPLAY_ENABLE=n`：零成本 —— 不编译任何显示代码
- `CONFIG_SPIRAM_IGNORE_NOTFOUND=y`：在没有 PSRAM 的板子上也能正常启动

### Flash 布局

8MB 分区表（`partitions_display.csv`）：
- 双 OTA 分区：2 × 2MB（配合 LVGL 支持更大的二进制）
- SPIFFS：1.9MB（用于未来的字体/资源存储）
- NVS + otadata + phy：标准大小

### 核心/任务布局

| 任务 | 核心 | 优先级 | 影响 |
|------|------|----------|--------|
| WiFi/LwIP | 0 | 18-23 | 不变 |
| OTA httpd | 0 | 5 | 不变 |
| **display_task** | **0** | **1** | **新增 —— 最低优先级** |
| edge_task（DSP） | 1 | 5 | 不变 |

### 依赖

- LVGL ~8.3（通过 ESP-IDF 托管组件）
- `espressif/esp_lcd_touch_cst816s` ^1.0（ESP-IDF 托管组件）
- `espressif/esp_lcd_touch` ^1.0（ESP-IDF 托管组件）

## 后果

### 正面

- 实时设备端统计，无需依赖网络
- 对 CSI 流水线零影响（显示读取线程安全 API，以最低优先级运行）
- 优雅降级：在没有显示或 PSRAM 的板子上也能工作
- 所有板子都启用 SPIRAM（也使 WASM 运行时受益）
- 8MB flash + 双 OTA 2MB 分区为未来功能留出余量

### 负面

- 二进制体积增大（含 LVGL 约 200-300 KB）
- SPIRAM + 8MB flash 配置仅针对 T-Display-S3 AMOLED 板子
- 仅有 4MB flash 的板子需要 `CONFIG_DISPLAY_ENABLE=n` 及旧分区表

### 风险

- RM67162 初始化序列因板而异；其它 AMOLED 面板可能需要不同的命令
- 若其它外设使用 SPI2_HOST（当前未用），可能发生 QSPI 总线冲突

## 新增文件

| 文件 | 用途 |
|------|---------|
| `main/display_hal.c/h` | RM67162 QSPI + CST816S 触摸 HAL |
| `main/display_ui.c/h` | LVGL 4 视图 UI |
| `main/display_task.c/h` | FreeRTOS 任务，LVGL 泵循环 |
| `main/lv_conf.h` | LVGL 编译配置 |
| `partitions_display.csv` | 8MB 分区表 |
| `idf_component.yml` | 托管组件依赖 |

## 修改文件

| 文件 | 改动 |
|------|--------|
| `sdkconfig.defaults` | 8MB flash、SPIRAM、自定义分区 |
| `main/CMakeLists.txt` | 条件式显示源码 + 依赖 |
| `main/main.c` | +1 处 include、+5 行受保护的初始化 |
| `main/Kconfig.projbuild` | 「AMOLED Display」菜单 |
