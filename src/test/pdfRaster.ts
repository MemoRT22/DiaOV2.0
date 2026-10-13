import jsQR from 'jsqr';

/*
 * Utilidad de pruebas: rasteriza las páginas de un PDF (pdf.js + canvas nativo de Node) y decodifica los QR con jsQR, que es lo
 * más cerca de «escanear lo impreso» que se puede hacer sin un teléfono. Solo para pruebas: no entra en el paquete de la aplicación.
 */

export type RasterPage = { width: number; height: number; data: Uint8ClampedArray; png: Uint8Array };

export async function rasterizePdf(bytes: Uint8Array, scale = 2, only?: number[]): Promise<RasterPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`, isEvalSupported: false, verbosity: 0 }).promise;
  const pages: RasterPage[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    if (only && !only.includes(n)) continue;
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context as never, viewport }).promise;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    pages.push({ width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(image.data), png: new Uint8Array(canvas.toBuffer('image/png')) });
  }
  await doc.destroy();
  return pages;
}

/** Texto del QR de una página rasterizada, o null si no se puede leer. */
export function decodeQr(page: RasterPage): string | null {
  return jsQR(page.data, page.width, page.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/**
 * Texto del QR de cada página del PDF, rasterizado. jsQR es menos tolerante que un teléfono y, según cómo caiga la rejilla de píxeles,
 * puede fallar con una escala y acertar con otra, así que lo que no se lee a 2× se reintenta a otras escalas antes de darlo por ilegible.
 */
export async function decodeAllQr(bytes: Uint8Array): Promise<(string | null)[]> {
  const first = await rasterizePdf(bytes, 2);
  const result = first.map(decodeQr);
  for (const scale of [3, 4, 5]) {
    const pending = result.map((value, index) => (value === null ? index + 1 : 0)).filter(Boolean);
    if (pending.length === 0) break;
    const retried = await rasterizePdf(bytes, scale, pending);
    retried.forEach((page, k) => { result[pending[k] - 1] = decodeQr(page); });
  }
  return result;
}

/** Texto (sin acentos plegados) de cada página, para comprobar que el nombre completo y los datos están impresos. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`, verbosity: 0 }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  await doc.destroy();
  return texts;
}
