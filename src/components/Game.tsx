import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Transport, audioContext } from '../core/audio';
import { JudgmentEngine, swipeDirection } from '../core/judgment';
import type { NoteState } from '../core/judgment';
import type { Chart, Result, Settings, Track } from '../types';
import { DIFFICULTIES } from '../core/chart';
import { drawGame } from './renderer';
import { stageLayout } from '../core/layout';
import { canvasPoint, readGameViewport } from '../core/viewport';
import { HitFeedback } from '../core/haptics';
import './game-layout.css';

type Props = { track: Track; chart: Chart; settings: Settings; autoplay: boolean; onExit: () => void; onFinish: (result: Result) => void };
type Finger = { lane: number; x: number; y: number; moved: boolean; hold?: NoteState };
export function Game({ track, chart, settings, autoplay, onExit, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(new JudgmentEngine(chart, autoplay));
  const transportRef = useRef<Transport | null>(null);
  const fingers = useRef(new Map<number, Finger>());
  const pausedRef = useRef(false), countdownRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false), [countdown, setCountdown] = useState<number | null>(null);
  const [viewport, setViewport] = useState(readGameViewport);
  const viewportRef = useRef(viewport);
  const [audioError, setAudioError] = useState('');
  const [hud, setHud] = useState({ score: 0, accuracy: 100, combo: 0, progress: 0 });
  const pauseRef = useRef<() => void>(() => {});
  const mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [restarting, setRestarting] = useState(0);
  const feedbackRef = useRef<HitFeedback | null>(null);

  useEffect(() => {
    mounted.current = true;
    const canvas = canvasRef.current!;
    const feedback = new HitFeedback(settings.vibration && !autoplay); feedbackRef.current = feedback;
    const engine = new JudgmentEngine(chart, autoplay, hit => feedback.hit(hit)); engineRef.current = engine;
    const transport = new Transport(track.buffer, settings.volume); transportRef.current = transport;
    pausedRef.current = false; setPaused(false); setCountdown(null); countdownRef.current = null;
    const ctx = canvas.getContext('2d')!;
    let raf = 0, ended = false, lastHud = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const animate = (now: number) => {
      if (ended) return;
      const songTime = transport.time();
      const judgmentTime = songTime - settings.offset / 1000;
      if (!pausedRef.current) engine.update(judgmentTime);
      const width = canvas.clientWidth, height = canvas.clientHeight;
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
      feedback.stop();
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
    feedbackRef.current?.stop();
  }
  pauseRef.current = pauseGame;

  useEffect(() => {
    const resizeViewport = () => {
      const next = readGameViewport();
      if (next.rotated !== viewportRef.current.rotated) pauseRef.current();
      viewportRef.current = next;
      setViewport(next);
    };
    const visibility = () => { if (document.hidden) pauseRef.current(); };
    const audioState = () => {
      if (audioContext().state !== 'running' && !pausedRef.current) {
        pauseRef.current(); setAudioError('音频被系统暂停，点击继续恢复。');
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    resizeViewport(); window.addEventListener('resize', resizeViewport);
    window.visualViewport?.addEventListener('resize', resizeViewport);
    window.visualViewport?.addEventListener('scroll', resizeViewport);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', pauseGame); audioContext().addEventListener('statechange', audioState);
    return () => {
      window.removeEventListener('resize', resizeViewport);
      window.visualViewport?.removeEventListener('resize', resizeViewport);
      window.visualViewport?.removeEventListener('scroll', resizeViewport);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', pauseGame);
      audioContext().removeEventListener('statechange', audioState);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function resumeGame() {
    if (countdownRef.current !== null) return;
    setAudioError('');
    let remaining = 3; countdownRef.current = remaining; setCountdown(remaining);
    const tick = () => {
      if (!mounted.current || document.hidden) { pauseGame(); return; }
      remaining--;
      if (remaining > 0) { countdownRef.current = remaining; setCountdown(remaining); timer.current = setTimeout(tick, 1000); }
      else {
        transportRef.current?.resume().then(() => {
          if (!mounted.current || document.hidden || countdownRef.current === null) { transportRef.current?.pause(); return; }
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
    const canvas = event.currentTarget;
    const point = canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.clientWidth, canvas.clientHeight, viewportRef.current.rotated);
    const lane = stageLayout(canvas.clientWidth, canvas.clientHeight).laneAt(point.x, point.y);
    if (lane === null) return;
    if ([...fingers.current.values()].some(f => f.lane === lane)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const engine = engineRef.current, time = transportRef.current!.time() - settings.offset / 1000;
    const hold = pausedRef.current ? engine.regrab(lane) : engine.input(lane, time, 'press');
    fingers.current.set(event.pointerId, { lane, x: point.x, y: point.y, moved: false, hold: hold?.note.type === 'hold' ? hold : undefined });
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const finger = fingers.current.get(event.pointerId);
    if (!finger || finger.moved || finger.hold || pausedRef.current) return;
    const canvas = event.currentTarget;
    const point = canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.clientWidth, canvas.clientHeight, viewportRef.current.rotated);
    const direction = swipeDirection(point.x - finger.x, point.y - finger.y);
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

  const gameStyle = {
    width: viewport.width,
    height: viewport.height,
    top: 0,
    left: 0,
    right: 'auto', bottom: 'auto',
    '--game-safe-left': `env(safe-area-inset-${viewport.rotated ? 'top' : 'left'})`,
    '--game-safe-right': `env(safe-area-inset-${viewport.rotated ? 'bottom' : 'right'})`,
    '--game-safe-top': `env(safe-area-inset-${viewport.rotated ? 'right' : 'top'})`,
    '--game-safe-bottom': `env(safe-area-inset-${viewport.rotated ? 'left' : 'bottom'})`,
  } as CSSProperties;

  return <div className="game-screen" data-layout={viewport.rotated ? 'rotated' : 'landscape'} data-compact={viewport.height <= 550} style={gameStyle}>
    <div className="game-progress" style={{ width: `${hud.progress * 100}%` }} />
    <header className="game-hud">
      <button className="icon-button" aria-label="暂停游戏" onClick={pauseGame}><Pause size={19} /></button>
      <div className="game-song"><strong>{track.name}</strong><span>{DIFFICULTIES[chart.difficulty].english} <i>·</i> {chart.bpm} BPM {autoplay && ' · AUTO'}</span></div>
      <div className="hud-stat"><span>ACCURACY</span><strong>{hud.accuracy.toFixed(2)}<small>%</small></strong></div>
      <div className="hud-stat score"><span>SCORE</span><strong>{String(hud.score).padStart(7, '0')}</strong></div>
    </header>
    <div className="combo-counter"><strong>{hud.combo > 1 ? hud.combo : ''}</strong>{hud.combo > 1 && <span>COMBO</span>}</div>
    <canvas ref={canvasRef} className="game-canvas" aria-label="四轨音游，可在对应轨道整列点击或长按；音符到达双线框下沿时判定，箭头音符按方向滑动" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => pauseGame()} onLostPointerCapture={e => { if (fingers.current.has(e.pointerId)) pauseGame(); }} />
    <div className="game-footer"><span><Volume2 size={12} /> {viewport.rotated && '已自动横向 · '}{autoplay ? '自动演示 · 不记录成绩' : '整轨可触 · 双线下沿踩点'}</span><span>BEATFALL <i>LIVE SESSION</i></span></div>
    {paused && <div className={`game-overlay ${countdown !== null ? 'resuming' : ''}`}>
      <div className="pause-card">
        <span className="eyebrow">{countdown !== null ? 'GET READY' : 'TAKE A BREATH'}</span>
        <h2>{countdown !== null ? countdown : '节拍暂停'}</h2>
        <p>{countdown !== null ? '如有未结束的长按，现在按住原轨道继续。' : '准备好了，就回到音乐里。'}</p>
        {audioError && <p role="alert" className="error-text">{audioError}</p>}
        {countdown === null && <div className="pause-actions">
          <button className="primary-button" onClick={resumeGame}><Play size={17} /> 继续演奏</button>
          <button className="secondary-button" onClick={() => { clearTimeout(timer.current); clearFingers(); setRestarting(n => n + 1); }}><RotateCcw size={16} /> 重新开始</button>
          <button className="text-button" onClick={onExit}><ArrowLeft size={15} /> 返回演奏台</button>
        </div>}
      </div>
    </div>}
  </div>;
}
