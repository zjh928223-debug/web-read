# 5184 正式版启动

Windows 桌面双击 `启动 Read-Web 正式版（5184）`。
启动器会启动已发布的前端、Python 主后端和 Node 能力服务；已经运行时复用现有服务，随后打开浏览器。

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
