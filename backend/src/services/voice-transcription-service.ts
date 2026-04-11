import OpenAI from 'openai';
import { config } from '../config/environment.js';

/**
 * Transcribe a WhatsApp voice note (OGG/Opus) using Groq Whisper (primary)
 * with OpenAI Whisper as fallback.
 */
export async function transcribeVoiceNote(
  audioBuffer: Buffer
): Promise<{ text: string; provider: string }> {
  const file = new File([new Uint8Array(audioBuffer)], 'voice.ogg', { type: 'audio/ogg' });

  // Try Groq first (free, fast)
  if (config.GROQ_API_KEY) {
    try {
      const groq = new OpenAI({
        apiKey: config.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        timeout: 15_000,
      });

      const text = await groq.audio.transcriptions.create({
        file,
        model: 'whisper-large-v3',
        response_format: 'text',
      }) as unknown as string;

      console.log(`Transcription success [groq]: ${text.length} chars`);
      return { text, provider: 'groq' };
    } catch (err) {
      console.warn('Groq transcription failed, trying OpenAI fallback:', (err as Error).message);
    }
  }

  // Fallback to OpenAI
  if (config.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
        timeout: 15_000,
      });

      const text = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'text',
      }) as unknown as string;

      console.log(`Transcription success [openai]: ${text.length} chars`);
      return { text, provider: 'openai' };
    } catch (err) {
      console.error('OpenAI transcription also failed:', (err as Error).message);
      throw new Error(`Transcription failed (OpenAI): ${(err as Error).message}`);
    }
  }

  throw new Error('Transcription failed: no API keys configured (GROQ_API_KEY / OPENAI_API_KEY)');
}
