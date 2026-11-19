export function query<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function queryOptional<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function clear(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay = 150): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.toggleAttribute('aria-busy', busy);
}

export interface ToastOptions {
  tone?: 'info' | 'success' | 'error';
  timeout?: number;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, options: ToastOptions = {}): void {
  let element = document.getElementById('toast');
  if (!element) {
    element = make('div');
    element.id = 'toast';
    element.className = 'toast';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    document.body.append(element);
  }
  element.textContent = message;
  element.dataset.tone = options.tone ?? 'info';
  element.classList.add('is-visible');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element?.classList.remove('is-visible'), options.timeout ?? 3600);
}

export function showDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function openExternal(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noreferrer noopener';
  anchor.target = '_blank';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
