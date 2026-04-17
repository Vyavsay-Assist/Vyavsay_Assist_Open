# Voice Capture for Walk-In Entry — Phase 1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a mic button to the walk-in capture modal so the sales rep can speak (Hindi/Marathi/English) and have the form auto-fill via Whisper transcription + GPT structured extraction.

**Architecture:** Browser MediaRecorder → audio blob → POST to `/api/voice/extract-walkin` → `transcribeVoiceNote()` (Groq Whisper, OpenAI fallback) → `extractWalkInFromTranscript()` (GPT structured JSON) → response auto-fills form fields, owner reviews + saves.

**Tech Stack:** Reuses existing `voice-transcription-service.ts` (no new deps backend). Browser-native `MediaRecorder` + `getUserMedia` (no new deps frontend). New helper in `ai-router.ts` for structured extraction.

---

## File Structure

**Created:**
- `backend/src/routes/voice-routes.ts` — voice extraction endpoint

**Modified:**
- `backend/src/services/ai-router.ts` — add `extractWalkInFromTranscript()`
- `backend/src/server.ts` — register voice routes
- `frontend/src/components/AddWalkInModal.tsx` — add mic button + recording UI

---

## Task 1: Backend — `extractWalkInFromTranscript` AI helper

**Files:**
- Modify: `backend/src/services/ai-router.ts`

- [ ] **Step 1: Append helper at end of file**

```typescript
export interface WalkInExtraction {
  customer_name?: string;
  customer_phone?: string;
  items_mentioned: string[];
  outcome?: 'interested' | 'will_decide' | 'purchased' | 'not_interested' | 'follow_up';
  follow_up_hint?: string;
  staff_name?: string;
  notes: string;
}

/**
 * Extract structured walk-in data from a free-form voice transcript.
 * The salesperson is dictating what just happened in the showroom.
 */
export async function extractWalkInFromTranscript(transcript: string): Promise<WalkInExtraction> {
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const system = `You extract structured walk-in customer data from a salesperson's voice note.
The salesperson is in an Indian retail showroom (cars, appliances, etc.) describing what happened.
Transcript may mix Hindi, Hinglish, Marathi, English.

Return JSON with these fields (omit fields you can't infer):
- customer_name: string (just the person's name)
- customer_phone: string (10 digits, no spaces; strip country code prefix like 91)
- items_mentioned: array of strings (products/services discussed, e.g. ["Fortuner", "Endeavour"])
- outcome: one of "interested" | "will_decide" | "purchased" | "not_interested" | "follow_up"
- follow_up_hint: relative time phrase the customer mentioned (e.g. "Sunday", "tomorrow evening", "next week")
- staff_name: salesperson's name if they mention themselves
- notes: short clean summary of what happened (1-2 sentences in English)`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: transcript },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw);
    return {
      customer_name: parsed.customer_name?.toString().trim() || undefined,
      customer_phone: parsed.customer_phone ? String(parsed.customer_phone).replace(/\D/g, '').replace(/^91(\d{10})$/, '$1') : undefined,
      items_mentioned: Array.isArray(parsed.items_mentioned) ? parsed.items_mentioned.map((s: any) => String(s)) : [],
      outcome: ['interested', 'will_decide', 'purchased', 'not_interested', 'follow_up'].includes(parsed.outcome) ? parsed.outcome : undefined,
      follow_up_hint: parsed.follow_up_hint?.toString().trim() || undefined,
      staff_name: parsed.staff_name?.toString().trim() || undefined,
      notes: parsed.notes?.toString().trim() || transcript,
    };
  } catch {
    return { items_mentioned: [], notes: transcript };
  }
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd backend && npx tsc --noEmit`
Expected: no output (clean compile)

---

## Task 2: Backend — voice extraction route

**Files:**
- Create: `backend/src/routes/voice-routes.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create voice route file**

```typescript
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { transcribeVoiceNote } from '../services/voice-transcription-service.js';
import { extractWalkInFromTranscript } from '../services/ai-router.js';

export const voiceRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
  await server.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max — voice notes are tiny
  });

  // POST /api/voice/extract-walkin — audio → transcript + structured extraction
  server.post('/extract-walkin', async (request, reply) => {
    try {
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No audio uploaded' });

      const chunks: Buffer[] = [];
      for await (const chunk of file.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        return reply.status(400).send({ error: 'Empty audio file' });
      }

      const { text: transcript, provider } = await transcribeVoiceNote(buffer);
      if (!transcript || transcript.trim().length < 3) {
        return reply.status(400).send({ error: 'Could not understand audio. Please try again.' });
      }

      const extracted = await extractWalkInFromTranscript(transcript);

      return reply.send({
        transcript,
        provider,
        extracted,
      });
    } catch (err: any) {
      console.error('POST /voice/extract-walkin error:', err);
      return reply.status(500).send({ error: err.message || 'Voice extraction failed' });
    }
  });
};
```

- [ ] **Step 2: Register in server.ts**

Add after the visit routes registration:

```typescript
const { voiceRoutes } = await import('./routes/voice-routes.js');
await fastify.register(voiceRoutes, { prefix: '/api/voice' });
```

- [ ] **Step 3: Type-check + restart**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

---

## Task 3: Frontend — recording hook

**Files:**
- Create: `frontend/src/hooks/useAudioRecorder.ts`

- [ ] **Step 1: Create the hook**

```typescript
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
      // Cleanup on unmount
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick a supported mime — ogg/opus or webm
      const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', ''];
      const mime = candidates.find((m) => !m || MediaRecorder.isTypeSupported(m)) || '';
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
      recorder.stop();
    }
    chunksRef.current = [];
    cleanupStream();
    setStatus('idle');
    setDurationMs(0);
  };

  return { status, durationMs, error, start, stop, cancel };
}
```

---

## Task 4: Frontend — wire mic button + auto-fill into AddWalkInModal

**Files:**
- Modify: `frontend/src/components/AddWalkInModal.tsx`

- [ ] **Step 1: Add mic button and extraction flow**

Replace the existing imports + add Mic icon, recording state, and handler. Place the mic button at the top of the modal (above the name field) so it's the first thing the rep sees.

(Full updated file shown in execution.)

---

## Task 5: Type-check + commit

- [ ] **Step 1: Both sides type-check clean**

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/ai-router.ts backend/src/routes/voice-routes.ts backend/src/server.ts frontend/src/hooks/useAudioRecorder.ts frontend/src/components/AddWalkInModal.tsx
git commit -m "feat: voice capture for walk-in entry (Whisper + GPT extraction)"
```
