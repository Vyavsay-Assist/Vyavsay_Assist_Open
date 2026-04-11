import { proto, downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';
import { rateLimiter } from '../utils/rate-limiter.js';
import { inboundRateLimiter } from '../utils/inbound-rate-limiter.js';
import { sessionManager } from './session-manager.js';
import { pipelineService } from './pipeline-service.js';
import { transcribeVoiceNote } from './voice-transcription-service.js';
import { generateVoiceReply, isVoiceReplyEnabled } from './tts-service.js';

/**
 * BaileysAdapter — bridges Baileys message events to the AI pipeline.
 * Handles message parsing, filtering, and rate-limited sending.
 */
export class BaileysAdapter {
  constructor() {
    this.setupMessageListener();
  }

  /** Listen for messages from all sessions */
  private setupMessageListener(): void {
    sessionManager.on('messages.upsert', async (userId: string, upsert: any) => {
      const { messages, type } = upsert;

      // Only process new messages (not history sync)
      if (type !== 'notify') return;

      for (const msg of messages) {
        await this.handleMessage(userId, msg);
      }
    });
  }

  /** Process a single incoming message */
  private async handleMessage(userId: string, msg: proto.IWebMessageInfo): Promise<void> {
    try {
      // Skip outgoing messages (fromMe filter — learned from n8n workflow)
      if (msg.key?.fromMe) return;

      const jid = msg.key?.remoteJid;
      if (!jid) return;

      // Skip group messages — only handle 1-on-1 chats
      if (jid.includes('@g.us')) return;

      // Skip status broadcasts
      if (jid === 'status@broadcast') return;

      // Inbound rate limiting — prevent message flood abuse
      if (!inboundRateLimiter.shouldProcess(jid)) {
        console.warn(`⚠️ [RateLimit] Throttled ${jid} — too many messages`);
        return;
      }

      const customerPhone = jid.split('@')[0];
      const customerName = msg.pushName || customerPhone;

      // ── Handle Voice Notes ──
      const audioMsg = msg.message?.audioMessage;
      if (audioMsg?.ptt) {
        console.log(`\n🎤 [${userId.slice(0, 8)}] ${customerName}: [Voice Note ${audioMsg.seconds || '?'}s]`);
        try {
          const audioBuffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {});
          const { text, provider } = await transcribeVoiceNote(audioBuffer as Buffer);

          if (!text || text.trim().length === 0) {
            console.warn(`⚠️ Voice note transcription was empty — skipping`);
            return;
          }

          console.log(`📝 [Transcribed via ${provider}]: "${text.slice(0, 80)}..."`);

          // Process transcribed text through the normal AI pipeline
          const result = await pipelineService.processIncomingMessage(
            userId, jid, customerName, customerPhone, text,
            { type: 'voice_note', durationSecs: audioMsg.seconds || 0 }
          );

          // If voice reply is enabled and the pipeline sent a text reply, also send voice version
          if (result.autoReplied && result.replyText && isVoiceReplyEnabled()) {
            try {
              const voiceBuffer = await generateVoiceReply(result.replyText);
              if (voiceBuffer) {
                await this.sendVoiceNote(userId, jid, voiceBuffer);
                console.log(`🔊 [${userId.slice(0, 8)}] Voice reply sent to ${customerPhone}`);
              }
            } catch (ttsErr: any) {
              console.warn(`⚠️ Voice reply generation failed (text reply already sent): ${ttsErr.message}`);
            }
          }
        } catch (err: any) {
          console.error(`❌ Voice note processing failed: ${err.message}`);
        }
        return;
      }

      // ── Handle Image Messages ──
      const imageMsg = msg.message?.imageMessage;
      if (imageMsg) {
        const caption = imageMsg.caption || '';
        console.log(`\n📷 [${userId.slice(0, 8)}] ${customerName}: [Image${caption ? ` "${caption}"` : ''}]`);
        try {
          const imageBuffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {});
          const base64 = (imageBuffer as Buffer).toString('base64');
          const mimetype = imageMsg.mimetype || 'image/jpeg';

          // Process through pipeline with image data
          await pipelineService.processIncomingMessage(
            userId, jid, customerName, customerPhone,
            caption || '[Customer sent an image]',
            { type: 'image', base64, mimetype }
          );
        } catch (err: any) {
          console.error(`❌ Image processing failed: ${err.message}`);
          // Fall back to processing just the caption if image download fails
          if (caption) {
            await pipelineService.processIncomingMessage(
              userId, jid, customerName, customerPhone, caption
            );
          }
        }
        return;
      }

      // ── Handle Text Messages (existing flow) ──
      const parsed = this.parseMessage(msg);
      if (!parsed) return;

      console.log(`\n📩 [${userId.slice(0, 8)}] ${parsed.customerName}: "${parsed.text}"`);

      // Forward to AI pipeline
      await pipelineService.processIncomingMessage(
        userId,
        parsed.jid,
        parsed.customerName,
        parsed.customerPhone,
        parsed.text
      );
    } catch (err: any) {
      console.error(`❌ Message handling error: ${err.message}`);
    }
  }

  /** Extract useful data from Baileys message proto */
  parseMessage(msg: proto.IWebMessageInfo): {
    jid: string;
    customerName: string;
    customerPhone: string;
    text: string;
    timestamp: number;
  } | null {
    const jid = msg.key?.remoteJid;
    if (!jid) return null;

    // Extract text from various message types
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      null;

    if (!text) return null;

    // Extract phone number from JID (e.g., 919876543210@s.whatsapp.net → 919876543210)
    const customerPhone = jid.split('@')[0];

    // pushName is the contact's display name in WhatsApp
    const customerName = msg.pushName || customerPhone;

    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

    return { jid, customerName, customerPhone, text, timestamp };
  }

  /** Send a text message via Baileys (rate-limited, with typing indicator) */
  async sendMessage(userId: string, jid: string, text: string): Promise<boolean> {
    try {
      const socket = sessionManager.getSocket(userId);
      if (!socket) {
        console.error(`❌ No active socket for user ${userId.slice(0, 8)}`);
        return false;
      }

      // Wait for rate limit slot
      await rateLimiter.waitForSlot(userId);

      // Simulate typing — makes the bot feel human
      try {
        await socket.sendPresenceUpdate('composing', jid);
        const typingDelay = Math.min(3000, Math.max(500, text.length * 50));
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        await socket.sendPresenceUpdate('paused', jid);
      } catch {
        // Presence update is best-effort — don't fail the send
      }

      await socket.sendMessage(jid, { text });
      console.log(`✅ [${userId.slice(0, 8)}] Reply sent to ${jid.split('@')[0]}`);
      return true;
    } catch (err: any) {
      console.error(`❌ Send failed: ${err.message}`);
      return false;
    }
  }

  /** Send a voice note (PTT) via Baileys (rate-limited) */
  async sendVoiceNote(userId: string, jid: string, audioBuffer: Buffer): Promise<boolean> {
    try {
      const socket = sessionManager.getSocket(userId);
      if (!socket) {
        console.error(`❌ No active socket for user ${userId.slice(0, 8)}`);
        return false;
      }

      await rateLimiter.waitForSlot(userId);

      // Show "recording audio" presence
      try {
        await socket.sendPresenceUpdate('recording' as any, jid);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch {
        // Presence update is best-effort
      }

      await socket.sendMessage(jid, {
        audio: audioBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      });
      console.log(`🔊 [${userId.slice(0, 8)}] Voice note sent to ${jid.split('@')[0]}`);
      return true;
    } catch (err: any) {
      console.error(`❌ Voice note send failed: ${err.message}`);
      return false;
    }
  }

  /** Send an image with caption via Baileys (rate-limited) */
  async sendImage(userId: string, jid: string, imageUrl: string, caption?: string): Promise<boolean> {
    try {
      const socket = sessionManager.getSocket(userId);
      if (!socket) {
        console.error(`❌ No active socket for user ${userId.slice(0, 8)}`);
        return false;
      }

      await rateLimiter.waitForSlot(userId);

      await socket.sendMessage(jid, {
        image: { url: imageUrl },
        caption: caption || '',
      });
      console.log(`🖼️ [${userId.slice(0, 8)}] Image sent to ${jid.split('@')[0]}`);
      return true;
    } catch (err: any) {
      console.error(`❌ Image send failed: ${err.message}`);
      return false;
    }
  }
}

// Singleton export
export const baileysAdapter = new BaileysAdapter();
