## 1. 正式产品边界

- [x] 1.1 增加 focused boundary assertions，覆盖正式 App 无入口、UI service 无默认 runner 与 production build 无 shadow input
- [x] 1.2 从 `src/App.vue` 移除“模型观察”入口、shadow settings import 与 enabled provider
- [x] 1.3 从 `createSrsReviewUiService()` 移除默认 shadow service/report repository construction，仅保留显式 runner 注入

## 2. 构建与实验保留

- [x] 2.1 从 `vite.config.mjs` production inputs 和 clean-room artifact expectations 移除 `personalization-shadow.html`
- [x] 2.2 更新 personalization focused verification，确认独立实验源码仍存在且正式产品边界已生效

## 3. 验证与交付

- [x] 3.1 运行 personalization、SRS V2、Vite/browser 和 production build verification
- [x] 3.2 核对无 IndexedDB/data cleanup，完成 OpenSpec 状态并提交变更
