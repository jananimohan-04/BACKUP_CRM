import { Fragment, useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { Bot, Send, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Chat box for administrators. Questions go to the admin-assistant Edge Function, which answers ONLY from the
// database (read-only, with the caller's own permissions). Nothing is saved: closing the page clears the chat.

type Turn = { role: 'user' | 'assistant'; text: string; error?: boolean };

const EXAMPLES = ['How many quotations do we have?', 'Show quotations by status', 'Total value of sales orders this month', 'Top 5 customers by order value'];

/** Small safe markdown: **bold**, bullet lists, and pipe tables. Everything else is plain text (no HTML injection). */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>));
}
export function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*\|.*\|\s*$/.test(ln) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(ln); const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      i--;
      out.push(
        <div key={out.length} className="overflow-x-auto my-2"><table className="text-xs border border-slate-200 rounded">
          <thead className="bg-slate-50"><tr>{head.map((h, j) => <th key={j} className="text-left font-semibold px-2 py-1 border-b border-slate-200">{inline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, a) => <tr key={a} className="border-t border-slate-100">{r.map((c, b) => <td key={b} className="px-2 py-1 whitespace-nowrap">{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
    } else if (/^\s*[-*]\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      i--;
      out.push(<ul key={out.length} className="list-disc pl-5 my-1 space-y-0.5">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
    } else if (ln.trim() === '') {
      out.push(<div key={out.length} className="h-1.5" />);
    } else out.push(<p key={out.length}>{inline(ln)}</p>);
  }
  return <>{out}</>;
}

export function AdminAssistant() {
  const { isSuperAdmin, isCompanyAdmin, company } = useAuth();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy, open]);
  // A different company means different data: start a fresh conversation.
  useEffect(() => { setTurns([]); }, [company?.id]);

  // The Ask AI button can be dragged anywhere on the page; its spot is remembered.
  const POS_KEY = 'argus.assistant.pos';
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; }
  });
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const clampPos = (x: number, y: number, el: HTMLElement) => ({
    x: Math.min(Math.max(0, x), window.innerWidth - el.offsetWidth),
    y: Math.min(Math.max(0, y), window.innerHeight - el.offsetHeight),
  });
  const onDown = (e: RPointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy, e.currentTarget));
  };
  const onUp = () => {
    if (drag.current?.moved) { try { if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* not persisted */ } }
  };

  if (!isSuperAdmin && !isCompanyAdmin) return null;

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: 'user', text: question }];
    setTurns(next); setInput(''); setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-assistant', {
        body: { messages: next.filter(t => !t.error).map(t => ({ role: t.role, text: t.text })) },
      });
      if (error) {
        let msg = error.message;
        const res = (error as { context?: Response }).context;
        try { const b = await res?.clone().json(); if (b?.error) msg = String(b.error); } catch { /* not JSON */ }
        if (res?.status === 404 || /Failed to send a request/i.test(msg)) msg = 'The assistant is not set up yet (the admin-assistant Edge Function is not deployed in Supabase).';
        else if (res?.status === 403) msg = 'The assistant is only available to administrators.';
        setTurns(t => [...t, { role: 'assistant', text: msg, error: true }]);
      } else setTurns(t => [...t, { role: 'assistant', text: String(data?.answer ?? 'No answer returned.') }]);
    } catch (e) {
      setTurns(t => [...t, { role: 'assistant', text: `Could not reach the assistant: ${(e as Error).message}`, error: true }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {!open && (
        <button type="button" aria-label="Open data assistant" data-testid="assistant-open" title="Click to open · drag to move"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          onClick={() => { if (drag.current?.moved) { drag.current = null; return; } setOpen(true); }}
          style={pos ? { left: Math.min(pos.x, Math.max(0, window.innerWidth - 110)), top: Math.min(pos.y, Math.max(0, window.innerHeight - 48)) } : undefined}
          className={`fixed ${pos ? '' : 'bottom-5 max-lg:bottom-[4.75rem] right-5'} z-40 flex items-center gap-2 h-12 pl-4 pr-5 rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 touch-none select-none cursor-grab active:cursor-grabbing`}>
          <Bot size={20} /> <span className="text-sm font-semibold">Ask AI</span>
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Data assistant" data-testid="assistant-panel" className="fixed bottom-5 right-5 z-50 w-[min(420px,calc(100vw-2rem))] h-[min(620px,calc(100vh-2.5rem))] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
            <div className="flex items-center gap-2 min-w-0"><Bot size={18} className="shrink-0" /><div className="min-w-0"><p className="text-sm font-bold leading-tight">Data Assistant</p><p className="text-[10px] text-slate-300 truncate">Answers only from your ERP data · read-only{company ? ` · ${company.company_name}` : ' · all companies'}</p></div></div>
            <div className="flex items-center gap-1">
              {turns.length > 0 && <button type="button" aria-label="Clear chat" title="Clear chat" onClick={() => setTurns([])} className="p-1.5 hover:bg-white/10 rounded"><Trash2 size={15} /></button>}
              <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className="p-1.5 hover:bg-white/10 rounded"><X size={16} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50 text-sm" data-testid="assistant-log">
            {turns.length === 0 && (
              <div className="text-slate-500">
                <p className="mb-2">Ask anything about your ERP data. I only use what is in the database.</p>
                <div className="flex flex-wrap gap-1.5">{EXAMPLES.map(e => <button key={e} type="button" onClick={() => void ask(e)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-100">{e}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div data-testid={`turn-${t.role}`} className={`max-w-[92%] rounded-2xl px-3 py-2 ${t.role === 'user' ? 'bg-brand-600 text-white' : t.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-white border border-slate-200 text-slate-800'}`}>
                  {t.role === 'user' ? t.text : <RichText text={t.text} />}
                </div>
              </div>
            ))}
            {busy && <div className="text-xs text-slate-400 animate-pulse" data-testid="assistant-busy">Looking through your data…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={e => { e.preventDefault(); void ask(input); }} className="flex items-center gap-2 p-3 border-t border-slate-200 bg-white">
            <input aria-label="Ask a question" value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. How many quotations?" maxLength={1000}
              className="flex-1 h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-brand-500" />
            <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="h-10 w-10 flex items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40"><Send size={16} /></button>
          </form>
        </div>
      )}
    </>
  );
}
