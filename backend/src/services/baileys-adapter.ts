import { proto } from '@whiskeysockets/baileys';
import { rateLimiter } from '../utils/rate-limiter.js';
import { inboundRateLimiter } from '../utils/inbound-rate-limiter.js';
import { sessionManager } from './session-manager.js';
import { pipelineService } from './pipeline-service.js';

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

      // Skip non-text messages for now
      const parsed = this.parseMessage(msg);
      if (!parsed) return;

      // Skip group messages — only handle 1-on-1 chats
      if (parsed.jid.includes('@g.us')) return;

      // Skip status broadcasts
      if (parsed.jid === 'status@broadcast') return;

      // Inbound rate limiting — prevent message flood abuse
      if (!inboundRateLimiter.shouldProcess(parsed.jid)) {
        console.warn(`⚠️ [RateLimit] Throttled ${parsed.jid} — too many messages`);
        return;
      }

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
