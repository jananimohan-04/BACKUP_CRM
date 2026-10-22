import { workOrderTitle } from '@/lib/workOrderFormat';
import { Card, Button } from '@/components/ui/Card';
import { Play, Edit, Printer, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useState, useEffect } from 'react';
import { DonutChart, BarChart } from '@/components/ui/Charts';
import { getMockImage } from '@/lib/mockStorage';

export function ProductionOrderDetails({ order, refresh }: { order: any, onClose: () => void, refresh: () => void }) {
  const [routing, setRouting] = useState<any[]>([]);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(order.image_url || order.drawing_url || null);
  const [materials, setMaterials] = useState<any[]>([]);
  
  useEffect(() => {
    async function loadDetails() {
      // Load routing for this part if available
      const { data: routeData } = await supabase.from('cnc_routing').select('*').eq('parent_part_no', order.part_no).order('op_no', { ascending: true });
      if (routeData) setRouting(routeData);

      // Load material issues. Inventory issues are recorded with reference = material request no,
      // so match both the WO no itself and any material requests raised against this WO.
      const { data: reqData, error: reqError } = await supabase
        .from('cnc_material_requests')
        .select('request_no')
        .eq('work_order_no', order.wo_no);
      if (reqError) console.error('Failed to load material requests:', reqError);
      const references = [order.wo_no, ...(reqData || []).map((r: any) => r.request_no)].filter(Boolean);
      if (references.length > 0) {
        const { data: matData, error: matError } = await supabase.from('cnc_stock_movements').select('*').in('reference', references);
        if (matError) console.error('Failed to load material issues:', matError);
        if (matData) setMaterials(matData);
      }
    }
    loadDetails();

    const loadImg = async () => {
      if (!drawingUrl && order.part_name) {
        const url = await getMockImage(order.part_name).catch(() => null);
        if (url) setDrawingUrl(url);
      }
    };
    loadImg();
  }, [order]);


  const qty = Number(order.quantity) || 0;
  const comp = Number(order.completed) || 0;
  const rej = Number(order.rejected) || 0;
  const pend = Math.max(0, qty - comp - rej);

  // Donut chart data
  const progressData = [
    { name: 'Completed', value: comp, color: '#10b981' },
    { name: 'In Progress', value: pend, color: '#f59e0b' },
    { name: 'Rejected', value: rej, color: '#ef4444' }
  ].filter(d => d.value > 0);
  
  if (progressData.length === 0) progressData.push({ name: 'Pending', value: qty, color: '#94a3b8' });

  // Target vs Actual from the work order's real quantities (no daily production log exists)
  const targetVsActual = [
    { label: workOrderTitle(order) || 'This Order', target: qty, actual: comp, rejected: rej },
  ];

    const handleStart = async () => {
    const { error } = await supabase.from('cnc_work_orders').update({ status: 'In Progress' }).eq('id', order.id);
    if (error) {
      alert("Failed to start production: " + error.message);
    } else {
      alert("Status updated to 'In Progress' successfully!");
      refresh();
    }
  };

  const handleComplete = async () => {
    const { error } = await supabase.from('cnc_work_orders').update({ status: 'Completed', completed: order.quantity }).eq('id', order.id);
    if (error) {
      alert("Failed to complete production: " + error.message);
    } else {
      alert("Production marked as Completed!");
      refresh();
    }
  };


  const handleViewDrawing = async () => {
    const url = order.image_url || order.drawing_url;
    if (url) {
      window.open(url, '_blank');
      return;
    }
    const mockUrl = await getMockImage(order.part_name).catch(() => null);
    if (mockUrl) {
      window.open(mockUrl, '_blank');
    } else {
      alert("No drawing or image is attached to this part.");
    }
  };

    const handleEdit = async () => {
    const newQty = window.prompt(`Edit Target Quantity for ${workOrderTitle(order)}:`, order.quantity);
    if (newQty && !isNaN(Number(newQty))) {
      const { error } = await supabase.from('cnc_work_orders').update({ quantity: Number(newQty) }).eq('id', order.id);
      if (error) {
        alert("Failed to update quantity: " + error.message);
      } else {
        alert("Quantity updated successfully!");
        refresh();
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (

    <div className="space-y-6">


          <Card className="p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">Production Actions</h4>
            <div className="flex flex-col gap-2">
              {['Planned', 'Planning'].includes(order.status) && (
                <Button variant="primary" className="w-full gap-2 justify-center" onClick={handleStart}>
                  <Play size={16} /> Start Production
                </Button>
              )}
              {order.status === 'In Progress' && (
                <Button variant="success" className="w-full gap-2 justify-center bg-green-600 text-white hover:bg-green-700" onClick={handleComplete}>
                  <CheckCircle size={16} /> Complete Production
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1 gap-2" onClick={handleEdit}><Edit size={16} /> Edit</Button>
                <Button variant="secondary" className="flex-1 gap-2" onClick={handlePrint}><Printer size={16} /> Print Job Card</Button>
              </div>
            </div>
          </Card>
      

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Project Details & Actions */}
        <div className="space-y-6">
          <Card className="p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">Project & Part Details</h4>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-slate-500">Project / Company</div><div className="font-medium text-slate-800">{order.customer}</div>
              <div className="text-slate-500">Sales Order</div><div className="text-slate-800">{order.sales_order || '-'}</div>
              <div className="text-slate-500">Part Name</div><div className="font-medium text-slate-800">{order.part_name}</div>
              <div className="text-slate-500">Drawing / Rev</div><div className="text-slate-800">{order.drawing_revision || 'R0'}</div>
              <div className="text-slate-500">Target Qty</div><div className="font-bold text-slate-800">{qty} Nos</div>
              <div className="text-slate-500">Dates</div><div className="text-slate-800">{order.start_date} to {order.due_date}</div>
            </div>

          </Card>
            {drawingUrl && (
              <Card className="p-4">
                <h4 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-100 pb-2 flex justify-between items-center">
                  Part Drawing
                  <button onClick={handleViewDrawing} className="text-brand-600 text-xs hover:underline flex items-center gap-1">
                    View Full
                  </button>
                </h4>
                <div className="rounded border border-slate-200 bg-slate-50 overflow-hidden cursor-pointer hover:border-brand-300 transition-colors flex items-center justify-center p-2" onClick={handleViewDrawing} title="Click to view full size">
                  <img src={drawingUrl} alt="Drawing" className="w-full h-auto max-h-48 object-contain bg-white" />
                </div>
              </Card>
            )}
        </div>

        {/* Middle Column: Routing & WIP */}
        <div className="space-y-6">
          <Card className="p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">Process Routing</h4>
            {routing.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {routing.map((rt: any) => (
                  <div key={rt.id} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-slate-800">Op {rt.op_no}: {rt.operation}</span>
                      <p className="text-xs text-slate-500">{rt.machine}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-500">{rt.cycle_time} min/pc</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-4 text-center">No routing defined for this part.</p>
            )}
          </Card>

          <Card className="p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">Material Issue (Raw Material)</h4>
            {materials.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {materials.map((m: any) => (
                  <div key={m.id} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-slate-800">{m.material}</span>
                      <p className="text-xs text-slate-500">{new Date(m.date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-medium text-slate-800">{m.qty} {m.uom}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-4 text-center">No material issued yet.</p>
            )}
          </Card>
        </div>

        {/* Right Column: Progress & Charts */}
        <div className="space-y-6">
          <Card className="p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">Production Progress</h4>
            <div className="flex flex-col items-center justify-center">
              <DonutChart data={progressData} height={180} />
              <div className="mt-4 grid grid-cols-3 w-full text-center text-sm gap-2">
                <div><p className="text-slate-500 text-xs">Target</p><p className="font-semibold text-slate-800">{qty}</p></div>
                <div><p className="text-slate-500 text-xs">Completed</p><p className="font-semibold text-green-600">{comp}</p></div>
                <div><p className="text-slate-500 text-xs">Pending</p><p className="font-semibold text-brand-600">{pend}</p></div>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">Target vs Actual</h4>
            <BarChart 
              data={targetVsActual} 
              height={200} 
              series={[
                { key: 'target', label: 'Target', color: '#94a3b8' },
                { key: 'actual', label: 'Completed', color: '#10b981' },
                { key: 'rejected', label: 'Rejected', color: '#ef4444' }
              ]} 
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
