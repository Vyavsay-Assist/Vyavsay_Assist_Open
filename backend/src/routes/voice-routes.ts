import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { transcribeVoiceNote } from '../services/voice-transcription-service.js';
import { extractWalkInFromTranscript } from '../services/ai-router.js';

export const voiceRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
  await server.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — voice notes are tiny
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
        return reply.status(400).send({ error: 'Empty audio file' });
      }

      const { text: transcript, provider } = await transcribeVoiceNote(buffer);
      if (!transcript || transcript.trim().length < 3) {
        return reply.status(400).send({ error: 'Could not understand audio. Please try again.' });
      }

      const extracted = await extractWalkInFromTranscript(transcript);

      return reply.send({ transcript, provider, extracted });
    } catch (err: any) {
      console.error('POST /voice/extract-walkin error:', err);
      return reply.status(500).send({ error: err.message || 'Voice extraction failed' });
    }
  });
};
