import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { supabase } from '@/lib/supabase';
import { financeApi, type BankFilters } from '@/lib/finance';
import { accountingApi, type Account } from '@/lib/accounting';
import { formatINR, todayISO } from '@/lib/format';
import { MemberSelect, useMemberNames } from '@/components/MemberSelect';

// Members' Petty Cash: for each member, the money given to them minus what they paid out of pocket on inwards
// (Inward > Petty cash). Positive = they hold company money, negative = the company owes them.

const SOURCE = 'petty_cash';
const dmy = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

type Note = { kind: 'ok' | 'err'; text: string } | null;

export function MemberPettyCashPage() {
  const { setHeader } = useHeaderKpis();
  const { company } = useAuth();
  const cid = company?.id ?? null;
  useEffect(() => {
    setHeader({ title: "Members' Petty Cash" });
    return () => setHeader(null);
  }, [setHeader]);

  const [options, setOptions] = useState<BankFilters | null>(null);
  const [chart, setChart] = useState<Account[]>([]);
  const [note, setNote] = useState<Note>(null);
  const [date, setDate] = useState(todayISO());
  const [bankId, setBankId] = useState('');
  const accounts = options?.accounts ?? [];
  const canManage = !!options?.can_manage;

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [o, c] = await Promise.all([financeApi.bankFilters(), accountingApi.chartOfAccounts()]);
        if (off) return;
        setOptions(o); setChart(c);
        setBankId(b => b || o.accounts.find(a => a.type === 'Cash')?.id || o.accounts[0]?.id || '');
      } catch (e) { if (!off) setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not load accounts.' }); }
    })();
    return () => { off = true; };
  }, [cid]);

  // Member wallets. Money given to a member (before they spend, or to pay them back) minus what they paid out of pocket
  // (Inward > Petty cash): positive = they hold company money, negative = the company owes them.
  interface Wallet { member: string; given: number; spent: number; balance: number; items: number }
  const [spentRows, setSpentRows] = useState<{ member: string; amount: number }[]>([]);
  const [duesErr, setDuesErr] = useState('');
  const [paying, setPaying] = useState(false);
  const [gMember, setGMember] = useState('');
  const [gAmount, setGAmount] = useState('');
  const [openMember, setOpenMember] = useState('');
  const memberPayable = chart.find(a => a.system_key === 'MEMBER_PAYABLE');
  const loadSpent = useCallback(async () => {
    const r = await supabase.from('cnc_inwards').select('paid_by,total_amount,petty_amount,status').eq('petty_cash', true).neq('status', 'Deleted');
    if (r.error) { setSpentRows([]); setDuesErr(/petty_cash|petty_amount/.test(r.error.message) ? 'Petty cash tracking is not set up yet. Run the 20261019000000_expense_accounting.sql migration.' : r.error.message); return; }
    setDuesErr('');
    setSpentRows(((r.data ?? []) as Record<string, unknown>[]).map(x => {
      const total = Number(x.total_amount) || 0;
      const paid = x.petty_amount == null ? total : Math.min(total, Number(x.petty_amount) || 0);
      return { member: String(x.paid_by ?? '').trim() || 'Unnamed member', amount: paid };
    }));
  }, []);
  useEffect(() => { void loadSpent(); }, [loadSpent, cid]);
  // Entries that moved money to / from a member are the ones posted against Payable to Members with the member's name.
  const [memberTxns, setMemberTxns] = useState<{ id: string; member: string; direction: 'IN' | 'OUT'; amount: number; date: string; description: string }[]>([]);
  const loadMemberTxns = useCallback(async () => {
    if (!memberPayable) { setMemberTxns([]); return; }
    const r = await supabase.from('cnc_bank_transactions').select('id,party_name,direction,amount,txn_date,description,status')
      .eq('contra_account_id', memberPayable.id).neq('status', 'Cancelled').not('party_name', 'is', null).order('txn_date', { ascending: false });
    if (r.error) { setMemberTxns([]); return; }
    setMemberTxns(((r.data ?? []) as Record<string, unknown>[]).map(x => ({
      id: String(x.id), member: String(x.party_name ?? '').trim(), direction: x.direction === 'IN' ? 'IN' : 'OUT',
      amount: Number(x.amount) || 0, date: String(x.txn_date ?? '').slice(0, 10), description: String(x.description ?? ''),
    })));
  }, [memberPayable?.id]);
  useEffect(() => { void loadMemberTxns(); }, [loadMemberTxns, cid]);
  const wallets = useMemo(() => {
    const m = new Map<string, Wallet>();
    const get = (name: string) => { const k = name.toLowerCase(); let w = m.get(k); if (!w) { w = { member: name, given: 0, spent: 0, balance: 0, items: 0 }; m.set(k, w); } return w; };
    for (const t of memberTxns) get(t.member).given += t.direction === 'OUT' ? t.amount : -t.amount;
    for (const x of spentRows) { const w = get(x.member); w.spent += x.amount; w.items += 1; }
    for (const w of m.values()) w.balance = Math.round((w.given - w.spent) * 100) / 100;
    return [...m.values()].sort((a, b) => a.member.localeCompare(b.member));
  }, [memberTxns, spentRows]);
  const memberOptions = useMemberNames(cid, wallets.map(w => w.member));
  const giveMoney = async () => {
    setNote(null);
    const member = gMember.trim(); const amt = Number(gAmount.replace(/,/g, '')) || 0;
    if (!member) return setNote({ kind: 'err', text: 'Enter the member the money is for.' });
    if (!(amt > 0)) return setNote({ kind: 'err', text: 'Enter the amount.' });
    if (!memberPayable) return setNote({ kind: 'err', text: 'The "Payable to Members" ledger does not exist yet. Run the 20261019000000_expense_accounting.sql migration.' });
    if (!bankId) return setNote({ kind: 'err', text: 'Select the bank / cash account the money is paid from (Bank name below).' });
    setPaying(true);
    try {
      await financeApi.addBankEntry({
        direction: 'OUT', account_id: bankId, contra_account_id: memberPayable.id, amount: String(Math.round(amt * 100) / 100), txn_date: date,
        mode: 'Petty cash', description: `Petty cash given to ${member}`, status: 'Cleared', source_type: SOURCE, party_type: 'Other', party_name: member,
      });
      setNote({ kind: 'ok', text: `${formatINR(amt)} given to ${member}. Posted to the ledger.` });
      setGAmount('');
      await Promise.all([loadMemberTxns(), loadSpent()]);
    } catch (e) { setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not save this.' }); }
    finally { setPaying(false); }
  };

  return (
    <div className="p-2 sm:p-4 lg:px-6 lg:pt-2 lg:pb-6 bg-grid min-h-full">
      <div className="max-w-[1500px] mx-auto flex flex-col gap-2.5">
        {/* ---------- member wallets ---------- */}
        <section className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden" data-testid="petty-dues">
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-1.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-800">Members petty cash</h2>
            <span className="text-[11px] text-amber-700">Money given to a member is reduced by what they pay on inwards. + they hold company money · − the company owes them.</span>
          </div>
          {duesErr && <p className="px-3 py-2 text-xs text-amber-700">{duesErr}</p>}
          <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-3 py-2">
            <div className="w-[190px]"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-member">Member</label>
              <MemberSelect className="w-full h-8 px-2 text-xs bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" options={memberOptions} value={gMember} onChange={setGMember} /></div>
            <div className="w-[110px]"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-gamt">Amount given</label>
              <input id="pc-gamt" inputMode="decimal" placeholder="0.00" className="w-full h-8 px-2 text-xs bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={gAmount} onChange={e => setGAmount(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void giveMoney(); }} /></div>
            <div className="w-[170px]"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-bank">Paid from <span className="text-red-500">*</span></label>
              <select id="pc-bank" className="w-full h-8 px-2 text-xs bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400 cursor-pointer" value={bankId} onChange={e => setBankId(e.target.value)}>
                <option value="">Select bank / cash</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.type === 'Cash' ? ' (Cash)' : ''}</option>)}
              </select></div>
            <div className="w-[130px]"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="pc-date">Date</label>
              <input id="pc-date" type="date" className="w-full h-8 px-2 text-xs bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:border-orange-400" value={date} onChange={e => setDate(e.target.value)} /></div>
            <button type="button" disabled={!canManage || paying} onClick={() => void giveMoney()} className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">{paying ? 'Saving…' : 'Give money'}</button>
            <span className="pb-1 text-[11px] text-slate-500">Paid from the bank / cash account chosen here.</span>
          </div>
          {wallets.length === 0 ? <p className="px-3 py-3 text-xs text-slate-400">No member petty cash yet. Tick "Petty cash" on an inward, or give a member money above.</p> : (
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="px-3 py-1">Member</th><th className="px-3 py-1 text-right">Given</th><th className="px-3 py-1 text-right">Spent (inwards)</th><th className="px-3 py-1 text-right">Balance</th><th className="px-3 py-1" /></tr></thead>
              <tbody>
                {wallets.map(w => (
                  <Fragment key={w.member}>
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-1 font-semibold text-slate-800"><button type="button" className="hover:underline" onClick={() => setOpenMember(openMember === w.member ? '' : w.member)}>{w.member}</button></td>
                      <td className="px-3 py-1 text-right tabular-nums">{formatINR(w.given, { decimals: 'always' })}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{formatINR(w.spent, { decimals: 'always' })} <span className="text-slate-400">({w.items})</span></td>
                      <td className={`px-3 py-1 text-right font-bold tabular-nums ${w.balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {w.balance < 0 ? `− ${formatINR(-w.balance, { decimals: 'always' })} company owes` : `+ ${formatINR(w.balance, { decimals: 'always' })}${w.balance > 0 ? ' holding' : ''}`}
                      </td>
                      <td className="px-3 py-1 text-right">
                        {w.balance < 0 && <button type="button" disabled={!canManage} onClick={() => { setGMember(w.member); setGAmount(String(-w.balance)); }} className="h-7 rounded-md border border-emerald-300 px-3 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Pay {formatINR(-w.balance)}</button>}
                      </td>
                    </tr>
                    {openMember === w.member && (
                      <tr className="bg-slate-50"><td colSpan={5} className="px-6 py-1.5 text-[11px] text-slate-600">
                        {memberTxns.filter(t => t.member.toLowerCase() === w.member.toLowerCase()).map(t => <div key={t.id}>{dmy(t.date)} · {t.direction === 'OUT' ? 'Given' : 'Returned'} {formatINR(t.amount, { decimals: 'always' })} · {t.description}</div>)}
                        {memberTxns.every(t => t.member.toLowerCase() !== w.member.toLowerCase()) && <div>No money given yet.</div>}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {options && !canManage && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Only administrators can give money to members. You can still view the balances.</p>}
        {note && (
          <div role="status" className={`flex items-start gap-2 text-sm rounded-xl border px-3.5 py-2.5 ${note.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {note.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}<span>{note.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
