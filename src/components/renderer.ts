import type { JudgmentEngine } from '../core/judgment';
import { noteScreenY, stageLayout } from '../core/layout';
import type { ScrollMode } from '../types';

const COLORS = ['#72e4e3', '#b499ff', '#ed9cd2', '#83badf'];
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); }
function polygon(ctx: CanvasRenderingContext2D, points: number[][]) { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, direction: string, size: number) {
  ctx.save(); ctx.translate(x, y); if (direction === 'left') ctx.rotate(-Math.PI / 2); if (direction === 'right') ctx.rotate(Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(-size, size * 0.4); ctx.lineTo(0, -size * 0.6); ctx.lineTo(size, size * 0.4);
  ctx.lineWidth = Math.max(2, size * 0.28); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
}

export function drawGame(ctx: CanvasRenderingContext2D, width: number, height: number, engine: JudgmentEngine, time: number, speed: number, pressed: number[], paused: boolean, energy = 0.2, scrollMode: ScrollMode = 'perspective') {
  // Resize/navigation may briefly detach the canvas; never project a zero-size road.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return;
  ctx.clearRect(0, 0, width, height);
  const { hitY, nearWidth, roadWidth, xAt } = stageLayout(width, height);
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

  // Four equal input lanes project into a trapezoid; input stays anchored to its near edge.
  for (let lane = 0; lane < 4; lane++) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0c1521ee'); gradient.addColorStop(1, lane % 2 ? '#1b162de8' : '#102532e8');
    ctx.fillStyle = gradient;
    polygon(ctx, [[xAt(lane, 0), 0], [xAt(lane + 1, 0), 0], [xAt(lane + 1, hitY), hitY], [xAt(lane, hitY), hitY]]); ctx.fill();
    const recent = engine.hits.filter(h => h.lane === lane && time - h.at < 0.3 && time >= h.at && h.grade !== 'miss').at(-1);
    if (pressed.includes(lane) || recent) {
      const flash = ctx.createLinearGradient(0, hitY * 0.3, 0, height);
      flash.addColorStop(0, COLORS[lane] + '00'); flash.addColorStop(1, COLORS[lane] + '48');
      ctx.fillStyle = flash; polygon(ctx, [[xAt(lane, hitY * 0.3), hitY * 0.3], [xAt(lane + 1, hitY * 0.3), hitY * 0.3], [xAt(lane + 1, hitY), hitY], [xAt(lane, hitY), hitY]]); ctx.fill();
    }
    const px = width * 0.1 + lane * nearWidth / 4;
    round(ctx, px + 5, hitY + 11, nearWidth / 4 - 10, Math.min(38, height * 0.12), 5);
    ctx.fillStyle = pressed.includes(lane) ? COLORS[lane] + '30' : '#0e1526a0'; ctx.fill(); ctx.strokeStyle = COLORS[lane] + '35'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = COLORS[lane] + '80'; ctx.font = `500 ${height < 300 ? 10 : 12}px monospace`; ctx.textAlign = 'center';
    ctx.fillText(`0${lane + 1}`, px + nearWidth / 8, hitY + 11 + Math.min(38, height * 0.12) / 2 + 4);
  }
  for (let lane = 0; lane <= 4; lane++) {
    ctx.strokeStyle = lane === 0 || lane === 4 ? '#b2c9edb0' : '#a9c8ec21'; ctx.lineWidth = lane === 0 || lane === 4 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(xAt(lane, 0), 0); ctx.lineTo(xAt(lane, hitY), hitY); ctx.stroke();
  }
  for (let b = Math.floor(time / beat); b * beat < time + travel; b++) {
    const y = yAt(b * beat);
    if (y < 0 || y > hitY) continue;
    ctx.strokeStyle = b % 4 === 0 ? '#b5c4ee20' : '#b5c4ee0a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xAt(0, y), y); ctx.lineTo(xAt(4, y), y); ctx.stroke();
  }
  for (const state of engine.states) {
    const note = state.note;
    if (note.time > time + travel) break;
    if ((note.endTime || note.time) < time - 0.45 || (state.head !== undefined && (note.type !== 'hold' || state.tail !== undefined))) continue;
    const y = state.held ? hitY : yAt(note.time);
    if (y > hitY + 9) continue;
    const color = COLORS[note.lane], scale = Math.max(0.12, roadWidth(y) / nearWidth);
    const noteLeft = (at: number) => xAt(note.lane + 0.07, at);
    const noteRight = (at: number) => xAt(note.lane + 0.93, at);
    if (note.type === 'hold') {
      const endY = Math.max(-6, yAt(note.endTime!));
      const tail = ctx.createLinearGradient(0, endY, 0, Math.max(endY + 1, y));
      tail.addColorStop(0, color + '44'); tail.addColorStop(1, color + (state.held ? 'bb' : '88'));
      polygon(ctx, [[noteLeft(endY), endY], [noteRight(endY), endY], [noteRight(y), y], [noteLeft(y), y]]);
      ctx.fillStyle = tail; ctx.fill(); ctx.strokeStyle = color + '75'; ctx.lineWidth = 1; ctx.stroke();
      for (let t = note.time + beat / 2; t < note.endTime!; t += beat / 2) {
        const dy = yAt(t); if (dy < 0 || dy > y) continue;
        const dx = xAt(note.lane + 0.5, dy), ds = 2 + scale * 2;
        polygon(ctx, [[dx, dy - ds], [dx + ds, dy], [dx, dy + ds], [dx - ds, dy]]); ctx.fillStyle = color + 'a0'; ctx.fill();
      }
    }
    const half = (note.type === 'tap' || note.type === 'hold' ? 6 : 14) * scale;
    ctx.shadowColor = color; ctx.shadowBlur = paused ? 0 : 10;
    polygon(ctx, [[noteLeft(y - half), y - half], [noteRight(y - half), y - half], [noteRight(y + half), y + half], [noteLeft(y + half), y + half]]);
    ctx.fillStyle = note.type === 'tap' || note.type === 'hold' ? color : color + '38'; ctx.fill();
    ctx.strokeStyle = note.type === 'tap' || note.type === 'hold' ? '#ffffff9c' : color; ctx.lineWidth = 1; ctx.stroke();
    if (note.type !== 'tap' && note.type !== 'hold') { ctx.strokeStyle = color; arrow(ctx, xAt(note.lane + 0.5, y), y, note.type, Math.max(3, 10 * scale)); }
    else if (note.type === 'hold') { ctx.fillStyle = '#163142'; const cx = xAt(note.lane + 0.5, y); ctx.fillRect(cx - 7 * scale, y - 1.5, 14 * scale, 3); }
    ctx.shadowBlur = 0;
  }
  const line = ctx.createLinearGradient(xAt(0, hitY), 0, xAt(4, hitY), 0);
  line.addColorStop(0, '#72e4e3'); line.addColorStop(0.5, '#d0b2ff'); line.addColorStop(1, '#e69fe3');
  ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.shadowColor = '#bd94ff'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(xAt(0, hitY), hitY); ctx.lineTo(xAt(4, hitY), hitY); ctx.stroke();
  ctx.lineWidth = 1; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.moveTo(xAt(0, hitY - 9), hitY - 9); ctx.lineTo(xAt(4, hitY - 9), hitY - 9); ctx.stroke(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  if (!paused) for (const hit of engine.hits) {
    const age = time - hit.at; if (age < 0 || age > 0.4 || hit.grade === 'miss') continue;
    ctx.globalAlpha = 1 - age / 0.4; ctx.fillStyle = COLORS[hit.lane];
    const cx = xAt(hit.lane + 0.5, hitY);
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI * (0.13 + i / 10), length = age * (80 + (i * 31) % 90);
      const px = cx + Math.cos(angle) * length, py = hitY + Math.sin(angle) * length;
      ctx.fillRect(px, py, 1.5, 3.5);
    }
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
