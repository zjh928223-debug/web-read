# 日常N5副本与开发环境隔离

用户要求：日常版固定当前N5进度，后台持久记录；开发版可独立改代码和重启，日常服务不随开发停机。2026-10-07本轮只做运行部署，不做N6功能或UI改造。

| 项目 | 日常版 | 开发版 |
| --- | --- | --- |
| 程序 | E:/ReadWebDaily/N5-20261007 | E:/read-web-next-optimization |
| 对外入口 | 5194（Tailscale HTTPS，续作后已就绪） | 5184 |
| 内部Host/能力服务 | 5195/8786 | 动态内部Host/8776 |
| 数据 | E:/ReadWebData/SubtitleWorkflow-Daily-N5 | E:/ReadWebData/SubtitleWorkflow-Optimization |
| 功能版本 | N5独立收口时生产dist与源码副本 | 后续N6继续在当前树施工 |
| 启停 | 副本内 scripts/launch-frozen-daily.ps1 | scripts/launch-optimization-preview.ps1 |

日常程序、node_modules、Node及后台Python环境均是物理副本，不是开发目录链接。基础Windows Python和外部WhisperX/ffmpeg/yt-dlp及代理仍是共用系统工具；本轮不升级这些工具。并发下载/转写仍竞争这台电脑的CPU/GPU资源，服务隔离不代表算力无限。

用户不再使用旧网址，但没有要求删除旧进度。以当前开发数据完整副本作为新日常初始数据，原日用树和旧数据均保留；今后两边各自保存，开发记录不会自动覆盖日常学习成果。

固定验收在首次启动之前登记于 C:/Users/0/AppData/Local/Temp/reader-dual-runtime-20261007/acceptance.json。完整复制1089文件、742945839字节并逐文件校验一致；原根复制前后零变化。新副本43个工作流/素材JSON中1441处完整路径前缀改绑至新根，逆变换与全部原字段完全相同；词库、义项、SRS历史及owner快照不做内容改写。原保护清单与映射证据均保存于该Temp目录。

冻结release的原manifest原样保留；新部署manifest重新计算并通过实际Python依赖健康、工具链身份和29个release artifact校验，不把旧解释器路径冒充新环境。本次新增运行脚本未独立审核；N5产品独立PASS不等于这些新脚本已审核。

## 首段结果：NOT_READY（历史记录，已由下方续作结果取代）

第一次启动FAIL：启动脚本调用文本写入工具使用了错误参数，未启动服务；随后纠正。

第二次启动FAIL：独立能力服务启动，Host健康为degraded，ownerRegistry返回OWNER_MODE_CHECKPOINT_INVALID，不能接受六域持久写入。副本中原owner凭据不能直接作为新目录的可写授权，需按原存储合同建立新副本的有效绑定；不能改健康断言、伪造PASS或绕过保护。

两次失败均保留；启动流程已清理本轮服务，未改Tailscale旧5184映射。日常HTTPS、真实UI保存、服务重启读回、开发启停隔离、媒体Range和Mac实际使用均NOT_RUN。未提供可用网址、未配置自动启动、未更新全仓Last verified、R状态或N5旧结论。

按AGENTS两次失败停止规则，已询问用户是否继续修复新副本存储绑定；等待答复期间不进行第三次启动修补。继续后必须先保护新副本，再使用受支持的数据/授权迁移路径，验证旧记录和合法双语境/双unit保留，完成上述真实验收才可标READY。日常副本不得被N6施工、运行清理或数据验收覆盖。

此前 C:/Users/0/AppData/Local/Temp/reader-n5-mac-use-20261007/start-guide.md 的共用5184学习服务安排已被用户要求两套隔离取代，不再作为新日常版启动说明。

## 用户授权简化续作后的当前结果

用户明确只先交付下载视频、WhisperX转写、标注陌生词、API解释、加入SRS的日常使用入口，允许继续修复副本存储绑定；N6、UI重构及其他功能不施工。当前日常和开发服务均保持运行。

日常网址：https://laptop-5jd5ouqg.tail5f3899.ts.net:5194/ 。开发网址：https://laptop-5jd5ouqg.tail5f3899.ts.net:5184/ 。Mac与Windows应在同一Tailscale网络，Windows保持开机唤醒。Windows双击日常目录的“启动日常版.cmd”；停止使用“停止日常版.cmd”。重启电脑后手动启动，未配置开机自启。完整说明为 E:/ReadWebDaily/N5-20261007/使用说明.md。

修复使用正式owner lease及checkpoint writer建立新根授权，六域均authoritative；原checkpoint保留于checkpoints-before-daily-binding-20261007。续作首个Host启动仍FAIL（OWNER_PROFILE_COLLECTION_UNVERIFIED）：早期直接改JSON路径使耐久包校验失效。改为实际DurableJsonRepository及各域envelope构造/校验器写入，逆变换保留原payload，再次启动通过。原FAIL及corrupt/bak证据保留，不绕过存储保护。

真实新任务6bdca325e2ab完成视频下载、WhisperX转写和real模式切分翻译，结果新目录与旧素材分离，素材库14→15。Gemini切分与翻译命中缓存，不代表新的云端调用通过；新云端标注解释仍NOT_RUN。WhisperX产生TorchCodec依赖警告但实际转写和对齐完成，日志原样保留。HTTPS新旧素材实际打开和播放通过。旧文章新增标注及一个elephants语境加入SRS通过；保留该语境、学习单元和标注。日常服务重启后SRS文件完全一致，UI重新读取8标注及已加入11项/已跳过1项。开发服务停止和重启期间日常PID/启动时间不变，反向重启日常时开发仍就绪。

新网址的浏览器设置独立，Mac首次在“素材处理 → 设置”自行填写Gemini API Key。未从旧浏览器搬迁密钥，也不要求用户在聊天中发送。API解释功能沿用冻结N5；本轮未做新的云端解释请求验证。Mac实际连入、Windows重启、开机自启、独立审核及全仓检查仍NOT_RUN。本轮只登记部署结论，不更新N5历史结论、R状态或全仓Last verified。原初段NOT_RUN保留为当时状态。

保护边界：日常代码、依赖、数据和进程均独立，普通开发删改和官方开发launcher启停不影响日常。外部WhisperX/ffmpeg/yt-dlp、基础Python与机器算力共用；此处不承诺删除系统工具或耗尽GPU资源时仍无限可用。不得用全局kill/清理profile的方式停止服务。完整证据见 C:/Users/0/AppData/Local/Temp/reader-dual-runtime-20261007/result.md。

### 2026-10-08 日常启动修复

用户报告双击无可见结果且Windows打不开网址。本次开场Host/能力服务ready，但loopback5194网关不存在，旧网关receipt过期；Tailscale映射仍在。旧Start分支只拒绝partial状态，没有恢复入口和自动打开页面。修复为核对日常release、各服务工作目录及共同instanceId后，复用后台并用原owned manager补启动网关；拒绝未知监听者。Windows启动cmd显示中文进度、保留结果窗口，并用-OpenBrowser打开 http://127.0.0.1:5194/ 。cmd按Windows CRLF保存。Mac原HTTPS网址不变。

实际cmd路径执行到“日常版已就绪”，自动打开浏览器，退出后后台仍ready。localhost/HTTPS均HTTP200，两种入口真实浏览器页面加载通过，本机素材库读取15项。后台PID/启动身份不变，SRS文件SHA256不变；未启动或停止开发版。本次只有日常launcher/启动cmd/说明修复，源码launcher同步当前工作区。首个repair尝试FAIL（错误地要求Host工作目录等于根而非tools/subtitle-workflow）与cmd首测LF导致解析FAIL保留；均各一次纠正后通过。没有改写历史结论。Mac实际旅程、Windows重启、独立审核仍NOT_RUN。证据 C:/Users/0/AppData/Local/Temp/reader-daily-start-repair-20261008/result.json 与 local-ready.png。

### 2026-10-08 日常下载修复及单素材实测

用户Mac保存API后提交Sgger2W5tJc失败。开场凭据stored、实际下载器/WhisperX路径存在，但日常任务启动preflight拒绝WORKFLOW_TOOL_MISSING，任务未创建。NLTK punkt_tab的带空格工具名被旧错误映射滤掉，因此公开提示无法指出资源名。原失败receipt保留。将现有NLTK资源逐文件复制至日常runtime/nltk_data，deployment.nltkData指向此固定根，launcher显式设置进程NLTK_DATA并检查英文四个必需文件。仅修部署依赖，不修改产品owner/性能/N6/UI。日常按拥有权停止重启；首次Start碰到launch-lock报错，下一次Start正常，均保留。

新鲜owner命令经相同HTTPS入口提交用户链接，committed任务1a1e02523454；真实下载、WhisperX转写/对齐、Gemini两次未命中缓存的云端请求、切分翻译、保存及ready读回通过。总81.6秒，音频129.892426秒。网页素材库15→16，实际打开并播放到56.57秒。旧待提交表单行重试仍因旧请求/receipt返回manual-recovery；清除该临时表单行后，网页重新提交同链接正常提示已处理并打开已有素材，不重做下载。清表单不删除素材、receipt或SRS目标。此次新任务首发由HTTP owner命令完成，不冒充UI首发通过。

API凭据Windows Credential Manager仍stored，SRS文件SHA一致，旧素材及历史失败保留。新结论为此单素材部署修复/链路通过；真实Mac复验、Windows重启、独立审核、全仓及新的标注云端解释仍NOT_RUN。证据 C:/Users/0/AppData/Local/Temp/reader-daily-download-repair-20261008/real-video-result.json、result.json、failed-receipts.json、fresh-ui-submission.txt。日常服务保留运行，开发进程未启停。
