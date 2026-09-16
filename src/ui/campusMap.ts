/**
 * OpenStreetMap + Leaflet campus map. No paid API key.
 *
 * Failures (tile error, offline, Leaflet missing) fall back to the bundled
 * campus directory so the freshman never sees a white screen.
 */

import { button, el } from "./dom";
import {
  PHYSICAL_CAMPUSES,
  buildingLocation,
  buildingMissingLocation,
  campusAnchor,
  campusBounds,
  campusByPlace,
  campusMapPins,
  entranceHint,
  googleMapsUrl,
  osmUrl,
  searchTkuDirectory,
  type DirectoryHit,
  type GeoPoint,
} from "../core/campusGuide";
import { buildingByCode, campusById, placeById, type TkuCampusId, type TkuPlace } from "../core/tkuCampus";
import { photosForPlace, photoBindingLabel } from "../core/venuePhotos";
import type { FreshmanLayer } from "../core/freshman";
import { declutterScreenLabels, type ScreenLabelCandidate } from "../scene/labelLayout";

export interface CampusMapState {
  campusId: TkuCampusId;
  place: TkuPlace | null;
  layer: FreshmanLayer;
}

export interface CampusMapHandles {
  root: HTMLElement;
  setState(state: CampusMapState): void;
  invalidate(): void;
  destroy(): void;
}

interface LeafletLike {
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafletMapLike;
  tileLayer: (url: string, opts: Record<string, unknown>) => { addTo: (map: LeafletMapLike) => void; on: (ev: string, fn: () => void) => void };
  divIcon: (opts: Record<string, unknown>) => unknown;
  marker: (latlng: [number, number], opts: Record<string, unknown>) => LeafletMarkerLike;
  latLngBounds: (a: [number, number], b: [number, number]) => unknown;
}

interface LeafletMapLike {
  setView: (latlng: [number, number], zoom: number) => LeafletMapLike;
  fitBounds: (bounds: unknown, opts?: Record<string, unknown>) => LeafletMapLike;
  remove: () => void;
  invalidateSize: () => void;
  on: (ev: string, fn: () => void) => void;
  off: (ev: string, fn: () => void) => void;
  eachLayer: (fn: (layer: { remove?: () => void; options?: { pane?: string } }) => void) => void;
  latLngToContainerPoint: (latlng: { lat: number; lng: number }) => { x: number; y: number };
  getContainer: () => HTMLElement;
  attributionControl?: { setPrefix: (s: string) => void };
}

interface LeafletMarkerLike {
  addTo: (map: LeafletMapLike) => LeafletMarkerLike;
  on: (ev: string, fn: () => void) => LeafletMarkerLike;
  remove: () => void;
  getLatLng: () => { lat: number; lng: number };
  getElement: () => HTMLElement | undefined;
  options: { pinId?: string };
}

const OSM_TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export function buildCampusMap(opts: {
  onEnterIndoor: () => void;
  onPreviewPlace: (placeId: string) => void;
  onPreviewBuilding: (code: string) => void;
  onCampus: (id: TkuCampusId) => void;
}): CampusMapHandles {
  const search = el("input", {
    type: "search",
    class: "campusmap__search",
    placeholder: "搜尋樓館或教室，例如 E305、E310、SG320",
    "aria-label": "搜尋淡江樓館或教室",
    autocomplete: "off",
  }) as HTMLInputElement;
  const chips = el("div", { class: "campusmap__campuses" });
  const results = el("div", { class: "campusmap__results" });
  const mapBox = el("div", { class: "campusmap__canvas", "aria-label": "淡江校園地圖" });
  const north = el("div", { class: "campusmap__north", text: "N ↑", title: "北方朝上" });
  const fallback = el("div", { class: "campusmap__fallback", style: "display:none" });
  const card = el("div", { class: "campusmap__card" });
  const photos = el("div", { class: "campusmap__photos" });
  const attrBar = el("p", { class: "campusmap__attr" });
  attrBar.innerHTML = OSM_ATTR;
  const root = el("div", { class: "campusmap", hidden: "true" }, [
    el("div", { class: "campusmap__toolbar" }, [search, chips, results]),
    el("div", { class: "campusmap__stage" }, [mapBox, north, fallback]),
    card,
    photos,
    attrBar,
  ]);

  let state: CampusMapState = { campusId: "tamsui", place: null, layer: "campus" };
  let L: LeafletLike | null = null;
  let map: LeafletMapLike | null = null;
  let tilesOk = 0;
  let failed = false;
  let markers: LeafletMarkerLike[] = [];
  let previewPlace: TkuPlace | null = null;
  let previewBuilding: string | null = null;

  for (const id of PHYSICAL_CAMPUSES) {
    const campus = campusById(id);
    const chip = button(campus?.name ?? id, () => opts.onCampus(id), "chip chip--sm campusmap__chip") as HTMLButtonElement;
    chip.dataset.campus = id;
    chips.append(chip);
  }

  search.addEventListener("input", () => {
    renderResults();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const hits = searchTkuDirectory(search.value);
    const top = hits[0];
    if (!top) return;
    applyHit(top);
  });

  function applyHit(hit: DirectoryHit): void {
    if (hit.kind === "campus") {
      previewPlace = null;
      previewBuilding = null;
      opts.onCampus(hit.campusId);
      return;
    }
    if (hit.kind === "building" && hit.buildingCode) {
      previewPlace = null;
      previewBuilding = hit.buildingCode;
      opts.onPreviewBuilding(hit.buildingCode);
      return;
    }
    if (hit.placeId) {
      previewPlace = placeById(hit.placeId) ?? null;
      previewBuilding = previewPlace?.buildingCode ?? null;
      opts.onPreviewPlace(hit.placeId);
    }
  }

  function renderResults(): void {
    results.innerHTML = "";
    const q = search.value.trim();
    if (!q) { results.style.display = "none"; return; }
    const hits = searchTkuDirectory(q);
    results.style.display = hits.length ? "flex" : "none";
    if (!hits.length) {
      results.style.display = "flex";
      results.append(el("div", { class: "campusmap__empty", text: "找不到這個樓館或教室，改搜教室代碼試試看。" }));
      return;
    }
    for (const hit of hits.slice(0, 8)) {
      const row = button("", () => applyHit(hit), "campusmap__hit") as HTMLButtonElement;
      row.append(
        el("strong", { text: hit.title }),
        el("span", { text: hit.subtitle }),
      );
      results.append(row);
    }
  }

  function showFallback(reason: string): void {
    failed = true;
    fallback.style.display = "block";
    fallback.innerHTML = "";
    fallback.append(
      el("p", { class: "campusmap__fallback-title", text: "地圖暫時沒有載入" }),
      el("p", { class: "hint", text: reason }),
    );
    const attr = el("p", { class: "campusmap__attr" });
    attr.innerHTML = OSM_ATTR;
    fallback.append(attr);
    const list = el("div", { class: "campusmap__list" });
    const pins = campusMapPins({ campusId: state.campusId, activeBuildingCode: activeBuilding() });
    for (const pin of pins.filter((p) => p.kind === "building" && p.weight !== "muted").slice(0, 12)) {
      list.append(button(pin.shortLabel, () => {
        if (pin.buildingCode) opts.onPreviewBuilding(pin.buildingCode);
      }, "btn btn--ghost campusmap__listbtn"));
    }
    const directory = campusById(state.campusId);
    if (directory?.address) {
      list.append(el("p", { class: "hint", text: directory.address }));
    }
    fallback.append(list);
    mapBox.style.opacity = tilesOk > 0 ? "1" : "0.35";
  }

  function hideFallback(): void {
    if (tilesOk > 0) {
      failed = false;
      fallback.style.display = "none";
      mapBox.style.opacity = "1";
    }
  }

  async function ensureMap(): Promise<void> {
    if (map || failed && !L) {
      if (!L) showFallback(navigator.onLine === false ? "目前沒有網路，改用已儲存的校園資料。" : "地圖元件無法載入，改用校園目錄。");
      return;
    }
    if (navigator.onLine === false) {
      showFallback("目前沒有網路，改用已儲存的校園資料。");
    }
    try {
      const mod = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      L = (mod.default ?? mod) as unknown as LeafletLike;
    } catch {
      showFallback("地圖元件無法載入，改用已儲存的校園資料。");
      return;
    }
    if (map) return;
    map = L.map(mapBox, {
      zoomControl: true,
      attributionControl: true,
      maxZoom: 19,
      minZoom: 13,
    });
    map.attributionControl?.setPrefix("");
    const tiles = L.tileLayer(OSM_TILE, {
      attribution: OSM_ATTR,
      maxZoom: 19,
    });
    tiles.addTo(map);
    tiles.on("tileload", () => { tilesOk += 1; hideFallback(); });
    tiles.on("tileerror", () => {
      if (tilesOk === 0) showFallback("地圖圖磚載入失敗，改用已儲存的校園資料。");
    });
    window.setTimeout(() => {
      if (tilesOk === 0) showFallback(navigator.onLine === false
        ? "目前沒有網路，改用已儲存的校園資料。"
        : "地圖圖磚載入較慢或失敗，改用已儲存的校園資料。");
    }, 1800);
    map.on("moveend", declutter);
    map.on("zoomend", declutter);
    frameMap();
    drawPins();
    map.invalidateSize();
  }

  function activeBuilding(): string | undefined {
    return previewBuilding ?? state.place?.buildingCode;
  }

  function activePlace(): TkuPlace | null {
    return previewPlace ?? state.place;
  }

  function frameMap(): void {
    if (!map || !L) return;
    const buildingCode = activeBuilding();
    const building = buildingCode ? buildingByCode(buildingCode) : undefined;
    const loc = building ? buildingLocation(building) : null;
    const layer = state.layer;
    if ((layer === "building" || layer === "classroom") && loc) {
      map.setView([loc.lat, loc.lng], layer === "classroom" ? 18 : 17);
      return;
    }
    const bounds = campusBounds(state.campusId);
    if (bounds) {
      map.fitBounds(L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]), {
        paddingTopLeft: [28, 28],
        paddingBottomRight: [28, 110],
        maxZoom: 17,
      });
      return;
    }
    const anchor = campusAnchor(state.campusId);
    if (anchor) map.setView([anchor.lat, anchor.lng], 16);
  }

  function drawPins(): void {
    if (!map || !L) return;
    for (const marker of markers) marker.remove();
    markers = [];
    const pins = campusMapPins({ campusId: state.campusId, activeBuildingCode: activeBuilding() });
    for (const pin of pins) {
      const icon = L.divIcon({
        className: `tku-pin tku-pin--${pin.weight}`,
        html: pin.weight === "muted"
          ? `<span class="tku-pin__dot"></span>`
          : `<span class="tku-pin__dot"></span><span class="tku-pin__label" data-pin="${escapeHtml(pin.id)}">${escapeHtml(pin.shortLabel)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const marker = L.marker([pin.lat, pin.lng], {
        icon,
        keyboard: true,
        title: `${pin.name}（${pin.precision === "building" ? "樓館位置" : "校園位置"}）`,
        zIndexOffset: pin.weight === "active" ? 1000 : pin.weight === "related" ? 200 : 0,
        pinId: pin.id,
      });
      marker.addTo(map);
      marker.on("click", () => {
        if (pin.buildingCode) opts.onPreviewBuilding(pin.buildingCode);
        else opts.onCampus(pin.campusId);
      });
      markers.push(marker);
    }
    window.requestAnimationFrame(declutter);
  }

  function declutter(): void {
    if (!map) return;
    const candidates: ScreenLabelCandidate[] = [];
    const pins = campusMapPins({ campusId: state.campusId, activeBuildingCode: activeBuilding() });
    const byId = new Map(pins.map((p) => [p.id, p]));
    for (const marker of markers) {
      const eln = marker.getElement();
      const label = eln?.querySelector(".tku-pin__label") as HTMLElement | null;
      if (!eln || !label) continue;
      const pinId = label.dataset.pin ?? "";
      const pin = byId.get(pinId);
      const r = label.getBoundingClientRect();
      const stage = mapBox.getBoundingClientRect();
      candidates.push({
        id: pinId,
        priority: pin?.priority ?? 2,
        rect: { x: r.left - stage.left, y: r.top - stage.top, width: r.width, height: r.height },
      });
    }
    const visible = declutterScreenLabels(candidates, 8);
    for (const marker of markers) {
      const eln = marker.getElement();
      const label = eln?.querySelector(".tku-pin__label") as HTMLElement | null;
      if (!label) continue;
      const pinId = label.dataset.pin ?? "";
      const pin = byId.get(pinId);
      const show = (visible.has(pinId) || pin?.weight === "active") && pin?.weight !== "muted";
      label.style.visibility = show ? "visible" : "hidden";
    }
  }

  function renderCard(): void {
    const place = activePlace();
    const buildingCode = activeBuilding();
    const building = buildingCode ? buildingByCode(buildingCode) : undefined;
    const campus = campusById(state.campusId) ?? campusByPlace(place);
    card.innerHTML = "";
    const title = place?.name ?? (building ? `${building.code} ${building.name}` : campus?.name ?? "淡江大學");
    const bits = [
      campus?.name,
      building ? `${building.name}` : null,
      place?.floor != null ? `${place.floor}F` : null,
      place && place.room ? place.id : null,
    ].filter(Boolean);
    const loc: GeoPoint | null = building ? buildingLocation(building) : campusAnchor(state.campusId);
    const locLabel = loc?.label ?? (building && buildingMissingLocation(building.code) ? "樓館位置尚未公開標示" : "校園位置");
    const entrance = entranceHint(place);
    const current = state.place && place && state.place.id === place.id;
    card.append(
      el("div", { class: "campusmap__card-kicker", text: bits.join(" · ") || "淡江大學" }),
      el("strong", { class: "campusmap__card-title", text: title }),
      el("p", { class: "campusmap__card-loc", text: loc ? locLabel : "樓館位置尚未公開標示" }),
      el("p", { class: "campusmap__card-enter", text: entrance.text }),
    );
    const actions = el("div", { class: "campusmap__card-actions" });
    if (loc) {
      actions.append(
        button("Google 地圖", () => openUrl(googleMapsUrl(loc, title)), "btn btn--ghost campusmap__nav"),
        button("OpenStreetMap", () => openUrl(osmUrl(loc)), "btn btn--ghost campusmap__nav"),
      );
    }
    if (place && current) {
      actions.append(button("進入室內場佈", () => opts.onEnterIndoor(), "btn btn--primary campusmap__enter"));
    } else if (place && state.place && place.id !== state.place.id) {
      actions.append(el("p", { class: "hint", text: `這不是目前活動場地。目前活動在 ${state.place.name}。` }));
    } else if (state.place) {
      actions.append(button("進入室內場佈", () => opts.onEnterIndoor(), "btn btn--primary campusmap__enter"));
    }
    card.append(actions);

    photos.innerHTML = "";
    const refs = place ? photosForPlace(place.id) : [];
    if (refs.length) {
      for (const photo of refs) {
        photos.append(el("figure", { class: "campusphoto" }, [
          el("img", { class: "campusphoto__img", src: photo.thumbnail, alt: photo.title }),
          el("figcaption", { class: "campusphoto__cap" }, [
            el("strong", { text: photo.title }),
            el("span", { text: photo.capturedToward }),
            el("span", { class: "campusphoto__tag", text: photoBindingLabel(photo) }),
            el("span", { text: photo.visibleFixtures.join("、") }),
          ]),
        ]));
      }
    }
  }

  function syncChips(): void {
    chips.querySelectorAll<HTMLButtonElement>(".campusmap__chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.campus === state.campusId));
    });
  }

  function setState(next: CampusMapState): void {
    const campusChanged = next.campusId !== state.campusId;
    const buildingChanged = (previewBuilding ?? next.place?.buildingCode) !== (previewBuilding ?? state.place?.buildingCode)
      || next.layer !== state.layer;
    state = next;
    syncChips();
    renderCard();
    void ensureMap().then(() => {
      if (campusChanged || buildingChanged) {
        drawPins();
        frameMap();
      }
      map?.invalidateSize();
    });
  }

  function invalidate(): void {
    map?.invalidateSize();
    window.requestAnimationFrame(declutter);
  }

  function destroy(): void {
    map?.remove();
    map = null;
    L = null;
    markers = [];
  }

  return { root, setState, invalidate, destroy };
}

function openUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}
