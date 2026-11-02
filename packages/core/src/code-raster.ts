/**
 * Kod z sejfu jako raster do narysowania bez SVG i bez modułów natywnych (telefon): kontekst
 * rysowania w kształcie `DrawingContext` z bwip-js zbiera obrysy i paski, a `result()` zamienia je
 * na wiersze ciemnych odcinków. Obrysy kodów 2D to złożone wielokąty z dziurami (wzorce QR),
 * więc piksel liczy się regułą parzystości dla środka piksela. Bez zależności — biblioteka
 * kodów podaje tylko kontekst, którego używa.
 */

export type CodeRaster = {
  width: number;
  height: number;
  /** Dla każdego wiersza pikseli: ciemne odcinki [początek, długość]. */
  rows: [number, number][][];
};

type Point = [number, number];

/** Kontekst zgodny z `DrawingContext` bwip-js (`render(opts, context)`), przy `scale: 1`. */
export function codeCanvas() {
  let width = 0;
  let height = 0;
  let pending: Point[][] = [];
  const shapes: Point[][][] = [];
  const bars: [number, number, number, number][] = [];

  const context = {
    scale: () => null,
    measure: () => ({ width: 0, ascent: 0, descent: 0 }),
    init(w: number, h: number) {
      width = Math.ceil(w);
      height = Math.ceil(h);
    },
    /** Kody kreskowe: pionowe paski o grubości `lw`. */
    line(x0: number, y0: number, x1: number, y1: number, lw: number) {
      if (x0 === x1) bars.push([x0 - lw / 2, Math.min(y0, y1), lw, Math.abs(y1 - y0)]);
      else bars.push([Math.min(x0, x1), y0 - lw / 2, Math.abs(x1 - x0), lw]);
    },
    polygon(points: Point[]) {
      pending.push(points);
    },
    hexagon(points: Point[]) {
      pending.push(points);
    },
    ellipse() {
      // MaxiCode (oko) — sejf go nie używa.
    },
    fill() {
      if (pending.length > 0) shapes.push(pending);
      pending = [];
    },
    text() {
      // Opis pod kodem kreskowym pokazujemy osobno, zwykłym tekstem.
    },
    end: () => null,
  };

  const inside = (polygons: Point[][], x: number, y: number) => {
    let odd = false;
    for (const polygon of polygons) {
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]!;
        const [xj, yj] = polygon[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
      }
    }
    return odd;
  };

  const result = (): CodeRaster => {
    const rows: [number, number][][] = [];
    for (let y = 0; y < height; y++) {
      const dark: boolean[] = new Array(width).fill(false);
      for (const polygons of shapes) for (let x = 0; x < width; x++) if (!dark[x] && inside(polygons, x + 0.5, y + 0.5)) dark[x] = true;
      for (const [bx, by, bw, bh] of bars) {
        if (y + 0.5 < by || y + 0.5 > by + bh) continue;
        for (let x = Math.max(0, Math.floor(bx)); x < Math.min(width, Math.ceil(bx + bw)); x++) if (x + 0.5 >= bx && x + 0.5 <= bx + bw) dark[x] = true;
      }
      const runs: [number, number][] = [];
      dark.forEach((on, x) => {
        if (!on) return;
        const last = runs.at(-1);
        if (last && last[0] + last[1] === x) last[1]++;
        else runs.push([x, 1]);
      });
      rows.push(runs);
    }
    return { width, height, rows };
  };

  return { context, result };
}
