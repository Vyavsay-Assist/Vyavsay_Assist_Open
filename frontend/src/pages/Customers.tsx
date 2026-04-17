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

const HOTNESS_STYLES: Record<string, { bg: string; emoji: string }> = {
  hot:  { bg: 'bg-pastel-rose',     emoji: '🔥' },
  warm: { bg: 'bg-pastel-honey',    emoji: '🌡️' },
  cold: { bg: 'bg-pastel-sky',      emoji: '❄️' },
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle size={14} className="text-soft-sage" />,
  walk_in:  <Footprints size={14} className="text-soft-lavender" />,
  phone:    <Phone size={14} className="text-soft-honey" />,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, search]);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
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
    <div className="min-h-screen bg-cream-50 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-cream-50/90 backdrop-blur-sm border-b border-cream-200 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-[22px] font-bold text-ink-400">Customers</h1>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-soft-sage text-cream-50 px-3 py-2 rounded-full text-sm font-medium shadow-sm hover:opacity-90 transition"
          >
            <Plus size={16} /> Walk-In
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full pl-10 pr-3 py-2.5 rounded-2xl bg-cream-200/60 text-[13px] text-ink-300 placeholder:text-ink-50 focus:outline-none focus:ring-2 focus:ring-soft-lavender/30 transition-shadow"
          />
        </div>

        {/* Source filter chips */}
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          {[
            { id: 'all',      label: 'All' },
            { id: 'whatsapp', label: '💬 WhatsApp' },
            { id: 'walk_in',  label: '🚪 Walk-In' },
            { id: 'phone',    label: '📞 Phone' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setSourceFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium transition ${
                sourceFilter === f.id
                  ? 'bg-ink-300 text-cream-50'
                  : 'bg-cream-100 text-ink-100 border border-cream-200'
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
          <div className="text-center text-ink-50 py-12 text-[13px]">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="text-center text-ink-50 py-12">
            <p className="mb-3 text-[13px]">No customers yet.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-soft-sage font-medium underline text-sm"
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
                  className="w-full bg-cream-50 rounded-2xl p-3 shadow-sm border border-cream-200 text-left flex items-center gap-3 hover:bg-cream-100 transition"
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full ${h.bg} flex items-center justify-center text-lg shrink-0`}>
                    {h.emoji}
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink-300 truncate text-sm">
                        {c.full_name || 'Unknown'}
                      </span>
                      {SOURCE_ICONS[c.first_seen_via]}
                    </div>
                    <div className="text-[11px] text-ink-50 truncate">
                      {c.primary_phone || 'No phone'} · {c.status}
                    </div>
                  </div>

                  {/* Right meta */}
                  <div className="text-[11px] text-ink-50 shrink-0">
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
