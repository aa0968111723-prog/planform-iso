/**
 * Tamkang campus location map — OpenStreetMap + Leaflet, no API key.
 *
 * Tiles are best-effort. The directory, search, and current-venue card stay
 * on screen when tiles fail or the device is offline.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  BUILDING_PIN_KIND,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  buildingHasPublicCoords,
  shouldShowMapFallback,
  buildingMarkersForCampus,
  buildingNavQuery,
  campusCenter,
  currentBuildingOf,
  currentPlaceOf,
  entranceStatus,
  fitBoundsForMarkers,
  formatFreshmanHeadline,
  googleMapsUrl,
  hitToCampusRef,
  osmLocationUrl,
  physicalCampuses,
  placeNonOverlappingLabels,
  searchTkuDirectory,
  type BuildingMapMarker,
} from "../core/campusNav";
import {
  buildingByCode,
  campusById,
  placesInBuilding,
  type TkuCampusRef,
} from "../core/tkuCampus";
import { photosForPlace, photosForVenue, photoBindingLabel, UNBOUND_PHOTO_LABEL } from "../core/venuePhotos";
import { button, el } from "./dom";

export interface CampusMapOptions {
  initial: TkuCampusRef;
  mode: "overlay" | "embedded";
  onRefChange: (ref: TkuCampusRef) => void;
  onEnterLayout: (ref: TkuCampusRef) => void;
  onClose?: () => void;
}

export interface CampusMapHandles {
  root: HTMLElement;
  setRef(ref: TkuCampusRef): void;
  currentRef(): TkuCampusRef;
  invalidateSize(): void;
  setVisible(on: boolean): void;
  destroy(): void;
}

export function buildCampusMap(opts: CampusMapOptions): CampusMapHandles {
  let ref: TkuCampusRef = { ...opts.initial };
  let tileFailed = false;
  let tileErrors = 0;
  let leafletMap: L.Map | null = null;
  const markerLayer = L.layerGroup();
  let ready = false;

  const searchInput = el("input", {
    type: "search",
    class: "campusmap__search",
    placeholder: "搜尋樓館或教室，例如 E305、E310、SG320",
    "aria-label": "搜尋淡江樓館或教室",
    autocomplete: "off",
  }) as HTMLInputElement;
  const hitsBox = el("div", { class: "campusmap__hits", style: "display:none" });
  const leafletHost = el("div", { class: "campusmap__leaflet", "data-campus-map": "leaflet" });
  const fallback = el("div", { class: "campusmap__fallback", style: "display:none" });
  const card = el("div", { class: "campusmap__card" });
  const north = el("div", { class: "campusmap__north", text: "N ↑" });
  north.setAttribute("aria-label", "北方朝上");
  const attrib = el("div", { class: "campusmap__attrib" }, [
    el("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noreferrer", text: OSM_ATTRIBUTION }),
  ]);

  const head = el("div", { class: "campusmap__head" }, [
    el("div", { class: "campusmap__title", text: "淡江大學校園位置" }),
    ...(opts.onClose ? [button("關閉", () => opts.onClose?.(), "chip chip--sm")] : []),
  ]);

  const campuses = el("div", { class: "campusmap__campuses" });
  for (const id of physicalCampuses()) {
    const campus = campusById(id)!;
    const chip = button(campus.name, () => {
      setRef({ campusId: id });
    }, "chip chip--sm campusmap__campus");
    chip.dataset.campus = id;
    campuses.append(chip);
  }

  const root = el("div", {
    class: `campusmap campusmap--${opts.mode}`,
    "data-campus-map": "root",
  }, [
    head,
    campuses,
    el("div", { class: "campusmap__searchwrap" }, [searchInput, hitsBox]),
    el("div", { class: "campusmap__stage" }, [leafletHost, fallback, north, attrib]),
    card,
  ]);

  function showFallback(reason: string): void {
    tileFailed = true;
    fallback.style.display = "flex";
    fallback.innerHTML = "";
    fallback.append(
      el("p", { class: "campusmap__fallback-title", text: "地圖暫時無法載入" }),
      el("p", { class: "hint", text: reason }),
      directoryList(),
    );
    leafletHost.classList.add("campusmap__leaflet--failed");
  }

  function directoryList(): HTMLElement {
    const list = el("div", { class: "campusmap__dir" });
    const campus = campusById(ref.campusId);
    list.append(el("div", { class: "campusmap__dir-title", text: campus?.name ?? "校園目錄" }));
    for (const m of buildingMarkersForCampus(ref.campusId, ref.buildingCode)) {
      list.append(button(
        `${m.code} ${m.name}${m.code === ref.buildingCode ? " · 目前場地" : ""}`,
        () => setRef({ campusId: ref.campusId, buildingCode: m.code }),
        m.code === ref.buildingCode ? "campusmap__dir-row campusmap__dir-row--current" : "campusmap__dir-row",
      ));
    }
    const unlocated = ["CL", "LH", "LX", "LW"].map(buildingByCode).filter((b): b is NonNullable<typeof b> => !!b && b.campusId === ref.campusId);
    for (const b of unlocated) {
      list.append(button(
        `${b.code} ${b.name} · 尚無公開樓館座標`,
        () => setRef({ campusId: b.campusId, buildingCode: b.code }),
        "campusmap__dir-row",
      ));
    }
    return list;
  }

  function initMap(): void {
    if (leafletMap) return;
    try {
      leafletMap = L.map(leafletHost, {
        zoomControl: true,
        attributionControl: false,
        maxZoom: 19,
        minZoom: 12,
      });
      // Leaflet refuses latLngToContainerPoint until a view exists.
      const center = campusCenter(ref.campusId) ?? { lat: 25.1758, lng: 121.4501 };
      leafletMap.setView([center.lat, center.lng], 16, { animate: false });
      const tiles = L.tileLayer(OSM_TILE_URL, {
        attribution: OSM_ATTRIBUTION,
        maxZoom: 19,
        crossOrigin: true,
      });
      tiles.on("tileerror", () => {
        tileErrors += 1;
        if (shouldShowMapFallback(tileErrors) && !tileFailed) {
          showFallback("離線或圖資載入失敗時，仍可從下方目錄找到校園、樓館與教室。");
        }
      });
      tiles.addTo(leafletMap);
      markerLayer.addTo(leafletMap);
      leafletMap.on("zoomend", () => renderMarkers());
      leafletMap.on("moveend", () => renderMarkers());
    } catch {
      showFallback("這台裝置無法顯示地圖圖資，改用校園目錄。");
    }
  }

  function mapHasView(): boolean {
    if (!leafletMap) return false;
    try {
      leafletMap.getCenter();
      return true;
    } catch {
      return false;
    }
  }

  function renderMarkers(): void {
    markerLayer.clearLayers();
    if (!leafletMap || !mapHasView()) return;
    const markers = buildingMarkersForCampus(ref.campusId, ref.buildingCode);
    const labels: { id: string; x: number; y: number; width: number; height: number; priority: 0 | 1 | 2 }[] = [];
    for (const m of markers) {
      const pt = leafletMap.latLngToContainerPoint([m.lat, m.lng]);
      labels.push({
        id: m.code,
        x: pt.x,
        y: pt.y,
        width: Math.min(120, 18 + m.pinLabel.length * 12),
        height: 22,
        priority: m.isCurrent ? 0 : 1,
      });
    }
    const placed = placeNonOverlappingLabels(labels);
    const visible = new Map(placed.map((p) => [p.id, p]));
    for (const m of markers) {
      const vis = visible.get(m.code);
      const showLabel = vis?.visible !== false;
      const marker = L.marker([m.lat, m.lng], {
        icon: L.divIcon({
          className: `campin campin--${m.weight}${m.isCurrent ? " campin--current" : ""}`,
          html: `<span class="campin__dot"></span>${showLabel ? `<span class="campin__label">${escapeHtml(shortPin(m))}</span>` : ""}`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        keyboard: true,
        title: `${m.name}（${BUILDING_PIN_KIND}）`,
        zIndexOffset: m.isCurrent ? 600 : 0,
      });
      marker.on("click", () => setRef({ campusId: m.campusId, buildingCode: m.code }));
      markerLayer.addLayer(marker);
    }
  }

  function shortPin(m: BuildingMapMarker): string {
    return m.isCurrent ? m.name : m.code;
  }

  function fit(): void {
    if (!leafletMap) return;
    const markers = buildingMarkersForCampus(ref.campusId, ref.buildingCode);
    const current = markers.filter((m) => m.isCurrent);
    const padBottom = Math.max(120, Math.round(card.getBoundingClientRect().height) + 16);
    const pad: L.FitBoundsOptions = {
      paddingTopLeft: [24, 28],
      paddingBottomRight: [24, padBottom],
      maxZoom: current.length ? 18 : 16,
      animate: false,
    };
    const bounds = fitBoundsForMarkers(current.length ? current : markers);
    if (bounds) {
      leafletMap.fitBounds(
        L.latLngBounds([bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]),
        pad,
      );
    } else {
      const center = campusCenter(ref.campusId);
      if (center) leafletMap.setView([center.lat, center.lng], 16, { animate: false });
    }
  }

  function renderCard(): void {
    const campus = campusById(ref.campusId);
    const building = currentBuildingOf(ref);
    const place = currentPlaceOf(ref);
    const rooms = building
      ? placesInBuilding(building.code).filter((p) => p.kind === "classroom" || p.kind === "office" || p.kind === "hall")
      : [];
    const entrance = entranceStatus(ref);
    const headline = formatFreshmanHeadline(ref);
    const hasCoords = building ? buildingHasPublicCoords(building.code) : false;
    const lat = building?.lat ?? campusCenter(ref.campusId)?.lat;
    const lng = building?.lng ?? campusCenter(ref.campusId)?.lng;
    const photos = [
      ...(place ? photosForPlace(place.id) : []),
      ...(place?.venuePresetId ? photosForVenue(place.venuePresetId) : []),
    ].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);

    card.innerHTML = "";
    card.append(
      el("div", { class: "campusmap__headline", text: headline }),
      el("div", { class: "campusmap__facts" }, [
        fact("校園", campus?.name ?? "—"),
        fact("樓館", building ? `${building.code} ${building.name}` : "請選擇樓館"),
        fact("樓層", ref.floor != null ? (ref.floor === 0 ? "B1" : `${ref.floor}F`) : (place?.floor != null ? `${place.floor}F` : "—")),
        fact("教室", place?.id && /^[A-Z]/.test(place.id) ? place.id : (ref.room ? ref.room : "—")),
      ]),
      el("p", {
        class: "campusmap__pin-kind",
        text: hasCoords
          ? BUILDING_PIN_KIND
          : (building ? "此樓館尚無公開座標，圖上不標室內位置" : "選一棟樓館後會縮放到樓館位置"),
      }),
      el("p", { class: "campusmap__entrance", text: entrance.label }),
    );

    if (photos.length) {
      const row = el("div", { class: "campusmap__photos" });
      for (const photo of photos.slice(0, 6)) {
        row.append(el("div", { class: "campusmap__photo" }, [
          el("div", { class: "campusmap__photo-thumb", text: "📷" }),
          el("div", { class: "campusmap__photo-title", text: photo.title }),
          el("div", { class: "campusmap__photo-meta", text: `${photo.direction} · ${photoBindingLabel(photo)}` }),
          el("div", { class: "hint", text: photo.visibleFacilities.join("、") || UNBOUND_PHOTO_LABEL }),
        ]));
      }
      card.append(row);
    }

    const actions = el("div", { class: "campusmap__actions" });
    if (typeof lat === "number" && typeof lng === "number") {
      const g = el("a", {
        class: "btn btn--ghost campusmap__link",
        href: googleMapsUrl(lat, lng, building ? buildingNavQuery(building) : campus?.name),
        target: "_blank",
        rel: "noreferrer",
        text: "Google Maps 導航",
      });
      const o = el("a", {
        class: "btn btn--ghost campusmap__link",
        href: osmLocationUrl(lat, lng),
        target: "_blank",
        rel: "noreferrer",
        text: "OpenStreetMap 位置",
      });
      actions.append(g, o);
    }
    if (place || building) {
      actions.append(button("進入室內場佈", () => opts.onEnterLayout(ref), "btn btn--primary"));
    }
    card.append(actions);

    if (building && rooms.length) {
      const roomRow = el("div", { class: "campusmap__rooms" });
      for (const room of rooms.slice(0, 12)) {
        const on = room.id === place?.id;
        roomRow.append(button(
          room.id.match(/^[A-Z]/) ? room.id : room.name,
          () => setRef({
            campusId: room.campusId,
            buildingCode: room.buildingCode,
            floor: room.floor,
            room: room.room,
            placeId: room.id,
          }),
          on ? "chip chip--sm chip--primary" : "chip chip--sm",
        ));
      }
      card.append(el("div", { class: "subhead", text: "這棟樓的教室" }), roomRow);
    }

    campuses.querySelectorAll<HTMLButtonElement>(".campusmap__campus").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.campus === ref.campusId));
    });
  }

  function fact(label: string, value: string): HTMLElement {
    return el("div", { class: "campusmap__fact" }, [
      el("span", { class: "campusmap__fact-k", text: label }),
      el("span", { class: "campusmap__fact-v", text: value }),
    ]);
  }

  function renderHits(q: string): void {
    const hits = searchTkuDirectory(q, 12);
    hitsBox.innerHTML = "";
    if (!q.trim() || !hits.length) {
      hitsBox.style.display = "none";
      return;
    }
    hitsBox.style.display = "flex";
    for (const hit of hits) {
      const row = button(`${hit.title}`, () => {
        searchInput.value = hit.title;
        hitsBox.style.display = "none";
        setRef(hitToCampusRef(hit));
      }, "campusmap__hit");
      row.append(el("span", { class: "campusmap__hit-sub", text: hit.subtitle }));
      hitsBox.append(row);
    }
  }

  function setRef(next: TkuCampusRef): void {
    ref = { ...next };
    if (next.placeId && next.floor == null) {
      const place = currentPlaceOf(next);
      if (place?.floor != null) ref.floor = place.floor;
      if (place?.room && !ref.room) ref.room = place.room;
      if (place?.buildingCode && !ref.buildingCode) ref.buildingCode = place.buildingCode;
    }
    if (ready) opts.onRefChange(ref);
    renderCard();
    if (tileFailed) {
      fallback.innerHTML = "";
      fallback.append(
        el("p", { class: "campusmap__fallback-title", text: "地圖暫時無法載入" }),
        el("p", { class: "hint", text: "離線時仍可查看已儲存的校園、樓館與教室。" }),
        directoryList(),
      );
    }
    initMap();
    fit();
    renderMarkers();
  }

  searchInput.addEventListener("input", () => renderHits(searchInput.value));
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const hits = searchTkuDirectory(searchInput.value, 1);
      if (hits[0]) {
        hitsBox.style.display = "none";
        setRef(hitToCampusRef(hits[0]));
      }
    }
  });

  initMap();
  setRef(ref);
  ready = true;

  return {
    root,
    setRef,
    currentRef: () => ref,
    invalidateSize: () => {
      leafletMap?.invalidateSize();
      fit();
    },
    setVisible: (on) => {
      root.style.display = on ? "flex" : "none";
      if (on) {
        requestAnimationFrame(() => {
          leafletMap?.invalidateSize();
          fit();
        });
      }
    },
    destroy: () => {
      leafletMap?.remove();
      leafletMap = null;
      root.remove();
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]!));
}

export function defaultCampusRef(): TkuCampusRef {
  return { campusId: "tamsui", buildingCode: "E", floor: 3, room: "10", placeId: "E310" };
}
