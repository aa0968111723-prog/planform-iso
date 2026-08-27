import {
  CanvasTexture,
  LinearFilter,
  Sprite,
  SpriteMaterial,
} from "three";
import { LABEL_PILL_RGBA } from "../core/theme";

/**
 * A billboarded text label rendered from a 2D canvas. Kept small and cached
 * so labels are not rebuilt every frame.
 */
export interface TextLabelOptions {
  /** Texture width in px — raise it for large partner-mode labels. */
  width?: number;
  height?: number;
  fontSize?: number;
}

export class TextLabel {
  readonly sprite: Sprite;
  private text = "";
  private color = "#e2e8f0";
  private texture: CanvasTexture;
  private canvas: HTMLCanvasElement;
  private fontSize: number;

  constructor(opts: TextLabelOptions = {}) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = opts.width ?? 256;
    this.canvas.height = opts.height ?? 64;
    this.fontSize = opts.fontSize ?? 30;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    const material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.sprite = new Sprite(material);
    this.sprite.scale.set(1.6, 0.4, 1);
    this.sprite.renderOrder = 999;
  }

  set(text: string, color: string): void {
    if (text === this.text && color === this.color) return;
    this.text = text;
    this.color = color;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // One source for the pill colour, so contrast can be tested against it.
    ctx.fillStyle = `rgba(${LABEL_PILL_RGBA.r},${LABEL_PILL_RGBA.g},${LABEL_PILL_RGBA.b},${LABEL_PILL_RGBA.a})`;
    roundRect(ctx, 2, 2, this.canvas.width - 4, this.canvas.height - 4, this.canvas.height / 5);
    ctx.fill();
    ctx.font = `700 ${this.fontSize}px system-ui, 'Noto Sans TC', sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitLabelText(ctx, text, this.canvas.width - 16), this.canvas.width / 2, this.canvas.height / 2);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
  }
}

function fitLabelText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  const suffix = "…";
  let text = value;
  while (text.length > 1 && ctx.measureText(`${text}${suffix}`).width > maxWidth) text = text.slice(0, -1);
  return `${text}${suffix}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
