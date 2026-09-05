/**
 * 浮窗几何：拖动、8 向缩放、视口约束、localStorage 持久化
 * @author yanch
 */
import { onBeforeUnmount, reactive, watch } from 'vue';

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function useFloatingWindow(
  storageKey: string,
  initial: WinRect,
  min = { w: 360, h: 320 },
) {
  const rect = reactive<WinRect>(load() ?? { ...initial });
  let dragging: { sx: number; sy: number; ox: number; oy: number } | null = null;
  let resizing: { dir: Dir; sx: number; sy: number; start: WinRect } | null = null;

  function load(): WinRect | null {
    try {
      const r = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return r && Number.isFinite(r.w) ? clamp({ ...r }) : null;
    } catch {
      return null;
    }
  }
  function persist() {
    localStorage.setItem(storageKey, JSON.stringify({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }));
  }
  function clamp(r: WinRect): WinRect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    r.w = Math.max(min.w, Math.min(r.w, vw));
    r.h = Math.max(min.h, Math.min(r.h, vh));
    r.x = Math.max(-r.w + 80, Math.min(r.x, vw - 80));
    r.y = Math.max(0, Math.min(r.y, vh - 40));
    return r;
  }
  function onDragStart(e: MouseEvent) {
    dragging = { sx: e.clientX, sy: e.clientY, ox: rect.x, oy: rect.y };
    bind();
  }
  function onResizeStart(dir: Dir, e: MouseEvent) {
    resizing = { dir, sx: e.clientX, sy: e.clientY, start: { ...rect } };
    bind();
    e.preventDefault();
    e.stopPropagation();
  }
  function onMove(e: MouseEvent) {
    if (dragging) {
      rect.x = dragging.ox + (e.clientX - dragging.sx);
      rect.y = dragging.oy + (e.clientY - dragging.sy);
      clamp(rect);
    } else if (resizing) {
      const dx = e.clientX - resizing.sx;
      const dy = e.clientY - resizing.sy;
      const s = resizing.start;
      const d = resizing.dir;
      if (d.includes('e')) rect.w = Math.max(min.w, s.w + dx);
      if (d.includes('s')) rect.h = Math.max(min.h, s.h + dy);
      if (d.includes('w')) {
        const w = Math.max(min.w, s.w - dx);
        rect.x = s.x + (s.w - w);
        rect.w = w;
      }
      if (d.includes('n')) {
        const h = Math.max(min.h, s.h - dy);
        rect.y = s.y + (s.h - h);
        rect.h = h;
      }
      clamp(rect);
    }
  }
  function onUp() {
    dragging = null;
    resizing = null;
    unbind();
    persist();
  }
  function bind() {
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  }
  function unbind() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.userSelect = '';
  }
  function onWindowResize() {
    clamp(rect);
  }
  window.addEventListener('resize', onWindowResize);
  onBeforeUnmount(() => {
    unbind();
    window.removeEventListener('resize', onWindowResize);
  });
  watch(rect, persist, { deep: true });
  return {
    rect,
    onDragStart,
    onResizeStart,
    reset: () => Object.assign(rect, clamp({ ...initial })),
  };
}
