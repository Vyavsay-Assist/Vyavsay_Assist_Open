import OpenAI from 'openai';
import { config } from '../config/environment.js';

const openai = config.OPENAI_API_KEY
  ? new OpenAI({ apiKey: config.OPENAI_API_KEY })
  : null;

/**
 * Check whether voice reply generation is available.
 */
export function isVoiceReplyEnabled(): boolean {
  return !!config.OPENAI_API_KEY;
}

/**
 * Generate a voice note audio buffer from text using OpenAI TTS.
 * Returns OGG/Opus audio suitable for WhatsApp voice messages, or null if
 * the API key is not configured.
 */
export async function generateVoiceReply(text: string): Promise<Buffer | null> {
  if (!openai) {
    console.log('[TTS] OPENAI_API_KEY not configured, skipping voice reply');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await openai.audio.speech.create(
      {
        model: 'tts-1',
        voice: 'nova',
        input: text,
        response_format: 'opus',
      },
      { signal: controller.signal as any },
    );

    const buf = Buffer.from(await response.arrayBuffer());
    console.log(
      `[TTS] Generated voice reply — text length: ${text.length}, audio size: ${buf.length} bytes`,
    );
    return buf;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('[TTS] Request timed out after 10 seconds');
    } else {
      console.error('[TTS] Failed to generate voice reply:', err.message ?? err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
