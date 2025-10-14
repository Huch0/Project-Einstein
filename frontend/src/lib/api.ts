export interface DiagramParseDetection {
  id: string;
  label: string;
  bbox_px: [number, number, number, number];
  source_segment_id?: number | string | null;
}

export interface DiagramParseResponse {
  image: { width_px: number; height_px: number };
  detections: DiagramParseDetection[];
  parameters: { massA_kg: number; massB_kg: number; mu_k: number; gravity_m_s2: number };
  mapping: { origin_mode: string; scale_m_per_px: number };
  scene: unknown;
  meta: Record<string, unknown>;
  labels?: { entities: Array<{ segment_id: string; label: string; props?: Record<string, unknown> }> };
  segments?: Array<{
    id: number | string;
    bbox: [number, number, number, number];
    mask_path?: string | null;
    polygon_px?: Array<[number, number]>;
  }>;
}

export async function parseDiagram(file: File, opts?: { simulate?: boolean }): Promise<DiagramParseResponse> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const form = new FormData();
  form.append('file', file, file.name);
  const url = `${base}/diagram/parse${opts?.simulate ? '?simulate=1' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Parse failed: ${res.status} ${txt}`);
  }
  return res.json();
}
