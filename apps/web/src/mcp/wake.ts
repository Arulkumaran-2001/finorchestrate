import { matchWake } from '@finorchestrate/core';
import { recognitionConstructor, SPEECH_ERRORS, type RecognitionConstructor, type RecognitionLike } from './speech';

/**
 * Hands-free listening, the way a smart speaker works: the console listens
 * for "Hey Fino", chimes, takes the request that follows and goes back to
 * waiting. Recognition runs on the device when the browser has an on-device
 * model (Chrome 139+), so room audio never leaves the machine; otherwise it
 * falls back to the browser's speech service and says so in the UI.
 *
 * When the model still has to download, listening starts at once on the
 * speech service and moves to the device as soon as the model is installed.
 *
 * The listener pauses itself while the console works or speaks, so it never
 * hears its own replies, and restarts whenever the browser ends a session.
 */
export type WakeStatus = 'off' | 'preparing' | 'waiting' | 'awake' | 'paused' | 'error';
export type WakeEngine = 'device' | 'service';

type ResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;

/** How long the console stays awake for a request after the wake phrase. */
const AWAKE_WINDOW_MS = 8000;
/** Quiet time after a final result before the request is sent, so a short pause does not cut it in half. */
const SETTLE_MS = 900;
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

interface OnDeviceApi {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

/** 'ready' when the on-device model can be used now, a pending install when it is downloading, 'none' otherwise. */
async function onDeviceModel(Recognition: RecognitionConstructor): Promise<'ready' | 'none' | { installing: Promise<boolean> }> {
  const api = Recognition as unknown as OnDeviceApi;
  if (typeof api.available !== 'function') return 'none';
  const options = { langs: ['en-US'], processLocally: true };
  try {
    const status = await api.available(options);
    if (status === 'available') return 'ready';
    if ((status === 'downloadable' || status === 'downloading') && typeof api.install === 'function') {
      return { installing: api.install(options).catch(() => false) };
    }
  } catch {
    // Treated as unavailable; the speech service fallback still works.
  }
  return 'none';
}

function collect(results: ResultList, from: number): { text: string; final: boolean } {
  let text = '';
  let final = true;
  for (let index = from; index < results.length; index += 1) {
    const result = results[index]!;
    text += result[0]?.transcript ?? '';
    if (!result.isFinal) final = false;
  }
  return { text: text.trim(), final };
}

export class WakeListener {
  status: WakeStatus = 'off';
  engine: WakeEngine | null = null;
  /** The request as it is being heard, for the composer. */
  heard = '';
  message: string | null = null;
  onCommand: (text: string) => void = () => undefined;

  private recognition: RecognitionLike | null = null;
  private wanted = false;
  private held = false;
  private consumed = 0;
  private seen = 0;
  private phraseInText = false;
  private failures = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private awakeTimer: ReturnType<typeof setTimeout> | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private audio: AudioContext | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): string {
    return `${this.status}|${this.engine ?? ''}|${this.heard}|${this.message ?? ''}`;
  }

  get enabled(): boolean {
    return this.wanted;
  }

  /** Call from a click: the browser needs a user gesture for the microphone, the audio cue and the model download. */
  async enable(): Promise<void> {
    if (this.wanted) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      this.fail('Hands-free needs Chrome or Edge. Type your request instead.');
      return;
    }
    this.wanted = true;
    this.message = null;
    this.set('preparing');
    try {
      this.audio ??= new AudioContext();
    } catch {
      this.audio = null;
    }
    const model = await onDeviceModel(Recognition);
    if (!this.wanted) return;
    this.engine = model === 'ready' ? 'device' : 'service';
    this.run();
    if (typeof model === 'object') {
      void model.installing.then((installed) => {
        if (!installed || !this.wanted || this.engine === 'device') return;
        this.engine = 'device';
        // Move to the device between requests; an answer in progress is never cut off.
        if (this.status === 'waiting') {
          this.stopSession();
          this.run();
        } else {
          this.emit();
        }
      });
    }
  }

  disable(): void {
    this.wanted = false;
    this.engine = null;
    this.message = null;
    this.stopSession();
    this.set('off');
  }

  /** The console is busy (working, speaking, or push to talk). Stop listening so it never hears itself. */
  hold(): void {
    if (this.held) return;
    this.held = true;
    this.stopSession();
    if (this.wanted && this.status !== 'error') this.set('paused');
  }

  /** The console is idle again. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    this.run();
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disable();
    void this.audio?.close().catch(() => undefined);
    this.listeners.clear();
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.stopSession();
      if (this.wanted && this.status !== 'error') this.set('paused');
    } else {
      this.run();
    }
  };

  private run(): void {
    if (!this.wanted || this.held || this.engine === null || document.hidden || this.recognition) return;
    if (this.status !== 'awake') this.set('waiting');
    this.startSession();
  }

  private startSession(): void {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if (this.engine === 'device') {
      const local = recognition as RecognitionLike & { processLocally?: boolean; phrases?: unknown[] };
      local.processLocally = true;
      // Contextual biasing, where supported, makes the recognizer favour the product name over lookalike words.
      const Phrase = (window as unknown as { SpeechRecognitionPhrase?: new (phrase: string, boost: number) => unknown }).SpeechRecognitionPhrase;
      if (Phrase) {
        try {
          local.phrases = [new Phrase('Fino', 4), new Phrase('Hey Fino', 4)];
        } catch {
          // Biasing is an optimisation; recognition works without it.
        }
      }
    }
    this.consumed = 0;
    this.seen = 0;
    this.phraseInText = false;
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      this.failures = 0;
      this.handle(event.results);
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || event.error === 'aborted' || event.error === 'no-speech') return;
      if (FATAL.has(event.error)) {
        this.fail(SPEECH_ERRORS[event.error] ?? `Hands-free stopped (${event.error}).`);
        return;
      }
      this.failures += 1;
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      // Browsers end sessions after silence or a network blip; pick up again with a gentle backoff.
      const delay = Math.min(250 * 2 ** this.failures, 8000);
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this.run(), delay);
    };
    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.recognition = null;
      this.failures += 1;
      this.restartTimer = setTimeout(() => this.run(), 1000);
    }
  }

  private stopSession(): void {
    clearTimeout(this.settleTimer);
    clearTimeout(this.awakeTimer);
    clearTimeout(this.restartTimer);
    const recognition = this.recognition;
    this.recognition = null;
    this.heard = '';
    this.phraseInText = false;
    recognition?.abort();
  }

  private handle(results: ResultList): void {
    this.seen = results.length;
    const { text, final } = collect(results, this.consumed);
    if (this.status === 'waiting') {
      if (!matchWake(text)) {
        // Room chatter: forget it once it is final, so it never mixes into a later match.
        if (final) this.consumed = results.length;
        return;
      }
      this.phraseInText = true;
      this.wake();
    }
    if (this.status !== 'awake') return;

    let command = text;
    if (this.phraseInText) {
      command = matchWake(text)?.command ?? '';
      if (final && !command) {
        // Only the wake phrase so far: drop it and listen for the request.
        this.consumed = results.length;
        this.phraseInText = false;
      }
    }
    this.heard = command;
    this.emit();
    clearTimeout(this.settleTimer);
    if (command && final) this.settleTimer = setTimeout(() => this.dispatch(command), SETTLE_MS);
  }

  private wake(): void {
    this.set('awake');
    this.tone(true);
    clearTimeout(this.awakeTimer);
    this.awakeTimer = setTimeout(() => {
      if (this.status !== 'awake' || this.heard) return;
      this.consumed = this.seen;
      this.phraseInText = false;
      this.tone(false);
      this.set('waiting');
    }, AWAKE_WINDOW_MS);
  }

  private dispatch(command: string): void {
    // Hold first so nothing is heard while the console answers; the console releases when it is idle.
    this.hold();
    this.onCommand(command);
  }

  private fail(message: string): void {
    this.wanted = false;
    this.stopSession();
    this.message = message;
    this.set('error');
  }

  private tone(rising: boolean): void {
    const context = this.audio;
    if (!context) return;
    void context.resume().catch(() => undefined);
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(rising ? 660 : 880, now);
    oscillator.frequency.exponentialRampToValueAtTime(rising ? 990 : 520, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  private set(status: WakeStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
