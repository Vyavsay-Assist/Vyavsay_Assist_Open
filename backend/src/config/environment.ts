import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export const config = {
  PORT: parseInt(process.env.PORT || '3005', 10),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3004',
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'catalog-images',

  // AI — GPT-4o via Azure
  GITHUB_PAT: process.env.GITHUB_PAT || '',

  // Baileys auth sessions directory
  AUTH_SESSIONS_DIR: process.env.AUTH_SESSIONS_DIR || './auth_sessions_v2',

  // Vapi Voice Agent
  VAPI_API_KEY: process.env.VAPI_API_KEY || '',
  VAPI_PHONE_NUMBER_ID: process.env.VAPI_PHONE_NUMBER_ID || '',
  VAPI_ASSISTANT_ID: process.env.VAPI_ASSISTANT_ID || '',
  VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET || '',

  // Voice Transcription (Groq primary, OpenAI fallback)
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // Owner/Admin access allowlist
  OWNER_EMAILS: (process.env.OWNER_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean),
};

// Validate critical env vars
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_PAT'];
for (const key of required) {
  if (!config[key as keyof typeof config]) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}
