import { EventEmitter } from 'events';
import baileys, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/environment.js';

// Handle ESM/CJS default export interop
const makeWASocket = typeof baileys === 'function' ? baileys : (baileys as any).default;

export interface SessionInfo {
  userId: string;
  socket: WASocket | null;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
  phone?: string;
  connectedAt?: Date;
  reconnectAttempts: number;
  qr?: string;
  wasEverConnected?: boolean;
}

/**
 * SessionManager — manages multiple Baileys WhatsApp connections.
 * Each business client gets their own isolated session.
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, SessionInfo>();
  private readonly maxReconnectAttempts = 15;
  private readonly logger = pino({ level: 'silent' });
  private readonly supabase: SupabaseClient | null;

  constructor() {
    super();
    this.ensureAuthDir();
    this.supabase = config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
      : null;
  }

  /** Sync the wb_sessions table to match live connection state. Best-effort: errors are logged but never thrown. */
  private async syncSessionRow(
    userId: string,
    status: 'connected' | 'disconnected',
    phone?: string,
  ): Promise<void> {
    if (!this.supabase) return;
    try {
      const { error: delErr } = await this.supabase
        .from('wb_sessions')
        .delete()
        .eq('user_id', userId);
      if (delErr) {
        console.error(`⚠️  [${userId.slice(0, 8)}] wb_sessions delete failed: ${delErr.message}`);
        return;
      }
      if (status === 'disconnected') return;

      const { error: insErr } = await this.supabase.from('wb_sessions').insert({
        user_id: userId,
        status,
        phone_number: phone || null,
        connected_at: new Date().toISOString(),
      });
      if (insErr) {
        console.error(`⚠️  [${userId.slice(0, 8)}] wb_sessions insert failed: ${insErr.message}`);
      }
    } catch (err: any) {
      console.error(`⚠️  [${userId.slice(0, 8)}] wb_sessions sync error: ${err?.message || err}`);
    }
  }

  private ensureAuthDir(): void {
    const dir = config.AUTH_SESSIONS_DIR;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getAuthDir(userId: string): string {
    return path.join(config.AUTH_SESSIONS_DIR, userId);
  }

  /** Create a new Baileys session for a user */
  async createSession(userId: string): Promise<SessionInfo> {
    const existing = this.sessions.get(userId);
    if (existing?.status === 'connected') {
      console.log(`✅ [${userId.slice(0, 8)}] Already connected, skipping`);
      return existing;
    }

    // Close any existing socket
    if (existing?.socket) {
      try {
        existing.socket.end(undefined);
      } catch (err: any) {
        console.error(`⚠️  [${userId.slice(0, 8)}] socket.end() failed: ${err?.message || err}`);
      }
    }

    const sessionInfo: SessionInfo = {
      userId,
      socket: null,
      status: 'connecting',
      reconnectAttempts: 0,
    };
    this.sessions.set(userId, sessionInfo);

    await this.connectSocket(userId);
    return this.sessions.get(userId)!;
  }

  /** Core socket connection logic */
  private async connectSocket(userId: string): Promise<void> {
    const authDir = this.getAuthDir(userId);
    console.log(`🔑 [${userId.slice(0, 8)}] Loading auth from: ${authDir}`);

    try {
      // Fetch the latest WhatsApp Web version to prevent 405 errors
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`📡 [${userId.slice(0, 8)}] WA version: [${version}] isLatest: ${isLatest}`);

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      console.log(`📡 [${userId.slice(0, 8)}] Auth loaded. Creating socket...`);

      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        logger: this.logger,
        browser: ['Vyavsay', 'Chrome', '22.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      const session = this.sessions.get(userId)!;
      session.socket = socket;

      socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
        this.handleConnectionUpdate(userId, update);
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('messages.upsert', (upsert: any) => {
        this.emit('messages.upsert', userId, upsert);
      });

      console.log(`✅ [${userId.slice(0, 8)}] Socket created, waiting for connection events...`);
    } catch (err: any) {
      console.error(`❌ [${userId.slice(0, 8)}] Socket creation FAILED:`, err.message);
      const session = this.sessions.get(userId);
      if (session) session.status = 'disconnected';
    }
  }

  /** Handle connection state changes */
  private async handleConnectionUpdate(userId: string, update: Partial<ConnectionState>): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) return;

    const { connection, lastDisconnect, qr } = update;

    console.log(`🔔 [${userId.slice(0, 8)}] Connection update:`, JSON.stringify({
      connection: connection || undefined,
      qr: qr ? `[${qr.length} chars]` : undefined,
      lastDisconnect: lastDisconnect ? (lastDisconnect.error as Boom)?.output?.statusCode : undefined,
    }));

    if (qr) {
      session.status = 'qr_pending';
      session.qr = qr;
      this.emit('qr', userId, qr);
      console.log(`📱 [${userId.slice(0, 8)}] QR code generated — waiting for scan`);
    }

    if (connection === 'open') {
      // Small delay to let Baileys stabilize the connection fully
      await new Promise(r => setTimeout(r, 1500));
      
      session.status = 'connected';
      session.connectedAt = new Date();
      session.reconnectAttempts = 0;
      session.qr = undefined;
      session.wasEverConnected = true;

      const phoneNumber = session.socket?.user?.id?.split(':')[0] || 'unknown';
      session.phone = phoneNumber;

      console.log(`✅ [${userId.slice(0, 8)}] WhatsApp connected — ${phoneNumber}`);
      this.emit('connected', userId, phoneNumber);

      // Reflect connected state in DB so dashboards/owner views stay accurate
      this.syncSessionRow(userId, 'connected', phoneNumber).catch(() => {});
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const restartRequired = statusCode === DisconnectReason.restartRequired;

      console.log(`❌ [${userId.slice(0, 8)}] Disconnected — code: ${statusCode}, loggedOut: ${loggedOut}, restart: ${restartRequired}`);

      if (loggedOut) {
        session.status = 'disconnected';
        this.cleanAuthDir(userId);
        session.reconnectAttempts = 0;
        session.wasEverConnected = false;
        this.emit('logged_out', userId);
        this.syncSessionRow(userId, 'disconnected').catch(() => {});
      } else if (restartRequired) {
        // WhatsApp wants us to reconnect immediately — don't count as a failure
        console.log(`🔄 [${userId.slice(0, 8)}] Restart required — reconnecting immediately`);
        session.status = 'connecting';
        setTimeout(() => this.connectSocket(userId), 1000);
      } else if (session.reconnectAttempts < this.maxReconnectAttempts) {
        session.status = 'connecting';
        session.reconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(1.5, session.reconnectAttempts - 1), 30000);
        console.log(`🔄 [${userId.slice(0, 8)}] Reconnecting in ${delay / 1000}s (attempt ${session.reconnectAttempts})`);
        setTimeout(() => this.connectSocket(userId), delay);
      } else {
        session.status = 'disconnected';
        console.log(`⛔ [${userId.slice(0, 8)}] Max reconnect attempts — needs re-scan`);
        this.emit('needs_rescan', userId);
        this.syncSessionRow(userId, 'disconnected').catch(() => {});
      }
    }
  }

  getSession(userId: string): SessionInfo | undefined {
    return this.sessions.get(userId);
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  getSocket(userId: string): WASocket | null {
    return this.sessions.get(userId)?.socket || null;
  }

  async destroySession(userId: string, removeAuth = false): Promise<void> {
    const session = this.sessions.get(userId);
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch (logoutErr: any) {
        console.error(`⚠️  [${userId.slice(0, 8)}] socket.logout() failed: ${logoutErr?.message || logoutErr}`);
        try {
          session.socket.end(undefined);
        } catch (endErr: any) {
          console.error(`⚠️  [${userId.slice(0, 8)}] socket.end() failed: ${endErr?.message || endErr}`);
        }
      }
    }
    this.sessions.delete(userId);
    if (removeAuth) this.cleanAuthDir(userId);
    // Await DB sync so HTTP callers observe the final state on response
    await this.syncSessionRow(userId, 'disconnected');
    console.log(`🗑️ [${userId.slice(0, 8)}] Session destroyed`);
  }

  async restartSession(userId: string): Promise<SessionInfo> {
    const session = this.sessions.get(userId);
    if (session?.socket) {
      try {
        session.socket.end(undefined);
      } catch (err: any) {
        console.error(`⚠️  [${userId.slice(0, 8)}] socket.end() failed: ${err?.message || err}`);
      }
    }
    if (session) session.reconnectAttempts = 0;
    await this.connectSocket(userId);
    return this.sessions.get(userId)!;
  }

  /** Restore sessions on startup — fire and forget, don't crash server */
  async restoreAllSessions(): Promise<void> {
    const authDir = config.AUTH_SESSIONS_DIR;
    if (!fs.existsSync(authDir)) return;

    const dirs = fs.readdirSync(authDir).filter(d =>
      fs.statSync(path.join(authDir, d)).isDirectory()
    );

    console.log(`\n🔄 Restoring ${dirs.length} saved session(s)...`);

    for (const userId of dirs) {
      const credsPath = path.join(authDir, userId, 'creds.json');
      if (fs.existsSync(credsPath)) {
        try {
          await this.createSession(userId);
          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          console.error(`❌ Failed to restore ${userId.slice(0, 8)}: ${err.message}`);
        }
      }
    }
  }

  private cleanAuthDir(userId: string): void {
    const dir = this.getAuthDir(userId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export const sessionManager = new SessionManager();
