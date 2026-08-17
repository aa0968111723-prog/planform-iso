import type { PlanSummary } from "../core/summary";

interface LegendEntry {
  color: string;
  label: string;
}

/**
 * Compose a self-explanatory share image: the top-view render plus a title,
 * a plain-language summary, and a color legend — so a teammate can read the
 * plan without opening the app.
 */
export function buildShareImage(
  topPng: string,
  summary: PlanSummary,
  legend: LegendEntry[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const pad = 28;
      const width = Math.max(img.width, 960);
      const headerH = 60 + summary.lines.length * 26 + 16;
      const legendH = 40 + Math.ceil(legend.length / 3) * 30;
      const imgW = width - pad * 2;
      const imgH = (img.height / img.width) * imgW;
      const height = headerH + imgH + legendH + pad;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));

      ctx.fillStyle = "#0b1120";
      ctx.fillRect(0, 0, width, height);

      // Title.
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "700 30px system-ui, 'Noto Sans TC', sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(summary.title, pad, pad);

      // Summary lines.
      ctx.font = "400 18px system-ui, 'Noto Sans TC', sans-serif";
      ctx.fillStyle = "#94a3b8";
      summary.lines.forEach((line, i) => {
        ctx.fillText(line, pad, pad + 44 + i * 26, width - pad * 2);
      });

      // Plan image.
      const imgY = headerH;
      ctx.drawImage(img, pad, imgY, imgW, imgH);
      ctx.strokeStyle = "rgba(148,163,184,0.3)";
      ctx.strokeRect(pad, imgY, imgW, imgH);

      // Legend.
      const legendY = imgY + imgH + 16;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 16px system-ui, 'Noto Sans TC', sans-serif";
      ctx.fillText("圖例", pad, legendY);
      ctx.font = "400 15px system-ui, 'Noto Sans TC', sans-serif";
      const colW = (width - pad * 2) / 3;
      legend.forEach((e, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = pad + col * colW;
        const y = legendY + 26 + row * 30;
        ctx.fillStyle = e.color;
        ctx.fillRect(x, y, 18, 18);
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(e.label, x + 26, y + 1, colW - 30);
      });

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = topPng;
  });
}
