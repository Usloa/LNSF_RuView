# RuView README 视觉体系

README 的配图沿用 RuView 页头的配色：深藏青底、电蓝色射频场、青柠色的姿态与信号高亮、暖琥珀色关节、柔和白字，再叠上等距分层几何、移动扫描面、雷达扫掠、可动姿态肢体、呼吸曲线和分开的硬件层。每张特性卡片都用自己的插画，不重复同一个线框立方体。整套素材包含一张主视觉、六张特性卡片、六个导航图标、一张总览图、五个章节标题和一条 Cognitum 落地页横幅。标题使用更粗的 Avenir Next / Segoe UI Variable Display / Segoe UI / Helvetica 字体栈，字距更紧；标签另配一套系统等宽字体栈。字体都保留本地回退，所以断网时图片也能正常显示。

## 重新生成与检查

```bash
python3 -m pip install -r scripts/requirements-readme-visuals.txt
python3 scripts/render-readme-visuals.py
python3 scripts/verify-readme-visuals.py
python3 -m unittest discover -s scripts/tests -p test_readme_visuals_xml.py
```

建议在虚拟环境里安装这些工具依赖。生成器和校验器用 `defusedxml` 来拒绝 DTD、实体和外部 XML 引用。SVG 输入必须小于 20,000 字节；校验器最多只读这个上限，超限的输入在解析前就会被拒。两个工具都用 UTF-8，生成文件统一用 LF 换行，保证不同平台上结果可复现，而且全程不联网。这个依赖只用于维护配图，运行时不需要。清单里的路径必须是相对路径：SVG 放在 `assets/readme` 内，本地链接目标在解析符号链接之后仍须落在仓库内。

提交进仓库的 SVG 就是最终发布的素材，`assets/readme/manifest.json` 列出了每个目标位置。空间感插画统一用 `-spatial-v4.svg` 文件名，这样视觉升级后 GitHub 的图片代理会去取新内容。旧文件名仍然保留，已有链接不会断；README 新增的包装元素使用带版本号的新素材。

## 链接与渲染

GitHub 把 SVG 当图片渲染，所以图片内部的链接不生效。每张 SVG 在 README 里都由外层的 Markdown 或 HTML 链接包着。每张卡片和每个导航图标另外配一个纯文字链接，方便窄屏和辅助技术使用。原有标题保持不变，因此 README 里已有的锚点依然可用。

动画只用 CSS。纵深感直接画进 SVG 几何里，不依赖 WebGL 画布或 CSS 透视。位移作用在内层 group 上，不会覆盖外层图标的位置。投影轨道面固定不动，虚线信号沿轨道移动；扫描面扫过线框体。每张图里没用到的动画规则都会删掉，让整套启用中的 SVG 总量保持在 100 KB 以内。所有文案和关键几何在没有动画、JavaScript、远程字体和远程图片的情况下也都看得见。`prefers-reduced-motion` 会关掉装饰性动效。顶部原有的 GIF 保留，已有的 ruOS 推广链接也保留，原有素材尺寸和 README 链接都不变。

## 内容边界

总览图和射频房间只是概念插画，不是实时测量值，也不是基准测试证据。特性卡片链接到当前有效的技术文档。姿态研究明确标注为研究性质，信号卡片引导读者去看硬件验证。这里不引入任何新的速度、精度、医疗或设备支持声明。

参考来源：`docs/user-guide.md`、`docs/benchmarks/pose-estimation-cog.md`、`v2/crates/wifi-densepose-signal/README.md`、`firmware/esp32-csi-node/README.md`、`docs/integrations/home-assistant.md`、`harness/ruview/README.md`。

主视觉和姿态卡片用的是 `-spatial-v6.svg`：一幅原创的人体解剖剪影，带明暗过渡的躯干、头部、手和脚，肢体互相重叠，有表面轮廓线和琥珀色关节标记。1.6 秒的步态循环驱动对侧手脚摆动、重心转移和地面阴影压缩；8 秒的 CSS 透视旋转加上移动的表面光，让这幅解剖插画有立体感。每条肢体都绕自己的肩或髋转动。效果仍然是投影式的 SVG 插画，不是蒙皮 WebGL 模型。样式表会在减少动效偏好下关掉步态和透视运动。Chrome 154 上验证过 3D 变换、对侧肢体变换、HTML 图片里的动画，以及独立 SVG 在减少动效下的静止状态。那次测试里，模拟减少动效并没有让内嵌图片静止——图片偏好能否传递取决于浏览器，这仍是已知限制。这是矢量美术作品，不是真实人体扫描，也不是测得出来的姿态重建。其余素材仍沿用 v4 文件名。
