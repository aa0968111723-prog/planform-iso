/**
 * Asset quality / import gate — keep phones usable.
 */

export interface QualityMetrics {
  triangleCount: number;
  vertexCount: number;
  materialCount: number;
  textureCount: number;
  maxTextureDim: number;
  nodeCount: number;
  byteLength: number;
  drawCallEstimate: number;
}

export interface QualityReport extends QualityMetrics {
  passMobile: boolean;
  passStandard: boolean;
  warnings: string[];
}

export interface QualityLimits {
  maxTriangles: number;
  maxBytes: number;
  maxTextureDim: number;
  maxMaterials: number;
  maxNodes: number;
}

export const MOBILE_LIMITS: QualityLimits = {
  maxTriangles: 80_000,
  maxBytes: 8 * 1024 * 1024,
  maxTextureDim: 1024,
  maxMaterials: 24,
  maxNodes: 400,
};

export const STANDARD_LIMITS: QualityLimits = {
  maxTriangles: 200_000,
  maxBytes: 25 * 1024 * 1024,
  maxTextureDim: 2048,
  maxMaterials: 48,
  maxNodes: 800,
};

export function evaluateQuality(metrics: QualityMetrics, limits: QualityLimits = MOBILE_LIMITS): QualityReport {
  const warnings: string[] = [];
  if (metrics.triangleCount > limits.maxTriangles) {
    warnings.push(`三角形過多：${metrics.triangleCount} > ${limits.maxTriangles}`);
  }
  if (metrics.byteLength > limits.maxBytes) {
    warnings.push(`檔案過大：${Math.round(metrics.byteLength / 1024)} KB`);
  }
  if (metrics.maxTextureDim > limits.maxTextureDim) {
    warnings.push(`貼圖過大：${metrics.maxTextureDim}px`);
  }
  if (metrics.materialCount > limits.maxMaterials) {
    warnings.push(`材質過多：${metrics.materialCount}`);
  }
  if (metrics.nodeCount > limits.maxNodes) {
    warnings.push(`節點過多：${metrics.nodeCount}`);
  }
  const pass = warnings.length === 0;
  return {
    ...metrics,
    passMobile: evaluateAgainst(metrics, MOBILE_LIMITS),
    passStandard: evaluateAgainst(metrics, STANDARD_LIMITS),
    warnings: pass ? warnings : warnings,
  };
}

function evaluateAgainst(m: QualityMetrics, limits: QualityLimits): boolean {
  return (
    m.triangleCount <= limits.maxTriangles &&
    m.byteLength <= limits.maxBytes &&
    m.maxTextureDim <= limits.maxTextureDim &&
    m.materialCount <= limits.maxMaterials &&
    m.nodeCount <= limits.maxNodes
  );
}

export function emptyMetrics(byteLength = 0): QualityMetrics {
  return {
    triangleCount: 0,
    vertexCount: 0,
    materialCount: 0,
    textureCount: 0,
    maxTextureDim: 0,
    nodeCount: 0,
    byteLength,
    drawCallEstimate: 0,
  };
}
