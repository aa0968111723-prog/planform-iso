/**
 * Prop Studio — 建立與編輯 3D 道具 (§6-10, §14-15, §23-24, §44-46).
 *
 * The flow the brief demands and nothing past it: 想做什麼 → 尺寸 → 外觀 →
 * 互動 → 儲存. Everything is numbers, chips and a live preview; no vertex, no
 * UV, no node graph, no dragging as the only path (§73 — a phone user types
 * centimetres and taps 「放在◯◯上面」).
 *
 * The studio edits a DRAFT copy. Every edit autosaves the draft to
 * localStorage (§76 — a refresh must not eat a half-built dice); committing
 * writes through App into `project.props`, which makes further edits undoable
 * through the store like any other change (§75).
 *
 * One face record: the table here edits the definition's SEED options — the
 * same option objects that will drive the 3D faces, the panel row and the
 * result display once placed. After placement the live copy is
 * `project.interaction`, edited in flowPanel; 編輯道具 on a placed prop reseeds
 * from there deliberately, never in parallel.
 */

import type { App } from "../app/App";
import { createPropPreview, type PreviewAngle, type PropPreview } from "./propPreview";
import { FINISH_CHOICES } from "../scene/propVisual";
import { overlappingParts, relatePartOffset } from "../core/propEdit";
import { propPreset, PROP_PRESETS } from "../core/propPresets";
import { boothPropsByCategory } from "../core/boothPropPresets";
import { blankPropDraft, PROP_STUDIO_CATEGORIES, type PropDraftKind } from "../core/propDraft";
import { getAssetBlobStore } from "../assets/idbStore";
import { saveLibraryProp } from "../state/propLibrary";
import { uid, type InteractionOption, type PropAnchor, type PropDefinition, type PropPart } from "../core/model";
import { button, el, num, section, selectField, textField } from "./dom";

const DRAFT_KEY = "planform-iso:prop-draft";

export interface PropStudioOptions {
  /** Edit an existing project definition; absent = build a new one. */
  edit?: PropDefinition;
  /** How many placed objects share the edited definition (drives §71). */
  instanceCount?: number;
  /**
   * Fresh-draft seed when not editing. The library's 自己做 passes
   * `"tabletop"` so the first thing you see is a 20 cm desk item, not a
   * 60 cm game cube. Absent = restore the last draft or the interactive cube.
   */
  starter?: PropDraftKind;
  onClose: () => void;
}

function readDraft(): PropDefinition | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) as PropDefinition : null;
  } catch { return null; }
}

function writeDraft(def: PropDefinition | null): void {
  try {
    if (def) localStorage.setItem(DRAFT_KEY, JSON.stringify(def));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* storage full — the in-memory draft still works this session */ }
}

/** The seed's first chance step — where the faces live. */
function faceStep(def: PropDefinition) {
  return def.interaction?.steps.find((s) => s.branch?.kind === "chance");
}

function faceOptions(def: PropDefinition): InteractionOption[] {
  const step = faceStep(def);
  return step?.branch?.kind === "chance" ? step.branch.options : [];
}

/**
 * The stations whose result a display part can show: placed props that
 * actually have a bound station. Ids are the deterministic `prop_<objectId>`,
 * so the link survives a save/reload and the old-build re-bind pass.
 */
function resultSources(app: App): { stationId: string; label: string }[] {
  const project = app.store.getState();
  const out: { stationId: string; label: string }[] = [];
  for (const station of project.interaction?.stations ?? []) {
    if (!station.objectId) continue;
    out.push({ stationId: station.id, label: station.name });
  }
  return out;
}

/** How far outside the prop's own footprint a fresh anchor lands. */
const DEFAULT_ANCHOR_GAP = 0.6;

export function showPropStudio(app: App, opts: PropStudioOptions): HTMLElement {
  const overlay = el("div", { class: "quickstart propstudio" });
  const card = el("div", { class: "quickstart__card propstudio__card" });
  overlay.append(card);

  const editing = !!opts.edit;
  const defaultKind: PropDraftKind = opts.starter ?? "interactive";
  let draftKind: PropDraftKind | "preset" = opts.edit ? "preset" : defaultKind;
  let draft: PropDefinition = opts.edit
    ? JSON.parse(JSON.stringify(opts.edit)) as PropDefinition
    : opts.starter
      ? blankPropDraft(opts.starter)
      : readDraft() ?? blankPropDraft("interactive");
  // An explicit starter (自己做) is a new intent — do not revive last night's
  // unfinished dice over the nameplate they just asked to make.
  const restoredDraft = !opts.edit && !opts.starter && !!readDraft();

  let preview: PropPreview | null = null;
  let angle: PreviewAngle = "iso";

  const close = () => {
    preview?.dispose();
    overlay.remove();
    opts.onClose();
  };

  const touch = () => {
    if (!editing) writeDraft(draft);
    render();
  };

  const scaleTo = (axis: "width" | "depth" | "height", value: number) => {
    const factor = value / draft.dimensions[axis];
    if (!Number.isFinite(factor) || factor <= 0) return;
    draft.dimensions[axis] = value;
    // Scale parts and anchors with the box, so 「改成 80 公分」 means the prop,
    // not one lonely number.
    const key = axis === "height" ? "y" : axis === "width" ? "x" : "z";
    for (const part of draft.parts) {
      part.size[axis] = Math.max(0.01, part.size[axis] * factor);
      part.offset[key] *= factor;
    }
    if (axis !== "height") {
      for (const anchor of draft.anchors) anchor[key as "x" | "z"] *= factor;
    }
  };

  /**
   * The last row is the end, and says so.
   *
   * The wiring contract requires a fragment to be sealed with an explicit
   * `next: null` — a row that falls through would leak into steps it does not
   * own. Re-applied whenever the list changes shape.
   */
  const sealSteps = (d: PropDefinition) => {
    const steps = d.interaction?.steps ?? [];
    steps.forEach((st, i) => {
      if (i === steps.length - 1) st.next = null;
      else if (st.next === null) delete st.next;
    });
  };

  const ensureInteraction = () => {
    if (draft.interaction) return;
    draft.interaction = {
      steps: [
        {
          id: "play", name: "玩一輪", avgSeconds: 30,
          branch: {
            kind: "chance", record: "result",
            options: Array.from({ length: 4 }, (_, i) => ({
              id: `o${i + 1}`, label: `選項 ${i + 1}`, weight: 1, color: "#38bdf8",
            })),
          },
        },
        { id: "done", name: "完成", avgSeconds: 10, next: null },
      ],
      station: { meanServiceSeconds: 40, parallelServers: 1, queueCapacity: 6 },
      staffRole: { name: draft.name, count: 1 },
      skipRate: 0.3,
    };
    if (!draft.anchors.length) {
      draft.anchors = [
        { id: "player", role: "player", x: 0, z: draft.dimensions.depth / 2 + 0.5 },
        { id: "staff", role: "staff", x: draft.dimensions.width / 2 + 0.5, z: 0 },
        { id: "queue", role: "queue", x: 0, z: draft.dimensions.depth / 2 + 1.2, facingDeg: 0 },
        { id: "exit", role: "exit", x: -(draft.dimensions.width / 2 + 0.8), z: 0 },
      ];
    }
  };

  /** Does this draft have content a person would be upset to lose? */
  const hasTypedContent = (): boolean => {
    const step = draft.interaction?.steps.find((s) => s.branch?.kind === "chance");
    const opts = step?.branch?.kind === "chance" ? step.branch.options : [];
    return opts.some((o) => o.prompt) || draft.parts.some((p) => p.text || p.imageBlobId);
  };

  const setFaceCount = (count: number) => {
    const step = faceStep(draft);
    if (!step || step.branch?.kind !== "chance") return;
    const options = step.branch.options;
    // Fewer faces means throwing away whatever was written on the ones that
    // go. Only ask when there is something to lose.
    if (count < options.length) {
      const losing = options.slice(count).filter((o) => o.prompt).length;
      if (losing && !window.confirm(`會刪掉最後 ${options.length - count} 個面，其中 ${losing} 個已經寫了題目。確定？`)) {
        return;
      }
    }
    while (options.length < count) {
      options.push({ id: `o${uid("f")}`, label: `選項 ${options.length + 1}`, weight: 1, color: "#38bdf8" });
    }
    step.branch.options = options.slice(0, count);
  };

  const anchorRow = (role: PropAnchor["role"], label: string): HTMLElement => {
    const anchor = draft.anchors.find((a) => a.role === role);
    const d = draft.dimensions;
    const place = (x: number, z: number) => {
      const existing = draft.anchors.find((a) => a.role === role);
      if (existing) { existing.x = x; existing.z = z; }
      else draft.anchors.push({ id: role, role, x, z, ...(role === "queue" ? { facingDeg: 0 } : {}) });
      touch();
    };
    // Distance from the prop's CENTRE, which is the number the 距離 field also
    // shows and the number `place` sets. The chips used to add half the prop's
    // depth to it on every tap, so pressing 「前」 twice — the natural way to
    // confirm a choice — walked the participant 60 cm further away each time,
    // and the field disagreed with the chips about what the number meant.
    const dist = Math.max(0.2, anchor ? Math.hypot(anchor.x, anchor.z) : DEFAULT_ANCHOR_GAP + d.depth / 2);
    return el("div", { class: "list__row" }, [
      el("span", { class: "readout__label", text: label }),
      button("前", () => place(0, dist), "chip chip--sm"),
      button("後", () => place(0, -dist), "chip chip--sm"),
      button("左", () => place(-dist, 0), "chip chip--sm"),
      button("右", () => place(dist, 0), "chip chip--sm"),
      num("距離 cm", Math.round(dist * 100), 10, (v) => {
        // Typing a distance for a position that has not been placed yet used
        // to return silently — the field accepted the number and threw it
        // away. Put the person in front of the prop at that distance, which
        // is what they plainly meant.
        const a = draft.anchors.find((x) => x.role === role);
        if (!a) { place(0, Math.max(0.2, v / 100)); return; }
        const len = Math.hypot(a.x, a.z) || 1;
        const target = Math.max(0.2, v / 100);
        a.x = (a.x / len) * target;
        a.z = (a.z / len) * target;
        touch();
      }, 20),
      ...(anchor ? [el("span", { class: "hint", text: "✓" })] : []),
    ]);
  };

  const render = () => {
    // Every edit rebuilds the whole card, which resets its scroll to the top —
    // so typing a step name near the bottom threw you back up to 「想做什麼？」
    // on each keystroke. Keep the reader where they were.
    const scrollTop = card.scrollTop;
    card.innerHTML = "";
    card.append(el("div", { class: "quickstart__title", text: editing ? `編輯「${draft.name}」` : "新增道具" }));

    if (restoredDraft && !editing) {
      card.append(el("div", { class: "row wrap" }, [
        el("span", { class: "hint", text: "已還原上次沒做完的草稿。" }),
        button("丟掉重來", () => {
          writeDraft(null);
          draftKind = defaultKind;
          draft = blankPropDraft(defaultKind);
          render();
        }, "chip chip--sm"),
      ]));
    }

    // --- 類型 (new only): start from a preset ------------------------------
    if (!editing) {
      card.append(el("div", { class: "subhead", text: "想做什麼？" }));
      // Starting from nothing is the point of the Studio, and it was the one
      // option with no chip: the presets filled the row and a blind tester,
      // told not to use the ready-made 抽卡箱, hunted for the nearest preset
      // instead of just starting. It is still the default draft — now it says so.
      const startFrom = (kind: PropDraftKind) => {
        if (hasTypedContent() && !window.confirm("會清掉你目前打的內容，確定？")) return;
        draftKind = kind;
        draft = { ...blankPropDraft(kind), id: draft.id };
        touch();
      };
      card.append(el("div", { class: "row wrap" }, [
        button("⬜ 從空白開始（自己設計）", () => startFrom("interactive"),
          draftKind === "interactive" ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button("✦ 桌上小物（自己設計）", () => startFrom("tabletop"),
          draftKind === "tabletop" ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button("● 自訂胸針", () => startFrom("badge"),
          draftKind === "badge" ? "chip chip--sm chip--primary" : "chip chip--sm"),
        el("span", { class: "hint", text: "或從一個現成的開始改：" }),
      ]));
      const seedFrom = (id: string, name: string) => {
        // Tapping a second chip replaces the whole draft. Someone who has
        // typed six questions and then taps another chip just to SEE what it
        // is used to lose all six, with no warning and no undo in here.
        if (hasTypedContent()
          && !window.confirm(`換成「${name}」會清掉你目前打的內容，確定？`)) return;
        const seed = propPreset(id)!;
        draftKind = "preset";
        draft = { ...seed, id: draft.id, source: "user", version: 1 };
        touch();
      };
      const chipRow = (items: { id: string; name: string; icon?: string }[]) =>
        el("div", { class: "row wrap" }, items.map((p) =>
          button(`${p.icon ?? "▦"} ${p.name}`, () => seedFrom(p.id, p.name), "chip chip--sm")));
      card.append(el("div", { class: "subhead", text: "互動" }), chipRow(PROP_PRESETS));
      card.append(el("div", { class: "subhead", text: "文宣" }), chipRow(boothPropsByCategory("文宣")));
      card.append(el("div", { class: "subhead", text: "擺攤小物" }), chipRow(boothPropsByCategory("擺攤小物")));
      card.append(el("div", { class: "subhead", text: "背景" }), chipRow(boothPropsByCategory("背景")));
    }

    // --- preview -----------------------------------------------------------
    if (!preview) preview = createPropPreview(240);
    card.append(el("div", { class: "row propstudio__preview" }, [
      preview.canvas,
      el("div", { class: "row wrap" }, ([["iso", "斜角"], ["front", "正面"], ["side", "側面"], ["top", "俯視"]] as [PreviewAngle, string][])
        .map(([a, label]) => button(label, () => { angle = a; preview!.setAngle(a); },
          angle === a ? "chip chip--sm chip--primary" : "chip chip--sm"))),
    ]));
    preview.update(draft, { faceOptions: faceOptions(draft) });
    preview.setAngle(angle);

    if (draftKind === "badge") {
      card.append(el("p", { class: "hint", text: "預設 58 mm，可依廠商規格改尺寸；在「胸針正面」那列按「上傳胸針圖案」。預覽與場景都會顯示在圓形正面，圖片只留在這個裝置的專案素材庫。" }));
    }

    // --- 名稱與尺寸 ---------------------------------------------------------
    card.append(el("div", { class: "row wrap" }, [
      textField("名稱", draft.name, (v) => { draft.name = v || draft.name; touch(); }),
      num("寬 cm", Math.round(draft.dimensions.width * 100), 5, (v) => { scaleTo("width", Math.max(5, v) / 100); touch(); }, 5),
      num("深 cm", Math.round(draft.dimensions.depth * 100), 5, (v) => { scaleTo("depth", Math.max(5, v) / 100); touch(); }, 5),
      num("高 cm", Math.round(draft.dimensions.height * 100), 5, (v) => { scaleTo("height", Math.max(1, v) / 100); touch(); }, 1),
    ]));
    card.append(el("div", { class: "row wrap" }, [
      el("span", { class: "hint", text: "放哪裡" }),
      ...(["tabletop", "floor"] as const).map((place) =>
        button(place === "tabletop" ? "桌面" : "地面", () => {
          draft.placement = place;
          touch();
        }, (draft.placement ?? "floor") === place ? "chip chip--sm chip--primary" : "chip chip--sm")),
      el("span", { class: "hint", text: "分類" }),
      ...PROP_STUDIO_CATEGORIES.map((cat) =>
        button(cat, () => { draft.category = cat; touch(); },
          draft.category === cat ? "chip chip--sm chip--primary" : "chip chip--sm")),
    ]));

    // --- 零件 ---------------------------------------------------------------
    const partRows: HTMLElement[] = [];
    const overlaps = new Set(overlappingParts(draft.parts).flat());
    draft.parts.forEach((part, i) => {
      partRows.push(el("div", { class: "list__row" }, [
        ...(part.id === "badge-face" ? [el("span", { class: "hint", text: "胸針正面" })] : []),
        selectField("形狀", [
          { value: "box", label: "方塊" }, { value: "cylinder", label: "圓柱" },
          { value: "sphere", label: "球" }, { value: "plane", label: "面板" },
        ], part.shape, (v) => { part.shape = v as PropPart["shape"]; touch(); }),
        num("寬", Math.round(part.size.width * 100), 5, (v) => { part.size.width = Math.max(1, v) / 100; touch(); }, 1),
        num("深", Math.round(part.size.depth * 100), 5, (v) => { part.size.depth = Math.max(1, v) / 100; touch(); }, 1),
        num("高", Math.round(part.size.height * 100), 5, (v) => { part.size.height = Math.max(1, v) / 100; touch(); }, 1),
        selectField("材質", FINISH_CHOICES.map((f) => ({ value: f.id, label: f.label })),
          part.finish ?? "plastic-matte", (v) => { part.finish = v; touch(); }),
        el("input", {
          type: "color", class: "propstudio__color", value: part.color ?? "#8fb4c9",
          onchange: (e: Event) => { part.color = (e.target as HTMLInputElement).value; touch(); },
        } as never),
        // Not just 「文字」: a tester could not tell whether a dice face's
        // question went here or in the face table below, and the two do very
        // different things. This one is paint.
        textField(part.id === "badge-face" ? "胸針正面的字" : "印在這塊上的字", part.text ?? "", (v) => { part.text = v || undefined; touch(); }),
        (() => {
          const file = el("input", {
            type: "file",
            accept: "image/*",
            class: "propstudio__photo",
            style: "position:absolute;width:1px;height:1px;opacity:0",
          }) as HTMLInputElement;
          file.addEventListener("change", () => {
            const picked = file.files?.[0];
            if (!picked) return;
            void (async () => {
              const blobId = `art_${uid("img")}`;
              await getAssetBlobStore().putBlob(blobId, await picked.arrayBuffer(), {
                kind: "sourceImage",
                mimeType: picked.type || "image/jpeg",
              });
              part.imageBlobId = blobId;
              touch();
            })();
          });
          const lab = el("label", { class: "chip chip--sm", style: "position:relative;display:inline-flex;align-items:center;cursor:pointer" }, [
            el("span", { text: part.imageBlobId
              ? (part.id === "badge-face" ? "換胸針圖案" : "換這塊上的照片")
              : (part.id === "badge-face" ? "上傳胸針圖案" : "貼一張照片") }),
            file,
          ]);
          return lab;
        })(),
        ...(part.imageBlobId
          ? [
            el("span", { class: "hint", text: "已貼圖" }),
            button("拿掉照片", () => { delete part.imageBlobId; touch(); }, "chip chip--sm"),
          ]
          : []),
        ...(overlaps.has(part.id) ? [el("span", { class: "hint", text: "⚠ 和別的零件穿插" })] : []),
        ...(draft.parts.length > 1
          ? [button("刪", () => { draft.parts.splice(i, 1); touch(); }, "chip chip--sm")]
          : []),
      ]));
      partRows.push(el("div", { class: "row wrap" }, [
        el("span", { class: "hint", text: "位置" }),
        num("左右 cm", Math.round(part.offset.x * 100), 5, (v) => { part.offset.x = v / 100; touch(); }),
        num("高度 cm", Math.round(part.offset.y * 100), 5, (v) => { part.offset.y = v / 100; touch(); }),
        num("前後 cm", Math.round(part.offset.z * 100), 5, (v) => { part.offset.z = v / 100; touch(); }),
        ...(i > 0 ? (["on-top", "in-front", "beside"] as const).map((rel, ri) =>
          button(["放上一個零件上面", "放前面", "放旁邊"][ri], () => {
            part.offset = relatePartOffset(draft.parts[i - 1], part.size, rel);
            touch();
          }, "chip chip--sm")) : []),
      ]));
      // A part that can carry the faces says so. Without this, only preset
      // parts ever had `facesFromOptions`, so the DIY dice this panel invites
      // people to build came out permanently blank — and nothing on screen
      // explained why. Offered for the two shapes that can show faces.
      if (part.shape === "box" || part.shape === "cylinder") {
        partRows.push(el("div", { class: "row wrap" }, [
          el("label", { class: "hint" }, [
            el("input", {
              type: "checkbox", checked: !!part.facesFromOptions,
              onchange: (e: Event) => {
                part.facesFromOptions = (e.target as HTMLInputElement).checked || undefined;
                touch();
              },
            } as never),
            el("span", { text: part.shape === "box" ? " 這一塊要顯示各個面（骰子）" : " 這一塊要顯示各個面（轉盤）" }),
          ]),
        ]));
      }
      // §32 「這個結果要顯示在哪個道具上？」 — one select, no node editor.
      // Only DISPLAY connections in this version: 「按鈕啟動轉盤」 (a CONTROL
      // connection) is deliberately absent and is listed in the PR body.
      partRows.push(el("div", { class: "row wrap" }, [
        el("span", { class: "hint", text: "彩排時顯示" }),
        selectField("", [
          { value: "", label: "不顯示結果" },
          { value: "self", label: "這個道具自己的結果" },
          ...resultSources(app).map((src) => ({ value: src.stationId, label: `${src.label} 的結果` })),
        ], part.showsResultOf ?? "", (v) => { part.showsResultOf = v || undefined; touch(); }),
      ]));
    });
    partRows.push(button("＋ 加零件", () => {
      const base = draft.parts[draft.parts.length - 1];
      const size = { width: 0.3, depth: 0.3, height: 0.3 };
      draft.parts.push({
        id: `part${uid("x")}`, shape: "box", size,
        offset: base ? relatePartOffset(base, size, "on-top") : { x: 0, y: 0, z: 0 },
        color: "#c8b6a6", finish: "plastic-matte",
      });
      touch();
    }, "btn btn--ghost"));
    card.append(section("外觀（零件）", partRows));

    // --- 互動 ---------------------------------------------------------------
    const interactionRows: HTMLElement[] = [];
    if (!draft.interaction) {
      interactionRows.push(el("p", { class: "hint", text: "純擺設（地墊、桌子）不需要互動。要做遊戲就打開。" }));
      interactionRows.push(button("＋ 加上互動", () => { ensureInteraction(); touch(); }, "btn btn--ghost"));
    } else {
      const seed = draft.interaction;
      interactionRows.push(el("div", { class: "row wrap" }, [
        num("平均互動秒數", seed.station.meanServiceSeconds, 5, (v) => { seed.station.meanServiceSeconds = Math.max(1, v); touch(); }, 1),
        num("同時幾人", seed.station.parallelServers, 1, (v) => { seed.station.parallelServers = Math.max(1, Math.round(v)); touch(); }, 1),
        num("排隊容量", seed.station.queueCapacity, 1, (v) => { seed.station.queueCapacity = Math.max(1, Math.round(v)); touch(); }, 1),
        num("路過跳過率 %", Math.round((seed.skipRate ?? 0) * 100), 5, (v) => { seed.skipRate = Math.min(1, Math.max(0, v / 100)); touch(); }, 0),
      ]));
      if (seed.staffRole) {
        interactionRows.push(el("div", { class: "row wrap" }, [
          textField("工作人員角色", seed.staffRole.name, (v) => { seed.staffRole!.name = v || seed.staffRole!.name; touch(); }),
          num("人數", seed.staffRole.count, 1, (v) => { seed.staffRole!.count = Math.max(0, Math.round(v)); touch(); }, 0),
        ]));
      }
      // --- 這個道具會發生什麼事 (the ordered step list) -------------------
      interactionRows.push(el("div", { class: "subhead", text: "會發生什麼事" }));
      interactionRows.push(el("p", { class: "hint", text: "由上往下，一步一步。抽卡、寫字、投進箱子、拍照——想幾步就幾步。" }));
      const steps = draft.interaction.steps;
      steps.forEach((st, i) => {
        const isFace = st.branch?.kind === "chance";
        interactionRows.push(el("div", { class: "list__row" }, [
          el("span", { class: "readout__label", text: `${i + 1}.` }),
          textField("這一步做什麼", st.name, (v) => { st.name = v || st.name; touch(); }),
          num("大約幾秒", st.avgSeconds, 5, (v) => { st.avgSeconds = Math.max(0, v); touch(); }, 0),
          textField("說明", st.prompt ?? "", (v) => { st.prompt = v || undefined; touch(); }),
          ...(isFace ? [el("span", { class: "hint", text: "（這一步會抽到不同結果）" })] : []),
          ...(i > 0 ? [button("↑", () => {
            [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
            touch();
          }, "chip chip--sm")] : []),
          ...(i < steps.length - 1 ? [button("↓", () => {
            [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
            touch();
          }, "chip chip--sm")] : []),
          ...(steps.length > 1 ? [button("刪", () => {
            steps.splice(i, 1);
            // The list is walked in order, so the last row must be the end.
            sealSteps(draft);
            touch();
          }, "chip chip--sm")] : []),
        ]));
      });
      interactionRows.push(el("div", { class: "row wrap" }, [
        button("＋ 加一步", () => {
          steps.push({ id: `s${uid("x")}`, name: "下一步", avgSeconds: 15 });
          sealSteps(draft);
          touch();
        }, "btn btn--ghost"),
        ...(faceStep(draft) ? [] : [button("＋ 加一步「會抽到不同結果」", () => {
          steps.push({
            id: `s${uid("x")}`, name: "抽一張", avgSeconds: 15,
            branch: {
              kind: "chance", record: "result",
              options: Array.from({ length: 4 }, (_, i) => ({
                id: `o${i + 1}`, label: `選項 ${i + 1}`, weight: 1, color: "#38bdf8",
              })),
            },
          });
          sealSteps(draft);
          touch();
        }, "btn btn--ghost")]),
      ]));

      const step = faceStep(draft);
      if (step?.branch?.kind === "chance") {
        interactionRows.push(el("div", { class: "subhead", text: `「${step.name}」會抽到什麼` }));
        interactionRows.push(el("p", { class: "hint", text: "每一面的題目寫在這裡（不是零件的「印在這塊上的字」）。" }));
        interactionRows.push(el("div", { class: "row wrap" }, [
          el("span", { class: "readout__label", text: "面數：" }),
          ...[2, 4, 6, 8, 10, 12].map((n) => button(String(n), () => { setFaceCount(n); touch(); },
            faceOptions(draft).length === n ? "chip chip--sm chip--primary" : "chip chip--sm")),
        ]));
        faceOptions(draft).forEach((option) => {
          interactionRows.push(el("div", { class: "list__row" }, [
            textField("名稱", option.label, (v) => { option.label = v; touch(); }),
            el("input", {
              type: "color", class: "propstudio__color", value: option.color ?? "#38bdf8",
              onchange: (e: Event) => { option.color = (e.target as HTMLInputElement).value; touch(); },
            } as never),
            textField("題目", option.prompt ?? "", (v) => { option.prompt = v || undefined; touch(); }),
            num("多花幾秒", option.extraSeconds ?? 0, 5, (v) => { option.extraSeconds = v > 0 ? v : undefined; touch(); }, 0),
          ]));
        });
      }
      interactionRows.push(el("div", { class: "subhead", text: "大家站哪裡" }));
      interactionRows.push(anchorRow("player", "參加者"));
      interactionRows.push(anchorRow("staff", "工作人員"));
      interactionRows.push(anchorRow("queue", "排隊起點"));
      interactionRows.push(anchorRow("exit", "完成出口"));
      interactionRows.push(button("移除互動", () => {
        delete draft.interaction;
        touch();
      }, "chip chip--sm"));
    }
    // Open even when the prop has no interaction yet — that is exactly when
    // 「＋ 加上互動」 needs to be findable. Collapsing it until an
    // interaction exists is why a blind tester reported 「找不到地方排
    // 抽卡→寫祝福→投入→離開」: the panel was shut.
    card.append(section("互動", interactionRows));

    // --- actions -----------------------------------------------------------
    const actions: HTMLElement[] = [];
    if (editing) {
      actions.push(button("儲存修改", () => {
        app.updatePropDefinition(draft);
        app.onToast?.(`已更新「${draft.name}」——場上的每一份都會換新`);
        close();
      }, "btn btn--big btn--primary"));
      if ((opts.instanceCount ?? 0) > 1) {
        actions.push(el("p", { class: "hint", text: `目前有 ${opts.instanceCount} 份在場上；「儲存修改」會全部更新。要只改一份，回到場上選那一份按「只改這一個」。` }));
      }
    } else {
      actions.push(button("加入專案並放置", () => {
        app.addPropToProject(draft);
        writeDraft(null);
        close();
      }, "btn btn--big btn--primary"));
    }
    actions.push(button("儲存到我的道具", () => {
      saveLibraryProp(draft);
      app.onToast?.(`已存到我的道具：「${draft.name}」`);
    }, "btn btn--ghost"));
    actions.push(el("div", { class: "quickstart__foot" }, [button("關閉", close, "chip chip--sm")]));
    card.append(...actions);
    card.scrollTop = scrollTop;
  };

  render();
  return overlay;
}
