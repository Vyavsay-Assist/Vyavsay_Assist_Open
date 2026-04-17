import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'recording' | 'stopping';

export interface UseAudioRecorder {
  status: Status;
  durationMs: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}

/**
 * Browser MediaRecorder hook with timer + auto-stop.
 * Returns a Blob (typically audio/webm or audio/ogg+opus depending on browser).
 */
export function useAudioRecorder(maxDurationMs: number = 30_000): UseAudioRecorder {
  const [status, setStatus] = useState<Status>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tickerRef.current) window.clearInterval(tickerRef.current);
      if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (autoStopRef.current) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  };

  const start = async () => {
    setError(null);
    setDurationMs(0);
    chunksRef.current = [];

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', ''];
      const supported = candidates.find((m) => !m || (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)));
      const mime = supported || '';
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      startedAtRef.current = Date.now();
      setStatus('recording');

      tickerRef.current = window.setInterval(() => {
        setDurationMs(Date.now() - startedAtRef.current);
      }, 100);

      autoStopRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, maxDurationMs);
    } catch (err: any) {
      setError(err?.message || 'Microphone access denied');
      setStatus('idle');
      cleanupStream();
    }
  };

  const stop = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') {
        cleanupStream();
        setStatus('idle');
        resolve(null);
        return;
      }
      setStatus('stopping');
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        cleanupStream();
        setStatus('idle');
        resolve(blob);
      };
      recorder.stop();
    });
  };

  const cancel = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null;
      try { recorder.stop(); } catch { /* noop */ }
    }
    chunksRef.current = [];
    cleanupStream();
    setStatus('idle');
    setDurationMs(0);
  };

  return { status, durationMs, error, start, stop, cancel };
}
