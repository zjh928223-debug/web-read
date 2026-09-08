# R-004 / G-0 gate report

日期：2026-09-08
变更：`enable-mac-frontend-windows-backend`
范围：只检查原始 E-004 要求，并在 R-004 PASS 后执行 G-0。

## R-004 acceptance criteria

1. 清单覆盖一名用户、一台 Windows 和一台 Mac 的真实使用路径：health、owner
   query、本地 capability、外部 capability、workflow polling、audio/video Range、
   seek 与媒体切换、Windows restart、Mac reconnect。
2. 清单保持 optimization profile、5184 稳定前门、8776 sidecar、内部服务 loopback、
   优化数据根和 production/remote-dev 边界。
3. `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN` 语义和模板状态清楚；结构检查不得把未执行的
   骨架或 focused check 宣称为真实跨机通过。
4. HA、压力/性能实验室、多用户并发、企业审计、复杂威胁建模以及其他非 E-004 要求
   不得成为隐含前置条件。

## R-004 result

**PASS**。清单明确列出九条 journey，并为每条提供前置条件、操作、HTTP/contract/
owner/media 预期、失败分类、重试/回滚和证据位置。它明确说明模板全为 `NOT_RUN`，
没有 Windows/Mac 实测证据不得推导 `PASS`，并明确拒绝公网、HA、压力实验室、多用户、
企业审计和复杂威胁建模等范围外要求。

当前 375 行校验器的边界符合 E-004：

- 默认成功输出明确是 scaffold；`--evidence` 输出明确是 evidence structure，且写明
  live behavior 仍需独立 review；不会启动服务或网络。
- 模板必须保持 `NOT_RUN` 且无证据引用。
- 真实 manifest 必须是 `RECORDED`，其 run 元数据和 front-door origin 不能是占位值。
- `PASS` 必须引用实际存在、非空、根目录内、非占位且可选 checksum 匹配的文件，并且
  至少包含该 journey 允许的非 `manual-note` 证据类型。
- 校验器只检查结构、状态、路径、文件存在性、非空和 checksum；不解析日志语义，也不
  用静态 fixture 证明 Windows restart、Mac reconnect、Range/seek 或 owner durability。

因此没有原始 E-004 范围内的 finding，也不启动 F-004。范围外问题按明确的非目标拒绝，
不转化为新的验收要求。

R-001 至 R-003 作为本阶段既有前置 PASS 使用；本次没有重新打开或扩展它们的审核范围。

## G-0 result

**PASS**。在 R-004 PASS 后完成以下集成 gate：

| Check | Result |
| --- | --- |
| `npm run verify:windows-cross-machine-acceptance` | PASS；只验证 E-004 scaffold 和 evidence-reference 边界，未启动 live service/network |
| `npm run verify:windows-owner-contract` | PASS |
| `openspec validate --strict --no-interactive --type change enable-mac-frontend-windows-backend` | PASS |
| `git diff --check` | PASS |

下一阶段唯一 `PHASE_BASE`：本报告所属的 G-0 集成提交；以最终 git 提交哈希为准。
后续任务不得把 E-004 scaffold 结果当作真实跨机验收结果。
