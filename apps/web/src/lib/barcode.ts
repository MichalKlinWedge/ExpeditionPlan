import { CODE_FORMATS, codeSymbol, isLinearCode } from "@expeditionplan/core";

/**
 * Kody z dokumentów sejfu, tylko w przeglądarce: odczyt z obrazu albo ze stron PDF (zxing-wasm,
 * PDF rysowany przez pdf.js) i rysowanie kodu do pokazania przy bramce (bwip-js, SVG). Biblioteki
 * ładują się dopiero przy pierwszym użyciu; pliki .wasm i worker pdf.js są serwowane z aplikacji,
 * nie z CDN (`new URL(…, import.meta.url)` — Turbopack dokłada je jako zasoby).
 */

export type DetectedCode = { payload: string; format: string };

/** Ile stron PDF przeglądać — bilet i voucher mają kod na pierwszej albo drugiej. */
const PDF_PAGES = 3;

async function reader() {
  const zxing = await import("zxing-wasm/reader");
  zxing.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href : prefix + path),
    },
  });
  return zxing;
}

/** Nazwa formatu z czytnika → jedna z naszych (`CODE_FORMATS`); „AztecCode” i „Aztec” to ten sam kod. */
function formatOf(result: { format: string; symbology: string }): string {
  if (CODE_FORMATS.includes(result.format)) return result.format;
  if (CODE_FORMATS.includes(result.symbology)) return result.symbology;
  return result.format;
}

async function readImage(input: Blob | ImageData): Promise<DetectedCode | null> {
  const { readBarcodes } = await reader();
  const results = await readBarcodes(input, { tryHarder: true, tryRotate: true, maxNumberOfSymbols: 4 });
  // Kod 2D przed paskowym — na biletach pasek bywa numerem rezerwacji, a bramka czyta kod 2D.
  const valid = results.filter((each) => each.isValid && each.text !== "");
  const best = valid.find((each) => !isLinearCode(formatOf(each))) ?? valid[0];
  return best ? { payload: best.text, format: formatOf(best) } : null;
}

async function readPdf(file: Blob): Promise<DetectedCode | null> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    for (let number = 1; number <= Math.min(pdf.numPages, PDF_PAGES); number++) {
      const page = await pdf.getPage(number);
      // Skala 3: kod zajmujący kilka centymetrów na stronie A4 ma wtedy dość pikseli na moduł.
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) return null;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const found = await readImage(context.getImageData(0, 0, canvas.width, canvas.height));
      if (found) return found;
    }
    return null;
  } finally {
    await task.destroy();
  }
}

/** Kod z pliku (obraz albo PDF) albo `null`, gdy go nie ma lub nie da się odczytać. */
export async function detectCode(file: File): Promise<DetectedCode | null> {
  if (file.type === "application/pdf") return readPdf(file);
  if (file.type.startsWith("image/")) return readImage(file);
  return null;
}

/** SHA-256 pliku (hex) — telefon po nim pozna, że plik offline jest aktualny. */
export async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Kod jako SVG (czarne moduły na białym) do pokazania na ekranie. */
export async function codeSvg(payload: string, format: string | null): Promise<string> {
  const bwip = await import("bwip-js/browser");
  const linear = isLinearCode(format);
  return bwip.toSVG({
    bcid: codeSymbol(format),
    text: payload,
    scale: 4,
    ...(linear ? { height: 18, includetext: true, textxalign: "center" } : {}),
    paddingwidth: 4,
    paddingheight: 4,
    backgroundcolor: "FFFFFF",
  });
}
