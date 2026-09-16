/**
 * Tamkang campus location view — OpenStreetMap + Leaflet, with a local
 * directory fallback so a tile outage or a phone without signal never whites
 * out. Building pins are 樓館位置. Indoor rooms are never given a lat/lng.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  TKU_CAMPUSES,
  buildingByCode,
  campusById,
  placeById,
  placesInBuilding,
  searchTkuDirectory,
  type TkuCampusId,
  type TkuPlace,
  type TkuSearchHit,
} from "../core/tkuCampus";
import {
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  PHYSICAL_CAMPUSES,
  buildingLocationCaption,
  campusCenter,
  defaultCampusId,
  entranceCopy,
  fitTarget,
  googleMapsUrl,
  hasCoords,
  layoutMapLabels,
  mapMarkersForCampus,
  osmUrl,
  type MapMarker,
} from "../core/campusMap";
import type { FreshmanStage } from "../core/freshmanGuide";
import { photosForPlace, photoBindingLabel, photoThumbnailDataUri } from "../core/venuePhotos";
import { button, el } from "./dom";

export interface CampusMapState {
  campusId: TkuCampusId;
  buildingCode?: string;
  placeId?: string;
  activityBuildingCode?: string;
  activityPlaceId?: string;
  stage: FreshmanStage;
  query: string;
}

export interface CampusMapOptions {
  getState: () => CampusMapState;
  onState: (patch: Partial<CampusMapState>) => void;
  onEnterLayout: () => void;
  /** Organiser picking a room from the wizard / 場地 panel. */
  onPickPlace?: (place: TkuPlace) => void;
  freshman: boolean;
}

export interface CampusMapHandles {
  root: HTMLElement;
  render(): void;
  show(): void;
  hide(): void;
  destroy(): void;
  resize(): void;
}

const LABEL_W = 86;
const LABEL_H = 22;

export function buildCampusMap(opts: CampusMapOptions): CampusMapHandles {
  const search = el("input", {
    type: "search",
    class: "tkumap__search",
    placeholder: "搜尋樓館或教室，例如 E305、E310、SG320",
    "aria-label": "搜尋淡江樓館或教室",
    "data-testid": "tku-map-search",
  }) as HTMLInputElement;
  const campusRow = el("div", { class: "tkumap__campuses" });
  const results = el("div", { class: "tkumap__results", style: "display:none" });
  const mapHost = el("div", { class: "tkumap__canvas", "data-testid": "tku-map-canvas" });
  const fallback = el("div", { class: "tkumap__fallback", "data-testid": "tku-map-fallback" });
  const stageBox = el("div", { class: "tkumap__stage" });
  const north = el("div", { class: "tkumap__north", text: "北" });
  const sheet = el("div", { class: "tkumap__sheet", "data-testid": "tku-map-sheet" });
  const attrib = el("div", { class: "tkumap__attrib" });
  attrib.innerHTML = OSM_ATTRIBUTION;
  stageBox.append(mapHost, fallback, north, attrib);

  const root = el("div", { class: "tkumap", hidden: "true", "data-testid": "tku-map" }, [
    el("div", { class: "tkumap__bar" }, [search, campusRow, results]),
    stageBox,
    sheet,
  ]);

  let map: L.Map | null = null;
  let tiles: L.TileLayer | null = null;
  let layer: L.LayerGroup | null = null;
  let tileErrors = 0;
  let tilesOk = false;
  let mapFailed = false;
  let lastFit = "";

  const bindSearch = (): void => {
    let timer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => opts.onState({ query: search.value }), 80);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const hits = searchTkuDirectory(search.value);
        const first = hits[0];
        if (first) applyHit(first);
      }
    });
  };
  bindSearch();

  function applyHit(hit: TkuSearchHit): void {
    if (hit.kind === "campus") {
      opts.onState({ campusId: hit.campusId, buildingCode: undefined, placeId: undefined, stage: "campus", query: search.value });
      return;
    }
    if (hit.kind === "building") {
      opts.onState({
        campusId: hit.campusId,
        buildingCode: hit.buildingCode,
        placeId: undefined,
        stage: "building",
        query: search.value,
      });
      return;
    }
    const place = hit.placeId ? placeById(hit.placeId) : undefined;
    opts.onState({
      campusId: hit.campusId,
      buildingCode: hit.buildingCode ?? place?.buildingCode,
      placeId: hit.placeId,
      stage: "classroom",
      query: search.value,
    });
    if (place && opts.onPickPlace && !opts.freshman) opts.onPickPlace(place);
  }

  function ensureMap(): L.Map | null {
    if (mapFailed) return null;
    if (map) return map;
    try {
      map = L.map(mapHost, {
        zoomControl: true,
        attributionControl: false,
        maxZoom: 19,
        minZoom: 14,
        scrollWheelZoom: true,
        dragging: true,
        keyboard: false,
      });
      tiles = L.tileLayer(OSM_TILE_URL, {
        attribution: OSM_ATTRIBUTION,
        maxZoom: 19,
        crossOrigin: true,
      });
      tiles.on("tileerror", () => {
        tileErrors += 1;
        if (!tilesOk && tileErrors >= 2) showFallback("地圖圖磚載入失敗，改顯示已儲存的校園資料。");
      });
      tiles.on("tileload", () => {
        tilesOk = true;
        fallback.classList.remove("tkumap__fallback--on");
      });
      tiles.addTo(map);
      layer = L.layerGroup().addTo(map);
      map.whenReady(() => {
        map?.invalidateSize();
      });
      return map;
    } catch {
      mapFailed = true;
      showFallback("這台裝置暫時無法顯示地圖，改用校園列表。");
      return null;
    }
  }

  function showFallback(reason: string): void {
    fallback.classList.add("tkumap__fallback--on");
    const s = opts.getState();
    fallback.innerHTML = "";
    fallback.append(
      el("p", { class: "tkumap__fallback-title", text: reason }),
      directoryList(s),
    );
  }

  function directoryList(s: CampusMapState): HTMLElement {
    const list = el("div", { class: "tkumap__dir" });
    const buildings = mapMarkersForCampus(s.campusId, {
      buildingCode: s.activityBuildingCode ?? s.buildingCode,
      placeId: s.activityPlaceId ?? s.placeId,
    });
    const named = buildings.length
      ? buildings
      : [];
    if (!named.length) {
      list.append(el("p", { class: "hint", text: `${campusById(s.campusId)?.name ?? ""}目前沒有公開樓館座標，仍可從下方列表找教室。` }));
    }
    const codes = new Set(named.map((m) => m.buildingCode).filter(Boolean) as string[]);
    const extra = placesInBuilding(s.buildingCode ?? "E").slice(0, 12);
    const shownBuildings = named.length ? named : [];
    for (const m of shownBuildings.slice(0, 16)) {
      list.append(button(
        `${m.active ? "📍 " : ""}${m.codeLabel} ${m.name}`,
        () => opts.onState({ campusId: m.campusId, buildingCode: m.buildingCode, stage: "building" }),
        `tkumap__dir-btn${m.active ? " is-active" : ""}`,
      ));
    }
    if (s.buildingCode && codes.size) {
      for (const p of extra) {
        list.append(button(
          p.name,
          () => opts.onState({ placeId: p.id, buildingCode: p.buildingCode, campusId: p.campusId, stage: "classroom" }),
          "tkumap__dir-btn",
        ));
      }
    }
    return list;
  }

  function paintMarkers(s: CampusMapState): void {
    const m = ensureMap();
    if (!m || !layer) return;
    layer.clearLayers();
    const markers = mapMarkersForCampus(s.campusId, {
      buildingCode: s.activityBuildingCode ?? s.buildingCode,
      placeId: s.activityPlaceId ?? s.placeId,
    });
    const size = mapHost.getBoundingClientRect();
    const boxes = markers.map((mk) => {
      const pt = m.latLngToContainerPoint([mk.lat, mk.lng]);
      return {
        id: mk.id,
        x: pt.x - LABEL_W / 2,
        y: pt.y - 36,
        width: LABEL_W,
        height: LABEL_H,
        priority: (mk.active ? 0 : mk.featured ? 1 : 2) as 0 | 1 | 2,
      };
    });
    const placed = layoutMapLabels(boxes, { width: Math.max(1, size.width), height: Math.max(1, size.height) });
    const hidden = new Set(placed.filter((p) => p.hidden).map((p) => p.id));

    for (const mk of markers) {
      const icon = L.divIcon({
        className: `tkumap-pin${mk.active ? " is-active" : mk.featured ? "" : " is-muted"}`,
        html: pinHtml(mk, !hidden.has(mk.id)),
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([mk.lat, mk.lng], { icon, keyboard: false, riseOnHover: true });
      marker.on("click", () => {
        opts.onState({ campusId: mk.campusId, buildingCode: mk.buildingCode, stage: "building", placeId: undefined });
      });
      marker.addTo(layer);
    }
  }

  function pinHtml(mk: MapMarker, showLabel: boolean): string {
    const label = showLabel
      ? `<span class="tkumap-pin__label">${escapeHtml(mk.active ? mk.name : mk.codeLabel)}</span>`
      : "";
    return `<span class="tkumap-pin__dot"></span>${label}`;
  }

  function fit(s: CampusMapState): void {
    const m = ensureMap();
    if (!m) return;
    const fitBuilding = s.stage === "campus" ? undefined : s.buildingCode;
    const target = fitTarget(s.campusId, fitBuilding);
    const key = `${s.campusId}:${s.buildingCode ?? ""}:${s.stage}:${Math.round(mapHost.clientHeight)}`;
    if (target && key !== lastFit) {
      lastFit = key;
      m.setView([target.lat, target.lng], s.stage === "campus" ? 16 : target.zoom, { animate: false });
      m.invalidateSize();
    } else if (!target) {
      const c = campusCenter(s.campusId);
      if (c) m.setView([c.lat, c.lng], 16, { animate: false });
      else showFallback("這個校園沒有公開座標，改用列表。");
    }
    m.invalidateSize();
  }

  function renderSheet(s: CampusMapState): void {
    sheet.innerHTML = "";
    const campus = campusById(s.campusId);
    const activityPlace = s.activityPlaceId ? placeById(s.activityPlaceId) : undefined;
    const activityBuilding = s.activityBuildingCode ? buildingByCode(s.activityBuildingCode) : undefined;
    const building = s.stage === "campus"
      ? activityBuilding
      : (s.buildingCode ? buildingByCode(s.buildingCode) : activityBuilding);
    const place = s.stage === "classroom" && s.placeId
      ? placeById(s.placeId)
      : (s.stage === "campus" || s.stage === "building" ? undefined : (s.placeId ? placeById(s.placeId) : activityPlace));
    const title = place?.name
      ?? (building ? `${building.code} ${building.name}` : campus?.name ?? "淡江大學");
    const lines: string[] = [];
    if (campus) lines.push(campus.name);
    if (building) lines.push(`${building.name}（${buildingLocationCaption()}）`);
    if (place?.floor != null) lines.push(`${place.floor}F`);
    if (place) lines.push(place.id.match(/^[A-Z]/) ? `教室 ${place.id}` : place.name);
    if (place) lines.push(entranceCopy(place));
    else if (activityPlace) lines.push(`目前活動：${activityPlace.name}`);

    sheet.append(el("div", { class: "tkumap__sheet-title", text: title }));
    sheet.append(el("p", { class: "tkumap__sheet-line", text: lines.join(" · ") }));
    if (building && !hasCoords(building)) {
      sheet.append(el("p", { class: "hint", text: "這棟樓還沒有公開座標，只顯示目錄資料。" }));
    }
    if (opts.freshman || place) {
      sheet.append(button("進入室內場佈", () => {
        if (place && opts.onPickPlace && !opts.freshman) opts.onPickPlace(place);
        opts.onEnterLayout();
      }, "btn btn--primary tkumap__enter"));
    }
    const loc = building && hasCoords(building)
      ? { lat: building.lat!, lng: building.lng!, label: building.name }
      : campusCenter(s.campusId)
        ? { ...campusCenter(s.campusId)!, label: campus?.name }
        : null;
    if (loc) {
      sheet.append(el("div", { class: "tkumap__sheet-actions" }, [
        linkBtn("Google Maps 導航", googleMapsUrl(loc.lat, loc.lng, loc.label)),
        linkBtn("OpenStreetMap 位置", osmUrl(loc.lat, loc.lng)),
      ]));
    }
    if (place) {
      const photos = photosForPlace(place.id);
      if (photos.length) {
        const row = el("div", { class: "tkumap__photos" });
        for (const photo of photos) {
          row.append(el("figure", { class: "tkumap__photo" }, [
            el("img", { src: photoThumbnailDataUri(photo), alt: photo.title }),
            el("figcaption", { text: `${photo.title} · ${photo.shootingDirection}` }),
            el("span", { class: "tkumap__photo-tag", text: photoBindingLabel(photo) }),
          ]));
        }
        sheet.append(row);
      }
    }
    if (!place && building) {
      const rooms = placesInBuilding(building.code).filter((p) => p.kind === "classroom" || p.kind === "office" || p.kind === "hall");
      const list = el("div", { class: "tkumap__rooms" });
      for (const p of rooms.slice(0, 10)) {
        list.append(button(p.name, () => opts.onState({ placeId: p.id, buildingCode: p.buildingCode, campusId: p.campusId, stage: "classroom" }), "chip chip--sm"));
      }
      if (rooms.length) sheet.append(list);
    }
  }

  function renderResults(s: CampusMapState): void {
    const q = s.query.trim();
    search.value = s.query;
    if (!q) {
      results.style.display = "none";
      results.innerHTML = "";
      return;
    }
    const hits = searchTkuDirectory(q);
    results.style.display = "flex";
    results.innerHTML = "";
    if (!hits.length) {
      results.append(el("div", { class: "hint", text: "找不到這個代碼，試試 E305、E310 或樓館名稱。" }));
      return;
    }
    for (const hit of hits.slice(0, 8)) {
      results.append(button(
        `${hit.title} · ${hit.subtitle}`,
        () => applyHit(hit),
        "tkumap__hit",
      ));
    }
  }

  function renderCampuses(s: CampusMapState): void {
    campusRow.innerHTML = "";
    for (const id of PHYSICAL_CAMPUSES) {
      const c = TKU_CAMPUSES.find((c) => c.id === id)!;
      const btn = button(c.name.replace("校園", ""), () => opts.onState({ campusId: id, stage: "campus", buildingCode: undefined, placeId: undefined }), "tkumap__campus");
      btn.setAttribute("aria-pressed", String(s.campusId === id));
      campusRow.append(btn);
    }
  }

  function render(): void {
    const s = opts.getState();
    const campusId = defaultCampusId({ campusId: s.campusId });
    root.dataset.stage = s.stage;
    root.dataset.campus = campusId;
    renderCampuses({ ...s, campusId });
    renderResults(s);
    if (s.campusId === "cyber") {
      showFallback("網路校園沒有實體地圖。");
      sheet.innerHTML = "";
      return;
    }
    const m = ensureMap();
    if (m) {
      fallback.classList.remove("tkumap__fallback--on");
      fit(s);
      paintMarkers(s);
    } else {
      showFallback("地圖暫時無法使用，仍可從列表找樓館與教室。");
    }
    renderSheet(s);
    if (!tilesOk && tileErrors >= 2) {
      showFallback("地圖圖磚載入失敗，改顯示已儲存的校園資料。");
    }
  }

  return {
    root,
    render,
    show() {
      root.hidden = false;
      root.removeAttribute("hidden");
      requestAnimationFrame(() => {
        ensureMap()?.invalidateSize();
        render();
      });
    },
    hide() {
      root.hidden = true;
      root.setAttribute("hidden", "true");
    },
    destroy() {
      map?.remove();
      map = null;
      root.remove();
    },
    resize() {
      lastFit = "";
      ensureMap()?.invalidateSize();
      render();
    },
  };
}

function linkBtn(label: string, href: string): HTMLElement {
  const a = el("a", { class: "btn btn--ghost tkumap__ext", href, target: "_blank", rel: "noreferrer" }) as HTMLAnchorElement;
  a.textContent = label;
  return a;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export { OSM_ATTRIBUTION_TEXT } from "../core/campusMap";
