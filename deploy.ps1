<#
.SYNOPSIS
  Windows 版部署脚本（对应 Linux 的 deploy.sh）。

.DESCRIPTION
  构建 DNotes 的 Windows 免安装目录（electron-builder --win dir），
  安装到 %LOCALAPPDATA%\Programs\DNotes，创建开始菜单快捷方式；
  如果 DNotes 正在运行，则先关闭，安装后重启为新版本。
  同时编译 Go CLI 到 %USERPROFILE%\.local\bin\dnote.exe。

.EXAMPLE
  .\deploy.ps1              # 打包并安装，同时安装 CLI
  .\deploy.ps1 -SkipBuild   # 跳过打包，直接安装 release\win-unpacked
  .\deploy.ps1 -CliOnly     # 只编译并安装 CLI
  .\deploy.ps1 -NoCli       # 不安装 CLI
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$CliOnly,
  [switch]$NoCli
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root

if ($CliOnly -and $NoCli) {
  Write-Error 'deploy: -CliOnly 和 -NoCli 不能同时使用'
  exit 2
}

# 运行外部命令，失败时终止（PowerShell 5.1 不会因原生命令退出码非 0 而抛异常）
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "deploy: '$Exe $($Arguments -join ' ')' 失败，退出码 $LASTEXITCODE" }
}

# 命令行工具 dnote（Go），装到 ~/.local/bin（与 Linux 保持一致）
$CliDir = Join-Path $env:USERPROFILE '.local\bin'
$CliDest = Join-Path $CliDir 'dnote.exe'
function Install-Cli {
  if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Warning 'deploy: 未找到 go，无法编译 CLI（可用 winget install GoLang.Go 安装）'
    return $false
  }
  New-Item -ItemType Directory -Force $CliDir | Out-Null
  # 先编译到临时文件再改名，避免覆盖正在运行的二进制时出错
  Push-Location (Join-Path $Root 'cli')
  try { Invoke-Native go @('build', '-o', "$CliDest.tmp", '.') } finally { Pop-Location }
  Move-Item -Force "$CliDest.tmp" $CliDest
  Write-Host "deploy: installed CLI -> $CliDest"
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') | Where-Object { $_.TrimEnd('\') -ieq $CliDir })) {
    Write-Warning "deploy: $CliDir 不在用户 PATH 中，请手动添加后才能直接运行 dnote"
  }
  return $true
}

if ($CliOnly) {
  if (-not (Install-Cli)) { exit 1 }
  exit 0
}

if (-not $SkipBuild) {
  # 首次在本机构建时先安装依赖（electron 二进制与平台相关，不能从 Linux 拷过来）
  if (-not (Test-Path (Join-Path $Root 'node_modules\.bin\electron-builder.cmd'))) {
    Write-Host 'deploy: node_modules 不完整，运行 npm install…'
    Invoke-Native npm @('install')
  }
  # 不做代码签名，避免 electron-builder 去找证书
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  Invoke-Native npm @('run', 'dist:win')
}

$Unpacked = Join-Path $Root 'release\win-unpacked'
if (-not (Test-Path (Join-Path $Unpacked 'DNotes.exe'))) {
  Write-Error "deploy: 打包后未找到 $Unpacked\DNotes.exe"
  exit 1
}

$Dest = Join-Path $env:LOCALAPPDATA 'Programs\DNotes'   # 固定目录，升级时直接替换，快捷方式无需改动
$Exe = Join-Path $Dest 'DNotes.exe'

# 只匹配从安装目录启动的进程，避免误杀开发模式下的 electron 等
function Get-DNotesProcess {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($Dest + '\', [StringComparison]::OrdinalIgnoreCase)
  }
}

$wasRunning = $false
if (Get-DNotesProcess) {
  $wasRunning = $true
  Write-Host 'deploy: stopping running DNotes…'
  # 先尝试正常关闭主窗口，给应用保存的机会
  Get-DNotesProcess | ForEach-Object { [void]$_.CloseMainWindow() }
  for ($i = 0; $i -lt 20 -and (Get-DNotesProcess); $i++) { Start-Sleep -Milliseconds 300 }
  Get-DNotesProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 20 -and (Get-DNotesProcess); $i++) { Start-Sleep -Milliseconds 300 }
}

# 进程退出后 Windows 可能稍晚才释放文件句柄（杀毒软件扫描也会短暂占用），重试几次
function Rename-WithRetry {
  param([string]$Path, [string]$NewName)
  for ($i = 1; ; $i++) {
    try { Rename-Item -LiteralPath $Path $NewName -ErrorAction Stop; return }
    catch {
      if ($i -ge 20) { throw "deploy: 无法重命名 $Path（文件被占用？）: $_" }
      Start-Sleep -Milliseconds 500
    }
  }
}

# 先复制到临时目录再替换，避免覆盖过程中留下半个安装
$Staging = "$Dest.new"
$Old = "$Dest.old"
foreach ($d in @($Staging, $Old)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null
Copy-Item -Recurse $Unpacked $Staging
if (Test-Path $Dest) { Rename-WithRetry $Dest (Split-Path $Old -Leaf) }
Rename-WithRetry $Staging (Split-Path $Dest -Leaf)
if (Test-Path $Old) { Remove-Item -Recurse -Force $Old -ErrorAction SilentlyContinue }
Write-Host "deploy: installed $Unpacked -> $Dest"

if (-not $NoCli) {
  if (-not (Install-Cli)) { Write-Warning 'deploy: skipping CLI' }
}

# 开始菜单快捷方式（可在开始菜单搜索 DNotes）
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$Lnk = Join-Path $StartMenu 'DNotes.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($Lnk)
$sc.TargetPath = $Exe
$sc.WorkingDirectory = $Dest
$sc.IconLocation = "$Exe,0"
$sc.Description = 'Markdown notes & journal'
$sc.Save()
Write-Host "deploy: shortcut -> $Lnk"

if ($wasRunning) {
  Write-Host 'deploy: starting DNotes…'
  Start-Process -FilePath $Exe -WorkingDirectory $Dest
}
