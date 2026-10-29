import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, Headphones, Maximize2, MousePointer2 } from 'lucide-react';
import type { Chart, NoteType, ScrollMode } from '../types';
import { JudgmentEngine } from '../core/judgment';
import { drawGame } from './renderer';

export function NoteIcon({ type, size = 14 }: { type: NoteType; size?: number }) {
  if (type === 'left') return <ArrowLeft size={size} />;
  if (type === 'right') return <ArrowRight size={size} />;
  if (type === 'up') return <ArrowUp size={size} />;
  if (type === 'hold') return <Hand size={size} />;
  return <MousePointer2 size={size} />;
}

export function Preview({ chart, speed, scrollMode, onDemo, active = true }: { chart: Chart | null; speed: number; scrollMode: ScrollMode; onDemo: () => void; active?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active), synchronize = useRef<(() => void) | null>(null);
  activeRef.current = active;
  useEffect(() => { synchronize.current?.(); }, [active]);
  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!;
    const placeholder: Chart = { version: 3, fingerprint: 'preview', difficulty: 'two', bpm: 128, duration: 16, notes: Array.from({ length: 32 }, (_, i) => ({ id: i, lane: [0, 2, 1, 3, 0, 1, 3, 2][i % 8], time: i * 0.47, type: (['tap', 'tap', 'up', 'tap', 'hold', 'tap', 'right', 'tap'] as const)[i % 8], ...(i % 8 === 4 ? { endTime: i * 0.47 + 0.65 } : {}) })) };
    const engine = new JudgmentEngine(chart || placeholder, true);
    let raf = 0, elapsed = 0, anchor = performance.now(), lastDraw = -Infinity;
    let running = false, disposed = false, drawn = false, inView = typeof IntersectionObserver === 'undefined';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const first = engine.chart.notes[0]?.time || 0;
    const draw = (now: number) => {
      if (disposed) return;
      const cycle = Math.min(12, Math.max(4, engine.chart.duration - first - 1));
      const time = first + ((elapsed + (running ? now - anchor : 0)) / 1000) % cycle;
      // Menu is a silent visual preview; it does not call the judgment engine.
      drawGame(ctx, el.clientWidth, el.clientHeight, engine, time, speed, [], true, 0.2, scrollMode);
    };
    const frame = (now: number) => {
      if (disposed || !running) return;
      // A menu preview needs no display-rate rendering (including 120/240 Hz).
      if (now - lastDraw >= 1000 / 30 - 0.1) { draw(now); lastDraw = now; }
      raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      if (disposed) return;
      const next = activeRef.current && inView && !document.hidden && !reducedMotion.matches;
      if (next === running) return;
      const now = performance.now();
      if (next) { running = true; anchor = now; lastDraw = -Infinity; raf = requestAnimationFrame(frame); }
      else { elapsed += now - anchor; running = false; cancelAnimationFrame(raf); }
    };
    const resize = () => {
      if (disposed || !el.clientWidth || !el.clientHeight) return;
      const d = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(el.clientWidth * d), height = Math.round(el.clientHeight * d);
      if (drawn && el.width === width && el.height === height) return;
      el.width = width; el.height = height; ctx.setTransform(d, 0, 0, d, 0, 0); draw(performance.now()); drawn = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => { inView = entries.some(entry => entry.isIntersecting); sync(); });
    intersection?.observe(el);
    synchronize.current = sync;
    document.addEventListener('visibilitychange', sync);
    if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', sync);
    else reducedMotion.addListener(sync);
    sync();
    return () => {
      disposed = true; running = false; cancelAnimationFrame(raf); observer.disconnect(); intersection?.disconnect();
      if (synchronize.current === sync) synchronize.current = null;
      document.removeEventListener('visibilitychange', sync);
      if (typeof reducedMotion.removeEventListener === 'function') reducedMotion.removeEventListener('change', sync);
      else reducedMotion.removeListener(sync);
    };
  }, [chart, speed, scrollMode]);
  return <section className="preview-panel" aria-label="谱面动态预览">
    <div className="preview-top"><div><span className="live-dot" /> LIVE PREVIEW <span className="preview-top-sub">/ 四轨透视</span></div><span className="preview-corner"><Headphones size={13} /> 建议佩戴耳机</span></div>
    <div className="preview-content"><div className="preview-side-label">FEEL THE RHYTHM <ArrowDown size={12} /></div><canvas ref={canvas} aria-label="无声谱面预览" /><div className="preview-watermark">BEAT<br /><span>FALL.</span></div><div className="preview-fade" /></div>
    <div className="preview-bottom"><span><span className="small-dot" /> {chart ? '当前谱面 · 无声预览' : '四轨混合音符'}</span><button onClick={onDemo} disabled={!chart} title="不记录成绩的自动演示"><Maximize2 size={13} /> 自动演示</button></div>
  </section>;
}
