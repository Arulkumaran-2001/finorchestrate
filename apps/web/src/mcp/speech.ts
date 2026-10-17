/**
 * Thin wrappers over the Web Speech API. Recognition is available in Chromium
 * based browsers; synthesis everywhere. The console degrades to typing when
 * recognition is missing or the microphone is blocked.
 */
export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export type RecognitionConstructor = new () => RecognitionLike;

export function recognitionConstructor(): RecognitionConstructor | null {
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export const speechSupport = {
  recognition: () => recognitionConstructor() !== null,
  synthesis: () => 'speechSynthesis' in window,
};

export interface ListenHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

export const SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser, or type instead.',
  'service-not-allowed': 'Speech recognition is not allowed here. Type your request instead.',
  'no-speech': 'I did not hear anything. Tap the microphone and try again.',
  'audio-capture': 'No microphone was found. Type your request instead.',
  network: 'Speech recognition needs a network connection.',
};

export function listen(handlers: ListenHandlers): () => void {
  const Recognition = recognitionConstructor();
  if (!Recognition) {
    handlers.onError('Voice input is not supported in this browser. Type your request instead.');
    handlers.onEnd();
    return () => undefined;
  }
  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]!;
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    handlers.onInterim((finalText + interim).trim());
  };
  recognition.onerror = (event) => {
    if (event.error !== 'aborted') handlers.onError(SPEECH_ERRORS[event.error] ?? `Speech recognition stopped (${event.error}).`);
  };
  recognition.onend = () => {
    if (finalText.trim()) handlers.onFinal(finalText.trim());
    handlers.onEnd();
  };
  recognition.start();
  return () => recognition.stop();
}

let preferredVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (preferredVoice) return preferredVoice;
  const voices = window.speechSynthesis.getVoices();
  const ranked = [/natural/i, /google us english/i, /aria|jenny|samantha|allison/i, /en-us/i];
  for (const pattern of ranked) {
    const match = voices.find((voice) => voice.lang.startsWith('en') && (pattern.test(voice.name) || pattern.test(voice.lang)));
    if (match) return (preferredVoice = match);
  }
  return (preferredVoice = voices.find((voice) => voice.lang.startsWith('en')) ?? null);
}

export function speak(text: string, onEnd?: () => void): void {
  if (!speechSupport.synthesis()) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = 'en-US';
  utterance.rate = 1.03;
  utterance.pitch = 1;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupport.synthesis()) window.speechSynthesis.cancel();
}
