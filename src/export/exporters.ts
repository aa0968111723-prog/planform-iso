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
