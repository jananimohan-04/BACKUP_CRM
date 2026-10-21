import { useEffect, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, ChevronLeft, ChevronRight, Upload, Plus, RefreshCw, Search, X } from 'lucide-react';
import { Badge, Button, Card, statusToVariant } from '@/components/ui/Card';
import { FormField, inputClass, Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useNavigate } from 'react-router-dom';
import { financeApi, type BankFilters, type BankRow, type BankSummary } from '@/lib/finance';
import { formatDate, formatINR, todayISO } from '@/lib/format';
import { exportCsv } from '@/lib/reportExport';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalDateFilter } from '@/contexts/DateRangeContext';
import { intersectRange } from '@/lib/globalDate';

const PAGE=10;
const cash=(v:string|number|null|undefined)=>formatINR(v,{decimals:'auto'});
function monthStart(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01'}
const blank:BankSummary={accounts:[],total_bank:'0',total_cash:'0',total_receipts:'0',total_payments:'0',pending_clearing:'0',pending_count:0,receipts_vs_payments:[],expense_by_category:[]};

export function BankCashPage(){
  const {company}=useAuth();
  const navigate=useNavigate();
  const [tab,setTab]=useState('');
  const [draft,setDraft]=useState({from:monthStart(),to:todayISO(),account:'',type:'',party:'',search:''});
  const [filters,setFilters]=useState(draft);
  const [data,setData]=useState<BankRow[]>([]);
  const [summary,setSummary]=useState<BankSummary>(blank);
  const [options,setOptions]=useState<BankFilters|null>(null);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [entryOpen,setEntryOpen]=useState(false);
  const [transferOpen,setTransferOpen]=useState(false);
  const [reconcileOpen,setReconcileOpen]=useState(false);
  const [pending,setPending]=useState<BankRow[]>([]);
  const [form,setForm]=useState<any>({direction:'IN',account_id:'',contra_account_id:'',party_type:'Customer',party_id:'',party_name:'',invoice_id:'',amount:'',txn_date:todayISO(),mode:'',reference_no:'',description:'',status:'Cleared'});
  const [transfer,setTransfer]=useState<any>({from:'',to:'',amount:'',date:todayISO(),mode:'',reference:'',description:''});
  const [invoices,setInvoices]=useState<any[]>([]);

  const { from: globalFrom, to: globalTo } = useGlobalDateFilter();
  const reload=async(p=page,f=filters,t=tab)=>{
    setLoading(true);setError('');
    try{
      // Global Topbar range intersects the page's own From/To.
      const eff = intersectRange(f.from, f.to, globalFrom, globalTo);
      const [list,s]=await Promise.all([
        financeApi.bankTransactions({kind:t||null,account:f.account||null,type:f.type||null,party:f.party||null,search:f.search,from:eff.from||undefined,to:eff.to||undefined,page:p,pageSize:PAGE}),
        financeApi.bankSummary(eff.from||undefined,eff.to||undefined),
      ]);
      setData(list.rows);setTotal(list.total);setSummary(s||blank);setPage(p);
    }catch(e){setData([]);setTotal(0);setSummary(blank);setError(e instanceof Error?e.message:'Unable to load bank and cash data.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void reload(1,filters,tab)},[company?.id,tab,globalFrom,globalTo]);
  useEffect(()=>{
    let active=true;
    Promise.all([financeApi.bankFilters(),financeApi.invoices({page:1,pageSize:500})]).then(([f,i])=>{
      if(!active)return;setOptions(f);setInvoices(i.rows);
      const first=f.accounts?.[0]?.id||'';setForm((x:any)=>({...x,account_id:x.account_id||first}));
      const banks=f.accounts||[];setTransfer((x:any)=>({...x,from:x.from||banks[0]?.id||'',to:x.to||banks[1]?.id||''}));
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load account options.');});
    return()=>{active=false};
  },[company?.id]);
  const pageCount=Math.max(1,Math.ceil(total/PAGE));
  const submitEntry=async()=>{
    if(!form.account_id||Number(form.amount)<=0){setError('Choose an account and enter an amount greater than zero.');return}
    if(form.party_type!=='Other'&&!form.party_name){setError('Choose a party.');return}
    setBusy(true);setError('');
    try{
      await financeApi.addBankEntry({direction:form.direction,account_id:form.account_id,contra_account_id:form.contra_account_id||null,party_type:form.party_type,party_name:form.party_name||null,customer_id:form.party_type==='Customer'?form.party_id||null:null,supplier_id:form.party_type==='Supplier'?form.party_id||null:null,invoice_id:form.invoice_id||null,amount:form.amount,txn_date:form.txn_date,mode:form.mode,reference_no:form.reference_no,description:form.description,status:form.status});
      setEntryOpen(false);await reload(1);
    }catch(e){setError(e instanceof Error?e.message:'Unable to save transaction.');}
    finally{setBusy(false);}
  };
  const submitTransfer=async()=>{
    if(!transfer.from||!transfer.to||Number(transfer.amount)<=0){setError('Choose two accounts and enter an amount greater than zero.');return}
    setBusy(true);setError('');
    try{await financeApi.bankTransfer({from:transfer.from,to:transfer.to,amount:transfer.amount,date:transfer.date,mode:transfer.mode,reference:transfer.reference,description:transfer.description});setTransferOpen(false);await reload(1)}
    catch(e){setError(e instanceof Error?e.message:'Unable to transfer funds.');}
    finally{setBusy(false);}
  };
  const showReconcile=async()=>{
    setBusy(true);setError('');
    try{const all:BankRow[]=[];for(let p=1;p<=Math.max(1,Math.ceil(total/500));p++){const r=await financeApi.bankTransactions({page:p,pageSize:500});all.push(...r.rows);if(all.length>=r.total)break;}setPending(all.filter(x=>x.status==='Pending'));setReconcileOpen(true);}
    catch(e){setError(e instanceof Error?e.message:'Unable to load pending entries.');}
    finally{setBusy(false);}
  };
  const setStatus=async(id:string,status:string)=>{
    setBusy(true);
    try{await financeApi.bankSetStatus(id,status);setPending(pending.filter(x=>x.id!==id));await reload();}
    catch(e){setError(e instanceof Error?e.message:'Unable to update transaction status.');}
    finally{setBusy(false);}
  };
  const exportData=async()=>{
    setBusy(true);
    try{const all:BankRow[]=[];for(let p=1;p<=Math.max(1,Math.ceil(total/500));p++){const r=await financeApi.bankTransactions({kind:tab||null,account:filters.account||null,type:filters.type||null,party:filters.party||null,search:filters.search,from:filters.from,to:filters.to,page:p,pageSize:500});all.push(...r.rows);if(all.length>=r.total)break;}
      exportCsv('Bank_Cash_'+todayISO(),[['Date','Reference','Account','Type','Description','Company','Receipt','Payment','Balance','Mode','Status'],...all.map(x=>[x.txn_date,x.txn_no,x.account_name,x.kind,x.description||'',x.party_name||'',x.receipt||'',x.payment||'',x.balance||'',x.mode||'',x.status])]);
    }catch(e){setError(e instanceof Error?e.message:'Export failed.');}
    finally{setBusy(false);}
  };
  const parties=form.party_type==='Supplier'?(options?.suppliers||[]):(options?.customers||[]);
  const contraOptions=form.direction==='IN'?(options?.income_accounts||[]):(options?.expense_accounts||[]);
  const accountList=options?.accounts||[];
  const maxChart=Math.max(1,...summary.receipts_vs_payments.map(x=>Math.max(Number(x.receipts),Number(x.payments))));

  return <div className="p-4 lg:p-6 space-y-4 bg-slate-50 min-h-full">
    <PageHeader title="Bank & Cash" description="Manage bank and cash transactions, receipts and payments." actions={<>
      <Button variant="secondary" size="sm" onClick={()=>navigate('/finance/bank-entry')}>Bank Entry (Import)</Button>
      <Button size="sm" icon={<Plus size={14}/>} disabled={!options?.can_manage} onClick={()=>setEntryOpen(true)}>Add Entry</Button>
      <Button variant="secondary" size="sm" icon={<ArrowLeftRight size={14}/>} disabled={!options?.can_manage} onClick={()=>setTransferOpen(true)}>Bank Transfer</Button>
      <Button variant="secondary" size="sm" icon={<RefreshCw size={14}/>} disabled={!options?.can_manage||busy} onClick={()=>void showReconcile()}>Reconcile</Button>
      <Button variant="secondary" size="sm" icon={<Upload size={14}/>} onClick={()=>void exportData()} disabled={busy}>Export</Button>
    </>}/>
    {error&&<div className="border border-rose-200 bg-rose-50 text-rose-700 rounded p-2 text-sm">{error}</div>}
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
      <Metric label="Total Bank Balance" value={cash(summary.total_bank)} tint="blue"/><Metric label="Cash in Hand" value={cash(summary.total_cash)} tint="amber"/><Metric label="Total Receipts" value={cash(summary.total_receipts)} tint="green"/><Metric label="Total Payments" value={cash(summary.total_payments)} tint="rose"/><Metric label="Pending Clearing" value={cash(summary.pending_clearing)} note={String(summary.pending_count)+' transaction(s)'} tint="violet"/>
    </div>
    <div className="flex overflow-auto border-b">{[['','All Entries'],['Receipts','Receipts'],['Payments','Payments'],['Bank Transfer','Bank Transfer'],['Cash Entries','Cash Entries']].map(([v,l])=><button key={v} onClick={()=>{setTab(v);setPage(1)}} className={'px-4 py-2 text-xs font-semibold border-b-2 whitespace-nowrap '+(tab===v?'border-brand-600 text-brand-700':'border-transparent text-slate-500')}>{l}</button>)}</div>
    <Card className="p-3"><div className="grid grid-cols-2 xl:grid-cols-7 gap-2 items-end">
      <FormField label="From Date"><input type="date" className={inputClass} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></FormField>
      <FormField label="To Date"><input type="date" className={inputClass} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></FormField>
      <FormField label="Bank / Cash Account"><select className={inputClass} value={draft.account} onChange={e=>setDraft({...draft,account:e.target.value})}><option value="">All Accounts</option>{accountList.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></FormField>
      <FormField label="Type"><select className={inputClass} value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="">All</option><option value="IN">Receipt</option><option value="OUT">Payment</option><option value="Transfer">Transfer</option><option value="Cash">Cash Entry</option></select></FormField>
      <FormField label="Company"><select className={inputClass} value={draft.party} onChange={e=>setDraft({...draft,party:e.target.value})}><option value="">All Companies / Suppliers</option>{[...(options?.customers||[]),...(options?.suppliers||[])].map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>
      <FormField label="Search"><div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400"/><input className={inputClass+' pl-8'} placeholder="Reference, description, company..." value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})}/></div></FormField>
      <Button size="sm" onClick={()=>{setFilters(draft);void reload(1,draft,tab)}}>Apply</Button><Button size="sm" variant="secondary" onClick={()=>{const f={from:'',to:'',account:'',type:'',party:'',search:''};setDraft(f);setFilters(f);void reload(1,f,tab)}}>Clear</Button>
    </div></Card>
    <Card className="overflow-hidden"><div className="overflow-auto"><table className="w-full min-w-[980px] text-left"><thead><tr className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b">{['#','Date','Account','Type','Description','Reference No','Company','Receipt','Payment','Balance','Mode','Status','Actions'].map(x=><th key={x} className="px-2 py-2">{x}</th>)}</tr></thead><tbody>
      {loading?<tr><td colSpan={13} className="p-10 text-center">Loading transactions...</td></tr>:data.map((r,i)=><tr key={r.id} className="border-b hover:bg-slate-50 text-xs"><td className="px-2 py-2 text-slate-400">{(page-1)*PAGE+i+1}</td><td className="px-2 py-2">{formatDate(r.txn_date)}</td><td className="px-2 py-2 font-medium">{r.account_name}</td><td className="px-2 py-2"><Badge variant={r.direction==='IN'?'success':'warning'}>{r.transfer_group?'Transfer':r.kind}</Badge></td><td className="px-2 py-2">{r.description||'—'}</td><td className="px-2 py-2 font-mono">{r.reference_no||r.txn_no}</td><td className="px-2 py-2">{r.party_name||'—'}</td><td className="px-2 py-2 text-right text-emerald-700">{r.receipt?cash(r.receipt):'—'}</td><td className="px-2 py-2 text-right text-rose-700">{r.payment?cash(r.payment):'—'}</td><td className="px-2 py-2 text-right">{r.balance?cash(r.balance):'—'}</td><td className="px-2 py-2">{r.mode||'—'}</td><td className="px-2 py-2"><Badge variant={statusToVariant(r.status)}>{r.status}</Badge></td><td className="px-2 py-2">{r.invoice_id&&<button title="View linked invoice" onClick={()=>navigate('/finance/invoices?invoice='+encodeURIComponent(r.invoice_id!))} className="mr-1 text-blue-700 underline">Invoice</button>}{r.status==='Pending'&&options?.can_manage?<button title="Clear transaction" onClick={()=>void setStatus(r.id,'Cleared')} className="p-1 text-emerald-600"><CheckCircle2 size={15}/></button>:null}</td></tr>)}
      {!loading&&!data.length&&<tr><td colSpan={13} className="p-6 text-center text-slate-500">No transactions found for these filters.</td></tr>}
    </tbody></table></div><div className="flex justify-between p-2 border-t text-xs text-slate-500"><span>{total?((page-1)*PAGE+1):0}-{Math.min(page*PAGE,total)} of {total}</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>void reload(page-1)}><ChevronLeft size={16}/></button>{page}/{pageCount}<button disabled={page>=pageCount} onClick={()=>void reload(page+1)}><ChevronRight size={16}/></button></div></div></Card>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card className="p-4"><h3 className="font-bold text-sm mb-3">Account Balances</h3>{summary.accounts.map(a=><div key={a.id} className="flex justify-between border-b py-2 text-xs"><span>{a.name}<small className="block text-slate-400">{a.type}</small></span><b>{cash(a.balance)}</b></div>)}<div className="flex justify-between pt-2 text-xs font-bold"><span>Total</span><span>{cash(Number(summary.total_bank)+Number(summary.total_cash))}</span></div></Card>
      <Card className="p-4"><h3 className="font-bold text-sm mb-3">Receipts vs Payments</h3><div className="flex gap-2 items-end h-36 border-b">{summary.receipts_vs_payments.length?summary.receipts_vs_payments.map(x=><div key={x.week} className="flex-1 h-full flex items-end justify-center gap-1" title={formatDate(x.week)}><div className="w-3 bg-emerald-500 rounded-t" style={{height:Math.max(2,Number(x.receipts)/maxChart*120)}}/><div className="w-3 bg-rose-400 rounded-t" style={{height:Math.max(2,Number(x.payments)/maxChart*120)}}/></div>):<span className="w-full self-center text-center text-xs text-slate-400">No transaction data.</span>}</div><div className="flex gap-3 mt-2 text-[10px]"><span className="text-emerald-700">Receipts</span><span className="text-rose-700">Payments</span></div></Card>
      <Card className="p-4"><h3 className="font-bold text-sm mb-3">Expense by Category</h3>{summary.expense_by_category.length?summary.expense_by_category.slice(0,6).map((x,i)=><div key={x.name} className="mb-2"><div className="flex justify-between text-xs"><span>{x.name}</span><b>{cash(x.value)}</b></div><div className="h-1.5 bg-slate-100 rounded mt-1"><div className={'h-full rounded '+['bg-blue-500','bg-amber-400','bg-emerald-500','bg-violet-500','bg-rose-500','bg-cyan-500'][i]} style={{width:(Math.max(0,Number(x.value))/Math.max(1,...summary.expense_by_category.map(y=>Number(y.value)))*100)+'%'}}/></div></div>):<div className="text-xs text-slate-400">No classified expense transactions.</div>}</Card>
    </div>
    <Modal open={entryOpen} onClose={()=>!busy&&setEntryOpen(false)} title="Add Bank / Cash Entry" subtitle="This transaction posts to the account ledger." size="2xl" footer={<><Button variant="secondary" onClick={()=>setEntryOpen(false)}>Cancel</Button><Button disabled={busy} onClick={()=>void submitEntry()}>{busy?'Saving...':'Save Entry'}</Button></>}>
      <div className="grid md:grid-cols-2 gap-3">
        <FormField label="Direction"><select className={inputClass} value={form.direction} onChange={e=>setForm({...form,direction:e.target.value,contra_account_id:''})}><option value="IN">Receipt</option><option value="OUT">Payment</option></select></FormField>
        <FormField label="Bank / Cash Account"><select className={inputClass} value={form.account_id} onChange={e=>setForm({...form,account_id:e.target.value})}>{accountList.map(a=><option key={a.id} value={a.id}>{a.name} · {cash(a.balance)}</option>)}</select></FormField>
        <FormField label="Company Type"><select className={inputClass} value={form.party_type} onChange={e=>setForm({...form,party_type:e.target.value,party_id:'',party_name:''})}><option>Customer</option><option>Supplier</option><option>Other</option></select></FormField>
        {form.party_type==='Other'?<FormField label="Company Name"><input className={inputClass} value={form.party_name} onChange={e=>setForm({...form,party_name:e.target.value})}/></FormField>:<FormField label="Company"><select className={inputClass} value={form.party_id} onChange={e=>{const x=parties.find((p:any)=>p.id===e.target.value);setForm({...form,party_id:e.target.value,party_name:x?.name||''})}}><option value="">Select company</option>{parties.map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></FormField>}
        <FormField label="Invoice (optional)"><select className={inputClass} value={form.invoice_id} onChange={e=>{const inv=invoices.find(x=>x.id===e.target.value);setForm({...form,invoice_id:e.target.value,party_type:'Customer',party_name:inv?.customer_name||form.party_name,party_id:inv?.customer_id||form.party_id,amount:inv?.balance||form.amount})}}><option value="">Not linked</option>{invoices.filter(i=>i.invoice_type==='Sales Invoice'&&i.status!=='Cancelled'&&Number(i.balance)>0).map(i=><option key={i.id} value={i.id}>{i.invoice_no} · {i.customer_name} · {cash(i.balance)}</option>)}</select></FormField>
        <FormField label="Amount"><input type="number" min="0.01" className={inputClass} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></FormField>
        <FormField label="Date"><input type="date" className={inputClass} value={form.txn_date} onChange={e=>setForm({...form,txn_date:e.target.value})}/></FormField>
        <FormField label="Mode"><input className={inputClass} value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}/></FormField>
        <FormField label="Contra Account"><select className={inputClass} value={form.contra_account_id} onChange={e=>setForm({...form,contra_account_id:e.target.value})}><option value="">Receivables / Payables default</option>{contraOptions.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></FormField>
        <FormField label="Reference No"><input className={inputClass} value={form.reference_no} onChange={e=>setForm({...form,reference_no:e.target.value})}/></FormField>
        <FormField label="Description"><input className={inputClass} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></FormField>
      </div>
    </Modal>
    <Modal open={transferOpen} onClose={()=>!busy&&setTransferOpen(false)} title="Bank Transfer" subtitle="Creates paired, ledger-posted transfer entries." footer={<><Button variant="secondary" onClick={()=>setTransferOpen(false)}>Cancel</Button><Button disabled={busy} onClick={()=>void submitTransfer()}>Transfer</Button></>}>
      <div className="grid md:grid-cols-2 gap-3"><FormField label="From Account"><select className={inputClass} value={transfer.from} onChange={e=>setTransfer({...transfer,from:e.target.value})}>{accountList.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></FormField><FormField label="To Account"><select className={inputClass} value={transfer.to} onChange={e=>setTransfer({...transfer,to:e.target.value})}>{accountList.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></FormField><FormField label="Amount"><input type="number" min="0.01" className={inputClass} value={transfer.amount} onChange={e=>setTransfer({...transfer,amount:e.target.value})}/></FormField><FormField label="Date"><input type="date" className={inputClass} value={transfer.date} onChange={e=>setTransfer({...transfer,date:e.target.value})}/></FormField><FormField label="Mode"><input className={inputClass} value={transfer.mode} onChange={e=>setTransfer({...transfer,mode:e.target.value})}/></FormField><FormField label="Reference"><input className={inputClass} value={transfer.reference} onChange={e=>setTransfer({...transfer,reference:e.target.value})}/></FormField></div>
    </Modal>
    <Modal open={reconcileOpen} onClose={()=>setReconcileOpen(false)} title="Reconciliation" subtitle="Pending bank and cash transactions" size="2xl">
      {pending.length?pending.map(r=><div key={r.id} className="flex items-center justify-between gap-3 border-b py-2 text-xs"><span>{formatDate(r.txn_date)} · {r.txn_no} · {r.account_name} · {r.party_name||r.description}</span><b>{cash(r.amount)}</b><Button size="sm" onClick={()=>void setStatus(r.id,'Cleared')} disabled={busy}>Mark Cleared</Button></div>):<div className="py-8 text-center text-sm text-slate-500">No pending entries to reconcile.</div>}
    </Modal>
  </div>;
}
function Metric({label,value,note,tint}:{label:string;value:string;note?:string;tint:string}){const styles:Record<string,string>={blue:'bg-blue-50 text-blue-700',amber:'bg-amber-50 text-amber-700',green:'bg-emerald-50 text-emerald-700',rose:'bg-rose-50 text-rose-700',violet:'bg-violet-50 text-violet-700'};return <Card className="p-3"><div className="text-[10px] text-slate-500">{label}</div><div className="font-bold truncate">{value}</div><div className={'mt-2 h-1 rounded '+styles[tint]} />{note&&<div className="text-[10px] text-slate-400 mt-1">{note}</div>}</Card>}
