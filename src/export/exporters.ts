import type { Project } from "../core/model";

function download(filename: string, href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Download arbitrary text as a file. Shared by the project and prop writers. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** Convert a data URL into bytes without relying on a server-side converter. */
function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/**
 * Build a small, standards-compliant one-page PDF containing an already
 * rendered plan. This deliberately uses a JPEG image XObject instead of a
 * second layout engine: the PDF therefore has the exact same label setting,
 * colours and positions as the PNG that organisers previewed.
 */
export function buildPlanPdf(jpegDataUrl: string, pixelWidth: number, pixelHeight: number): Uint8Array {
  const image = dataUrlBytes(jpegDataUrl);
  // Keep an A4-like long edge in PDF points while retaining the scene's exact
  // aspect ratio. A PDF viewer can scale it for A3 without reflowing labels.
  const pageWidth = pixelWidth >= pixelHeight ? 842 : 595;
  const pageHeight = Math.round(pageWidth * pixelHeight / pixelWidth);
  const content = ascii(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
  const objects: Uint8Array[] = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>"),
    ascii("<< /Type /Pages /Count 1 /Kids [3 0 R] >>"),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    joinBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),
      image,
      ascii("\nendstream"),
    ]),
    joinBytes([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("endstream")]),
  ];
  const header = ascii("%PDF-1.4\n");
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let offset = header.length;
  objects.forEach((object, index) => {
    const prefix = ascii(`${index + 1} 0 obj\n`);
    const suffix = ascii("\nendobj\n");
    offsets.push(offset);
    parts.push(prefix, object, suffix);
    offset += prefix.length + object.length + suffix.length;
  });
  const xref = offset;
  parts.push(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (let i = 1; i < offsets.length; i++) parts.push(ascii(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`));
  parts.push(ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return joinBytes(parts);
}

/** Download the current plan as a PDF, preserving the current PNG appearance. */
export async function downloadPlanPdf(pngDataUrl: string, filename: string): Promise<void> {
  const image = new Image();
  image.src = pngDataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立 PDF 畫布");
  // JPEG is natively understood by PDF readers. White is intentional for
  // transparent pixels in imported art, matching the plan page background.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const pdf = buildPlanPdf(canvas.toDataURL("image/jpeg", 0.94), canvas.width, canvas.height);
  // Copy into a plain ArrayBuffer: TypeScript 6 distinguishes the generic
  // Uint8Array backing store from the ArrayBuffer Blob accepts.
  const blobBytes = new Uint8Array(pdf.length);
  blobBytes.set(pdf);
  const url = URL.createObjectURL(new Blob([blobBytes.buffer], { type: "application/pdf" }));
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
