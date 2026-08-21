<#
.SYNOPSIS
  盤點本機與淡江／禪學社／E310／場刊相關的真實參考資料，產出可貼進
  docs/field-research/REFERENCE_MAPPING.md 的清單。

.DESCRIPTION
  依 docs/field-research/REAL_REFERENCE_CONTRACT.md §3 執行：

    - 只列「檔名 / 路徑 / 大小 / 修改時間」，不讀內容、不複製、不上傳
    - 只比對允許的副檔名
    - 硬性排除密碼、token、.env、credential、private key、AppData 等敏感位置
    - 預設輸出 *.local.md（已在 .gitignore，含人臉的照片路徑不會進 repo）

  拿到清單後，請把「結論」填進 REFERENCE_MAPPING.md，例如
  「E310 門寬 = 88 cm，量自 2026-03-11 社課照片 IMG_0421」。
  不要把照片本身 commit 進 repo。

.EXAMPLE
  pwsh -File scripts\audit-local-references.ps1

.EXAMPLE
  pwsh -File scripts\audit-local-references.ps1 -ExtraRoots 'D:\場務場刊E310','E:\社團' -Depth 8
#>
[CmdletBinding()]
param(
  # 額外要掃描的資料夾（例如 D:\場務場刊E310）
  [string[]] $ExtraRoots = @(),

  # 輸出檔（預設 *.local.md，不進 git）
  [string] $OutFile = 'docs/field-research/LOCAL_REFERENCE_AUDIT.local.md',

  # 遞迴深度
  [int] $Depth = 6,

  # 每個 root 最多列出的檔案數（避免產出爆量）
  [int] $MaxPerRoot = 400
)

$ErrorActionPreference = 'Stop'

# --- 允許的副檔名（合約 §3） -------------------------------------------------
$AllowedExt = @(
  '.jpg', '.jpeg', '.png', '.webp', '.heic',
  '.pdf', '.json', '.md', '.txt', '.csv',
  '.glb', '.gltf'
)

# --- 關鍵詞（合約 §3） -------------------------------------------------------
$Keywords = @(
  'E310', '淡江', '禪學社', '領袖', '社課', '茶會', '演講',
  '場刊', '場佈', '場布', '地墊', '巧拼', '報到', '收費',
  '鞋子', '背包', '生活組', '講師', '小組', '家族', '凝聚'
)

# --- 硬性排除：敏感資料與雜訊（不可放寬） ------------------------------------
$DenyPathPattern = @(
  '\\AppData\\', '\\Application Data\\', '\\\.git\\', '\\node_modules\\',
  '\\\.ssh\\', '\\\.aws\\', '\\\.azure\\', '\\\.gnupg\\', '\\\.config\\gh\\',
  '\\Microsoft\\Credentials\\', '\\Windows\\', '\\Program Files',
  '\\\$Recycle\.Bin\\', '\\\.vscode\\', '\\\.cache\\', '\\dist\\'
) -join '|'

$DenyNamePattern = @(
  '^\.env', 'credential', 'token', 'secret', 'password', 'passwd',
  '^id_rsa', '^id_ed25519', '\.pem$', '\.pfx$', '\.p12$', '\.key$',
  '\.keystore$', '\.jks$', 'cookies', 'login[-_]?data'
) -join '|'

# --- 掃描根目錄 --------------------------------------------------------------
$defaultRoots = @(
  [Environment]::GetFolderPath('MyDocuments'),
  [Environment]::GetFolderPath('MyPictures'),
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:USERPROFILE 'Downloads'),
  'D:\場務場刊E310'
)

# repo 的上一層（相關專案資料夾）
try {
  $repoRoot = (& git rev-parse --show-toplevel 2>$null)
  if ($repoRoot) { $defaultRoots += (Split-Path -Parent $repoRoot) }
} catch { }

$roots = @($defaultRoots + $ExtraRoots) |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
  Select-Object -Unique

if (-not $roots) {
  Write-Warning '沒有任何可掃描的資料夾。請用 -ExtraRoots 指定。'
  return
}

Write-Host "掃描 $($roots.Count) 個資料夾（深度 $Depth）..." -ForegroundColor Cyan

$keyRegex  = ($Keywords | ForEach-Object { [regex]::Escape($_) }) -join '|'
$rows      = New-Object System.Collections.Generic.List[object]
$rootStats = New-Object System.Collections.Generic.List[object]

foreach ($root in $roots) {
  Write-Host "  → $root" -ForegroundColor DarkGray
  $hits = 0
  $scanned = 0

  $files = Get-ChildItem -LiteralPath $root -Recurse -File -Depth $Depth -Force -ErrorAction SilentlyContinue

  foreach ($f in $files) {
    $scanned++

    if ($f.FullName -match $DenyPathPattern) { continue }
    if ($f.Name     -match $DenyNamePattern) { continue }
    if ($AllowedExt -notcontains $f.Extension.ToLower()) { continue }

    # 關鍵詞比對「路徑 + 檔名」，不讀檔案內容
    if ($f.FullName -notmatch $keyRegex) { continue }

    $rows.Add([pscustomobject]@{
      Root     = $root
      Path     = $f.FullName
      Name     = $f.Name
      Ext      = $f.Extension.ToLower()
      SizeKB   = [math]::Round($f.Length / 1KB, 1)
      Modified = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
    })

    $hits++
    if ($hits -ge $MaxPerRoot) {
      Write-Warning "  $root 命中已達上限 $MaxPerRoot，其餘略過（可調高 -MaxPerRoot）"
      break
    }
  }

  $rootStats.Add([pscustomobject]@{ Root = $root; Scanned = $scanned; Hits = $hits })
}

# --- 輸出 --------------------------------------------------------------------
$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine('# 本機真實參考資料盤點（機器產生，未經人工判讀）')
$null = $sb.AppendLine()
$null = $sb.AppendLine("- 產生時間：$(Get-Date -Format 'yyyy-MM-dd HH:mm')")
$null = $sb.AppendLine("- 機器：$env:COMPUTERNAME")
$null = $sb.AppendLine("- 掃描深度：$Depth")
$null = $sb.AppendLine('- 規則：只列路徑與 metadata，未讀取檔案內容；已排除 .env／token／credential／private key／AppData')
$null = $sb.AppendLine()
$null = $sb.AppendLine('> ⚠ 本檔可能含活動照片路徑（含人臉）。請**不要** commit，只把結論填進 REFERENCE_MAPPING.md。')
$null = $sb.AppendLine()

$null = $sb.AppendLine('## 掃描統計')
$null = $sb.AppendLine()
$null = $sb.AppendLine('| 資料夾 | 掃過檔案 | 命中 |')
$null = $sb.AppendLine('|---|---:|---:|')
foreach ($s in $rootStats) {
  $null = $sb.AppendLine("| $($s.Root) | $($s.Scanned) | $($s.Hits) |")
}
$null = $sb.AppendLine()

if ($rows.Count -eq 0) {
  $null = $sb.AppendLine('## 結果')
  $null = $sb.AppendLine()
  $null = $sb.AppendLine('**沒有命中任何檔案。** 可能原因：資料在別的磁碟／雲端資料夾、或檔名不含關鍵詞。')
  $null = $sb.AppendLine('請用 `-ExtraRoots` 指定實際位置後重跑。')
} else {
  $null = $sb.AppendLine("## 命中清單（$($rows.Count) 筆）")
  $null = $sb.AppendLine()

  foreach ($grp in ($rows | Group-Object Ext | Sort-Object Name)) {
    $null = $sb.AppendLine("### $($grp.Name)（$($grp.Count) 筆）")
    $null = $sb.AppendLine()
    $null = $sb.AppendLine('| 檔名 | 大小 (KB) | 修改時間 | 路徑 |')
    $null = $sb.AppendLine('|---|---:|---|---|')
    foreach ($r in ($grp.Group | Sort-Object Modified -Descending)) {
      $null = $sb.AppendLine("| $($r.Name) | $($r.SizeKB) | $($r.Modified) | `$($r.Path)` |")
    }
    $null = $sb.AppendLine()
  }

  $null = $sb.AppendLine('## 下一步（人工）')
  $null = $sb.AppendLine()
  $null = $sb.AppendLine('1. 挑出真正是 E310／社課／演講現場的照片與場刊圖。')
  $null = $sb.AppendLine('2. 對每張有用的圖，寫一行結論到 `REFERENCE_MAPPING.md`，例如：')
  $null = $sb.AppendLine('   `M-01 巧拼顏色 = 綠 | 來源 IMG_0421.jpg | high`。')
  $null = $sb.AppendLine('3. 有實測數字（門寬、地磚邊長、教室長）才可把 Confidence 升到 `verified`。')
  $null = $sb.AppendLine('4. **不要**把照片 commit 進 repo。')
}

Set-Content -LiteralPath $OutFile -Value $sb.ToString() -Encoding utf8
Write-Host ''
Write-Host "完成：$($rows.Count) 筆命中 → $OutFile" -ForegroundColor Green
