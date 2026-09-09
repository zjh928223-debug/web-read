## Context

2026-09-09 核对：branch `codex/read-web-optimization`，HEAD `ada21d2bcd01f0253de7a691aa32fa101224813e`，规划前工作区 clean。旧 change 为 21/25，E-201 实现已提交，真实 Mac 未验收，不能声明 PASS。本轮没有连接 Mac 或检查用户 Tailscale/Firewall 实际配置。

需求规模适中：新增的是一个入口，不是十项新业务。耗时风险是入口适配、现有 Reader 的真实跨机缺口、一次远程处理及用户实机配合。A/B/C 只比较，只实现 B；direct 不作为硬性 gate。保留现有安全和数据隔离即可，不搭建额外系统。

## Goals / Non-Goals

**Goals:** 异地 Mac 浏览器在无需远程桌面的条件下使用 Reader、transcript/chunk、Range/播放/seek、Windows marks、URL workflow；刷新、新浏览器和手动重启 launcher 后恢复已保存数据。外部仅一个 Read-Web origin，内部服务 loopback。

**Non-Goals:** 实现 A/C、多网络自动切换、裸 IP HTTPS、短主机名兼容矩阵、IPv6 专项、公网/Funnel/0.0.0.0/路由器端口转发、强制 direct、测速平台、扫描/设备指纹、多用户/HA/rate limit/复杂认证/pairing、outbox/SSE/NativePicker、daemon/服务安装、开机自启/断点续作、辅助学习域迁移、真实数据切换。Moonlight 不属于 Read-Web 依赖、传输链路或产品检查。

## Decisions

### 1. 只实现 B：先手动接通 Serve HTTPS

```text
Mac 浏览器 https://<Windows Self.DNSName>:5184
  → 现有 Tailscale 网络
  → Windows Tailscale Serve（HTTPS 5184，tailnet 私有）
  → http://127.0.0.1:5184 Read-Web 稳定前门
  → 127.0.0.1:<当前 Host 端口> → 127.0.0.1:8776 / 数据 / workflow
```

| 方案 | 改动和成本 | 决定 |
| --- | --- | --- |
| A：直接绑定 Tailscale IP | 需新增 tailnet bind、跨语言校验和 IP/DNS Host 规则；HTTP 不能给浏览器提供 HTTPS 安全上下文 | 暂不做；为解决 HTTPS 再接证书会扩大范围 |
| B：Serve | 现成 HTTPS/MagicDNS；需薄启动/停止适配及前门精确 public-origin 规则，多一次本机代理 | 推荐；复用现有应用和加密能力，不预设其吞吐比 A 差 |
| C：subnet router | 应用可能少改，但增加路由发布/审批/转发及网段重叠维护，仍依赖 192.168 地址；若采用只能最小 /32 路由 | 与当前不依赖家庭地址约束冲突，未获放宽前不实施 |

实际代码依据：`src/services/windows-owner-reader-session-consumer.js` 的 stable commit key 和 `src/composables/youtube-workflow-loader.js` 的 SHA-256 校验依赖 `crypto.subtle`，不可用时明确抛错。因此不通过删除校验或浏览器安全开关来迁就 HTTP。使用 HTTPS 完整 MagicDNS 名称，IP 仅供连通性检查；这满足“IP 或 MagicDNS”中的后一种。

Tailscale Serve 支持指定 HTTPS 端口。规划命令为 `tailscale serve --bg --https=5184 http://127.0.0.1:5184`，停止本项为 `tailscale serve --https=5184 off`。实施先检查已安装版本的 `serve --help` 和 `serve status --json`，确认相同端口的 tailnet 发布与 loopback 前门可共存；不能假报实测通过。不得改成 443 绕开外部端口要求。

### 2. 手动启动、地址确认与失败行为

复用 `config/runtime.optimization.json` 和现有 launcher，不预先新增 runtime.tailscale.json、publication schema、双语言配置解析或 transport mode。手动执行现有 Tailscale CLI 的 `status --json`、`ip -4`，确认本机在线状态和完整 DNS 名称，形成 HTTPS origin；作为显式启动参数传入前门，不把机器 IP/DNS 提交进代码。最多加一个串联现有命令的薄脚本，不要求自动发现框架。

CLI 不可用、未连接、缺 IP/DNS、HTTPS 未启用、Serve 权限不足或端口冲突时，停止本次接入，报告原因及人工操作；不回退 LAN/0.0.0.0，不自动登录、安装或修改网络设置。只清理本次资源。停止时使用原 launcher 的停止命令及本应用 Serve off；CLI 失效仍可停止本机前门并报告残留映射，不新建生命周期管理系统。

### 3. Host、Origin 和 service token

仅在实际请求受阻时，为前门增加显式 public-origin 参数和精确 allowlist，接受当前完整 DNS 名称和 HTTPS 5184，不新增通用 publication 配置体系。Serve 可能保留 public Host 或转为 loopback Host：实施用一次实际代理请求确认；仅允许已知的本机后端 authority 与精确 public authority，不盲信任任意 Forwarded/X-Forwarded-Host，也不接受任意 *.ts.net。

浏览器发出 Origin 时必须等于配置的 HTTPS public origin；普通导航/媒体 GET 的 Origin 可能缺失，沿用已有请求规则，不要求这些请求伪造 Origin。前门验证后复用既有 upstream Host/Origin 重写，再由内部 Host 验证现有 service token。token 留在 Windows，不发到 URL、bundle、浏览器存储或日志；Tailscale 身份 header 不替代现有 token。

同源 `/api` 和媒体地址默认无需浏览器修改。响应 Location、媒体 URL 和业务错误也不得引导浏览器访问 LAN/loopback/内部端口或暴露完整 Windows 路径。Worker 不新增 listener，不将文件目录交给 Serve；Serve 只代理前门。

### 4. 精确文件边界

| 文件 | 计划改动 |
| --- | --- |
| `scripts/launch-optimization-preview.ps1` | 仅在需要时传递精确 public origin 参数；复用原启动/停止流程 |
| `tools/optimization-stable-front-door.mjs` | 仅修实际 Host/Origin 阻塞，保持 loopback bind、原有 proxy/Range |
| `scripts/optimization-stable-front-door-check.mjs` | 为实际校验改动补行为测试，不建立新测试矩阵 |
| `scripts/launch-tailscale-preview.ps1`（可选新增） | 仅当主路径已通且时间允许时封装手动命令；不是完成条件 |
| 本 change 的使用说明 | 记录实际启动、停止命令和唯一 HTTPS URL 的获取方式 |
| `docs/architecture/windows-local-owner-thin-reader/non-goals.json` 及对应 verifier（仅必要时）、`CURRENT_PROJECT_STATUS.md` | 仅将本次 transport 扩展与旧历史范围区分，保留既有保护，不伪改历史 checksum |

默认不改 `windows_owner_request_policy.py`、业务 API、Reader/marks、workflow client；只有实测证明前门适配不能解决的必用故障，才最小修改 `src/services/windows-owner-api-client.js`、`src/services/windows-owner-reader-session-consumer.js`、`src/composables/youtube-workflow-client.js` 或 `src/composables/youtube-workflow-loader.js`。内部 policy 若需改，必须保持 loopback/token 语义，不增加第二套远程策略。

### 5. 最小网络要求与诊断

Tailscale 规则限定“这台 Mac → 这台 Windows → tcp:5184”。可用现有 ACL 或 grants，不并建两套。示意 `{"src":["<Mac Tailscale IP>"],"dst":["<Windows Tailscale IP>"],"ip":["tcp:5184"]}`，实际 IP 由管理员在网络策略中指定，禁止写死进应用配置。既有允许全部流量的规则不会被这条窄规则抵消；人工核对有效权限，保留其他已有管理用途，不自动覆盖 tailnet policy。[grants 文档](https://tailscale.com/docs/reference/syntax/grants)

Windows 保持防火墙启用、已有 Tailscale 程序联网权限和内部 loopback listener。仅在实测被阻止时增加对应 Tailscale 接口/地址、来源 Mac 的 5184 最小允许规则，不开内部端口，不加全接口规则；Serve 的虚拟监听以 Mac 实际访问和 Serve 状态核对，不能仅凭 Get-NetTCPConnection 断言成功。5184 是 Read-Web 唯一外部入口，不要求禁用机器上已有的其他非 Read-Web 服务。

Mac 在传输前后执行 `tailscale ping <Windows名称或IP>`、`tailscale status`；记录 direct、relay/DERP 或 peer-relay（如出现）及时间。首次 ping 可能从 relay 转 direct，不能只看首包。仅遇到吞吐问题执行一次 `tailscale netcheck` 定位，不配置新 DERP、路由器转发或无限调 NAT。[连接诊断](https://tailscale.com/docs/reference/troubleshooting/network-configuration/derp-routing)、[防火墙说明](https://tailscale.com/docs/reference/faq/firewall-ports)

### 6. 自动化与一次 Mac 实机验收

自动化只针对实际代码改动：若修改前门，验证精确 Host/Origin、既有 token/Range 代理和 loopback/private-LAN 不回归；未开发 CLI 自动化则不编写假 CLI 全分支测试。手动核对 Serve 5184 不覆盖其他发布、失败不回退、内部 listener 仍为 loopback。

执行与 diff 相关的 focused checks；改变应用或构建输入时 build，再做一次必要页面检查。没有配置或内部 policy 改动，不重跑这些完整测试组。不要用全仓库测试矩阵替代实机，不编写日志推断式证据验证器。

用户在公司/异地 Mac，正常连接 Tailscale、使用日常浏览器，不运行远程桌面：

1. 打开 Serve 或操作说明给出的 HTTPS URL，确认无证书警告，`isSecureContext` 与 `crypto.subtle` 可用；Network 中业务请求均为该 origin。
2. 打开 Windows optimization 素材，显示 transcript/chunk；播放、暂停、跳到远端位置，确认 Range 206。
3. 保存一个 mark，刷新及新浏览器会话恢复；用新会话替代破坏性清缓存，避免清掉任何唯一数据。
4. 暂停 launcher，Mac 显示不可用/保存失败；手动重新启动后刷新/重试，恢复已保存 Session 和 marks。停止时不要求保存未确认 mutation 或续作任务。
5. 提交一条短 YouTube URL，Windows 完成现有处理，Mac polling 后打开结果；全程只做一次耗时处理。
6. 用已有大媒体的 URL 取一个有限区间，如 8 MiB，记录 HTTP 206、Content-Range、字节数、总耗时/吞吐，同时记录 direct/relay；可用 `curl -r 0-8388607 -o /dev/null -w '%{http_code} %{size_download} %{time_total} %{speed_download}\n' '<同源媒体URL>'`。URL 取已验证无 secret 的请求，不导出带凭据 HAR。不下载整个大文件，不要求强制制造 direct/relay 两组对比。
7. Mac 用 `nc -vz -G 3 <Windows-Tailscale-IP> 5200`、同样检查 8776 及运行时实际 Host 端口，均不可连接；Windows 核对这些 listener 为 127.0.0.1。只检查已知端口，不扫描。

记录一次简短 Markdown：版本、浏览器、URL、通过/失败、Range 和连接结果。只在变更、疑点或证据缺口时补测。direct 下实际播放/seek 和有限 Range 是否满足使用是结果；relay 本身不是失败，不承诺具体 Mbps。

## Risks / Trade-offs

- [HTTPS/MagicDNS 或 Serve 权限未就绪] → 用户做一次现有 Tailscale 设置；不绕过证书、不切回 HTTP。Windows Serve 可能需管理员终端。
- [代理 Host/Origin 实际行为、同端口共存] → 开始实施先验证小型入口路径，再继续业务旅程；失败报具体阻塞，不并行实现 A/B/C。
- [公司网络仅 relay 或家中上行较慢] → 如实记录实际使用表现，不把网络优化变成开发阶段。
- [旧 E-201 仍有真实业务缺口] → 只修必用路径，辅助域继续非阻塞；不能把已有提交等同于可用。
- [历史 non-goal 和未归档 local-application-host delta 重叠] → 本次为显式后续扩展；归档时按旧 change 再本 change 顺序合并并保留 loopback/private-LAN/Serve 三种边界，不覆盖旧文档来假装原先已支持。

## Migration Plan

时间边界：目标为 2–3 小时的一轮集中实现与验收，不是保证。约一小时必须报告 Mac 入口是否打开、已定位的具体阻塞和下一步；接近两小时转入实机验收，不再补启动封装或其他便利功能。若此时必用路径仍需大改，立即报告已完成项、阻塞和剩余工作，询问是否继续。三小时仍未完成则保留可用结果并报告，未经用户同意不扩展到八九小时。等待用户或外部处理的时间单独说明，不用等待掩盖整体耗时，不为赶时间虚报 PASS。

手动两步启动、显式传入一个 public origin 都是合格交付。薄脚本、通用配置和自动发现不能阻塞完成。原文中的“adapter”仅指 Serve 发布方式，不要求交付独立 adapter 模块。

独立 change `enable-tailscale-reader-access`，只两项 E-TS-01/R-TS-01。一次实现包含真实 Mac 配合，一次独立只读审核复用其结果。E-201 尚未通过不阻止先补齐新增入口；真实 Mac 未完成则 E-TS-01 和旧 E-201 都不勾选，不创建 R-201。

实机通过后，本 change 的 transport review 和旧 R-201 可顺序复用同一版证据；旧 R-201 若按原约定需要仍在新对话中只读执行，不再跑下载/转录。不能把 Tailscale 证据写成“192.168 private-LAN 实机已通过”。旧 change 的调度说明在后续实施时引用本 change 的实际入口，保持业务门槛，不能自动声称旧审核 PASS。

回滚：先停止本 adapter 的 5184 Serve 映射和 optimization 进程，再运行已有 private-LAN 或 loopback launcher；数据根、旧配置和旧代码路径保留。不使用 `serve reset` 删除其他发布，不停 Tailscale 本身。启动前如 5184 属于其他 Serve/Funnel 配置则拒绝接管；不增新备份/迁移阶段。回到 LAN 后异地 Mac 不能访问属于预期降级，不声称远程仍可用。

## Open Questions

实施前只需实机确认现有 Tailscale 版本支持目标命令、MagicDNS/HTTPS 已启用且操作者有权限，以及用户可配合一次异地浏览器验收。此处没有假定这些环境条件已验证。任何要求新的证书平台、长期网络排障或大规模业务改造的问题，都先报告范围变化。

参考：[Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)、[Windows Serve 示例](https://tailscale.com/docs/reference/examples/serve)、[SubtleCrypto 安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)。
