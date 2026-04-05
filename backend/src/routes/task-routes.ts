import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validate, taskUpdate } from '../utils/validation.js';

const taskCreate = z.object({
  title: z.string().min(1).max(500),
  due_date: z.string().nullish(),
  is_completed: z.boolean().default(false),
});

export const taskRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {

  server.get('/', async (request, reply) => {
    const { completed } = request.query as { completed?: string };
    let query = server.supabase
      .from('wb_tasks')
      .select('*')
      .eq('user_id', request.userId)
      .order('created_at', { ascending: false });

    if (completed === 'true') query = query.eq('is_completed', true);
    if (completed === 'false') query = query.eq('is_completed', false);

    const { data, error } = await query.limit(200);
    if (error) return reply.status(500).send({ error: 'Failed to fetch tasks' });
    return reply.send({ tasks: data || [] });
  });

  /** Create a new task (for manual appointment creation etc.) */
  server.post('/', async (request, reply) => {
    const body = validate(taskCreate, request.body, reply);
    if (!body) return;

    const { data, error } = await server.supabase
      .from('wb_tasks')
      .insert({
        user_id: request.userId,
        title: body.title,
        due_date: body.due_date || null,
        is_completed: body.is_completed,
      })
      .select()
      .single();

    if (error) return reply.status(500).send({ error: 'Failed to create task' });
    return reply.status(201).send({ task: data });
  });

  server.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = validate(taskUpdate, request.body, reply);
    if (!updates) return;

    const { data, error } = await server.supabase
      .from('wb_tasks')
      .update(updates)
      .eq('id', id)
      .eq('user_id', request.userId)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: 'Failed to update task' });
    return reply.send({ task: data });
  });

  /** Delete a task */
  server.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await server.supabase
      .from('wb_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', request.userId);

    if (error) return reply.status(500).send({ error: 'Failed to delete task' });
    return reply.send({ success: true });
  });
};
