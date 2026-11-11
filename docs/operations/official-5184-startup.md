# 5184 正式版启动

Windows 桌面双击 `启动 Read-Web 正式版（5184）`。
启动器会启动已发布的前端、Python 主后端和 Node 能力服务；已经运行时复用现有服务，随后打开浏览器。
桌面入口使用 `-Quiet` 隐藏控制台，正常时直接打开页面；失败时仅弹出简短提示。
启动依赖优先使用 `E:\ReadWebRuntime` 中的优化 Python 和 Node 24.13.1，避免依赖桌面进程继承的旧路径。详细结果保存在 `.codex/startup-logs/official-reader-startup.log` 和 `official-reader-launch.log`。

- Windows：<http://127.0.0.1:5184/>
- Mac：<https://laptop-5jd5ouqg.tail5f3899.ts.net:5184/>

Mac 和 Windows 均需连上同一 Tailscale 网络，Windows 需保持开机和唤醒。
Mac 通过上述 HTTPS 入口同时访问页面和 Windows 后端，无需在 Mac 上运行后端。
域名需正确解析到这台 Windows 的 Tailscale 地址；若 DNS 或代理路径异常，域名访问仍可能失败。

桌面快捷方式调用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\read-web-next-optimization\scripts\start-official-reader.ps1
```

该脚本通过 `launch-optimization-preview.ps1 -UseActiveRelease` 启动当前已发布版本，
跳过开发源码和工具链指纹一致性比较，不自动构建工作区中的新前端改动。
启动后检查后端健康状态，失败时保留错误窗口。

服务入口为 5184，内部 Python Host 端口动态分配，Node 能力服务为 8776。
程序与数据使用 optimization 工作区及 `E:\ReadWebData\SubtitleWorkflow-Optimization`。
旧 N5 的 5194/5195/8786 服务及数据不属于此启动器的管理对象。

## 2026-10-30 正式版存档

- Git 标签：`read-web-official-2026-10-30`。
- 运行中的发布包：`read-web-optimization-v2-0b8571cfad4e-5594c620f34f-bb02508c230c`。
- 产品源码 SHA-256：`5594c620f34fa40ca3db010a5fd1da3dc0bda6ed8aae0dee2264edd4afca96cc`。
- dist SHA-256：`bb02508c230c61cc897a538d7a700939bfba1964bc89382109355201322651f6`。

该包在 Git 存档提交之前构建，因此包内 manifest 仍保留构建时的旧 Git SHA 和 dirty 记录。
存档前已只读核对 336 个产品源码输入及锁文件，确认与上述发布包的源码身份一致；不改写既有 manifest。

本次范围验证通过：构建发布、与用户确认的 4173 UI 对照（两份样式文件哈希相同）、
素材库读取 14 项、主后端和能力服务健康、Tailscale 实际 IP 上的 HTTPS 页面和接口、重复启动复用服务。
Mac 此前已确认同一 HTTPS 入口可打开；更新后的 UI 未再次在 Mac 浏览器独立验收。
保留已有 best-effort 警告，本次未重跑完整业务旅程或新的云端 AI 调用。
旧 N5 保持停用，其程序和数据保留。

## 2026-11-03 启动失败修复

失败的桌面启动进程继承了 `TEMP/TMP=C:\Windows\TEMP`，当前用户不能在那里创建目录。
`Invoke-OptimizationProcessCapture` 已通过管道捕获输出，却仍创建未使用的临时目录；权限异常被版本检查吞掉后，误报为 Node 不存在或未返回版本。
使用失败进程的临时目录设置，在 Windows PowerShell 5.1 中复现了“Access is denied”和空版本结果。

修复移除了多余临时目录依赖；正式版启动器为本进程及其子进程选择当前用户的
`AppData\Local\Read-Web\optimization-temp`，不修改系统环境变量。版本检查失败时记录原始异常。

修复后验证：Windows PowerShell 5.1、PowerShell 7 的进程捕获回归检查通过；3 次隐藏重复启动复用原服务；
1 次全部所属服务退出后的启动，页面、主后端、能力服务通过；再次使用原故障的系统 TEMP 环境启动也通过。
已发布 releaseId 和发布包 manifest 哈希保持一致。没有构建或发布新 UI，没有修改学习内容或旧 N5。
整机重启尚未实测。

本次诊断脚本的初次冷启动断言误将 active-release 的重新激活时间变化当作发布包变化，因此该脚本退出失败；
实际服务已 ready，随后分别核对 releaseId 和 manifest 哈希一致。该验收脚本失败保留在诊断记录中，不宣称整轮脚本全 PASS。

回归命令：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/optimization-process-capture-check.ps1`。

### 同日重启后重复点击冲突

系统于 11:24:33 重启。11:31:36 开始的启动用了约 40 秒，于 11:32:16 ready；
其间 11:32:04 的第二次点击因 `official-reader-launch.log` 被首次启动独占而失败。
因此会出现弹错后网页又能打开；此次日志没有再次出现 Node/TEMP 故障。

启动器现在以当前会话的命名互斥锁串行执行整个启动过程，包括共享日志写入和服务激活。
重复点击等待前次完成，再复用服务；前次进程异常退出后允许接管弃置的锁。
锁内等待有 120 秒上限。

`scripts/official-reader-concurrency-check.ps1` 持有启动锁和实际日志文件，并发启动三个
Windows PowerShell 隐藏模式进程：三个进程均等待后成功退出，主服务 PID 不变，
健康状态 ready 且接受请求。没有停止或重启正在使用的服务。
记录：`.codex/startup-logs/concurrency-9f033c348d924e3b80c153ad4322090b/result.json`。
该补丁没有再次进行整机重启验收；上段“整机重启尚未实测”为此前验证边界。
