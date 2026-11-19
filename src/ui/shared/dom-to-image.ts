/**
 * A small DOM-to-image implementation: clone the rendered panel, inline the
 * extension's stylesheets, serialise it into an SVG foreignObject and rasterise
 * that through a canvas. No remote scripts, images or analytics are involved.
 */

export interface ElementToPngOptions {
  scale?: number;
  background?: string;
  maxDimension?: number;
  viewportOnly?: boolean;
}

function collectStyles(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      chunks.push(rule.cssText);
    }
  }
  return chunks.join('\n');
}

function collectVariables(element: HTMLElement): [string, string][] {
  const rootStyle = getComputedStyle(document.documentElement);
  const elementStyle = getComputedStyle(element);
  const values = new Map<string, string>();
  for (const style of [rootStyle, elementStyle]) {
    for (const property of Array.from(style)) {
      if (property.startsWith('--')) {
        values.set(property, style.getPropertyValue(property).trim());
      }
    }
  }
  return [...values.entries()];
}

function copyScrollPositions(original: HTMLElement, clone: HTMLElement): void {
  const originals = [original, ...Array.from(original.querySelectorAll<HTMLElement>('*'))];
  const clones = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  const count = Math.min(originals.length, clones.length, 4000);
  for (let index = 0; index < count; index += 1) {
    const source = originals[index];
    const target = clones[index];
    if (!source || !target) continue;
    if (source.scrollTop > 0) target.scrollTop = source.scrollTop;
    if (source.scrollLeft > 0) target.scrollLeft = source.scrollLeft;
  }
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'sync';
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The panel could not be converted to an image.'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the screenshot.'));
    }, 'image/png');
  });
}

export async function elementToPng(element: HTMLElement, options: ElementToPngOptions = {}): Promise<Blob> {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width || element.scrollWidth));
  const renderedHeight = options.viewportOnly ? Math.min(rect.height, window.innerHeight) : rect.height;
  const height = Math.max(1, Math.ceil(renderedHeight || element.scrollHeight));
  const maxDimension = options.maxDimension ?? 4096;
  const requestedScale = options.scale ?? 2;
  const scale = Math.max(0.1, Math.min(requestedScale, maxDimension / width, maxDimension / height));
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  const background =
    options.background ??
    (bodyBackground && bodyBackground !== 'rgba(0, 0, 0, 0)'
      ? bodyBackground
      : getComputedStyle(element).backgroundColor);

  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-capture-hide]').forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll('dialog').forEach((node) => {
    node.remove();
  });
  copyScrollPositions(element, clone);

  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'hidden';
  clone.style.margin = '0';
  clone.style.transform = 'none';

  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = 'hidden';
  wrapper.style.background = background === 'rgba(0, 0, 0, 0)' ? '#0b1020' : background;
  const bodyStyle = getComputedStyle(document.body);
  wrapper.style.fontFamily = bodyStyle.fontFamily;
  wrapper.style.fontSize = bodyStyle.fontSize;
  wrapper.style.lineHeight = bodyStyle.lineHeight;
  wrapper.style.color = bodyStyle.color;
  wrapper.style.letterSpacing = bodyStyle.letterSpacing;

  for (const [name, value] of collectVariables(element)) {
    if (value) wrapper.style.setProperty(name, value);
  }

  const style = document.createElement('style');
  style.textContent = `${collectStyles()}\n* { animation: none !important; transition: none !important; }`;
  wrapper.append(style, clone);

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const image = await loadSvgImage(svg);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  context.fillStyle = background === 'rgba(0, 0, 0, 0)' ? '#0b1020' : background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas);
}
