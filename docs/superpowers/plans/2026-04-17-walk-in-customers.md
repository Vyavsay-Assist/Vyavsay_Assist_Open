# Walk-In Customers — Phase 1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add walk-in customer capture with a unified customer view that merges WhatsApp leads and walk-ins by phone number. Mobile-first UI. Architecture supports future multi-vertical config and multi-user staff tracking without rework.

**Architecture:** Refactor from channel-centric (`wb_leads` per WhatsApp conversation) to customer-centric (`customers` is the canonical record, with WhatsApp conversations and walk-in visits as touchpoints). Phase 1.1 ships the schema + walk-in capture UI; vertical config and voice capture come in subsequent plans.

**Tech Stack:** Fastify + Supabase (Postgres) backend, React 18 + Vite + Tailwind + axios + framer-motion + lucide-react frontend. No test framework — verification is manual via curl + browser.

**Scope of THIS plan:** New `customers` and `customer_visits` tables; backfill of existing `wb_conversations` into `customers`; backend CRUD routes; mobile-first Customers page with Quick-Add Walk-In modal and Customer Detail timeline; auto-dedup by phone number. **Out of scope (future plans):** voice capture, vertical-aware label swapping, staff/multi-user logins, AI-suggested actions, auto WhatsApp follow-up.

---

## File Structure

**Created:**
- `backend/database/migrations/007-customers-and-visits.sql` — schema + backfill
- `backend/src/routes/customer-routes.ts` — Customers CRUD
- `backend/src/routes/visit-routes.ts` — Visits CRUD
- `frontend/src/pages/Customers.tsx` — list + filter
- `frontend/src/pages/CustomerDetail.tsx` — single customer timeline
- `frontend/src/components/AddWalkInModal.tsx` — quick-add modal

**Modified:**
- `backend/src/server.ts` — register two new route plugins
- `backend/src/services/pipeline-service.ts` — upsert `customers` row when WhatsApp message arrives, link conversation
- `frontend/src/App.tsx` — add `/customers` and `/customers/:id` routes
- `frontend/src/components/layout/DesktopSidebar.tsx` — add Customers nav item
- `frontend/src/components/layout/MoreDrawer.tsx` — add Customers nav item

---

## Task 1: Create migration file with new schema

**Files:**
- Create: `backend/database/migrations/007-customers-and-visits.sql`

- [ ] **Step 1: Create the migration file with schema**

```sql
-- ============================================
-- Walk-In Customers + Unified Customer Model
-- ============================================
-- Introduces `customers` as the canonical record per real person,
-- with WhatsApp conversations and walk-in visits as touchpoints.
-- Backfills existing wb_conversations into customers.

-- ─────────────────────────────────────────
-- 1. Customers — one row per real person, per tenant
-- ─────────────────────────────────────────
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES wb_users(id) ON DELETE CASCADE,
  full_name VARCHAR,
  primary_phone VARCHAR,
  alt_phone VARCHAR,
  email VARCHAR,
  first_seen_via VARCHAR DEFAULT 'whatsapp',  -- 'whatsapp' | 'walk_in' | 'phone' | 'referral'
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  hotness VARCHAR DEFAULT 'cold',             -- 'hot' | 'warm' | 'cold'
  status VARCHAR DEFAULT 'new',               -- 'new' | 'engaged' | 'qualified' | 'won' | 'lost' | 'dormant'
  predicted_close_days INTEGER,
  lifetime_value NUMERIC DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',           -- vertical-specific data
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, primary_phone)              -- dedup per tenant; NULL phones allowed multiple
);

CREATE INDEX idx_customers_user ON customers(user_id, last_activity_at DESC);
CREATE INDEX idx_customers_phone ON customers(user_id, primary_phone);
CREATE INDEX idx_customers_hotness ON customers(user_id, hotness);
CREATE INDEX idx_customers_status ON customers(user_id, status);

-- Auto-update timestamp trigger
CREATE TRIGGER customers_updated
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION wb_update_timestamp();

-- ─────────────────────────────────────────
-- 2. Customer Visits — walk-in records
-- ─────────────────────────────────────────
CREATE TABLE customer_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES wb_users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ DEFAULT NOW(),
  duration_minutes INTEGER,
  staff_name VARCHAR,                         -- free-text for now; FK to staff_members in future plan
  items_shown UUID[] DEFAULT '{}',            -- catalog item IDs
  trial_taken BOOLEAN DEFAULT false,
  trial_item_id UUID,
  quoted_amount NUMERIC,
  outcome VARCHAR DEFAULT 'interested',       -- 'interested' | 'not_interested' | 'will_decide' | 'purchased' | 'follow_up'
  next_action TEXT,
  follow_up_at TIMESTAMPTZ,
  manual_notes TEXT,
  ai_summary TEXT,
  custom_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visits_customer ON customer_visits(customer_id, visited_at DESC);
CREATE INDEX idx_visits_user ON customer_visits(user_id, visited_at DESC);
CREATE INDEX idx_visits_followup ON customer_visits(user_id, follow_up_at)
  WHERE follow_up_at IS NOT NULL;

-- ─────────────────────────────────────────
-- 3. Link existing WhatsApp conversations to customers
-- ─────────────────────────────────────────
ALTER TABLE wb_conversations
  ADD COLUMN customer_id UUID REFERENCES customers(id);

CREATE INDEX idx_conversations_customer ON wb_conversations(customer_id);

-- Make wb_leads.conversation_id nullable so a lead can exist without a conversation
ALTER TABLE wb_leads
  ALTER COLUMN conversation_id DROP NOT NULL,
  ADD COLUMN customer_id UUID REFERENCES customers(id);

CREATE INDEX idx_leads_customer ON wb_leads(customer_id);

-- ─────────────────────────────────────────
-- 4. Backfill: every existing conversation becomes a customer
-- ─────────────────────────────────────────
INSERT INTO customers (
  id, user_id, full_name, primary_phone,
  first_seen_via, first_seen_at, last_activity_at, created_at
)
SELECT
  uuid_generate_v4(),
  c.user_id,
  COALESCE(c.customer_name, 'Unknown'),
  COALESCE(c.customer_phone, c.customer_jid),
  'whatsapp',
  c.created_at,
  c.last_message_at,
  c.created_at
FROM wb_conversations c
WHERE NOT EXISTS (
  SELECT 1 FROM customers cust
  WHERE cust.user_id = c.user_id
    AND cust.primary_phone = COALESCE(c.customer_phone, c.customer_jid)
);

-- Link conversations to their newly-created customers
UPDATE wb_conversations conv
SET customer_id = cust.id
FROM customers cust
WHERE cust.user_id = conv.user_id
  AND cust.primary_phone = COALESCE(conv.customer_phone, conv.customer_jid)
  AND conv.customer_id IS NULL;

-- Link existing leads to customers (via conversation)
UPDATE wb_leads l
SET customer_id = conv.customer_id
FROM wb_conversations conv
WHERE l.conversation_id = conv.id
  AND l.customer_id IS NULL;
```

- [ ] **Step 2: Apply migration to local Supabase**

Run in Supabase SQL Editor (local instance) by copy-pasting the file contents. Or via CLI if supabase-cli is set up.

Expected: All statements succeed, no errors. New tables `customers` and `customer_visits` exist. Existing `wb_conversations` rows now have `customer_id` populated.

- [ ] **Step 3: Verify backfill worked**

Run in SQL editor:
```sql
SELECT
  (SELECT COUNT(*) FROM wb_conversations) AS conversations,
  (SELECT COUNT(*) FROM customers) AS customers,
  (SELECT COUNT(*) FROM wb_conversations WHERE customer_id IS NOT NULL) AS linked_conversations,
  (SELECT COUNT(*) FROM wb_leads WHERE customer_id IS NOT NULL) AS linked_leads;
```

Expected: `linked_conversations` equals `conversations` count. `customers` count is `<=` conversations count (deduped by phone).

- [ ] **Step 4: Commit**

```bash
git add backend/database/migrations/007-customers-and-visits.sql
git commit -m "feat(db): add customers and customer_visits tables with backfill"
```

---

## Task 2: Backend — Customer CRUD routes

**Files:**
- Create: `backend/src/routes/customer-routes.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create customer routes file**

```typescript
import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const customerRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {

  // GET /customers — list with filters
  server.get('/', async (request, reply) => {
    try {
      const { hotness, status, source, search } = request.query as {
        hotness?: string;
        status?: string;
        source?: string;
        search?: string;
      };

      let query = server.supabase
        .from('customers')
        .select('*')
        .eq('user_id', request.userId)
        .order('last_activity_at', { ascending: false });

      if (hotness) query = query.eq('hotness', hotness);
      if (status) query = query.eq('status', status);
      if (source) query = query.eq('first_seen_via', source);
      if (search) {
        query = query.or(`full_name.ilike.%${search}%,primary_phone.ilike.%${search}%`);
      }

      const { data, error } = await query.limit(200);
      if (error) {
        console.error('GET /customers error:', error);
        return reply.status(500).send({ error: 'Failed to fetch customers' });
      }
      return reply.send({ customers: data || [] });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // GET /customers/:id — single customer with related data
  server.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const { data: customer, error } = await server.supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .eq('user_id', request.userId)
        .single();

      if (error || !customer) {
        return reply.status(404).send({ error: 'Customer not found' });
      }

      // Load related visits
      const { data: visits } = await server.supabase
        .from('customer_visits')
        .select('*')
        .eq('customer_id', id)
        .order('visited_at', { ascending: false });

      // Load related WhatsApp conversation (if any)
      const { data: conversation } = await server.supabase
        .from('wb_conversations')
        .select('id, customer_jid, last_message_at, summary')
        .eq('customer_id', id)
        .maybeSingle();

      // Load lead intelligence (if any)
      const { data: lead } = await server.supabase
        .from('wb_leads')
        .select('score, stage, intent, summary, notes')
        .eq('customer_id', id)
        .maybeSingle();

      return reply.send({
        customer,
        visits: visits || [],
        conversation,
        lead,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // POST /customers — create (used for walk-in if no existing match)
  server.post('/', async (request, reply) => {
    const body = request.body as {
      full_name?: string;
      primary_phone?: string;
      alt_phone?: string;
      email?: string;
      first_seen_via?: string;
      tags?: string[];
      internal_notes?: string;
    };

    if (!body.full_name && !body.primary_phone) {
      return reply.status(400).send({ error: 'Name or phone required' });
    }

    try {
      // Dedup by phone if provided
      if (body.primary_phone) {
        const { data: existing } = await server.supabase
          .from('customers')
          .select('*')
          .eq('user_id', request.userId)
          .eq('primary_phone', body.primary_phone)
          .maybeSingle();

        if (existing) {
          // Update name/email if provided and missing
          const updates: any = { last_activity_at: new Date().toISOString() };
          if (body.full_name && !existing.full_name) updates.full_name = body.full_name;
          if (body.email && !existing.email) updates.email = body.email;
          if (body.alt_phone && !existing.alt_phone) updates.alt_phone = body.alt_phone;

          const { data: merged } = await server.supabase
            .from('customers')
            .update(updates)
            .eq('id', existing.id)
            .select()
            .single();

          return reply.send({ customer: merged, merged: true });
        }
      }

      const { data, error } = await server.supabase
        .from('customers')
        .insert({
          user_id: request.userId,
          full_name: body.full_name,
          primary_phone: body.primary_phone,
          alt_phone: body.alt_phone,
          email: body.email,
          first_seen_via: body.first_seen_via || 'walk_in',
          tags: body.tags || [],
          internal_notes: body.internal_notes,
        })
        .select()
        .single();

      if (error) {
        console.error('POST /customers error:', error);
        return reply.status(500).send({ error: 'Failed to create customer' });
      }
      return reply.send({ customer: data, merged: false });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // PATCH /customers/:id — update
  server.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Record<string, any>;

    // Only allow safe fields to be updated
    const allowed = [
      'full_name', 'primary_phone', 'alt_phone', 'email',
      'hotness', 'status', 'tags', 'internal_notes',
      'predicted_close_days', 'lifetime_value', 'custom_fields',
    ];
    const safeUpdates: Record<string, any> = {};
    for (const key of allowed) {
      if (key in updates) safeUpdates[key] = updates[key];
    }

    try {
      const { data, error } = await server.supabase
        .from('customers')
        .update(safeUpdates)
        .eq('id', id)
        .eq('user_id', request.userId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') return reply.status(404).send({ error: 'Customer not found' });
        return reply.status(500).send({ error: 'Failed to update customer' });
      }
      return reply.send({ customer: data });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // DELETE /customers/:id
  server.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const { error } = await server.supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .eq('user_id', request.userId);

      if (error) return reply.status(500).send({ error: 'Failed to delete customer' });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });
};
```

- [ ] **Step 2: Register the route in server.ts**

Find the section in `backend/src/server.ts` where existing routes are registered (look for `server.register(leadRoutes, ...)` or similar). Add immediately after the lead routes registration:

```typescript
import { customerRoutes } from './routes/customer-routes.js';
// ... existing imports

// In the route registration block (find existing leadRoutes.register pattern):
await server.register(customerRoutes, { prefix: '/customers' });
```

- [ ] **Step 3: Start dev server and verify routes mount**

```bash
cd backend && npm run dev
```

Expected: Server starts without errors. Look for log lines mentioning `/customers` route registration.

- [ ] **Step 4: Smoke test with curl**

Replace `YOUR_TOKEN` with an actual auth token from your local session and `USER_ID` with your wb_users.id.

```bash
# List (should return existing backfilled customers)
curl http://localhost:3000/customers \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create
curl -X POST http://localhost:3000/customers \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test Walk-In","primary_phone":"919999900001","first_seen_via":"walk_in"}'
```

Expected: First call returns `{ customers: [...] }`. Second call returns `{ customer: {...}, merged: false }`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/customer-routes.ts backend/src/server.ts
git commit -m "feat(api): add customer CRUD routes with phone-based dedup"
```

---

## Task 3: Backend — Visit CRUD routes

**Files:**
- Create: `backend/src/routes/visit-routes.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create visit routes file**

```typescript
import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const visitRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {

  // GET /visits — list (optionally filter by customer or date range)
  server.get('/', async (request, reply) => {
    const { customer_id, from, to } = request.query as {
      customer_id?: string;
      from?: string;
      to?: string;
    };

    try {
      let query = server.supabase
        .from('customer_visits')
        .select('*, customers(full_name, primary_phone, hotness)')
        .eq('user_id', request.userId)
        .order('visited_at', { ascending: false });

      if (customer_id) query = query.eq('customer_id', customer_id);
      if (from) query = query.gte('visited_at', from);
      if (to) query = query.lte('visited_at', to);

      const { data, error } = await query.limit(200);
      if (error) {
        console.error('GET /visits error:', error);
        return reply.status(500).send({ error: 'Failed to fetch visits' });
      }
      return reply.send({ visits: data || [] });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // POST /visits — log a walk-in visit
  // If customer_id missing but phone provided, auto-create or link to customer
  server.post('/', async (request, reply) => {
    const body = request.body as {
      customer_id?: string;
      // alternative: provide customer details inline
      customer_name?: string;
      customer_phone?: string;
      // visit fields
      visited_at?: string;
      duration_minutes?: number;
      staff_name?: string;
      items_shown?: string[];
      trial_taken?: boolean;
      trial_item_id?: string;
      quoted_amount?: number;
      outcome?: string;
      next_action?: string;
      follow_up_at?: string;
      manual_notes?: string;
    };

    try {
      let customerId = body.customer_id;

      // Resolve or create customer
      if (!customerId) {
        if (!body.customer_name && !body.customer_phone) {
          return reply.status(400).send({
            error: 'Either customer_id or (customer_name + customer_phone) required',
          });
        }

        // Look up by phone
        if (body.customer_phone) {
          const { data: existing } = await server.supabase
            .from('customers')
            .select('id')
            .eq('user_id', request.userId)
            .eq('primary_phone', body.customer_phone)
            .maybeSingle();
          if (existing) customerId = existing.id;
        }

        // Create new customer if no match
        if (!customerId) {
          const { data: created, error: createErr } = await server.supabase
            .from('customers')
            .insert({
              user_id: request.userId,
              full_name: body.customer_name,
              primary_phone: body.customer_phone,
              first_seen_via: 'walk_in',
            })
            .select('id')
            .single();
          if (createErr || !created) {
            return reply.status(500).send({ error: 'Failed to create customer for visit' });
          }
          customerId = created.id;
        }
      }

      // Insert visit
      const { data: visit, error } = await server.supabase
        .from('customer_visits')
        .insert({
          user_id: request.userId,
          customer_id: customerId,
          visited_at: body.visited_at || new Date().toISOString(),
          duration_minutes: body.duration_minutes,
          staff_name: body.staff_name,
          items_shown: body.items_shown || [],
          trial_taken: body.trial_taken || false,
          trial_item_id: body.trial_item_id,
          quoted_amount: body.quoted_amount,
          outcome: body.outcome || 'interested',
          next_action: body.next_action,
          follow_up_at: body.follow_up_at,
          manual_notes: body.manual_notes,
        })
        .select()
        .single();

      if (error) {
        console.error('POST /visits error:', error);
        return reply.status(500).send({ error: 'Failed to create visit' });
      }

      // Bump customer.last_activity_at
      await server.supabase
        .from('customers')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', customerId);

      return reply.send({ visit });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // PATCH /visits/:id
  server.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Record<string, any>;

    const allowed = [
      'visited_at', 'duration_minutes', 'staff_name',
      'items_shown', 'trial_taken', 'trial_item_id',
      'quoted_amount', 'outcome', 'next_action',
      'follow_up_at', 'manual_notes', 'ai_summary', 'custom_data',
    ];
    const safeUpdates: Record<string, any> = {};
    for (const key of allowed) {
      if (key in updates) safeUpdates[key] = updates[key];
    }

    try {
      const { data, error } = await server.supabase
        .from('customer_visits')
        .update(safeUpdates)
        .eq('id', id)
        .eq('user_id', request.userId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') return reply.status(404).send({ error: 'Visit not found' });
        return reply.status(500).send({ error: 'Failed to update visit' });
      }
      return reply.send({ visit: data });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });

  // DELETE /visits/:id
  server.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const { error } = await server.supabase
        .from('customer_visits')
        .delete()
        .eq('id', id)
        .eq('user_id', request.userId);

      if (error) return reply.status(500).send({ error: 'Failed to delete visit' });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Internal server error' });
    }
  });
};
```

- [ ] **Step 2: Register the route in server.ts**

Add immediately after the customer routes registration:

```typescript
import { visitRoutes } from './routes/visit-routes.js';

await server.register(visitRoutes, { prefix: '/visits' });
```

- [ ] **Step 3: Smoke test with curl**

```bash
# Create a visit (auto-creates/links customer)
curl -X POST http://localhost:3000/visits \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name":"Rajesh Sharma",
    "customer_phone":"919876543210",
    "staff_name":"Suresh",
    "outcome":"will_decide",
    "manual_notes":"Took test drive of Fortuner",
    "follow_up_at":"2026-04-20T11:00:00Z"
  }'

# List
curl http://localhost:3000/visits -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: First call returns `{ visit: { id, customer_id, ... } }`. Second call shows the visit with the auto-created customer joined in.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/visit-routes.ts backend/src/server.ts
git commit -m "feat(api): add visit CRUD routes with auto customer creation"
```

---

## Task 4: Backend — Wire pipeline to upsert customer on WhatsApp message

**Files:**
- Modify: `backend/src/services/pipeline-service.ts`

This ensures every incoming WhatsApp message creates/links a `customers` row, so the unified view is populated for ALL channels going forward (not just walk-ins).

- [ ] **Step 1: Find the conversation upsert in pipeline-service.ts**

Open `backend/src/services/pipeline-service.ts` and locate the function that creates/updates `wb_conversations` rows when a new message arrives. It will call `server.supabase.from('wb_conversations').upsert(...)` or similar. Note the surrounding function name and context.

- [ ] **Step 2: Add a helper to upsert customer**

Add this helper function near the top of the file (after imports):

```typescript
async function upsertCustomerFromWhatsApp(
  supabase: any,
  userId: string,
  customerJid: string,
  customerName: string | null,
  customerPhone: string | null
): Promise<string | null> {
  const phoneOrJid = customerPhone || customerJid;
  if (!phoneOrJid) return null;

  // Try to find existing
  const { data: existing } = await supabase
    .from('customers')
    .select('id, full_name')
    .eq('user_id', userId)
    .eq('primary_phone', phoneOrJid)
    .maybeSingle();

  if (existing) {
    // Update name if it was missing
    const updates: any = { last_activity_at: new Date().toISOString() };
    if (customerName && !existing.full_name) updates.full_name = customerName;
    await supabase.from('customers').update(updates).eq('id', existing.id);
    return existing.id;
  }

  // Create new
  const { data: created, error } = await supabase
    .from('customers')
    .insert({
      user_id: userId,
      full_name: customerName || 'Unknown',
      primary_phone: phoneOrJid,
      first_seen_via: 'whatsapp',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[pipeline] failed to upsert customer:', error);
    return null;
  }
  return created.id;
}
```

- [ ] **Step 3: Call the helper after conversation upsert**

Find the spot where `wb_conversations` is upserted (the result is typically a `conversation` object with an `id`). Immediately after that, add:

```typescript
// Upsert customer and link conversation (Phase 1.1 walk-in unification)
const customerId = await upsertCustomerFromWhatsApp(
  supabase,
  userId,
  conversation.customer_jid,
  conversation.customer_name,
  conversation.customer_phone
);

if (customerId && !conversation.customer_id) {
  await supabase
    .from('wb_conversations')
    .update({ customer_id: customerId })
    .eq('id', conversation.id);
  conversation.customer_id = customerId;
}
```

The exact variable names depend on your existing code — adapt `conversation` to whatever the upsert call returns.

- [ ] **Step 4: Restart dev server and send a test WhatsApp message**

```bash
# Backend should already be in `npm run dev` watch mode; it auto-restarts on save.
# Send a real WhatsApp message to your connected number.
```

Expected: A row appears in `customers` for the sender, AND `wb_conversations.customer_id` is set.

Verify in SQL editor:
```sql
SELECT c.full_name, c.primary_phone, c.first_seen_via, conv.customer_jid
FROM customers c
JOIN wb_conversations conv ON conv.customer_id = c.id
ORDER BY c.created_at DESC LIMIT 5;
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pipeline-service.ts
git commit -m "feat(pipeline): upsert customer record on incoming WhatsApp message"
```

---

## Task 5: Frontend — Customers list page

**Files:**
- Create: `frontend/src/pages/Customers.tsx`

- [ ] **Step 1: Create the Customers page**

```tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MessageCircle, Footprints, Phone } from 'lucide-react';
import { motion } from 'framer-motion';
import client from '../api/client';
import AddWalkInModal from '../components/AddWalkInModal';

interface Customer {
  id: string;
  full_name: string | null;
  primary_phone: string | null;
  first_seen_via: string;
  last_activity_at: string;
  hotness: 'hot' | 'warm' | 'cold';
  status: string;
  tags: string[];
}

const HOTNESS_STYLES: Record<string, { bg: string; text: string; emoji: string }> = {
  hot:  { bg: 'bg-pastel-rose',     text: 'text-soft-rose',     emoji: '🔥' },
  warm: { bg: 'bg-pastel-honey',    text: 'text-soft-honey',    emoji: '🌡️' },
  cold: { bg: 'bg-pastel-sky',      text: 'text-soft-sky',      emoji: '❄️' },
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle size={14} className="text-soft-sage" />,
  walk_in: <Footprints size={14} className="text-soft-lavender" />,
  phone: <Phone size={14} className="text-soft-honey" />,
};

const Customers: React.FC = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, [sourceFilter, search]);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (sourceFilter !== 'all') params.source = sourceFilter;
      if (search) params.search = search;
      const res = await client.get('/customers', { params });
      setCustomers(res.data.customers || []);
    } catch (err) {
      console.error('Failed to fetch customers', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-cream pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-soft-stone/10 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-semibold text-soft-charcoal">Customers</h1>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-soft-sage text-white px-3 py-2 rounded-full text-sm font-medium shadow-sm"
          >
            <Plus size={16} /> Walk-In
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-soft-stone" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full pl-9 pr-3 py-2 rounded-full bg-pastel-cream border border-soft-stone/20 text-sm focus:outline-none focus:border-soft-sage"
          />
        </div>

        {/* Source filter chips */}
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'whatsapp', label: '💬 WhatsApp' },
            { id: 'walk_in', label: '🚪 Walk-In' },
            { id: 'phone', label: '📞 Phone' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setSourceFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium transition ${
                sourceFilter === f.id
                  ? 'bg-soft-charcoal text-white'
                  : 'bg-white text-soft-stone border border-soft-stone/20'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 pt-4">
        {loading ? (
          <div className="text-center text-soft-stone py-12">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="text-center text-soft-stone py-12">
            <p className="mb-3">No customers yet.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-soft-sage font-medium underline"
            >
              Add your first walk-in
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {customers.map((c) => {
              const h = HOTNESS_STYLES[c.hotness] || HOTNESS_STYLES.cold;
              return (
                <motion.button
                  key={c.id}
                  onClick={() => navigate(`/customers/${c.id}`)}
                  whileTap={{ scale: 0.98 }}
                  className="w-full bg-white rounded-2xl p-3 shadow-sm border border-soft-stone/10 text-left flex items-center gap-3"
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full ${h.bg} flex items-center justify-center text-lg shrink-0`}>
                    {h.emoji}
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-soft-charcoal truncate">
                        {c.full_name || 'Unknown'}
                      </span>
                      {SOURCE_ICONS[c.first_seen_via]}
                    </div>
                    <div className="text-xs text-soft-stone truncate">
                      {c.primary_phone || 'No phone'} · {c.status}
                    </div>
                  </div>

                  {/* Right meta */}
                  <div className="text-xs text-soft-stone shrink-0">
                    {formatTime(c.last_activity_at)}
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showAddModal && (
        <AddWalkInModal
          onClose={() => setShowAddModal(false)}
          onSaved={(customerId) => {
            setShowAddModal(false);
            navigate(`/customers/${customerId}`);
          }}
        />
      )}
    </div>
  );
};

export default Customers;
```

- [ ] **Step 2: Verify by visiting in browser (after Task 7 mounts the route)**

Skipped now — verification happens after routes are added in Task 8.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Customers.tsx
git commit -m "feat(ui): add mobile-first Customers list page with source filter"
```

---

## Task 6: Frontend — AddWalkInModal component

**Files:**
- Create: `frontend/src/components/AddWalkInModal.tsx`

- [ ] **Step 1: Create the modal component**

```tsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Phone, Tag, Calendar, FileText } from 'lucide-react';
import client from '../api/client';

interface Props {
  onClose: () => void;
  onSaved: (customerId: string) => void;
}

const OUTCOMES = [
  { value: 'interested', label: '👀 Interested' },
  { value: 'will_decide', label: '🤔 Will Decide' },
  { value: 'purchased', label: '✅ Purchased' },
  { value: 'not_interested', label: '❌ Not Interested' },
  { value: 'follow_up', label: '⏰ Follow-Up Later' },
];

const AddWalkInModal: React.FC<Props> = ({ onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [staffName, setStaffName] = useState('');
  const [outcome, setOutcome] = useState('interested');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name && !phone) {
      setError('Please enter a name or phone number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await client.post('/visits', {
        customer_name: name || undefined,
        customer_phone: phone || undefined,
        staff_name: staffName || undefined,
        outcome,
        manual_notes: notes || undefined,
        follow_up_at: followUp ? new Date(followUp).toISOString() : undefined,
      });
      onSaved(res.data.visit.customer_id);
    } catch (err: any) {
      console.error('Failed to save visit', err);
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-soft-charcoal">Log Walk-In</h2>
            <button onClick={onClose} className="text-soft-stone p-1">
              <X size={20} />
            </button>
          </div>

          {/* Name */}
          <label className="block text-xs text-soft-stone mb-1 mt-3">Customer Name</label>
          <div className="flex items-center gap-2 bg-pastel-cream rounded-xl px-3 py-2.5">
            <User size={16} className="text-soft-stone" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajesh Sharma"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>

          {/* Phone */}
          <label className="block text-xs text-soft-stone mb-1 mt-3">Phone Number</label>
          <div className="flex items-center gap-2 bg-pastel-cream rounded-xl px-3 py-2.5">
            <Phone size={16} className="text-soft-stone" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="9876543210"
              inputMode="numeric"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>

          {/* Staff */}
          <label className="block text-xs text-soft-stone mb-1 mt-3">Handled By</label>
          <div className="flex items-center gap-2 bg-pastel-cream rounded-xl px-3 py-2.5">
            <Tag size={16} className="text-soft-stone" />
            <input
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Sales rep name"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>

          {/* Outcome */}
          <label className="block text-xs text-soft-stone mb-2 mt-4">Outcome</label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => setOutcome(o.value)}
                className={`text-xs py-2 rounded-xl font-medium border transition ${
                  outcome === o.value
                    ? 'bg-soft-charcoal text-white border-soft-charcoal'
                    : 'bg-white text-soft-stone border-soft-stone/20'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Notes */}
          <label className="block text-xs text-soft-stone mb-1 mt-4">Notes</label>
          <div className="flex items-start gap-2 bg-pastel-cream rounded-xl px-3 py-2.5">
            <FileText size={16} className="text-soft-stone mt-0.5" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did they want? What did you show?"
              rows={3}
              className="flex-1 bg-transparent outline-none text-sm resize-none"
            />
          </div>

          {/* Follow-up */}
          <label className="block text-xs text-soft-stone mb-1 mt-3">Follow-Up Date (optional)</label>
          <div className="flex items-center gap-2 bg-pastel-cream rounded-xl px-3 py-2.5">
            <Calendar size={16} className="text-soft-stone" />
            <input
              type="datetime-local"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>

          {error && (
            <div className="mt-3 text-xs text-soft-rose bg-pastel-rose/30 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-full text-sm font-medium text-soft-stone border border-soft-stone/20"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 py-3 rounded-full text-sm font-medium bg-soft-sage text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Walk-In'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AddWalkInModal;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/AddWalkInModal.tsx
git commit -m "feat(ui): add mobile-first walk-in capture modal"
```

---

## Task 7: Frontend — Customer Detail page (timeline view)

**Files:**
- Create: `frontend/src/pages/CustomerDetail.tsx`

- [ ] **Step 1: Create the detail page**

```tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, Footprints, Clock, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import client from '../api/client';

interface Customer {
  id: string;
  full_name: string | null;
  primary_phone: string | null;
  alt_phone: string | null;
  email: string | null;
  first_seen_via: string;
  last_activity_at: string;
  hotness: 'hot' | 'warm' | 'cold';
  status: string;
  tags: string[];
  internal_notes: string | null;
  predicted_close_days: number | null;
}

interface Visit {
  id: string;
  visited_at: string;
  staff_name: string | null;
  outcome: string;
  manual_notes: string | null;
  follow_up_at: string | null;
  trial_taken: boolean;
  quoted_amount: number | null;
}

interface Conversation {
  id: string;
  customer_jid: string;
  last_message_at: string;
  summary: string | null;
}

interface Lead {
  score: string;
  stage: string;
  intent: string;
  summary: string;
  notes: string;
}

const HOTNESS_LABELS: Record<string, { emoji: string; label: string; color: string }> = {
  hot:  { emoji: '🔥', label: 'Hot',  color: 'text-soft-rose' },
  warm: { emoji: '🌡️', label: 'Warm', color: 'text-soft-honey' },
  cold: { emoji: '❄️', label: 'Cold', color: 'text-soft-sky' },
};

const OUTCOME_LABELS: Record<string, string> = {
  interested: '👀 Interested',
  will_decide: '🤔 Will Decide',
  purchased: '✅ Purchased',
  not_interested: '❌ Not Interested',
  follow_up: '⏰ Follow-Up',
};

const CustomerDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await client.get(`/customers/${id}`);
      setCustomer(res.data.customer);
      setVisits(res.data.visits || []);
      setConversation(res.data.conversation || null);
      setLead(res.data.lead || null);
    } catch (err) {
      console.error('Failed to fetch customer', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-cream flex items-center justify-center text-soft-stone">Loading…</div>;
  }
  if (!customer) {
    return <div className="min-h-screen bg-cream flex items-center justify-center text-soft-stone">Customer not found</div>;
  }

  const h = HOTNESS_LABELS[customer.hotness] || HOTNESS_LABELS.cold;

  return (
    <div className="min-h-screen bg-cream pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-soft-stone/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 text-soft-charcoal">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-soft-charcoal truncate">
              {customer.full_name || 'Unknown'}
            </div>
            <div className="text-xs text-soft-stone">{customer.primary_phone || 'No phone'}</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-4 pt-4 flex gap-2">
        {customer.primary_phone && (
          <a
            href={`tel:${customer.primary_phone}`}
            className="flex-1 py-2.5 rounded-full bg-white text-soft-charcoal text-sm font-medium border border-soft-stone/20 flex items-center justify-center gap-1.5"
          >
            <Phone size={14} /> Call
          </a>
        )}
        {customer.primary_phone && (
          <a
            href={`https://wa.me/${customer.primary_phone}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-2.5 rounded-full bg-soft-sage text-white text-sm font-medium flex items-center justify-center gap-1.5"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
        )}
      </div>

      {/* Hotness card */}
      <div className="px-4 pt-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-soft-stone/10">
          <div className={`text-sm font-medium ${h.color}`}>
            {h.emoji} {h.label} · {customer.status}
          </div>
          {customer.predicted_close_days != null && (
            <div className="text-xs text-soft-stone mt-1">
              💰 Predicted close: {customer.predicted_close_days} days
            </div>
          )}
          {lead?.intent && (
            <div className="text-xs text-soft-stone mt-1">Intent: {lead.intent}</div>
          )}
        </div>
      </div>

      {/* AI summary */}
      {lead?.summary && (
        <div className="px-4 pt-3">
          <div className="bg-pastel-lavender/40 rounded-2xl p-4 border border-soft-lavender/20">
            <div className="text-xs font-medium text-soft-lavender mb-1">✨ AI Summary</div>
            <div className="text-sm text-soft-charcoal whitespace-pre-wrap">{lead.summary}</div>
          </div>
        </div>
      )}

      {/* Internal notes */}
      {customer.internal_notes && (
        <div className="px-4 pt-3">
          <div className="bg-white rounded-2xl p-4 border border-soft-stone/10">
            <div className="text-xs font-medium text-soft-stone mb-1">Notes</div>
            <div className="text-sm text-soft-charcoal whitespace-pre-wrap">{customer.internal_notes}</div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="px-4 pt-5">
        <div className="text-xs uppercase tracking-wide text-soft-stone mb-2 font-medium">
          Timeline ({visits.length + (conversation ? 1 : 0)})
        </div>

        {/* Visits */}
        {visits.map((v, i) => (
          <motion.div
            key={v.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white rounded-2xl p-4 mb-2 border border-soft-stone/10"
          >
            <div className="flex items-center gap-2 text-xs text-soft-stone mb-1">
              <Footprints size={12} className="text-soft-lavender" />
              <span>Walk-In · {new Date(v.visited_at).toLocaleString()}</span>
            </div>
            <div className="text-sm text-soft-charcoal font-medium">
              {OUTCOME_LABELS[v.outcome] || v.outcome}
              {v.staff_name && <span className="text-soft-stone font-normal"> · {v.staff_name}</span>}
            </div>
            {v.trial_taken && (
              <div className="text-xs text-soft-sage mt-1">✓ Trial/Demo taken</div>
            )}
            {v.quoted_amount != null && (
              <div className="text-xs text-soft-honey mt-1">💰 Quoted ₹{v.quoted_amount.toLocaleString()}</div>
            )}
            {v.manual_notes && (
              <div className="text-sm text-soft-charcoal mt-2 whitespace-pre-wrap">{v.manual_notes}</div>
            )}
            {v.follow_up_at && (
              <div className="text-xs text-soft-stone mt-2 flex items-center gap-1">
                <Clock size={12} /> Follow-up: {new Date(v.follow_up_at).toLocaleString()}
              </div>
            )}
          </motion.div>
        ))}

        {/* WhatsApp conversation entry */}
        {conversation && (
          <motion.button
            onClick={() => navigate(`/conversations`)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full text-left bg-white rounded-2xl p-4 mb-2 border border-soft-stone/10"
          >
            <div className="flex items-center gap-2 text-xs text-soft-stone mb-1">
              <MessageCircle size={12} className="text-soft-sage" />
              <span>WhatsApp Chat · last {new Date(conversation.last_message_at).toLocaleString()}</span>
            </div>
            {conversation.summary && (
              <div className="text-sm text-soft-charcoal mt-1 line-clamp-2">{conversation.summary}</div>
            )}
            <div className="text-xs text-soft-sage mt-2">View full chat →</div>
          </motion.button>
        )}

        {visits.length === 0 && !conversation && (
          <div className="text-center text-soft-stone py-8 text-sm">
            No interactions yet.
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerDetail;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/CustomerDetail.tsx
git commit -m "feat(ui): add customer detail page with unified timeline"
```

---

## Task 8: Frontend — Wire routes and navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/DesktopSidebar.tsx`
- Modify: `frontend/src/components/layout/MoreDrawer.tsx`

- [ ] **Step 1: Add routes in App.tsx**

Open `frontend/src/App.tsx`. Find the `<Routes>` block and add the following two routes (placement: between `/leads` and `/tasks`):

```tsx
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';

// Inside <Routes>:
<Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
<Route path="/customers/:id" element={<ProtectedRoute><CustomerDetail /></ProtectedRoute>} />
```

- [ ] **Step 2: Add nav link in DesktopSidebar.tsx**

Open `frontend/src/components/layout/DesktopSidebar.tsx`. Locate the navigation items array or `<NavLink>` block. Add a Customers entry between Conversations and Leads:

```tsx
import { Users } from 'lucide-react';

// In nav items list:
{ to: '/customers', label: 'Customers', icon: Users },
```

(Adapt to whatever data structure the existing sidebar uses — match the surrounding style.)

- [ ] **Step 3: Add nav link in MoreDrawer.tsx**

Open `frontend/src/components/layout/MoreDrawer.tsx`. Mirror the addition from Step 2 — add a Customers entry in the same position style as existing entries.

- [ ] **Step 4: Run frontend dev server and verify navigation**

```bash
cd frontend && npm run dev
```

Open browser → log in → click Customers in sidebar → expect to land on `/customers` and see the list (which includes backfilled WhatsApp customers from the migration).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/DesktopSidebar.tsx frontend/src/components/layout/MoreDrawer.tsx
git commit -m "feat(ui): mount Customers routes and navigation"
```

---

## Task 9: End-to-end manual verification

- [ ] **Step 1: Start both servers**

Two terminals:
```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Test walk-in flow (mobile view in browser)**

In browser, open DevTools → device toolbar → set to iPhone size.
1. Log in
2. Navigate to `/customers`
3. Tap "+ Walk-In" button (top-right)
4. Modal slides up from bottom (mobile feel)
5. Fill: name "Rajesh Sharma", phone "919876543210", staff "Suresh", outcome "Will Decide", notes "Test drove Fortuner", follow-up tomorrow
6. Tap "Save Walk-In"
7. Should redirect to `/customers/<new-id>` showing the timeline with the visit

Expected: Visit appears in timeline. Customer card shows phone, status, hotness.

- [ ] **Step 3: Test deduplication**

1. Send a real WhatsApp message FROM the same phone number `919876543210` to your connected number
2. Wait for AI to process it
3. Reload `/customers/<id>` — the existing customer should now show BOTH the walk-in visit AND the WhatsApp conversation entry in the timeline

Expected: ONE customer row, two timeline entries.

- [ ] **Step 4: Test source filter**

On `/customers`, tap each filter chip (All / WhatsApp / Walk-In / Phone). List filters correctly.

- [ ] **Step 5: Test search**

Type "Rajesh" or partial phone — list filters to matching customers only.

- [ ] **Step 6: Test customer-only walk-in (no phone)**

Add a walk-in with only a name (no phone). Should still save. Won't dedup with anything (NULL phones don't conflict).

- [ ] **Step 7: Test from desktop view**

Resize browser to desktop. Same flows should work — modal centers on screen instead of sliding from bottom.

- [ ] **Step 8: Final commit (only if any fixups were needed)**

```bash
# only if you needed to fix anything during manual testing
git add -A
git commit -m "fix: address issues found during e2e walkthrough"
```

---

## Out of Scope (Future Plans)

These are deliberately deferred. Each will be its own plan:

- **Plan 1.2 — Voice Capture:** Mic button in modal, Groq Whisper transcription, AI extraction of structured fields from voice notes.
- **Plan 1.3 — Multi-Vertical Config:** `business_verticals` seed data, vertical picker on signup, label swapping per vertical (Test Drive ↔ Demo ↔ Try-On).
- **Plan 1.4 — Staff/Multi-User:** `staff_members` table, login per rep, assignment dropdown, leaderboard.
- **Plan 1.5 — AI Suggestions:** "Send EMI quote", "Follow up — going cold", auto-drafted WhatsApp follow-up templates.
- **Plan 1.6 — Phone Calls Channel:** Same touchpoint pattern as visits, manual entry for now, IVR integration later.

---

## Self-Review Notes

**Coverage check:** All Phase 1.1 scope items have a task — schema (Task 1), backend customer routes (Task 2), backend visit routes (Task 3), pipeline integration (Task 4), customer list UI (Task 5), add-walk-in modal (Task 6), customer detail UI (Task 7), navigation wiring (Task 8), end-to-end verification (Task 9).

**Type consistency:** `customer_id` is the join key everywhere; `customer_visits.customer_id`, `wb_conversations.customer_id`, `wb_leads.customer_id` all reference `customers.id`. Outcome enum values used in modal (`interested | will_decide | purchased | not_interested | follow_up`) match those used in detail page label map and migration default.

**Pattern alignment:** Routes follow the existing Fastify + Supabase pattern from `lead-routes.ts`. Frontend pages follow the `client.get/post` axios pattern from `Leads.tsx`. Tailwind classes use the existing `pastel-*` and `soft-*` palette.

**Known assumptions to validate during execution:**
- `frontend/src/components/layout/DesktopSidebar.tsx` and `MoreDrawer.tsx` paths exist (Step 8.2/8.3 — confirm structure when modifying).
- `request.userId` is populated by existing auth plugin (used in lead-routes.ts the same way).
- `wb_update_timestamp()` function from migration 001 still exists for the trigger in Task 1.
