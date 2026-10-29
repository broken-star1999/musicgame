import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, ChevronRight, CircleHelp, Disc3, Headphones, LoaderCircle, Music2, Play, Plus, Radio, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trophy, Upload, Volume2, X, Zap } from 'lucide-react';
import type { Analysis, Chart, Difficulty, Result, Settings, Track, WorkerResponse } from './types';
import { audioContext, createDemo, decodeFile, SAMPLE_RATE, toMono } from './core/audio';
import { countTypes, DIFFICULTIES } from './core/chart';
import { compileChart } from './core/chart-service';
import { peakFingers } from './core/chart-constraints';
import { bestScore, loadSettings, saveBest, saveSettings } from './core/storage';
import { Game } from './components/Game';
import { NoteIcon, Preview } from './components/Preview';
import './styles.css';

const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formatScore = (score: number) => score.toLocaleString('en-US');

function analyze(samples: Float32Array, onProgress: (n: number, text: string) => void, setCancel: (fn: () => void) => void): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./core/analysis.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (action: () => void) => { if (finished) return; finished = true; worker.terminate(); action(); };
    setCancel(() => finish(() => reject(new DOMException('Analysis cancelled', 'AbortError'))));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') onProgress(message.value, message.stage);
      else if (message.type === 'done') finish(() => resolve(message.analysis));
      else finish(() => reject(new Error(message.message)));
    };
    worker.onerror = () => finish(() => reject(new Error('分析线程启动失败，请刷新页面后重试。')));
    worker.postMessage({ samples, sampleRate: SAMPLE_RATE }, [samples.buffer]);
  });
}

function Brand() { return <a className="brand" href="./" aria-label="节拍坠落首页"><span className="brand-mark"><i /><i /><i /><i /></span><span>BEATFALL<span className="brand-cn">节拍坠落</span></span></a>; }

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [track, setTrack] = useState<Track | null>(null), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0), [stage, setStage] = useState(''), [error, setError] = useState('');
  const [bpm, setBpm] = useState(''), [bpmOverride, setBpmOverride] = useState<number | undefined>();
  const [game, setGame] = useState<{ autoplay: boolean; id: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null), [help, setHelp] = useState(false), [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false), [best, setBest] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null), serial = useRef(0), abort = useRef<(() => void) | null>(null);
  const [chart, setChart] = useState<Chart | null>(null), [compiling, setCompiling] = useState(false), [chartRevision, setChartRevision] = useState(0);
  const [compileProgress, setCompileProgress] = useState({ value: 0, stage: '' });
  const cancelCompilation = useRef<() => void>(() => {});
  const counts = useMemo(() => chart ? countTypes(chart) : null, [chart]);
  const fingerPeak = useMemo(() => chart ? peakFingers(chart.notes) : 0, [chart]);
  const scoreKey = chart ? `v${chart.version}:${chart.fingerprint}:${chart.difficulty}:${chart.bpm}` : '';
  const chartReady = !!chart && !!track && chart.difficulty === settings.difficulty && chart.fingerprint === track.analysis.fingerprint && chart.bpm === (bpmOverride || track.analysis.bpm) && !busy && !compiling;
  const tempoRange = useMemo(() => {
    const rhythm = track?.analysis.rhythm;
    const values = rhythm && rhythm.confidence >= 0.45 ? rhythm.tempo.map(point => point.bpm).sort((a, b) => a - b) : [];
    return values.length ? [Math.round(values[Math.floor(values.length * 0.1)]), Math.round(values[Math.floor(values.length * 0.9)])] : null;
  }, [track]);

  useEffect(() => {
    setChart(null); setCompiling(!!track);
    if (!track) { cancelCompilation.current = () => {}; return; }
    let active = true;
    setCompileProgress({ value: 0, stage: '正在准备乐句与指法规划' });
    let job: ReturnType<typeof compileChart>;
    try { job = compileChart(track.analysis, settings.difficulty, bpmOverride, (value, stage) => { if (active) setCompileProgress({ value, stage }); }); }
    catch { setCompiling(false); setError('编谱线程启动失败，请重新生成或刷新页面。'); return; }
    cancelCompilation.current = () => { active = false; job.cancel(); setCompiling(false); setError('编谱已取消，可更换指法或重新生成。'); };
    job.promise.then(value => { if (active) { setChart(value); setError(''); } }).catch(error => {
      if (active && !(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : '编谱失败，请重试。');
    }).finally(() => { if (active) setCompiling(false); });
    return () => { active = false; job.cancel(); cancelCompilation.current = () => {}; };
  }, [track, settings.difficulty, bpmOverride, chartRevision]);

  const cancel = useCallback(() => { serial.current++; abort.current?.(); abort.current = null; setBusy(false); setStage(''); }, []);
  const load = useCallback(async (file?: File) => {
    const id = ++serial.current; abort.current?.(); abort.current = null;
    setTrack(null); setBpm(''); setBpmOverride(undefined); setError(''); setBusy(true); setProgress(0); setStage(file ? '正在解码你的音乐' : '正在合成演示曲'); setResult(null);
    try {
      const buffer = file ? await decodeFile(file) : createDemo();
      if (id !== serial.current) return;
      setStage('正在准备音频分析');
      const samples = toMono(buffer);
      const analysis = await analyze(samples, (n, text) => { if (id === serial.current) { setProgress(n); setStage(text); } }, fn => { abort.current = fn; });
      if (id !== serial.current) return;
      setTrack({ name: file ? file.name.replace(/\.[^.]+$/, '') : 'Neon Afterglow', artist: file ? '本地导入 · 仅在此设备处理' : 'BEATFALL ORIGINAL · 内置演示曲', buffer, analysis, demo: !file });
      setBpm(String(analysis.bpm));
    } catch (err) {
      if (id === serial.current && !(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : '音频处理失败，请重试。');
    } finally { if (id === serial.current) { setBusy(false); abort.current = null; } }
  }, []);

  useEffect(() => { void load(); return () => { serial.current++; abort.current?.(); }; }, [load]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => { setBest(bestScore(scoreKey)); }, [scoreKey]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(previous => ({ ...previous, [key]: value }));
  const finish = useCallback((value: Result) => { saveBest(scoreKey, value); setBest(bestScore(scoreKey)); setGame(null); setResult(value); }, [scoreKey]);
  const start = async (autoplay = false) => {
    if (!track || !chart || !chart.notes.length || !chartReady) return;

    try { await audioContext().resume(); setResult(null); setError(''); setGame({ autoplay, id: Date.now() }); }
    catch { setError('声音尚未启用，请再次点击开始按钮。'); }
  };
  const regenerate = () => {
    const value = Number(bpm);
    if (!Number.isFinite(value) || value < 40 || value > 240) { setError('BPM 请填写 40～240 之间的数值。'); return; }
    setBpmOverride(value); setChartRevision(revision => revision + 1); setError('');
  };
  if (game && track && chart) return <Game key={game.id} track={track} chart={chart} settings={settings} autoplay={game.autoplay} onExit={() => setGame(null)} onFinish={finish} />;

  return <div className="app-shell">
    <header className="site-header"><Brand /><nav aria-label="主导航"><button className="nav-active" onClick={() => setHelp(false)}>演奏台<span /></button><button onClick={() => setHelp(true)}>操作指南 <ChevronRight size={12} /></button></nav><div className="header-status"><span className="small-dot" /> 本地运行<span className="header-status-divider">/</span><ShieldCheck size={13} /> 音频不上传</div></header>
    <main className="main-content">
      <motion.section className="intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><div><div className="eyebrow"><span className="line" /> YOUR MUSIC. YOUR RHYTHM.</div><h1>让每首歌，<span>成为你的关卡。</span><span className="title-dot">*</span></h1><p>导入音乐，生成节拍。四条轨道，无限种心跳。</p></div><div className="intro-badge"><AudioLines size={22} /><div><strong>由声音，生成挑战</strong><span>浏览器内分析 · 即刻开玩</span></div></div></motion.section>
      <div className="workspace">
        <aside className="control-panel">
          <div className="section-label"><span><span className="step-number">01</span> 选择你的音乐</span><Music2 size={15} /></div>
          <input ref={fileInput} id="audio-file" className="sr-only" type="file" accept=".mp3,.wav,.m4a,.ogg,.flac,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/flac" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ''; }} />
          <button className={`upload-zone ${dragging ? 'is-dragging' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) void load(file); }}><span className="upload-icon"><Upload size={19} /></span><strong>点击上传，或拖入音频</strong><span>MP3 / WAV / M4A / OGG / FLAC</span><small>最大 50 MB · 5 分钟以内</small><Plus className="upload-plus" size={12} /></button>
          {busy ? <div className="analysis-progress" role="status" aria-live="polite"><div><LoaderCircle className="spin" size={15} /><span>{stage}</span><button onClick={cancel} aria-label="取消分析"><X size={14} /></button></div><div className="progress-track"><i style={{ width: `${Math.max(4, progress * 100)}%` }} /></div><small>{Math.round(progress * 100)}% · 音频仅在本地处理</small></div> : track ? <div className="selected-track"><div className="album-art"><AudioLines size={25} /><i /><i /></div><div className="track-meta"><strong title={track.name}>{track.name}</strong><span>{track.demo ? '内置演示曲' : '本地音乐'} <i>·</i> {timeLabel(track.analysis.duration)}</span></div><span className="track-ready"><Check size={13} /></span></div> : <button className="demo-load" onClick={() => void load()}><Disc3 size={18} /><span>没有音乐？试试内置演示曲</span><ChevronRight size={14} /></button>}
          {compiling && <div className="analysis-progress" role="status" aria-live="polite"><div><LoaderCircle className="spin" size={15} /><span>{compileProgress.stage}</span><button aria-label="取消编谱" onClick={() => cancelCompilation.current()}><X size={14} /></button></div><div className="progress-track"><i style={{ width: `${Math.max(4, compileProgress.value * 100)}%` }} /></div><small>正在生成{DIFFICULTIES[settings.difficulty].label}谱面 · 切换指法可重新生成</small></div>}{track && !track.demo && !busy && <button className="text-button demo-switch" onClick={() => void load()}><Disc3 size={13} /> 换成内置演示曲</button>}
          <div className="panel-divider" />
          <div className="section-label"><span><span className="step-number">02</span> 调整你的挑战</span><SlidersHorizontal size={15} /></div>
          <label className="field-label">谱面难度<span>DIFFICULTY</span></label>
          <div className="difficulty-selector" role="group" aria-label="谱面难度">{(Object.keys(DIFFICULTIES) as Difficulty[]).map(level => <button key={level} aria-pressed={settings.difficulty === level} className={settings.difficulty === level ? 'selected' : ''} onClick={() => { if (level === settings.difficulty) setChartRevision(revision => revision + 1); else update('difficulty', level); }}><span className="difficulty-bars" aria-hidden="true">{[1, 2, 3, 4].map(finger => <i key={finger} className={finger <= DIFFICULTIES[level].max ? 'lit' : ''} />)}</span>{DIFFICULTIES[level].label}</button>)}</div>
          <p className="difficulty-description">{DIFFICULTIES[settings.difficulty].description}</p>
          <label className="field-label scroll-label">下落方式<span>SCROLL STYLE</span></label><div className="scroll-selector" role="group" aria-label="下落方式"><button aria-pressed={settings.scrollMode === 'perspective'} className={settings.scrollMode === 'perspective' ? 'selected' : ''} onClick={() => update('scrollMode', 'perspective')}>透视推进</button><button aria-pressed={settings.scrollMode === 'screen'} className={settings.scrollMode === 'screen' ? 'selected' : ''} onClick={() => update('scrollMode', 'screen')}>屏幕匀速</button></div><p className="scroll-description">{settings.scrollMode === 'perspective' ? '随轨道变宽平滑加速，让靠近时的推进感保持连贯。' : '相同时间移动相同像素，适合偏好平直下落的手感。'}</p><div className="range-heading"><label htmlFor="speed">下落速度</label><span><b>{settings.speed.toFixed(1)}</b> ×</span></div><input id="speed" aria-label="下落速度" type="range" min="2" max="10" step="0.5" value={settings.speed} onChange={e => update('speed', +e.target.value)} style={{ '--range-fill': `${(settings.speed - 2) / 8 * 100}%` } as React.CSSProperties} /><div className="range-ends"><span>舒缓</span><span>疾速</span></div>
          <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><Settings2 size={14} /> 音量、震动与校准 <span>{advanced ? '−' : '+'}</span></button>
          {advanced && <div className="advanced-settings"><div className="feedback-setting"><div><strong>击打震动</strong><small>{typeof navigator.vibrate === 'function' ? '击中音符时短震，依设备与浏览器支持。' : '此浏览器未提供震动功能，仍有击打光效。'}</small></div><button type="button" role="switch" aria-label="击打震动" aria-checked={settings.vibration} className={settings.vibration ? 'feedback-switch enabled' : 'feedback-switch'} onClick={() => update('vibration', !settings.vibration)}><i /></button></div><div className="range-heading"><label htmlFor="volume"><Volume2 size={13} /> 音乐音量</label><span>{Math.round(settings.volume * 100)}%</span></div><input id="volume" type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={e => update('volume', +e.target.value)} /><div className="range-heading"><label htmlFor="offset">判定偏移</label><span>{settings.offset > 0 ? '+' : ''}{settings.offset} ms</span></div><input id="offset" type="range" min="-300" max="300" step="5" value={settings.offset} onChange={e => update('offset', +e.target.value)} /><p>正值让判定时刻更晚，负值更早。蓝牙耳机可在这里微调。</p><label htmlFor="bpm" className="field-label">节拍修正 <span>BPM</span></label><div className="bpm-input"><input id="bpm" type="number" min="40" max="240" step="1" value={bpm} onChange={e => setBpm(e.target.value)} disabled={!track} /><button onClick={regenerate} disabled={!track}><RotateCcw size={12} /> 重新生成</button></div><p>仅将接近节拍的音符对齐，保留原曲声音起点。</p></div>}
          <button className="primary-button start-button" disabled={!chartReady || !chart?.notes.length} onClick={() => void start()}><Play size={17} fill="currentColor" /><span>开始演奏</span><kbd>PLAY</kbd></button><div className="start-caption"><Headphones size={11} /> 默认横向显示 · {DIFFICULTIES[settings.difficulty].label}谱面</div>
        </aside>
        <div className="stage-column"><Preview chart={chartReady ? chart : null} speed={settings.speed} scrollMode={settings.scrollMode} onDemo={() => void start(true)} />
          <div className="chart-info"><div className="chart-info-title"><span><Sparkles size={14} /> {busy ? '正在聆听你的音乐…' : compiling ? '正在编排乐句与指法…' : chart ? '你的谱面已就绪' : '等待一首好音乐'}</span><span className="chart-status">{chart && <><span className="small-dot" /> READY TO PLAY</>}</span></div><div className="chart-metrics"><div><span>节拍速度</span><strong>{chart?.bpm || '—'}<small>BPM</small></strong></div><div><span>音符总数</span><strong>{chart?.notes.length ?? '—'}<small>NOTES</small></strong></div><div><span>歌曲时长</span><strong>{track ? timeLabel(track.analysis.duration) : '—'}<small>MIN</small></strong></div><div><span>本地最佳</span><strong className="best-score">{best ? formatScore(best) : '等待挑战'}{!!best && <Trophy size={12} />}</strong></div></div>{counts && <div className="note-distribution"><span>音符分布</span>{(['tap', 'hold', 'left', 'right', 'up'] as const).map(type => <span key={type} title={{ tap: '单点', hold: '长按', left: '左滑', right: '右滑', up: '上滑' }[type]}><NoteIcon type={type} size={12} /><b>{counts[type]}</b></span>)}</div>}{chart && <><p className="finger-summary" aria-live="polite">{DIFFICULTIES[chart.difficulty].label}谱面 · 同时最多 {chart.fingerLimit} 指 · 本谱峰值 {fingerPeak} 指{chart.fingering?.checked && ' · 动作路线已检查'}</p>{track?.analysis.rhythm && <p className="rhythm-summary">{bpmOverride !== undefined ? '原始分析：' : '检测到 '}{track.analysis.rhythm.beats.length} 个候选拍点{tempoRange && ` · 局部速度约 ${tempoRange[0]}–${tempoRange[1]} BPM`}{bpmOverride !== undefined ? ` · 编谱参考 ${bpmOverride} BPM` : track.analysis.rhythm.confidence < 0.45 && ' · 拍点把握较低，优先跟随清晰起音'}</p>}</>}{!!chart?.repetition?.reused && <p className="phrase-status"><Sparkles size={12} /> 已复用 {chart.repetition.reused} 段相似乐句的按键模板</p>}{track && (track.analysis.confidence < 0.45 || (track.analysis.rhythm?.confidence ?? 1) < 0.45) && <p className="confidence-tip"><Radio size={12} /> 节拍识别把握较低，复杂伴奏仍可能误识别。BPM 修正仅调整参考网格。</p>}</div>
        </div>
      </div>
      {error && <div className="error-banner" role="alert"><CircleHelp size={17} /><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button></div>}
      <section className="how-to-bar"><div className="how-to-title"><span className="step-number">03</span><div><strong>跟着节拍，轻触落点。</strong><span>双线框下沿踩点，整条轨道均可操作</span></div></div><div className="gesture-item"><span className="gesture-key tap-key"><i /></span><div><strong>单点</strong><span>轨道任意高度轻触</span></div></div><div className="gesture-item"><span className="gesture-key hold-key"><i /></span><div><strong>长按</strong><span>按住直到尾部落下</span></div></div><div className="gesture-item"><span className="gesture-key swipe-key"><ArrowLeft size={13} /><ArrowUp size={13} /><ArrowRight size={13} /></span><div><strong>方向滑动</strong><span>在原轨道按箭头短划</span></div></div><button aria-label="查看完整操作指南" onClick={() => setHelp(true)}><CircleHelp size={18} /></button></section>
    </main>
    <footer className="site-footer"><span>BUILT FOR THE LOVE OF RHYTHM.</span><span><ShieldCheck size={12} /> 音乐留在设备上，节奏留在指尖。</span><span>BEATFALL <i>VOL. 01</i></span></footer>
    {help && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setHelp(false); }}><motion.section initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="modal-close icon-button" onClick={() => setHelp(false)} aria-label="关闭操作指南"><X size={20} /></button><span className="eyebrow">A LITTLE RHYTHM GUIDE</span><h2 id="help-title">四条轨道，五种节奏。</h2><p>网页默认使用横向布局，手机锁定竖屏时整页自动侧转。四条轨道从上到下均可操作，音符到达双线框下沿时完成对应动作。难度按单指、二指、三指、四指区分；编谱会检查长按占用、手指移动时间及交叉。页面中的动作路线检查基于参考触控位置模型，实际舒适度仍因设备尺寸和个人手法而不同；单指谱长按期间不会插入其他操作。</p><div className="help-gestures"><p><MouseTap /> <span><strong>单点</strong>在音符对应的轨道任意高度轻触，踩点时间仍以下方判定线为准。</span></p><p><NoteIcon type="hold" size={22} /><span><strong>长按</strong>在原轨道任意高度按住，直到尾部到达判定线，不必精准松手。</span></p><p><ArrowLeft size={22} /><span><strong>左滑 / 右滑 / 上滑</strong>从音符所在轨道起手，按箭头方向短划至少 24 像素；不需要跨轨。</span></p></div><div className="grade-guide"><span><b>PERFECT</b>±45 ms</span><span><b>GREAT</b>±90 ms</span><span><b>GOOD</b>±140 ms</span></div><p>歌曲切后台或游玩中改变屏幕方向会自动暂停；网页会自动适配横向画面。继续时有 3 秒倒计时；若有未完成的长按，请在倒计时内重新按住原轨道。切换应用前建议先手动暂停。</p><p className="muted">自动谱面来自声音起点与能量分析；弱节拍、复杂变拍歌曲可能需要校准。自动演示不记录成绩，最佳分数仅保存在此浏览器。</p><button className="primary-button" onClick={() => setHelp(false)}>准备好了 <ArrowRight size={16} /></button></motion.section></div>}
    {result && track && chart && <div className="modal-backdrop"><motion.section initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 250, damping: 25 }} className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title"><span className="eyebrow">{result.autoplay ? 'AUTO PREVIEW COMPLETE' : 'SESSION COMPLETE'}</span><div className="result-emblem"><Zap size={28} /></div><h2 id="result-title">{result.autoplay ? '演示结束' : result.accuracy >= 90 ? '节奏，尽在掌握。' : '每一次落点，都是进步。'}</h2><p>{track.name} <i>·</i> {DIFFICULTIES[chart.difficulty].label}</p><span className="result-score-label">TOTAL SCORE</span><strong className="result-score">{formatScore(result.score)}</strong><div className="result-summary"><div><span>准确率</span><strong>{result.accuracy.toFixed(2)}%</strong></div><div><span>最大连击</span><strong>{result.maxCombo}</strong></div></div><div className="result-grades">{(['perfect', 'great', 'good', 'miss'] as const).map(grade => <div key={grade} className={grade}><span>{grade.toUpperCase()}</span><strong>{result.counts[grade]}</strong></div>)}</div>{result.autoplay && <p className="muted">自动演示成绩不会保存。</p>}<button className="primary-button" onClick={() => void start(false)}><RotateCcw size={17} /> {result.autoplay ? '亲自挑战' : '再来一次'}</button><button className="text-button" onClick={() => setResult(null)}><ArrowLeft size={14} /> 返回演奏台</button></motion.section></div>}
  </div>;
}

function MouseTap() { return <ArrowDown size={22} />; }
