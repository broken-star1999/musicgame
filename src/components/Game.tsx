import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Expand, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { Transport, audioContext } from '../core/audio';
import { JudgmentEngine, swipeDirection } from '../core/judgment';
import type { NoteState } from '../core/judgment';
import type { Chart, Result, Settings, Track } from '../types';
import { DIFFICULTIES } from '../core/chart';
import { drawGame } from './renderer';
import { stageLayout } from '../core/layout';

type Props = { track: Track; chart: Chart; settings: Settings; autoplay: boolean; onExit: () => void; onFinish: (result: Result) => void };
type Finger = { lane: number; x: number; y: number; moved: boolean; hold?: NoteState };
export async function enterFullscreen() {
  if (document.fullscreenElement) { await document.exitFullscreen?.(); return; }
  try { await document.documentElement.requestFullscreen?.(); } catch { /* Fullscreen is optional on mobile browsers. */ }
}

export function Game({ track, chart, settings, autoplay, onExit, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(new JudgmentEngine(chart, autoplay));
  const transportRef = useRef<Transport | null>(null);
  const fingers = useRef(new Map<number, Finger>());
  const pausedRef = useRef(false), countdownRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false), [countdown, setCountdown] = useState<number | null>(null);
  const [rotate, setRotate] = useState(false), [audioError, setAudioError] = useState('');
  const [hud, setHud] = useState({ score: 0, accuracy: 100, combo: 0, progress: 0 });
  const pauseRef = useRef<() => void>(() => {});
  const mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [restarting, setRestarting] = useState(0);

  useEffect(() => {
    mounted.current = true;
    const canvas = canvasRef.current!;
    const engine = new JudgmentEngine(chart, autoplay); engineRef.current = engine;
    const transport = new Transport(track.buffer, settings.volume); transportRef.current = transport;
    pausedRef.current = false; setPaused(false); setCountdown(null); countdownRef.current = null;
    const ctx = canvas.getContext('2d')!;
    let raf = 0, ended = false, lastHud = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const animate = (now: number) => {
      if (ended) return;
      const songTime = transport.time();
      const judgmentTime = songTime - settings.offset / 1000;
      if (!pausedRef.current) engine.update(judgmentTime);
      const { width, height } = canvas.getBoundingClientRect();
      const activeLanes = [...fingers.current.values()].map(f => f.lane);
      const energyIndex = Math.max(0, Math.floor(songTime / track.analysis.energyStep));
      drawGame(ctx, width, height, engine, judgmentTime, settings.speed, activeLanes, pausedRef.current, track.analysis.energy[energyIndex] || 0, settings.scrollMode);
      if (songTime < 0 && !pausedRef.current) {
        ctx.fillStyle = '#ecf3ff'; ctx.textAlign = 'center'; ctx.font = '700 64px "Arial", sans-serif';
        ctx.fillText(String(Math.ceil(-songTime)), width / 2, height * 0.44);
        ctx.fillStyle = '#9da6ba'; ctx.font = '12px sans-serif'; ctx.fillText('跟随音乐，准备落点', width / 2, height * 0.44 + 32);
      }
      if (now - lastHud > 60) {
        const result = engine.result();
        setHud({ score: result.score, accuracy: result.accuracy, combo: engine.combo, progress: Math.max(0, Math.min(1, songTime / chart.duration)) }); lastHud = now;
      }
      if (!pausedRef.current && songTime >= chart.duration + 0.5 + Math.max(0, settings.offset / 1000)) {
        engine.update(chart.duration + 1); ended = true; transport.stop(); onFinish(engine.result()); return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    audioContext().resume().catch(() => { setAudioError('声音未能启动，请点击恢复声音。'); pauseRef.current(); });
    return () => {
      mounted.current = false; ended = true; cancelAnimationFrame(raf); observer.disconnect(); transport.stop();
      clearTimeout(timer.current); fingers.current.clear();
    };
  }, [track, chart, settings, autoplay, onFinish, restarting]);

  function clearFingers() {
    const ids = [...fingers.current.keys()];
    fingers.current.clear();
    for (const id of ids) { try { canvasRef.current?.releasePointerCapture(id); } catch { /* Capture may already be lost. */ } }
  }
  function pauseGame() {
    if (!transportRef.current) return;
    clearTimeout(timer.current); setCountdown(null); countdownRef.current = null;
    if (!pausedRef.current) {
      pausedRef.current = true; setPaused(true);
      transportRef.current.pause().catch(() => setAudioError('音频被系统中断，请点击继续重试。'));
    }
    engineRef.current.suspendHolds(); clearFingers();
  }
  pauseRef.current = pauseGame;

  useEffect(() => {
    const rotation = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setRotate(portrait);
      if (portrait) pauseRef.current();
    };
    const visibility = () => { if (document.hidden) pauseRef.current(); };
    const audioState = () => {
      if (audioContext().state !== 'running' && !pausedRef.current) {
        pauseRef.current(); setAudioError('音频被系统暂停，点击继续恢复。');
      }
    };
    rotation(); window.addEventListener('resize', rotation); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', pauseGame); audioContext().addEventListener('statechange', audioState);
    return () => { window.removeEventListener('resize', rotation); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', pauseGame); audioContext().removeEventListener('statechange', audioState); };
  }, []);

  async function resumeGame() {
    if (countdownRef.current !== null || rotate) return;
    setAudioError('');
    let remaining = 3; countdownRef.current = remaining; setCountdown(remaining);
    const tick = () => {
      if (!mounted.current || document.hidden || window.innerHeight > window.innerWidth) { pauseGame(); return; }
      remaining--;
      if (remaining > 0) { countdownRef.current = remaining; setCountdown(remaining); timer.current = setTimeout(tick, 1000); }
      else {
        transportRef.current?.resume().then(() => {
          if (!mounted.current || document.hidden || window.innerHeight > window.innerWidth || countdownRef.current === null) { transportRef.current?.pause(); return; }
          engineRef.current.resumeHolds(transportRef.current!.time() - settings.offset / 1000);
          pausedRef.current = false; setPaused(false); countdownRef.current = null; setCountdown(null);
        }).catch(() => { setAudioError('声音恢复失败，请再次点击继续。'); countdownRef.current = null; setCountdown(null); });
      }
    };
    timer.current = setTimeout(tick, 1000);
  }

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (autoplay || (pausedRef.current && countdownRef.current === null)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const lane = stageLayout(rect.width, rect.height).laneAt(x, y);
    if (lane === null) return;
    if ([...fingers.current.values()].some(f => f.lane === lane)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const engine = engineRef.current, time = transportRef.current!.time() - settings.offset / 1000;
    const hold = pausedRef.current ? engine.regrab(lane) : engine.input(lane, time, 'press');
    fingers.current.set(event.pointerId, { lane, x: event.clientX, y: event.clientY, moved: false, hold: hold?.note.type === 'hold' ? hold : undefined });
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const finger = fingers.current.get(event.pointerId);
    if (!finger || finger.moved || finger.hold || pausedRef.current) return;
    const direction = swipeDirection(event.clientX - finger.x, event.clientY - finger.y);
    if (direction && direction !== 'tap' && direction !== 'hold') {
      finger.moved = true;
      engineRef.current.input(finger.lane, transportRef.current!.time() - settings.offset / 1000, direction);
    }
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const finger = fingers.current.get(event.pointerId);
    if (finger && !pausedRef.current) engineRef.current.release(finger.hold, transportRef.current!.time() - settings.offset / 1000);
    if (finger && pausedRef.current && finger.hold) finger.hold.held = false;
    fingers.current.delete(event.pointerId);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Already released by browser. */ }
  };

  return <div className="game-screen">
    <div className="game-progress" style={{ width: `${hud.progress * 100}%` }} />
    <header className="game-hud">
      <button className="icon-button" aria-label="暂停游戏" onClick={pauseGame}><Pause size={19} /></button>
      <div className="game-song"><strong>{track.name}</strong><span>{DIFFICULTIES[chart.difficulty].english} <i>·</i> {chart.bpm} BPM {autoplay && ' · AUTO'}</span></div>
      <div className="hud-stat"><span>ACCURACY</span><strong>{hud.accuracy.toFixed(2)}<small>%</small></strong></div>
      <div className="hud-stat score"><span>SCORE</span><strong>{String(hud.score).padStart(7, '0')}</strong></div>
      <button className="icon-button fullscreen" aria-label="切换全屏" onClick={enterFullscreen}><Expand size={18} /></button>
    </header>
    <div className="combo-counter"><strong>{hud.combo > 1 ? hud.combo : ''}</strong>{hud.combo > 1 && <span>COMBO</span>}</div>
    <canvas ref={canvasRef} className="game-canvas" aria-label="四轨音游，点击或长按对应轨道底部，箭头音符按方向滑动" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => pauseGame()} onLostPointerCapture={e => { if (fingers.current.has(e.pointerId)) pauseGame(); }} />
    <div className="game-footer"><span><Volume2 size={12} /> {autoplay ? '自动演示 · 不记录成绩' : '点击 / 长按 / 按箭头滑动'}</span><span>BEATFALL <i>LIVE SESSION</i></span></div>
    {paused && <div className={`game-overlay ${countdown !== null ? 'resuming' : ''}`}>
      <div className="pause-card">
        <span className="eyebrow">{rotate ? 'LANDSCAPE MODE' : countdown !== null ? 'GET READY' : 'TAKE A BREATH'}</span>
        <h2>{rotate ? '横过来，节奏更尽兴' : countdown !== null ? countdown : '节拍暂停'}</h2>
        <p>{rotate ? '请将手机旋转至横屏，四条轨道已就位。' : countdown !== null ? '如有未结束的长按，现在按住原轨道继续。' : '准备好了，就回到音乐里。'}</p>
        {audioError && <p role="alert" className="error-text">{audioError}</p>}
        {countdown === null && <div className="pause-actions">
          {!rotate && <button className="primary-button" onClick={resumeGame}><Play size={17} /> 继续演奏</button>}
          {!rotate && <button className="secondary-button" onClick={() => { clearTimeout(timer.current); clearFingers(); setRestarting(n => n + 1); }}><RotateCcw size={16} /> 重新开始</button>}
          <button className="text-button" onClick={onExit}><ArrowLeft size={15} /> 返回演奏台</button>
        </div>}
      </div>
    </div>}
  </div>;
}
