# Read 阅读器 Uber Inspired 样式预览

> 此样稿的重新排版方向已被用户否定，保留为历史产物，不再作为产品或下一版预览的布局依据。修正后的任务见 [原位换肤任务书](../reader-uber-inplace-preview-brief.md)。构建和交互自查通过不代表视觉方向被接受。

这是一个完全独立的 Vue/Vite 视觉样稿，只用于复审控件、工具栏、正文和设置小弹窗的组合效果。它不导入 reader/session runtime，不连接 Host、真实阅读数据、localStorage、IndexedDB 或外部服务。

## 本地打开

在项目根目录执行：

```powershell
node docs/design/reader-uber-preview/build.mjs
npx vite --config docs/design/reader-uber-preview/vite.config.mjs
```

然后打开 [http://127.0.0.1:9413/](http://127.0.0.1:9413/)。如果只需要重新查看已经生成的文件，也可以直接打开 `docs/design/reader-uber-preview/preview.html`。

## 已交付文件

- `index.html`、`main.js`、`App.vue`、`styles.css`：独立样稿入口、Vue 交互和局部主题样式。
- `vite.config.mjs`、`build.mjs`：只作用于本目录的 Vite/Tailwind v4 构建配置与 standalone HTML 打包脚本。
- `preview.html`：构建生成的可直接打开版本。
- `screenshots/`：`reader-uber-light-1280.png`、`reader-uber-dark-1280.png`（1280×720），`reader-uber-light-390.png`、`reader-uber-settings-390.png`（390×844）。

## 可复核交互

- 播放按钮只切换播放/暂停图标与文字；上一句/下一句切换当前句，边界按钮会进入禁用态。
- 倍速、跟随、AI 切分、中文、聚焦只更新本地内存状态；AI 切分是预先写好的示例分块。
- 右上角可切换浅色/深色；深色主操作与选中态反转为白底黑字。
- 设置弹窗支持编辑完整的 `ArrowLeft` / `ArrowRight`，Escape 和关闭按钮会关闭并把焦点还给设置按钮；“应用到预览”只更新当前页面会话。

## 已知限制

这是局部阅读页而不是完整产品：没有真实音频、快捷键注册、素材管理、持久化、AI 请求、Host 通信或产品运行时行为。截图和样式只代表本次独立样稿，不构成产品迁移授权。
