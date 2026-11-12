# 云服务器部署与本机电脑接入

本文面向在远程服务器执行安装的运维人员或智能体。范围是单机 Docker Compose 部署：云端提供 Web/API、账号、聊天、调度、PostgreSQL、Redis 和附件存储；本机电脑运行智能体，代码、`.git` 和文件执行留在本机。手机连接云端 HTTPS 服务，使用已创建的项目聊天。

不需要 Kubernetes。此配置关闭扫描、闲时唤醒和 Kubernetes 清理/监控；只使用已配对电脑上的 BYOA 智能体，不部署或承诺支持托管云端智能体。应用协作文档和附件由云端保存，不会自动写入本机绑定的 Git 仓库。

```text
Android / 电脑浏览器 ── HTTPS、WebSocket ── 云端 Web/API
                                             │
                                      PostgreSQL / Redis / 附件卷
                                             ↑
                                 本机 daemon 主动连接 HTTPS/SSE
                                             │
                                     本机模型工具与 Git 目录
```

## 给安装智能体的执行边界

- 先检查实际系统、已有 Docker/网站/监听端口、可用内存和磁盘，再执行对应步骤。记录所部署的 Git SHA，不假定 `main` 包含本文。
- 安装前取得实际域名、OAuth 配置、管理员邮箱和服务端模型凭据。缺失时继续非依赖检查，暂停依赖该值的启动或登录验收；不要编造值、复制私人登录页或向用户索取私钥。
- 不输出 `.env`、展开后的 Compose 配置、OAuth secret、设备令牌、模型密钥或登录回调 fragment。需要凭据时让操作者在服务器私密文件中填写。
- 不替换现有反向代理、不关闭 SELinux/防火墙、不移除已安装的容器工具，不修改其他项目容器或数据卷。80/443 已占用时使用下文的已有代理方式。
- 不运行 `scripts/local-pc.ps1 Setup`、`scripts/local-trial.ts` 或 `scripts/local-wsl.mjs` 来安装云端；它们针对 Windows 局域网试用，会生成试用账号/凭据和本地配置。
- 不自动迁移本地试用数据、不复制本机 Codex 认证/Git 私钥、不向公网开放数据库或电脑端口。
- 部署健康不等于本机执行链路已完成。分别报告服务器、登录、电脑配对、真机聊天的实际验证结果；缺少手机/电脑操作时标记未验证。

以下服务器命令使用 **Linux Bash**，在仓库根目录运行；不在 Windows PowerShell 中直接粘贴这些命令。

## 1. 检查服务器与网络

```bash
cat /etc/os-release
uname -m
free -h
df -h / /var/lib
command -v docker || true
docker --version
docker compose version
sudo ss -lntp
getenforce 2>/dev/null || true
systemctl is-active firewalld || true
```

EL9 内核不等于特定发行版。根据 `/etc/os-release` 识别 Rocky、AlmaLinux、RHEL、Alibaba Cloud Linux 等，再按该发行版支持的方法安装 Docker Engine 与 Compose v2 插件。不要仅根据 `uname` 套用 CentOS 软件源或卸载 Podman。Docker 尚不存在时，上述 Docker 检查失败属于待安装项。

建议起步 2 vCPU、4 GB 内存、20 GB 以上可用磁盘；这是容量建议，并非已压测上限。构建前端比日常运行占用更多内存，检查 OOM 和镜像占用。云端需要能访问 GitHub、镜像仓库、npm、证书签发服务及配置的服务端模型接口。

将子域名（例如 `cumora.example.com`）A 记录指向服务器公网 IPv4。仅在服务器 IPv6 确实可达时配置 AAAA。首次验证建议 DNS 直连；已有 CDN 时需确认 WebSocket、SSE 转发和超时，不把长连接缓存。

云安全组和主机防火墙允许 TCP 80/443；SSH 仅向实际管理来源开放。不要公开 5181、5432、6379。若 firewalld 运行，先查看网卡所属 zone 和已有规则，再在实际公网 zone 放行 `http`、`https`；不要盲改默认 zone 或现有 SSH 规则。Compose 已将 API 绑定到 `127.0.0.1:5181`，PG/Redis 没有宿主机端口映射。

## 2. Clone 正确分支并准备配置

本轮发布分支为 `codex/cloud-self-hosting`。首次安装：

```bash
git clone --branch codex/cloud-self-hosting --single-branch https://github.com/CrissMagic/cumora.git
cd cumora
git status --short
git rev-parse HEAD
umask 077
cp -n deploy/cloud/.env.example deploy/cloud/.env
chmod 600 deploy/cloud/.env
```

私有仓库使用操作者自己的 Git 登录；不要把访问令牌嵌入 URL。若已有 checkout，先核对远端、分支和未提交文件，不直接覆盖。后续更新不要再次复制示例配置覆盖已填的文件。

编辑 `deploy/cloud/.env`：

| 变量 | 必填值 |
| --- | --- |
| `CUMORA_DOMAIN` | 实际子域名，不含 `https://`、端口、路径或斜杠 |
| `POSTGRES_PASSWORD` | 独立运行 `openssl rand -hex 32` 生成的十六进制密码，避免 URL 特殊字符 |
| `AGENT_RUNTIME_SECRET` | 再独立生成一份随机密钥，不使用源码中的开发默认值 |
| `OPENAI_API_KEY` | 服务端辅助模型功能使用的有效凭据 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 下节创建的 OAuth App 凭据 |
| `CUMORA_ADMIN_EMAILS` | 初始管理员在 GitHub 已验证的邮箱，多人用英文逗号分隔 |
| `CUMORA_IMAGE_TAG` | 首次可保留 `local`；升级时建议填写部署 SHA，便于识别镜像 |

两份随机值分别运行以下命令生成，在私密终端中填入配置，不要收集到安装日志：

```bash
openssl rand -hex 32
```

当前服务启动必填 `OPENAI_API_KEY`，辅助推理、图像/头像或嵌入等功能可能调用服务端模型。不要复制局域网试用的占位 key 并宣称功能正常。默认模型见 `server/src/env.ts`；若账号无对应模型权限，按实际能力填写 `OPENAI_MODEL`、`OPENAI_MODEL_SUPPORT` 并单独验证。此部署并未实现“完全无服务端模型凭据”的模式。本机智能体的模型登录和凭据另外保存在本机。

Compose 根据域名生成公共地址、CORS 和登录回跳配置；同源网页无需另设 API 地址。Android 的 `https://localhost` / `capacitor://localhost` 已在允许列表中，不使用通配符。

## 3. 配置固定登录入口

在 GitHub **Settings → Developer settings → OAuth Apps → New OAuth App** 创建应用：

```text
Homepage URL:               https://你的域名/
Authorization callback URL: https://你的域名/api/auth/callback/github
```

将 Client ID / Client Secret 写入服务器 `.env`。浏览器登录入口固定为 `https://你的域名/`；手机也使用此云端账号，不发布本地带 bearer token 的私人登录 HTML。

当前默认允许新用户通过 OAuth 注册工作区。若只供自己或受邀人员使用，管理员首次登录后，在管理界面检查注册暂停/候补名单设置并按需要开启；`CUMORA_ADMIN_EMAILS` 只设置管理员，**不是登录邮箱白名单**。不要把这个变量当作阻止其他 GitHub 用户注册的措施。

云端新数据库与本地试用库独立，即使使用相同邮箱，也不会自动拥有本地聊天、项目、设备配对或登录会话。历史数据迁移须另定备份、兼容性和切换方案。

## 4. 构建、迁移和启动

在仓库根目录为当前 Bash 会话定义函数，后续命令使用同一配置：

```bash
dc() {
  docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yaml "$@"
}
```

先执行配置校验（不输出展开后的秘密），然后构建。每一步成功后再执行下一步；失败时查明原因，不继续部署：

```bash
dc config --quiet
dc build app
dc up -d --wait postgres redis
dc run --rm --no-deps app npm run migrate
```

镜像构建使用本 checkout 的前后端；不拉取上游官方应用镜像。数据库迁移必须成功：服务启动只检查 schema，不自动替代迁移。此处数据库和 Redis 为独立 Compose 数据卷。

### 服务器尚无反向代理

确认 80/443 空闲且 DNS/防火墙已就绪：

```bash
dc up -d --wait app caddy
dc ps
dc logs --tail=100 app caddy
```

Caddy 自动签发与续期证书，证书状态保存在独立卷中。`Caddyfile` 为 SSE 设置即时刷新，WebSocket 升级由 Caddy 处理。

### 已有 Nginx / Caddy / 宝塔网站

只启动应用，不启动本 Compose 的 Caddy：

```bash
dc up -d --wait app
```

在已有代理中为实际子域名添加 HTTPS 站点，转发到宿主机 `http://127.0.0.1:5181`。如果代理在另一个容器中，`127.0.0.1` 指该容器自身，需另行配置受控内部连通，不能据此开放 5181 公网访问。

已有 Nginx 的站点代理核心配置如下；证书沿用该服务器既有签发流程。修改后先 `nginx -t`，成功才 reload，不覆盖其他站点：

```nginx
location / {
    proxy_pass http://127.0.0.1:5181;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

SELinux enforcing 下宿主机 Nginx 如被阻止代理连接，先检查 AVC 日志，再按该主机策略处理代理联网权限；不要用关闭 SELinux 代替定位。本配置附件/数据库采用 Docker named volume；自带 Caddy 的配置文件使用 `:ro,Z`，仅为这个专用文件设置容器可读的 SELinux 标签，不要求把宿主机目录整体改权限。

## 5. 云端验收

```bash
curl --fail --show-error --silent http://127.0.0.1:5181/api/health
curl --fail --show-error --silent https://你的域名/api/health
curl --fail --show-error --silent https://你的域名/api/auth/providers
```

- `dc ps` 中应用及依赖健康，公网证书有效且域名匹配；`providers` 包含 `github`。
- 电脑浏览器打开固定域名，通过 GitHub 登录，进入工作区。
- 浏览器网络面板确认 `/ws` 建立连接，页面刷新仍正常。
- 上传一个无敏感内容的测试附件，确认重启 `dc restart app` 后仍可读取。
- 检查服务器没有监听公网 PG、Redis、5181；不要以 Docker 容器内部的监听地址代替宿主机/安全组检查。

`/api/health` 成功不证明 OAuth、模型、长连接、电脑执行或真机推送已成功。邮件、FCM/APNs、对象存储未在此最小方案中配置，相关功能需要单独接入。

## 6. 本机电脑与 Android 接入

### 电脑端（在实际执行电脑操作）

电脑浏览器登录云端，在“添加电脑”取得该云端工作区配对码。配对码和本地试用设备令牌不能混用。本机主动向云端发起 HTTPS/SSE，请保持电脑开机、联网、daemon 运行，无需为它开放公网入站端口。

**当前已有局域网试用的这台 Windows/WSL 电脑，暂不能仅通过修改 URL 完成迁移。** `scripts/local-pc.ps1` / `local-wsl.mjs` 使用局域网配置，daemon 拒绝 `CUMORA_CONFIG_DIR` 下的内置配对和服务管理命令，以保护原官方实例。因此远程安装智能体应在这里交回本机接入步骤，记录“云端部署完成，本机隔离配对待配置”；不要远程改写现有 `.local/config.json`、`computer.json`、任务或设备令牌。

对于**没有旧 Cumora 实例的新电脑用户环境**，可以用同版本源码前台配对验证（不能在云服务器运行，否则任务执行位置会变成云服务器）。要求本机 Node.js 20+、Git，已安装并登录所需模型 CLI：

```bash
# 本节命令在新的 Linux/WSL 用户环境及其源码根目录执行。
# 不设置 CUMORA_CONFIG_DIR，不复用已有用户的 ~/.cumora。
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build --prefix agent-cli
CUMORA_AUTO_UPDATE=0 node agent-cli/dist/cli.js agent computer --pair <配对码> --server https://你的域名
```

最后一条配对成功后继续前台运行。确认电脑在线；后续启动使用同一 Linux 用户、同一源码构建和同样的 `CUMORA_AUTO_UPDATE=0`，去掉 `--pair <配对码>`。长期守护需配置指向这个源码 bundle 的独立服务；不要使用会拉取上游 npm 版的 `--install-service` 替代源码服务。新 WSL 用户还需自行配置该用户的模型登录、执行隔离依赖及联网，不能假定原用户的配置自动可用。

DeepSeek Harness / MiMo Code 等兼容引擎的凭据与执行模式见 [BYOA.md](BYOA.md)。不为通过安装而自动开启无沙箱模式。

在电脑网页创建项目、选择已配对且在线的执行电脑、绑定实际目录，等目录验证就绪后开始项目会话。WSL 目录用 `/mnt/e/...` 等 WSL 绝对路径，不用 `E:\...`。绑定不会替用户 clone、初始化或覆盖现有仓库；目录必须先存在。

此处电脑/移动端分工是产品入口限制，后端仍按账号、角色及设备归属鉴权，未增加“目录绑定必须由本机单独批准”的安全机制。

### Android

已有当前版本 APK 可在登录页底部的“API 服务器”填写 `https://你的域名`（不要加 `/api`），无需因更换域名重新打包。已登录时先退出，再切换服务器；切换会清除旧会话，之后登录云端账号。

手机只选已有项目进行聊天；项目创建、电脑关联和目录配置在电脑端完成。使用手机浏览器处理 OAuth；无需 USB，也不需要把电脑浏览器登录链接误当成手机唤起入口。更多说明见 [MOBILE_ANDROID.md](MOBILE_ANDROID.md)。

最终远程验收：手机关闭 Wi-Fi，使用移动网络；向绑定项目发送只读任务（如“查看当前目录与 Git 状态，不修改文件”），确认本机 daemon 收到任务、实际工作目录正确且回复返回手机。经用户确认再验证写入任务。不要在云端另 clone 一份仓库冒充本机执行验收。

## 7. 更新、备份与恢复

`deploy/cloud/.env` 已被 Git 忽略，数据在 named volume 中。固定 Compose 项目名为 `cumora-cloud`；不要改变项目名后误判数据丢失，也不要运行 `down -v` 或全局 volume prune。

更新前保留 Git SHA、镜像标记和备份；在维护窗口暂停写入并停止 app/Caddy 后备份数据库和附件，避免两者时间不一致。以下命令仅针对本方案专用卷，输出包含私人数据，勿提交或外传：

```bash
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# 使用已有代理时只停止 app，不停止其他网站的代理。
dc stop caddy app
dc exec -T postgres pg_dump -U cumora -d cumora -Fc > "backups/postgres-$stamp.dump"
dc run --rm --no-deps --entrypoint tar app -C /app/server/uploads -czf - . > "backups/uploads-$stamp.tar.gz"
```

检查每条命令退出状态及备份可读性，另外安全备份 `.env`。不要把命令生成了文件等同于备份成功。需要时备份 Redis AOF 和 Caddy 状态；离机备份须使用受控存储。仓库内 `backups/` 已忽略，仍建议把长期备份放到仓库外受保护位置。

确保工作区干净再 `git pull --ff-only`，记录新 SHA、按需更新 `CUMORA_IMAGE_TAG`，然后：

```bash
dc build app
dc run --rm --no-deps app npm run migrate
# 使用自带 Caddy：
dc up -d --wait app caddy
# 已有代理则仅执行：dc up -d --wait app
```

备份失败、构建失败或迁移失败时停止更新，不删除数据卷，不自动回退数据库。迁移后不能只切换旧镜像就声称完成回滚；应核对 schema 兼容性，必要时在隔离实例验证备份恢复，再决定正式恢复。此文不自动执行覆盖数据库的恢复操作。

## 常见问题与安装结果交付

| 现象 | 先检查 |
| --- | --- |
| 配置校验报必填值缺失 | `.env` 路径、必填值；不要打印文件正文 |
| 构建失败/OOM | 可用内存、磁盘、Docker/npm 镜像网络，保留实际错误 |
| schema 不兼容 | 是否对同一 Compose 数据库成功执行 `npm run migrate` |
| 证书失败 | A/AAAA、80/443、安全组、端口占用、Caddy 日志 |
| OAuth callback 错误 | GitHub 注册回调与实际域名一致、Client ID/Secret 有效、Redis 健康 |
| 手机跨域失败 | 服务地址仅 origin、Android origin 已允许、HTTPS 证书可信 |
| 电脑离线/回复迟迟不到 | 本机 daemon、出站网络、SSE 代理缓冲与超时、模型登录 |
| 目录校验失败 | 电脑选择、实际平台路径、目录存在且可读写、WSL 路径格式 |
| 数据“消失” | 是否连到新的实例/工作区、Compose 项目名及挂载卷是否改变 |

安装完成向操作者交付：部署 Git SHA、域名、使用的反向代理、配置文件位置（不含内容）、容器健康、迁移结果、OAuth/附件/长连接实际检查结果、备份位置，以及未完成的本机配对或真机验收项。不要以登录健康页替代完整业务验收。
