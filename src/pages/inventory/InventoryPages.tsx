import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { Plus, Eye, Edit, Trash2, Boxes, ArrowRightLeft, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Package, MapPin, Building, Layout } from 'lucide-react';
import { PageHeader, FilterButton, ExportButton } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Card, Badge, Button, StatCard, statusToVariant } from '@/components/ui/Card';
import { Modal, ConfirmDialog, FormField, inputClass } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

// Mirrors the real cnc_raw_materials columns (the mockData RawMaterial type has fields the DB doesn't store).
interface RawMaterial {
  id: string;
  materialCode: string;
  name: string;
  grade: string;
  form: string;
  stockQty: number;
  uom: string;
  minStock: number;
  location: string;
  status: string;
  unitPrice?: number | null;
  preferred_supplier_id?: string | null;
}


export function RawMaterialsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<RawMaterial | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RawMaterial | null>(null);
  const [materialsData, setMaterialsData] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const resetForm = () => ({
      materialCode: '',
      name: '',
      grade: '',
      form: '',
      stockQty: '',
      uom: 'kg',
      minStock: '',
      location: '',
      status: 'In Stock',
      preferred_supplier_id: ''
    });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchMaterials() {
      try {
        const { data, error } = await supabase.from('cnc_raw_materials').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching raw materials:', error);
          setDbError(true);
          setMaterialsData([]);
        } else if (data) {
          setDbError(false);
          const formattedData: RawMaterial[] = data.map((d: any) => ({
            id: d.id,
            materialCode: d.material_code,
            name: d.name,
            grade: d.grade,
            form: d.form,
            stockQty: Number(d.stock_qty),
            uom: d.uom,
            minStock: Number(d.min_stock),
            location: d.location,
            status: d.status,
            unitPrice: d.unit_price,
            preferred_supplier_id: d.preferred_supplier_id,
          }));
          setMaterialsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
        setMaterialsData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMaterials();
      async function fetchSuppliers() {
        const { data } = await supabase.from('cnc_suppliers').select('id, name').eq('status', 'Active');
        if (data) setSuppliers(data);
      }
      fetchSuppliers();
  }, []);

  const handleEditClick = (r: RawMaterial) => {
    setFormData({
      materialCode: r.materialCode || '',
      name: r.name || '',
      grade: r.grade || '',
      form: r.form || '',
      stockQty: String(r.stockQty ?? ''),
      uom: r.uom || '',
      minStock: String(r.minStock ?? ''),
      preferred_supplier_id: r.preferred_supplier_id || '',
      location: r.location || '',
      status: r.status || 'In Stock'
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.materialCode) return;
    
    const qty = Number(formData.stockQty) || 0;
    const min = Number(formData.minStock) || 0;
    // Auto-calculate status if not explicitly set correctly, or just use form value
    const calculatedStatus = qty <= 0 ? 'Out of Stock' : (qty <= min ? 'Low Stock' : 'In Stock');

    const entryData = {
      material_code: formData.materialCode,
      name: formData.name,
      grade: formData.grade,
      form: formData.form,
      stock_qty: qty,
      uom: formData.uom,
      min_stock: min,
      location: formData.location,
      status: editId ? formData.status : calculatedStatus,
      preferred_supplier_id: formData.preferred_supplier_id || null
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_raw_materials').update(entryData).eq('id', editId);
      if (!error) {
        setMaterialsData(prev => prev.map(m => m.id === editId ? { 
          ...m, materialCode: entryData.material_code, name: entryData.name, grade: entryData.grade, form: entryData.form, stockQty: entryData.stock_qty, uom: entryData.uom, minStock: entryData.min_stock, location: entryData.location, status: entryData.status, preferred_supplier_id: entryData.preferred_supplier_id
        } : m));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        console.error("Update error:", error);
        alert(`Failed to update: ${error.message || JSON.stringify(error)}`);
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      
      const { error } = await supabase.from('cnc_raw_materials').insert([insertData]);
      if (!error) {
        const formatted: RawMaterial = {
          id: newId, materialCode: insertData.material_code, name: insertData.name, grade: insertData.grade, form: insertData.form, stockQty: insertData.stock_qty, uom: insertData.uom, minStock: insertData.min_stock, location: insertData.location, status: insertData.status, preferred_supplier_id: insertData.preferred_supplier_id
        };
        setMaterialsData([formatted, ...materialsData]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        console.error("Insert error:", error);
        alert(`Failed to add to database: ${error.message || JSON.stringify(error)}`);
      }
    }
    setLoading(false);
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    // Optimistic UI update
    setMaterialsData(prev => prev.map(m => m.id === id ? { ...m, status: newStatus as any } : m));
    
    // Update DB
    const { error } = await supabase.from('cnc_raw_materials').update({ status: newStatus }).eq('id', id);
    if (error) {
      console.error("Failed to update status", error);
      alert("Failed to update status.");
    }
  };

  const columns: Column<RawMaterial>[] = [
    { key: 'materialCode', label: 'Code', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-700">{r.materialCode}</span> },
    { key: 'name', label: 'Material Name', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.name}</span> },
    { key: 'grade', label: 'Grade', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.grade}</span> },
    { key: 'form', label: 'Form', render: (r) => <span className="text-xs text-slate-500">{r.form}</span> },
    { key: 'stockQty', label: 'Stock', sortable: true, align: 'right', render: (r) => <span className={`font-semibold ${r.stockQty <= r.minStock ? 'text-red-600' : 'text-slate-700'}`}>{r.stockQty} {r.uom}</span> },
    { key: 'location', label: 'Location', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.location}</span> },
    { 
      key: 'status', label: 'Status', sortable: true, render: (r) => (
        <select 
          value={r.status}
          onChange={(e) => handleStatusChange(r.id, e.target.value)}
          className={`text-xs font-medium rounded-full px-3 py-1 focus:ring-0 cursor-pointer outline-none appearance-none text-center ${
            r.status === 'In Stock' ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100' : 
            r.status === 'Low Stock' ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100' : 
            'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
          }`}
          style={{ backgroundImage: 'none' }}
        >
          <option value="In Stock" className="bg-white text-slate-800">● In Stock</option>
          <option value="Low Stock" className="bg-white text-slate-800">● Low Stock</option>
          <option value="Out of Stock" className="bg-white text-slate-800">● Out of Stock</option>
        </select>
      ) 
    },
    {
      key: 'actions', label: 'Actions', align: 'center', render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setViewTarget(r)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
          <button onClick={() => handleEditClick(r)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      )
    },
  ];

  const totalMaterials = materialsData.length;
  const inStock = materialsData.filter(m => m.stockQty > m.minStock).length;
  const lowStock = materialsData.filter(m => m.stockQty > 0 && m.stockQty <= m.minStock).length;
  const outOfStock = materialsData.filter(m => m.stockQty <= 0).length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Raw Materials" description="Manage raw material inventory and stock levels" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Materials" value={totalMaterials.toString()} icon={<Boxes size={20} />} accent="brand" />
        <StatCard label="In Stock" value={inStock.toString()} icon={<Package size={20} />} accent="success" />
        <StatCard label="Low Stock" value={lowStock.toString()} icon={<AlertTriangle size={20} />} accent="warning" />
        <StatCard label="Out of Stock" value={outOfStock.toString()} icon={<AlertTriangle size={20} />} accent="error" />
      </div>
      <DataTable data={materialsData} columns={columns} searchKeys={['materialCode', 'name', 'grade']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Material" filterOptions={[{ label: 'In Stock', value: 'In Stock' }, { label: 'Low Stock', value: 'Low Stock' }, { label: 'Out of Stock', value: 'Out of Stock' }]} />
      
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Material" : "New Raw Material"} subtitle={editId ? "Update material record" : "Add new material to inventory"} size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave}>{editId ? 'Update Material' : 'Save Material'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Material Code" required><input className={inputClass} value={formData.materialCode} onChange={e => setFormData({...formData, materialCode: e.target.value})} /></FormField>
          <FormField label="Material Name" required><input className={inputClass} value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Aluminum 7075" /></FormField>
          <FormField label="Grade"><input className={inputClass} value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})} /></FormField>
          <FormField label="Form (Shape)"><input className={inputClass} value={formData.form} onChange={e => setFormData({...formData, form: e.target.value})} placeholder="e.g. Round Bar Ø50" /></FormField>
          <FormField label="Current Stock Quantity" required><input type="number" className={inputClass} value={formData.stockQty} onChange={e => setFormData({...formData, stockQty: e.target.value})} /></FormField>
          <FormField label="Unit of Measure (UoM)"><input className={inputClass} value={formData.uom} onChange={e => setFormData({...formData, uom: e.target.value})} placeholder="kg, pcs, meters" /></FormField>
          <FormField label="Minimum Stock Alert"><input type="number" className={inputClass} value={formData.minStock} onChange={e => setFormData({...formData, minStock: e.target.value})} /></FormField>
          <FormField label="Storage Location"><input className={inputClass} value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} placeholder="e.g. Rack A1" /></FormField>
          {editId && ( <>
            <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Preferred Supplier</label>
            <select className={inputClass} value={formData.preferred_supplier_id} onChange={e => setFormData({...formData, preferred_supplier_id: e.target.value})}>
              <option value="">None</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <FormField label="Status">
              <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                <option>In Stock</option><option>Low Stock</option><option>Out of Stock</option>
              </select>
            </FormField>
          </>
          )}
        </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View Material Details" subtitle={viewTarget?.name}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Material Code</p><p className="font-mono text-slate-800">{viewTarget.materialCode}</p></div>
            <div><p className="text-slate-500 mb-1">Status</p><Badge variant={viewTarget.status === 'In Stock' ? 'success' : viewTarget.status === 'Low Stock' ? 'warning' : 'error'} dot>{viewTarget.status}</Badge></div>
            <div><p className="text-slate-500 mb-1">Grade</p><p className="font-medium text-slate-800">{viewTarget.grade}</p></div>
            <div><p className="text-slate-500 mb-1">Form</p><p className="text-slate-800">{viewTarget.form}</p></div>
            <div><p className="text-slate-500 mb-1">Stock Quantity</p><p className={`font-semibold ${viewTarget.stockQty <= viewTarget.minStock ? 'text-red-600' : 'text-slate-800'}`}>{viewTarget.stockQty} {viewTarget.uom}</p></div>
            <div><p className="text-slate-500 mb-1">Minimum Stock Level</p><p className="text-slate-800">{viewTarget.minStock} {viewTarget.uom}</p></div>
            <div><p className="text-slate-500 mb-1">Storage Location</p><p className="text-slate-800">{viewTarget.location}</p></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_raw_materials').delete().eq('id', deleteTarget.id);
            if (!error) {
              setMaterialsData(prev => prev.filter(m => m.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
            setDeleteTarget(null);
          }
        }} 
        title="Delete Material" 
        message={`Delete ${deleteTarget?.name}? This action cannot be undone.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

export function ComponentsPage() {
  const [componentsData, setComponentsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function fetchComponents() {
      try {
        const [{ data, error }, { data: bomData, error: bomError }] = await Promise.all([
          supabase.from('cnc_parts').select('*').order('created_at', { ascending: false }),
          supabase.from('cnc_bom').select('part_no, make'),
        ]);
        if (bomError) console.error('Error fetching BOM make/buy:', bomError);
        // Make/Buy lives on cnc_bom (keyed by part_no), not on cnc_parts.
        const makeByPartNo = new Map<string, string>();
        (bomData || []).forEach((b: any) => { if (b.part_no && b.make) makeByPartNo.set(b.part_no, b.make); });
        if (error) {
          console.error('Error fetching components:', error);
          setDbError(true);
          setComponentsData([]);
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            partNo: d.part_no,
            partName: d.part_name,
            category: d.category,
            status: d.status,
            make: makeByPartNo.get(d.part_no) || null,
          }));
          setComponentsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
        setComponentsData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchComponents();
  }, []);

  const totalComponents = componentsData.length;
  const makeComponents = componentsData.filter(c => String(c.make || '').toLowerCase() === 'make').length;
  const buyComponents = componentsData.filter(c => String(c.make || '').toLowerCase() === 'buy').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Components" description="Manufactured and bought-out components" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Components" value={totalComponents.toString()} icon={<Package size={20} />} accent="brand" />
        <StatCard label="Make" value={makeComponents.toString()} icon={<Package size={20} />} accent="accent" />
        <StatCard label="Buy" value={buyComponents.toString()} icon={<Package size={20} />} accent="navy" />
      </div>
      <DataTable 
        data={componentsData} 
        columns={[
          { key: 'partName', label: 'Part Name', render: (r) => <span className="font-medium">{r.partName}</span> },
          { key: 'category', label: 'Category', render: (r) => <span className="text-sm">{r.category}</span> },
          { key: 'make', label: 'Make / Buy', render: (r) => <span className="text-sm">{r.make || '—'}</span> },
          { key: 'status', label: 'Status', render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> }
        ]} 
        searchKeys={['partName']} 
      />
    </div>
  );
}

export function StockOverviewPage() {
  const [rmValue, setRmValue] = useState(0);
  const [fgValue, setFgValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function fetchValuations() {
      try {
        const [rmRes, fgRes] = await Promise.all([
          supabase.from('cnc_raw_materials').select('stock_qty, unit_price'),
          supabase.from('cnc_parts').select('stock_qty, unit_price')
        ]);

        if (rmRes.error || fgRes.error) {
          setDbError(true);
        } else {
          setDbError(false);
          const rmTotal = (rmRes.data || []).reduce((acc, curr) => acc + (Number(curr.stock_qty || 0) * Number(curr.unit_price ?? 0)), 0);
          const fgTotal = (fgRes.data || []).reduce((acc, curr) => acc + (Number(curr.stock_qty || 0) * Number(curr.unit_price ?? 0)), 0);
          setRmValue(rmTotal);
          setFgValue(fgTotal);
        }
      } catch (err) {
        console.error('Error computing stock valuation:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchValuations();
  }, []);

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `₹${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
    return `₹${val.toFixed(0)}`;
  };

  const totalValue = rmValue + fgValue;
  const rmPercentage = totalValue > 0 ? Math.round((rmValue / totalValue) * 100) : 0;
  const fgPercentage = totalValue > 0 ? Math.round((fgValue / totalValue) * 100) : 0;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Stock Overview" description="Complete inventory valuation and levels" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-4">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Total Inventory Value</h3>
          <p className="text-3xl font-bold text-brand-600">{formatCurrency(totalValue)}</p>
          <p className="text-sm text-slate-500 mt-2">Calculated from real-time stock</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Raw Material Value</h3>
          <p className="text-3xl font-bold text-accent-600">{formatCurrency(rmValue)}</p>
          <p className="text-sm text-slate-500 mt-2">{rmPercentage}% of total inventory</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Finished Goods Value</h3>
          <p className="text-3xl font-bold text-success-600">{formatCurrency(fgValue)}</p>
          <p className="text-sm text-slate-500 mt-2">{fgPercentage}% of total inventory</p>
        </Card>
      </div>
    </div>
  );
}

export function StockMovementsPage() {
  const [movementsData, setMovementsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function fetchMovements() {
      try {
        const { data, error } = await supabase.from('cnc_stock_movements').select('*').order('date', { ascending: false });
        if (error) {
          console.error('Error fetching movements:', error);
          setDbError(true);
          setMovementsData([]); // Removed fallback to mock data
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            date: new Date(d.date).toISOString().split('T')[0],
            type: d.type,
            material: d.material,
            qty: Number(d.qty),
            uom: d.uom,
            from: d.from,
            to: d.to,
            reference: d.reference,
            user: d.user,
          }));
          setMovementsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
        setMovementsData([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMovements();
  }, []);

  // Global date filter (movement date) drives the stats and the table together.
  const { inRange: inDateRange } = useGlobalDateFilter();
  const rangedMovements = useMemo(
    () => movementsData.filter((m: any) => inDateRange(m.date)),
    [movementsData, inDateRange],
  );
  const totalMovements = rangedMovements.length;
  const receipts = rangedMovements.filter(m => m.type === 'Receipt').length;
  const issues = rangedMovements.filter(m => m.type === 'Issue').length;
  const transfers = rangedMovements.filter(m => m.type === 'Transfer').length;

  const columns: Column<any>[] = [
    { key: 'date', label: 'Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.date}</span> },
    { key: 'type', label: 'Type', sortable: true, render: (r) => <Badge variant={r.type === 'Receipt' ? 'success' : r.type === 'Issue' ? 'warning' : 'info'}>{r.type}</Badge> },
    { key: 'material', label: 'Material', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.material}</span> },
    { key: 'qty', label: 'Qty', sortable: true, align: 'right', render: (r) => {
      // Issues are stored as a positive magnitude; show them as outflows regardless of stored sign.
      const signed = r.type === 'Issue' ? -Math.abs(r.qty) : r.qty;
      return <span className={`font-semibold ${signed < 0 ? 'text-red-600' : 'text-green-600'}`}>{signed > 0 ? '+' : ''}{signed} {r.uom}</span>;
    } },
    { key: 'from', label: 'From / To', render: (r) => <div><p className="text-xs text-slate-500">From: {r.from || '—'}</p><p className="text-xs text-slate-500">To: {r.to || '—'}</p></div> },
    { key: 'reference', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.reference || '—'}</span> },
    { key: 'user', label: 'User', render: (r) => <span className="text-sm">{r.user || '—'}</span> },
  ];

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Stock Movements" description="Track all inward, outward, and transfer movements" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<FilterButton /><ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Movements" value={totalMovements.toString()} icon={<ArrowRightLeft size={20} />} accent="brand" />
        <StatCard label="Receipts" value={receipts.toString()} icon={<ArrowDownToLine size={20} />} accent="success" />
        <StatCard label="Issues" value={issues.toString()} icon={<ArrowUpFromLine size={20} />} accent="warning" />
        <StatCard label="Transfers" value={transfers.toString()} icon={<ArrowRightLeft size={20} />} accent="info" />
      </div>
      <DataTable data={rangedMovements} columns={columns} searchKeys={['material', 'reference', 'type']} filterOptions={[{ label: 'Receipt', value: 'Receipt' }, { label: 'Issue', value: 'Issue' }, { label: 'Transfer', value: 'Transfer' }]} />
    </div>
  );
}

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewTarget, setViewTarget] = useState<any>(null);
  
  // States for Details View
  const [activeTab, setActiveTab] = useState('Overview');
  const [zones, setZones] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);

  // Forms
  const [whForm, setWhForm] = useState({ code: '', name: '', type: 'General', description: '', status: 'Active' });

  useEffect(() => {
    fetchWarehouses();
  }, []);

  async function fetchWarehouses() {
    setLoading(true);
    try {
      const { data } = await supabase.from('cnc_warehouses').select('*').order('created_at', { ascending: true });
      if (data) setWarehouses(data);
    } catch (e) {
      console.error("Error fetching warehouses", e);
    }
    setLoading(false);
  }

  const handleSaveWH = async () => {
    if (!whForm.code || !whForm.name) return alert("Code and Name are required");
    const { error } = await supabase.from('cnc_warehouses').insert([whForm]);
    if (error) return alert("Error saving warehouse: " + error.message + "\nMake sure you ran the SQL migration script!");
    setShowAdd(false);
    fetchWarehouses();
  };

  const loadWarehouseDetails = async (wh: any) => {
    setViewTarget(wh);
    setActiveTab('Overview');
    
    // Fetch Zones
    const { data: zData } = await supabase.from('cnc_warehouse_zones').select('*').eq('warehouse_id', wh.id);
    setZones(zData || []);
    
    // Fetch Locations if zones exist
    if (zData && zData.length > 0) {
       const zoneIds = zData.map((z:any) => z.id);
       const { data: lData } = await supabase.from('cnc_warehouse_locations').select('*').in('zone_id', zoneIds);
       setLocations(lData || []);
       
       if (lData && lData.length > 0) {
          const locIds = lData.map((l:any) => l.id);
          
          // Fetch RM Inventory
          const { data: rmData } = await supabase.from('cnc_raw_materials').select('*, loc:location_id(*)').in('location_id', locIds);
          
          // Fetch Parts Inventory 
          const { data: pData } = await supabase.from('cnc_parts').select('*, loc:location_id(*)').in('location_id', locIds);
          
          const combined = [
             ...(rmData || []).map((rm:any) => ({ ...rm, item_type: 'Raw Material', code: rm.material_code, title: rm.name, qty: rm.stock_qty, unit: rm.uom })),
             ...(pData || []).map((p:any) => ({ ...p, item_type: 'Component', code: p.part_no, title: p.part_name, qty: p.stock_qty, unit: p.unit }))
          ];
          setInventory(combined);
       } else {
          setInventory([]);
       }
    } else {
       setLocations([]);
       setInventory([]);
    }
  };

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader 
        title="Warehouses" 
        description="Manage storage locations, zones, and primary inventory placement"
        actions={<Button onClick={() => setShowAdd(true)}><Plus size={16}/> Add Warehouse</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
         <StatCard label="Total Warehouses" value={warehouses.length.toString()} icon={<Building size={20} className="text-brand-500"/>} />
         <StatCard label="Active Warehouses" value={warehouses.filter(w => w.status==='Active').length.toString()} icon={<Layout size={20} className="text-emerald-500"/>} />
      </div>

      <Card>
        <DataTable 
          data={warehouses}
          columns={[
            { key: 'code', label: 'Warehouse Code', render: (r) => <span className="font-mono text-brand-600 font-medium">{r.code}</span> },
            { key: 'name', label: 'Warehouse Name', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'type', label: 'Type' },
            { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'Active' ? 'success' : 'neutral'}>{r.status}</Badge> },
            { key: 'actions', label: 'Actions', align: 'right', render: (r) => (
                <Button variant="secondary" onClick={() => loadWarehouseDetails(r)}><Eye size={14}/> View</Button>
            ) }
          ]}
          searchKeys={['code', 'name', 'type', 'status']}
        />
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="ADD WAREHOUSE" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSaveWH}>Save Warehouse</Button></>}>
         <div className="space-y-4">
            <FormField label="Warehouse Code" required><input className={inputClass} value={whForm.code} onChange={e => setWhForm({...whForm, code: e.target.value})} placeholder="e.g. WH-001" /></FormField>
            <FormField label="Warehouse Name" required><input className={inputClass} value={whForm.name} onChange={e => setWhForm({...whForm, name: e.target.value})} placeholder="e.g. Main Plant Warehouse" /></FormField>
            <div className="space-y-1"><label className="text-xs font-medium text-slate-700">Type</label>
               <select className={inputClass} value={whForm.type} onChange={e => setWhForm({...whForm, type: e.target.value})}>
                  <option>General</option>
                  <option>Raw Material</option>
                  <option>Finished Goods</option>
                  <option>Quarantine</option>
               </select>
            </div>
            <FormField label="Description"><input className={inputClass} value={whForm.description} onChange={e => setWhForm({...whForm, description: e.target.value})} /></FormField>
         </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={viewTarget?.name} subtitle={viewTarget?.code} size="xl">
         {viewTarget && (
            <div>
               <div className="flex gap-4 border-b border-slate-200 mb-4 pb-0">
                  {['Overview', 'Zones & Locations', 'Inventory'].map(tab => (
                     <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{tab}</button>
                  ))}
               </div>

               {activeTab === 'Overview' && (
                  <div className="space-y-3">
                     <div className="grid grid-cols-3 gap-4">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Total Zones</p>
                           <p className="text-2xl font-bold text-slate-800">{zones.length}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Total Locations</p>
                           <p className="text-2xl font-bold text-slate-800">{locations.length}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                           <p className="text-xs text-slate-500 font-semibold mb-1">Stored Products</p>
                           <p className="text-2xl font-bold text-brand-600">{inventory.length}</p>
                        </div>
                     </div>
                     <div>
                        <p className="text-sm text-slate-600"><strong>Type:</strong> {viewTarget.type}</p>
                        <p className="text-sm text-slate-600"><strong>Status:</strong> {viewTarget.status}</p>
                        <p className="text-sm text-slate-600"><strong>Description:</strong> {viewTarget.description || 'N/A'}</p>
                     </div>
                  </div>
               )}

               {activeTab === 'Zones & Locations' && (
                  <div>
                     <p className="text-sm text-slate-500 mb-4">View the hierarchical storage layout for this warehouse. Currently supporting primary locations.</p>
                     <div className="space-y-4">
                        {zones.length === 0 ? <p className="text-slate-400 text-sm">No zones configured yet.</p> : zones.map(z => {
                           const zLocs = locations.filter(l => l.zone_id === z.id);
                           return (
                              <div key={z.id} className="border border-slate-200 rounded-xl overflow-hidden">
                                 <div className="bg-slate-50 px-4 py-3 flex justify-between items-center border-b border-slate-200">
                                    <div className="flex items-center gap-2">
                                       <MapPin size={16} className="text-slate-400" />
                                       <span className="font-bold text-slate-800">{z.name}</span>
                                       <span className="text-xs font-mono text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">{z.code}</span>
                                    </div>
                                 </div>
                                 <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {zLocs.length === 0 ? <p className="text-xs text-slate-400 col-span-4">No locations in this zone.</p> : zLocs.map(l => (
                                       <div key={l.id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col gap-1">
                                          <span className="font-mono text-xs text-brand-600 font-semibold">{l.code}</span>
                                          <span className="text-sm text-slate-700">{l.name}</span>
                                          <Badge variant={l.status === 'Available' ? 'success' : 'neutral'}>{l.status}</Badge>
                                       </div>
                                    ))}
                                 </div>
                              </div>
                           )
                        })}
                     </div>
                  </div>
               )}

               {activeTab === 'Inventory' && (
                  <div>
                     <p className="text-sm text-slate-500 mb-4">Showing all materials that have their Primary Location assigned to this warehouse.</p>
                     <DataTable 
                        data={inventory}
                        columns={[
                           { key: 'item_type', label: 'Type', render: (r) => <Badge variant={r.item_type === 'Raw Material' ? 'neutral' : 'warning'}>{r.item_type}</Badge> },
                           { key: 'code', label: 'Product Code', render: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span> },
                           { key: 'title', label: 'Product Name', render: (r) => <span className="font-medium text-slate-800">{r.title}</span> },
                           { key: 'loc', label: 'Zone / Location', render: (r) => {
                              const loc = locations.find(l => l.id === r.location_id);
                              const zone = loc ? zones.find(z => z.id === loc.zone_id) : null;
                              if (!loc || !zone) return <span className="text-slate-400">-</span>;
                              return <span className="text-sm"><span className="text-slate-400">{zone.code} / </span><span className="font-semibold text-brand-700">{loc.code}</span></span>;
                           }},
                           { key: 'qty', label: 'Total Stock Qty', align: 'right', render: (r) => <span className="font-bold text-slate-800">{r.qty} {r.unit}</span> }
                        ]}
                        searchKeys={['code', 'title', 'item_type']}
                     />
                  </div>
               )}
            </div>
         )}
      </Modal>
    </div>
  );
}

export function MaterialRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [rawMaterialsList, setRawMaterialsList] = useState<any[]>([]);
  const [selectedWo, setSelectedWo] = useState('');
  const [viewTarget, setViewTarget] = useState<any>(null);
  
  const resetForm = () => ({
    requestNo: `MR-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    requestDate: new Date().toISOString().split('T')[0],
    requiredDate: '',
    priority: 'Normal',
    remarks: '',
    partName: '',
    productionQty: 0,
    items: [] as any[]
  });
  
  const [reqForm, setReqForm] = useState(resetForm());
  const [saving, setSaving] = useState(false);
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const { profile } = useAuth();
  const userName = profile?.full_name || '';
  // Global date filter (request date).
  const { inRange: inRequestDateRange } = useGlobalDateFilter();
  const rangedRequests = useMemo(
    () => requests.filter((r: any) => inRequestDateRange(r.request_date ?? r.created_at)),
    [requests, inRequestDateRange],
  );

  useEffect(() => {
    fetchRequests();
    fetchWorkOrders();
    fetchRawMaterials();
  }, []);

  async function fetchRequests() {
    setLoading(true);
    try {
       const { data } = await supabase.from('cnc_material_requests').select('*, items:cnc_material_request_items(*)').order('created_at', { ascending: false });
       if (data) setRequests(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }
  
  async function fetchWorkOrders() {
    const { data } = await supabase.from('cnc_work_orders').select('*').neq('status', 'Completed');
    if (data) setWorkOrders(data);
  }

  async function fetchRawMaterials() {
    const { data } = await supabase.from('cnc_raw_materials').select('*');
    if (data) setRawMaterialsList(data);
  }

  const handleWoChange = async (woId: string) => {
    setSelectedWo(woId);
    if (!woId) return;
    const wo = workOrders.find(w => w.id === woId);
    if (!wo) return;
    
    // Auto load from BOM
    const { data: bomData } = await supabase.from('cnc_bom').select('*').eq('parent_part_no', wo.part_no);
    
    const items: any[] = [];
    if (bomData && bomData.length > 0) {
       bomData.forEach((bom: any) => {
          const rm = rawMaterialsList.find(r => (r.name === bom.material || r.material_code === bom.material)) || {};
          items.push({
             id: crypto.randomUUID(),
             materialName: bom.material || '',
             materialCode: rm.material_code || '',
             requiredQty: Number(bom.quantity) * Number(wo.quantity),
             uom: bom.unit || 'Nos',
             availableStock: rm.stock_qty || 0,
             requestQty: Number(bom.quantity) * Number(wo.quantity),
             warehouse: rm.location || 'Main Warehouse',
             purpose: 'Production',
             remarks: ''
          });
       });
    }

    setReqForm({
       ...reqForm,
       partName: wo.part_name,
       productionQty: wo.quantity,
       items
    });
  };

  const handleAddItem = () => {
    setReqForm({
      ...reqForm,
      items: [...reqForm.items, { id: crypto.randomUUID(), materialName: '', materialCode: '', requiredQty: 0, uom: 'Nos', availableStock: 0, requestQty: 0, warehouse: 'Main Warehouse', purpose: 'Production', remarks: '' }]
    });
  };
  
  const updateItem = (id: string, field: string, val: any) => {
     setReqForm({
        ...reqForm,
        items: reqForm.items.map(i => i.id === id ? { ...i, [field]: val } : i)
     });
  };

  const handleSave = async () => {
     if (saving) return;
     const wo = workOrders.find(w => w.id === selectedWo);
     if (!wo && reqForm.items.length === 0) return alert("Please select a Work Order or add materials manually.");
     setSaving(true);
     try {
       const { data, error } = await supabase.from('cnc_material_requests').insert([{
          request_no: reqForm.requestNo,
          request_date: reqForm.requestDate,
          work_order_id: wo?.id || null,
          work_order_no: wo?.wo_no || 'MANUAL',
          part_name: wo?.part_name || reqForm.partName,
          production_qty: wo?.quantity || reqForm.productionQty,
          requested_by: userName,
          required_date: reqForm.requiredDate || reqForm.requestDate,
          priority: reqForm.priority,
          remarks: reqForm.remarks,
          status: 'Pending'
       }]).select();

       if (error) { console.error(error); alert("Error creating material request: " + error.message); return; }

       if (data && data.length > 0 && reqForm.items.length > 0) {
          const reqId = data[0].id;
          const itemsToInsert = reqForm.items.map(i => ({
             request_id: reqId,
             material_name: i.materialName,
             material_code: i.materialCode,
             required_qty: Number(i.requiredQty) || 0,
             uom: i.uom,
             request_qty: Number(i.requestQty) || 0,
             warehouse: i.warehouse,
             purpose: i.purpose,
             remarks: i.remarks
          }));
          const { error: itemsError } = await supabase.from('cnc_material_request_items').insert(itemsToInsert);
          if (itemsError) {
             console.error(itemsError);
             // Don't leave a header without its items.
             const { error: cleanupError } = await supabase.from('cnc_material_requests').delete().eq('id', reqId);
             if (cleanupError) console.error('Failed to roll back material request header:', cleanupError);
             alert("Error saving request items: " + itemsError.message);
             return;
          }
       }

       setShowAdd(false);
       setReqForm(resetForm());
       setSelectedWo('');
       fetchRequests();
     } finally {
       setSaving(false);
     }
  };

  // NOTE: not atomic - stock updates, movements and the status change are separate requests (no DB/RPC changes allowed here).
  // Everything is validated up front so a partial issue is unlikely, and double clicks are guarded.
  const handleIssue = async (req: any) => {
     if (issuingId) return;
     if (req.status !== 'Pending') return;
     if (!confirm("Are you sure you want to issue these materials? This will deduct stock and create stock movements.")) return;
     setIssuingId(req.id);
     try {
       // 1. Resolve every item to a raw material row and validate stock before changing anything.
       const plan: { item: any; rm: any; qty: number }[] = [];
       const problems: string[] = [];
       for (const item of req.items || []) {
          const qty = Number(item.request_qty) || 0;
          if (qty <= 0) continue;
          let rm: any = null;
          if (item.material_code) {
             const { data, error } = await supabase.from('cnc_raw_materials').select('*').eq('material_code', item.material_code).limit(1);
             if (error) { problems.push(`${item.material_name}: ${error.message}`); continue; }
             rm = data?.[0] || null;
          }
          if (!rm && item.material_name) {
             const { data, error } = await supabase.from('cnc_raw_materials').select('*').eq('name', item.material_name).limit(1);
             if (error) { problems.push(`${item.material_name}: ${error.message}`); continue; }
             rm = data?.[0] || null;
          }
          if (!rm) { problems.push(`${item.material_name || item.material_code}: not found in raw materials`); continue; }
          // Account for the same material appearing on several lines.
          const alreadyPlanned = plan.filter(p => p.rm.id === rm.id).reduce((a, p) => a + p.qty, 0);
          const available = Number(rm.stock_qty || 0) - alreadyPlanned;
          if (qty > available) { problems.push(`${rm.name}: requested ${qty} ${item.uom || rm.uom || ''}, only ${available} in stock`); continue; }
          plan.push({ item, rm, qty });
       }
       if (problems.length > 0) {
          alert("Cannot issue stock:\n" + problems.join('\n'));
          return;
       }
       if (plan.length === 0) { alert("Nothing to issue on this request."); return; }

       // 2. Issue through the stock ledger: the database checks stock again, records the Production
       //    Issue movements, updates balances and marks the request Issued — all or nothing.
       const { error: issueError } = await supabase.rpc('erp_issue_material', {
          p_request_id: String(req.id),
          p_lines: plan.map(({ rm, qty }) => ({ raw_material_id: String(rm.id), qty })),
       });
       if (issueError) { console.error(issueError); alert('Could not issue stock: ' + issueError.message); return; }
     } finally {
       setIssuingId(null);
       fetchRequests();
     }
  };

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader 
        title="Material Requests" 
        description="Manage production material requirements and stores issues" 
        actions={<Button onClick={() => { setReqForm(resetForm()); setSelectedWo(''); setShowAdd(true); }}><Plus size={16}/> Create Request</Button>}
      />

      <Card className="mb-3">
        <DataTable 
          data={rangedRequests}
          columns={[
            { key: 'request_no', label: 'Request No', render: (r) => <span className="font-mono text-brand-600 font-medium">{r.request_no}</span> },
            { key: 'work_order_no', label: 'Work Order', render: (r) => <span className="font-semibold">{r.work_order_no}</span> },
            { key: 'part_name', label: 'Part/Product' },
            { key: 'request_date', label: 'Date', render: (r) => new Date(r.request_date).toLocaleDateString() },
            { key: 'required_date', label: 'Required By', render: (r) => <span className={new Date(r.required_date) < new Date() && r.status === 'Pending' ? 'text-red-500 font-medium' : ''}>{new Date(r.required_date).toLocaleDateString()}</span> },
            { key: 'priority', label: 'Priority', render: (r) => <Badge variant={r.priority === 'Urgent' ? 'error' : r.priority === 'High' ? 'warning' : 'neutral'}>{r.priority}</Badge> },
            { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'Pending' ? 'warning' : r.status === 'Issued' ? 'success' : 'neutral'}>{r.status}</Badge> },
            { key: 'actions', label: 'Actions', align: 'right', render: (r) => (
                <div className="flex justify-end gap-2">
                   <Button variant="secondary" onClick={() => setViewTarget(r)}><Eye size={14}/></Button>
                   {r.status === 'Pending' && <Button variant="primary" disabled={!!issuingId} onClick={() => handleIssue(r)}>{issuingId === r.id ? 'Issuing...' : 'Issue Stock'}</Button>}
                </div>
            ) }
          ]}
          searchKeys={['request_no', 'work_order_no', 'part_name', 'status']}
        />
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="CREATE MATERIAL REQUEST" size="xl" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</Button></>}>
         <div className="space-y-3">
            <div className="p-4 bg-brand-50 border border-brand-100 rounded-xl mb-4">
              <label className="block text-xs font-bold text-brand-700 uppercase mb-2">REQUEST FOR (WORK ORDER)</label>
              <select value={selectedWo} onChange={(e) => handleWoChange(e.target.value)} className={inputClass}>
                 <option value="">-- Select Work Order --</option>
                 {workOrders.map(w => (
                    <option key={w.id} value={w.id}>{w.wo_no} - {w.part_name} (Qty: {w.quantity})</option>
                 ))}
              </select>
              <p className="text-xs text-brand-600 mt-2">Selecting a Work Order automatically loads required materials from its BOM.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               <FormField label="Request No"><input type="text" className={inputClass} value={reqForm.requestNo} disabled /></FormField>
               <FormField label="Request Date"><input type="date" className={inputClass} value={reqForm.requestDate} disabled /></FormField>
               <FormField label="Required Date" required><input type="date" className={inputClass} value={reqForm.requiredDate} onChange={e => setReqForm({...reqForm, requiredDate: e.target.value})} /></FormField>
               <div className="space-y-1"><label className="text-xs font-medium text-slate-700">Priority</label><select value={reqForm.priority} onChange={e => setReqForm({...reqForm, priority: e.target.value})} className={inputClass}><option>Normal</option><option>High</option><option>Urgent</option></select></div>
               <FormField label="Part / Product"><input type="text" className={inputClass} value={reqForm.partName} onChange={e => setReqForm({...reqForm, partName: e.target.value})} /></FormField>
               <FormField label="Production Qty"><input type="number" className={inputClass} value={reqForm.productionQty.toString()} onChange={e => setReqForm({...reqForm, productionQty: Number(e.target.value)})} /></FormField>
               <FormField label="Requested By"><input type="text" className={inputClass} value={userName} readOnly /></FormField>
               <FormField label="Remarks"><input type="text" className={inputClass} value={reqForm.remarks} onChange={e => setReqForm({...reqForm, remarks: e.target.value})} /></FormField>
            </div>

            <div>
               <div className="flex items-center justify-between mb-3">
                 <h3 className="text-sm font-bold text-slate-800">MATERIALS REQUIRED</h3>
                 <Button variant="secondary" onClick={handleAddItem}><Plus size={14}/> Add Material</Button>
               </div>
               
               <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                  <table className="w-full text-left text-sm">
                     <thead className="bg-slate-100 border-b border-slate-200 text-slate-600">
                        <tr>
                           <th className="p-3 font-semibold text-xs">Material / Component</th>
                           <th className="p-3 font-semibold text-xs">Code</th>
                           <th className="p-3 font-semibold text-xs text-right">Req Qty</th>
                           <th className="p-3 font-semibold text-xs text-right">Avail Stock</th>
                           <th className="p-3 font-semibold text-xs text-right">Request Qty</th>
                           <th className="p-3 font-semibold text-xs">UOM</th>
                           <th className="p-3 font-semibold text-xs">Warehouse</th>
                           <th className="p-3 font-semibold text-xs"></th>
                        </tr>
                     </thead>
                     <tbody>
                        {reqForm.items.length === 0 ? (
                           <tr><td colSpan={8} className="p-4 text-center text-slate-400">No materials loaded. Select a Work Order or add manually.</td></tr>
                        ) : reqForm.items.map((item) => (
                           <tr key={item.id} className="border-b border-slate-100 last:border-0 bg-white">
                              <td className="p-2"><input type="text" value={item.materialName} onChange={e => updateItem(item.id, 'materialName', e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-sm outline-none focus:border-brand-500" placeholder="Material Name"/></td>
                              <td className="p-2"><input type="text" value={item.materialCode} onChange={e => updateItem(item.id, 'materialCode', e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-sm outline-none" placeholder="Code"/></td>
                              <td className="p-2"><input type="number" value={item.requiredQty} onChange={e => updateItem(item.id, 'requiredQty', e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-sm text-right outline-none bg-slate-50" readOnly={!!selectedWo}/></td>
                              <td className="p-2 text-right font-semibold text-slate-600">{item.availableStock}</td>
                              <td className="p-2"><input type="number" value={item.requestQty} onChange={e => updateItem(item.id, 'requestQty', e.target.value)} className={`w-full px-2 py-1 border border-slate-200 rounded text-sm text-right outline-none focus:border-brand-500 ${item.requestQty > item.availableStock ? 'border-red-500 bg-red-50 text-red-600 font-bold' : ''}`} /></td>
                              <td className="p-2"><input type="text" value={item.uom} onChange={e => updateItem(item.id, 'uom', e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-sm outline-none w-16" /></td>
                              <td className="p-2"><input type="text" value={item.warehouse} onChange={e => updateItem(item.id, 'warehouse', e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-sm outline-none" /></td>
                              <td className="p-2"><button onClick={() => setReqForm({...reqForm, items: reqForm.items.filter(i => i.id !== item.id)})} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={14}/></button></td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </div>
         </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={`MATERIAL REQUEST: ${viewTarget?.request_no}`} size="xl">
         {viewTarget && (
            <div className="space-y-3">
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div><p className="text-xs text-slate-500 font-medium">Work Order</p><p className="font-bold text-slate-800">{viewTarget.work_order_no}</p></div>
                  <div><p className="text-xs text-slate-500 font-medium">Part Name</p><p className="font-semibold text-slate-800">{viewTarget.part_name}</p></div>
                  <div><p className="text-xs text-slate-500 font-medium">Required By</p><p className="font-medium text-slate-800">{new Date(viewTarget.required_date).toLocaleDateString()}</p></div>
                  <div><p className="text-xs text-slate-500 font-medium">Status</p><Badge variant={viewTarget.status === 'Pending' ? 'warning' : 'success'}>{viewTarget.status}</Badge></div>
               </div>
               
               <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-3">REQUESTED MATERIALS</h4>
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                     <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                           <tr>
                              <th className="p-3 font-semibold text-xs">Material / Component</th>
                              <th className="p-3 font-semibold text-xs">Code</th>
                              <th className="p-3 font-semibold text-xs text-right">Requested Qty</th>
                              <th className="p-3 font-semibold text-xs">UOM</th>
                              <th className="p-3 font-semibold text-xs">Warehouse</th>
                           </tr>
                        </thead>
                        <tbody>
                           {viewTarget.items?.map((item: any) => (
                              <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                 <td className="p-3 font-medium text-slate-800">{item.material_name}</td>
                                 <td className="p-3 text-slate-600">{item.material_code || '-'}</td>
                                 <td className="p-3 text-right font-bold text-brand-600">{item.request_qty}</td>
                                 <td className="p-3 text-slate-600">{item.uom}</td>
                                 <td className="p-3 text-slate-600">{item.warehouse}</td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
         )}
      </Modal>
    </div>
  );
}

export function LowStockPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPRModal, setShowPRModal] = useState(false);
  const [prTarget, setPrTarget] = useState<any>(null);

  const { profile } = useAuth();
  const [savingPR, setSavingPR] = useState(false);
  const [prForm, setPrForm] = useState({
    prNo: 'PR-2026-' + Math.floor(1000 + Math.random() * 9000),
    qty: 0,
    requiredDate: '',
    remarks: ''
  });

  useEffect(() => {
    fetchAlerts();
  }, []);

  async function fetchAlerts() {
    setLoading(true);
    try {
      // 1. Fetch raw materials and parts
      const { data: rmData } = await supabase.from('cnc_raw_materials').select('*');
      const { data: partData } = await supabase.from('cnc_parts').select('*');
      
      const allItems = [
        ...(rmData || []).map((rm:any) => ({ code: rm.material_code, name: rm.name, stockQty: Number(rm.stock_qty || 0), minStock: Number(rm.min_stock || 0), uom: rm.uom, type: 'Raw Material' })),
        ...(partData || []).map((p:any) => ({ code: p.part_no, name: p.part_name, stockQty: Number(p.stock_qty || 0), minStock: Number(p.min_stock || 5), uom: p.unit, type: 'Component' }))
      ];

      // Filter low stock
      const lowStockItems = allItems.filter(item => item.stockQty <= item.minStock);

      // 2. Fetch pending material requests to see if production needs these
      const { data: reqData } = await supabase.from('cnc_material_request_items').select('material_code, material_name, request_qty, cnc_material_requests!inner(status)').eq('cnc_material_requests.status', 'Pending');
      
      const enrichedAlerts = lowStockItems.map(item => {
         // sum pending requests for this material
         const pendingReqs = (reqData || []).filter((r:any) => r.material_name === item.name || r.material_code === item.code);
         const totalPendingQty = pendingReqs.reduce((acc: number, curr: any) => acc + Number(curr.request_qty || 0), 0);
         
         let suggestedOrderQty = (item.minStock - item.stockQty) + totalPendingQty;
         if (suggestedOrderQty < 0) suggestedOrderQty = 0;
         if (suggestedOrderQty === 0 && item.stockQty < item.minStock) suggestedOrderQty = item.minStock;

         return {
            ...item,
            pendingReqQty: totalPendingQty,
            suggestedOrderQty,
            status: item.stockQty === 0 ? 'Out of Stock' : 'Low Stock'
         };
      });

      setAlerts(enrichedAlerts);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const openPR = (item: any) => {
    setPrTarget(item);
    setPrForm({
      prNo: 'PR-2026-' + Math.floor(1000 + Math.random() * 9000),
      qty: item.suggestedOrderQty || 0,
      requiredDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      remarks: 'Generated from Low Stock Alert'
    });
    setShowPRModal(true);
  };

  const handleSavePR = async () => {
    if (savingPR) return;
    if (!prTarget || !prForm.qty || !prForm.requiredDate) return alert('Please fill required fields.');
    setSavingPR(true);
    try {
      // Save to cnc_purchase_requisitions
      const { data, error } = await supabase.from('cnc_purchase_requisitions').insert([{
        pr_no: prForm.prNo,
        pr_date: new Date().toISOString().split('T')[0],
        requested_by: profile?.full_name || '',
        department: 'Stores',
        status: 'Pending Approval',
        source_type: 'Low Stock Alert',
        source_reference: prTarget?.code,
        remarks: prForm.remarks
      }]).select();

      if (error) { console.error(error); return alert('Error saving PR: ' + error.message); }

      if (data && data.length > 0) {
        const prId = data[0].id;
        const { error: itemError } = await supabase.from('cnc_purchase_requisition_items').insert([{
           pr_id: prId,
           material_code: prTarget.code,
           material_name: prTarget.name,
           qty: prForm.qty,
           uom: prTarget.uom,
           required_date: prForm.requiredDate
        }]);
        if (itemError) {
          console.error(itemError);
          const { error: cleanupError } = await supabase.from('cnc_purchase_requisitions').delete().eq('id', prId);
          if (cleanupError) console.error('Failed to roll back PR header:', cleanupError);
          return alert('Error saving PR item: ' + itemError.message);
        }
      }

      setShowPRModal(false);
      alert('Purchase Requisition ' + prForm.prNo + ' generated successfully!');
    } finally {
      setSavingPR(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Low Stock Alerts" description="Products below minimum stock level and active production shortages" />
      
      {loading ? (
        <div className="p-8 text-center text-slate-500">Scanning inventory levels...</div>
      ) : (
        <Card>
          <DataTable 
            data={alerts}
            columns={[
              { key: 'code', label: 'Product Code', render: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span> },
              { key: 'name', label: 'Material / Component', render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
              { key: 'stockQty', label: 'Current Stock', align: 'right', render: (r) => <span className="font-bold text-red-600">{r.stockQty} <span className="text-xs font-normal text-slate-500">{r.uom}</span></span> },
              { key: 'minStock', label: 'Min Stock', align: 'right', render: (r) => <span className="text-slate-500">{r.minStock}</span> },
              { key: 'pendingReqQty', label: 'Pending Prod. Requests', align: 'right', render: (r) => (
                 r.pendingReqQty > 0 
                  ? <span className="text-amber-600 font-bold bg-amber-50 px-2 py-1 rounded">{r.pendingReqQty}</span>
                  : <span className="text-slate-300">-</span>
              )},
              { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'Out of Stock' ? 'error' : 'warning'}>{r.status}</Badge> },
              { key: 'actions', label: 'Action Needed', align: 'right', render: (r) => (
                 <Button variant="primary" size="sm" onClick={() => openPR(r)}>Create PR</Button>
              )}
            ]}
            searchKeys={['code', 'name', 'type', 'status']}
          />
        </Card>
      )}

      <Modal open={showPRModal} onClose={() => setShowPRModal(false)} title="CREATE PURCHASE REQUISITION" subtitle={prTarget?.name} footer={<><Button variant="secondary" onClick={() => setShowPRModal(false)}>Cancel</Button><Button onClick={handleSavePR} disabled={savingPR}>{savingPR ? 'Submitting...' : 'Submit PR'}</Button></>}>
        {prTarget && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h4 className="text-sm font-bold text-amber-800 mb-2">Shortage Analysis</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-amber-700 block">Current Stock</span><span className="font-bold text-amber-900">{prTarget.stockQty} {prTarget.uom}</span></div>
                <div><span className="text-amber-700 block">Minimum Stock</span><span className="font-bold text-amber-900">{prTarget.minStock} {prTarget.uom}</span></div>
                <div><span className="text-amber-700 block">Pending Requests</span><span className="font-bold text-amber-900">{prTarget.pendingReqQty} {prTarget.uom}</span></div>
              </div>
              <p className="text-xs text-amber-700 mt-3 pt-3 border-t border-amber-200">
                Suggested Order Qty = (Min Stock - Current Stock) + Pending Requests
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <FormField label="PR Number"><input type="text" className={inputClass} value={prForm.prNo} disabled /></FormField>
               <FormField label="Material"><input type="text" className={inputClass} value={prTarget.name} disabled /></FormField>
               <FormField label="Order Quantity" required><input type="number" className={inputClass} value={prForm.qty} onChange={e => setPrForm({...prForm, qty: Number(e.target.value)})} /></FormField>
               <FormField label="Required Date" required><input type="date" className={inputClass} value={prForm.requiredDate} onChange={e => setPrForm({...prForm, requiredDate: e.target.value})} /></FormField>
               <div className="col-span-2"><FormField label="Remarks"><input type="text" className={inputClass} value={prForm.remarks} onChange={e => setPrForm({...prForm, remarks: e.target.value})} /></FormField></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
