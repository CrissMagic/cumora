# Windows 覆盖安装排查

NSIS 的“Cumora 无法关闭，请手动关闭它，然后单击重试以继续”是通用提示。
除进程关闭失败外，旧版本卸载失败或文件覆盖失败也可能显示同一句话。
不能只凭这句话判定桌面 App 仍在运行。

## 当前已知的旧包升级问题

2026-11-13 的本机现场：安装目录无 Cumora / Electron 进程，Windows Restart
Manager 检查 824 个安装文件未发现占用；安装器停在旧版本卸载阶段。
旧包包含 `resources/app.asar.unpacked/node_modules/@capacitor/android/` 下的
Android `build/.transforms` 编译缓存。卸载器把旧文件移入临时目录的
`old-install/` 后，有 16 个目标路径达到或超过 260 个字符；旧卸载器未启用
长路径支持。这是当前最符合证据的失败原因，尚未以真实安装成功验证排除其他因素。

当前问题不是“应用没有退出”的证据，也不需要关闭独立运行的 BYOA、数据库
或连接服务。安装器失败时，不要直接删除用户数据、配对配置或模型登录文件。

## 使用短临时路径重试

先取消当前安装器，再在 PowerShell 中仅为新的安装器进程设置短临时目录。
临时目录应与已有安装目录同一磁盘：例如软件装在 `D:\software\Cumora`，
可以使用 `D:\ct`。短路径用于减少旧卸载器的备份路径长度；同盘用于满足
卸载器重命名文件的要求。

```powershell
$installer = 'C:\Downloads\Cumora-Setup.exe' # 换成实际安装包绝对路径
$installTemp = 'D:\ct'                      # 换成与安装目录同盘的短路径
$savedTemp = $env:TEMP
$savedTmp = $env:TMP

try {
    New-Item -ItemType Directory -Path $installTemp -Force -ErrorAction Stop | Out-Null
    $env:TEMP = $installTemp
    $env:TMP = $installTemp
    Start-Process -FilePath $installer -Wait
} finally {
    $env:TEMP = $savedTemp
    $env:TMP = $savedTmp
}
```

这不是全局修改系统 TEMP，也不迁移或清理安装目录。安装完成后确认默认服务器、
登录及已有配置仍正确。若仍失败，应读取实际安装日志、文件权限和占用状态，
不要将反复点击“重试”当作问题已解决。

## 后续打包修正

桌面包应排除 Android、iOS 与工具依赖中的编译缓存等非桌面运行文件。
仅重新打一个干净的新包，不能保证修复已经安装在电脑上的旧卸载器；
旧包的升级路径仍需要单独验证。当前文档记录诊断及重试方法，不宣称
安装包的此项缺陷已经修复。
