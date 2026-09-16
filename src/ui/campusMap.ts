/**
 * Tamkang campus location view — OpenStreetMap + Leaflet, with an offline
 * directory fallback so a tile failure never whites out the screen.
 *
 * Building pins are 樓館位置. Indoor rooms are never given invented
 * coordinates. The current venue is loud; everything else is quiet.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { App } from "../app/App";
import {
  TKU_BUILDINGS,
  buildingByCode,
  campusById,
  physicalCampuses,
  placeById,
  searchTkuDirectory,
  type TkuCampusId,
  type TkuPlace,
} from "../core/tkuCampus";
import {
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  buildingNavLinks,
  campusMapView,
  entranceStatusText,
  pickNonOverlappingMapLabels,
  pinsForCampus,
  placeHeadline,
  placeNavLinks,
  type CampusMapPin,
} from "../core/campusMap";
import { freshmanPlaceForProject, type FreshmanLayer } from "../core/freshman";
import { photoBindingLabel, unboundVenuePhotos, venuePhotosForPlace } from "../core/venuePhotos";
import { button, el } from "./dom";

export interface CampusMapHandles {
  root: HTMLElement;
  show(): void;
  hide(): void;
  visible(): boolean;
  update(): void;
  focusPlace(place: TkuPlace): void;
}

type LeafletMap = import("leaflet").Map;
type LeafletLayer = import("leaflet").Layer;

interface MapSelection {
  campusId: TkuCampusId;
  buildingCode?: string;
  place?: TkuPlace;
}

export function buildCampusMap(app: App, opts: {
  onEnterIndoor: () => void;
  onLayoutChange: () => void;
}): CampusMapHandles {
  const root = el("section", {
    class: "campusmap",
    "data-map-dock": "top",
  });
  root.hidden = true;
  root.setAttribute("aria-label", "淡江校園位置");

  const search = el("input", {
    type: "search",
    class: "campusmap__search",
    placeholder: "搜尋樓館或教室，例如 E305、E310、SG320",
    "aria-label": "搜尋淡江樓館或教室",
  }) as HTMLInputElement;
  const campusBar = el("div", { class: "campusmap__campuses" });
  const results = el("div", { class: "campusmap__results" });
  results.hidden = true;
  const stage = el("div", { class: "campusmap__stage" });
  const leafletHost = el("div", { class: "campusmap__leaflet" });
  leafletHost.setAttribute("aria-label", "OpenStreetMap 校園地圖");
  const fallback = el("div", { class: "campusmap__fallback" });
  const failNote = el("p", {
    class: "campusmap__fail",
    text: "地圖暫時無法載入，改顯示已儲存的校園與樓館資料。",
  });
  failNote.hidden = true;
  const compass = el("div", { class: "campusmap__north", text: "北 ↑" });
  const attr = el("p", { class: "campusmap__attr", text: OSM_ATTRIBUTION });
  const sheet = el("div", { class: "campusmap__sheet" });
  const close = button("關閉", () => app.closeCampusMap(), "chip chip--sm campusmap__close");
  close.setAttribute("aria-label", "關閉校園位置圖");

  stage.append(leafletHost, fallback, failNote, compass);
  root.append(
    el("div", { class: "campusmap__toolbar" }, [
      el("div", { class: "campusmap__title-row" }, [
        el("strong", { class: "campusmap__title", text: "淡江校園位置" }),
        close,
      ]),
      search,
      campusBar,
    ]),
    results,
    stage,
    attr,
    sheet,
  );

  let shown = false;
  let query = "";
  let selection: MapSelection = { campusId: "tamsui" };
  let tilesFailed = false;
  let map: LeafletMap | null = null;
  let tileLayer: LeafletLayer | null = null;
  let pinLayer: LeafletLayer | null = null;
  let tileErrors = 0;

  for (const campus of physicalCampuses()) {
    const chip = el("button", {
      type: "button",
      class: "campuschip",
      "data-campus": campus.id,
      text: campus.name,
    }) as HTMLButtonElement;
    chip.addEventListener("click", () => {
      selection = { campusId: campus.id };
      query = "";
      search.value = "";
      results.hidden = true;
      void refresh();
    });
    campusBar.append(chip);
  }

  search.addEventListener("input", () => {
    query = search.value;
    applyTopHit();
    renderResults();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      search.value = "";
      query = "";
      results.hidden = true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      applyTopHit(true);
    }
  });

  function applyTopHit(commit = false): void {
    const hits = searchTkuDirectory(query, 8);
    if (!hits.length) return;
    const first = hits[0];
    selection = {
      campusId: first.campusId,
      buildingCode: first.buildingCode,
      place: first.placeId ? placeById(first.placeId) : undefined,
    };
    if (commit) {
      results.hidden = true;
      void refresh();
    }
  }

  function eventPlace(): TkuPlace | null {
    return freshmanPlaceForProject(app.store.getState());
  }

  function currentPlace(): TkuPlace | null {
    return selection.place ?? eventPlace();
  }

  function currentBuildingCode(): string | undefined {
    return selection.buildingCode
      ?? currentPlace()?.buildingCode
      ?? eventPlace()?.buildingCode;
  }

  function renderResults(): void {
    results.innerHTML = "";
    if (!query.trim()) {
      results.hidden = true;
      return;
    }
    const hits = searchTkuDirectory(query, 8);
    results.hidden = hits.length === 0;
    for (const hit of hits) {
      const row = el("button", { type: "button", class: "campusmap__hit" }, [
        el("span", { class: "campusmap__hit-title", text: hit.title }),
        el("span", { class: "campusmap__hit-sub", text: hit.subtitle }),
      ]) as HTMLButtonElement;
      row.addEventListener("click", () => {
        selection = {
          campusId: hit.campusId,
          buildingCode: hit.buildingCode,
          place: hit.placeId ? placeById(hit.placeId) : undefined,
        };
        search.value = hit.title;
        query = hit.title;
        results.hidden = true;
        void refresh();
      });
      results.append(row);
    }
  }

  function renderSheet(): void {
    sheet.innerHTML = "";
    const place = currentPlace();
    const code = currentBuildingCode();
    const building = code ? buildingByCode(code) : undefined;
    const campus = campusById(selection.campusId);
    const live = eventPlace();

    sheet.append(el("div", {
      class: "campusmap__where",
      text: place
        ? placeHeadline(place)
        : `${campus?.name ?? "淡江大學"} · ${building?.name ?? "請選一棟樓"}`,
    }));

    if (building) {
      sheet.append(el("p", { class: "campusmap__pin-kind", text: "樓館位置（公開座標，不是室內房間座標）" }));
      if (building.note) sheet.append(el("p", { class: "hint", text: building.note }));
      const links = place ? placeNavLinks(place) : buildingNavLinks(building);
      const row = el("div", { class: "campusmap__actions" });
      const g = el("a", { class: "btn", href: links.google, text: "Google 地圖導航" }) as HTMLAnchorElement;
      g.target = "_blank";
      g.rel = "noopener noreferrer";
      row.append(g);
      if (links.osm) {
        const o = el("a", { class: "btn btn--ghost", href: links.osm, text: "OpenStreetMap 位置" }) as HTMLAnchorElement;
        o.target = "_blank";
        o.rel = "noopener noreferrer";
        row.append(o);
      }
      sheet.append(row);
    } else if (campus) {
      sheet.append(el("p", { class: "hint", text: campus.address ?? campus.note }));
    }

    if (place) {
      const floor = place.floor != null ? `${place.floor}F` : null;
      sheet.append(el("p", { class: "campusmap__room", text: [place.name, floor].filter(Boolean).join(" · ") }));
      sheet.append(el("p", { class: "campusmap__entrance", text: entranceStatusText(place) }));
      const photos = [
        ...venuePhotosForPlace(place.id),
        ...(place.id === "E305" ? unboundVenuePhotos() : []),
      ];
      if (photos.length) {
        const strip = el("div", { class: "campusmap__photos" });
        for (const photo of photos) {
          strip.append(el("article", { class: "photocard" }, [
            el("div", { class: "photocard__thumb", text: "現場照片" }),
            el("strong", { text: photo.title }),
            el("span", { text: photo.direction }),
            el("span", { class: "photocard__tag", text: photoBindingLabel(photo) }),
            el("span", { class: "hint", text: photo.visibleFixtures.join("、") }),
          ]));
        }
        sheet.append(strip);
      }
    }

    if (live) {
      const enter = button("進入室內場佈", () => opts.onEnterIndoor(), "btn btn--primary btn--big");
      enter.dataset.action = "enter-indoor";
      sheet.append(enter);
    }
  }

  function renderFallback(): void {
    fallback.innerHTML = "";
    const pins = pinsForCampus(selection.campusId, currentBuildingCode());
    const current = currentBuildingCode();
    fallback.append(el("div", { class: "campusmap__legend", text: campusById(selection.campusId)?.name ?? "淡江校園" }));
    if (!pins.length) {
      const list = el("ul", { class: "campusmap__list" });
      for (const b of TKU_BUILDINGS.filter((b) => b.campusId === selection.campusId).slice(0, 16)) {
        const item = el("li", { class: current === b.code ? "is-current" : "" });
        item.append(button(`${b.code} ${b.name}`, () => {
          selection = { campusId: b.campusId, buildingCode: b.code };
          void refresh();
        }, "chip chip--sm"));
        list.append(item);
      }
      fallback.append(list);
      return;
    }
    const plot = el("div", { class: "campusmap__schematic" });
    const lats = pins.map((p) => p.lat);
    const lngs = pins.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const pad = 0.08;
    const dx = Math.max(maxLng - minLng, 0.002);
    const dy = Math.max(maxLat - minLat, 0.002);
    const candidates = pins.map((pin) => {
      const x = ((pin.lng - minLng) / dx) * (1 - pad * 2) + pad;
      const y = (1 - (pin.lat - minLat) / dy) * (1 - pad * 2) + pad;
      return { pin, x, y };
    });
    const labels = pickNonOverlappingMapLabels(candidates.map(({ pin, x, y }) => ({
      id: pin.code,
      x: x * 280,
      y: y * 180,
      width: pin.weight === "current" ? 88 : 56,
      height: 22,
      priority: pin.weight === "current" ? 0 : pin.weight === "related" ? 1 : 2,
    })));
    for (const { pin, x, y } of candidates) {
      const mark = el("button", {
        type: "button",
        class: `mappin mappin--${pin.weight}${labels.has(pin.code) ? "" : " mappin--dot"}`,
        text: labels.has(pin.code) ? `${pin.code} ${pin.name}` : pin.code,
        title: `${pin.name}（樓館位置）`,
      }) as HTMLButtonElement;
      mark.style.left = `${(x * 100).toFixed(2)}%`;
      mark.style.top = `${(y * 100).toFixed(2)}%`;
      mark.addEventListener("click", () => {
        selection = { campusId: pin.campusId, buildingCode: pin.code };
        void refresh();
      });
      plot.append(mark);
    }
    fallback.append(plot);
  }

  function zoomForLayer(layer: FreshmanLayer | undefined, base: number): number {
    if (layer === "campus") return Math.max(15, base - 1);
    if (layer === "classroom") return Math.min(19, base + 2);
    return base + 1;
  }

  function showFallback(failed: boolean): void {
    leafletHost.hidden = true;
    fallback.hidden = false;
    failNote.hidden = !failed;
    if (failed) root.dataset.tiles = "failed";
    else root.removeAttribute("data-tiles");
  }

  function mountLeaflet(): void {
    const view = campusMapView(selection.campusId);
    if (!view || !shown || tilesFailed) {
      showFallback(tilesFailed);
      return;
    }
    try {
      leafletHost.hidden = false;
      failNote.hidden = true;
      root.removeAttribute("data-tiles");
      if (!map) {
        map = L.map(leafletHost, {
          zoomControl: true,
          attributionControl: true,
        });
        tileLayer = L.tileLayer(OSM_TILE_URL, {
          attribution: OSM_ATTRIBUTION,
          maxZoom: 19,
        });
        tileLayer.on("tileerror", () => {
          tileErrors += 1;
          if (tileErrors >= 2) {
            tilesFailed = true;
            showFallback(true);
          }
        });
        tileLayer.addTo(map);
        map.attributionControl.setPrefix("");
      }
      map.invalidateSize();
      const pins = pinsForCampus(selection.campusId, currentBuildingCode());
      if (pinLayer) {
        pinLayer.remove();
        pinLayer = null;
      }
      const group = L.layerGroup();
      const current = currentBuildingCode();
      const projected: { pin: CampusMapPin; x: number; y: number }[] = [];
      for (const pin of pins) {
        const pt = map.latLngToContainerPoint([pin.lat, pin.lng]);
        projected.push({ pin, x: pt.x, y: pt.y });
      }
      const visible = pickNonOverlappingMapLabels(projected.map(({ pin, x, y }) => ({
        id: pin.code,
        x,
        y,
        width: pin.weight === "current" ? 96 : 64,
        height: 22,
        priority: pin.code === current ? 0 : pin.weight === "related" ? 1 : 2,
      })));
      for (const pin of pins) {
        const currentPin = pin.code === current;
        const showLabel = visible.has(pin.code) || currentPin;
        const marker = L.marker([pin.lat, pin.lng], {
          icon: L.divIcon({
            className: `leafpin leafpin--${pin.weight}`,
            html: showLabel
              ? `<span class="leafpin__label">${escapeHtml(pin.code)} ${escapeHtml(pin.name)}</span>`
              : `<span class="leafpin__dot"></span>`,
            iconSize: currentPin ? [120, 28] : [18, 18],
            iconAnchor: currentPin ? [60, 14] : [8, 8],
          }),
          zIndexOffset: currentPin ? 600 : pin.weight === "related" ? 200 : 0,
          title: `${pin.name}（樓館位置）`,
          keyboard: true,
        });
        marker.on("click", () => {
          selection = { campusId: pin.campusId, buildingCode: pin.code };
          refresh();
        });
        marker.addTo(group);
      }
      group.addTo(map);
      pinLayer = group;
      const focus = pins.find((p) => p.code === current) ?? pins[0];
      const layer = app.session.partner?.freshmanLayer;
      const zoom = zoomForLayer(layer, view.zoom);
      if (focus) map.setView([focus.lat, focus.lng], zoom, { animate: false });
      else map.setView([view.lat, view.lng], view.zoom, { animate: false });
    } catch {
      tilesFailed = true;
      showFallback(true);
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        default: return "&#39;";
      }
    });
  }

  function refresh(): void {
    root.dataset.campus = selection.campusId;
    close.hidden = app.session.partner?.audience === "freshman";
    campusBar.querySelectorAll<HTMLButtonElement>(".campuschip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.campus === selection.campusId));
    });
    renderFallback();
    renderSheet();
    if (tilesFailed) showFallback(true);
    else mountLeaflet();
    opts.onLayoutChange();
  }

  function syncSelectionFromProject(): void {
    const place = eventPlace();
    if (!place) return;
    selection = {
      campusId: place.campusId,
      buildingCode: place.buildingCode,
      place,
    };
  }

  function show(): void {
    shown = true;
    root.hidden = false;
    syncSelectionFromProject();
    void refresh();
    requestAnimationFrame(() => map?.invalidateSize());
  }

  function hide(): void {
    shown = false;
    root.hidden = true;
  }

  return {
    root,
    show,
    hide,
    visible: () => shown,
    update() {
      if (!shown) return;
      void refresh();
    },
    focusPlace(place) {
      selection = { campusId: place.campusId, buildingCode: place.buildingCode, place };
      if (shown) void refresh();
    },
  };
}
