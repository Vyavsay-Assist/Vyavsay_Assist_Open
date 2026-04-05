import React, { useState, useEffect } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Brain,
  Package,
  BookOpen,
  Plus,
  Trash2,
  FileText,
  Sparkles,
  AlertCircle,
  Loader2,
  Settings2,
  Upload,
  Download,
  FileDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import InventoryTable from '../components/InventoryTable';
import ItemModal from '../components/ItemModal';
import SchemaManager from '../components/SchemaManager';
import FileUpload from '../components/FileUpload';

type Tab = 'products' | 'knowledge';

export interface SchemaField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'dropdown' | 'date' | 'boolean';
  required?: boolean;
  options?: string[];
}

export interface InventorySchema {
  fields: SchemaField[];
}

const AIBrain: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('products');
  const [schema, setSchema] = useState<InventorySchema>({ fields: [] });
  const [showSchemaManager, setShowSchemaManager] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [inventoryStats, setInventoryStats] = useState<any>(null);

  // Knowledge tab state
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  // Refresh key to trigger InventoryTable reload
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (user) {
      fetchSchema();
      fetchInventoryStats();
    }
  }, [user]);

  useEffect(() => {
    if (user && activeTab === 'knowledge') {
      fetchKnowledge();
    }
  }, [user, activeTab]);

  const fetchSchema = async () => {
    try {
      const { data } = await client.get('/schema');
      setSchema(data.schema || { fields: [] });
    } catch (err) {
      console.error('Failed to fetch schema');
    }
  };

  const fetchInventoryStats = async () => {
    try {
      const { data } = await client.get('/catalog/stats');
      setInventoryStats(data);
    } catch (err) {
      console.error('Failed to fetch inventory stats');
    }
  };

  const fetchKnowledge = async () => {
    setKnowledgeLoading(true);
    try {
      const { data } = await client.get('/knowledge');
      setKnowledgeItems(data);
    } catch (err) {
      console.error('Failed to fetch knowledge');
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const handleAddKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    setAddingKnowledge(true);
    setKnowledgeError(null);
    try {
      await client.post('/knowledge', { content: newContent });
      setNewContent('');
      await fetchKnowledge();
    } catch (err: any) {
      setKnowledgeError(err.response?.data?.error || 'Failed to add knowledge');
    } finally {
      setAddingKnowledge(false);
    }
  };

  const handleDeleteKnowledge = async (id: string) => {
    try {
      await client.delete(`/knowledge/${id}`);
      setKnowledgeItems(knowledgeItems.filter(item => item.id !== id));
    } catch (err) {
      console.error('Failed to delete');
    }
  };

  const handleSaveSchema = async (newSchema: InventorySchema) => {
    try {
      await client.patch('/schema', { schema: newSchema });
      setSchema(newSchema);
      setShowSchemaManager(false);
    } catch (err) {
      console.error('Failed to save schema');
    }
  };

  const handleItemSaved = () => {
    setShowItemModal(false);
    setEditingItem(null);
    setRefreshKey(prev => prev + 1);
    fetchInventoryStats();
  };

  const handleDownload = async (type: 'all' | 'sold') => {
    try {
      const response = await client.get(`/catalog/export?type=${type}`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = type === 'sold' ? 'sold_report.xlsx' : 'inventory_export.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      if (err.response?.status === 404) {
        alert(type === 'sold' ? 'No sold items to export.' : 'No items to export.');
      } else {
        alert('Download failed. Please try again.');
      }
    }
  };

  const handleEditItem = (item: any) => {
    setEditingItem(item);
    setShowItemModal(true);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">AI Brain</h1>
          </div>
          <p className="text-muted-foreground text-lg italic">
            "Everything your AI knows about your business"
          </p>
        </div>

        {/* Stats pills */}
        {inventoryStats && activeTab === 'products' && (
          <div className="flex gap-3">
            <div className="bg-card border border-border/50 rounded-2xl px-5 py-3 text-center">
              <p className="text-2xl font-bold text-primary">{inventoryStats.available}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Available</p>
            </div>
            <div className="bg-card border border-border/50 rounded-2xl px-5 py-3 text-center">
              <p className="text-2xl font-bold text-red-400">{inventoryStats.sold}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Sold</p>
            </div>
            <div className="bg-card border border-border/50 rounded-2xl px-5 py-3 text-center">
              <p className="text-2xl font-bold text-foreground">{inventoryStats.total}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Total</p>
            </div>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border/50 pb-1">
        <button
          onClick={() => setActiveTab('products')}
          className={`flex items-center gap-2 px-6 py-3 rounded-t-xl font-semibold transition-all ${
            activeTab === 'products'
              ? 'bg-primary/10 text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="w-5 h-5" />
          Products
        </button>
        <button
          onClick={() => setActiveTab('knowledge')}
          className={`flex items-center gap-2 px-6 py-3 rounded-t-xl font-semibold transition-all ${
            activeTab === 'knowledge'
              ? 'bg-primary/10 text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          General Knowledge
        </button>
      </div>

      {/* Products Tab */}
      {activeTab === 'products' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Action bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => { setEditingItem(null); setShowItemModal(true); }}
              className="bg-primary hover:bg-primary/90 text-white font-bold px-5 py-3 rounded-2xl transition-all shadow-lg shadow-primary/20 flex items-center gap-2"
            >
              <Plus className="w-5 h-5" /> Add Item
            </button>
            <button
              onClick={() => setShowFileUpload(true)}
              className="bg-card border border-border/50 hover:border-green-500/30 text-foreground font-semibold px-5 py-3 rounded-2xl transition-all flex items-center gap-2"
            >
              <Upload className="w-5 h-5" /> Upload Excel/CSV
            </button>
            <button
              onClick={() => setShowSchemaManager(true)}
              className="bg-card border border-border/50 hover:border-primary/30 text-foreground font-semibold px-5 py-3 rounded-2xl transition-all flex items-center gap-2"
            >
              <Settings2 className="w-5 h-5" /> Manage Fields
            </button>

            {/* Download buttons — pushed to right */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => handleDownload('all')}
                className="bg-card border border-border/50 hover:border-blue-500/30 text-foreground font-semibold px-4 py-3 rounded-2xl transition-all flex items-center gap-2 text-sm"
              >
                <Download className="w-4 h-4 text-blue-400" /> Download Inventory
              </button>
              <button
                onClick={() => handleDownload('sold')}
                className="bg-card border border-border/50 hover:border-red-500/30 text-foreground font-semibold px-4 py-3 rounded-2xl transition-all flex items-center gap-2 text-sm"
              >
                <FileDown className="w-4 h-4 text-red-400" /> Sold Report
              </button>
            </div>
          </div>

          {/* Info banner about Excel sync */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex items-start gap-3">
            <Upload className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-blue-300">Excel Sync</p>
              <p className="text-muted-foreground">
                Upload your Excel to import inventory. Make changes here on the dashboard.
                Download anytime to get the updated Excel with all changes.
                Sold items are tracked with dates in the Sold Report.
              </p>
            </div>
          </div>

          {/* Schema hint if empty */}
          {schema.fields.length === 0 && (
            <div className="bg-card/50 border border-dashed border-primary/30 rounded-3xl p-8 text-center">
              <Settings2 className="w-12 h-12 text-primary/40 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">Set Up Your Inventory Fields</h3>
              <p className="text-muted-foreground mb-4">
                Define what fields each item should have (e.g., Brand, Model, Year, Color, Fuel Type)
              </p>
              <button
                onClick={() => setShowSchemaManager(true)}
                className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-3 rounded-2xl transition-all"
              >
                Configure Fields
              </button>
            </div>
          )}

          {/* Inventory Table */}
          {schema.fields.length > 0 && (
            <InventoryTable
              key={refreshKey}
              schema={schema}
              onEdit={handleEditItem}
              onRefresh={() => { setRefreshKey(prev => prev + 1); fetchInventoryStats(); }}
            />
          )}
        </motion.div>
      )}

      {/* Knowledge Tab */}
      {activeTab === 'knowledge' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Add Knowledge Form */}
            <div className="lg:col-span-1">
              <div className="bg-card border border-border/50 rounded-[2.5rem] p-8 sticky top-8 shadow-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
                    <Plus className="w-6 h-6 text-primary" />
                  </div>
                  <h2 className="text-xl font-bold">Add Context</h2>
                </div>
                <form onSubmit={handleAddKnowledge} className="space-y-6">
                  <textarea
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="Paste FAQs, business policies, working hours, EMI details, or any info your AI should know..."
                    className="w-full h-64 bg-muted/30 border border-border/50 rounded-2xl p-6 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none text-sm leading-relaxed"
                    required
                  />
                  {knowledgeError && (
                    <div className="text-red-400 text-xs flex items-center gap-2 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                      <AlertCircle className="w-4 h-4" /> {knowledgeError}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={addingKnowledge || !newContent.trim()}
                    className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {addingKnowledge ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Sparkles className="w-5 h-5" /> Sync to AI Brain</>}
                  </button>
                </form>
              </div>
            </div>

            {/* Knowledge List */}
            <div className="lg:col-span-2 space-y-6">
              {knowledgeLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <div key={i} className="h-32 bg-card/50 border border-border/20 rounded-3xl animate-pulse" />
                ))
              ) : knowledgeItems.length === 0 ? (
                <div className="text-center py-20 bg-card/30 border border-dashed border-border rounded-[3rem]">
                  <BookOpen className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-xl font-bold mb-2">Empty Library</h3>
                  <p className="text-muted-foreground">Add your first business context to train the AI.</p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {knowledgeItems.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="bg-card border border-border/50 rounded-3xl p-6 hover:border-primary/30 transition-all group relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl translate-x-16 -translate-y-16" />
                      <div className="flex items-start justify-between relative z-10">
                        <div className="flex gap-4">
                          <div className="w-12 h-12 bg-muted rounded-2xl flex items-center justify-center shrink-0">
                            <FileText className="w-6 h-6 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm leading-relaxed text-slate-300 mb-4 line-clamp-3 group-hover:line-clamp-none transition-all duration-500">
                              {item.content}
                            </p>
                            <div className="flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                              <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-primary" /> Vectorized</span>
                              <span>{new Date(item.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteKnowledge(item.id)}
                          className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Schema Manager Modal */}
      {showSchemaManager && (
        <SchemaManager
          schema={schema}
          onSave={handleSaveSchema}
          onClose={() => setShowSchemaManager(false)}
        />
      )}

      {/* Item Add/Edit Modal */}
      {showItemModal && (
        <ItemModal
          schema={schema}
          item={editingItem}
          onSave={handleItemSaved}
          onClose={() => { setShowItemModal(false); setEditingItem(null); }}
        />
      )}

      {/* File Upload Modal */}
      {showFileUpload && (
        <FileUpload
          onComplete={() => { setRefreshKey(prev => prev + 1); fetchInventoryStats(); fetchSchema(); }}
          onClose={() => setShowFileUpload(false)}
        />
      )}
    </div>
  );
};

export default AIBrain;
