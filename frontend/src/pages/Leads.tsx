import React, { useState, useEffect } from 'react';
import client from '../api/client';
import {
  Search,
  ArrowRight,
  ArrowLeft,
  Star,
  Phone,
  XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';

const STAGES = ['new', 'interested', 'quoted', 'negotiating', 'closed'];
const STAGE_COLORS: Record<string, string> = {
  new: 'bg-blue-500/20 border-blue-500/30',
  interested: 'bg-purple-500/20 border-purple-500/30',
  quoted: 'bg-amber-500/20 border-amber-500/30',
  negotiating: 'bg-orange-500/20 border-orange-500/30',
  closed: 'bg-green-500/20 border-green-500/30',
};

const Leads: React.FC = () => {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [draggedLead, setDraggedLead] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    try {
      const res = await client.get('/leads');
      setLeads(res.data.leads || []);
    } catch (err) {
      console.error('Failed to fetch leads', err);
    } finally {
      setLoading(false);
    }
  };

  const updateLeadStage = async (leadId: string, newStage: string) => {
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    try {
      await client.patch(`/leads/${leadId}`, { stage: newStage });
    } catch (err) {
      console.error('Failed to update stage', err);
      fetchLeads(); // Revert on error
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
    setDraggedLead(leadId);
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stage);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId) {
      updateLeadStage(leadId, targetStage);
    }
    setDraggedLead(null);
    setDragOverStage(null);
  };

  const handleDragEnd = () => {
    setDraggedLead(null);
    setDragOverStage(null);
  };

  // Filter leads by search
  const filteredLeads = search
    ? leads.filter(l =>
        l.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
        l.summary?.toLowerCase().includes(search.toLowerCase())
      )
    : leads;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto flex flex-col h-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Leads Pipeline</h1>
          <p className="text-muted-foreground">Drag leads between stages or use the arrow buttons. AI auto-scores incoming prospects.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card border border-border rounded-xl pl-10 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-64"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <XCircle className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Stage summary */}
      <div className="flex gap-3">
        {STAGES.map(stage => {
          const count = filteredLeads.filter(l => l.stage === stage).length;
          return (
            <div key={stage} className={`flex-1 rounded-xl border px-4 py-2 text-center ${STAGE_COLORS[stage]}`}>
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{stage}</p>
            </div>
          );
        })}
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-8 flex-1">
        {STAGES.map((stage) => {
          const stageLeads = filteredLeads.filter(l => l.stage === stage);
          const stageIdx = STAGES.indexOf(stage);
          const isDropTarget = dragOverStage === stage;

          return (
            <div
              key={stage}
              className={`min-w-[300px] max-w-[300px] flex flex-col rounded-2xl border transition-all ${
                isDropTarget
                  ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                  : 'border-border/30 bg-card/10'
              }`}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
            >
              {/* Column header */}
              <div className="px-4 py-3 border-b border-border/30">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold uppercase tracking-widest text-xs text-muted-foreground">{stage}</h3>
                  <span className="bg-muted px-2 py-0.5 rounded-md text-[10px] font-bold">{stageLeads.length}</span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[60vh]">
                {stageLeads.map((lead) => (
                  <motion.div
                    key={lead.id}
                    layout
                    draggable
                    onDragStart={(e: any) => handleDragStart(e, lead.id)}
                    onDragEnd={handleDragEnd}
                    className={`bg-card border border-border/50 p-4 rounded-xl cursor-grab active:cursor-grabbing hover:border-primary/30 transition-all group ${
                      draggedLead === lead.id ? 'opacity-40 scale-95' : ''
                    }`}
                  >
                    {/* Score badge */}
                    <div className="flex justify-between items-center mb-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-tighter ${
                        lead.score === 'high' ? 'bg-red-500/10 text-red-400' :
                        lead.score === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>
                        {lead.score}
                      </span>
                      {lead.score === 'high' && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
                    </div>

                    {/* Name */}
                    <h4 className="font-semibold mb-1">{lead.customer_name || 'Unknown'}</h4>

                    {/* Summary */}
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[2rem]">
                      {lead.summary || 'New lead — no summary yet.'}
                    </p>

                    {/* Phone if available */}
                    {lead.wb_conversations?.customer_phone && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-3">
                        <Phone className="w-3 h-3" />
                        {lead.wb_conversations.customer_phone}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-3 border-t border-border/30">
                      {/* Move left */}
                      <button
                        onClick={() => stageIdx > 0 && updateLeadStage(lead.id, STAGES[stageIdx - 1])}
                        disabled={stageIdx === 0}
                        className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                        title={stageIdx > 0 ? `Move to ${STAGES[stageIdx - 1]}` : ''}
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>

                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest">{stage}</span>

                      {/* Move right */}
                      <button
                        onClick={() => stageIdx < STAGES.length - 1 && updateLeadStage(lead.id, STAGES[stageIdx + 1])}
                        disabled={stageIdx === STAGES.length - 1}
                        className="p-1.5 rounded-lg hover:bg-primary/20 hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                        title={stageIdx < STAGES.length - 1 ? `Move to ${STAGES[stageIdx + 1]}` : ''}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}

                {stageLeads.length === 0 && (
                  <div className={`h-24 flex items-center justify-center rounded-xl border border-dashed transition-all ${
                    isDropTarget ? 'border-primary text-primary' : 'border-border/30 text-muted-foreground/30'
                  }`}>
                    <p className="text-[10px] font-bold uppercase tracking-widest">
                      {isDropTarget ? 'Drop here' : 'Empty'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Leads;
