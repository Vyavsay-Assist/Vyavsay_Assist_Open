import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { transcribeVoiceNote, NEUTRAL_PROMPT } from '../services/voice-transcription-service.js';
import { extractWalkInFromTranscript } from '../services/ai-router.js';

// Reject very short / empty audio: Whisper hallucinates plausible-sounding
// text from silence + noise, which is the #1 source of "random input".
const MIN_AUDIO_BYTES = 4_000;       // ~roughly 0.4-1 sec of opus@32k
const MIN_TRANSCRIPT_CHARS = 4;
const MAX_TRANSCRIPT_CHARS = 5_000;

export const voiceRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
  await server.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  // POST /api/voice/extract-walkin
  // Accepts an audio file → returns transcript + structured walk-in fields.
  server.post('/extract-walkin', async (request, reply) => {
    try {
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No audio uploaded' });

      const chunks: Buffer[] = [];
      for await (const chunk of file.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        return reply.status(400).send({
          error: 'No audio recorded. Please tap the mic and speak.',
          code: 'EMPTY_AUDIO',
        });
      }

      if (buffer.length < MIN_AUDIO_BYTES) {
        return reply.status(400).send({
          error: 'Recording too short. Please speak for at least 2 seconds.',
          code: 'TOO_SHORT',
        });
      }

      // Use NEUTRAL prompt — never car-biased — so Whisper doesn't hallucinate
      // "Mahindra Scorpio" when the rep said something else.
      const { text: transcript, provider } = await transcribeVoiceNote(buffer, {
        prompt: NEUTRAL_PROMPT,
      });

      const cleaned = (transcript || '').trim();

      if (cleaned.length < MIN_TRANSCRIPT_CHARS) {
        return reply.status(200).send({
          transcript: cleaned,
          provider,
          extracted: { items_mentioned: [], notes: '' },
          quality: 'too_short',
        });
      }

      if (cleaned.length > MAX_TRANSCRIPT_CHARS) {
        return reply.status(400).send({
          error: 'Recording too long. Please keep it under 30 seconds.',
          code: 'TOO_LONG',
        });
      }

      const extracted = await extractWalkInFromTranscript(cleaned);

      // Quality flag for the UI: tells the modal whether to show
      // confidence buttons (Looks Good / Try Again) vs auto-fill silently.
      const hasUsefulData = !!(
        extracted.customer_name ||
        extracted.customer_phone ||
        extracted.items_mentioned.length > 0 ||
        extracted.outcome ||
        extracted.notes
      );

      return reply.send({
        transcript: cleaned,
        provider,
        extracted,
        quality: hasUsefulData ? 'good' : 'unclear',
      });
    } catch (err: any) {
      console.error('POST /voice/extract-walkin error:', err);
      return reply.status(500).send({
        error: err.message || 'Voice processing failed. Please try again.',
        code: 'INTERNAL',
      });
    }
  });
};
