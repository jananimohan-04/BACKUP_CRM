import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Eye, Edit, Trash2, Boxes, FileText, Cog, ShieldCheck, GitBranch, Download } from 'lucide-react';
import { PageHeader, ExportButton, DateSelector } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Card, Badge, Button, StatCard, statusToVariant } from '@/components/ui/Card';
import { Modal, ConfirmDialog, FormField, inputClass } from '@/components/ui/Modal';
import type { PartMaster, RevisionRecord, BOMItem, RoutingOp } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';

type ParentPart = { part_no: string; part_name: string; material: string | null; revision: string | null };

// Parent part selection shared by BOM / Routing / Work Instructions (records are keyed by parent_part_no)
function useParentParts() {
  const [parentParts, setParentParts] = useState<ParentPart[]>([]);
  const [parentPartNo, setParentPartNo] = useState('');

  useEffect(() => {
    supabase.from('cnc_parts').select('part_no, part_name, material, revision').order('part_no').then(({ data, error }) => {
      if (error) console.error('Error fetching parts:', error);
      const list = (data || []).filter((p: any) => p.part_no) as ParentPart[];
      setParentParts(list);
      setParentPartNo(prev => prev || list[0]?.part_no || '');
    });
  }, []);

  const parentPart = parentParts.find(p => p.part_no === parentPartNo) || null;
  return { parentParts, parentPartNo, setParentPartNo, parentPart };
}

function ParentPartSelect({ parts, value, onChange }: { parts: ParentPart[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className="text-sm rounded-md border border-slate-200 bg-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/20" value={value} onChange={e => onChange(e.target.value)}>
      {parts.length === 0 && <option value="">No parts in Part Master</option>}
      {parts.map(p => <option key={p.part_no} value={p.part_no}>{p.part_no} — {p.part_name}</option>)}
    </select>
  );
}

export function PartsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<PartMaster | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartMaster | null>(null);
  const [partsData, setPartsData] = useState<PartMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const resetForm = () => ({
    partNo: `XX-PP-${Math.floor(100 + Math.random() * 900)}`,
    partName: '', drawingNo: '', revision: 'R0', material: 'Inconel 718', category: 'Aerospace', surfaceFinish: 'Ra 1.6', tolerance: '±0.02mm', weight: '', unit: 'kg', status: 'Active'
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchParts() {
      try {
        const { data, error } = await supabase.from('cnc_parts').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching parts:', error);
          setDbError(true);
          setPartsData([]);
        } else if (data) {
          setDbError(false);
          const formattedData: PartMaster[] = data.map((d: any) => ({
            id: d.id,
            partNo: d.part_no,
            partName: d.part_name,
            drawingNo: d.drawing_no,
            revision: d.revision,
            material: d.material,
            surfaceFinish: d.surface_finish,
            tolerance: d.tolerance,
            category: d.category,
            weight: Number(d.weight),
            unit: d.unit,
            status: d.status,
          }));
          setPartsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchParts();
  }, []);

  const handleEditClick = (r: PartMaster) => {
    setFormData({
      partNo: r.partNo,
      partName: r.partName,
      drawingNo: r.drawingNo || '',
      revision: r.revision || '',
      material: r.material,
      category: r.category,
      surfaceFinish: r.surfaceFinish || '',
      tolerance: r.tolerance || '',
      weight: r.weight.toString(),
      unit: r.unit || 'kg',
      status: r.status
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.partName || !formData.partNo) return;

    const entryData = {
      part_no: formData.partNo,
      part_name: formData.partName,
      drawing_no: formData.drawingNo || `DWG-${formData.partNo}-R0`,
      revision: formData.revision,
      material: formData.material,
      surface_finish: formData.surfaceFinish,
      tolerance: formData.tolerance,
      category: formData.category,
      weight: Number(formData.weight) || 0,
      unit: formData.unit,
      status: formData.status
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_parts').update(entryData).eq('id', editId);
      if (!error) {
        setPartsData(prev => prev.map(p => p.id === editId ? { 
          ...p, partNo: entryData.part_no, partName: entryData.part_name, drawingNo: entryData.drawing_no, revision: entryData.revision, material: entryData.material, surfaceFinish: entryData.surface_finish, tolerance: entryData.tolerance, category: entryData.category, weight: entryData.weight, unit: entryData.unit, status: entryData.status as any
        } : p));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update.");
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { error } = await supabase.from('cnc_parts').insert([insertData]);
      
      if (!error) {
        const formatted: PartMaster = {
          id: newId,
          partNo: insertData.part_no,
          partName: insertData.part_name,
          drawingNo: insertData.drawing_no,
          revision: insertData.revision,
          material: insertData.material,
          surfaceFinish: insertData.surface_finish,
          tolerance: insertData.tolerance,
          category: insertData.category,
          weight: insertData.weight,
          unit: insertData.unit,
          status: 'Active'
        };
        setPartsData([formatted, ...partsData]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database. Check connection or SQL script.");
      }
    }
    setLoading(false);
  };

  const columns: Column<PartMaster>[] = [
    { key: 'partName', label: 'Part Name', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.partName}</span> },
    { key: 'drawingNo', label: 'Drawing No', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-500">{r.drawingNo}</span> },
    { key: 'revision', label: 'Rev', sortable: true, align: 'center', render: (r) => <Badge variant="info">{r.revision}</Badge> },
    { key: 'material', label: 'Material', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.material}</span> },
    { key: 'surfaceFinish', label: 'Surface Finish', render: (r) => <span className="text-xs text-slate-500">{r.surfaceFinish}</span> },
    { key: 'tolerance', label: 'Tolerance', render: (r) => <span className="text-xs font-mono text-slate-600">{r.tolerance}</span> },
    { key: 'weight', label: 'Weight', align: 'right', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.weight} {r.unit}</span> },
    { key: 'category', label: 'Category', sortable: true, render: (r) => <Badge variant="neutral">{r.category}</Badge> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> },
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

  const activeCount = partsData.filter(p => p.status === 'Active').length;
  const prototypeCount = partsData.filter(p => p.status === 'Prototype').length;
  const obsoleteCount = partsData.filter(p => p.status === 'Obsolete').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Part Master" description="Central registry of all manufactured parts" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Parts" value={partsData.length.toString()} icon={<Boxes size={20} />} accent="brand" />
        <StatCard label="Active" value={activeCount.toString()} icon={<Boxes size={20} />} accent="success" />
        <StatCard label="Prototypes" value={prototypeCount.toString()} icon={<Boxes size={20} />} accent="warning" />
        <StatCard label="Obsolete" value={obsoleteCount.toString()} icon={<Boxes size={20} />} accent="neutral" />
      </div>
      <DataTable data={partsData} columns={columns} searchKeys={['partName', 'drawingNo', 'material']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Part" filterOptions={[{ label: 'Active', value: 'Active' }, { label: 'Prototype', value: 'Prototype' }, { label: 'Obsolete', value: 'Obsolete' }]} />
      
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Part" : "New Part Master"} subtitle={editId ? "Update part specifications" : "Register a new part in the system"} size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update Part' : 'Save Part'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Part Name" required><input className={inputClass} value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} /></FormField>
          <FormField label="Drawing Number"><input className={inputClass} value={formData.drawingNo} onChange={e => setFormData({...formData, drawingNo: e.target.value})} placeholder="DWG-XX-000-R0" /></FormField>
          <FormField label="Revision" required><input className={inputClass} value={formData.revision} onChange={e => setFormData({...formData, revision: e.target.value})} /></FormField>
          <FormField label="Material Grade" required>
            <select className={inputClass} value={formData.material} onChange={e => setFormData({...formData, material: e.target.value})}>
              <option>Inconel 718</option><option>Aluminum 7075-T6</option><option>Aluminum 6061-T6</option><option>SS 316L</option><option>SS 304</option><option>Hastelloy C-276</option><option>Titanium Ti-6Al-4V</option><option>EN24 Alloy Steel</option><option>EN31 Bearing Steel</option><option>Cast Iron GG25</option>
            </select>
          </FormField>
          <FormField label="Category">
            <select className={inputClass} value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
              <option>Aerospace</option><option>Automotive</option><option>Defense</option><option>Space</option><option>Industrial</option>
            </select>
          </FormField>
          <FormField label="Surface Finish"><input className={inputClass} value={formData.surfaceFinish} onChange={e => setFormData({...formData, surfaceFinish: e.target.value})} /></FormField>
          <FormField label="Tolerance"><input className={inputClass} value={formData.tolerance} onChange={e => setFormData({...formData, tolerance: e.target.value})} /></FormField>
          <FormField label="Weight (kg)"><input type="number" step="0.01" className={inputClass} value={formData.weight} onChange={e => setFormData({...formData, weight: e.target.value})} /></FormField>
          <FormField label="UOM">
            <select className={inputClass} value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
              <option>kg</option><option>PC</option><option>SET</option>
            </select>
          </FormField>
          {editId && (
            <FormField label="Status">
              <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                <option>Active</option><option>Prototype</option><option>Obsolete</option>
              </select>
            </FormField>
          )}
        </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View Part Specifications" subtitle={viewTarget?.partName}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Part Name</p><p className="font-semibold text-slate-800">{viewTarget.partName}</p></div>
            <div><p className="text-slate-500 mb-1">Status</p><Badge variant={statusToVariant(viewTarget.status)} dot>{viewTarget.status}</Badge></div>
            <div><p className="text-slate-500 mb-1">Drawing No</p><p className="font-mono text-slate-700">{viewTarget.drawingNo}</p></div>
            <div><p className="text-slate-500 mb-1">Revision</p><Badge variant="info">{viewTarget.revision}</Badge></div>
            <div><p className="text-slate-500 mb-1">Material</p><p className="text-slate-800">{viewTarget.material}</p></div>
            <div><p className="text-slate-500 mb-1">Category</p><Badge variant="neutral">{viewTarget.category}</Badge></div>
            <div><p className="text-slate-500 mb-1">Weight</p><p className="text-slate-800">{viewTarget.weight} {viewTarget.unit}</p></div>
            <div><p className="text-slate-500 mb-1">Tolerance</p><p className="font-mono text-slate-800">{viewTarget.tolerance}</p></div>
            <div className="col-span-2"><p className="text-slate-500 mb-1">Surface Finish</p><p className="text-slate-800">{viewTarget.surfaceFinish}</p></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_parts').delete().eq('id', deleteTarget.id);
            if (!error) {
              setPartsData(prev => prev.filter(p => p.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Part" 
        message={`Delete part ${deleteTarget?.partName}? This action cannot be undone and will affect BOMs.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

export function DrawingsPage() {
  // There is no drawings table: drawings are derived from the Part Master (drawing_no / revision)
  // and the revision log (cnc_revisions).
  const [drawings, setDrawings] = useState<{ id: string; drawingNo: string; partName: string; revision: string; material: string; status: string }[]>([]);
  const [revStats, setRevStats] = useState({ pending: 0, superseded: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDrawings() {
      try {
        const [partsRes, revRes] = await Promise.all([
          supabase.from('cnc_parts').select('id, part_name, drawing_no, revision, material, status').order('drawing_no'),
          supabase.from('cnc_revisions').select('drawing_no, status'),
        ]);
        if (partsRes.error) console.error('Error fetching parts:', partsRes.error);
        if (revRes.error) console.error('Error fetching revisions:', revRes.error);
        setDrawings((partsRes.data || []).filter((p: any) => p.drawing_no).map((p: any) => ({
          id: p.id, drawingNo: p.drawing_no, partName: p.part_name, revision: p.revision || '—', material: p.material || '', status: p.status || 'Active',
        })));
        const revs = revRes.data || [];
        setRevStats({
          pending: revs.filter((r: any) => r.status === 'Pending').length,
          superseded: revs.filter((r: any) => r.status === 'Superseded').length,
        });
      } finally {
        setLoading(false);
      }
    }
    fetchDrawings();
  }, []);

  const totalDrawings = new Set(drawings.map(d => d.drawingNo)).size;
  const withRevision = drawings.filter(d => d.revision && d.revision !== '—').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="CAD / Drawing Management" description="Engineering drawings registered in the Part Master" actions={<div className="flex items-center gap-2">{loading && <Badge variant="neutral">Syncing...</Badge>}<ExportButton /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Drawings" value={totalDrawings.toString()} icon={<FileText size={20} />} accent="brand" />
        <StatCard label="With Revision" value={withRevision.toString()} icon={<FileText size={20} />} accent="success" />
        <StatCard label="Pending Approval" value={revStats.pending.toString()} icon={<FileText size={20} />} accent="warning" />
        <StatCard label="Superseded" value={revStats.superseded.toString()} icon={<FileText size={20} />} accent="neutral" />
      </div>
      {!loading && drawings.length === 0 && (
        <div className="px-5 py-8 text-center text-slate-500 bg-white rounded-xl shadow-sm border border-slate-200">No drawings yet. Add a drawing number to a part in the Part Master.</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {drawings.map((p) => (
          <Card key={p.id} className="overflow-hidden hover:shadow-card-hover transition-shadow group">
            <div className="aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
              <div className="w-full h-full bg-grid-dark opacity-10" />
              <svg className="absolute inset-0 w-full h-full p-6" viewBox="0 0 200 150">
                <rect x="40" y="30" width="120" height="90" fill="none" stroke="#475569" strokeWidth="1.5" rx="4" />
                <circle cx="100" cy="75" r="25" fill="none" stroke="#475569" strokeWidth="1.5" />
                <circle cx="100" cy="75" r="15" fill="none" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="40" y1="30" x2="30" y2="20" stroke="#94a3b8" strokeWidth="0.5" />
                <line x1="160" y1="30" x2="170" y2="20" stroke="#94a3b8" strokeWidth="0.5" />
                <line x1="40" y1="120" x2="30" y2="130" stroke="#94a3b8" strokeWidth="0.5" />
                <line x1="160" y1="120" x2="170" y2="130" stroke="#94a3b8" strokeWidth="0.5" />
              </svg>
              <div className="absolute top-2 right-2"><Badge variant={statusToVariant(p.status)} dot>{p.status}</Badge></div>
              <div className="absolute bottom-2 left-2"><Badge variant="info">{p.revision}</Badge></div>
            </div>
            <div className="p-4">
              <p className="font-mono text-xs text-slate-500">{p.drawingNo}</p>
              <h3 className="text-sm font-semibold text-slate-800 mt-1">{p.partName}</h3>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-400">{p.material}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function BOMPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<BOMItem & { id: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BOMItem & { id: string } | null>(null);
  const [bomData, setBomData] = useState<(BOMItem & { id: string })[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const { parentParts, parentPartNo, setParentPartNo, parentPart } = useParentParts();

  const resetForm = () => ({
    level: '1', projectName: '', partNo: '', partName: '', material: '', quantity: '1', unit: 'PC', make: 'Make', operation: ''
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    if (!parentPartNo) { setBomData([]); setLoading(false); return; }
    async function fetchBOM() {
      setLoading(true);
      try {
        const [bomRes, projectsRes] = await Promise.all([
          supabase.from('cnc_bom').select('*').eq('parent_part_no', parentPartNo).order('level', { ascending: true }).order('created_at', { ascending: true }),
          supabase.from('cnc_enquiries').select('lead_no').not('lead_no', 'is', null)
        ]);

        if (projectsRes.data) {
          const uniqueProjects = Array.from(new Set(projectsRes.data.map(p => p.lead_no).filter(Boolean)));
          setProjects(uniqueProjects);
        }

        if (bomRes.error) {
          console.error('Error fetching BOM:', bomRes.error);
          setDbError(true);
          setBomData([]);
        } else if (bomRes.data) {
          setDbError(false);
          const formattedData = bomRes.data.map((d: any) => ({
            id: d.id,
            level: d.level,
            projectName: d.project_name || '',
            partNo: d.part_no,
            partName: d.part_name,
            material: d.material,
            quantity: Number(d.quantity),
            unit: d.unit,
            make: d.make,
            operation: d.operation,
          }));
          setBomData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchBOM();
  }, [parentPartNo]);

  const handleEditClick = (r: BOMItem & { id: string }) => {
    setFormData({
      level: r.level.toString(),
      projectName: r.projectName || '',
      partNo: r.partNo,
      partName: r.partName,
      material: r.material,
      quantity: r.quantity.toString(),
      unit: r.unit,
      make: r.make,
      operation: r.operation || ''
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.partName) return;
    if (!parentPartNo) return alert('Select a parent part first.');

    const effectivePartNo = formData.partNo || `${formData.partName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'PART'}-${Math.floor(100 + Math.random() * 900)}`;

    const entryData = {
      parent_part_no: parentPartNo,
      level: Number(formData.level) || 1,
      project_name: formData.projectName,
      part_no: effectivePartNo,
      part_name: formData.partName,
      material: formData.material,
      quantity: Number(formData.quantity) || 1,
      unit: formData.unit,
      make: formData.make,
      operation: formData.operation
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_bom').update(entryData).eq('id', editId);
      if (!error) {
        setBomData(prev => prev.map(b => b.id === editId ? { 
          ...b, level: entryData.level, projectName: entryData.project_name, partNo: entryData.part_no, partName: entryData.part_name, material: entryData.material, quantity: entryData.quantity, unit: entryData.unit, make: entryData.make, operation: entryData.operation
        } : b).sort((a, b) => a.level - b.level));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update: " + (error?.message || JSON.stringify(error)));
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { data, error } = await supabase.from('cnc_bom').insert([insertData]).select().single();
      if (!error && data) {
        const formatted = {
          id: data.id, level: data.level, projectName: data.project_name || '', partNo: data.part_no, partName: data.part_name, material: data.material, quantity: data.quantity, unit: data.unit, make: data.make, operation: data.operation
        };
        setBomData([...bomData, formatted].sort((a, b) => a.level - b.level));
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database: " + (error?.message || JSON.stringify(error)));
      }
    }
    setLoading(false);
  };

  const handleExport = () => {
    const csvContent = "data:text/csv;charset=utf-8," + 
      "Level,Part Name,Material,Quantity,UOM,Make/Buy,Operation\n" +
      bomData.map(e => `${e.level},"${e.partName}","${e.material}",${e.quantity},${e.unit},${e.make},"${e.operation}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BOM_${parentPartNo || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const makeItemsCount = bomData.filter(b => b.make === 'Make').length;
  const buyItemsCount = bomData.filter(b => b.make === 'Buy').length;
  const maxLevel = Math.max(0, ...bomData.map(b => b.level));

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Bill of Materials" description={parentPart ? `Multi-level BOM for ${parentPart.part_name}` : 'Multi-level BOM — select a parent part'} actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<ParentPartSelect parts={parentParts} value={parentPartNo} onChange={setParentPartNo} /><Button size="sm" icon={<Plus size={14} />} disabled={!parentPartNo} onClick={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }}>Add Component</Button><Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={handleExport}>Export</Button></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="BOM Levels" value={maxLevel.toString()} icon={<Boxes size={20} />} accent="brand" />
        <StatCard label="Total Components" value={bomData.length.toString()} icon={<Boxes size={20} />} accent="accent" />
        <StatCard label="Make Products" value={makeItemsCount.toString()} icon={<Cog size={20} />} accent="navy" />
        <StatCard label="Buy Products" value={buyItemsCount.toString()} icon={<Boxes size={20} />} accent="success" />
      </div>
      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">BOM Structure{parentPart ? ` — ${parentPart.part_name}` : ''}</h3>
            {parentPart && <p className="text-xs text-slate-500 mt-0.5">Rev: {parentPart.revision || '—'} • Material: {parentPart.material || '—'}</p>}
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/30">
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Level</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Company ID</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Product / Component</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Material</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">UOM</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Make/Buy</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Operation</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bomData.map((item) => (
                <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                  <td className="px-4 py-2">
                    <div className="flex items-center" style={{ paddingLeft: `${item.level * 20}px` }}>
                      <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${item.level === 0 ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>L{item.level}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2"><span className="text-slate-700">{item.projectName || '—'}</span></td>
                  <td className="px-4 py-2"><span className={item.level === 0 ? 'font-semibold text-slate-800' : 'text-slate-700'}>{item.partName}</span></td>
                  <td className="px-4 py-2 text-sm text-slate-600">{item.material || '—'}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-700">{item.quantity}</td>
                  <td className="px-4 py-2 text-sm text-slate-500">{item.unit}</td>
                  <td className="px-4 py-2"><Badge variant={item.make === 'Make' ? 'brand' : 'success'}>{item.make}</Badge></td>
                  <td className="px-4 py-2 text-xs text-slate-500">{item.operation || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setViewTarget(item)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"><Eye size={15} /></button>
                      <button onClick={() => handleEditClick(item)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={15} /></button>
                      <button onClick={() => setDeleteTarget(item)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {bomData.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-slate-500">{parentPartNo ? 'No components found.' : 'Select a parent part to view its BOM.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Component" : "Add BOM Component"} subtitle={editId ? "Update BOM line details" : "Add a new component to this assembly"} size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update Component' : 'Add Component'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Level" required>
            <select className={inputClass} value={formData.level} onChange={e => setFormData({...formData, level: e.target.value})}>
              <option value="0">L0 (Top Assembly)</option><option value="1">L1 (Sub-assembly / Part)</option><option value="2">L2 (Child Part / Raw Material)</option><option value="3">L3 (Hardware / Fastener)</option>
            </select>
          </FormField>
          <FormField label="Company ID">
            <select className={inputClass} value={formData.projectName || ''} onChange={e => setFormData({...formData, projectName: e.target.value})}>
              <option value="">Select Company ID...</option>
              {projects.map((p, i) => <option key={i} value={p}>{p}</option>)}
            </select>
          </FormField>
          <FormField label="Product Name" required><input className={inputClass} list="saved-products" value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} placeholder="Product Name" /></FormField>
          <FormField label="Material"><input className={inputClass} value={formData.material} onChange={e => setFormData({...formData, material: e.target.value})} placeholder="Material Grade" /></FormField>
          <FormField label="Quantity" required><input type="number" step="0.01" className={inputClass} value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} /></FormField>
          <FormField label="UOM">
            <select className={inputClass} value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
              <option>PC</option><option>SET</option><option>kg</option><option>L</option><option>m</option>
            </select>
          </FormField>
          <FormField label="Make/Buy">
            <select className={inputClass} value={formData.make} onChange={e => setFormData({...formData, make: e.target.value})}>
              <option>Make</option><option>Buy</option>
            </select>
          </FormField>
          <FormField label="Operation / Routing step"><input className={inputClass} value={formData.operation} onChange={e => setFormData({...formData, operation: e.target.value})} placeholder="e.g. Turn + Mill" /></FormField>
        </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View BOM Component" subtitle={viewTarget?.partName}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Part Name</p><p className="font-semibold text-slate-800">{viewTarget.partName}</p></div>
            <div><p className="text-slate-500 mb-1">Make/Buy</p><Badge variant={viewTarget.make === 'Make' ? 'brand' : 'success'}>{viewTarget.make}</Badge></div>
            <div><p className="text-slate-500 mb-1">Level</p><span className="w-8 h-6 rounded flex items-center justify-center text-xs font-bold bg-slate-100 text-slate-600">L{viewTarget.level}</span></div>
            <div><p className="text-slate-500 mb-1">Material</p><p className="text-slate-800">{viewTarget.material || 'N/A'}</p></div>
            <div><p className="text-slate-500 mb-1">Quantity</p><p className="text-slate-800 font-medium">{viewTarget.quantity} {viewTarget.unit}</p></div>
            <div className="col-span-2"><p className="text-slate-500 mb-1">Operation</p><p className="text-slate-800">{viewTarget.operation || 'N/A'}</p></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_bom').delete().eq('id', deleteTarget.id);
            if (!error) {
              setBomData(prev => prev.filter(b => b.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete BOM Component" 
        message={`Remove ${deleteTarget?.partName} from this assembly? This will affect material planning.`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

export function RoutingPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoutingOp & { id: string } | null>(null);
  const [routingData, setRoutingData] = useState<(RoutingOp & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const [machineCodes, setMachineCodes] = useState<string[]>([]);
  const { parentParts, parentPartNo, setParentPartNo, parentPart } = useParentParts();

  const resetForm = () => ({
    opNo: '10', operation: '', machine: '', setupTime: '0', cycleTime: '0', tools: '', description: '', cncProgram: ''
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    supabase.from('cnc_machines').select('code').order('code').then(({ data, error }) => {
      if (error) console.error('Error fetching machines:', error);
      setMachineCodes((data || []).map((m: any) => m.code).filter(Boolean));
    });
  }, []);

  useEffect(() => {
    if (!parentPartNo) { setRoutingData([]); setLoading(false); return; }
    async function fetchRouting() {
      setLoading(true);
      try {
        const { data, error } = await supabase.from('cnc_routing').select('*').eq('parent_part_no', parentPartNo).order('op_no', { ascending: true });
        if (error) {
          console.error('Error fetching routing:', error);
          setDbError(true);
          setRoutingData([]);
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            opNo: d.op_no,
            operation: d.operation,
            machine: d.machine,
            setupTime: Number(d.setup_time),
            cycleTime: Number(d.cycle_time),
            tools: d.tools,
            description: d.description,
            cncProgram: d.cnc_program,
          }));
          setRoutingData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchRouting();
  }, [parentPartNo]);

  const handleEditClick = (r: RoutingOp & { id: string }) => {
    setFormData({
      opNo: r.opNo.toString(),
      operation: r.operation,
      machine: r.machine,
      setupTime: r.setupTime.toString(),
      cycleTime: r.cycleTime.toString(),
      tools: r.tools || '',
      description: r.description || '',
      cncProgram: r.cncProgram || ''
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.operation || !formData.machine) return;
    if (!parentPartNo) return alert('Select a part first.');

    const entryData = {
      parent_part_no: parentPartNo,
      op_no: Number(formData.opNo) || 10,
      operation: formData.operation,
      machine: formData.machine,
      setup_time: Number(formData.setupTime) || 0,
      cycle_time: Number(formData.cycleTime) || 0,
      tools: formData.tools,
      description: formData.description,
      cnc_program: formData.cncProgram || null
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_routing').update(entryData).eq('id', editId);
      if (!error) {
        setRoutingData(prev => prev.map(r => r.id === editId ? { 
          ...r, opNo: entryData.op_no, operation: entryData.operation, machine: entryData.machine, setupTime: entryData.setup_time, cycleTime: entryData.cycle_time, tools: entryData.tools, description: entryData.description, cncProgram: entryData.cnc_program || undefined
        } : r).sort((a, b) => a.opNo - b.opNo));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update.");
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { error } = await supabase.from('cnc_routing').insert([insertData]);
      
      if (!error) {
        const formatted = {
          id: newId,
          opNo: insertData.op_no,
          operation: insertData.operation,
          machine: insertData.machine,
          setupTime: insertData.setup_time,
          cycleTime: insertData.cycle_time,
          tools: insertData.tools,
          description: insertData.description,
          cncProgram: insertData.cnc_program || undefined
        };
        setRoutingData([...routingData, formatted].sort((a, b) => a.opNo - b.opNo));
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database.");
      }
    }
    setLoading(false);
  };

  const totalSetupTime = routingData.reduce((acc, r) => acc + r.setupTime, 0);
  const totalCycleTime = routingData.reduce((acc, r) => acc + r.cycleTime, 0);
  const uniqueMachines = new Set(routingData.map(r => r.machine)).size;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Process Routing" description={parentPart ? `Manufacturing routing for ${parentPart.part_name}` : 'Manufacturing routing — select a part'} actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<ParentPartSelect parts={parentParts} value={parentPartNo} onChange={setParentPartNo} /><Button size="sm" icon={<Plus size={14} />} disabled={!parentPartNo} onClick={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }}>Add Operation</Button></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Operations" value={routingData.length.toString()} icon={<Cog size={20} />} accent="brand" />
        <StatCard label="Total Setup Time" value={`${(totalSetupTime / 60).toFixed(1)} hr`} icon={<Cog size={20} />} accent="accent" />
        <StatCard label="Total Cycle Time" value={`${totalCycleTime.toFixed(1)} min`} icon={<Cog size={20} />} accent="navy" />
        <StatCard label="Machines Used" value={uniqueMachines.toString()} icon={<Cog size={20} />} accent="success" />
      </div>
      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Operation Sequence</h3>
            {parentPart && <p className="text-xs text-slate-500 mt-0.5">{parentPart.part_name} • {parentPart.material || '—'}</p>}
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {routingData.map((op) => (
            <div key={op.id} className="px-4 py-2.5 hover:bg-slate-50/50 transition-colors group">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{op.opNo}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">{op.operation}</h4>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-2">
                        <button onClick={() => handleEditClick(op)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Edit size={14} /></button>
                        <button onClick={() => setDeleteTarget(op)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      </div>
                      <Badge variant="info">{op.machine}</Badge>
                      <Badge variant="neutral">Prog: {op.cncProgram || '—'}</Badge>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{op.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    <span>Setup: <span className="font-medium text-slate-600">{op.setupTime} min</span></span>
                    <span>Cycle: <span className="font-medium text-slate-600">{op.cycleTime} min</span></span>
                    <span>Tools: <span className="font-medium text-slate-600">{op.tools}</span></span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {routingData.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-500">No operations found.</div>
          )}
        </div>
      </Card>

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Operation" : "Add Operation"} subtitle="Configure routing sequence" size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Op No" required><input type="number" step="10" className={inputClass} value={formData.opNo} onChange={e => setFormData({...formData, opNo: e.target.value})} /></FormField>
          <FormField label="Operation Name" required><input className={inputClass} value={formData.operation} onChange={e => setFormData({...formData, operation: e.target.value})} placeholder="e.g. Facing & Turning" /></FormField>
          <FormField label="Machine" required>
            <select className={inputClass} value={formData.machine} onChange={e => setFormData({...formData, machine: e.target.value})}>
              <option value="">Select machine...</option>
              {formData.machine && !machineCodes.includes(formData.machine) && <option>{formData.machine}</option>}
              {machineCodes.map(code => <option key={code}>{code}</option>)}
            </select>
          </FormField>
          <FormField label="CNC Program"><input className={inputClass} value={formData.cncProgram} onChange={e => setFormData({...formData, cncProgram: e.target.value})} placeholder="e.g. O1001" /></FormField>
          <FormField label="Setup Time (min)"><input type="number" className={inputClass} value={formData.setupTime} onChange={e => setFormData({...formData, setupTime: e.target.value})} /></FormField>
          <FormField label="Cycle Time (min)"><input type="number" step="0.1" className={inputClass} value={formData.cycleTime} onChange={e => setFormData({...formData, cycleTime: e.target.value})} /></FormField>
          <div className="col-span-2"><FormField label="Tools"><input className={inputClass} value={formData.tools} onChange={e => setFormData({...formData, tools: e.target.value})} placeholder="e.g. TNMG-160404, Drill Ø12" /></FormField></div>
          <div className="col-span-2"><FormField label="Description"><textarea rows={2} className={inputClass} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Detailed operation steps..." /></FormField></div>
        </div>
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_routing').delete().eq('id', deleteTarget.id);
            if (!error) {
              setRoutingData(prev => prev.filter(r => r.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Operation" 
        message={`Delete operation ${deleteTarget?.opNo} (${deleteTarget?.operation})?`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

export function WorkInstructionsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [instructionsData, setInstructionsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const { parentParts, parentPartNo, setParentPartNo, parentPart } = useParentParts();

  const resetForm = () => ({
    opNo: '10', title: '', machine: '', steps: ''
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    if (!parentPartNo) { setInstructionsData([]); setLoading(false); return; }
    async function fetchInstructions() {
      setLoading(true);
      try {
        const { data, error } = await supabase.from('cnc_work_instructions').select('*').eq('parent_part_no', parentPartNo).order('op_no', { ascending: true });
        if (error) {
          console.error('Error fetching instructions:', error);
          setDbError(true);
          setInstructionsData([]);
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            opNo: d.op_no,
            title: d.title,
            machine: d.machine,
            steps: Array.isArray(d.steps) ? d.steps : [],
          }));
          setInstructionsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchInstructions();
  }, [parentPartNo]);

  const handleEditClick = (inst: any) => {
    setFormData({
      opNo: String(inst.opNo ?? ''),
      title: inst.title || '',
      machine: inst.machine || '',
      steps: (inst.steps || []).join('\n')
    });
    setEditId(inst.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.title || !formData.steps) return;
    if (!parentPartNo) return alert('Select a part first.');

    const stepsArray = formData.steps.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    const entryData = {
      parent_part_no: parentPartNo,
      op_no: Number(formData.opNo) || 10,
      title: formData.title,
      machine: formData.machine,
      steps: stepsArray
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_work_instructions').update(entryData).eq('id', editId);
      if (!error) {
        setInstructionsData(prev => prev.map(inst => inst.id === editId ? { 
          ...inst, opNo: entryData.op_no, title: entryData.title, machine: entryData.machine, steps: entryData.steps
        } : inst).sort((a, b) => a.opNo - b.opNo));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update.");
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { error } = await supabase.from('cnc_work_instructions').insert([insertData]);
      
      if (!error) {
        const formatted = {
          id: newId,
          opNo: insertData.op_no,
          title: insertData.title,
          machine: insertData.machine,
          steps: insertData.steps
        };
        setInstructionsData([...instructionsData, formatted].sort((a, b) => a.opNo - b.opNo));
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database.");
      }
    }
    setLoading(false);
  };

  const totalInstructions = instructionsData.length;
  const totalSteps = instructionsData.reduce((acc, inst) => acc + inst.steps.length, 0);
  const avgSteps = totalInstructions > 0 ? Math.round(totalSteps / totalInstructions) : 0;
  const machinesUsed = new Set(instructionsData.map(inst => inst.machine).filter(Boolean)).size;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Work Instructions" description={parentPart ? `Step-by-step manufacturing instructions for ${parentPart.part_name}` : 'Step-by-step manufacturing instructions — select a part'} actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<ParentPartSelect parts={parentParts} value={parentPartNo} onChange={setParentPartNo} /><Button size="sm" icon={<Plus size={14} />} disabled={!parentPartNo} onClick={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }}>Add Instruction</Button></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Instructions" value={totalInstructions.toString()} icon={<FileText size={20} />} accent="brand" />
        <StatCard label="Total Steps" value={totalSteps.toString()} icon={<FileText size={20} />} accent="accent" />
        <StatCard label="Avg Steps/Op" value={avgSteps.toString()} icon={<FileText size={20} />} accent="navy" />
        <StatCard label="Machines" value={machinesUsed.toString()} icon={<FileText size={20} />} accent="success" />
      </div>
      <div className="space-y-4">
        {instructionsData.map((inst) => (
          <Card key={inst.id}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center font-bold text-sm">{inst.opNo}</div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">{inst.title}</h3>
                  <p className="text-xs text-slate-500">Machine: {inst.machine}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEditClick(inst)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit size={16} /></button>
                <button onClick={() => setDeleteTarget(inst)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="p-5">
              <ol className="space-y-2">
                {inst.steps.map((step: string, si: number) => (
                  <li key={si} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">{si + 1}</span>
                    <span className="text-sm text-slate-600">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        ))}
        {instructionsData.length === 0 && (
          <div className="px-5 py-8 text-center text-slate-500 bg-white rounded-xl shadow-sm border border-slate-200">No work instructions found.</div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Instructions" : "Add Instructions"} subtitle="Define step-by-step procedure" size="lg" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Op No" required><input type="number" step="10" className={inputClass} value={formData.opNo} onChange={e => setFormData({...formData, opNo: e.target.value})} /></FormField>
          <FormField label="Machine"><input className={inputClass} value={formData.machine} onChange={e => setFormData({...formData, machine: e.target.value})} placeholder="e.g. CNC-T-01" /></FormField>
          <div className="col-span-2"><FormField label="Title" required><input className={inputClass} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="e.g. Facing & Turning — Op 10" /></FormField></div>
          <div className="col-span-2">
            <FormField label="Steps (One step per line)" required>
              <textarea rows={8} className={inputClass} value={formData.steps} onChange={e => setFormData({...formData, steps: e.target.value})} placeholder="1. Mount raw blank in 3-jaw chuck&#10;2. Load CNC program O8471&#10;3. Run first article" />
            </FormField>
          </div>
        </div>
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_work_instructions').delete().eq('id', deleteTarget.id);
            if (!error) {
              setInstructionsData(prev => prev.filter(inst => inst.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Instructions" 
        message={`Delete instructions for Op ${deleteTarget?.opNo}?`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}

export function RevisionsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<RevisionRecord & { id: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RevisionRecord & { id: string } | null>(null);
  const [revisionsData, setRevisionsData] = useState<(RevisionRecord & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const { profile } = useAuth();

  const resetForm = () => ({
    drawingNo: '', partName: '', revision: '', description: '', date: new Date().toISOString().split('T')[0], approvedBy: profile?.full_name || '', status: 'Pending'
  });
  const [formData, setFormData] = useState(resetForm());

  useEffect(() => {
    async function fetchRevisions() {
      try {
        const { data, error } = await supabase.from('cnc_revisions').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching revisions:', error);
          setDbError(true);
          setRevisionsData([]);
        } else if (data) {
          setDbError(false);
          const formattedData = data.map((d: any) => ({
            id: d.id,
            drawingNo: d.drawing_no,
            partName: d.part_name,
            revision: d.revision,
            description: d.description,
            date: d.date,
            approvedBy: d.approved_by,
            status: d.status,
          }));
          setRevisionsData(formattedData);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchRevisions();
  }, []);

  const handleEditClick = (r: RevisionRecord & { id: string }) => {
    setFormData({
      drawingNo: r.drawingNo,
      partName: r.partName,
      revision: r.revision,
      description: r.description,
      date: r.date,
      approvedBy: r.approvedBy,
      status: r.status
    });
    setEditId(r.id);
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!formData.drawingNo || !formData.revision) return;

    const entryData = {
      drawing_no: formData.drawingNo,
      part_name: formData.partName,
      revision: formData.revision,
      description: formData.description,
      date: formData.date,
      approved_by: formData.approvedBy,
      status: formData.status
    };

    setLoading(true);

    if (editId) {
      const { error } = await supabase.from('cnc_revisions').update(entryData).eq('id', editId);
      if (!error) {
        setRevisionsData(prev => prev.map(r => r.id === editId ? { 
          ...r, drawingNo: entryData.drawing_no, partName: entryData.part_name, revision: entryData.revision, description: entryData.description, date: entryData.date, approvedBy: entryData.approved_by, status: entryData.status as any
        } : r));
        setShowAdd(false);
        setEditId(null);
        setFormData(resetForm());
      } else {
        alert("Failed to update.");
      }
    } else {
      const newId = crypto.randomUUID();
      const insertData = { ...entryData, id: newId };
      const { error } = await supabase.from('cnc_revisions').insert([insertData]);
      
      if (!error) {
        const formatted = {
          id: newId,
          drawingNo: insertData.drawing_no,
          partName: insertData.part_name,
          revision: insertData.revision,
          description: insertData.description,
          date: insertData.date,
          approvedBy: insertData.approved_by,
          status: insertData.status as any
        };
        setRevisionsData([formatted, ...revisionsData]);
        setShowAdd(false);
        setFormData(resetForm());
      } else {
        alert("Failed to add to database.");
      }
    }
    setLoading(false);
  };

  const columns: Column<RevisionRecord & { id: string }>[] = [
    { key: 'drawingNo', label: 'Drawing No', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-700">{r.drawingNo}</span> },
    { key: 'partName', label: 'Part Name', sortable: true, render: (r) => <span className="font-medium text-slate-700">{r.partName}</span> },
    { key: 'revision', label: 'Revision', sortable: true, align: 'center', render: (r) => <Badge variant="info">{r.revision}</Badge> },
    { key: 'description', label: 'Description of Change', render: (r) => <span className="text-sm text-slate-600 truncate block max-w-xs">{r.description}</span> },
    { key: 'date', label: 'Date', sortable: true, render: (r) => <span className="text-xs text-slate-500">{r.date}</span> },
    { key: 'approvedBy', label: 'Approved By', sortable: true, render: (r) => <span className="text-sm text-slate-600">{r.approvedBy}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge variant={statusToVariant(r.status)} dot>{r.status}</Badge> },
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

  const totalRevs = revisionsData.length;
  const releasedRevs = revisionsData.filter(r => r.status === 'Released').length;
  const pendingRevs = revisionsData.filter(r => r.status === 'Pending').length;
  const supersededRevs = revisionsData.filter(r => r.status === 'Superseded').length;

  return (
    <div className="p-4 lg:p-6 bg-grid min-h-full">
      <PageHeader title="Revision Control" description="Track drawing revisions and engineering change orders" actions={<div className="flex items-center gap-2">{dbError && <Badge variant="error">DB Disconnected</Badge>}{loading && <Badge variant="neutral">Syncing...</Badge>}<DateSelector /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Revisions" value={totalRevs.toString()} icon={<GitBranch size={20} />} accent="brand" />
        <StatCard label="Released" value={releasedRevs.toString()} icon={<ShieldCheck size={20} />} accent="success" />
        <StatCard label="Pending" value={pendingRevs.toString()} icon={<FileText size={20} />} accent="warning" />
        <StatCard label="Superseded" value={supersededRevs.toString()} icon={<GitBranch size={20} />} accent="neutral" />
      </div>
      <DataTable data={revisionsData} columns={columns} searchKeys={['drawingNo', 'partName', 'description']} onAdd={() => { setEditId(null); setFormData(resetForm()); setShowAdd(true); }} addLabel="New Revision" filterOptions={[{ label: 'Released', value: 'Released' }, { label: 'Pending', value: 'Pending' }, { label: 'Superseded', value: 'Superseded' }]} />
      
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditId(null); setFormData(resetForm()); }} title={editId ? "Edit Revision" : "New Revision"} subtitle="Create a new drawing revision" footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} disabled={loading}>{editId ? 'Update' : 'Save Revision'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Drawing Number" required><input className={inputClass} value={formData.drawingNo} onChange={e => setFormData({...formData, drawingNo: e.target.value})} placeholder="DWG-..." /></FormField>
          <FormField label="Part Name" required><input className={inputClass} value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} /></FormField>
          <FormField label="Revision" required><input className={inputClass} value={formData.revision} onChange={e => setFormData({...formData, revision: e.target.value})} placeholder="R4" /></FormField>
          <FormField label="Date" required><input type="date" className={inputClass} value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></FormField>
          <FormField label="Status" required>
            <select className={inputClass} value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
              <option>Pending</option><option>Released</option><option>Superseded</option>
            </select>
          </FormField>
          <FormField label="Approved By"><input className={inputClass} value={formData.approvedBy} onChange={e => setFormData({...formData, approvedBy: e.target.value})} /></FormField>
          <div className="col-span-2"><FormField label="Description of Change" required><textarea className={inputClass} rows={3} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></FormField></div>
        </div>
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="View Revision Details" subtitle={viewTarget?.drawingNo}>
        {viewTarget && (
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div><p className="text-slate-500 mb-1">Part Name</p><p className="font-semibold text-slate-800">{viewTarget.partName}</p></div>
            <div><p className="text-slate-500 mb-1">Status</p><Badge variant={statusToVariant(viewTarget.status)} dot>{viewTarget.status}</Badge></div>
            <div><p className="text-slate-500 mb-1">Drawing No</p><p className="font-mono text-slate-700">{viewTarget.drawingNo}</p></div>
            <div><p className="text-slate-500 mb-1">Revision</p><Badge variant="info">{viewTarget.revision}</Badge></div>
            <div><p className="text-slate-500 mb-1">Date</p><p className="text-slate-800">{viewTarget.date}</p></div>
            <div><p className="text-slate-500 mb-1">Approved By</p><p className="text-slate-800">{viewTarget.approvedBy}</p></div>
            <div className="col-span-2"><p className="text-slate-500 mb-1">Description of Change</p><p className="text-slate-800 whitespace-pre-wrap">{viewTarget.description}</p></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog 
        open={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        onConfirm={async () => {
          if (deleteTarget) {
            setLoading(true);
            const { error } = await supabase.from('cnc_revisions').delete().eq('id', deleteTarget.id);
            if (!error) {
              setRevisionsData(prev => prev.filter(r => r.id !== deleteTarget.id));
            } else {
              console.error('Failed to delete:', error);
              alert("Failed to delete. Check connection.");
            }
            setLoading(false);
          }
        }} 
        title="Delete Revision" 
        message={`Delete revision ${deleteTarget?.revision} for ${deleteTarget?.drawingNo}?`} 
        confirmLabel="Delete" 
        danger 
      />
    </div>
  );
}
export * from './CNCVaultPage';
