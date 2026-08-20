import type { Project } from "../core/model";

function download(filename: string, href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function exportProjectJson(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safe = (project.name || "planform-iso").replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
  download(`${safe}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importProjectJson(file: File): Promise<Partial<Project>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as Partial<Project>);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function downloadPng(dataUrl: string, name: string): void {
  download(name, dataUrl);
}

/** Keep filenames friendly for LINE/相簿: project name + plan type + date. */
export function pngFilename(projectName: string, kind: string): string {
  const safe = (projectName || "場佈圖").replace(/[^\w一-龥-]+/g, "_").slice(0, 40);
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${safe}-${kind}-${date}.png`;
}

/**
 * Share a PNG via the native share sheet (LINE 等) when available, falling
 * back to a normal download. Returns how it was delivered.
 */
export async function sharePng(dataUrl: string, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === "function" && typeof nav.canShare === "function") {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], name, { type: "image/png" });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: name });
        return "shared";
      }
    }
  } catch (err) {
    // AbortError = the user closed the share sheet on purpose — do nothing.
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
  }
  download(name, dataUrl);
  return "downloaded";
}
