# Read-Web 原位控件换肤预览

这是一个独立的、去业务运行时的对照样稿。它只在本目录内构建和运行，不启动产品 runtime、Pinia、session、Host、AI、localStorage、IndexedDB 或真实素材。构建时只复用产品已经安装的 Tailwind v4/shadcn-vue 配方与 `native-control-styles.js` / `native-input-styles.js` helper；不修改这些共享文件。

## 打开预览

```powershell
node build.mjs
node serve.mjs --port 4318
```

打开 [http://127.0.0.1:4318/](http://127.0.0.1:4318/)。比较开关浮在预览外框右上角，不占用阅读器区域；截图使用 `?mode=original&capture=1` 或 `?mode=restyled&capture=1` 隐藏开关。

## 基线记录

- 目标验收视口：`1280 × 720`。
- 当前源码默认主题：浅色；阅读器为逐句正文路径，跟随为开，倍速为 `1.0x`。
- 保留的原位结构：主题入口、折叠的“过时入口”、右侧“素材处理”、原生 `audio`、相邻的上一句/快捷键/下一句/快捷键、`0.85x / 1.0x / 1.25x`、完整阅读工具栏、SRS 三个入口和无标题正文。
- 本次 live baseline 检查未能取得真实运行截图：优化版前门的记录状态指向已失效的 `5200/8776` listener；`5184` 当前被 `tailscaled.exe` 占用，产品前门拒绝连接。没有启动或触碰日常版/优化版服务。布局依据改用当前 `index.html`、`App.vue`、`TranscriptContainer.vue` 和 reader CSS 交叉核对。
- 两个状态使用完全相同的 DOM 顺序、固定示例正文、控件尺寸和假状态；换肤只覆盖控件表面、边框、圆角、阴影、输入框和选中/禁用/焦点状态。正文字号、行高、宽度、高亮含义和原生播放器均保持不变。

## 视觉验收

| 项目 | 原样 | 换肤 |
| --- | --- | --- |
| 控件表面 | 现有半透明玻璃、轻阴影 | 黑白中性表面、胶囊控件、功能性边框 |
| 按钮状态 | 现有灰色选中态 | 黑底白字选中态、白底黑字普通态 |
| 输入框 | 现有浅色输入框 | 白底、黑边、8px 圆角 |
| 深色 | 现有深色变量 | 语义反转，选中态仍清晰可辨 |
| 正文 | 20px / 1.6、相同固定内容 | 完全相同 |

## 交互边界

比较切换、浅深色切换、倍速、跳句、工具栏切换、输入焦点和禁用态均为本地假状态。按钮不会请求网络、读取文件、连接 Host 或持久化设置。

## 交付文件

- `index.html`：保持当前阅读器容器层级的静态对照页面。
- `preview.css`：导入现有 `src/styles/workflow-ui.css` 的 prefixed recipe，加上共享几何与原样/换肤皮肤层。
- `preview.js`：调用现有 native control/input helper，并提供仅本地展示交互。
- `vite.config.mjs` / `build.mjs` / `serve.mjs`：独立 Tailwind 构建与 loopback 预览服务。
- `dist/`：独立构建产物。
- `screenshots/original-1280.png`：1280×720 原样截图。
- `screenshots/restyled-1280.png`：1280×720 换肤截图。
- `screenshots/restyled-dark-1280.png`：1280×720 换肤深色可辨识度截图。
