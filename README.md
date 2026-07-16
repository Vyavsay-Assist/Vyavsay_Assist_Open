# 🚀 Vyavsay — AI WhatsApp Sales Copilot

🌐 **Live Demo:** [https://vyavsayassist.app/](https://vyavsayassist.app/)

A multi-tenant AI-powered WhatsApp Sales Assistant SaaS that automatically handles customer inquiries, scores leads, extracts tasks, and schedules appointments — all through WhatsApp.

## 🏗️ Architecture

```
┌──────────────────────────────┐     ┌─────────────────────────────────┐
│   Frontend (Vite + React)    │     │    Backend (Fastify + Node)     │
│   Port: 3004                 │────▶│    Port: 3005                   │
│                              │     │                                 │
│  • Dashboard                 │     │  • WhatsApp Cloud API Client    │
│  • QR Scanner                │     │  • AI Pipeline (GPT-4o-mini)    │
│  • Conversations             │     │  • RAG Service (pgvector)       │
│  • Leads Management          │     │  • Cron Service (Follow-ups)    │
│  • Knowledge Base            │     │  • Reminder Service             │
│  • Analytics                 │     │                                 │
│  • Settings                  │     │        ┌────────────────┐       │
│  • Onboarding                │     │        │  Supabase DB   │       │
└──────────────────────────────┘     │        └────────────────┘       │
                                     │        ┌────────────────┐       │
                                     │        │ WhatsApp Cloud │       │
                                     │        │  API (Meta)    │       │
                                     │        └────────────────┘       │
                                     └─────────────────────────────────┘
```

## ⚙️ Tech Stack

| Layer       | Technology                                  |
|-------------|---------------------------------------------|
| Frontend    | React 18, Vite 6, TypeScript, Framer Motion |
| Backend     | Fastify 5, TypeScript, tsx                   |
| WhatsApp    | Meta WhatsApp Cloud API (official)           |
| AI          | GPT-4o-mini (default) / GPT-4o via GitHub Models — configurable via `AI_MODEL` |
| Database    | Supabase (PostgreSQL + pgvector)             |
| Auth        | Supabase Auth (email/password)               |
| Styling     | Custom CSS + Lucide Icons                    |

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project with pgvector enabled
- A GitHub PAT with access to GitHub Models (GPT-4o)

### 1. Clone & Install
```bash
git clone https://github.com/Vyavsay-Assist/Vyavsay_Assist_Open.git
cd Vyavsay_Assist_Open

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Environment Variables

**Backend** (`backend/.env`):
```env
PORT=3005
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=catalog-images
GITHUB_PAT=your-github-pat-for-ai
META_APP_SECRET=your-meta-app-secret
META_WEBHOOK_VERIFY_TOKEN=your-webhook-verify-token
META_PHONE_NUMBER_ID=your-phone-number-id
META_SYSTEM_USER_TOKEN=your-system-user-token
META_WABA_ID=your-waba-id
FRONTEND_URL=http://localhost:3004
NODE_ENV=development
OWNER_EMAILS=owner@example.com
```

**Frontend** (`frontend/.env`):
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=http://localhost:3005/api
VITE_OWNER_EMAILS=owner@example.com
```

### 3. Owner Dashboard Access
Use your chosen owner email (e.g., `owner@example.com`) in both backend and frontend env files.

After starting the app:
1. Sign in with the configured owner email address.
2. Open **Settings**.
3. Click **Open owner dashboard** under **Owner tools**.
4. You can also open `http://localhost:3004/owner/dashboard` directly while logged in.

If you see a 403 error, verify that the email matches exactly in `OWNER_EMAILS` on the backend and `VITE_OWNER_EMAILS` on the frontend.

### 4. Database Setup
Run the migration SQL files in Supabase SQL Editor:
```bash
# Apply schema tables: backend/database/migrations/001-schema.sql
# Apply additional schemas sequentially from backend/database/migrations/
```
These scripts create all tables (`wb_users`, `wb_conversations`, `wb_messages`, `wb_leads`, `wb_tasks`, `wb_knowledge_base`) with pgvector indexes and search RPC functions.

### 5. Run
```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

## 📱 How It Works

1. **Onboarding** → New users fill in their Business Name, Industry, and Services.
2. **Connect WhatsApp** → Link your official WhatsApp Business number via the Meta Cloud API (phone number ID + system user token).
3. **Knowledge Base** → Upload your business FAQs, pricing, and services. Each entry is chunked and vectorized.
4. **Product Images** → Add product photos directly from the dashboard. Images are uploaded to Supabase Storage and stored as public URLs on each catalog item.
5. **Auto-Reply** → When a customer messages you on WhatsApp:
   - Message is analyzed by GPT-4o-mini for **intent** and **lead score**.
   - RAG retrieves relevant **knowledge base** entries.
   - AI generates a **context-aware reply** using your business profile + knowledge.
   - Reply is sent automatically via the Meta Cloud API.
6. **CRM Dashboard** → Track conversations, leads, tasks, and analytics in real-time.

## ⚠️ WhatsApp Messaging Notes

This project uses the **official Meta WhatsApp Cloud API**, not an unofficial client:
- **Rate Limit**: Built-in rate limiter ensures messages are spaced out.
- **Don't spam**: Only reply to incoming messages. Never send unsolicited bulk messages — this also risks your Meta Business account.
- **Webhook Verification**: Incoming payloads are verified via HMAC-SHA256 (`x-hub-signature-256`) against `META_APP_SECRET` before processing.
- **Per-Tenant Credentials**: Each business's `phone_number_id` and access token are stored in `wb_waba_accounts`, with env vars as a single-tenant/dev fallback.

## 📜 License

This project is open-source and available under the [MIT License](LICENSE).
