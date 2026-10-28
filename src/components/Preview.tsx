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

export function Preview({ chart, speed, scrollMode, onDemo }: { chart: Chart | null; speed: number; scrollMode: ScrollMode; onDemo: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!;
    const placeholder: Chart = { version: 1, fingerprint: 'preview', difficulty: 'normal', bpm: 128, duration: 16, notes: Array.from({ length: 32 }, (_, i) => ({ id: i, lane: [0, 2, 1, 3, 0, 1, 3, 2][i % 8], time: i * 0.47, type: (['tap', 'tap', 'up', 'tap', 'hold', 'tap', 'right', 'tap'] as const)[i % 8], ...(i % 8 === 4 ? { endTime: i * 0.47 + 0.65 } : {}) })) };
    const engine = new JudgmentEngine(chart || placeholder, true);
    let raf = 0, start = performance.now();
    const first = engine.chart.notes[0]?.time || 0;
    const resize = () => { const r = el.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); el.width = r.width * d; el.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const frame = (now: number) => {
      const cycle = Math.min(12, Math.max(4, engine.chart.duration - first - 1));
      let time = first + (now - start) / 1000;
      if (time > first + cycle) { start = now; time = first; engine.states.forEach(s => { s.head = undefined; s.tail = undefined; s.held = false; }); }
      const rect = el.getBoundingClientRect();
      // Menu is a silent visual preview; it does not call the judgment engine.
      drawGame(ctx, rect.width, rect.height, engine, time, speed, [], true, 0.2, scrollMode);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [chart, speed, scrollMode]);
  return <section className="preview-panel" aria-label="谱面动态预览">
    <div className="preview-top"><div><span className="live-dot" /> LIVE PREVIEW <span className="preview-top-sub">/ 四轨透视</span></div><span className="preview-corner"><Headphones size={13} /> 建议佩戴耳机</span></div>
    <div className="preview-content"><div className="preview-side-label">FEEL THE RHYTHM <ArrowDown size={12} /></div><canvas ref={canvas} aria-label="无声谱面预览" /><div className="preview-watermark">BEAT<br /><span>FALL.</span></div><div className="preview-fade" /></div>
    <div className="preview-bottom"><span><span className="small-dot" /> {chart ? '当前谱面 · 无声预览' : '四轨混合音符'}</span><button onClick={onDemo} disabled={!chart} title="不记录成绩的自动演示"><Maximize2 size={13} /> 自动演示</button></div>
  </section>;
}
