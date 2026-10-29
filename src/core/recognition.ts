import type { Analysis } from '../types';
import { decodeBeatClock, neuralPeaks } from './beat-decoder';
import { musicalEvents } from './musical-events';

export function applyBeatRecognition(analysis: Analysis, logits: Float32Array): Analysis {
  const rhythm = decodeBeatClock(logits);
  const events = musicalEvents(analysis, rhythm);
  if (events.filter(event => event.role === 'beat').length < 3) throw new Error('模型未找到足够清晰的音乐落点');
  const tempi = rhythm.tempo.map(point => point.bpm).filter(value => value >= 30 && value <= 300).sort((a, b) => a - b);
  const bpm = tempi.length ? Math.round(tempi[Math.floor(tempi.length / 2)]) : analysis.bpm;
  return { ...analysis, bpm, confidence: rhythm.confidence, rhythm, pulse: { onsets: events, sections: [] }, recognition: { engine: 'beat-this', model: 'Beat This! small0', rawBeats: neuralPeaks(logits).length } };
}
