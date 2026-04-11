# Hackathon Feature Research: Voice Notes + Car Image Recognition

> **Generated**: 2026-04-11 | **Purpose**: Feasibility analysis & implementation plan for two new features

---

## Executive Summary

Both features are **fully implementable** with minimal new dependencies. Here's the quick verdict:

| Feature | Feasibility | New Dependencies | Estimated Time | Cost |
|---------|------------|-----------------|---------------|------|
| **Voice Note → Text → AI Reply (text)** | Easy | `groq-sdk` or none (reuse `openai`) | 3-4 hours | Free (Groq) |
| **Voice Note → Text → AI Reply (voice)** | Easy | None (OpenAI TTS, reuse `openai`) | +2 hours | ~$0.003/reply |
| **Car Image → Identify → Inventory Match** | Easy | None (GPT-4o Vision, existing SDK) | 2-3 hours | Free (GitHub Models) |

**Total estimated implementation time: 6-8 hours**
**New npm packages needed: 0** (everything works with the existing `openai` package)

---

## FEATURE 1: Voice Note Processing

### The Pipeline

```
Customer sends voice note on WhatsApp
        │
        ▼
Baileys receives audioMessage (ptt: true)
        │
        ▼
downloadMediaMessage() → OGG/Opus Buffer
        │
        ▼
Groq Whisper API (whisper-large-v3) → Transcribed Text
        │
        ▼
Existing AI Pipeline (analyzeMessage + generateReply)
        │
        ▼
Option A: Send text reply (easy, immediate)
Option B: OpenAI TTS → OGG/Opus → Send voice note reply (2 extra steps)
```

---

### Step 1: Receive & Download Voice Notes (Baileys)

WhatsApp voice notes arrive as `audioMessage` with `ptt: true` in OGG/Opus format.

**Detection:**
```typescript
const audioMsg = msg.message?.audioMessage;
const isVoiceNote = audioMsg?.ptt === true;
const durationSecs = audioMsg?.seconds;
const mimetype = audioMsg?.mimetype; // "audio/ogg; codecs=opus"
```

**Download:**
```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
  logger: console as any,
  reuploadRequest: socket.updateMediaMessage
});
// buffer = Node.js Buffer containing raw OGG/Opus bytes
```

**Current code gap**: `baileys-adapter.ts` line 86 returns `null` for non-text messages, so voice notes are silently dropped today.

---

### Step 2: Speech-to-Text (Transcription)

#### Recommended: Groq Whisper (FREE, fastest, best quality)

| Attribute | Details |
|-----------|---------|
| **Model** | whisper-large-v3 (best Whisper model) |
| **Cost** | FREE tier with rate limits (~20 req/min) |
| **Latency** | ~0.3-0.8 seconds for a 30s clip |
| **Hindi/Hinglish** | Excellent - auto-detects language |
| **Audio format** | OGG/Opus supported natively - NO conversion needed |
| **Integration** | Uses existing `openai` npm package with different baseURL |

```typescript
import OpenAI from 'openai';

const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: config.GROQ_API_KEY,
});

async function transcribeVoiceNote(audioBuffer: Buffer): Promise<string> {
  const file = new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' });
  const result = await groq.audio.transcriptions.create({
    model: 'whisper-large-v3',
    file,
    response_format: 'text',
  });
  return String(result);
}
```

**New env var needed**: `GROQ_API_KEY` (get free at console.groq.com)

#### All STT Options Compared

| Rank | Provider | Cost | Hindi/Hinglish | Latency | Integration |
|------|----------|------|---------------|---------|-------------|
| 1 | **Groq Whisper** | Free | Excellent | ~0.5s | Reuse `openai` pkg |
| 2 | **OpenAI Whisper** | $0.006/min | Excellent | ~2s | Reuse `openai` pkg |
| 3 | **Deepgram** | Free $200 credit | Decent | ~0.8s | New SDK |
| 4 | **Google Cloud STT** | 60 min free | OK (no Hinglish) | ~3s | New SDK + service account |
| 5 | **Azure Speech** | 5 hrs free | OK (no Hinglish) | ~3s | Heavy SDK (~50MB) |
| 6 | ~~GitHub Models~~ | N/A | N/A | N/A | Whisper NOT available |
| 7 | ~~AssemblyAI~~ | N/A | No Hindi | N/A | Eliminated |

---

### Step 3a: Reply with Text (Easy path)

After transcription, feed the text into the **existing** `pipelineService.processIncomingMessage()`. The AI pipeline handles everything else (intent detection, reply generation, auto-send).

```typescript
// In baileys-adapter.ts handleMessage():
if (audioMsg?.ptt) {
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const transcribedText = await transcribeVoiceNote(buffer);
  
  // Feed into existing pipeline as if customer typed this text
  await pipelineService.processIncomingMessage(
    userId, jid, customerName, customerPhone, transcribedText
  );
}
```

**This is the minimum viable feature.** The customer sends a voice note, we transcribe it, and reply with text. Done in ~3-4 hours.

---

### Step 3b: Reply with Voice Note (Full experience)

Generate a voice reply using TTS, then send it back as a WhatsApp voice note.

#### Recommended: OpenAI TTS (native Opus output, NO ffmpeg needed)

```typescript
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

async function generateVoiceReply(text: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',        // natural-sounding, good for Hindi too
    input: text,
    response_format: 'opus',  // Native OGG/Opus - WhatsApp compatible!
  });
  return Buffer.from(await response.arrayBuffer());
}
```

#### Send via Baileys as voice note:

```typescript
// Add to baileys-adapter.ts:
async sendVoiceNote(userId: string, jid: string, audioBuffer: Buffer): Promise<boolean> {
  const socket = sessionManager.getSocket(userId);
  if (!socket) return false;
  await rateLimiter.waitForSlot(userId);
  
  await socket.sendPresenceUpdate('recording', jid);  // Shows "recording audio..."
  
  await socket.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,  // This makes it a voice note (green play button)
  });
  return true;
}
```

#### All TTS Options Compared

| Rank | Provider | Cost | Hindi | Opus Output | Latency |
|------|----------|------|-------|-------------|---------|
| 1 | **OpenAI TTS** | $15/1M chars | Yes | Native | ~0.5-1s |
| 2 | **Google Cloud TTS** | Free 1-4M chars/mo | Best Hindi | Native | ~1s |
| 3 | **Azure TTS** | Free 500K chars/mo | Great Hindi | Native | ~1s |
| 4 | **Edge TTS** | Free (unofficial) | Yes | Needs ffmpeg | ~1-3s |
| 5 | **ElevenLabs** | $5/mo 30K chars | Yes | Needs ffmpeg | ~1-3s |

**OpenAI TTS wins** because `response_format: 'opus'` outputs WhatsApp-compatible audio directly. No ffmpeg, no audio conversion.

**New env var needed**: `OPENAI_API_KEY` (separate from GitHub PAT - the existing endpoint doesn't support TTS)

---

## FEATURE 2: Car Image Recognition + Inventory Matching

### The Pipeline

```
Customer sends car photo on WhatsApp
        │
        ▼
Baileys receives imageMessage
        │
        ▼
downloadMediaMessage() → JPEG Buffer → Base64
        │
        ▼
GPT-4o Vision: "Identify this car" → {brand, model, year, color, body_type}
        │
        ▼
Existing hybridSearch() → Find matching inventory items
        │
        ▼
Reply: "Ye Tata Nexon 2022 lagti hai! Hamare paas 2 options hain..."
```

---

### Step 1: Receive & Download Images (Baileys)

WhatsApp images arrive as `imageMessage` in JPEG format.

**Detection & Download:**
```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const imageMsg = msg.message?.imageMessage;
if (imageMsg) {
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const base64 = buffer.toString('base64');
  const mimetype = imageMsg.mimetype || 'image/jpeg';
  const caption = imageMsg.caption || '';
}
```

---

### Step 2: Car Identification (GPT-4o Vision)

**Uses existing infrastructure - ZERO new dependencies.**

The project already has:
- `openai` npm package v6.31.0
- Endpoint: `https://models.inference.ai.azure.com`
- Auth: `GITHUB_PAT`

GPT-4o Vision uses the same SDK, same endpoint. Just change the message format:

```typescript
// Add to ai-router.ts:
async function identifyCarFromImage(base64Image: string, mimetype: string): Promise<CarIdentification> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',  // Use full gpt-4o, not mini, for better vision
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Identify this car. This is from the Indian market. Common brands: Maruti Suzuki, Tata, Hyundai, Mahindra, Kia, Toyota, Honda, MG, Skoda, Volkswagen.

Return ONLY JSON:
{
  "brand": "...",
  "model": "...",
  "year_estimate": "...",
  "color": "...",
  "body_type": "SUV|Sedan|Hatchback|MPV|Pickup",
  "confidence": "high|medium|low"
}`
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimetype};base64,${base64Image}`,
            detail: 'low'  // saves tokens, sufficient for car identification
          }
        }
      ]
    }],
    max_tokens: 200,
    temperature: 0.2,
  });
  
  return JSON.parse(response.choices[0].message.content || '{}');
}
```

**Rate limits (GitHub Models free tier):**
- 50 requests/day for GPT-4o (enough for hackathon demo)
- 10 requests/minute

**Fallback option**: Google Gemini 2.0 Flash (1500 free requests/day) if rate limits are hit.

---

### Step 3: Match Against Inventory (Existing Code!)

This is the best part - **zero new code needed** for the matching. Your existing `catalog-service.ts` already has `hybridSearch()` that does BOTH:

1. **Structured search**: Filter by `item_name` (ILIKE), `category`, `attributes` (brand, color, year)
2. **Semantic vector search**: Embed query text → cosine similarity against catalog embeddings

```typescript
// After GPT-4o identifies the car:
const identified = await identifyCarFromImage(base64, mimetype);

// Build search query from identified attributes
const queryText = `${identified.brand} ${identified.model} ${identified.year_estimate} ${identified.color} ${identified.body_type}`;

// Use EXISTING hybrid search
const matches = await catalogService.hybridSearch(userId, queryText, {
  product_name: `${identified.brand} ${identified.model}`,
  category: identified.body_type,
  attributes: {
    brand: identified.brand,
    color: identified.color,
  }
});

// matches = array of matching inventory items with similarity scores
```

---

### Step 4: Reply to Customer

If matches found, reply in the used-cars domain style:

```
"Ye Tata Nexon 2022 Blue lagti hai! 🚗

Hamare paas similar options hain:
1. Tata Nexon XZ 2022 Blue - ₹9.5 Lakh (45,000 km)
2. Tata Nexon XZA 2021 White - ₹8.8 Lakh (38,000 km)

Koi particular car dekhna chahenge? Photos bhej sakta hoon! 📸"
```

If no matches:
```
"Ye Tata Nexon 2022 lagti hai. Abhi hamare paas ye model available nahi hai, lekin similar SUVs hain. Dikhau?"
```

---

## Implementation Plan (Hackathon Priority Order)

### Phase 1: Voice Note → Text Reply (3-4 hours) - HIGHEST IMPACT

| Step | Task | Time |
|------|------|------|
| 1 | Add `GROQ_API_KEY` to env config | 10 min |
| 2 | Create `voice-transcription-service.ts` with Groq Whisper | 30 min |
| 3 | Modify `baileys-adapter.ts` to detect & download voice notes | 45 min |
| 4 | Extend `pipeline-service.ts` to accept voice transcriptions | 30 min |
| 5 | Store voice note metadata in `wb_messages` (sender type: 'customer_voice') | 20 min |
| 6 | Test end-to-end with real WhatsApp voice notes | 45 min |

### Phase 2: Car Image Recognition (2-3 hours) - HIGHEST WOW FACTOR

| Step | Task | Time |
|------|------|------|
| 1 | Add `identifyCarFromImage()` to `ai-router.ts` | 30 min |
| 2 | Modify `baileys-adapter.ts` to detect & download images | 30 min |
| 3 | Extend `pipeline-service.ts` to handle image messages | 45 min |
| 4 | Wire up inventory matching using existing `hybridSearch()` | 30 min |
| 5 | Add car-specific reply templates to used-cars domain | 20 min |
| 6 | Test with real car photos | 30 min |

### Phase 3: Voice Reply (Optional, +2 hours) - EXTRA POLISH

| Step | Task | Time |
|------|------|------|
| 1 | Add `OPENAI_API_KEY` to env config | 10 min |
| 2 | Create `tts-service.ts` with OpenAI TTS (opus format) | 30 min |
| 3 | Add `sendVoiceNote()` to `baileys-adapter.ts` | 20 min |
| 4 | Add logic in pipeline to choose text vs voice reply | 30 min |
| 5 | Test voice reply end-to-end | 30 min |

---

## Environment Variables Needed

```env
# Voice Transcription (Groq - FREE)
GROQ_API_KEY=gsk_xxxxx          # Get at console.groq.com

# Voice Reply (OpenAI TTS - optional, ~$0.003/reply)
OPENAI_API_KEY=sk-xxxxx         # Only needed for Phase 3

# Car Image Recognition - NO NEW KEYS NEEDED
# Uses existing GITHUB_PAT + GPT-4o Vision
```

---

## NPM Packages Needed

**None!** Everything works with the existing `openai` npm package:
- Groq Whisper: `new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: GROQ_API_KEY })`
- OpenAI TTS: `new OpenAI({ apiKey: OPENAI_API_KEY })`
- GPT-4o Vision: Uses existing OpenAI client with image content blocks

---

## Files to Modify/Create

### New Files
| File | Purpose |
|------|---------|
| `backend/src/services/voice-transcription-service.ts` | Groq Whisper transcription |
| `backend/src/services/tts-service.ts` | OpenAI TTS voice generation (Phase 3) |

### Modified Files
| File | Changes |
|------|---------|
| `backend/src/services/baileys-adapter.ts` | Add voice note + image detection, download, routing |
| `backend/src/services/pipeline-service.ts` | Extend to handle voice transcriptions + image data |
| `backend/src/services/ai-router.ts` | Add `identifyCarFromImage()` function |
| `backend/src/config/environment.ts` | Add GROQ_API_KEY, OPENAI_API_KEY |
| `backend/.env.example` | Document new env vars |
| `backend/src/domains/used-cars/index.ts` | Add image match reply templates |

---

## Reference Projects & Resources

### Open Source Repos
- [wassengerhq/whatsapp-chatgpt-bot](https://github.com/wassengerhq/whatsapp-chatgpt-bot) - Full multimodal WhatsApp bot (voice in/out + images)
- [paratustra/audio-transcription-bot](https://github.com/paratustra/audio-transcription-bot) - WhatsApp voice → Whisper transcription
- [lucaboy/whatsapp-audio-transcriber](https://github.com/lucaboy/whatsapp-audio-transcriber) - Baileys + whisper.cpp

### Key Baileys APIs
- `downloadMediaMessage(msg, 'buffer', {})` - Download any media
- `socket.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })` - Send voice note
- `getContentType(msg.message)` - Detect message type

### API Docs
- [Groq API](https://console.groq.com/docs/speech-text) - Free Whisper API
- [OpenAI TTS](https://platform.openai.com/docs/guides/text-to-speech) - Text-to-speech
- [OpenAI Vision](https://platform.openai.com/docs/guides/vision) - Image understanding
- [Baileys Wiki](https://baileys.wiki/) - Media download docs

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Groq rate limits (free tier) | Medium | Fallback to OpenAI Whisper ($0.006/min) |
| GPT-4o Vision 50 req/day limit | Medium | Use gpt-4o-mini for vision OR add Gemini Flash (1500/day free) |
| Voice note download fails (0-byte bug) | Low | Use `reuploadRequest: socket.updateMediaMessage` context param |
| Indian car misidentification | Low | Add India-specific brand hints in prompt |
| OGG/Opus format issues | Low | OpenAI TTS native opus output eliminates conversion |
| Hindi TTS quality | Low | OpenAI voices are decent; Google Cloud TTS has best Hindi if needed |

---

*Both features leverage the existing infrastructure heavily. The key insight is that GPT-4o Vision, Groq Whisper, and OpenAI TTS all use the same `openai` npm package with different base URLs/API keys. No new SDKs, no audio conversion libraries, no ffmpeg.*
