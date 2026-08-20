# 三 AI 協作協議（Planform 1.0 Release）

角色（正常狀態）：

| Agent | 角色 | 工作位置 | 寫入權限 |
|---|---|---|---|
| Claude | Lead / Technical Director | `D:\planform-iso`（main checkout，`release/planform-1.0-rc`） | 整個 repo（唯一整合者） |
| Codex | Implementation Engineer | `D:\planform-iso-codex`（git worktree，`codex/*` branch） | 只在自己的 worktree/branch |
| Grok | Adversarial Tester | 唯讀操作 repo；輸出寫到 scratch | 只寫 `_grok_round*/`、findings 報告檔 |

## 鐵則

1. 只有 Claude 可以 commit 到 `release/planform-1.0-rc` 與整合分支。
2. Codex 的變更一律留在 `codex/*` branch，由 Claude review diff 後 merge / cherry-pick。
3. Grok 不改產品 code；若必須改（重現腳本等），也走獨立 branch。
4. 三個 AI 永不同時編輯同一批檔案。`docs/agent-handoff/*` 由 Claude 寫入；
   Grok 的原始 findings 先落在 scratch 檔，由 Claude 整理進 `GROK_FINDINGS.md`。
5. 不自動 merge Release PR（#17）。最終 merge 由使用者決定。

## 狀態機

- 正常：Claude=Lead, Codex=Impl, Grok=Test
- Claude 被限額：Codex=Acting Lead（可修 P0/P1、跑測試、commit 到 RC branch；
  禁止 merge Release PR、改產品定位、重寫核心、刪大量功能、不可逆 migration、換框架）
- Claude 恢復：先 STOP AND REVIEW —— `git log <CLAUDE_PAUSED_SHA>..HEAD`、
  `GROK_FINDINGS.md`、測試結果，逐批 ACCEPT / FIX / REVERT，之後才恢復 Lead。

## Claude 恢復程序（給任何喚醒 Claude 的人/程序）

告訴 Claude：

> 你原本是 Planform 1.0 Release Lead。你因 usage limit 暫停。
> Codex 與 Grok 已依 handoff 繼續工作。
> 請先讀 docs/agent-handoff/CURRENT_STATE.md 與 GROK_FINDINGS.md，
> review 暫停期間所有 commits，然後重新接管 Lead。

## 環境事實（2026-08-20 偵測）

- Codex CLI 0.148.0，已登入（ChatGPT）。非互動：`codex exec -C <dir> -s workspace-write "<prompt>"`
- Grok CLI 1.0.5（`C:\Users\User\.grok\bin\grok.exe`），已登入。headless：`grok -p "<prompt>"`；
  agentic 自動核准：`grok --always-approve "<prompt>"`
- Claude CLI **未安裝**於 PATH——Claude 經 Claude Code 桌面 app 執行。
  supervisor 無法直接重啟 Claude session；到 retry 時間後由人工在 app 內恢復，
  或先安裝 CLI 後由 supervisor 偵測使用（見 scripts/agent-supervisor.ps1，不捏造指令）。
- Production：https://planform-iso-k7d2.zeabur.app （Zeabur，自動部署 GitHub main）
- Repo 另有 .github/workflows/deploy.yml（GitHub Pages）——第二部署線，非 canonical。
