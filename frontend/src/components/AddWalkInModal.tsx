import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Phone, Tag, Calendar, FileText } from 'lucide-react';
import client from '../api/client';

interface Props {
  onClose: () => void;
  onSaved: (customerId: string) => void;
}

const OUTCOMES = [
  { value: 'interested',     label: '👀 Interested' },
  { value: 'will_decide',    label: '🤔 Will Decide' },
  { value: 'purchased',      label: '✅ Purchased' },
  { value: 'not_interested', label: '❌ Not Interested' },
  { value: 'follow_up',      label: '⏰ Follow-Up Later' },
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
          className="bg-cream-50 w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-[18px] font-bold text-ink-400">Log Walk-In</h2>
            <button onClick={onClose} className="text-ink-50 hover:text-ink-200 p-1 transition">
              <X size={20} />
            </button>
          </div>

          {/* Name */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Customer Name
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <User size={16} className="text-ink-50" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajesh Sharma"
              className="flex-1 bg-transparent outline-none text-sm text-ink-300 placeholder:text-ink-50"
            />
          </div>

          {/* Phone */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Phone Number
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <Phone size={16} className="text-ink-50" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="9876543210"
              inputMode="numeric"
              className="flex-1 bg-transparent outline-none text-sm text-ink-300 placeholder:text-ink-50"
            />
          </div>

          {/* Staff */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Handled By
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <Tag size={16} className="text-ink-50" />
            <input
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Sales rep name"
              className="flex-1 bg-transparent outline-none text-sm text-ink-300 placeholder:text-ink-50"
            />
          </div>

          {/* Outcome */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-2 mt-4 font-medium">
            Outcome
          </label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => setOutcome(o.value)}
                className={`text-xs py-2 rounded-xl font-medium border transition ${
                  outcome === o.value
                    ? 'bg-ink-300 text-cream-50 border-ink-300'
                    : 'bg-cream-50 text-ink-100 border-cream-200 hover:bg-cream-100'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Notes */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-4 font-medium">
            Notes
          </label>
          <div className="flex items-start gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <FileText size={16} className="text-ink-50 mt-0.5" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did they want? What did you show?"
              rows={3}
              className="flex-1 bg-transparent outline-none text-sm resize-none text-ink-300 placeholder:text-ink-50"
            />
          </div>

          {/* Follow-up */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Follow-Up Date (optional)
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <Calendar size={16} className="text-ink-50" />
            <input
              type="datetime-local"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm text-ink-300"
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
              className="flex-1 py-3 rounded-full text-sm font-medium text-ink-100 border border-cream-200 hover:bg-cream-100 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 py-3 rounded-full text-sm font-medium bg-soft-sage text-cream-50 disabled:opacity-50 hover:opacity-90 transition"
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
