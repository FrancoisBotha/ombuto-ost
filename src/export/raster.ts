/*
 * SVG -> PNG through a canvas. The only part of the export that needs a browser.
 */

/** Pixels per CSS pixel of an exported PNG. */
export const PNG_SCALE = 2;
/** Below this the text of a node is no longer readable: better to say so than to save a blur. */
export const MIN_PNG_SCALE = 0.5;
/**
 * Canvas limits kept well inside what current desktop browsers accept (a canvas beyond a browser's
 * limit silently draws nothing).
 */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 32_000_000;

const TOO_LARGE = 'This tree is too large to export as a PNG image. Export it as SVG instead, or choose a single project.';
const NOT_DRAWN = 'The PNG image could not be drawn. Try the SVG export instead.';

/**
 * The scale to rasterise a `width` x `height` image at: `preferred` when the canvas stays within
 * the limits, otherwise the largest scale that fits. Throws when even that would be unreadable.
 */
export function rasterScale(width: number, height: number, preferred = PNG_SCALE): number {
  if (!(width > 0) || !(height > 0)) throw new Error('There is nothing to export.');
  const scale = Math.min(preferred, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height, Math.sqrt(MAX_CANVAS_AREA / (width * height)));
  if (scale < MIN_PNG_SCALE) throw new Error(TOO_LARGE);
  return scale;
}

/** The SVG as an image source the page's Content Security Policy allows (`img-src data:`). */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(NOT_DRAWN));
    image.src = src;
  });
}

/** Draws a standalone SVG of `width` x `height` CSS px onto a canvas and returns it as a PNG. */
export async function svgToPng(svg: string, width: number, height: number, background: string): Promise<Blob> {
  const scale = rasterScale(width, height);
  const image = await loadImage(svgDataUrl(svg));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(NOT_DRAWN);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(NOT_DRAWN);
  return blob;
}
