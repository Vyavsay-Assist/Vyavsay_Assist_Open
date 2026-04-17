import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, Footprints, Clock } from 'lucide-react';
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
  hot:  { emoji: '🔥',  label: 'Hot',  color: 'text-soft-rose' },
  warm: { emoji: '🌡️', label: 'Warm', color: 'text-soft-honey' },
  cold: { emoji: '❄️',  label: 'Cold', color: 'text-soft-sky' },
};

const OUTCOME_LABELS: Record<string, string> = {
  interested:     '👀 Interested',
  will_decide:    '🤔 Will Decide',
  purchased:      '✅ Purchased',
  not_interested: '❌ Not Interested',
  follow_up:      '⏰ Follow-Up',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return <div className="min-h-screen bg-cream-50 flex items-center justify-center text-ink-50 text-[13px]">Loading…</div>;
  }
  if (!customer) {
    return <div className="min-h-screen bg-cream-50 flex items-center justify-center text-ink-50 text-[13px]">Customer not found</div>;
  }

  const h = HOTNESS_LABELS[customer.hotness] || HOTNESS_LABELS.cold;
  const phoneForCall = customer.primary_phone?.replace(/\D/g, '');

  return (
    <div className="min-h-screen bg-cream-50 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-cream-50/90 backdrop-blur-sm border-b border-cream-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 text-ink-300 hover:text-ink-400 transition">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-display text-[16px] font-bold text-ink-400 truncate">
              {customer.full_name || 'Unknown'}
            </div>
            <div className="text-[11px] text-ink-50">{customer.primary_phone || 'No phone'}</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      {phoneForCall && (
        <div className="px-4 pt-4 flex gap-2">
          <a
            href={`tel:${phoneForCall}`}
            className="flex-1 py-2.5 rounded-full bg-cream-50 text-ink-300 text-sm font-medium border border-cream-200 flex items-center justify-center gap-1.5 hover:bg-cream-100 transition"
          >
            <Phone size={14} /> Call
          </a>
          <a
            href={`https://wa.me/${phoneForCall}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-2.5 rounded-full bg-soft-sage text-cream-50 text-sm font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
        </div>
      )}

      {/* Hotness card */}
      <div className="px-4 pt-4">
        <div className="bg-cream-50 rounded-2xl p-4 shadow-sm border border-cream-200">
          <div className={`text-sm font-medium ${h.color}`}>
            {h.emoji} {h.label} · {customer.status}
          </div>
          {customer.predicted_close_days != null && (
            <div className="text-[11px] text-ink-50 mt-1">
              💰 Predicted close: {customer.predicted_close_days} days
            </div>
          )}
          {lead?.intent && (
            <div className="text-[11px] text-ink-50 mt-1">Intent: {lead.intent}</div>
          )}
        </div>
      </div>

      {/* AI summary */}
      {lead?.summary && (
        <div className="px-4 pt-3">
          <div className="bg-pastel-lavender/40 rounded-2xl p-4 border border-soft-lavender/20">
            <div className="text-[11px] uppercase tracking-wide font-medium text-soft-lavender mb-1">
              ✨ AI Summary
            </div>
            <div className="text-sm text-ink-300 whitespace-pre-wrap">{lead.summary}</div>
          </div>
        </div>
      )}

      {/* Internal notes */}
      {customer.internal_notes && (
        <div className="px-4 pt-3">
          <div className="bg-cream-50 rounded-2xl p-4 border border-cream-200">
            <div className="text-[11px] uppercase tracking-wide font-medium text-ink-50 mb-1">
              Notes
            </div>
            <div className="text-sm text-ink-300 whitespace-pre-wrap">{customer.internal_notes}</div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="px-4 pt-5">
        <div className="text-[11px] uppercase tracking-wide text-ink-50 mb-2 font-medium">
          Timeline ({visits.length + (conversation ? 1 : 0)})
        </div>

        {/* Visits */}
        {visits.map((v, i) => (
          <motion.div
            key={v.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-cream-50 rounded-2xl p-4 mb-2 border border-cream-200"
          >
            <div className="flex items-center gap-2 text-[11px] text-ink-50 mb-1">
              <Footprints size={12} className="text-soft-lavender" />
              <span>Walk-In · {new Date(v.visited_at).toLocaleString()}</span>
            </div>
            <div className="text-sm text-ink-300 font-medium">
              {OUTCOME_LABELS[v.outcome] || v.outcome}
              {v.staff_name && <span className="text-ink-50 font-normal"> · {v.staff_name}</span>}
            </div>
            {v.trial_taken && (
              <div className="text-[11px] text-soft-sage mt-1">✓ Trial/Demo taken</div>
            )}
            {v.quoted_amount != null && (
              <div className="text-[11px] text-soft-honey mt-1">
                💰 Quoted ₹{Number(v.quoted_amount).toLocaleString('en-IN')}
              </div>
            )}
            {v.manual_notes && (
              <div className="text-sm text-ink-300 mt-2 whitespace-pre-wrap">{v.manual_notes}</div>
            )}
            {v.follow_up_at && (
              <div className="text-[11px] text-ink-50 mt-2 flex items-center gap-1">
                <Clock size={12} /> Follow-up: {new Date(v.follow_up_at).toLocaleString()}
              </div>
            )}
          </motion.div>
        ))}

        {/* WhatsApp conversation entry */}
        {conversation && (
          <motion.button
            onClick={() => navigate('/conversations')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full text-left bg-cream-50 rounded-2xl p-4 mb-2 border border-cream-200 hover:bg-cream-100 transition"
          >
            <div className="flex items-center gap-2 text-[11px] text-ink-50 mb-1">
              <MessageCircle size={12} className="text-soft-sage" />
              <span>WhatsApp Chat · last {new Date(conversation.last_message_at).toLocaleString()}</span>
            </div>
            {conversation.summary && (
              <div className="text-sm text-ink-300 mt-1 line-clamp-2">{conversation.summary}</div>
            )}
            <div className="text-[11px] text-soft-sage mt-2">View full chat →</div>
          </motion.button>
        )}

        {visits.length === 0 && !conversation && (
          <div className="text-center text-ink-50 py-8 text-sm">
            No interactions yet.
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerDetail;
