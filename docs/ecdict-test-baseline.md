# ECDICT 第一阶段测试前后对比

## 开发前基线

2026-07-24 在现有未提交工作树上执行 `npm test`：

- Vite load check：通过
- playback check：通过
- interaction check：通过

## 模块验证

- `npm run dictionary:test`：10 项通过
- `npm run build`：通过
- 官方基础数据构建：770,611 词条、102,867 lemma 映射，完整性检查通过
- 独立 CLI：`looked`、`better`、`run into` 实库查询通过

## 开发后回归

2026-07-24 再次执行 `npm test`，与基线相同：

- Vite load check：通过
- playback check：通过
- interaction check：通过

另逐项执行 package 中全部 98 个 `verify:*` 脚本：

- 83 项通过（含需要临时 5173 服务的 4 项浏览器行为验证、production preview、
  `verify:read26` 和 `verify:vite`）；
- 15 项失败。

15 项失败均为 ECDICT 范围外的现有兼容守卫不一致，断言指向 notes、session
startup、runtime state、reader facade、legacy DOM、audio identity 和 theme
control 等现有文件；ECDICT 没有修改或导入这些文件。由于开发前只记录了项目正式
基线 `npm test`，不能把这 15 项追加专项检查声称为“开发前已执行失败”；这里如实
记录最终现状。失败项为：

```text
verify:state-facades
verify:inline-handler-bindings
verify:session-annotation-import-normalization
verify:session-startup-cleanup
verify:session-startup-runtime
verify:session-ui-settings-restore
verify:runtime-state-source
verify:runtime-state-facade
verify:reader-runtime-shell
verify:reader-session-runtime
verify:reader-public-facades
verify:ui-facades
verify:legacy-dom-drain
verify:audio-identity-module
verify:theme-controls-module
```

本任务没有越界修复这些既有改动。正式基线命令 `npm test` 前后均为全绿，ECDICT
模块测试与生产构建也为全绿。
