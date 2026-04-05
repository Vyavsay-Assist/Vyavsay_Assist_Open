import React, { useState, useEffect } from 'react';
import client from '../api/client';
import { InventorySchema } from '../pages/AIBrain';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Trash2,
  Tag,
  Package,
  Loader2,
  XCircle,
  LayoutGrid,
  List,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  schema: InventorySchema;
  onEdit: (item: any) => void;
  onRefresh: () => void;
}

type ViewMode = 'grid' | 'table';

const InventoryTable: React.FC<Props> = ({ schema, onEdit, onRefresh }) => {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'available' | 'sold' | 'all'>('available');
  const [sort, setSort] = useState<string>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  useEffect(() => {
    fetchItems();
  }, [page, statusFilter, sort]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchItems();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: viewMode === 'grid' ? '12' : '25',
        status: statusFilter,
        sort,
      });
      if (search) params.set('search', search);

      const { data } = await client.get(`/catalog?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch (err) {
      console.error('Failed to fetch inventory');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkSold = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await client.patch(`/catalog/${id}/sold`);
      fetchItems();
      onRefresh();
    } catch (err) {
      console.error('Failed to mark as sold');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await client.delete(`/catalog/${id}`);
      fetchItems();
      onRefresh();
    } catch (err) {
      console.error('Failed to delete item');
    }
  };

  const handleEdit = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    onEdit(item);
  };

  const formatPrice = (price: number | null) => {
    if (!price) return '-';
    if (price >= 100000) return `${(price / 100000).toFixed(1)}L`;
    if (price >= 1000) return `${(price / 1000).toFixed(0)}K`;
    return price.toString();
  };

  const getImages = (item: any) => {
    const images = Array.isArray(item.images) ? item.images : [];
    return images.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  };

  const visibleFields = schema.fields.slice(0, 4);

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-border/50 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <XCircle className="w-5 h-5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 bg-card border border-border/50 rounded-2xl p-1">
          {(['available', 'sold', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all capitalize ${
                statusFilter === s ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="bg-card border border-border/50 rounded-2xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="name">Name A-Z</option>
        </select>

        {/* View toggle */}
        <div className="flex items-center gap-1 bg-card border border-border/50 rounded-2xl p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-primary text-white' : 'text-muted-foreground'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 rounded-xl transition-all ${viewMode === 'table' ? 'bg-primary text-white' : 'text-muted-foreground'}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        <span className="text-sm text-muted-foreground ml-auto">
          {total} item{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 bg-card/30 border border-dashed border-border rounded-3xl">
          <Package className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-xl font-bold mb-2">No Items Found</h3>
          <p className="text-muted-foreground">
            {search ? 'Try a different search term.' : 'Add your first inventory item to get started.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* ─── GRID VIEW ─── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <AnimatePresence>
            {items.map((item) => {
              const isSold = item.quantity <= 0 || !item.is_active;
              const images = getImages(item);
              const primaryImage = images[0];

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                  className={`bg-card border border-border/50 rounded-2xl overflow-hidden hover:border-primary/30 transition-all cursor-pointer group ${
                    isSold ? 'opacity-60' : ''
                  }`}
                >
                  {/* Image */}
                  <div className="relative aspect-[4/3] bg-muted/30 overflow-hidden">
                    {primaryImage?.url ? (
                      <img
                        src={primaryImage.url}
                        alt={item.item_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-12 h-12 text-muted-foreground/20" />
                      </div>
                    )}

                    {/* Status badge */}
                    <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest backdrop-blur-sm ${
                      isSold
                        ? 'bg-red-500/80 text-white'
                        : 'bg-green-500/80 text-white'
                    }`}>
                      {isSold ? 'Sold' : 'Available'}
                    </div>

                    {/* Image count */}
                    {images.length > 1 && (
                      <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-lg">
                        {images.length} photos
                      </div>
                    )}

                    {/* Quick actions overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={(e) => handleEdit(e, item)}
                          className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/40 transition-all"
                          title="Edit"
                        >
                          <Edit3 className="w-4 h-4 text-white" />
                        </button>
                        {!isSold && (
                          <button
                            onClick={(e) => handleMarkSold(e, item.id)}
                            className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-orange-500/60 transition-all"
                            title="Mark Sold"
                          >
                            <Tag className="w-4 h-4 text-white" />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDelete(e, item.id)}
                          className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-red-500/60 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-semibold text-sm mb-1 truncate">{item.item_name}</h3>

                    {item.category && (
                      <span className="text-[10px] bg-muted/50 px-2 py-0.5 rounded-md font-semibold text-muted-foreground uppercase tracking-widest">
                        {item.category}
                      </span>
                    )}

                    <div className="flex items-center justify-between mt-3">
                      <span className="text-lg font-bold text-primary">
                        {item.price ? `₹${formatPrice(item.price)}` : '—'}
                      </span>
                      <span className={`text-xs font-bold ${item.quantity > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        Qty: {item.quantity}
                      </span>
                    </div>

                    {/* Expanded details */}
                    {expandedItem === item.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-3 pt-3 border-t border-border/30 space-y-1"
                      >
                        {visibleFields.map(f => {
                          const val = item.attributes?.[f.key];
                          if (val === undefined || val === null || val === '') return null;
                          return (
                            <div key={f.key} className="flex justify-between text-xs">
                              <span className="text-muted-foreground">{f.label}</span>
                              <span className="font-semibold">{String(val)}</span>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        /* ─── TABLE VIEW ─── */
        <div className="bg-card border border-border/50 rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Image</th>
                  <th className="text-left px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Name</th>
                  <th className="text-left px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Category</th>
                  <th className="text-right px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Price</th>
                  <th className="text-center px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Qty</th>
                  {visibleFields.map(f => (
                    <th key={f.key} className="text-left px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                      {f.label}
                    </th>
                  ))}
                  <th className="text-center px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Status</th>
                  <th className="text-center px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isSold = item.quantity <= 0 || !item.is_active;
                  const primaryImage = getImages(item)[0];

                  return (
                    <tr key={item.id} className={`border-b border-border/20 hover:bg-muted/20 transition-colors ${isSold ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-4">
                        {primaryImage?.url ? (
                          <img src={primaryImage.url} alt={item.item_name} className="w-12 h-12 rounded-xl object-cover border border-border/50" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
                            <Package className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4"><p className="font-semibold text-sm">{item.item_name}</p></td>
                      <td className="px-6 py-4">
                        {item.category ? (
                          <span className="bg-muted/50 text-xs font-semibold px-3 py-1 rounded-lg">{item.category}</span>
                        ) : <span className="text-muted-foreground text-xs">-</span>}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-sm">{item.price ? `₹${formatPrice(item.price)}` : '-'}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`font-bold text-sm ${item.quantity <= 0 ? 'text-red-400' : 'text-green-400'}`}>{item.quantity}</span>
                      </td>
                      {visibleFields.map(f => (
                        <td key={f.key} className="px-6 py-4 text-sm text-slate-300">{item.attributes?.[f.key] ?? '-'}</td>
                      ))}
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-lg ${
                          isSold ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isSold ? 'bg-red-400' : 'bg-green-400'}`} />
                          {isSold ? 'Sold' : 'Available'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={(e) => handleEdit(e, item)} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl transition-all" title="Edit">
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {!isSold && (
                            <button onClick={(e) => handleMarkSold(e, item.id)} className="p-2 text-muted-foreground hover:text-orange-400 hover:bg-orange-500/10 rounded-xl transition-all" title="Mark Sold">
                              <Tag className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={(e) => handleDelete(e, item.id)} className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-xl bg-card border border-border/50 hover:bg-muted disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pageNum = page <= 3 ? i + 1 : page + i - 2;
              if (pageNum < 1 || pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-xl font-semibold text-sm transition-all ${
                    page === pageNum ? 'bg-primary text-white' : 'bg-card border border-border/50 hover:bg-muted'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-xl bg-card border border-border/50 hover:bg-muted disabled:opacity-30 transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryTable;
