# Windows PC 与 Android 局域网试用

PC 运行 API、网页、PostgreSQL、Redis 和电脑端智能体。手机只运行 Android 客户端，通过局域网调用 PC。代码与 `.git` 位于绑定电脑的目录，数据库只保存绑定信息、聊天和应用管理数据。

本方案运行当前工作区代码，不依赖 npm 上已经发布的 Cumora 版本。现有 `%USERPROFILE%\.cumora` 官方实例继续使用自己的配置。服务、数据库连接和构建文件放在仓库 `.local/`；WSL 私人运行状态放在 `%USERPROFILE%\.cumora-local-trial/<仓库摘要>/`。这些目录不提交到 Git。

## 环境与安装

需要 Windows、PowerShell 7、Node.js 24、Git、Docker Desktop。首次安装运行 `npm ci`；Docker Desktop 必须已启动。不要将集成测试的数据库 URL 指向下面创建的试用库。

在仓库根目录执行（把地址换成本机实际 IPv4）：

```powershell
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action Setup -LanAddress 10.1.2.16
```

脚本会创建以下资源：

| 资源 | 位置或名称 |
| --- | --- |
| 后端、网页、WebSocket | `http://<PC IPv4>:5181` |
| PostgreSQL / Redis | `127.0.0.1:15433` / `127.0.0.1:16379`，仅本机监听 |
| Docker Compose 项目 | `cumora-local-pc`，独立持久化数据卷 |
| 后端任务 | `Cumora Local server (<仓库路径摘要>)` |
| 电脑端任务 | `Cumora Local agent (<仓库路径摘要>)` |
| 数据库凭据、运行配置 | `.local/server.env`、`.local/stack.env`、`.local/config.json` |
| 运行日志 | `.local/logs/server.log`、`.local/logs/agent.log` |

迁移会在新试用库执行至 schema 15。随机生成数据库密码与运行时 JWT 密钥。任务在当前 Windows 用户登录后运行，以隐藏方式启动，并在退出后重试；Docker Desktop 未启动时，先启动 Docker Desktop，再执行 `Start`。这不是系统登录前就运行的 Windows Service。

首次创建“本地 PC 试用”账号、一个 Codex 智能体和“PC 与手机联调”项目对话。没有新增公开的免登录接口：本机 CLI 使用已有会话机制创建仅供试用的登录会话。

服务端使用占位 OpenAI key，主要验证本机 Codex；不具备服务端模型推理能力。云端智能体、图片生成、自动头像等服务端 AI 功能需要另外配置有效的服务端凭据。邮件为 mock，未配置 Firebase 时不提供推送。

## 执行环境与 WSL

本机原生 Windows Codex 0.166/0.167 的实际文件操作，可能报 `elevated Windows sandbox requires effective :root read access`。仅 `--doctor` 推理成功不足以证明能写文件。不要为消除该错误而自动改成全权限模式。

已具备 Ubuntu、Linux Node.js、Git、bubblewrap 和 Linux Codex 登录时，可以使用 WSL 保留执行隔离：

```powershell
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action UseWsl -WslDistribution Paperclip-Ubuntu
```

此命令只停止本次试用电脑端，在 WSL 的 `/usr/local/lib/cumora-local-trial/<仓库摘要>/` 安装固定版本 Linux Codex，并使用 `%USERPROFILE%\.cumora-local-trial/<仓库摘要>/` 保存智能体状态。不会替换 Linux 全局 Codex或修改 shell 配置。二进制放在系统可执行目录树，是为了让现有最小读取沙箱可以启动自身的执行器；不扩大模型可访问的文件范围。它使用与 Windows Codex 相同的登录及提供方配置来源，仅向运行环境投射必要的提供方字段。

私人运行状态与原 Codex 登录位于同一个 Windows 卷，沿用现有 Codex 适配器的认证硬链接机制，使登录刷新能够同步，而不是复制一份可能迅速失效的刷新令牌。模型执行工具仍使用独立 agent home，凭据不会进入 App 或服务端。若原 Windows Codex 登录失效，应先恢复本机 Codex 登录再重启试用电脑端。

最初的 `.local/project` 试用绑定转换为 WSL 路径，例如 `/mnt/e/crissmagic/cumora/.local/project`，Windows 上对应 `E:\crissmagic\cumora\.local\project`。仅转换脚本创建的原始试用目录；检测到用户换了其他目录时会拒绝自动改绑。

**WSL 模式下，页面中的绑定路径必须是 WSL 可访问的绝对路径**，例如 `/mnt/e/projects/my-repo`，不能输入 `E:\projects\my-repo`。切换至自己的仓库前确认电脑端所用平台。现有仓库不会被初始化、迁移或覆盖，协作文档及附件也不会自动复制到该目录。

官方 Windows 沙箱和 WSL 的适用说明见 [OpenAI Windows sandbox 文档](https://developers.openai.com/codex/windows)。

如果 Windows 能联网而 WSL 模型请求超时，检查代理。当前试用的 `.local/config.json` 使用 `wslProxyRelay: true` 和 `windowsRepo` 指向仓库：只在 WSL 回环地址创建临时入口，经本机标准流转发到 Windows 已有的 `127.0.0.1:7890` 代理。没有为代理开放局域网端口，也不修改系统代理。模型工具进程仍受原来的网络隔离限制。若 PC 没有这个代理，不要启用此项，改用本机实际可用的联网方式。

## 局域网与防火墙

手机与 PC 使用同一局域网；手机上的 `localhost` 指向手机自身。PC 地址变化后，需要同步调整配置、重新生成防火墙规则并重打 APK；建议在路由器上为 PC 固定 DHCP 租约。

安装脚本请求管理员授权，添加**仅本地子网访问该 PC 地址的 `5181/TCP` 入站规则**。规则名称为 `Cumora Local HTTP (<摘要>)`，不开放 PG 或 Redis。若首次没有授权，可后续执行：

```powershell
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action Firewall
```

先在手机浏览器打开 `http://<PC IPv4>:5181/api/health`，看到 `{"ok":true,...}` 再安装 App。失败时核对 Wi-Fi 客户端隔离、VPN、PC 地址、后端日志和防火墙规则。PC 自己请求 LAN 地址成功不等于已验证手机网络。

## Android 打包与登录

需要 JDK 21 和 Android SDK Platform 36 / Build Tools 36.0.0。只设置当前 PowerShell 进程，不更改系统环境：

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME = 'C:\path\to\Android\Sdk'
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action BuildAndroid
```

脚本从 `.local/config.json` 读取地址，设置 `VITE_CUMORA_API_BASE`，构建网页、同步 Capacitor 并打包。调试包仅为所选 HTTP 主机生成局域网白名单，并在调试 WebView 中启用该连接；release 不包含此调试网络配置。

- APK 本地文件：`.local/artifacts/Cumora-local-debug.apk`。
- 手机下载地址：`http://<PC IPv4>:5181/local-trial.apk`。
- 私人登录页地址：本机 `.local/access.json` 中的 `url`，可在手机浏览器收藏。
  首次生成随机私人路径，之后 `Login` 和 `BuildAndroid` 均复用此路径。

在手机上下载 APK，允许该下载来源安装，安装后打开 App；回到私人登录页点击“登录已安装的 Android App”。也可点击“在 PC 或手机浏览器登录”使用网页版。页面链接包含登录凭证，**仅在自己的设备打开，不要转发**。App、网页使用同一账号和项目。

登录会话有有效期。退出后或登录失效时执行：

```powershell
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action Login
```

刷新只更新同一私人地址中的登录凭据，链接保持不变；页面使用 HTTP `no-store`，避免浏览器缓存旧凭据。
重新构建网页会清空 `dist/`，因此需要重新生成登录页；`BuildAndroid` 已自动在原路径恢复。
保留 `.local/access.json` 即可保留此路径。PC 的 IP 或端口改变时，地址的主机部分也需要更新。
旧会话在主动退出或到期前仍有效。APK 不包含登录 token、数据库密码或模型凭据。

## 本地测试与真机验收

项目创建及目录配置在电脑端完成：

1. 在电脑浏览器登录本地服务，打开“我 → 项目”，创建项目并在“工作目录”中关联配对电脑与现有目录。
   WSL 执行端使用 `/mnt/e/...` 路径；目录校验和文件操作由该电脑端执行。
2. 手机上打开底部“项目”查看已有配置，点击项目卡片进入它的会话列表。
3. 消息页顶部显示当前项目；点击标题可通过底部面板切换项目或返回“全部对话”。
4. 点击 **+** 新建该项目的会话；在“全部对话”下，会先要求选择一个已有项目。
   创建会话时项目固定，只提供该项目已就绪、在线电脑上的智能体。

App 不提供新建项目、关联/更换/解绑目录入口，“我”页也不再显示目录管理。
手机保留已有项目的目录和电脑状态展示，离线项目仍可查看聊天记录。
这是电脑端管理、手机端对话的界面分工；服务端仍沿用账号、角色及电脑归属鉴权，
没有通过客户端类型伪装成新的安全边界。

“文档 / 看板 / 日历”仍在项目页其他标签中，协作文档和附件不会自动写入 Git 仓库。
云端部署后，本机电脑端仍需配对并主动连接云端服务，外网访问需要单独验收。

2026-11-12 移动端分工调整验证：已检查项目页及“我”页无项目创建/目录管理入口，
切换已有项目后会话筛选正确；新建会话固定已有项目，真实电脑端完成文件任务并回复，
项目数量和目录绑定均未改变。最终 APK 的启动、192 帧导航、底部面板焦点与系统返回、
软键盘提交区域、三种手机宽度、英文和暗色检查通过。结果见
`.local/artifacts/mobile-project-chat-verification.json`。

电脑端显示在线、项目目录显示就绪后，可执行真实引擎冒烟测试：

```powershell
node --import tsx scripts/local-smoke.ts
```

该测试只在专用 `.local/project/` 创建唯一命名文件，在本地试用对话发出任务，并同时检查文件内容和智能体回复；结果写入 `.local/smoke-result.json`。它不会向其他账号发送消息。自动冒烟测试拒绝写入用户后来换绑的目录。

真机安装后建议按顺序试用：

1. 打开 health 地址，下载并安装 APK，经私人页面登录。
2. 在“PC 与手机联调”发送短消息，确认 PC 日志收到 wake，App 收到回复。
3. 让智能体在当前项目目录创建一个指定文件，PC 本地查看内容。
4. 从 PC 浏览器发送消息，确认手机能实时收到；测试退到后台再回来、键盘和返回键。
5. 在电脑端“我 → 项目 → 工作目录”换绑到不存在路径，手机观察错误状态，确认任务不跑到其他目录；在电脑端恢复有效目录后再次验证。
6. 换绑自己的 Git 仓库时，先记录 `git status`，完成小任务后核对 diff，确认未触碰无关文件。

本机自动测试和 APK 编译不能替代真机网络、安装、系统权限及后台行为验证。

更新界面后，在同一局域网用**手机浏览器**重新下载
`http://<PC-IP>:5181/local-trial.apk`，直接覆盖安装，保留登录和聊天数据。
无需 USB，也无需先卸载旧版。每次 `BuildAndroid` 会在固定私人路径更新登录页；
如需重新登录，在手机浏览器打开已收藏的链接，或查看 `.local/access.json` 中的 `url`。

底部菜单改为即时切换并保留已访问页状态。试用时可重点检查：搜索或筛选消息后
切换回来、资料库停留在看板/日历后切换回来、“我”页滚动后切换回来，以及连续
快速切换是否仍有整页变暗或空白。自动回归入口见
[Android 导航回归](MOBILE_ANDROID.md#root-navigation-regression)。

2026-11-12 界面更新的本机验证记录：

- Android API 36 独立模拟器覆盖安装成功，前端类型检查与 APK 构建通过。
- 相同的 80 帧切换检查：旧版 12 帧变暗、最低不透明度约 52%；新版 0 帧变暗。
  最终 APK 的扩展检查共采样 192 帧，未发现变暗、空白或根页面重叠；
  搜索、筛选、资料库子页及设置页滚动状态保留检查通过。
- 六个主页面分别在 360 / 390 / 412 CSS 像素宽度下检查，无横向溢出；
  底栏触控区域最小 56×56。通过实际外观选择器切换暗色并检查截图。
- 模拟器中拒绝通知权限后可继续使用；聊天触控打开、软键盘显示/返回键关闭、
  聊天顶部返回列表检查通过。未配置 Firebase 的后台推送不在本轮验证范围。
- 新建群聊、招募智能体、新建日程入口均验证编辑器可打开及取消，未保存测试数据。
- 设计检查采用 Android WebView 截图与技能的 App 测量探针，探针适配了隐藏但保留
  挂载的页面。没有运行另开桌面浏览器的完整 inspector 启动流程；现有头像颜色、
  设置元数据小字等样式提示保留，不视为所有视觉规则均已通过。

这些结果来自模拟器，逐帧不透明度检查不等同于真机帧率测试。

随后补测发现：已允许通知时，未配置 Firebase 的试用包在登录恢复后调用推送注册，
会由原生插件抛出 `Default FirebaseApp is not initialized` 并退出进程。
原有“拒绝通知”验证没有覆盖该分支。Android 现使用受保护的推送适配器，
Firebase 缺失时让权限申请、注册和注销返回 `PUSH_NOT_CONFIGURED`，
由现有通知状态界面显示，不影响基本聊天和登录。再次覆盖安装保留已有通知授权即可，
不需要清除 App 数据。允许、拒绝、首次询问三种状态的冷启动回归入口见
[Android 文档](MOBILE_ANDROID.md#root-navigation-regression)。

## 启停与数据位置

```powershell
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action Status
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action Stop
pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action Start
```

`Stop` 只停止该仓库的两个任务和两个 Compose 服务，保留账号、聊天、目录绑定和持久化卷。WSL 电脑端按独立配置中的 PID 停止，并校验进程归属，不扫描其他 Cumora 实例。官方服务继续使用原任务及 `%USERPROFILE%\.cumora`。

本地源码电脑端不自动更新为 npm 版本。修改 daemon 代码后先运行 `npm run build --prefix agent-cli`，待当前任务结束再 `Stop` / `Start`；修改前端后重新打包 App。不要对这个独立实例使用发布版的 `--install-service`、`--restart` 或 `--stop`。

仅重启电脑端（保留网页和后端连接）可用 `pwsh.exe -NoProfile -File scripts/local-pc.ps1 -Action RestartAgent`。

卸载时先 `Stop`，再按上述名称删除两个计划任务及单独的防火墙规则。确认不再需要数据后再删除专用 Docker 卷；不要把 `docker compose down -v` 当作日常停止命令。
