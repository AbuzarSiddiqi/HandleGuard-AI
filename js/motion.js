// Motion-blob detector for real footage: COCO-SSD has no "carton" class, so moving
// products (dropped / thrown / rolled / dragged boxes) are found by frame differencing.
// Blobs overlapping a detected person are suppressed (person motion is not an object event).
const GW = 96, GH = 54;

export class MotionDetector {
  constructor() {
    this.prev = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = GW; this.canvas.height = GH;
    this.gctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.frame = 0;
  }

  // persons: normalized person detections to suppress
  detect(videoEl, persons = []) {
    if (!videoEl.videoWidth) return [];
    this.frame++;
    this.gctx.drawImage(videoEl, 0, 0, GW, GH);
    let gray;
    try {
      gray = new Uint8Array(GW * GH);
      const d = this.gctx.getImageData(0, 0, GW, GH).data;
      for (let i = 0; i < GW * GH; i++) gray[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 4 + d[i * 4 + 2]) >> 3;
    } catch (e) { return []; }
    if (!this.prev || this.frame % 90 === 0) { this.prev = gray; return []; } // re-baseline occasionally

    const diff = new Uint8Array(GW * GH);
    for (let i = 0; i < gray.length; i++) diff[i] = Math.abs(gray[i] - this.prev[i]) > 32 ? 1 : 0;
    this.prev = gray;

    // connected components (BFS)
    const seen = new Uint8Array(GW * GH);
    const blobs = [];
    const qx = new Int16Array(GW * GH), qy = new Int16Array(GW * GH);
    for (let start = 0; start < diff.length; start++) {
      if (!diff[start] || seen[start]) continue;
      let head = 0, tail = 0;
      qx[tail] = start % GW; qy[tail] = (start / GW) | 0; tail++;
      seen[start] = 1;
      let minX = GW, maxX = 0, minY = GH, maxY = 0, n = 0;
      while (head < tail) {
        const x = qx[head], y = qy[head]; head++;
        n++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const idx = ny * GW + nx;
          if (diff[idx] && !seen[idx]) { seen[idx] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
        }
      }
      if (n < 14 || n > GW * GH * 0.32) continue;
      const m = 1;
      const bx = Math.max(0, (minX - m) / GW), by = Math.max(0, (minY - m) / GH);
      const bw = Math.min(1, (maxX - minX + 1 + 2 * m) / GW), bh = Math.min(1, (maxY - minY + 1 + 2 * m) / GH);
      // Suppress CCTV player overlay regions (top camera timecode & bottom scrubber bar)
      if (by < 0.08 || by + bh > 0.88) continue;
      if (bw < 0.03 || bh < 0.03) continue;
      blobs.push({ x: bx, y: by, w: bw, h: bh, n });
    }
    // merge overlapping and nearby adjacent blobs (clusters large items like mattresses)
    const merged = [];
    for (const b of blobs.sort((a, z) => z.n - a.n)) {
      let hit = null;
      for (const m of merged) {
        const gapX = Math.max(0, Math.max(m.x, b.x) - Math.min(m.x + m.w, b.x + b.w));
        const gapY = Math.max(0, Math.max(m.y, b.y) - Math.min(m.y + m.h, b.y + b.h));
        if (gapX <= 0.035 && gapY <= 0.035) { hit = m; break; }
      }
      if (hit) {
        const x1 = Math.min(hit.x, b.x), y1 = Math.min(hit.y, b.y);
        const x2 = Math.max(hit.x + hit.w, b.x + b.w), y2 = Math.max(hit.y + hit.h, b.y + b.h);
        Object.assign(hit, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, n: hit.n + b.n });
      } else merged.push({ ...b });
    }
    // suppress blobs dominated by a person box
    return merged
      .filter(b => !persons.some(p => {
        const ix = Math.max(0, Math.min(p.x + p.w, b.x + b.w) - Math.max(p.x, b.x));
        const iy = Math.max(0, Math.min(p.y + p.h, b.y + b.h) - Math.max(p.y, b.y));
        return ix * iy > 0.55 * b.w * b.h;
      }))
      .slice(0, 8)
      .map(b => ({ label: 'motion', cls: 'object', score: 0.6, motion: true, x: b.x, y: b.y, w: b.w, h: b.h }));
  }
}
