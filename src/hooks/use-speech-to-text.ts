import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionCtor = new () => any;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) ?? null;
}

export interface UseSpeechToTextOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  /** Called with each newly finalized chunk of transcript. */
  onFinalChunk?: (chunk: string) => void;
  /** Called with the current interim (in-progress) transcript. */
  onInterim?: (interim: string) => void;
  onError?: (err: { error: string; message?: string }) => void;
}

export interface UseSpeechToTextResult {
  supported: boolean;
  listening: boolean;
  interim: string;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  error: string | null;
}

export function useSpeechToText(
  options: UseSpeechToTextOptions = {},
): UseSpeechToTextResult {
  const {
    lang = "pt-BR",
    continuous = true,
    interimResults = true,
    onFinalChunk,
    onInterim,
    onError,
  } = options;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const onFinalRef = useRef(onFinalChunk);
  const onInterimRef = useRef(onInterim);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onFinalRef.current = onFinalChunk;
    onInterimRef.current = onInterim;
    onErrorRef.current = onError;
  }, [onFinalChunk, onInterim, onError]);

  useEffect(() => {
    setSupported(!!getRecognitionCtor());
  }, []);

  const ensureInstance = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;

    rec.onresult = (event: any) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText) {
        onFinalRef.current?.(finalText);
      }
      setInterim(interimText);
      onInterimRef.current?.(interimText);
    };

    rec.onerror = (event: any) => {
      const err = event?.error ?? "unknown";
      setError(err);
      onErrorRef.current?.({ error: err, message: event?.message });
      if (err === "not-allowed" || err === "service-not-allowed") {
        shouldListenRef.current = false;
        setListening(false);
      }
    };

    rec.onend = () => {
      // Some browsers auto-stop; restart if the user still wants to listen.
      if (shouldListenRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* ignore */
        }
      }
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = rec;
    return rec;
  }, [lang, continuous, interimResults]);

  const start = useCallback(() => {
    const rec = ensureInstance();
    if (!rec) return;
    setError(null);
    shouldListenRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if already started; treat as listening.
      setListening(true);
    }
  }, [ensureInstance]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
    setInterim("");
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return { supported, listening, interim, start, stop, toggle, error };
}
