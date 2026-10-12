import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { Badge, Button, ProgressBar, statusToVariant, priorityToVariant } from '@/components/ui/Card';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Pencil, Play, Pause, RotateCcw, Ban, CheckCheck, Printer } from 'lucide-react';

const OP_STATUSES = ['Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
const EDITABLE_WO = ['Draft', 'Planned', 'Planning'];

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plannedMinutes(op: any): number {
  return (Number(op.setup_time) || 0) + (Number(op.planned_qty) || 0) * (Number(op.est_cycle_time) || 0);
}

function printWorkOrder(wo: any, ops: any[]) {
  const qty = Number(wo.quantity) || 0;
  const comp = Number(wo.completed) || 0;
  const pct = qty > 0 ? Math.round((comp / qty) * 100) : 0;
  const rows = ops
    .map(
      (op, i) => `<tr>
        <td>${i + 1}</td>
        <td><b>${esc(op.process_code)}</b> — ${esc(op.process_name)}</td>
        <td>${esc(op.machine || '—')}</td>
        <td>${esc(op.operator || '—')}</td>
        <td style="text-align:right">${esc(op.planned_qty ?? 0)}</td>
        <td>${esc(op.est_cycle_time ?? 0)} min</td>
        <td>${esc(op.setup_time ?? 0)} min</td>
        <td>${esc(op.status)}</td>
      </tr>`
    )
    .join('');
  const html = `<!DOCTYPE html><html><head><title>Work Order ${esc(wo.wo_no)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:32px;}
      .head{border-bottom:3px solid #f25a0a;padding-bottom:12px;margin-bottom:20px;}
      .head h1{margin:0;font-size:22px;color:#0f2a43;}
      .head p{margin:4px 0 0;color:#64748b;font-size:12px;}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;}
      .cell{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;}
      .cell small{display:block;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em;}
      .cell b{font-size:14px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th{background:#0f2a43;color:#fff;text-align:left;padding:8px;}
      td{border-bottom:1px solid #e2e8f0;padding:8px;}
      .foot{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;font-size:12px;color:#475569;}
      .foot div{border-top:1px solid #94a3b8;padding-top:6px;margin-top:48px;}
    </style></head><body>
    <div class="head"><h1>WORK ORDER — ${esc(wo.wo_no)}</h1>
    <p>Argus CNC ERP · Printed ${esc(new Date().toLocaleString('en-IN', { hour12: false }))}</p></div>
    <div class="grid">
      <div class="cell"><small>Sales Order</small><b>${esc(wo.sales_order || '—')}</b></div>
      <div class="cell"><small>Company</small><b>${esc(wo.customer || '—')}</b></div>
      <div class="cell"><small>Product</small><b>${esc(wo.part_name || '—')}</b></div>
      <div class="cell"><small>Status</small><b>${esc(wo.status)}</b></div>
      <div class="cell"><small>Target Qty</small><b>${qty}</b></div>
      <div class="cell"><small>Completed</small><b>${comp}</b></div>
      <div class="cell"><small>Progress</small><b>${pct}%</b></div>
      <div class="cell"><small>Planned</small><b>${esc(wo.start_date || '')} → ${esc(wo.due_date || '')}</b></div>
    </div>
    <h3>Operations</h3>
    <table><thead><tr><th>#</th><th>Process</th><th>Machine</th><th>Operator</th>
    <th style="text-align:right">Planned Qty</th><th>Cycle</th><th>Setup</th><th>Status</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8">No operations defined.</td></tr>'}</tbody></table>
    <div class="foot"><div>Planned by / Sign</div><div>Production In-charge / Sign</div><div>Quality / Sign</div></div>
    <script>window.print();</script></body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    alert('Popup blocked — allow popups to print the Work Order.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

export function WorkOrderDetail({
  wo,
  ops,
  opsMissing,
  onClose,
  onChanged,
  onEdit,
}: {
  wo: any;
  ops: any[];
  opsMissing: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (wo: any) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const qty = Number(wo.quantity) || 0;
  const comp = Number(wo.completed) || 0;
  const remaining = Math.max(0, qty - comp);
  const pct = qty > 0 ? Math.round((comp / qty) * 100) : 0;

  const updateWO = async (patch: Record<string, any>) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('cnc_work_orders').update(patch).eq('id', wo.id);
      if (error) throw error;
      onChanged();
    } catch (err: any) {
      alert('Failed to update work order: ' + (err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const updateOp = async (op: any, patch: Record<string, any>) => {
    try {
      // Tolerant: the rejected_qty column arrives with the production-batches
      // migration — older databases keep working without it.
      let remaining = { ...patch };
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase
          .from('cnc_work_order_operations')
          .update({ ...remaining, updated_at: new Date().toISOString() })
          .eq('id', op.id);
        if (!error) { onChanged(); return; }
        const m = /Could not find the '([A-Za-z0-9_]+)' column/.exec(String((error as any)?.message || ''));
        if (m && Object.prototype.hasOwnProperty.call(remaining, m[1])) {
          console.warn(`Operation update skipped missing column ${m[1]} (apply migration 20260929010000_production_batches.sql).`);
          delete remaining[m[1]];
          continue;
        }
        throw error;
      }
    } catch (err: any) {
      alert('Failed to update operation: ' + (err?.message ?? err));
    }
  };

  const handleRelease = async () => {
    if (opsMissing) {
      alert('Operations table is not provisioned. Apply the work-order-operations migration first.');
      return;
    }
    if (ops.length === 0) {
      alert('At least one operation is required before releasing the Work Order. Edit the order and add operations from Process Master.');
      return;
    }
    setBusy(true);
    try {
      // Idempotency: never create a second job card for the same (work order, op_no).
      const { data: existing } = await supabase.from('cnc_job_cards').select('op_no').eq('work_order', wo.wo_no);
      const taken = new Set((existing ?? []).map((j: any) => Number(j.op_no)));
      let created = 0;
      let skipped = 0;
      for (const op of ops) {
        const opNo = (op.operation_sequence ?? 0) * 10;
        if (!op.machine || taken.has(opNo)) {
          skipped += 1;
          continue;
        }
        const { error } = await supabase.from('cnc_job_cards').insert([{
          id: crypto.randomUUID(),
          job_no: `JC-${Math.floor(1000 + Math.random() * 9000)}`,
          work_order: wo.wo_no,
          part_name: wo.part_name ?? '',
          op_no: opNo,
          operation: op.process_name || op.process_code || 'Machining',
          machine: op.machine,
          operator: op.operator || null,
          qty_planned: Number(op.planned_qty) || 0,
          qty_completed: 0,
          qty_rejected: 0,
          cycle_time: Number(op.est_cycle_time) || 0,
          setup_time: Number(op.setup_time) || 0,
          status: 'Planned',
          created_at: op.planned_start ?? new Date().toISOString(),
        }]);
        if (error) throw error;
        created += 1;
      }
      const { error: woError } = await supabase
        .from('cnc_work_orders')
        .update({ status: 'Released' })
        .eq('id', wo.id);
      if (woError) throw woError;
      onChanged();
      alert(`Work Order released. ${created} operation(s) sent to Scheduling${skipped ? `, ${skipped} skipped (no machine or already scheduled)` : ''}.`);
    } catch (err: any) {
      alert('Failed to release work order: ' + (err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const canRelease = ['Draft', 'Planned', 'Planning'].includes(wo.status);
  const canHold = ['Released', 'In Progress'].includes(wo.status);
  const canResume = wo.status === 'On Hold';
  // A Completed/Dispatched order that did not reach its target can be reopened for the balance.
  const canReopen = ['Completed', 'Dispatched'].includes(wo.status) && comp < qty;
  const canCancel = !['Completed', 'Cancelled', 'Dispatched'].includes(wo.status);
  const canComplete = wo.status === 'In Progress';
  const allOpsDone = ops.length > 0 && ops.every((o) => o.status === 'Completed');

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Work Order ${wo.wo_no}`}
        subtitle={`${wo.customer ?? ''} · ${wo.part_name ?? ''}`}
        size="3xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => printWorkOrder(wo, ops)} icon={<Printer size={14} />}>
              Print Work Order
            </Button>
            <span className="flex-1" />
            {(EDITABLE_WO.includes(wo.status) || (['Released', 'In Progress'].includes(wo.status) && ops.length === 0 && !opsMissing)) && (
              <Button variant="secondary" onClick={() => onEdit(wo)} icon={<Pencil size={14} />}>Edit</Button>
            )}
            {canRelease && <Button onClick={handleRelease} disabled={busy} icon={<Play size={14} />}>Release Work Order</Button>}
            {canReopen && <Button onClick={() => updateWO({ status: 'In Progress' })} disabled={busy} icon={<RotateCcw size={14} />}>Reopen for Balance ({qty - comp} pcs)</Button>}
            {canHold && <Button variant="secondary" onClick={() => updateWO({ status: 'On Hold' })} disabled={busy} icon={<Pause size={14} />}>Put On Hold</Button>}
            {canResume && <Button onClick={() => updateWO({ status: comp > 0 ? 'In Progress' : 'Released' })} disabled={busy} icon={<RotateCcw size={14} />}>Resume</Button>}
            {canComplete && <Button variant="success" onClick={() => setConfirmComplete(true)} disabled={busy} icon={<CheckCheck size={14} />}>Mark Completed</Button>}
            {canCancel && <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={busy} icon={<Ban size={14} />}>Cancel</Button>}
          </>
        }
      >
        {/* header */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Work Order No.</p><p className="font-mono font-bold text-slate-800">{wo.wo_no}</p></div>
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sales Order</p><p className="font-mono font-semibold text-slate-700">{wo.sales_order || '—'}</p></div>
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Company</p><p className="font-semibold text-slate-800">{wo.customer || '—'}</p></div>
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Product</p><p className="font-semibold text-slate-800">{wo.part_name || '—'}</p></div>
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Target Quantity</p><p className="font-bold text-slate-800">{qty.toLocaleString('en-IN')}</p></div>
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Completed</p><p className="font-bold text-emerald-600">{comp.toLocaleString('en-IN')}</p></div>
            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remaining</p><p className="font-bold text-rose-500">{remaining.toLocaleString('en-IN')}</p></div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</p>
              <p className="mt-0.5 flex items-center gap-1.5">
                <Badge variant={statusToVariant(wo.status)} dot>{wo.status}</Badge>
                {wo.priority && wo.priority !== 'Normal' && <Badge variant={priorityToVariant(wo.priority)}>{wo.priority}</Badge>}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
              <span>Target: {qty} · Completed: {comp} · Remaining: {remaining}</span>
              <span className="font-bold text-slate-700">Progress: {pct}%</span>
            </div>
            <ProgressBar value={pct} color={pct >= 100 ? 'success' : pct > 0 ? 'brand' : 'neutral'} height="h-2.5" />
          </div>
          {allOpsDone && wo.status !== 'Completed' && (
            <p className="mt-3 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              All operations are completed — this Work Order is eligible for Finished Goods entry.
            </p>
          )}
        </div>

        {/* operations timeline */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-4 border-b border-brand-100 pb-2">
            Operations Timeline ({ops.length})
          </h3>
          {opsMissing ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Operations storage is not provisioned yet — apply the work-order-operations migration to manage routing lines.
            </p>
          ) : ops.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No operations defined for this Work Order.</p>
          ) : (
            <ol className="relative border-l-2 border-slate-200 ml-2 space-y-4">
              {ops.map((op, i) => (
                <li key={op.id} className="ml-5">
                  <span className="absolute -left-[9px] mt-1 w-4 h-4 rounded-full bg-navy-900 text-white text-[9px] font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-800">
                        <span className="font-mono text-xs text-brand-700">{op.process_code}</span>
                        {' — '}{op.process_name || 'Unnamed process'}
                      </span>
                      <span className="flex-1" />
                      <Badge variant={statusToVariant(op.status)} dot>{op.status}</Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 mt-2 text-xs text-slate-600">
                      <span><b className="text-slate-500">Machine:</b> {op.machine || '—'}</span>
                      <span><b className="text-slate-500">Operator:</b> {op.operator || '—'}</span>
                      <span><b className="text-slate-500">Planned Qty:</b> {Number(op.planned_qty) || 0}</span>
                      <span><b className="text-slate-500">Completed Qty:</b> {Number(op.completed_qty) || 0}</span>
                      <span><b className="text-slate-500">Rejected Qty:</b> <span className={Number(op.rejected_qty) > 0 ? 'text-rose-600 font-semibold' : ''}>{Number(op.rejected_qty) || 0}</span></span>
                      <span><b className="text-slate-500">Planned Time:</b> {plannedMinutes(op)} min</span>
                      <span><b className="text-slate-500">Actual Time:</b> {Number(op.actual_minutes) ? `${op.actual_minutes} min` : '—'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      <select
                        value={op.status}
                        onChange={(e) => updateOp(op, { status: e.target.value })}
                        className="text-xs font-medium rounded border border-slate-300 bg-white px-2 py-1 focus:outline-none focus:border-brand-500"
                      >
                        {OP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <label className="text-[11px] text-slate-500 font-medium">Completed Qty</label>
                      <input
                        type="number"
                        min="0"
                        defaultValue={Number(op.completed_qty) || 0}
                        key={`${op.id}-${op.completed_qty}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 0 && n !== Number(op.completed_qty)) {
                            updateOp(op, { completed_qty: n });
                          }
                        }}
                        className="w-20 text-xs rounded border border-slate-300 bg-white px-2 py-1 focus:outline-none focus:border-brand-500"
                      />
                      <label className="text-[11px] text-slate-500 font-medium">Rejected Qty</label>
                      <input
                        type="number"
                        min="0"
                        defaultValue={Number(op.rejected_qty) || 0}
                        key={`${op.id}-${op.rejected_qty}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 0 && n !== Number(op.rejected_qty)) {
                            updateOp(op, { rejected_qty: n });
                          }
                        }}
                        className="w-20 text-xs rounded border border-slate-300 bg-white px-2 py-1 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => updateWO({ status: 'Cancelled' })}
        title="Cancel Work Order"
        message={`Cancel Work Order ${wo.wo_no}? Scheduled job cards stay as-is; this cannot be undone.`}
        confirmLabel="Cancel Order"
        danger
      />
      <ConfirmDialog
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        onConfirm={() => updateWO({ status: 'Completed', completed: qty })}
        title="Complete Work Order"
        message={`Mark ${wo.wo_no} as Completed with quantity ${qty}? It will become eligible for Finished Goods entry.`}
        confirmLabel="Mark Completed"
      />
    </>
  );
}
