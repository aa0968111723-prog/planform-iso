# agent-supervisor.ps1 — Claude usage-limit handoff supervisor (honest, no fabricated CLIs).
#
# 職責：記錄 Claude 暫停時間、計算 retry 時間、到點後檢查 Claude CLI 是否可用。
# 它「不會」阻止 Codex / Grok 繼續工作，也不會 busy-loop。
#
# 用法：
#   pwsh scripts/agent-supervisor.ps1 record-pause     # Claude 被限額時記錄
#   pwsh scripts/agent-supervisor.ps1 status           # 查看目前狀態
#   pwsh scripts/agent-supervisor.ps1 watch            # 背景等待到 retry 時間後檢查
#
# 事實（2026-08-20 偵測）：本機 Claude 以 Claude Code 桌面 app 執行，`claude` CLI 不在 PATH。
# 因此本 script 只在 CLI 真的存在且支援 --resume/-p 時才嘗試自動喚醒；
# 否則到點時輸出人工恢復指引（開啟 Claude Code app → 恢復原 session →
# 依 docs/agent-handoff/AGENT_PROTOCOL.md 的「Claude 恢復程序」餵 context）。

param(
  [Parameter(Position = 0)]
  [ValidateSet("record-pause", "status", "watch")]
  [string]$Action = "status",
  [double]$RetryHours = 5,
  [int]$BackoffMinutes = 45
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $root "docs\agent-handoff\claude-pause.json"
$logFile = Join-Path $root "docs\agent-handoff\agent-supervisor.log"

function Log([string]$msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Host $line
}

function Get-ClaudeCli {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { return $null }
  try {
    $help = & $cmd.Source --help 2>&1 | Out-String
    return [pscustomobject]@{
      Path      = $cmd.Source
      HasResume = ($help -match "--resume|--continue")
      HasPrint  = ($help -match "(^|\s)-p[,\s]|--print")
    }
  } catch { return $null }
}

switch ($Action) {
  "record-pause" {
    $sha = (git -C $root rev-parse HEAD).Trim()
    $pausedAt = Get-Date
    $state = [pscustomobject]@{
      CLAUDE_PAUSED_AT  = $pausedAt.ToString("o")
      CLAUDE_RETRY_AT   = $pausedAt.AddHours($RetryHours).ToString("o")
      CLAUDE_PAUSED_SHA = $sha
    }
    $state | ConvertTo-Json | Out-File -FilePath $stateFile -Encoding utf8
    Log "Claude paused at $($state.CLAUDE_PAUSED_AT), sha $sha, retry at $($state.CLAUDE_RETRY_AT)"
    Log "Codex = Acting Lead（限制見 AGENT_PROTOCOL.md）；Grok 繼續測試。"
  }
  "status" {
    if (Test-Path $stateFile) { Get-Content $stateFile } else { "no pause recorded" }
    $cli = Get-ClaudeCli
    if ($null -eq $cli) { "claude CLI: not installed（用 Claude Code app 人工恢復）" }
    else { "claude CLI: $($cli.Path)  resume:$($cli.HasResume)  headless:$($cli.HasPrint)" }
  }
  "watch" {
    if (-not (Test-Path $stateFile)) { Log "no pause recorded — nothing to watch"; break }
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    $retryAt = [datetime]::Parse($state.CLAUDE_RETRY_AT)
    while ($true) {
      $wait = ($retryAt - (Get-Date)).TotalSeconds
      if ($wait -gt 0) {
        Log ("waiting {0:n0} min until retry window..." -f ($wait / 60))
        # 一次長睡到點，非 busy loop（上限 1 小時醒一次記 log，方便觀察）
        Start-Sleep -Seconds ([Math]::Min($wait, 3600))
        continue
      }
      $cli = Get-ClaudeCli
      if ($null -ne $cli) {
        try {
          $v = & $cli.Path --version 2>&1 | Out-String
          Log "claude CLI reachable: $($v.Trim())"
          Log "→ 依 AGENT_PROTOCOL.md 恢復程序 resume 原 session（優先）或開新 session 餵 handoff context。"
          if ($cli.HasResume) { Log "偵測到 resume 支援：claude --resume（或 --continue）" }
          break
        } catch {
          Log "claude CLI exists but errored: $($_.Exception.Message)（可能仍在限額）"
        }
      } else {
        Log "claude CLI 未安裝——請人工開啟 Claude Code app 恢復 Claude session，並依 AGENT_PROTOCOL.md 餵 context。"
        break
      }
      $retryAt = (Get-Date).AddMinutes($BackoffMinutes)
      Log "backoff $BackoffMinutes min, next retry $($retryAt.ToString('HH:mm'))"
    }
  }
}
