# Windows 桌面发布与软件内更新

本 fork 的 Windows 更新源为 **https://github.com/CrissMagic/cumora/releases**。
[上游发布手册](RELEASE_UPSTREAM.md) 作为历史参考保留，不用于本 fork 发版。

## 用户更新流程

公开 Windows 安装包不内置个人或默认业务服务器地址。首次启动填写自己的 Cumora
服务 origin（例如 `https://cumora.example.com`，不带 `/api`），连接检查成功后保存在
本机。之后在登录页可切换服务器；切换会清除旧登录状态，要求重新登录。已有本机
保存的地址继续使用。局域网试用允许 HTTP，公网部署应使用 HTTPS。

业务服务地址与 GitHub 更新源独立：用户填写的地址只用于登录、聊天等业务请求，
不会改变软件更新仓库，也不需要写入安装包或仓库变量。

已配置更新源的安装版在启动后约 3 秒及每 30 分钟检查一次；也可以在
**我 → 关于 → 检查更新** 手动触发。用户确认下载，下载完成后选择重启安装。
程序不自动下载，也不会仅因用户退出就静默安装。更新失败会显示错误，不报告虚假成功。

此前使用 `publish: null` 构建的本地安装版没有更新源，需要手动安装一次新版，
才能开始接收后续更新。首次覆盖旧包仍可能遇到旧卸载器的路径问题，见
[Windows 安装排查](WINDOWS_INSTALLATION.md)。新桌面包已排除 Capacitor 原生工程依赖，
不再将 Android 编译缓存放入安装或卸载路径；旧卸载器不会因此自动被修复。

GitHub Release 需要同时包含安装器、blockmap 和 `latest.yml`。客户端使用 HTTPS
从配置的仓库获取版本、下载地址及 SHA-512，并由 electron-updater 校验下载内容。
普通网页和此前未配置 feed 的安装包不具备此能力。Android 本次仍使用 APK 安装，
不接入这条 Windows 自动更新链路。

## 仓库配置

在当前 fork 启用 GitHub Actions。不需要配置服务域名或 `CUMORA_DESKTOP_API_BASE`
仓库变量；可按需设置以下签名 secrets：

| 配置 | 用途 |
| --- | --- |
| `WINDOWS_CSC_LINK`（可选 secret） | electron-builder 使用的 Windows 代码签名证书 |
| `WINDOWS_CSC_KEY_PASSWORD`（可选 secret） | 对应证书密码 |

发布 job 仅使用本仓库的 `GITHUB_TOKEN`，具有 `contents: write`；构建 job 仅有
`contents: read`。不需要上游仓库的 `RELEASES_REPO_TOKEN`、R2 或上游更新服务器权限。
没有签名证书时可以生成安装器与更新元数据，但不能宣称它是已完成发布者签名的安装包。
组织或仓库策略若限制 Actions 的写权限，需管理员另外配置。

## 本地构建与验证

使用 Windows、Node.js 24，在仓库根目录执行：

```powershell
npm ci
npm run desktop:build:win
npm run desktop:verify:win
```

构建脚本使用 `.local/desktop-release/dist`，保留本地试用服务原有的 `dist/`。
脚本显式清空 `VITE_CUMORA_API_BASE`，即使终端或 `.env.production` 中设有地址，
也不会将它用作公开桌面包的默认服务。Android 和 Web 构建配置不受此脚本影响。
它始终使用 `--publish never`，只生成本地文件，不创建 Release。产物位于：

- `release/Cumora-Setup-<version>.exe`
- `release/Cumora-Setup-<version>.exe.blockmap`
- `release/latest.yml`
- `release/win-unpacked/resources/app-update.yml`（包内更新源）

验证脚本检查版本、安装器完整性、SHA-512、feed 所属仓库、图标及包内非桌面内容。
产物验证通过才能交给发布流程。修改 `package.json` 版本时同步修改 lockfile；
同时准备 `docs/releases/<version>.md`，工作流使用该文件作为可审阅的 Release 正文。
BYOA CLI 的版本与发布周期独立，不会因为桌面更新自动发布到 npm。

## GitHub Actions 构建与发布

工作流为 [.github/workflows/release.yml](../.github/workflows/release.yml)，当前只构建
Windows x64。工作流代码需要先提交到要构建的 ref。

### 只生成候选安装包

手动运行 **Windows Desktop Release**：

- `ref`：要构建的现有分支或提交。
- `version`：必须等于该 ref 的 `package.json` 版本。
- `publish`：保持 `false`。

流程安装依赖，运行类型检查、lint 和相关行为测试，构建并验证三个更新产物，
最后上传到该次 Actions run 的 artifact。候选 artifact 不会被客户端当作正式更新。
手动工作流发现取决于默认分支；当前功能还在 `codex/cloud-self-hosting`，网页若仍显示
上游旧表单，应在合入工作流后再按新表单运行，或按已批准的 tag 发布路径触发。

### 发布正式更新

发布者审核候选结果后，按具体授权提交、推送并创建 `v<version>` tag。
例如版本为 `0.18.10` 时，tag 必须为 `v0.18.10`。不得在相同版本重新发布不同字节。

推送 tag 会触发工作流；也可以手动选择该 tag、填写版本并设置 `publish=true`。
手动正式发布同样要求 tag 已存在，且与构建 commit 完全一致。

流程先完成构建和校验，再由发布 job 在本仓库创建 draft Release，上传完整产物，
最后公开发布。发布前再次确认 tag 未移动。已公开的 Release 不会被工作流覆盖；
重跑只允许补齐 draft，公开版本有问题时应发布更高版本。

客户端仅检查稳定版本，不接受降级或预发布更新。修正有问题的版本时，保留更高的
版本号并重新发布，不通过改写旧 tag、覆盖安装器或回退 `latest.yml` 来修复。

## 发布后的验收

1. 确认 Release、tag、源码提交、安装器版本及 `latest.yml` 一致，三个产物都能下载。
2. 在此前已安装且包含本 fork feed 的版本中手动检查，确认显示更高版本和发布说明。
3. 下载后检查进度、错误处理，再明确选择重启安装；安装后确认版本、服务地址及登录状态。
4. 检查彩色托盘图标、未读标记、关闭到托盘和退出行为。

本地 fixture 可以验证检查、下载、完整性校验及状态流转，但不能代替 GitHub 上的
真实工作流和两版安装软件之间的覆盖升级验收。打 tag、创建公开 Release、代码签名、
外部上传或部署均按用户的具体授权执行；桌面发布不会部署云端 Web/API。
