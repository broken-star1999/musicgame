import type { JudgmentEngine, NoteState } from '../core/judgment';
import { noteScreenY, stageLayout } from '../core/layout';
import type { ScrollMode } from '../types';

const COLORS = ['#72e4e3', '#b499ff', '#ed9cd2', '#83badf'];
function polygon(ctx: CanvasRenderingContext2D, points: number[][]) { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, direction: string, size: number) {
  ctx.save(); ctx.translate(x, y); if (direction === 'left') ctx.rotate(-Math.PI / 2); if (direction === 'right') ctx.rotate(Math.PI / 2);
  for (const offset of [-size * 0.45, size * 0.4]) {
    polygon(ctx, [[-size, offset + size * 0.35], [0, offset - size * 0.6], [size, offset + size * 0.35], [size, offset + size * 0.85], [0, offset - size * 0.1], [-size, offset + size * 0.85]]);
    ctx.fillStyle = '#fff4c8'; ctx.strokeStyle = '#7d4d14'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function electricArc(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, phase: number, color: string) {
  const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy), steps = Math.max(4, Math.ceil(length / 13));
  ctx.beginPath(); ctx.moveTo(x1, y1);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, jitter = Math.sin(i * 1.91 + phase * 4.3) * Math.cos(i * 3.17 + phase * 1.7) * Math.sin(Math.PI * t) * 8;
    ctx.lineTo(x1 + dx * t - dy / Math.max(1, length) * jitter, y1 + dy * t + dx / Math.max(1, length) * jitter);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#f2ffff'; ctx.lineWidth = 1; ctx.stroke();
}

export function noteOpacity(state: NoteState, time: number): number {
  if (state.head === 'miss' || state.tail === 'miss') {
    const missedAt = state.tail === 'miss' ? state.tailAt : state.headAt;
    return 0.65 * Math.max(0, 1 - Math.max(0, time - (missedAt ?? state.note.time + 0.14)) / 0.33);
  }
  return state.head !== undefined && (state.note.type !== 'hold' || state.tail !== undefined) ? 0 : 1;
}

export function drawGame(ctx: CanvasRenderingContext2D, width: number, height: number, engine: JudgmentEngine, time: number, speed: number, pressed: number[], paused: boolean, energy = 0.2, scrollMode: ScrollMode = 'perspective') {
  // Resize/navigation may briefly detach the canvas; never project a zero-size road.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return;
  ctx.clearRect(0, 0, width, height);
  const { hitY, frameTop, nearWidth, roadWidth, xAt } = stageLayout(width, height);
  const center = width / 2;
  const travel = 3.6 - speed * 0.26, beat = 60 / engine.chart.bpm;
  const yAt = (noteTime: number) => noteScreenY(noteTime, time, travel, hitY, scrollMode);
  const pulse = Math.min(1, Math.max(0, energy));

  // Original abstract stage: beams and LEDs follow the analyzed energy envelope.
  ctx.save();
  for (let side = 0; side < 2; side++) {
    const beam = ctx.createLinearGradient(0, 0, 0, height);
    beam.addColorStop(0, `rgba(${side ? '151,104,218' : '62,176,197'},${0.02 + pulse * 0.05})`); beam.addColorStop(1, '#00000000');
    const base = side ? width * 0.93 : width * 0.07;
    ctx.fillStyle = beam; polygon(ctx, [[base, -20], [center + (side ? 0.4 : -0.4) * width, height], [center + (side ? -0.14 : 0.14) * width, height]]); ctx.fill();
    for (let row = 0; row < 6; row++) {
      const y = height * (0.16 + row * 0.105), x = side ? width * 0.96 : width * 0.04;
      ctx.fillStyle = `rgba(${side ? '183,143,225' : '96,202,218'},${0.04 + pulse * 0.12})`;
      ctx.fillRect(x - 12, y, 24, 2);
    }
  }
  ctx.strokeStyle = '#596d8b12'; ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) { const y = height * (0.3 + i * 0.08); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.restore();

  // The visible trapezoid is also the input surface, from its top to bottom.
  for (let lane = 0; lane < 4; lane++) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0c1521ee'); gradient.addColorStop(1, lane % 2 ? '#1b162de8' : '#102532e8');
    ctx.fillStyle = gradient;
    polygon(ctx, [[xAt(lane, 0), 0], [xAt(lane + 1, 0), 0], [xAt(lane + 1, height), height], [xAt(lane, height), height]]); ctx.fill();
    const recent = engine.hits.filter(h => h.lane === lane && time - h.at < 0.3 && time >= h.at && h.grade !== 'miss').at(-1);
    if (pressed.includes(lane) || recent) {
      const flash = ctx.createLinearGradient(0, 0, 0, height);
      const strength = pressed.includes(lane) ? 1 : Math.max(0, 1 - (time - recent!.at) / 0.3);
      flash.addColorStop(0, COLORS[lane] + '00'); flash.addColorStop(1, COLORS[lane] + Math.round(72 * strength).toString(16).padStart(2, '0'));
      ctx.fillStyle = flash; polygon(ctx, [[xAt(lane, 0), 0], [xAt(lane + 1, 0), 0], [xAt(lane + 1, height), height], [xAt(lane, height), height]]); ctx.fill();
    }
  }
  for (let lane = 0; lane <= 4; lane++) {
    ctx.strokeStyle = lane === 0 || lane === 4 ? '#b2c9edb0' : '#a9c8ec21'; ctx.lineWidth = lane === 0 || lane === 4 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(xAt(lane, 0), 0); ctx.lineTo(xAt(lane, height), height); ctx.stroke();
  }
  for (let b = Math.floor(time / beat); b * beat < time + travel; b++) {
    const y = yAt(b * beat);
    if (y < 0 || y > height) continue;
    ctx.strokeStyle = b % 4 === 0 ? '#b5c4ee20' : '#b5c4ee0a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xAt(0, y), y); ctx.lineTo(xAt(4, y), y); ctx.stroke();
  }
  for (const state of engine.states) {
    const note = state.note;
    if (note.time > time + travel) break;
    const opacity = noteOpacity(state, time);
    if (opacity <= 0 || (note.endTime || note.time) < time - 0.5) continue;
    const holding = note.type === 'hold' && state.head !== undefined && state.head !== 'miss' && state.tail === undefined;
    const y = holding ? hitY : yAt(note.time);
    if (y > height + 40 && note.type !== 'hold') continue;
    const isSwipe = note.type !== 'tap' && note.type !== 'hold';
    const color = isSwipe ? '#ffd16c' : COLORS[note.lane], scale = Math.max(0.12, roadWidth(Math.min(y, height)) / nearWidth);
    ctx.save(); ctx.globalAlpha = opacity;
    const noteLeft = (at: number) => xAt(note.lane + 0.07, at);
    const noteRight = (at: number) => xAt(note.lane + 0.93, at);
    if (note.type === 'hold') {
      const endY = Math.max(-6, yAt(note.endTime!));
      const tail = ctx.createLinearGradient(0, endY, 0, Math.max(endY + 1, y));
      tail.addColorStop(0, color + '44'); tail.addColorStop(1, color + (state.held ? 'bb' : '88'));
      const bottom = Math.min(height + 20, y);
      polygon(ctx, [[noteLeft(endY), endY], [noteRight(endY), endY], [noteRight(bottom), bottom], [noteLeft(bottom), bottom]]);
      ctx.fillStyle = tail; ctx.fill(); ctx.strokeStyle = color + '75'; ctx.lineWidth = 1; ctx.stroke();
      for (let t = note.time + beat / 2; t < note.endTime!; t += beat / 2) {
        const dy = yAt(t); if (dy < 0 || dy > y) continue;
        const dx = xAt(note.lane + 0.5, dy), ds = 2 + scale * 2;
        polygon(ctx, [[dx, dy - ds], [dx + ds, dy], [dx, dy + ds], [dx - ds, dy]]); ctx.fillStyle = color + 'a0'; ctx.fill();
      }
    }
    const half = (isSwipe ? 8 : 6) * scale;
    if (y <= height + 30) {
    ctx.shadowColor = color; ctx.shadowBlur = paused ? 0 : 10;
    polygon(ctx, [[noteLeft(y - half), y - half], [noteRight(y - half), y - half], [noteRight(y + half), y + half], [noteLeft(y + half), y + half]]);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = note.type === 'tap' || note.type === 'hold' ? '#ffffff9c' : color; ctx.lineWidth = 1; ctx.stroke();
    if (isSwipe) { ctx.shadowBlur = 13; arrow(ctx, xAt(note.lane + 0.5, y), y - Math.max(8, 16 * scale), note.type, Math.max(6, 17 * scale)); }
    else if (note.type === 'hold') { ctx.fillStyle = '#163142'; const cx = xAt(note.lane + 0.5, y); ctx.fillRect(cx - 7 * scale, y - 1.5, 14 * scale, 3); }
    ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  const overhang = Math.max(12, width * 0.025);
  const line = ctx.createLinearGradient(xAt(0, hitY) - overhang, 0, xAt(4, hitY) + overhang, 0);
  line.addColorStop(0, '#b2b0ff'); line.addColorStop(0.5, '#f3b0ff'); line.addColorStop(1, '#d68dff');
  polygon(ctx, [[xAt(0, frameTop) - overhang, frameTop], [xAt(4, frameTop) + overhang, frameTop], [xAt(4, hitY) + overhang, hitY], [xAt(0, hitY) - overhang, hitY]]);
  ctx.fillStyle = '#c58dff12'; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.shadowColor = '#d999ff'; ctx.shadowBlur = 12; ctx.stroke();
  ctx.strokeStyle = '#ffe1ff'; ctx.lineWidth = 1;
  for (const y of [frameTop, hitY]) { ctx.beginPath(); ctx.moveTo(xAt(0, y) - overhang, y); ctx.lineTo(xAt(4, y) + overhang, y); ctx.stroke(); }
  ctx.shadowBlur = 0;
  for (let lane = 0; lane < 4; lane++) {
    const x = xAt(lane + 0.5, hitY), radius = pressed.includes(lane) ? 4 : 2;
    polygon(ctx, [[x - radius, hitY], [x, hitY - radius], [x + radius, hitY], [x, hitY + radius]]); ctx.fillStyle = COLORS[lane]; ctx.fill();
  }
  if (!paused) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const state of engine.states) {
      if (!state.held || state.tail !== undefined) continue;
      const lane = state.note.lane, color = COLORS[lane], tailY = Math.max(0, yAt(state.note.endTime!));
      ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.48 + Math.sin(time * 26) * 0.19;
      ctx.fillStyle = color; ctx.fillRect(xAt(lane + 0.07, hitY), hitY - 6, nearWidth / 4 * 0.86, 12);
      const phase = Math.floor(time * 24);
      electricArc(ctx, xAt(lane + 0.08, hitY), hitY, xAt(lane + 0.92, hitY), hitY, phase, color);
      if (hitY - tailY > 10) {
        for (const edge of [0.22, 0.78]) electricArc(ctx, xAt(lane + edge, hitY), hitY, xAt(lane + edge, tailY), tailY, phase + edge * 7, color);
        const pulseY = hitY - ((time * 2) % 1) * (hitY - tailY);
        electricArc(ctx, xAt(lane + 0.15, pulseY), pulseY, xAt(lane + 0.85, pulseY), pulseY, phase + 3, color);
      }
    }
    for (const hit of engine.hits) {
      const age = time - hit.at, duration = hit.tail ? 0.55 : 0.44;
      if (age < 0 || age >= duration || hit.grade === 'miss') continue;
      const progress = age / duration, fade = (1 - progress) ** 2;
      const cx = xAt(hit.lane + 0.5, hitY), laneWidth = nearWidth / 4;
      const isSwipe = hit.type === 'left' || hit.type === 'right' || hit.type === 'up';
      const color = isSwipe ? '#ffd16c' : COLORS[hit.lane];
      const radius = Math.min(110, laneWidth * 0.72), glow = ctx.createRadialGradient(cx, hitY, 0, cx, hitY, radius);
      glow.addColorStop(0, color + '90'); glow.addColorStop(0.3, color + '35'); glow.addColorStop(1, color + '00');
      ctx.globalAlpha = fade; ctx.fillStyle = glow; ctx.fillRect(cx - radius, hitY - radius, radius * 2, radius * 2);
      ctx.shadowColor = color; ctx.shadowBlur = 14;
      const dissolve = Math.max(0, (age - 0.055) / (duration - 0.055));
      for (let row = 0; row < 2; row++) for (let column = 0; column < 10; column++) {
        const noise = ((column * 37 + row * 19) % 17) / 17;
        const x = cx + (column / 10 - 0.5) * laneWidth * 0.86;
        const driftX = (column - 4.5) * dissolve * (2 + noise * 2), driftY = -dissolve * (12 + noise * 28) + row * 6;
        ctx.globalAlpha = Math.max(0, 1 - dissolve * (1 + noise * 0.7)) ** 1.5;
        ctx.fillStyle = age < 0.065 ? '#f5ffff' : color;
        const shrink = 1 - dissolve * 0.65;
        ctx.fillRect(x + driftX, hitY - 6 + driftY, laneWidth * 0.086 * shrink + (age < 0.055 ? 0.5 : 0), 6 * shrink);
      }
      if (isSwipe) {
        const distance = progress * Math.min(90, laneWidth * 0.75), dx = hit.type === 'left' ? -distance : hit.type === 'right' ? distance : 0;
        const dy = hit.type === 'up' ? -distance : -progress * 12;
        ctx.globalAlpha = fade * 0.85; arrow(ctx, cx + dx, hitY + dy - 10, hit.type, 8 + fade * 4);
      }
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  const latest = engine.hits.at(-1);
  if (latest && time >= latest.at && time - latest.at < 0.32) {
    ctx.globalAlpha = Math.min(1, (0.32 - time + latest.at) * 9);
    ctx.fillStyle = latest.grade === 'miss' ? '#f294ab' : latest.grade === 'perfect' ? '#d2f6af' : '#c0c0ff';
    ctx.font = `700 ${Math.max(13, Math.min(25, height * 0.075))}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center';
    ctx.shadowBlur = 15; ctx.shadowColor = ctx.fillStyle; ctx.fillText(latest.grade.toUpperCase(), center, hitY - Math.max(27, height * 0.12)); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}
