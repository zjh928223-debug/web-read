# 阅读器启动与独立 Python 环境

## 日常启动

双击仓库根目录的 `Start-Reader.cmd`。它调用原优化启动器，显式使用下方的专用 Python；失败时保留控制台报错。成功后自动打开 `http://127.0.0.1:5184/`。

停止：在 PowerShell 执行 `& 'E:\read-web-next-optimization\Start-Reader.cmd' -Stop`。

## 环境位置

- Python：`E:\ReadWebRuntime\optimization-python\Scripts\python.exe`。
- 基础解释器：已有 CPython 3.10.10，虚拟环境不继承全局 site-packages。
- 依赖来源：`tools/subtitle-workflow/requirements-service.lock`，使用固定版本及哈希安装，不自动升级。
- 配置：`config/runtime.optimization.json` 的 `python.executable` 也指向上述位置。
- 端口仍是 5184/8776，数据仍在原 optimization 数据根；没有选择 HOST-02/03 的合成测试根，也没有执行数据迁移。

2026-09-26 排查发现，Codex 内原 LocalAppData 环境的实际路径位于 `OpenAI.Codex_.../LocalCache/Local/Read-Web`，普通 PowerShell 无法通过同一逻辑路径访问它。新环境放在共享 E 盘，启动文件显式指定解释器，避免应用目录重定向及 PATH 选择差异。不要把 Codex 私有目录中的 Python 当成普通桌面的环境。

## 需要重建时

只在此环境缺失或确需恢复依赖时执行，普通启动不安装依赖。不要复制虚拟环境目录，应由基础 Python 创建。

```powershell
Set-Location 'E:\read-web-next-optimization'
& 'C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe' -m venv 'E:\ReadWebRuntime\optimization-python'
& 'E:\ReadWebRuntime\optimization-python\Scripts\python.exe' -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: -r 'tools\subtitle-workflow\requirements-service.lock'
```

每步失败就先处理该报错，不继续启动。不要通过卸载全局 Python 的包或跳过已有依赖检查来修复。基础 Python 3.10 仍需保留；迁移电脑后按本节重新创建环境。

WhisperX、ffmpeg 等外部工具维持各自现有配置，此服务环境不安装 GPU／转写依赖。

## 本次验证（2026-09-26）

- E 盘环境已创建并安装锁定的 47 个服务依赖；`pip check`、`verify:python-health`、`verify:python-runtime-inventory` 通过。运行时清单中的 PyQt6 是可选桌面组件，未安装。
- 健康检查报告的真实 executable 是 E 盘路径，无 Codex LocalCache 重定向。
- 已通过 `Start-Reader.cmd -NoOpen` 完成当前源码构建及默认优化实例启动；`/api/app/health` 返回 ready，`/` 返回 HTTP 200 和阅读器标题。
- 本次启动服务保留供用户使用；没有进入业务页面操作词库，也没有运行迁移／promotion。
- 只更新运行配置，新增启动文件及本说明；未修改既有 Host 维修代码，未提交 Git。
