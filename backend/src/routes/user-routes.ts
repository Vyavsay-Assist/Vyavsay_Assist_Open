import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { validate, userUpdate } from '../utils/validation.js';

export const userRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {

  server.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id !== request.userId) return reply.status(403).send({ error: 'Forbidden' });

    try {
      let { data, error } = await server.supabase
        .from('wb_users')
        .select('*')
        .eq('id', request.userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No user found, create one
          const { data: newUser, error: createError } = await server.supabase
            .from('wb_users')
            .insert({ id: request.userId })
            .select()
            .single();
          if (createError) {
            return reply.status(500).send({ error: 'Failed to create user profile', details: createError.message });
          }
          return reply.send({ user: newUser });
        }
        // Some other error
        return reply.status(500).send({ error: 'Failed to fetch user profile', details: error.message, code: error.code });
      }

      return reply.send({ user: data });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Unexpected error', message: err.message });
    }
  });

  server.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id !== request.userId) return reply.status(403).send({ error: 'Forbidden' });

    const updates = validate(userUpdate, request.body, reply);
    if (!updates) return;

    try {
      const { data, error } = await server.supabase
        .from('wb_users')
        .update(updates)
        .eq('id', request.userId)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ error: 'Failed to update user profile', details: error.message, code: error.code });
      }
      return reply.send({ user: data });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Unexpected error during update', message: err.message });
    }
  });
};
