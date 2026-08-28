# 互動流程（Interaction Flow）— 實作計畫

> 這份文件是設計記錄，不是既成事實。實作進度見文末的「進度」一節。

## 怎麼來的

三份獨立設計，各自從不同角度出發，再由三位獨立評審對照實際程式碼評分。
分數很接近（49 / 48 / 47），而且**每一份都被找到致命傷** —— 這比一個乾淨的
贏家更有用，因為最後採用的是「勝出設計的骨架 ＋ 修掉評審點名的致命傷 ＋
嫁接兩個亞軍的關鍵想法」。

| 設計 | 分數 | 評審認為最值得保留的 | 致命傷 |
|---|---|---|---|
| One flow model, one engine | 49 | `next: undefined` means "the next row in `steps`" — list order IS the flow, and explicit ids are written only by skip options and matrix rules, which  | The funnel spawns every passer-by as a real agent, and the design simultaneously deletes the booth's live integrator in favour of the DES's precompute |
| Template-as-data, compiled to stations | 48 | One distinct route through the branches becomes one ParticipantProfile, and the per-branch service time rides on `ServiceStation | Enumerate-then-allocate silently replaces sampling with a deterministic quota, and the design's own migration walks into it |
| Steps ARE stations | 47 | Rolling the outcome at `tryStartService` rather than at arrival | `staffCount` is overloaded as both "how many humans" and "is this step open", so a self-service step cannot be expressed — and half the mandatory 心情 O |

---
# 互動流程（Interaction Flow）— 最終實作計畫

**Repo:** `D:/planform-iso` · branch `release/planform-1.0-rc` · 本文件為設計，未修改任何檔案。

**一句話：** 教室進場與攤位互動是同一件事——「一串有順序的步驟，其中幾步會分岔」。所以只留 **一個模型**（`InteractionTemplate`）、**一個引擎**（`eventFlow.ts` 的 `runDiscreteEvent` 迴圈）、**一個面板**（`flowPanel.ts`）。`boothFlow.ts` 整個刪掉，不移植。

三個評審設計都讀過；本計畫採用勝出設計的骨架，並**修掉評審點名的兩個致命傷**，同時嫁接兩個亞軍的關鍵想法：

| 來源 | 採用的東西 | 為什麼 |
|---|---|---|
| 勝出設計 | `next: undefined` = 「下一列」，列表順序**就是**流程 | 這一條讓可重排的純列表承載真的分岔，而不用變成 node editor |
| 勝出設計 | 同一站台的連續步驟 = **一次接待**（one reception） | 桌前四題是一個志工陪一個人，不是四段流水線；拆開會讓桌子吞吐量虛增三倍 |
| 亞軍 #1 | **漏斗是算術，不是 agent**：只有「真的參加的人」才進模擬 | 這一條同時修掉勝出設計的記憶體爆炸 **和** RNG parity 風險 |
| 亞軍 #3 | 分岔在 `tryStartService` 擲、時間直接落在 server 佔用上 | 「骰子面變長 → 隊伍變長」變成引擎既有機制的事實，不是標籤 |
| 亞軍 #3 的致命傷（反向採用） | `staffRoleId` 缺席 ≠ 沒人 → 新增 **`selfService`** 三態 | 「翻面看金句」不需要人顧；用 `staffCount:0` 表達會讓所有人永遠卡住 |

---

## 0. 先修掉評審點名的三個事實錯誤

實作前必須知道，因為勝出設計的文字在這三處與程式碼不符：

1. **`eventFlow.ts:291` 是 `shuffled(allocateProfiles(...), rng)`**，不是純 largest-remainder。那個 Fisher–Yates 消耗 `count-1` 次 `rng()`，上面有一整段註解說明為什麼必須存在（40/20 混流）。`runInteraction` 必須**無條件**保留這個 shuffle。省掉它，E310 的 RNG stream 位移 59 次呼叫，`arrivalMix.test.ts` 與 `eventFlow.test.ts` 的緊配對斷言（`Math.abs(stationMean - avgWaitSeconds) > 1`、95% prepaid 時 `combined.finishTime <= separated.finishTime`）正是會翻掉的那幾條。
2. **`enqueue`（`eventFlow.ts:405`）從來沒有看過 `queueCapacity`。** `queueCapacity` 只被 `refreshQueuePositions` 用來算 `maxCorridorOverflow`。「排太長就不排了」是**新行為**，必須是新欄位（`balkQueueLength`），預設關閉。
3. **`serviceVariance` 是變異數不是秒**：`serviceDuration` 取 `Math.sqrt(variance)` 當 σ，預設 `variance = mean * 0.2`（mean=45 → σ≈3.0 秒，不是 9 秒）。步驟的時間離散欄位必須沿用**同名同義**的 `serviceVariance`，編譯時逐字複製，否則 sqrt→square 的浮點來回就會讓 E310 不再 byte-identical。

還有一個 repo 陷阱，改 `playback` 前必讀：**`arrivalMix.test.ts:44-51` 靠「每個 agent 第一次不再是 `pending` 的那一幀」重建到場順序**，而且讀 `a.profileId`。因此 (a) 編譯後的教室 segment id 必須逐字是 `"prepaid"` / `"pay-on-site"`；(b) 把 `pending`/`done` 從 frame 濾掉是**等價**的（該測試本來就 `continue` 掉 pending），但這件事必須被明講，不能靠運氣。

---

## 1. 型別（完整、repo 風格、註解寫「為什麼」）

全部放進 `src/core/model.ts`，緊接在 `EventScenario` 與 `BoothConfig` 之後。`model.ts` 今天不 import 任何東西，維持這個狀態，行為一律放別處。

```ts
// --- v8+ 互動流程（Interaction Flow）------------------------------------
//
// 這個工具會排練的每一種流程，都是「一串有順序的步驟，其中幾步會分岔」：
// 教室進場（報到 → 收費 → 鞋子 → 入座）是這樣，攤位互動（經過 → 停下 →
// 參加 → 排隊 → 玩 → 離開）也是這樣。兩者真正的差別只有兩點——教室在門口
// 分一次流（預繳／現場），攤位在流程中間分岔（哪一面、哪個選項）；而且教室
// 的人全部會參加，攤位的人大多只是路過。其餘的一切（排隊、平行服務、服務
// 時間、站間移動、門、走廊溢出）本來就共用。
//
// 所以核心只有三個原語，沒有 Dice、沒有 Quiz、沒有 Booth：
//   step   — 一個人在一個地點做一件事，花一段時間
//   chance — 帶權重的分岔（骰子面、選項、做／跳過）
//   match  — 用先前答案查表得出的結果（4×4 的 OK 蹦金句表）
//
// 社團真的在做的活動是「心情 OK 蹦」：多題、每題多選、選項組合決定結果、
// 中間有自由書寫、最後領實體小物。如果核心寫死成 DiceEngine／QuizEngine，
// 這個真實活動就排不出來——這正是這個模型長成這樣的原因。
//
// 「引擎會讀的」（weight / 秒數 / next）與「人會看的」（label / prompt /
// 結果文字）是分開的欄位，所以多加第十六句金句永遠不需要動引擎。

/** 一個帶權重的選項：骰子的一面、快問快答的一個選項、或「做／跳過」。 */
export interface InteractionOption {
  id: string;
  /** 「還算喜歡」「拖延獸」。使用者自己打的字，核心永遠不寫死。 */
  label: string;
  /** 這一面自己的題目／台詞。只是內容，改它永遠不會改動模擬結果。 */
  prompt?: string;
  /** 相對權重，會在同一步內正規化。[1,1,1,1] 就是公平的四面骰。 */
  weight: number;
  /** 選到這一面時，在步驟本身時間之上「多花」幾秒。 */
  extraSeconds?: number;
  /** 記進 ChanceBranch.record 的值；之後的對照表用它查。省略時用 option.id。 */
  value?: string;
  /** undefined = 沿用步驟自己的 next；null = 到這裡就離開。 */
  next?: string | null;
}

/** 隨機分岔。擲一次骰，一次 rng()，而且只在真的有兩個以上選項時才擲。 */
export interface ChanceBranch {
  kind: "chance";
  options: InteractionOption[];
  /** 把選到的 option 的 value（或 id）記在這個 key 底下，供 match 步驟查。 */
  record?: string;
}

/** 對照表的一格。`when` 依 MatchBranch.on 的順序逐項比對，"*" 表示任意。 */
export interface MatchRule {
  when: string[];
  /** 訪客拿到的東西——一句金句、一個獎品、一條路線名。 */
  label: string;
  extraSeconds?: number;
  next?: string | null;
}

/**
 * 結果對照表：先前答過的題目決定現在發生什麼事。
 *
 * 這是查表不是擲骰，所以它**不消耗任何亂數**。這一點是刻意的：拿到哪一句
 * 金句不會改變你站在桌前多久，把它做成擲骰只會讓同一份場佈每次跑出不同
 * 的排隊長度，卻沒有換到任何真實資訊。
 */
export interface MatchBranch {
  kind: "match";
  /** 依序列出要查的 record key。["q1","q3"] 就是一張二維表。 */
  on: string[];
  rules: MatchRule[];
  otherwise?: Omit<MatchRule, "when">;
}

export type InteractionBranch = ChanceBranch | MatchBranch;

export interface InteractionStep {
  id: string;
  /** 主辦人自己的話：「歡迎」「Q1 科系真心話」「領 OK 蹦小卡」。 */
  name: string;
  /** 在哪裡發生。省略 = 沿用帶你到這一步的那一步的地點。 */
  stationId?: string;
  /** 平均秒數。0 合法——純粹的分岔不花時間。 */
  avgSeconds: number;
  /**
   * 時間離散程度。**這是變異數，不是秒數**，與 ServiceStation.serviceVariance
   * 同名同義（引擎取 sqrt 當 σ，省略時預設 avgSeconds * 0.2）。刻意不改成
   * 「秒」，因為編譯教室情境時要逐字複製 station.serviceVariance；改成秒就
   * 得 sqrt 再平方回去，浮點來回會讓 E310 不再逐位相同。面板用「大約差幾秒」
   * 呈現，寫入時平方，讀出時開根號——換算只發生在使用者自己打的值上。
   */
  serviceVariance?: number;
  /** 題目或指示。面板顯示，場刊圖會印出來。 */
  prompt?: string;
  branch?: InteractionBranch;
  /** 這一步需要準備的東西，印在場刊圖上（小卡、簽字筆、印章）。 */
  supplies?: string[];
  /**
   * undefined = steps 陣列的下一列（**列表順序就是流程**）
   * null      = 這個人做完了，離開
   * string    = 明確跳到某一步（只有「跳過」選項與對照表結果會寫）
   */
  next?: string | null;
}

/**
 * 步驟發生的地點。結構上就是一個 ServiceStation（所以 simSpatial 的
 * queuePlacement / buildTravelPath 直接吃，不需要任何轉接），只多兩個欄位。
 */
export interface InteractionStation extends ServiceStation {
  /** 哪個角色顧這裡。省略時看 selfService，再省略時沿用 staffCount 舊規則。 */
  staffRoleId?: string;
  /**
   * 這一關不需要人顧（翻一張卡、自己寫一句話）。
   *
   * 必須是獨立欄位，因為 effectiveServers 在 staffCount <= 0 時回 0，
   * 用「0 個工作人員」表達自助關會讓每個訪客永遠卡在那裡；而給它安排一個
   * 假的工作人員，又會讓人力負載那一行對著沒人服務的關說「一直有事做」。
   */
  selfService?: boolean;
  /** 到場時隊伍已經這麼長就直接走人。省略 = 沒有人會因為隊伍長而放棄。 */
  balkQueueLength?: number;
}

export interface StaffRole {
  id: string;
  /** 招呼 / 主持 / 陪聊 — 自由文字，核心永遠不做成 enum。 */
  name: string;
  count: number;
}

/**
 * 到場時的固定分流，就是教室的 ParticipantProfile。
 * 用 largest remainder 分配整數人頭，不擲骰——與今天完全一致。
 */
export interface AudienceSegment {
  id: string;
  name: string;
  /** 相對比例，會正規化。 */
  share: number;
  startStepId: string;
}

export interface InteractionAudience {
  /** 這段時間內「經過」的人數。攤位：路過的人。教室：受邀的人。 */
  count: number;
  windowSeconds: number;
  profile: ArrivalProfile;
  /** 0–1。經過的人裡有幾成會停下來看。受邀活動是 1。 */
  stopRate: number;
  /** 0–1。停下來的人裡有幾成真的參加。受邀活動是 1。 */
  joinRate: number;
  /**
   * 排幾秒會走掉。0 = 沒有人會走。
   *
   * 固定值、不隨機：加上個人耐心的抽樣要多擲一次骰，換來的是一個沒有人量
   * 測過的分佈，卻讓「同一份場佈跑兩次結果不同」多一個來源。1.0 不做。
   */
  patienceSeconds: number;
}

export interface InteractionTemplate {
  id: string;
  name: string;
  /** 自由備註；印在場刊圖的步驟表下面。 */
  note?: string;
  steps: InteractionStep[];
  startStepId: string;
  stations: InteractionStation[];
  staff: StaffRole[];
  audience: InteractionAudience;
  segments: AudienceSegment[];
  seed: number;
  settings: { speedMetersPerSecond: number };
  spatial?: SimulationSpatial;
}
```

### 對既有型別的四處小改

```ts
/**
 * 從四值 union 放寬成 string。執行期完全相同（"prepaid" / "pay-on-site"
 * 仍然合法，而且編譯教室情境時必須逐字保留——arrivalMix.test 讀 playback
 * 裡的 profileId 判斷混流），放寬只是為了讓編譯出來的 segment id 通過型別
 * 檢查。這不是 v9，因為它不改變任何已存檔案的內容。
 */
export type ParticipantProfileId = string;

export interface SimulationSpatial {
  // ...unchanged...
  /**
   * 入口／出口區的矩形。有了它，「排隊把入口堵住」才是一個可以被指出來的
   * 事實，而不需要在引擎裡跑一份取樣式的擁擠度累加器（取樣結果會隨
   * sampleDt 改變，那會讓「畫面精細度」偷偷改動統計數字）。
   */
  zones?: { id: string; name: string; x: number; z: number; width: number; depth: number }[];
}

export interface Project {
  // ...unchanged...
  /**
   * v8+ 互動流程。與 `booth` 一樣是選填欄位，不動 PROJECT_VERSION——舊版
   * build 讀到會忽略它，並沿用同一份檔案裡仍然保留的 `booth` 區塊。
   */
  interaction?: InteractionTemplate;
}
```

`PROJECT_VERSION` **維持 8**。`test/boothMigrate.test.ts:25` 明文守住這個承諾（`expect(PROJECT_VERSION).toBe(8)`），而互動流程和攤位一樣，每一個欄位都是選填的。

### 結果型別（`eventFlow.ts`，全部選填）

```ts
export interface StepStats {
  stepId: string;
  name: string;
  entered: number;
  avgSeconds: number;
  /** 每個選項被選到幾次：「怪獸：拖延 42 人」。沒有分岔的步驟沒有這個欄位。 */
  optionCounts?: { label: string; count: number }[];
}

export interface FunnelStats {
  /** 前三個是算術（見 audienceJoiners），後兩個來自這次模擬。 */
  passed: number; stopped: number; joined: number;
  completed: number; leftEarly: number;
}

export interface StaffLoadLine {
  roleId: string;
  roleName: string;
  /** 白話。原始比例永遠不會被印給使用者看。 */
  phrase: string;
  busyFraction: number;
  stationNames: string[];
  /** 這個角色底下有站點分到 0 個人 — 沒有人顧。 */
  shortage: boolean;
}

export interface StationStats {
  // ...unchanged...
  /** 這次實際開了幾個服務位。0 代表沒有人顧，與「0% 忙」是兩件事。 */
  servers: number;
}

export interface SimulationResult {
  // ...unchanged...
  /** 排太久走掉的人。教室情境永遠是 0。 */
  leftEarly: number;
  steps?: StepStats[];
  funnel?: FunnelStats;
  staffLoad?: StaffLoadLine[];
}
```

`steps` / `funnel` / `staffLoad` 是選填，所以 `simPanel`（本輪會刪）、`rehearsal.ts`、`adapters/eventFlow.ts`、`constructionPlan.ts` 都不需要為了編譯而改。`leftEarly` 是必填但由引擎產生，只在 `emptyResult` 多一行 `leftEarly: 0`。

---

## 2. 引擎：一份自訂步驟列表怎麼被執行

**沒有第二個引擎。** `src/core/eventFlow.ts` 多一個匯出函式，`runDiscreteEvent` 變成四行：

```ts
/**
 * 教室情境現在是互動模板的一種特例，而不是另一條程式路徑。
 * 為什麼保留這個包裝而不直接改呼叫端：EventScenario.profiles 存在已存檔的
 * 專案裡，也被 e310.test.ts 用結構斷言檢查。模型先落地，EventScenario 留
 * 著當教室的儲存格式，等有人重新核可 golden fixture 之後才退場。
 */
export function runDiscreteEvent(scenario: EventScenario, opts: RunOptions = {}): SimulationResult {
  return runInteraction(templateFromScenario(scenario), opts);
}
```

`runInteraction(template, opts)` 是今天那個迴圈，六處外科手術式改動。**完全不動**：event heap、`popEvent`、`snapshot` 的結構、`refreshQueuePositions`、`sendToStation`、`enqueue` 的位置語意、`tryStartService` 的找空 server 邏輯、`buildTravelPath`、`queuePlacement`、`routeThroughDoorways`、門與走廊瓶頸、`formatMin`、`emptyResult`、`runScenarioMedian`、`compareScenarioResults`、`compareScenarioVariants`、`cloneScenario`、`buildCheckinPaymentVariants`、`frameAt`。

### 改動 1 — agent 帶步驟游標，不帶 branch 陣列

```ts
interface AgentRuntime {
  // branch: string[];  branchIndex: number;   ← 移除
  stepId: string | null;
  /** 記住的答案，給 match 步驟查。一個 agent 一個小袋子，不是全域狀態。 */
  memory: Record<string, string>;
  /** 走完整條流程才算完成。排到一半走掉的人不能算完成。 */
  finished: boolean;
  // ...其餘不變...
}
```

### 改動 2 — 漏斗是算術，只有「真的參加的人」變成 agent

這是本計畫與勝出設計最大的分歧，也是最重要的一處：

```ts
/**
 * 經過 → 停下 → 參加，是三個乘法，不是三次擲骰。
 *
 * 把每個路過的人都生成一個 agent 有兩個代價，而且兩個都不划算：
 *  1. 記憶體。心情 OK 蹦的預設是 600 人 / 7200 秒。snapshot() 每一次取樣
 *     都為「每一個」agent 推一個物件；其中約 474 個人在 arrive 當下就被標
 *     成 done，接下來兩個模擬小時裡一動也不動，卻被序列化進每一幀。目標裝
 *     置是「筆電、平板或手機」，這件事不能做。
 *  2. 決定論。若在 arrive 依 stopRate/joinRate 擲骰，教室情境（兩者皆為 1）
 *     就得靠「只在 rate < 1 時才擲」這種條件式來維持 RNG stream——一個沒有
 *     測試守得住、下一個人改到就會壞掉的隱形契約。
 *
 * 算術版本兩個問題一起消失：不存在的 agent 不佔記憶體，也不擲骰。
 */
export function audienceJoiners(a: InteractionAudience): { passed: number; stopped: number; joined: number } {
  const passed = Math.max(0, Math.round(a.count));
  const stopped = Math.round(passed * clamp01(a.stopRate));
  const joined = Math.round(stopped * clamp01(a.joinRate));
  return { passed, stopped, joined };
}
```

`runInteraction` 用 `joined` 當 `arrivalTimes` 的人數。教室模板 `stopRate = joinRate = 1` → `joined = count = 60` → 逐位相同。

`arrive` 因此幾乎不變：

```ts
case "arrive": {
  agent.journeyStart = ev.t;
  agent.stepId = segmentOf(agent).startStepId;   // 分配好的，不擲骰
  const first = stationIdOfStep(agent.stepId);
  agent.x = stationMap.get(first)!.x;
  agent.z = stationMap.get(first)!.z;
  enqueue(agent, first, ev.t);
  break;
}
```

Segment 分配沿用今天那一行，**一字不改**：

```ts
// 保留 shuffled()：allocateProfiles 把同一個 segment 的人排在一起，而到場
// 時間是排序後逐一配對的，不打散就會讓收費桌前三分之二的時間閒著、然後被
// 二十個連續繳費者撞上。這是 seeded 的，所以重跑仍然一致。
const assigned = shuffled(allocateProfiles(joined, segmentsAsProfiles(tpl)), rng);
```

### 改動 3 — `tryStartService` 算的是「一次接待」，不是一次服務

```ts
/**
 * 同一個站台的連續步驟合併成一次服務。
 *
 * 桌前四題是一個主持人陪一個訪客走完，不是四段各自排隊的流水線。拆成四個
 * 單伺服器佇列會讓桌子的表面吞吐量變成三倍——那是這裡最傷的一種錯，因為
 * 「兩個主持人兩小時能做完幾個人」正是主辦人唯一真正要的數字。
 */
function runVisit(agent: AgentRuntime, tpl: CompiledTemplate, rng: () => number, tally: Tally):
  { seconds: number; next: string | null } {
  const here = stationIdOfStep(agent.stepId!);
  let cur: string | null = agent.stepId;
  let seconds = 0;
  const seen = new Set<string>();
  for (let hop = 0; cur && hop < 200; hop++) {
    const step = tpl.stepMap.get(cur);
    // 壞掉的 next 讓人離開，不會讓引擎爆掉；normalizeTemplate 應該已經修好，
    // 這裡是最後一道防線。
    if (!step || stationIdOfStep(step.id) !== here) break;
    if (seen.has(step.id)) break;            // 同一次接待內的迴圈：停下來
    seen.add(step.id);
    tally.enter(step.id);
    seconds += sampleDuration(step, rng);    // Box–Muller，兩次 rng()，順序同今天
    const out = resolveBranch(step, agent.memory, rng, tally);
    seconds += out.extraSeconds;
    cur = out.next !== undefined ? out.next
        : step.next !== undefined ? step.next
        : nextRowId(tpl, step);              // 列表的下一列
  }
  agent.stepId = cur;
  return { seconds, next: cur };
}
```

`sampleDuration` 就是今天的 `serviceDuration`，只換取值來源：

```ts
function sampleDuration(step: InteractionStep, rng: () => number): number {
  const mean = Math.max(1, step.avgSeconds);
  const variance = step.serviceVariance ?? mean * 0.2;   // 與今天逐字相同
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = mean + z * Math.sqrt(Math.max(0, variance));
  return Math.min(mean * 2.5, Math.max(mean * 0.3, raw));
}
```

`resolveBranch` 的擲骰次數是本設計的 parity 契約：

```ts
function resolveBranch(step, memory, rng, tally): { extraSeconds: number; next?: string | null } {
  const b = step.branch;
  if (!b) return { extraSeconds: 0 };                        // 0 次
  if (b.kind === "match") {                                   // 0 次：查表
    const keys = b.on.map((k) => memory[k] ?? "");
    const hit = b.rules.find((r) => r.when.every((w, i) => w === "*" || w === keys[i]));
    const out = hit ?? b.otherwise;
    if (out) tally.option(step.id, out.label);
    return { extraSeconds: out?.extraSeconds ?? 0, next: out?.next };
  }
  const opts = b.options.filter((o) => o.weight > 0);
  if (!opts.length) return { extraSeconds: 0 };               // 0 次
  // 只有一個選項的分岔是一個標籤，不是一個岔路，不能位移 stream。
  const pick = opts.length === 1 ? opts[0] : weightedPick(opts, rng());  // 1 次
  if (b.record) memory[b.record] = pick.value ?? pick.id;
  tally.option(step.id, pick.label);
  return { extraSeconds: pick.extraSeconds ?? 0, next: pick.next };
}
```

> **`runInteraction` 上方的 parity 規則註解，並由測試強制：**
> *編譯出來的教室模板不含任何 `chance` 分岔、`patienceSeconds === 0`、每個站台在每條鏈上只出現一次，因此每次站台造訪恰好一次 `sampleDuration`（兩次 `rng()`），順序與今天的 `serviceDuration` 完全相同。任何在編譯教室模板會走到的路徑上新增 `rng()` 呼叫的改動，都會被 `eventFlowParity.test.ts` 擋下來。*

`finishService` 變成：

```ts
st.served += 1;
if (!agent.stepId) { agent.state = "done"; agent.finished = true; agent.journeyEnd = ev.t; }
else sendToStation(agent, stationIdOfStep(agent.stepId), ev.t);
tryStartService(ev.stationId, ev.t);
```

`sendToStation` 一字未改，所以移動仍然沿動線走、仍然轉進門口、仍然記錄 door id。

### 改動 4 — 服務位的三態規則（這是統一 eventFlow / boothFlow 分歧的那一條）

```ts
/**
 * 一個站台這次開幾個服務位。三種情況，各有各的理由：
 *
 *  1. 指定了角色 → 用分到的人頭。分到 0 就是 0，會停擺，而且會被指名報告
 *     「桌前沒有人顧」。**不四捨五入成 1**——把 0 進位成 1 正是 boothFlow
 *     讓人力不足隱形的原因：三個人站在四關的桌子後面被讀成四個人。
 *  2. 標了 selfService → 永遠開著。翻一張卡不需要志工。
 *  3. 兩者皆無（= 編譯出來的教室站台）→ 今天的規則，一字不動。
 *     buildCheckinPaymentVariants 的「同桌」方案就是用 staffCount: 0 把收費
 *     站關掉的，那個行為必須逐位保留。
 */
function serversFor(st: InteractionStation, alloc: Map<string, number>): number {
  if (st.staffRoleId) {
    const n = alloc.get(st.id) ?? 0;
    return n <= 0 ? 0 : Math.max(1, Math.min(n, st.parallelServers));
  }
  if (st.selfService) return Math.max(1, st.parallelServers);
  return effectiveServers(st);                    // min(staffCount, parallelServers)，0 時為 0
}

/**
 * 把每個角色的人頭分到宣告它的站台上。largest remainder，服務時間長的先拿
 * 餘數，同秒時依站台順序 — 完全決定論，與 allocateProfiles 同一個形狀。
 */
function allocateStaff(roles: StaffRole[], stations: InteractionStation[]): Map<string, number>;
```

**人力不足會怎麼咬人：** 服務位 0 → `busyUntil` 是空陣列 → `tryStartService` 永遠找不到空位 → 隊伍不會消化 → 這些人出現在 `unfinished`，而且 `staffLoad` 裡那一行 `shortage: true`，面板直接寫「桌前沒有人顧，大家會卡在這裡」。這不是新的引擎機制，是 `effectiveServers` 本來就有、只是從來沒被講出來的行為。

### 改動 5 — 兩種離開，兩個新旗標，教室都不會踩到

```ts
// 到場即放棄：隊伍已經比這個站台能忍受的長。
// 注意：queueCapacity **不是**這個門檻。enqueue 從來沒讀過 queueCapacity，
// 它只被 refreshQueuePositions 用來算走廊溢出。硬把它當放棄門檻，會讓每一
// 個既有教室情境（queueCapacity 通常是 30–80）的行為悄悄改變。
if (st.def.balkQueueLength !== undefined && st.queue.length >= st.def.balkQueueLength) { ... }

// 等太久走人：只有 patienceSeconds > 0 才推事件，所以教室不會多出任何
// SimEvent，seq 與 heap 順序完全一致。
if (tpl.audience.patienceSeconds > 0)
  pushEvent(events, { t: t + tpl.audience.patienceSeconds, kind: "giveUp", agentId, stationId, seq: seq++ });
```

`giveUp` 觸發時若該 agent 仍在該站排隊：移出佇列、`refreshQueuePositions`、`leftEarly += 1`、`state = "done"`、`finished = false`。否則忽略（已經被服務了）。

### 改動 6 — 站台位置怎麼咬人（不新增任何空間程式碼）

`simSpatial.ts` 的幾何**完全不動**。位置影響瓶頸的三條路徑都是既有的：

- `queuePlacement` 依站台落在走廊還是教室、離牆多遠算出容量與車道；桌子推到主走道上，可用長度變短、`maxCorridorOverflow` 上升，`spatialBottlenecks` 就報「排隊會排到走道上（多出 N 人）」。這正是 boothFlow 從來做不到的事——它用固定的「四人一排」slot，桌子放哪裡都一樣。
- `buildTravelPath` + `routeThroughDoorways`：站台之間的距離與門是真的。
- **新增的入口／出口區報告**，用精確量而非取樣：

```ts
/**
 * 「排隊把入口堵住」。
 *
 * boothFlow 是每個 dt 掃一次每個人的座標累加秒數；那個數字會隨 dt 改變，
 * 也就是說「畫面多細」會偷偷改動統計。這裡改成看站台：落在入口／出口矩形
 * 裡的站台，它的尖峰隊長就是堵住那個區的人數。精確、與 sampleDt 無關、
 * 而且用的是引擎本來就在算的 maxQueue。
 */
for (const zone of tpl.spatial?.zones ?? []) {
  const peak = Math.max(0, ...stationsInside(zone).map((s) => stations[s.id].maxQueue));
  if (peak >= 3) spatialBottlenecks.push({ kind: "zone", id: zone.id, name: zone.name, x: zone.x, z: zone.z, count: peak });
}
```

`SpatialBottleneck["kind"]` 加入 `"zone"`。

### 改動 7 — playback 是呈現，不是統計（記憶體防線）

```ts
export interface RunOptions {
  sampleDt?: number;
  maxHorizonSeconds?: number;
  /**
   * playback 幀數上限，預設 900。超過就把取樣間距加倍（就地抽稀），所以
   * 一場兩小時的攤位不會產出 3600 幀。playback 只餵動畫，不參與任何數字：
   * refreshQueuePositions 在每一次入列／出列時都已經呼叫過，snapshot 再叫
   * 一次不可能看到更長的隊伍，所以 maxCorridorOverflow 與 sampleDt 無關。
   * 這件事由 sampleDtIrrelevant 測試守住。
   */
  maxFrames?: number;
}
```

`snapshot` 只推非 `pending`、非 `done` 的 agent（`App.applyDesFrame` 本來就把這兩種濾掉；`arrivalMix.test` 也是 `continue` 掉 `pending`，所以這是等價改寫）。600 人的攤位場景，尖峰場上人數約 20–40，每幀因此是幾十個物件而不是 600 個。

---

## 3. 步驟列表 UI（使用者看到的畫面，繁體中文）

`src/ui/flowPanel.ts` 取代 `simPanel.ts` 與 `boothSimPanel.ts`，掛在 UI.ts 既有的兩個掛載點（動線分頁裡的「模擬活動流程」、以及攤位專案的「模擬」分頁）。純 `el/num/textField/selectField/button/section` + 既有的 `menuSheet`。**沒有 canvas、沒有拉線連節點、沒有座標、沒有箭頭。**

面板有兩種型態，由專案內容決定：

### 型態 A — 快速設定（專案有 `scenarios`、沒有 `interaction`）

E310 主辦人知道的就是這五個數字，逼他改用步驟列表不是改進。這一段**維持今天的樣子**：

```
模擬活動
填人數與人力，按「▶ 模擬」看會不會塞車。不用網路、不用 AI。
 [人數 60]  [其中現場繳費 20]
 [報到人力 2]  [收費人力 1]  [多久內到齊(分) 15]

這一場的流程（照著跑）
 1. 走廊入口   2. 走廊引導   3. 走廊排隊   4. 報到
 5. 現場收費（只有現場繳費的人）   6. 鞋子   7. 後牆長桌   8. 巧拼座區
 ⓘ 這是從上面的設定自動排出來的。想改順序或加步驟，按下面。
 [ 改成我自己的流程 ]
```

新增的只有那份**唯讀**步驟表（教室流程第一次被看見）與那顆按鈕。按下去 → `project.interaction = templateFromScenario(scenario)`，之後模板說了算、可以完整編輯；`project.scenarios` 原封不動留著給舊版 build。可逆（刪掉模板就回到情境）。這保證 golden 專案的數字**只有在有人按了一顆寫著「改成我自己的流程」的按鈕之後**才會變。

### 型態 B — 步驟列表（專案有 `interaction`）

**這場活動**（用主辦人的詞彙，措辭依 `stopRate < 1` 切換）

```
這場活動
 受邀活動：  [來幾個人 60]        [多久內到齊 20 分]
 攤位：      [每小時大概幾個人經過 300]  [擺多久 2 小時]   → count=600, window=7200
 [大概幾成會停下來看 30 %]     ← stopRate；等於 1 時整行不顯示
 [停下來的人，幾成會真的參加 70 %]
 [排多久會走掉 3 分]           ← 0 = 不會走
 ⓘ 每小時 300 人經過、三成停下來、七成參加 → 這次會有 126 個人真的玩到。
```

最後那行即時算給人看，因為它就是模擬真正的輸入。

**人手**

```
人手
 [招呼]  [1 人]   顧：( 攤位前 ) 桌前  發卡處          [刪除]
 [主持]  [2 人]   攤位前 ( 桌前 ) 發卡處              [刪除]
 [發卡]  [1 人]   攤位前  桌前 ( 發卡處 )             [刪除]
 [＋ 新增角色]
 ⓘ 主持 2 人，顧：桌前。
```

站台 chip 切換 `station.staffRoleId`。沒有被任何角色認領、也沒有勾「不用人顧」的站台，會顯示灰字提示「這一關還沒有人顧」。每個站台旁邊一個小勾：**「這一關不用人顧」**（`selfService`）。

**互動流程**（列表本體）

```
互動流程
[↑][↓]  1. 歡迎打招呼          [地點▾ 攤位前]  [平均 15 秒]  [⋯]
        提示：要不要玩一個一分鐘的小活動？
        接著做下一項

[↑][↓]  2. Q1 科系真心話        [地點▾ 桌前  ]  [平均 25 秒]  [⋯]
        提示：你對自己的科系，真心話是？
        這一步會分岔        面數： (4)  6   8   自訂
          · 還算喜歡        機會 25 %   多花 0 秒   接著：下一項
          · 有點後悔        機會 25 %   多花 5 秒   接著：下一項
          · 只是不討厭      機會 25 %   多花 0 秒   接著：下一項
          · 完全不是我想的  機會 25 %   多花 0 秒   接著：下一項
          [＋ 新增選項]        ☑ 記住這一題的答案

[↑][↓]  3. Q2 用一句話形容      [地點▾ 桌前  ]  [平均 40 秒]  [⋯]
        提示：用一句話寫下現在的心情
        接著做下一項
```

每一步的六個控制，就是需求點名的那六個：**改名**（就地 `textField`）、**上移／下移**（`↑`/`↓` 交換 `steps` 相鄰兩項）、**複製**、**刪除**（在 `[⋯]` 裡，沿用 `menuSheet.ts`）、**平均時間**（`num`）、**下一步**（`selectField`）。

> **讓純列表不變成 node editor 的那一條規則：順序具有權威。**
> `next: undefined` 就是「下一列」，「下一步」控制在使用者沒改之前一律顯示 **「接著做下一項」**。重排列表就是重排流程——`↑`/`↓` 交換兩個陣列元素，流程真的變了，複製／刪除不需要修任何邊。明確的 id 只有「跳過」選項與對照表結果會寫，寫了之後那一列就顯示 **「跳到：領 OK 蹦小卡」**，於是跳躍看得見，不會藏在一張使用者看不到的圖裡。`null` 顯示 **「到這裡就結束，離開」**。

`[⋯]` 選單：`改名 · 複製這一步 · 刪除 · 加一個分岔 · 加一個結果對照表 · 移除分岔 · 這一關不用人顧`。

**分岔（chance）** 是該步驟自己那一列裡的縮排子清單，**永遠不是另一個畫面**。面數 chip `4 / 6 / 8 / 自訂 N` 呼叫 `setOptionCount(step, n)`：往後補「面 5」「面 6」…或從尾端刪，並重新正規化權重。每個選項一列：名稱、機會 %（即時正規化，所以四個 25 就是四個 25）、多花幾秒、題目、接著（預設「同這一步的下一步」）。**骰子和快問快答是同一個控制**，差別只在使用者往 label 裡打了什麼字。`☑ 記住這一題的答案` 設定 `branch.record`，而這是讓一個步驟能被對照表使用的唯一開關。

**結果對照表（match）** 是一張**表格**——社團本來就是在紙上畫成表格的。選它時問「根據哪幾題？」，兩個 `selectField` 列出有勾「記住答案」的步驟；接著畫出一個 grid，列標題是 Q1 的選項名、欄標題是 Q3 的選項名，每一格一個 `textField`（那格的結果）＋一個「多花幾秒」。編一格寫一條 `MatchRule`。Q1 加到第五個選項，表格自己長成 5×4。

**範本**

```
範本
 [ 存成我的互動模板 ]   （問名字，寫進 localStorage）
 套用模板：  空白流程 · 心情 OK 蹦 · 骰子小遊戲 · 快問快答 · 教室進場
             我的：期初擺攤 v2 [刪除]  社課報到 [刪除]
 ⓘ 套用時會用「名字」對回這份場佈的站點；找不到的會放在場地中央，套用後
   會告訴你哪幾個要自己拖到位。
```

存檔時丟掉站台的 x/z 與 zone/object 綁定，只留名字——這樣把模板帶到另一個場地，不會把別人的座標一起搬過來。

**演練**

```
[▶ 演練一次] [⏸ 暫停] [重來]   慢 · (正常) · 快

經過 600 人 → 停下來看 180 人 → 開始參加 126 人 → 完成 99 人
排最久的地方：桌前（最多排 7 人，平均等 3 分 10 秒）
主持的人幾乎沒停過；招呼的人大部分時間在等人
有 21 人排太久走掉了
排隊會排到走道上（多出 4 人）——桌子往內縮 50 公分
每一步：Q3 怪獸 126 人做過，最多的是「拖延獸」42 人
```

因為只有一個面板，兩件事現在對所有專案都成立：**在攤位平面圖上按「演練一次」演練的是攤位自己的步驟**（稽核第 7 項），而且場刊圖的「模擬摘要」不論來自哪一種計畫都拿到同一組 `summaryLines`。

---

## 4. 心情 OK 蹦：純資料，核心零特例

放在 `src/core/interactionPresets.ts`。**核心裡沒有任何一行骰子或問答專屬程式碼**——這份東西和空白流程用的是同樣的三個原語。

三個站台，因為活動有三個實體地點、而且每個地點的人不同：

| id | 名稱 | staffRoleId | parallelServers | queueCapacity |
|---|---|---|---|---|
| `st_front` | 攤位前 | `greeter` | 2 | 6 |
| `st_table` | 桌前 | `host` | 2 | 6 |
| `st_card` | 發卡處 | `helper` | 1 | 4 |

`staff: [{id:"greeter",name:"招呼",count:1},{id:"host",name:"主持",count:2},{id:"helper",name:"發卡",count:1}]`

九個步驟，依列表順序。除了最後一步，每一個 `next` 都是 `undefined`（= 下一列）：

1. `s_greet` **歡迎打招呼** — `st_front`, 15 s，提示「要不要玩一個一分鐘的小活動？」
2. `s_q1` **Q1 科系真心話** — `st_table`, 25 s，提示「你對自己的科系，真心話是？」
   ```ts
   branch: { kind: "chance", record: "q1", options: [
     { id:"a", label:"還算喜歡",       weight:1, value:"like" },
     { id:"b", label:"有點後悔",       weight:1, value:"regret" },
     { id:"c", label:"只是不討厭",     weight:1, value:"meh" },
     { id:"d", label:"完全不是我想的", weight:1, value:"wrong" },
   ]}
   ```
3. `s_q2` **Q2 用一句話形容** — `st_table`, 40 s，提示「用一句話寫下現在的心情」。**沒有分岔。** 自由書寫的步驟不需要引擎任何新功能：它就是一段時間加一句提示。那 40 秒是真的會出現在隊伍裡的。
4. `s_q3` **Q3 哪隻怪獸最煩你** — `st_table`, 25 s，`record: "q3"`，四個選項：拖延獸 / 比較獸 / 內耗獸 / 焦慮獸（`value: delay / compare / drain / anxious`）
5. `s_q4` **Q4 轉念練習** — `st_table`, 45 s，提示「把剛剛那句話換個說法寫下來」。**沒有分岔。**
6. `s_pick` **對出 OK 蹦金句** — `st_table`, 10 s — **4×4 對照表**
   ```ts
   branch: { kind: "match", on: ["q1", "q3"], rules: [
     { when:["like","delay"], label:"金句 1-1" }, …共 16 條，一格一條…
     { when:["wrong","anxious"], label:"金句 4-4" },
   ], otherwise: { label:"通用金句" } }
   ```
   每一條都可以自己帶 `extraSeconds`（某句要多解釋一下）與自己的 `next`。社團實際的活動裡十六條都往第 7 步走，所以每一條的 `next` 都留白。面板把它畫成 4×4 grid，Q1 在左、Q3 在上——就是社團自己在紙上畫的那張表。
7. `s_back` **選卡片背面** — `st_card`, 20 s，選填的三面 `chance`（權重 1,1,1，不 `record`）——純情調，不花額外機制
8. `s_flip` **翻面看金句** — `st_card`, 15 s，`selfService: true`（自己翻，不需要志工；這正是 `selfService` 存在的理由）
9. `s_give` **領 OK 蹦小卡** — `st_card`, 20 s，提示「背面印期初演講時間／地點／QR」，`supplies: ["OK 蹦小卡","印章"]`，**`next: null`** — 訪客離開

觀眾：`{ count: 600, windowSeconds: 7200, profile: "uniform", stopRate: 0.30, joinRate: 0.70, patienceSeconds: 180 }`

**引擎會拿它做什麼：** 步驟 2–6 全在 `st_table`，所以它們合併成**一次接待** 25+40+25+45+10 ≈ 145 秒（加上選項的額外秒數），整段由一個主持人佔住。`host.count = 2` 大約是每小時 50 人，兩小時約 99 人——而參加的人有 126 個，所以桌前會排隊、會有人走掉，而這就是這個活動真正的限制，也是主辦人需要的那個數字。把「焦慮獸」加長 30 秒，桌前隊伍量得出來會變長，`optionCounts` 同時告訴你有幾個人撞到那一面：「每一面時間會改變隊伍長度」是**可觀察的**，不是宣稱的。

其他四個 preset 都是同樣的三個原語：**空白流程**（一個步驟）、**骰子小遊戲**（一個六選項 `chance`、選項沒有名字、不 `record`）、**快問快答**（三個連續的 `chance` 步驟）、**教室進場**（`templateFromScenario(createDefaultScenario(...))` 的輸出，八個線性步驟、沒有分岔）。

---

## 5. 教室情境（E310）怎麼原封不動

**Stage 1 完全不動 `EventScenario`**——磁碟上不動、golden 測試不動。E310 的 `scenarios[0]`（60 人、900 秒、front-loaded、40/20、八個 typed 站台）一個位元都不改，`buildE310GoldenProject` 不改，`e310.test.ts` 與 `eventFlow.test.ts` 不編輯。

改變的只有：情境不再由一條獨立的程式路徑執行。`templateFromScenario(scenario)`（`interactionCompile.ts`，約 70 行）把它翻成模板：

- 每個 `ServiceStation` → `InteractionStation`（**同一個物件展開即可**；`staffRoleId` 與 `selfService` 都不設，所以 `serversFor` 落到今天的 `min(staffCount, parallelServers)`，「同桌」方案用 `staffCount: 0` 關掉收費站的行為原樣保留）
- 每個 `ParticipantProfile` → `AudienceSegment`，`share = ratio`，**id 逐字保留**（`"prepaid"` / `"pay-on-site"`，因為 `arrivalMix.test` 從 playback 讀它）
- 每個 profile 的 `branch: string[]` → 一條線性步驟鏈，一站一步，`avgSeconds = station.profileServiceSeconds?.[profileId] ?? station.meanServiceSeconds`，`serviceVariance = station.serviceVariance`（**逐字複製，不做單位換算**），沒有 branch，`next` 指向下一環，最後一環 `next: null`
- `audience = { count, windowSeconds: arrivalWindowSeconds, profile: arrivalProfile, stopRate: 1, joinRate: 1, patienceSeconds: 0 }`

因為 `stopRate`/`joinRate` 是 1，`audienceJoiners` 直接回傳 `count`，沒有漏斗擲骰；因為 `patienceSeconds` 是 0，沒有 `giveUp` 事件、`seq` 與 heap 順序不變；因為每個站台在每條鏈上只出現一次、也沒有任何 branch，`runVisit` 每次站台造訪剛好做一次 `sampleDuration`（兩次 `rng()`），順序與今天相同；因為 shuffle 保留，`assignedProfiles` 的位移也相同。結果逐位相同。**這是本設計的核心主張，由 Step 1 的 fixture 守住，而且 fixture 先於重構進版。**

`buildCheckinPaymentVariants`（同桌／分桌／走廊比較）本輪**不動**：它仍然產生 `EventScenario` 變體，仍然走那個四行包裝。

---

## 6. 檔案清單

### 新增

| 檔案 | 行數 | 內容 |
|---|---|---|
| `src/core/interactionCompile.ts` | ~210 | `templateFromScenario`、`templateFromBooth`、`normalizeTemplate`（解析繼承的 `stationId`、修壞掉的 `next`/`stationId`、建 `stepMap`、算 `nextRowId`）、`audienceJoiners`，以及純函式的列表編輯輔助：`addStep / moveStep / duplicateStep / removeStep / setOptionCount / setMatchCell / setStepStation`。面板不放任何邏輯。 |
| `src/core/interactionPresets.ts` | ~200 | 五個起手模板，全部是資料 |
| `src/state/templateLibrary.ts` | ~120 | `listTemplates / saveTemplate / applyTemplate / deleteTemplate`，key `planform-iso:interaction-templates`，完全照 `projectRepository.ts` 的形狀：版本化索引、防禦式解析、`storage()` 回 null 時退化成記憶體 |
| `src/ui/flowPanel.ts` | ~460 | 上面那整個面板 |
| `test/eventFlowParity.test.ts` + `test/fixtures/e310-des.json` | ~60 + fixture | **重構前先寫先進版** |
| `test/interactionFlow.test.ts` | ~280 | 引擎與模型性質（含 `boothFlow.test.ts` 原本斷言的每一條） |
| `test/interactionMigrate.test.ts` | ~110 | 遷移與回溯相容 |

### 修改

| 檔案 | ± | 內容 |
|---|---|---|
| `src/core/model.ts` | +125 | 上面那整塊型別、`SimulationSpatial.zones?`、`Project.interaction?`、`ParticipantProfileId` 放寬、檔頭補一段「互動流程搭選填欄位、不升版」的說明（與 `BoothConfig` 那段同一份契約） |
| `src/core/eventFlow.ts` | +250 / −45 | `runInteraction`、`runVisit`、`resolveBranch`、`sampleDuration`、`serversFor`、`allocateStaff`、`giveUp` 事件、balk、漏斗／步驟／人力統計、入口區報告、`maxFrames`；`runDiscreteEvent` 變四行 |
| `src/core/migrate.ts` | +110 | `migrateInteraction` / `migrateInteractionStation` / `migrateStep`、booth→template 預設、`resolveTemplateBindings`（沿用既有的 `resolveStationPosition` / `zoneParallelServers` / `buildSimulationSpatial`）；import 從 `boothFlow` 改到 `boothCatalog` |
| `src/core/simSpatial.ts` | +12 | `buildSimulationSpatial` 多回一個 `zones`（只有 `boothRole` 是 entry/exit 的）。幾何三函式一字不動 |
| `src/core/boothCatalog.ts` | +130 | 吸收 `BOOTH_STATION_TYPES`、`BOOTH_SIM_PRESETS`、`defaultBoothParams`、`createBoothStation(s)`、`isBoothProject`（**語意逐字不變**，只是換家；`validation.ts` 與 `SceneManager.ts` 只改 import 路徑） |
| `src/core/venues.ts` | +12 / −3 | 攤位 preset 除了照舊寫 `booth` 區塊（給舊版 build），再從 preset 種一份 `interaction`（心情 OK 蹦） |
| `src/app/App.ts` | +115 / −175 | 一個播放迴圈取代 booth RAF 迴圈；`session.booth` → `session.flow`；`applyBoothFrame` → 讀 DES 本來就產出的 `playback` 幀；`overlayStations()` 改讀 `interaction.stations`；`runInteractionSimulation()`；sampleDt 依時長選（`clamp(horizon/600, 1, 30)`） |
| `src/ui/UI.ts` | +25 / −25 | 兩個掛載點都掛 `flowPanel`；`模擬` 分頁對「有 `interaction` 或有 `scenarios`」的專案都出現 |
| `src/export/constructionPlan.ts` | +55 | 場刊圖新增「互動流程」區塊：編號步驟＋提示，有分岔的步驟把選項名字縮排列出，有 `supplies` 的併進物資清單。**用印的，不畫成圖** |
| `src/adapters/eventFlow.ts` | +20 | 對 Quick Agent 曝露 `runInteraction`；既有 tool signature 不動 |

### 刪除

| 檔案 | 行數 |
|---|---|
| `src/core/boothFlow.ts` | −556（`BoothSim`、`JOURNEY_ORDER`、`SKIP_RATE`、`runBoothHeadless`、第二套 walker 積分器、第二套排隊規則） |
| `src/ui/boothSimPanel.ts` | −242 |
| `src/ui/simPanel.ts` | −190 |
| `test/boothFlow.test.ts` | −165（改寫進 `interactionFlow.test.ts`，原本每一條斷言都保留） |

刪掉 `boothFlow.ts` 直接消滅稽核第 2、3、4、5、6 項：`JOURNEY_ORDER`、封閉的八值步驟 union、缺席的權重、寫死的 join/skip 常數，以及會蓋掉每站編輯的 params 層——**它們沒有繼任者**。

---

## 7. 遷移

### 已存的教室專案（`EventScenario`）
開起來和今天完全一樣。`migrateProject` 不碰 `scenarios`，`interaction` 不存在，`runDiscreteEvent` 每次執行時即時編譯。**磁碟上一個位元都不會變**，直到使用者按下「改成我自己的流程」；即使按了，`scenarios` 也是保留而不是刪除。

### 已存的攤位專案（`BoothConfig`）
開起來步驟列表已經填好。在 `migrateProject` 既有的 `migrateBooth` 之後：

```ts
p.interaction = migrateInteraction(input.interaction);
if (!p.interaction && p.booth) p.interaction = templateFromBooth(p.booth, p);
if (!p.interaction) delete p.interaction;
```

`templateFromBooth`（約 80 行）是把 `boothFlow.ts` 原本寫死的東西一次性、忠實地抄成資料，所以這份計畫模擬的還是它一直在模擬的那個活動——只是現在主辦人看得到也改得動：

- 8 個 `BoothStation` → 8 個 `InteractionStation`，保留 id、名稱、x/z、`parallelServers`、`queueCapacity`
- 模組常數 `JOURNEY_ORDER` → **步驟的列表順序**。這正是重點：它從常數變成使用者可以重排的資料，而且**同一種型別的第二個站台終於進得了流程**（`.find(byType)` 的 bug 沒有繼任者）
- 寫死的 `SKIP_RATE` → 每一步一個兩選項 `chance`：`{做, weight: 1-r} / {跳過, weight: r, next: <下一步>}`。數字原樣保留，而且從此可編輯
- `params.deskStaff` → 一個 `talker` 角色，掛在對談站；`talkSeconds` / `boardDwell` / `gameDwell` → 那三步的 `avgSeconds`。**這一步結束稽核第 5 項**：不再有一個 params 層可以蓋掉每站的編輯
- `params.visitorCount` / `arrivalPerMin` → `audience.count` / `windowSeconds`（`stopRate = joinRate = 1`，因為 boothFlow 的 visitorCount 本來就是「會進來的人」）；`balk: true` → `patienceSeconds = 114`（boothFlow 的 `patience*3` 中位數。**這份計畫原本寫 54，那是算錯的**：`patience = 18 + rand*40` 的中位數是 38，不是 18；乘 3 是 114。實作用 114）與各站 `balkQueueLength = queueCapacity`（**這是唯一一處把 queueCapacity 當放棄門檻，因為 boothFlow 本來就是那樣，而且只發生在攤位轉換路徑上**）
- `enabled: false` 的站台：該步驟不進 `steps`，站台保留（重新啟用只要加回一步）

`booth` 區塊**留在檔案裡，凍結、不再被讀**。這保住 repo 既有的契約：舊版 build 打開攤位計畫，帳篷、區域、動線照樣畫，流程照樣跑它認得的那一套。`interaction` 一旦存在就永遠勝出。

`migrateInteraction` 的防禦風格與 `migrateBoothStation` 一致：

- 沒有 `id` 或 `name` 的步驟 → 丟掉
- `next` 指向不存在的步驟 → 變成 `null`（這個人離開），**而不是刪掉那一步**
- `stationId` 指向不存在的站台 → 退回第一個站台
- **不認得的 `branch.kind` → `branch` 變成 `undefined`，步驟連同名字、時間、next 一起活下來**。這是稽核第 3 項的直接修法：不再有封閉的步驟詞彙可以讓一個步驟在載入時被靜默丟掉，因為步驟名稱就是使用者打的字
- 權重全為 0 或選項為空的 `chance` → 當成沒有分岔
- `startStepId` 指向不存在的步驟 → 改指第一步

---

## 8. 實作順序（由小到大，每一步都獨立可測，每一步結束時 `npm run verify` 全綠）

每一步的 gate 都是 `npm run lint && npm run typecheck && npm run test && npm run build`。

**Step 1 — 先立守門員（不改任何行為）**
新增 `test/eventFlowParity.test.ts` 與 `test/fixtures/e310-des.json`。快照四組跑：(a) `runDiscreteEvent(buildE310GoldenProject(e310).scenarios[0], {sampleDt:5})`、(b) `runDiscreteEvent(resolveScenarioBindings(p, scenario), {sampleDt:5})`、(c) `eventFlow.test.ts` 的 `miniScenario()` seed 42、(d) `buildCheckinPaymentVariants` 的 A/B/C 三個 `runScenarioMedian`。快照排除 `playback`，其餘全部進去。測試檔要像 `arrivalMix.test.ts` 一樣裝 localStorage shim。
同一步再加 `sampleDt 不影響任何統計` 測試（同情境跑 sampleDt 1/2/5/13，比較排除 playback 後的結果全等）。
*為什麼先做：* 這一步把「逐位相同」從主張變成可檢查的事實，而且是在還沒有任何東西可能弄壞它之前。

**Step 2 — 型別落地（無行為）**
`model.ts` 加入整塊型別、`SimulationSpatial.zones?`、`Project.interaction?`、放寬 `ParticipantProfileId`。`eventFlow.ts` 加 `StationStats.servers`（填 `effectiveServers(s)`）與 `SimulationResult.leftEarly`（恆 0）。
*測試：* `interactionMigrate.test.ts` 第一條——一個帶手寫 `interaction` 的專案 round-trip 之後型別完整；`PROJECT_VERSION` 仍是 8。parity fixture 必須仍然全綠（新增欄位會改快照 → 這一步同時更新 fixture 並在 commit message 說明「新增 servers/leftEarly 兩個欄位，其餘逐位相同」；之後的每一步都不准再動 fixture）。

**Step 3 — 編譯器（純函式，還沒有人用）**
`interactionCompile.ts`：`templateFromScenario`、`normalizeTemplate`、`audienceJoiners`、六個編輯輔助。
*測試：* 編譯 E310 情境 → 8 站、2 segment、兩條線性鏈、`stopRate/joinRate = 1`、`patienceSeconds = 0`、**沒有任何 `chance` 分岔**、segment id 逐字是 `"prepaid"`/`"pay-on-site"`、每個步驟的 `serviceVariance` 與來源站台 `Object.is` 相等。編輯輔助的性質測試。

**Step 4 — 引擎（`runDiscreteEvent` 成為包裝）**
`runInteraction` 與六處改動。這是最大的一步，也是唯一一步 parity fixture 有話要說的。
*測試：* `eventFlowParity.test.ts` 必須零改動通過；`e310.test.ts`、`eventFlow.test.ts`、`arrivalMix.test.ts`、`crowd.test.ts`、`partner.test.ts` 全部零改動通過。新增 `interactionFlow.test.ts` 的引擎性質（見 §9）。

**Step 5 — 遷移與 preset（資料流通）**
`migrateInteraction`、`templateFromBooth`、`resolveTemplateBindings`、`interactionPresets.ts`。把 `BOOTH_STATION_TYPES` / `BOOTH_SIM_PRESETS` / `defaultBoothParams` / `createBoothStation(s)` / `isBoothProject` 搬進 `boothCatalog.ts`（純搬家，語意不動），`migrate.ts` / `venues.ts` / `validation.ts` / `SceneManager.ts` 只改 import。`venues.ts` 的攤位 preset 同時寫 `booth`（相容）與 `interaction`（心情 OK 蹦）。
*測試：* `interactionMigrate.test.ts` 全部；`boothMigrate.test.ts`、`boothVenue.test.ts`、`boothValidation.test.ts` 零改動通過。此時 `boothFlow.ts` 只剩 `BoothSim` / `runBoothHeadless`，仍在跑。

**Step 6 — 面板（一個取代兩個）**
`flowPanel.ts`；`UI.ts` 兩個掛載點都改掛它；`App.ts` `session.booth` → `session.flow`、booth RAF 迴圈刪掉改用既有的 `playEventResult` / `applyDesFrame` 路徑、`overlayStations()` 改讀 `interaction.stations`。
*測試：* 把 `test/boothFlow.test.ts` 的每一條性質改寫進 `interactionFlow.test.ts`（見 §9 第 11–14 條），然後**刪掉** `boothFlow.ts` / `boothSimPanel.ts` / `simPanel.ts` / `boothFlow.test.ts`。`npm run build` 是這一步真正的 gate（死掉的 import 會炸）。e2e 冒煙：`e2e/` 裡任何點「模擬」分頁的流程要重跑。

**Step 7 — 匯出與模板庫**
`constructionPlan.ts` 的「互動流程」區塊；`templateLibrary.ts`；面板的「存成我的互動模板／套用模板」。
*測試：* `planContent.test.ts` 風格的斷言——場刊圖含每個步驟名與提示、含選項名、**不含**任何 `next`/`weight`/id；模板庫在 `localStorage` 不可用時不丟例外（照 `storeRecovery.test.ts` 的形狀）。

**Step 8 — 教室的選擇性升級**
快速設定底下的唯讀步驟表 ＋「改成我自己的流程」按鈕；`adapters/eventFlow.ts` 曝露 `runInteraction`。
*測試：* 按下去之後 `project.scenarios` 依然存在且未修改；轉換後第一次跑的結果與轉換前**逐位相同**（因為 `templateFromScenario` 是同一個函式）；刪掉 `interaction` 之後回到情境路徑。

---

## 9. 測試計畫（每一條指名它必須擋下來的那個變異）

**Parity / 回溯（`eventFlowParity.test.ts`）**

1. `E310 golden 的每一個統計逐位不變` — 擋下：拿掉 `shuffled()`、把 `serviceVariance` 改成秒、在教室會走到的路徑上多擲一次骰、改動 `seq` 的推入順序、把 `arrive` 改成擲 stop/join。
2. `sampleDt 不改變任何統計` — 擋下：把 `maxCorridorOverflow` 或任何新統計（入口區、staffLoad）做成 snapshot 取樣累加。
3. `A/B/C 三個變體的 median 逐位不變` — 擋下：`serversFor` 對沒有 role、沒有 selfService 的站台改用 `max(1, parallelServers)`（那會讓「同桌」方案的收費站復活）。

**模型與引擎（`interactionFlow.test.ts`）**

4. `列表順序就是流程：交換兩個相鄰步驟會改變造訪順序` — 擋下：把 `next: undefined` 實作成「指向原本下一步的 id」（那樣重排就變成裝飾）。
5. `match 分岔不消耗亂數` — 同一個模板，把 16 條規則洗牌／改文字，逐位相同結果；把矩陣整個拿掉則結果改變（證明它有被執行到）。擋下：把對照表做成擲骰。
6. `單選項的 chance 不位移 stream` — 一個兩步模板，第二步加一個 `weight:1` 的單選項分岔，結果與沒有分岔時逐位相同。擋下：無條件擲骰。
7. `同一站台的連續步驟是一次接待` — 心情 OK 蹦：`st_table` 的 `served` 等於「進到 s_q1 的人數」，不是它的五倍；且該站的 `busyServerSeconds / served` ≈ 145 s。擋下：把每個步驟都當成獨立佇列（那會讓桌子吞吐量虛增三倍）。
8. `某一面變長會讓隊伍變長` — 把「焦慮獸」的 `extraSeconds` 從 0 改成 40，`st_table` 的 `maxQueue` 嚴格變大，且 `optionCounts` 裡「焦慮獸」的人數不變。擋下：把 `extraSeconds` 只當顯示用而沒有加進服務時間。
9. `自由書寫步驟不需要任何引擎功能` — 刪掉 s_q2/s_q4 之後 `st_table` 的平均接待時間正好少 85 秒。擋下：為自由書寫加特例。
10. `完全自訂流程真的被模擬吃進去` — 從空白模板手動組出「打招呼 → 抽一張卡 → 聊天 → 寫祝福 → 領禮物 → 離開」，六步、無 dice/quiz 字樣，跑出 `completed > 0`、六個 `StepStats`、每一步 `entered > 0`。**這一條是需求裡「若自訂流程只停在 UI 就是徹底失敗」的守門員。**
11. `人力不足看得見` — `host.count` 從 2 降到 1，`maxQueue` 嚴格變大、`completed` 嚴格變小；`host.count` 降到 0 時該站 `servers === 0`、`staffLoad` 那行 `shortage: true`、`unfinished > 0`。擋下：把 0 進位成 1（boothFlow 的老毛病）。
12. `自助關不需要人也不會卡住` — s_flip（`selfService: true`、沒有角色）在每個角色人數都設成 0 時仍然 `served > 0`。擋下：用 `staffCount: 0` 表達自助關（會讓所有人永遠卡住）；也擋下讓 `staffRoleId` 缺席就等於自助（那會打壞第 3 條）。
13. `站台位置會改變瓶頸` — 把 `st_table` 推進主走道，`spatialBottlenecks` 出現 `kind: "corridor"` 且 `count` 隨推進距離單調上升。擋下：回到 boothFlow 那種「四人一排」的固定 slot 排隊。
14. `入口被堵住是精確量` — 桌子搬到入口區裡 → 出現 `kind: "zone"` 的瓶頸；且該 `count` 在 sampleDt 1/5/13 下完全相同。
15. `漏斗是算術而且不生 agent` — `count:600, stop:.3, join:.7` 的模板，`funnel.passed === 600`、`joined === 126`，而 `playback` 任何一幀的 agent 數 `<= 126`（實務上遠低於）。**擋下：把每個路過的人都生成一個 agent**（那是 600 × 3600 幀的記憶體炸彈，也是本設計最重要的一條守門員）。
16. `記憶體上限` — 心情 OK 蹦預設跑完，`playback.length <= 900`，且 `JSON.stringify(result.playback).length` 小於某個上限；跑完時間 < 2000 ms（沿用 `eventFlow.test.ts` 既有的預算風格）。
17. `排太久會走掉，而且教室永遠不會` — `patienceSeconds: 180` 的攤位 `leftEarly > 0`；`patienceSeconds: 0` 時 `leftEarly === 0` 且事件數與沒有這個欄位時完全相同。
18. `原 boothFlow.test 的每一條性質仍然成立` — 同種子可重現、不修改傳入的專案、尖峰隊伍比正常長、對談時間加倍等待變久、桌前 3 → 6 人流失變少、關掉「等太久會離開」沒有人流失、排隊區縮小流失變多、關掉一個站點其餘照跑、完成數不超過到場數、每個人最後都會離開。

**遷移（`interactionMigrate.test.ts`）**

19. `不認得的 branch.kind 保住步驟` — 塞一個 `{kind:"telepathy"}`，步驟仍在、名稱／秒數／next 都在、`branch` 變成 undefined。擋下：回到「不認得就丟掉」（稽核第 3 項）。
20. `壞掉的 next 讓人離開，不刪步驟`；`壞掉的 stationId 退回第一個站台`。
21. `攤位專案遷移後 booth 區塊仍在、且 interaction 勝出`；`第二個同型別站台進得了流程`（`JOURNEY_ORDER` 的 `.find()` bug 不會復活）。
22. `每站編輯不會被 params 蓋掉` — 改一步的 `avgSeconds`，round-trip 之後值還在。擋下：稽核第 5 項復發。
23. `PROJECT_VERSION 仍是 8`，且刪掉 `interaction`／`booth`／`boothRole` 之後仍是完整可用的計畫（沿用 `boothMigrate.test.ts` 的「舊 schema 仍讀得懂」那一條）。

---

## 10. 誠實的風險清單

| # | 風險 | 嚴重度 | 對策 |
|---|---|---|---|
| 1 | **Step 4 的 parity 沒過。** 迴圈重寫牽涉 `seq` 順序、事件推入時機、RNG 呼叫點三件事，任一處錯位就是 59 次呼叫的偏移。 | 高 | fixture 先於重構進版（Step 1），失敗訊息會直接指出是哪個欄位先分歧。若真的收斂不了，退路是 `runDiscreteEvent` **保留今天的迴圈**、`runInteraction` 獨立存在——兩個函式共用 `sampleDuration` 與所有 helper 但不共用主迴圈。那會留下約 120 行重複，違反「一個引擎」的精神，但仍然刪掉 boothFlow、仍然只有一個模型一個面板。**這個退路只在 fixture 連續兩天過不了時才啟用，而且要在 commit 裡寫明。** |
| 2 | **一次接待的合併會讓「每站等待」在攤位上看起來偏低**：五題合併成一次服務，中間四次「等待」變成 0。 | 中 | 這是正確的建模（那四題本來就沒有排隊），但面板的措辭要跟上：桌前顯示的是「一輪要 2 分 25 秒」而不是五個各自的等待。`StepStats.avgSeconds` 保留每一步的秒數，所以資訊沒有消失。 |
| 3 | **`templateFromBooth` 的 `patienceSeconds = 114` 是換算出來的，不是量測的。** boothFlow 是 `18 + rand*40`，再乘 3。 | 中 | 遷移時在 `template.note` 寫一行「這個數字是從舊版設定換算的估計，請依現場調整」，面板顯示 note。**不假裝它是量到的**（`noFabricatedData.test.ts` 的精神）。 |
| 4 | **面板規模。** 460 行是這個 repo 單一 UI 檔的上緣（`UI.ts` 1430 行是例外）。 | 中 | 所有邏輯（重排、正規化、矩陣格、選項增刪）都在 `interactionCompile.ts` 當純函式並單獨測試，面板只負責畫。若仍然過大，先切出 `flowStepList.ts`。 |
| 5 | **模板套用到別的場地時站台對不上。** 用名字比對是啟發式的。 | 低 | 對不上的站台放在場地中央，並明確告訴使用者「這 2 個站點我放在中間，請拖到位」。不靜默、不猜座標。 |
| 6 | **`ParticipantProfileId` 放寬會讓拼錯的 profile id 不再被編譯器擋。** | 低 | 目前全 repo 只有 `eventFlow.ts` 與 `model.ts` 提到它（已 grep 確認），而 `migrateProfile` 本來就接受任意字串。把四個教室慣用值留成 `CLASSROOM_PROFILE` 常數供 `buildCheckinPaymentVariants` 使用。 |
| 7 | **`isBoothProject` 搬家時語意漂移**（`SceneManager` 靠它決定戶外地面，`validation` 靠它決定攤位規則）。 | 低 | 純搬家、一字不改，並保持 `venues.ts` 繼續寫 `booth` 區塊。重新定義成「有攤位區域／資產」是**下一輪**的事。 |

## 11. 這一輪不做（release freeze §88）

- **不退休 `EventScenario`。** 它存在已存檔案裡、也被 golden 測試用結構斷言檢查。它在 Stage 1 之後就不再是一條執行路徑，只是教室的儲存格式。退休它需要有人重新核可 golden fixture——那是一次人為決定，不是一次重構。
- **不升 `PROJECT_VERSION`。** 互動流程和攤位一樣搭選填欄位；`boothMigrate.test.ts` 明文守住 8。
- **不刪 `Project.booth`。** 凍結、不再讀，但留在檔案裡，這樣舊版 build 打開攤位計畫仍然畫得出帳篷、跑得動它認得的流程。
- **不做 node editor。** 沒有畫布、沒有拉線、沒有節點座標。需求明文說是純列表，而且 §3 那條「順序具有權威」的規則就是為了讓純列表夠用。
- **不做每個人不同的耐心值。** 要多一次擲骰，換來的是一個沒人量過的分佈，卻讓「同一份場佈跑兩次結果不同」多一個來源。固定值。
- **不把互動模板接進 A/B 比較。** `buildCheckinPaymentVariants` 這一輪只服務 `EventScenario`。「兩種擺法哪個順」對攤位當然有意義，但那是另一份設計。
- **不把教室的快速設定換成步驟列表。** 那五個欄位是 E310 主辦人真正知道的東西；步驟列表對一個中途從不分岔的流程不是改進。升級是一顆按鈕，而且可逆。
- **不做模板雲端分享、不做多場次、不做跨專案模板同步。** 本機 localStorage，就這樣。
- **不動 `simSpatial.ts` 的幾何三函式**（`buildTravelPath` / `queuePlacement` / `routeThroughDoorways`）。它們是整個設計「站台位置會咬人」的地基，而且已經對了。唯一的改動是 `buildSimulationSpatial` 多回一個入口／出口區清單。
- **不做步驟列表內部的獨立 undo。** Store 既有的歷史已經涵蓋，再加一層只會出現兩個互相打架的 undo 堆疊。

---

**關鍵檔案（絕對路徑）**
`D:\planform-iso\src\core\model.ts` · `D:\planform-iso\src\core\eventFlow.ts` · `D:\planform-iso\src\core\boothFlow.ts`（刪） · `D:\planform-iso\src\core\migrate.ts` · `D:\planform-iso\src\core\simSpatial.ts` · `D:\planform-iso\src\core\boothCatalog.ts` · `D:\planform-iso\src\core\venues.ts` · `D:\planform-iso\src\app\App.ts` · `D:\planform-iso\src\ui\UI.ts` · `D:\planform-iso\src\ui\simPanel.ts`（刪） · `D:\planform-iso\src\ui\boothSimPanel.ts`（刪） · `D:\planform-iso\src\export\constructionPlan.ts` · `D:\planform-iso\src\state\projectRepository.ts`（模板庫的樣板） · `D:\planform-iso\test\e310.test.ts` · `D:\planform-iso\test\eventFlow.test.ts` · `D:\planform-iso\test\arrivalMix.test.ts` · `D:\planform-iso\test\boothMigrate.test.ts` · `D:\planform-iso\docs\field-research\LOCAL_REFERENCE_AUDIT.md`

---

## 進度

| Step | 狀態 | commit |
|---|---|---|
| 1. 先立守門員（parity fixture） | ✅ | `test/eventFlowParity.test.ts` + `test/fixtures/e310-des.json`；順手抓到 `utilization` 在無人力站台是 `NaN` |
| 2. 型別落地（無行為） | ✅ | `model.ts` 的互動型別、`SimulationSpatial.zones?`、`Project.interaction?`、`StationStats.servers`、`SimulationResult.leftEarly` |
| 3. 編譯器（純函式） | ✅ | `src/core/interactionCompile.ts` + 16 個測試 |
| 4. 引擎（`runDiscreteEvent` 變包裝） | ✅ | `7c8b42c`；parity fixture 零改動通過，`test/interactionFlow.test.ts` 13 條 |
| 5. 遷移與 preset | ✅ | 常數搬家、`templateFromBooth`、`migrateInteraction`、`resolveTemplateBindings`、`interactionPresets.ts`；10 個變異全部被擋下 |
| 6. 面板（一個取代兩個） | ⬜ | |
| 7. 匯出與模板庫 | ⬜ | |
| 8. 教室的選擇性升級 | ⬜ | |

### Step 5 做到一半才發現、計畫裡沒寫的三件事

1. **零秒步驟必須真的不佔服務位。** 型別註解寫著「0 是合法的——純分岔不花時間」，
   但引擎照樣讓它排隊、並吃掉 `sampleDuration` 的一秒下限。攤位的「要不要坐坐墊」
   因此會變成「先排隊等一個空坐墊，才能說我不坐」。引擎多了 `isDecision`：
   `avgSeconds <= 0` 的步驟到場即決定、不排隊、不佔位，選項的 extraSeconds 變成
   站著想的時間。教室沒有任何零秒步驟，parity fixture 零改動。
2. **跳過要跳到下一站的第一列，不是下一站的服務。** 計畫寫的
   `next: do__<下一站>` 會略過下一站自己的「要不要」，於是被跳過的那一站之後
   每一站都變成必經。實測跳過率因此整個歪掉（坐墊實得 23/40，應為 10/40）。
3. **攤位站台要標 `selfService`。** boothFlow 從來沒讀過 `staffCount`，每站就開
   `parallelServers` 個位置；照抄成有人顧的站台會讓 `effectiveServers` 取
   `min(staffCount=1, 3)`，三格展示板悄悄縮成一格。

**Step 2 是唯一一次允許動 parity fixture 的步驟**（新增兩個欄位，逐鍵正規化比對
證明其餘六組跑法完全相同）。Step 4 之後每一步都必須零改動通過。
