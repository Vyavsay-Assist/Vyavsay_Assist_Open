import OpenAI from 'openai';
import { config } from '../config/environment.js';

/**
 * Prompt hint for Whisper — helps it recognize Indian car brand names,
 * Hinglish words, and automotive vocabulary it might otherwise mishear.
 */
/**
 * Prompt hint for Whisper — vocabulary guidance for Indian automotive context.
 * Includes car brand names, Hinglish, Hindi, and Marathi terms.
 * This dramatically improves accuracy for domain-specific words.
 */
const WHISPER_PROMPT = [
  // Indian car brands & models Whisper commonly mishears
  'Scorpio, Thar, XUV700, XUV300, Bolero, Mahindra, Nexon, Harrier, Safari, Punch, Tata,',
  'Swift, Dzire, Baleno, Brezza, Ertiga, Vitara, WagonR, Alto, Maruti Suzuki,',
  'Creta, Venue, i20, i10, Verna, Tucson, Hyundai, Seltos, Sonet, Carens, Kia,',
  'City, Amaze, Elevate, Honda, Innova, Fortuner, Glanza, Urban Cruiser, Toyota,',
  'Hector, Astor, MG, Kushaq, Slavia, Skoda, Taigun, Virtus, Volkswagen,',
  // Hinglish automotive terms
  'gaadi, car, kitna, price, lakh, EMI, petrol, diesel, CNG, automatic, manual,',
  'test drive, showroom, kilometre, mileage, RC, insurance, photos, bhejo, dikhao,',
  'available, stock, finance, booking, token, delivery,',
  // Hindi terms
  'kya hai, kitne ka hai, dikhao, bhejo, chahiye, available hai, konsi, kaunsi,',
  'haan, nahi, theek hai, achha, sahi, pehle, baad mein, abhi, kal, aaj,',
  // Marathi terms
  'kay aahe, kimat, dakhva, pathva, aahe ka, nahi, hoy, bara, pahije,',
  'gaadi aahe ka, photos pathva, mahag, swasta, kitla, kiti,',
].join(' ');

/**
 * Neutral prompt for general-purpose voice capture (no domain bias).
 * Used by walk-in capture and other multi-vertical flows where car-specific
 * vocabulary would cause Whisper to hallucinate car words.
 */
const NEUTRAL_PROMPT = 'A salesperson in an Indian retail store dictating a customer note. May mix English, Hindi, Hinglish, Marathi.';

export interface TranscribeOptions {
  /** Override the Whisper prompt. Pass empty string to disable prompting. */
  prompt?: string;
}

/**
 * Transcribe an audio buffer using Groq Whisper (primary)
 * with OpenAI Whisper as fallback.
 *
 * Default prompt is car-domain-biased (for the WhatsApp flow). Override
 * via `options.prompt` for generic / multi-vertical use cases.
 */
export async function transcribeVoiceNote(
  audioBuffer: Buffer,
  options: TranscribeOptions = {},
): Promise<{ text: string; provider: string }> {
  const file = new File([new Uint8Array(audioBuffer)], 'voice.ogg', { type: 'audio/ogg' });
  const prompt = options.prompt !== undefined ? options.prompt : WHISPER_PROMPT;

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
        ...(prompt ? { prompt } : {}),
        temperature: 0,
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
        ...(prompt ? { prompt } : {}),
        temperature: 0,
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

export { NEUTRAL_PROMPT };
