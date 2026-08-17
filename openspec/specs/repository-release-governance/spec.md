# repository-release-governance Specification

## Purpose
TBD - created by archiving change stabilize-and-simplify-read-web. Update Purpose after archive.
## Requirements
### Requirement: Node 工具链必须可复现
仓库 MUST 固定受支持的 Node 版本范围、实际使用的 Node LTS 版本、npm 版本与 `packageManager`，并提交唯一的 lockfile。自动化和 release 构建 MUST 使用 `npm ci` 从干净目录安装，禁止用 `npm install` 隐式改写 lockfile；lockfile 变更 MUST 与 `package.json` 变更一同评审。

#### Scenario: clean-room Node 安装
- **WHEN** 在没有 `node_modules` 和 npm cache 的干净环境中检出任一 release candidate
- **THEN** 声明的 Node/npm 组合 MUST 能通过 `npm ci` 得到与 lockfile 一致的依赖树，且 Git 工作树保持干净

#### Scenario: 不受支持的 Node 版本提前失败
- **WHEN** 开发者或 CI 使用仓库声明范围之外的 Node 版本
- **THEN** 安装或预检 MUST 在执行构建前给出明确错误，不得继续生成不可比较的产物

### Requirement: Python 与外部二进制工具链必须完整锁定
仓库 MUST 声明并锁定 production host 与 Material Workflow 所需的全部 Python 包，包括传递依赖的可复现版本或 hash；同时 MUST 声明 Python 版本以及 `ffmpeg`、`yt-dlp`、`whisperx` 等外部二进制的版本、来源和校验方式。运行时配置 MUST 通过 CLI、environment 或配置文件解析路径，不得把个人用户目录或特定盘符作为代码默认值。

#### Scenario: 全新 Python 环境可启动
- **WHEN** 在声明的 Python 版本上创建空虚拟环境并按锁文件安装
- **THEN** 后端单元测试、import smoke test、health check 与受控外部工具诊断 MUST 全部通过，无需依赖机器上未声明的全局包

#### Scenario: 外部工具版本不兼容
- **WHEN** 启动检查发现外部二进制缺失、hash 不匹配或版本不在支持矩阵
- **THEN** production host MUST 拒绝启动相关能力并报告 typed configuration error，不得在任务处理中途才以模糊子进程错误失败

### Requirement: CI 必须提供分层且不可绕过的质量门
仓库 MUST 定义 `verify:fast`、`verify:full` 和 `verify:release` 三层稳定入口。`verify:fast` MUST 覆盖格式、静态检查和纯逻辑测试；`verify:full` MUST 增加前端关键旅程、production host、Python 测试、存储故障注入和资源生命周期测试；`verify:release` MUST 增加 clean-room 构建、性能预算、安全/秘密/许可证扫描、备份恢复和 rollback drill。受保护分支合并与 release MUST 依赖相应门全部通过。

#### Scenario: pull request 执行确定的门
- **WHEN** pull request 修改 runtime、持久化、后端、依赖或启动配置
- **THEN** CI MUST 在固定 Windows runner 和锁定工具链上执行 `verify:fast` 与受影响的 `verify:full` 项，并保留机器可读结果

#### Scenario: release candidate 不能跳过完整门
- **WHEN** 创建 release candidate
- **THEN** `verify:release` MUST 从干净检出开始全部通过，任何失败、跳过或 flaky retry 超限 MUST 阻止发布

### Requirement: 测试入口必须有明确所有权与覆盖清单
每个可执行测试或验证脚本 MUST 被某个受支持的 npm/Python 入口或明确的 archived tooling 清单拥有。仓库 MUST 维护“关键行为 → 测试 → CI 层级”的映射；默认 `npm test` 不得只执行页面加载而遗漏持久化、后端和主要学习旅程。仅检查源码字符串或文件形状的测试不得作为关键行为的唯一 release 证据。

#### Scenario: 新验证脚本不会成为孤儿
- **WHEN** 变更新增测试脚本
- **THEN** CI MUST 验证该脚本被 `verify:fast`、`verify:full` 或 `verify:release` 引用，否则变更失败

#### Scenario: 删除脚本前验证覆盖迁移
- **WHEN** 清理旧检查脚本
- **THEN** 变更 MUST 指明其行为已由哪个测试替代或为何属于失效历史，且 release coverage 清单不得留下空缺

### Requirement: 仓库必须保持可审计的卫生状态
仓库 MUST 通过 `.gitignore`、`.gitattributes`、`.editorconfig` 和自动检查统一管理生成物、local config、secret 文件、缓存、媒体、数据库、编码与行尾。已被 ignore 的生成物和个人设置不得继续被跟踪；死代码、legacy root artifact、原型资产和孤儿脚本只有在引用证明、数据兼容性检查和替代测试完成后才能删除或归档。任何 release candidate MUST 从 clean Git status 构建。

#### Scenario: 生成物不会进入提交
- **WHEN** 开发者执行构建、测试、Python import 或启动本地服务
- **THEN** `dist`、cache、bytecode、日志、媒体、数据库、credential 与机器专用配置 MUST 保持未跟踪且不会污染 release diff

#### Scenario: 退役 artifact 经过 deletion gate
- **WHEN** 准备删除被标记为 legacy、no-op 或无引用的文件
- **THEN** deletion gate MUST 证明没有 runtime/测试/文档入口依赖它、兼容迁移已完成并且替代行为测试通过

#### Scenario: 文本编码跨平台稳定
- **WHEN** 同一提交在 Windows 与 CI 环境检出和格式化
- **THEN** 行尾与 UTF-8/BOM 策略 MUST 产生相同语义内容和干净工作树，不得产生整文件噪声 diff

### Requirement: Secret 与本地高敏配置不得进入仓库或产物
仓库 MUST 提供可提交的无 secret 配置模板，并在 pre-commit、CI 和 release artifact 三个阶段执行 secret scan。扫描 MUST 覆盖 Git 跟踪内容、历史增量、构建产物和日志样本；发现高置信 credential、private key、cookie 或带认证 URL 时 MUST 阻止合并和发布，并执行轮换流程。

#### Scenario: 提交包含 credential
- **WHEN** staged diff 或 CI 增量中匹配高置信 secret
- **THEN** 检查 MUST 失败、标出文件位置但不得回显完整 secret，并要求移除和轮换后才能继续

#### Scenario: 构建产物意外包含环境密钥
- **WHEN** release artifact 扫描发现 server-only environment 值出现在 JavaScript、HTML、source map 或日志中
- **THEN** release MUST 被阻止且该 credential MUST 被视为已泄漏

### Requirement: 第三方依赖、内容与许可证必须可追溯
仓库 MUST 维护 Node、Python、外部二进制、字体、图片、词典、例句、品牌资源和网络内容来源的供应链清单，并为每次 release 生成 SBOM、许可证报告和 `THIRD_PARTY_NOTICES`。无法确认来源、再分发许可、隐私影响或完整性的资产 MUST 不得进入 release artifact。

#### Scenario: release 生成供应链证据
- **WHEN** `verify:release` 构建候选产物
- **THEN** 系统 MUST 生成与 lockfile 和 artifact hash 对应的 SBOM、许可证报告及第三方 notice，并对禁止或未知许可证失败关闭

#### Scenario: 外部页面资源不可用
- **WHEN** production host 在离线或第三方 CDN 不可用环境启动
- **THEN** 核心阅读、播放、复习和本地素材能力 MUST 仍可运行，非核心外部资源 MUST 明确降级且不得阻塞首屏

### Requirement: Release Manifest 必须唯一标识可运行系统
每个 release artifact MUST 附带不可变 Release Manifest，至少记录 Git SHA、前端版本、production host 版本、后端版本、数据 schema/envelope 版本、Node/Python/npm 版本、依赖锁摘要、外部工具支持矩阵、构建时间、artifact hash、配置 schema 和兼容的迁移/回滚范围。运行时 health/diagnostics MUST 能安全返回 manifest identity，但不得返回 secret。

#### Scenario: 运行实例可追溯到构建输入
- **WHEN** 操作者读取 production host health 或诊断信息
- **THEN** 返回的 release identity MUST 能唯一映射到已保存的 Release Manifest 与 artifact hash

#### Scenario: 前后端版本不兼容
- **WHEN** production host、静态资源或 workflow 后端的 manifest compatibility 不匹配
- **THEN** 启动检查 MUST 阻止不兼容组合并保留当前可运行版本，不得以部分功能状态继续

### Requirement: 发布切换必须原子化并保持隔离
在所有 release gates 通过前，系统 MUST 不得修改 `E:\read-web`、5173/8765、桌面快捷方式或真实学习数据。批准迁移时，发布流程 MUST 先安装到版本化目录、验证 hash 和 isolated health，再以单一原子步骤切换 active manifest 或快捷方式；不得在活动目录上原地覆盖文件。

#### Scenario: 候选版本验证失败
- **WHEN** 新版本在 5174/8766、独立数据目录或独立浏览器 profile 的 health、关键旅程或 hash 验证失败
- **THEN** 发布流程 MUST 停止，当前日用版本、端口、快捷方式和真实数据保持不变

#### Scenario: 原子激活成功
- **WHEN** 用户批准且全部 release gates 通过
- **THEN** 发布流程 MUST 记录 previous 与 next manifest、完成一次原子 active target 切换，并立即执行日用端口的 post-switch smoke test

### Requirement: 数据迁移必须支持 dry-run、备份、验证和幂等重试
任何会改变 IndexedDB、workflow state、JSON 文件或外部数据目录的发布 MUST 提供版本化迁移计划、只读 dry-run、迁移前全量备份、完整性校验和幂等重试。未经用户明确批准，迁移不得接触真实数据；备份 MUST 与 Release Manifest 关联并经过实际恢复验证。

#### Scenario: dry-run 发现不兼容数据
- **WHEN** 迁移 dry-run 遇到未知 schema、损坏记录或容量不足
- **THEN** 迁移 MUST 在任何真实写入前失败关闭，并报告受影响范围和恢复建议

#### Scenario: 中途失败后重试
- **WHEN** 已批准迁移在部分步骤后失败
- **THEN** 系统 MUST 保留原备份和迁移 journal，后续重试不得重复应用已提交步骤或破坏旧版本可读数据

### Requirement: 回滚必须一键执行并经过演练
每次 release MUST 保留 previous Release Manifest、previous artifact、原快捷方式目标、配置快照和必要的数据备份，并提供非交互式 rollback 命令。rollback MUST 停止新版本、恢复 compatible active target、恢复所需配置或数据、启动旧版本并执行 health 与关键学习 smoke；若数据发生不可逆变化，release MUST 在激活前被阻止。

#### Scenario: post-switch smoke 失败自动回滚
- **WHEN** 激活新版本后的 health 或关键学习 smoke 在规定时间内失败
- **THEN** 发布流程 MUST 自动恢复 previous manifest 和旧快捷方式目标，并输出可关联的失败报告

#### Scenario: 定期 rollback drill
- **WHEN** 执行 `verify:release` 的 rollback drill
- **THEN** 流程 MUST 在隔离目录和测试数据上完成安装、迁移、激活、写入、回滚和数据验证，且最终状态与 drill 前基线一致

### Requirement: 分支与发布来源必须具备远端恢复能力
用于 release 的分支 MUST 配置远端 upstream，所有 release commit、annotated tag、Release Manifest 与必要 artifact metadata MUST 在迁移前推送并可从全新 clone 恢复。工作树存在未提交或未跟踪变更时 MUST 禁止 release；大体积个人快照、真实数据和生成数据库不得作为回滚手段提交到 Git。

#### Scenario: 本地独有提交阻止发布
- **WHEN** release candidate 的 commit 或 tag 尚未在配置的远端可解析
- **THEN** `verify:release` MUST 阻止迁移并报告缺失的远端引用

#### Scenario: 全新 clone 恢复 release
- **WHEN** 在另一目录仅使用远端仓库、声明的工具链和 Release Manifest 恢复某个 release
- **THEN** 构建产物 hash、health identity 和核心 smoke 结果 MUST 与原 release 记录一致

