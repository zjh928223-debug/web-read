## 1. 契约与失败优先测试

- [x] 1.1 覆盖 optional client disabled、exact、normalized、lemma 和完整短语
- [x] 1.2 覆盖 failure、unavailable、竞态、卸载和会话缓存
- [x] 1.3 增加零持久化与禁止 infrastructure import 的边界守卫

## 2. Browser client 组装

- [x] 2.1 新增共享 optional local dictionary client helper
- [x] 2.2 替换 reader app runtime 中重复开关判断
- [x] 2.3 从 overlay 与 standalone 入口注入可选 client

## 3. SRS review assistance

- [x] 3.1 实现瞬时 controller、成功缓存、失败重试和 request id 竞态保护
- [x] 3.2 在卡片变化时查询完整词头/短语并在卸载时停止更新
- [x] 3.3 在答案揭示后的现有释义之后展示 ECDICT 或弱提示
- [x] 3.4 复用 formatter 并增加最小局部样式

## 4. 验证与文档

- [x] 4.1 运行 ECDICT、preview、reader runtime、vocabulary SRS、review、build 和 npm test
- [x] 4.2 使用真实数据库执行 endpoint smoke 与人工词形/短语/故障验证
- [x] 4.3 更新模块和架构文档，记录启用方法与零持久化边界
- [x] 4.4 strict validate、同步主 spec 并只归档本 change
