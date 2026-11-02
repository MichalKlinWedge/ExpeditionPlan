import { describe, expect, it } from 'vitest';

import { codeCanvas, type CodeRaster } from '../code-raster.ts';

// bwip-js tylko w teście (core zostaje bez zależności) — ta sama wersja „generic” co w telefonie.
const bwip = await import('bwip-js/generic');

function raster(bcid: string, text: string): CodeRaster {
  const canvas = codeCanvas();
  bwip.render({ bcid, text, scale: 1, paddingwidth: 0, paddingheight: 0, ...(bcid === 'code128' ? { height: 10 } : {}) }, canvas.context as never);
  return canvas.result();
}
const at = (code: CodeRaster, x: number, y: number) => code.rows[y]!.some(([start, length]) => x >= start && x < start + length);

describe('kod jako raster (telefon, bez SVG)', () => {
  it('QR: trzy wzorce pozycjonujące — pełna ramka i dziura w środku', () => {
    const code = raster('qrcode', 'BAHIA-TEST-12345');
    expect([code.width, code.height]).toEqual([42, 42]);
    // Wzorzec 7×7 modułów po 2 piksele: ramka ciemna, pierścień jasny, środek 3×3 ciemny.
    for (const [ox, oy] of [[0, 0], [28, 0], [0, 28]] as const) {
      expect(at(code, ox + 1, oy + 1)).toBe(true);
      expect(at(code, ox + 3, oy + 3)).toBe(false);
      expect(at(code, ox + 7, oy + 7)).toBe(true);
    }
    // Prawy dolny róg QR nie ma wzorca pozycjonującego (ramka + jasny pierścień).
    expect(at(code, 41, 41) && !at(code, 39, 39) && at(code, 35, 35)).toBe(false);
  });

  it('Aztec i PDF417 dają ciemne moduły; kod kreskowy — paski na całą wysokość', () => {
    const aztec = raster('azteccode', 'M1KOWALSKI/JAN EABC123');
    const dark = aztec.rows.flat().reduce((sum, [, length]) => sum + length, 0);
    expect(dark).toBeGreaterThan(aztec.width * aztec.height * 0.3);
    expect(dark).toBeLessThan(aztec.width * aztec.height * 0.7);
    const pdf = raster('pdf417', 'ABC123456');
    expect(pdf.width).toBeGreaterThan(pdf.height);
    const bars = raster('code128', 'ABC-123');
    expect(bars.rows[2]).toEqual(bars.rows[bars.height - 3]);
    expect(bars.rows[2]!.length).toBeGreaterThan(10);
  });
});
