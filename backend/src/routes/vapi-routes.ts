import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { VoiceService } from '../services/voice-service.js';
import { config } from '../config/environment.js';

export const vapiRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
  const voiceService = new VoiceService(server.supabase);

  const getPayloadMessage = (body: any) => body?.message || body;

  const verifyWebhookSecret = (request: any): boolean => {
    if (!config.VAPI_WEBHOOK_SECRET) return true;
    const provided = request.headers['x-vapi-secret'];
    return typeof provided === 'string' && provided === config.VAPI_WEBHOOK_SECRET;
  };

  /**
   * POST /api/vapi/webhook
   * Receives all Vapi server events.
   * This endpoint is called by Vapi directly — no JWT auth required.
   */
  server.post('/webhook', async (request, reply) => {
    if (!verifyWebhookSecret(request)) {
      server.log.warn('Rejected Vapi webhook due to invalid secret');
      return reply.status(401).send({ error: 'Unauthorized webhook' });
    }

    const message = getPayloadMessage(request.body as any);

    if (!message?.type) {
      return reply.status(400).send({ error: 'Invalid webhook payload' });
    }

    console.log(`📞 [Vapi] Event: ${message.type}`);

    try {
      switch (message.type) {
        case 'tool-calls': {
          const results = await voiceService.handleToolCalls(message);
          return reply.send({ results });
        }

        case 'status-update': {
          await voiceService.handleStatusUpdate(message);
          return reply.status(200).send();
        }

        case 'end-of-call-report': {
          await voiceService.handleEndOfCallReport(message);
          return reply.status(200).send();
        }

        case 'assistant-request': {
          const assistant = await voiceService.handleAssistantRequest(message);
          return reply.send(assistant);
        }

        case 'transcript': {
          const role = message.role || 'unknown';
          const text = message.transcript || '';
          if (message.transcriptType === 'final') {
            console.log(`  📝 [${role}]: ${text}`);
          }
          return reply.status(200).send();
        }

        case 'hang': {
          console.warn(`  ⚠️ [Vapi] Agent hung — no response for extended period`);
          return reply.status(200).send();
        }

        case 'speech-update': {
          // Informational — no action needed
          return reply.status(200).send();
        }

        case 'conversation-update': {
          // Informational — no action needed
          return reply.status(200).send();
        }

        default: {
          console.log(`  [Vapi] Unhandled event: ${message.type}`);
          return reply.status(200).send();
        }
      }
    } catch (err: any) {
      console.error(`❌ [Vapi] Webhook error:`, err.message);
      // Return 200 to prevent Vapi from retrying on our errors
      return reply.status(200).send();
    }
  });

  /**
   * GET /api/vapi/calls
   * Returns recent voice calls for the authenticated user.
   */
  server.get('/calls', async (request, reply) => {
    try {
      const { status, limit } = request.query as { status?: string; limit?: string };
      const take = Math.max(1, Math.min(Number(limit || 50), 200));

      let query = server.supabase
        .from('wb_calls')
        .select('*')
        .eq('user_id', request.userId)
        .order('created_at', { ascending: false })
        .limit(take);

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) {
        server.log.error({ error }, 'Failed to fetch voice calls');
        return reply.status(500).send({ error: 'Failed to fetch voice calls' });
      }

      return reply.send({ calls: data || [] });
    } catch (err: any) {
      server.log.error({ err }, 'GET /vapi/calls failed');
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  /**
   * GET /api/vapi/calls/:id
   * Returns one voice call for the authenticated user.
   */
  server.get('/calls/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { data, error } = await server.supabase
        .from('wb_calls')
        .select('*')
        .eq('id', id)
        .eq('user_id', request.userId)
        .single();

      if (error || !data) {
        return reply.status(404).send({ error: 'Voice call not found' });
      }

      return reply.send({ call: data });
    } catch (err: any) {
      server.log.error({ err }, 'GET /vapi/calls/:id failed');
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  /**
   * GET /api/vapi/calls/:id/actions
   * Returns all actions executed during a voice call.
   */
  server.get('/calls/:id/actions', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      // Validate ownership via parent call lookup
      const { data: callRecord, error: callError } = await server.supabase
        .from('wb_calls')
        .select('id')
        .eq('id', id)
        .eq('user_id', request.userId)
        .single();

      if (callError || !callRecord) {
        return reply.status(404).send({ error: 'Voice call not found' });
      }

      const { data, error } = await server.supabase
        .from('wb_call_actions')
        .select('*')
        .eq('call_id', id)
        .order('created_at', { ascending: true });

      if (error) {
        server.log.error({ error }, 'Failed to fetch call actions');
        return reply.status(500).send({ error: 'Failed to fetch call actions' });
      }

      return reply.send({ actions: data || [] });
    } catch (err: any) {
      server.log.error({ err }, 'GET /vapi/calls/:id/actions failed');
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });
};
