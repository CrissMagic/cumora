# Cumora · 自托管与本机智能体

本仓库是 [yetone/cumora](https://github.com/yetone/cumora) 的 fork，面向“云端提供连接服务，本机执行智能体，手机远程聊天”的使用方式。云端管理账号、项目、会话和调度；代码与 Git 仓库留在绑定电脑，本机模型凭据也留在电脑上。

上游原始介绍、架构和使用说明完整保留在 [README_UPSTREAM.md](README_UPSTREAM.md)，内容取自 fork 基线 [`fd3d6c5`](https://github.com/yetone/cumora/tree/fd3d6c58cb426dcd8371426e8f92526dcf56136e)，不代表本 fork 新功能的发布状态。项目继续使用 [MIT License](LICENSE)，感谢上游作者与贡献者。

[云服务器部署](docs/CLOUD_DEPLOYMENT.md) · [本机智能体接入](docs/BYOA.md) · [Android 构建](docs/MOBILE_ANDROID.md) · [Windows 局域网试用](docs/LOCAL_PC_TRIAL.md)

## Fork 后的主要变化

| 能力 | 当前实现 | 边界与验证状态 |
| --- | --- | --- |
| DeepSeek Harness | 独立 `deepseek` 引擎，驱动官方 `dsh` headless JSON 模式，支持会话恢复、错误处理和独立用量来源 | 本机真实模型请求、文件读取、公开网页读取已验证；凭据需配置在执行电脑 |
| MiMo Code | 独立 `mimo` 引擎，使用官方 `@mimo-ai/cli`，支持 JSON 执行、会话及模型配置、独立用量来源 | 适配器行为测试已覆盖；真实账号执行与续接仍待验收 |
| 按引擎兼容授权 | `CUMORA_BYOA_COMPAT_ENGINES=deepseek` 只允许指定兼容引擎执行 | dsh 可访问宿主机文件和网络；此设置不会解除 Codex / Claude 的隔离 |
| 引擎选择与发现 | 添加智能体时优先显示可运行、已安装的引擎；显示阻断原因并支持重新检测 | 未安装或不可运行的引擎可见但不可选；检测不会自动安装工具或授予权限 |
| 智能体模板 | 21 个科技公司常用岗位，按规划协作、研发质量、产品设计、研究数据、运营支持分类并支持搜索；默认补齐角色信息 | 维持扁平协作，只需选择运行电脑与引擎；支持展开编辑，不绑定模型或额外授予执行权限 |
| Windows 更新与图标 | 彩色托盘图标及未读标记；当前 fork 内的安装包、blockmap、更新元数据和发布工作流 | 使用 GitHub Releases；真实公开发布及跨版本覆盖更新需按发布步骤验收 |
| 本地项目目录 | 电脑端创建项目、关联执行电脑、绑定或解绑已有目录 / Git 仓库；智能体按项目切换工作目录与会话 | 保留 `.git` 和未提交文件；解绑不删除仓库；应用内协作文档和附件不会自动同步为仓库文件 |
| Android | 补齐资源同步、debug APK 构建、版本生成、可选 Firebase 配置及构建工作流 | 已有本地构建和模拟器验证；商店发布、生产签名及完整真机推送验收另行进行 |
| 移动端交互 | 调整聊天与底部导航、面板返回层级，修复二级页面系统返回直接退出和取消手势重复返回 | 手机基于已有项目聊天，项目创建与目录管理在电脑端完成 |
| 会话暂停与恢复 | PC / 手机暂停当前会话的本机智能体，持续至手动恢复；区分已请求暂停与本机已确认停止 | 源码已实现；需配套升级服务端、daemon 和客户端，见 [执行控制说明](docs/CONVERSATION_CONTROLS.md)；不回滚已完成操作 |
| 跨工作区提醒 | 按工作区查看状态判断推送，其他工作区来信可弹出提醒并点击进入对应会话 | 保留成员和静音检查；跨工作区未读聚合、真机锁屏推送仍需后续验收 |
| 分析协作与来源核验 | 加入负责人、查证、独立贡献、反例和汇总规则；本机提供公开网页研究入口 | 属于提示规则引导，仍需真实群聊验收；搜索摘要不视为已核实事实 |
| 云端与桌面自托管 | 单机 Docker Compose + Caddy，支持固定域名登录、本机主动连接、PC OAuth 回环与 Android 深链 | 此部署只启用 BYOA，不在云服务器安装执行引擎，也不需要 Kubernetes |

## 云端、本机与手机如何配合

```text
Windows 桌面 / 电脑浏览器 / Android
                  │ HTTPS / WebSocket
                  ▼
             云端 Web/API
        PostgreSQL / Redis / 附件
                  ▲
                  │ 本机 daemon 主动连接 HTTPS / SSE
                  │
              本机执行电脑
        Codex / dsh / 其他本地引擎
                  │
          绑定目录、文件与 Git 仓库
```

- **云服务器**保存应用管理信息、聊天、协作文档和附件，负责账号认证、消息与任务调度。
- **执行电脑**保存 CLI 登录、模型凭据、智能体运行状态和项目工作目录。项目文件修改由对应电脑执行，仓库不会整体存进 PostgreSQL。
- **手机**连接同一云端服务，在已有项目中与智能体对话；没有新建项目或绑定本地目录入口。

应用协作文档到 Markdown 的双向同步、多电脑目录映射选择、并发 Git worktree 管理仍有待完善，见 [项目工作区 Issue #4](https://github.com/CrissMagic/cumora/issues/4)。

## 开始使用

### 获取 fork 的功能分支

目前这些功能位于 `codex/cloud-self-hosting`，默认 `main` 尚未合入本分支。首次获取时指定分支：

```powershell
git clone --branch codex/cloud-self-hosting --single-branch https://github.com/CrissMagic/cumora.git
Set-Location cumora
npm ci
```

应用和移动端开发建议使用 Node.js 24。Android 另需 JDK 21、Android SDK Platform 36 与 Build Tools 36.0.0。

### 部署连接服务

按 [云服务器部署文档](docs/CLOUD_DEPLOYMENT.md) 配置域名、Docker Compose、Caddy HTTPS、PostgreSQL 和 Redis。文档包含 EL9 系统准备、备份、迁移、健康检查、升级及回滚步骤，适合交给服务器上的安装智能体执行。

服务地址使用自己的域名，例如 `https://cumora.example.com`。当前自托管仍需配置账号登录提供方（文档以 GitHub OAuth 为例），服务端启动也仍要求 `OPENAI_API_KEY`；辅助推理等功能可能使用它。只运行本机 BYOA，并不等于已经实现完全不需要服务端模型凭据的模式。

云端登录入口固定为域名根路径。不要将局域网试用中包含登录凭据的私人 HTML 页面发布到公网。

### 运行当前源码的本机 daemon

官方 npm 的 `cumora@latest` 可能尚未包含本 fork 的改动。构建本仓库的独立 CLI 后，在执行电脑配对：

```powershell
npm run build --prefix agent-cli
# CODE 来自当前自托管服务的电脑配对入口；首次配对时使用。
node agent-cli/dist/cli.js agent computer --pair CODE --server https://cumora.example.com --engine codex
```

已配对时去掉 `--pair CODE`，保留现有电脑身份、智能体和会话。后台启动方式、提供方凭据、隔离及兼容权限见 [BYOA.md](docs/BYOA.md)。源码 bundle 的后台必须指向实际构建文件，并设置 `CUMORA_AUTO_UPDATE=0`，避免被官方 npm 自动更新替换；不要让两个 daemon 共用同一配对身份。

接入 dsh 时，先在执行电脑安装官方 CLI、配置提供方凭据，再设置 `CUMORA_BYOA_COMPAT_ENGINES=deepseek`。已验证的 dsh 版本为 `0.2.2-rc.1`，旧版不一定支持 JSON 协议。具体命令和后台环境变量加载方法见 BYOA 文档，密钥不要写进仓库、手机包或聊天。

在 **智能体 → 添加 / ＋ → 运行于已配对电脑 → DeepSeek Harness** 创建智能体。模型留空跟随本机配置；自定义模型使用 profile 已配置的 `provider/model` 路由。完成后可将它加入已有项目的群聊。

### 配置项目与安装客户端

在电脑端 **我 → 项目 → 工作目录** 关联电脑并绑定已有目录。路径必须属于执行端：原生 Windows 使用 Windows 绝对路径，WSL 执行端使用 `/mnt/...` 路径。先确认目录就绪，再从手机发起项目任务。

- Android：按 [MOBILE_ANDROID.md](docs/MOBILE_ANDROID.md) 设置 `VITE_CUMORA_API_BASE` 后执行 `npm run android:build`。debug APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。
- Windows 桌面：使用 Electron 构建流程，说明见 [RELEASE.md](docs/RELEASE.md)。通用安装包不内置个人服务地址；首次启动填写 API 服务地址并连接，地址保存在本机，之后可在登录页切换，切换后需重新登录。
- 同局域网先行试用：使用 [LOCAL_PC_TRIAL.md](docs/LOCAL_PC_TRIAL.md) 的独立服务与数据库，避免影响已有实例。

本机生成的安装包属于本地构建产物，不会随 `git clone` 下载。Windows 的构建与发布流程见 [RELEASE.md](docs/RELEASE.md)，更新源为本 fork 的 GitHub Releases；客户端只读取已经公开的正式 Release，Actions 候选构建不会用于软件更新。上游网站、TestFlight、Release 与官方 npm 包不等同于本 fork 的安装包。

Windows 旧包覆盖安装若提示“Cumora 无法关闭”，即使 App 已退出也可能是旧卸载器的长路径问题，排查和短临时路径重试方法见 [WINDOWS_INSTALLATION.md](docs/WINDOWS_INSTALLATION.md)。此问题尚未完成真实升级验收。

## 分析与公开网页研究

日常聊天保持简洁。研究、评估与实质分析问题要求先核实前提，再由负责人组织证据、影响和反例，最后给出结论与不确定性；不会覆盖用户自定义的人设。

本机 BYOA 通过现有 MCP `cli` 工具使用研究命令，兼容引擎也可通过 `cumora` CLI 调用：

```json
{"argv":["research","search","public research query"]}
{"argv":["research","read","https://primary-source.example/announcement"]}
```

读取器仅访问公开 HTTPS，限制端口、跳转、大小与超时，拦截内网、回环和云元数据地址；不携带模型密钥或登录 Cookie。搜索基于公开 Bing RSS，结果可能缺失或不相关；检索时间、RSS 日期和文章发布日期会区分。搜索不可用时必须明确说明，不能假装已经核验，也不要把私密内容作为公开搜索查询。

## 开发与验证

开发环境、接口和贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)、[API.md](docs/API.md) 和上游 README。常用检查：

```powershell
npm run typecheck
npm run server:typecheck
npm run lint
npm run guard:engine-registry
npm run guard:big-brain
npm run guard:llm-tracked
npm run guard:migration-locks
npm test
```

集成测试只能使用独立的可丢弃测试库，执行方式见 CONTRIBUTING；测试会清空数据，不可指向云端或本机试用库。类型检查、协议测试、真实模型调用、安装包构建和真机验收各自证明不同范围，不能互相替代。

当前已验证本机 Codex 的研究调用、dsh 的模型与文件执行、Android 构建和部分导航场景。MiMo 真实账号执行、完整真机推送、实群协作效果、文档与仓库双向同步仍待验收或实现。功能进展以 [Issues](https://github.com/CrissMagic/cumora/issues) 和对应提交中的验证说明为准。
