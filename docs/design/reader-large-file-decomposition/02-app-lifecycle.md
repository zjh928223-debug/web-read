# R2：将阅读保存生命周期交给应用，解除素材 UI 的隐式依赖

状态：待 R1 独立 PASS。核心阅读及保存按保留处理，可先于第 5 项其余取舍施工；用户如取消核心保存，先重定边界。施工/自检估计 1–2 小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)与[R1](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/01-reader-persistence.md)。

## 1. 结果与消费者

R1只是搬出代码，面板仍决定保存实例是否活着。本轮将唯一实例及 start/stop 归属移动到 App 的阅读会话范围；面板只消费共享接口。未来移除素材 UI 时，不会顺带移除 marks/activity/page close/replay，但本轮不删任何功能。

现行面板仍负责素材加载器、素材UI与素材计时器；保存范围必须能主动取消其注册的未完成加载，再flush/释放。UI 最近阅读项/notice订阅可以卸载，不能成为后台保存必须存在的回调。

## 2. 文件范围

产品：E:/read-web-next-optimization/src/App.vue（script和必要provide接线，不变原可见模板）、src/components/YouTubeWorkflowPanel.vue、R1创建的 src/composables/use-reader-session-persistence.js；新增 src/composables/reader-session-persistence-context.js，提供 module-local injection key 与只读消费接口。

禁止新Pinia store/window发布/单例永久缓存，不改 main.js/runtime-registry、runtime/session薄入口、IndexedDB与outbox服务。现有 loader 只在必须接入取消登记时允许 src/composables/youtube-workflow-loader.js 的小增量，不能改load/rollback行为。

检查范围：R1责任检查、reader-session/load/loader-race/current App装配检查，及有限组件生命周期夹具。共享 inventory/docs仅对应更新。模板中不添可见 wrapper、样式或新按钮。

## 3. 顺序

1. 核对R1 closing，画出应用、面板、加载器、保存范围的创建/挂载/卸载顺序，保存 opening。
2. App 创建唯一保存范围，提供共享 currentJobId/保存状态/操作。面板inject同一实例；注入缺失应显式暴露装配错误，不能偷偷创建第二实例。
3. 将必要加载期与当前会话状态归到保存范围：begin/end/cancel具有明确对称关系，取消后无永久 loading。面板保留素材UI状态。
4. 保存范围提供加载取消登记，根卸载先取消真实loader，再flush并停止监听/服务；面板卸载只注销UI/loader订阅，不停止核心保存。
5. 建立有限 UI订阅：最近阅读/notice不依赖已卸载组件；面板重新挂载能读取当前会话，不重放open/重建保存。
6. 将 start/stop 放在应用范围，说明相对原mounted顺序的变化并验证其行为。需要幂等保护可以复用既有 lifecycle 工具，但不创建通用事件总线。
7. 更新真实装配/行为检查，保留R1数据契约和恢复旅程；验收后交接并停止。

## 4. 固定验收 R2-A1–A6

| 标准 | 必须达到 |
| --- | --- |
| A1 唯一实例 | App与面板共享同一范围，正常启动没有重复tracker/监听/ledger，缺注入不默默降级。 |
| A2 面板离开 | 真实卸载素材面板后，阅读 marks edit/progress/page close 的保存仍执行；重挂面板不重建会话、不重复open。 |
| A3 根关闭 | 根真实卸载先cancel loader再flush，所有监听/计时器/URL服务按既有责任释放，无迟到重新登记。 |
| A4 切换与loading | 读入/取消/失败的begin/end配对，旧job回调不覆盖当前；原loader rollback和mark恢复保持。 |
| A5 保存等价 | R1 marks/activity/outbox/conflict/bfcache原必要旅程继续通过，不改schema/key/revision/idempotency。 |
| A6 无UI回归 | 原可见DOM/入口/布局不变，核心保存不依赖面板DOM；真实应用与有限生命周期夹具均无相关错误。 |

## 5. 必要检查

完整R1 focused+recovery browser，另执行：
- npm.cmd run verify:youtube-workflow-loader
- npm.cmd run verify:youtube-workflow-loader-race
- npm.cmd run verify:reader-session-publisher
- npm.cmd run verify:reader-session-load-browser（先核对并满足 Temp build/data/随机端口隔离）
- node scripts/read-web-interactions-check.cjs，READ_WEB_URL指向本轮fresh隔离构建，READ_WEB_ARTIFACTS_DIR指向Temp，并使用真实现行fixture；不开原默认4173。
- 共同语法/diff/inventory/documentation。

新增必要生命周期场景放在R1已有fixture/runner，不用private函数强制模拟卸载：App存活时点击fixture的面板mount/unmount控制，卸载后触发真实mark编辑/媒体progress，观察save请求；重挂计数不重复；加载中根unmount观察cancel→flush→stop。真实组件和保存代码不stub，API/媒体可合成并标注边界。

为R2做一次 fresh App生产加载与现行阅读交互；不重做ABC主题大矩阵或SRS媒体场景。读取/刷新真实用户服务不属于此检查。

## 6. 交接与回滚

交接列旧/新所有权时序、注入接口、loader取消登记、组件在/不在两种证据及R2-A1–A6。回滚先还原 App和Panel装配，再反向context/runtime增量，保留R1最终正确实现；不重置到原ABC前源码。独立PASS后，再按第5项保留功能启动R3–R8。

