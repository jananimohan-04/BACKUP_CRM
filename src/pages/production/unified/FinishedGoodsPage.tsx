import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { Badge, statusToVariant } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Package, Eye, Edit, Filter, Plus, Download, Upload, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Card';
import { Modal, FormField, inputClass } from '@/components/ui/Modal';
import { getMockImage } from '@/lib/mockStorage';
import { exportCsv } from '@/lib/reportExport';
import { todayISO } from '@/lib/format';
import { formatWorkOrderOption } from '@/lib/workOrderFormat';

const WO_STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Dispatched'];

export function FinishedGoodsPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('All Projects');
  const [customerFilter, setCustomerFilter] = useState('All Companies');
  const [statusFilter, setStatusFilter] = useState('Active Only');
  const [monthFilter, setMonthFilter] = useState('');

  const [filterOptions, setFilterOptions] = useState({
    projects: [] as string[],
    customers: [] as string[]
  });

  
  // Modals state

  const [showAddFG, setShowAddFG] = useState(false);
  const [showViewModal, setShowViewModal] = useState<any | null>(null);
  
  // NEW STATE FOR EDIT
  const [showEditModal, setShowEditModal] = useState<any | null>(null);
  const [editQty, setEditQty] = useState('');


  // Add FG Form state
  const [availableWOs, setAvailableWOs] = useState<any[]>([]);
  const [selectedWO, setSelectedWO] = useState('');
  const [addQty, setAddQty] = useState('');
  
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
    // Fetch production records
    const { data: woData, error: woError } = await supabase
      .from('cnc_work_orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (woError) console.error('Failed to load work orders:', woError);

    // Fetch part stock for FG stock
    const { data: partsData, error: partsError } = await supabase.from('cnc_parts').select('part_no, stock_qty');
    if (partsError) console.error('Failed to load parts:', partsError);

    if (woData) {
      // Map and enrich with stock (part orders are not finished product)
      const enriched = await Promise.all(woData.filter((w: any) => w.is_part_order !== true).map(async (wo: any) => {
        // A failing IndexedDB image lookup must not block the whole page from loading
        const mockImg = await getMockImage(wo.part_name).catch(() => null);
        const part = partsData?.find(p => p.part_no === wo.part_no);
        const orderedQty = Number(wo.quantity) || 0;
        const completedQty = Number(wo.completed) || 0;
        const pendingQty = Math.max(0, orderedQty - completedQty);
        const fgStock = part ? Number(part.stock_qty) || 0 : 0;
        
        return {
          ...wo,
          orderedQty,
          completedQty,
          pendingQty,
          fgStock,
          imgUrl: wo.image_url || wo.drawing_url || mockImg
        };
      }));

      // Only show records in the table that actually have finished goods or are fully completed
      const finalRecords = enriched.filter((w: any) => w.completedQty > 0 || w.status === 'Completed' || w.status === 'Ready' || w.status === 'Quality Hold');
      setRecords(finalRecords);

      // Fetch all global customers so the dropdown isn't just limited to current work orders
      const { data: globalCustomers } = await supabase.from('cnc_customers').select('name');
      const { data: globalLeads } = await supabase.from('cnc_enquiries').select('customer');

      const allCustomers = new Set([
        ...enriched.map((r: any) => r.customer),
        ...(globalCustomers || []).map((c: any) => c.name),
        ...(globalLeads || []).map((l: any) => l.customer)
      ].filter(Boolean));

      setFilterOptions({
        projects: Array.from(new Set(enriched.map((r: any) => r.sales_order).filter(Boolean))).sort() as string[],
        customers: Array.from(allCustomers).sort() as string[]
      });
      // Filter for Add FG modal (only orders that are not fully completed / dispatched)
      setAvailableWOs(enriched.filter(w => w.pendingQty > 0 && w.status !== 'Dispatched'));
    }
    } catch (err) {
      console.error('Failed to load finished goods:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStatusChange = async (order: any, newStatus: string) => {
    if (order.status === newStatus) return;
    try {
      const { error } = await supabase.from('cnc_work_orders').update({ status: newStatus }).eq('id', order.id);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert("Failed to update status: " + err.message);
    }
  };

  const handleSaveFG = async () => {
    if (!selectedWO || !addQty || saving) return;
    const wo = availableWOs.find(w => w.id === selectedWO);
    if (!wo) return;

    const qtyToAdd = Number(addQty);
    if (qtyToAdd <= 0) return alert("Quantity must be greater than zero.");
    if (qtyToAdd > wo.pendingQty) return alert(`Cannot add more than pending quantity (${wo.pendingQty}).`);

    const newCompleted = wo.completedQty + qtyToAdd;
    let newStatus = wo.status;
    if (newCompleted >= wo.orderedQty) newStatus = 'Completed';
    else if (newStatus === 'Planning' || newStatus === 'Planned') newStatus = 'In Progress';

    setSaving(true);
    const { error } = await supabase.from('cnc_work_orders').update({
      completed: newCompleted,
      status: newStatus
    }).eq('id', wo.id);
    setSaving(false);

    if (error) {
      alert("Failed to update Finished Goods: " + error.message);
    } else {
      setShowAddFG(false);
      setSelectedWO('');
      setAddQty('');
      fetchData();
    }
  };


  const handleEditFG = async () => {
    if (!showEditModal || saving) return;
    const newQty = Number(editQty);
    if (newQty < 0) return alert("Quantity cannot be negative.");
    if (newQty > showEditModal.orderedQty) return alert("Completed quantity cannot exceed target ordered quantity.");

    let newStatus = showEditModal.status;
    if (newQty >= showEditModal.orderedQty) {
      if (newStatus !== 'Dispatched') newStatus = 'Completed';
    } else if (newStatus === 'Completed' || newStatus === 'Dispatched') {
      // Completed qty reduced below the ordered qty: the order is no longer complete
      newStatus = newQty > 0 ? 'In Progress' : 'Planning';
    } else if (newQty > 0 && (newStatus === 'Planning' || newStatus === 'Planned')) {
      newStatus = 'In Progress';
    }

    setSaving(true);
    const { error } = await supabase.from('cnc_work_orders').update({
      completed: newQty,
      status: newStatus
    }).eq('id', showEditModal.id);
    setSaving(false);

    if (error) {
      alert("Failed to update Finished Goods: " + error.message);
    } else {
      setShowEditModal(null);
      setEditQty('');
      fetchData();
    }
  };

  // Global date filter (completion record date) intersects the page's own filters.
  const { inRange: inFGDateRange } = useGlobalDateFilter();
  const filteredRecords = records.filter(r => {
    const matchesSearch = (r.part_name?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesProject = projectFilter === 'All Projects' || r.sales_order === projectFilter;
    const matchesCustomer = customerFilter === 'All Companies' || r.customer === customerFilter;
    const matchesStatus = statusFilter === 'All' ? true :
                          statusFilter === 'Active Only' ? (r.status !== 'Dispatched' && r.status !== 'Delivered') :
                          r.status === statusFilter;
    const matchesMonth = monthFilter === '' ? true : (r.created_at && r.created_at.startsWith(monthFilter));
    const matchesDate = inFGDateRange(r.created_at);
    return matchesSearch && matchesProject && matchesCustomer && matchesStatus && matchesMonth && matchesDate;
  });

  // Summary cards reflect the currently filtered set
  const stats = useMemo(() => {
    const stockByPart = new Map<string, number>();
    filteredRecords.forEach((r: any) => { if (r.part_no) stockByPart.set(r.part_no, r.fgStock); });
    return {
      totalParts: stockByPart.size,
      completedQty: filteredRecords.reduce((sum: number, e: any) => sum + e.completedQty, 0),
      pendingQty: filteredRecords.reduce((sum: number, e: any) => sum + e.pendingQty, 0),
      totalFgStock: Array.from(stockByPart.values()).reduce((sum, v) => sum + v, 0),
    };
  }, [filteredRecords]);

  const statsScopeLabel = monthFilter
    ? `Orders created ${new Date(monthFilter + '-01').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
    : 'Filtered orders';

  const columns: Column<any>[] = [
    { key: 'part_name', label: 'Part Name', render: (r) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0 border border-slate-200">
            {r.imgUrl ? (
              <img src={r.imgUrl} alt="Part" className="w-full h-full object-cover" />
            ) : (
              <Package size={16} className="text-slate-400" />
            )}
          </div>
          <span className="text-slate-600 whitespace-nowrap">{r.part_name || 'N/A'}</span>
        </div>
      )
    },
    { 
      key: 'project', 
      label: 'Project',
      render: (r) => (
        <div className="min-w-[120px]">
          <div className="font-medium text-slate-700">{r.sales_order || 'N/A'}</div>
          <div className="text-xs text-slate-500 truncate max-w-[150px]">{r.description || 'Assembly'}</div>
        </div>
      )
    },
    { key: 'customer', label: 'Company', render: (r) => <span className="text-slate-600 min-w-[100px] block">{r.customer || 'N/A'}</span> },
    { key: 'orderedQty', label: 'Ordered Qty', sortable: true, render: (r) => <span className="text-slate-700">{r.orderedQty}</span> },
    { 
      key: 'completedQty', 
      label: 'Completed Qty', 
      sortable: true,
      render: (r) => {
        const percent = r.orderedQty > 0 ? Math.min(100, Math.round((r.completedQty / r.orderedQty) * 100)) : 0;
        return (
          <div className="flex flex-col gap-1 min-w-[100px]">
            <div className="flex justify-between items-end">
              <span className="font-bold text-slate-800">{r.completedQty}</span>
              <span className="text-[10px] text-slate-500 font-medium">{percent}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      }
    },
    { 
      key: 'pendingQty', 
      label: 'Pending Qty', 
      sortable: true,
      render: (r) => <span className={`font-medium ${r.pendingQty > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{r.pendingQty}</span>
    },
    { key: 'fgStock', label: 'FG Stock', sortable: true, render: (r) => <span className="text-slate-700">{r.fgStock}</span> },
    { 
      key: 'status', 
      label: 'Status', 
      sortable: true,
      render: (r) => (
        <div className="relative inline-block min-w-[100px] text-center">
          <select 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            value={r.status}
            onChange={(e) => handleStatusChange(r, e.target.value)}
          >
            {r.status && !WO_STATUSES.includes(r.status) && <option value={r.status}>{r.status}</option>}
            {WO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge>
        </div>
      )
    },
    { 
      key: 'created_at',
      label: 'Created',
      render: (r) => <span className="text-slate-500 text-sm whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}</span>
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setShowViewModal(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => { setShowEditModal(r); setEditQty(r.completedQty.toString()); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
        </div>
      )
    }
  ];

  const handleExport = () => {
    exportCsv(`Finished_Goods_${todayISO()}`, [
      ['Product Name', 'Company Name', 'Sales Order No', 'Batch No', 'Ordered Qty', 'Completed Qty', 'Pending Qty', 'FG Stock', 'Status'],
      ...filteredRecords.map((r: any) => [
        r.part_name || '',
        r.customer_name || '',
        r.sales_order_no || '',
        r.batch_no || '',
        r.orderedQty ?? 0,
        r.completedQty ?? 0,
        r.pendingQty ?? 0,
        r.fgStock ?? 0,
        r.status || '',
      ]),
    ]);
  };

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Finished Goods</h1>
          <p className="text-sm text-slate-500 mt-1">Track completed products, pending quantity and stock at a glance.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" className="gap-2 bg-white"><Filter size={16} /> Stock Report</Button>
          <Button variant="secondary" className="gap-2 bg-white" onClick={handleExport} title="Export CSV"><Upload size={16} /> Export</Button>
          <Button variant="primary" className="gap-2 bg-brand-600 hover:bg-brand-700 text-white shadow-sm shadow-brand-500/20" onClick={() => setShowAddFG(true)}>
            <Plus size={16} /> Add Finished Goods
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        {/* Total Parts */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <Package className="text-emerald-600" size={24} />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium">Total Parts</div>
            <div className="text-2xl font-bold text-slate-800">{stats.totalParts}</div>
            <div className="text-xs text-slate-400 mt-0.5">Distinct parts in view</div>
          </div>
        </div>
        {/* Completed Qty */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">✓</div>
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium">Completed Qty</div>
            <div className="text-2xl font-bold text-slate-800">{stats.completedQty.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-0.5">{statsScopeLabel}</div>
          </div>
        </div>
        {/* Pending Qty */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
            <div className="w-5 h-6 border-2 border-orange-500 rounded-sm relative flex flex-col justify-between p-0.5">
              <div className="w-full h-[2px] bg-orange-500" />
              <div className="w-full h-[2px] bg-orange-500" />
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium">Pending Qty</div>
            <div className="text-2xl font-bold text-slate-800">{stats.pendingQty.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-0.5">Yet to Complete</div>
          </div>
        </div>
        {/* Total FG Stock */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
            <Package className="text-purple-600" size={24} />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium">Total FG Stock</div>
            <div className="text-2xl font-bold text-slate-800">{stats.totalFgStock.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-0.5">In hand for parts in view</div>
          </div>
        </div>
      </div>

      {/* Filters & Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        {/* Filters */}
        <div className="p-4 border-b border-slate-100 grid grid-cols-1 md:grid-cols-5 gap-4 bg-white items-end">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Project</label>
            <select 
              className="w-full h-9 rounded-lg border border-slate-200 text-sm px-3 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
            >
              <option value="All Projects">All Projects</option>
              {filterOptions.projects.map(p => (
                <option key={p as string} value={p as string}>{p as string}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Company</label>
            <select 
              className="w-full h-9 rounded-lg border border-slate-200 text-sm px-3 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              value={customerFilter}
              onChange={e => setCustomerFilter(e.target.value)}
            >
              <option value="All Companies">All Companies</option>
              {filterOptions.customers.map(c => (
                <option key={c as string} value={c as string}>{c as string}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Part Name</label>
            <input 
              type="text" 
              placeholder="Search..."
              className="w-full h-9 rounded-lg border border-slate-200 text-sm px-3 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Status</label>
            <select 
              className="w-full text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="Active Only">Active (In Stock)</option>
              <option value="All">All Statuses (History)</option>
              {WO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-12 md:col-span-2">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Month</label>
            <input
              type="month"
              className="w-full text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
            />
          </div>
          <div className="col-span-12 md:col-span-1 flex items-end">
            <Button variant="secondary" className="h-9 w-full bg-white text-xs font-bold" onClick={() => {
              setSearchTerm(''); setProjectFilter('All Projects'); setCustomerFilter('All Companies'); setStatusFilter('Active Only'); setMonthFilter('');
            }}>Clear</Button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <DataTable
            data={filteredRecords}
            columns={columns}
            searchKeys={['part_name', 'wo_no', 'sales_order', 'customer', 'status']}
            emptyMessage={loading ? 'Loading finished goods...' : 'No finished goods found'}
          />
        </div>
      </div>

      {/* Add Finished Goods Modal */}
      <Modal open={showAddFG} onClose={() => setShowAddFG(false)} title="Finished Goods Entry" size="md" footer={
        <>
          <Button variant="secondary" onClick={() => setShowAddFG(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSaveFG} disabled={!selectedWO || !addQty || saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </>
      }>
        <div className="space-y-4">
          <FormField label="Production Order" required>
            <select className={inputClass} value={selectedWO} onChange={e => {
              setSelectedWO(e.target.value);
              const w = availableWOs.find(wo => wo.id === e.target.value);
              if (w) setAddQty(w.pendingQty.toString());
            }}>
              <option value="">Select Production Order...</option>
              {availableWOs.map(w => (
                <option key={w.id} value={w.id}>
                  {formatWorkOrderOption(w)} ({w.pendingQty} pending)
                </option>
              ))}
            </select>
          </FormField>
          
          {selectedWO && (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-sm text-slate-600 space-y-2">
              <div className="flex justify-between"><span>Company:</span> <span className="font-medium text-slate-800">{availableWOs.find(w=>w.id===selectedWO)?.customer}</span></div>
              <div className="flex justify-between"><span>Project:</span> <span className="font-medium text-slate-800">{availableWOs.find(w=>w.id===selectedWO)?.sales_order}</span></div>
              <div className="flex justify-between"><span>Target Qty:</span> <span className="font-medium text-slate-800">{availableWOs.find(w=>w.id===selectedWO)?.orderedQty}</span></div>
              <div className="flex justify-between"><span>Completed Qty:</span> <span className="font-medium text-slate-800">{availableWOs.find(w=>w.id===selectedWO)?.completedQty}</span></div>
            </div>
          )}

          <FormField label="Quantity to Complete" required>
            <input 
              type="number" 
              className={inputClass} 
              value={addQty} 
              onChange={e => setAddQty(e.target.value)} 
              max={availableWOs.find(w=>w.id===selectedWO)?.pendingQty}
              min="1"
            />
          </FormField>
        </div>
      </Modal>

      {/* Detail View Modal */}
      <Modal open={!!showViewModal} onClose={() => setShowViewModal(null)} title={`Finished Goods: ${showViewModal?.part_name ?? ''}`} size="2xl">
        {showViewModal && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Part Details</label>
                <div className="text-sm text-slate-600">{showViewModal.part_name}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Company / Project</label>
                <div className="text-sm font-semibold text-slate-800">{showViewModal.customer}</div>
                <div className="text-sm text-slate-600">{showViewModal.sales_order}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                <Badge variant={statusToVariant(showViewModal.status)} dot>{showViewModal.status}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
               <div>
                 <div className="text-xs text-slate-500">Ordered Qty</div>
                 <div className="text-lg font-bold text-slate-800">{showViewModal.orderedQty}</div>
               </div>
               <div>
                 <div className="text-xs text-slate-500">Completed Qty</div>
                 <div className="text-lg font-bold text-emerald-600">{showViewModal.completedQty}</div>
               </div>
               <div>
                 <div className="text-xs text-slate-500">Pending Qty</div>
                 <div className="text-lg font-bold text-rose-500">{showViewModal.pendingQty}</div>
               </div>
               <div>
                 <div className="text-xs text-slate-500">FG Stock</div>
                 <div className="text-lg font-bold text-purple-600">{showViewModal.fgStock}</div>
               </div>
            </div>

            {/* Document Flow Visualization */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2">Document Flow</h3>
              <div className="flex items-center justify-between px-2 text-center text-xs">
                 <div className="flex flex-col items-center gap-1 opacity-50">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center"><CheckCircle size={14}/></div>
                    <span>Sales Order<br/><span className="text-[10px] font-mono">{showViewModal.sales_order}</span></span>
                 </div>
                 <div className="h-px bg-slate-200 flex-1 mx-2" />
                 <div className="flex flex-col items-center gap-1 opacity-50">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center"><CheckCircle size={14}/></div>
                    <span>Production</span>
                 </div>
                 <div className="h-px bg-slate-200 flex-1 mx-2" />
                 <div className="flex flex-col items-center gap-1">
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center border-2 border-brand-500"><CheckCircle size={14}/></div>
                    <span className="font-bold text-brand-700">Finished Goods</span>
                 </div>
                 <div className="h-px bg-slate-200 flex-1 mx-2" />
                 <div className="flex flex-col items-center gap-1 opacity-50">
                    <div className="w-8 h-8 rounded-full border border-dashed border-slate-300 flex items-center justify-center"><Clock size={14} className="text-slate-400"/></div>
                    <span>Delivery<br/><span className="text-[10px] text-slate-400">Not Created</span></span>
                 </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-4">
               <Button variant="secondary">View Production</Button>
               <Button variant="primary">Create Delivery Challan</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Finished Goods Modal */}
      <Modal open={!!showEditModal} onClose={() => setShowEditModal(null)} title="Edit Finished Goods" size="md" footer={
        <>
          <Button variant="secondary" onClick={() => setShowEditModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleEditFG} disabled={!editQty || saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
        </>
      }>
        {showEditModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-sm text-slate-600 space-y-2">
              <div className="flex justify-between"><span>Part:</span> <span className="font-medium text-slate-800">{showEditModal.part_name}</span></div>
              <div className="flex justify-between"><span>Target Qty:</span> <span className="font-medium text-slate-800">{showEditModal.orderedQty}</span></div>
            </div>

            <FormField label="Update Completed Quantity" required>
              <input 
                type="number" 
                className={inputClass} 
                value={editQty} 
                onChange={e => setEditQty(e.target.value)} 
                max={showEditModal.orderedQty}
                min="0"
              />
            </FormField>
          </div>
        )}
      </Modal>
    </div>
  );
}
