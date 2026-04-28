'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; resultIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  onFinalTranscript: (text: string) => void;
  lang?: string;
}

export interface UseSpeechRecognitionResult {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Thin wrapper around the Web Speech API. Continuous mode; calls
 * `onFinalTranscript` for every finalized chunk so the consumer can splice
 * it into the document.
 */
export function useSpeechRecognition(
  opts: UseSpeechRecognitionOptions,
): UseSpeechRecognitionResult {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(opts.onFinalTranscript);
  useEffect(() => { onFinalRef.current = opts.onFinalTranscript; }, [opts.onFinalTranscript]);

  const supported = getRecognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }
    if (recognitionRef.current) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = opts.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r && r.isFinal) {
          const transcript = r[0].transcript;
          if (transcript) onFinalRef.current(transcript);
        }
      }
    };
    rec.onerror = (e) => {
      setError(e.error || 'speech recognition error');
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    try {
      rec.start();
      recognitionRef.current = rec;
      setError(null);
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to start');
    }
  }, [opts.lang]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try { rec.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  return { supported, listening, error, start, stop };
}
