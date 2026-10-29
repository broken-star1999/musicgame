import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { analyzeAudio } from '../src/core/analysis';
import { countTypes, DIFFICULTIES, generateChart } from '../src/core/chart';
import { isPlayableChart, peakFingers } from '../src/core/chart-constraints';
import { validateFingering } from '../src/core/fingering';

// Optional private fixture: never copy the user's song into the repository.
const audioPath = process.env.BEATFALL_TEST_AUDIO;
describe.skipIf(!audioPath)('local real-song analysis', () => {
  it('decodes a local song and produces conflict-free charts at all difficulties', () => {
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', audioPath!, '-f', 'f32le', '-ac', '1', '-ar', '22050', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    expect(decoded.status, decoded.stderr.toString()).toBe(0);
    const bytes = decoded.stdout;
    const samples = new Float32Array(bytes.length / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
    const analysis = analyzeAudio(samples, 22050);
    expect(analysis.duration).toBeGreaterThan(2); expect(analysis.duration).toBeLessThanOrEqual(300);
    const reports = [];
    for (const difficulty of ['one', 'two', 'three', 'four'] as const) {
      const chart = generateChart(analysis, difficulty), lastEnd = [-100, -100, -100, -100];
      expect(chart.notes.length).toBeGreaterThan(20);
      for (const note of chart.notes) {
        expect(Math.min(...(analysis.pulse?.onsets ?? analysis.onsets).map(onset => Math.abs(onset.time - note.time)))).toBeLessThanOrEqual(0.0181);
        expect(note.time - lastEnd[note.lane]).toBeGreaterThanOrEqual(0.09);
        expect(note.endTime || note.time).toBeLessThan(chart.duration);
        lastEnd[note.lane] = note.endTime || note.time;
        const active = chart.notes.filter(n => n.time <= note.time + 0.00001 && (n.endTime ? n.endTime > note.time : Math.abs(n.time - note.time) < 0.00001));
        expect(active.length).toBeLessThanOrEqual(DIFFICULTIES[difficulty].max);
      }
      expect(chart).toEqual(generateChart(analysis, difficulty));
      expect(isPlayableChart(chart.notes, DIFFICULTIES[difficulty].max, chart.duration)).toBe(true);
      expect(validateFingering(chart.notes, DIFFICULTIES[difficulty].max, chart.duration)).toBe(true);
      expect(chart.fingering?.checked).toBe(true);
      expect(chart.fingering!.omitted / (chart.notes.length + chart.fingering!.omitted)).toBeLessThan(0.08);
      expect(peakFingers(chart.notes)).toBeLessThanOrEqual(DIFFICULTIES[difficulty].max);
      reports.push({ difficulty, notes: chart.notes.length, fingerLimit: chart.fingerLimit, fingerPeak: peakFingers(chart.notes), types: countTypes(chart), repetition: chart.repetition, fingering: chart.fingering, patterns: chart.patterns });
    }
    const sections = analysis.pulse?.sections || [];
    console.log(JSON.stringify({ duration: analysis.duration, bpm: analysis.bpm, confidence: analysis.confidence, onsets: analysis.onsets.length, pulse: analysis.pulse?.onsets.length, sourceSections: sections.reduce((counts, section) => { counts[section.band] = (counts[section.band] || 0) + 1; return counts; }, {} as Record<string, number>), sourceChanges: sections.filter((section, i) => i > 0 && section.band !== sections[i - 1].band).length, beats: analysis.rhythm?.beats.length, beatConfidence: analysis.rhythm?.confidence, reports }, null, 2));
  }, 30000);
});
