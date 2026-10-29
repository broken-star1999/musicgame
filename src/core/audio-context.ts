let context: AudioContext | undefined;

export function audioContext(): AudioContext {
  if (!context) context = new AudioContext();
  return context;
}
