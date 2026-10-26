import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Compass, Database, HelpCircle, Languages, Volume2, VolumeX, X, PlayCircle, SkipForward } from 'lucide-react';
import { GUIDES } from '@/lib/guides';
import { dialogTitle, findTarget, guidesFor, pick, stepSpeech, topDialog, type Guide, type GuideLang, type GuideStep } from '@/lib/guides/engine';
import { offlineAnswer, say, stopSpeaking } from '@/components/HelpAssistant';
import { navSections, pageTitles } from '@/config/navigation';

// All ERP pages for full teaching mode (navigates through entire ERP)
const ALL_ERP_PAGES = navSections.flatMap(s => s.items.map(i => ({ page: i.page, label: i.label, section: s.label })));

// Comprehensive page teaching content - teaches ALL functions on each page
const PAGE_TEACHINGS: Record<string, { en: string; ta: string }> = {
  '/sales/pipeline': {
    en: `Welcome to the Sales Pipeline! This is the heart of your sales process. 
    
    The Kanban Board shows all your orders moving from left to right through stages: Enquiry, Quotation, Sales Order, Inward, Finished Goods, Delivery Challan, and Invoice.
    
    At the top, you see quick stats showing counts for each stage. Click any stat to see the full list.
    
    The Add Company button lets you add new customers. Enter their name, address, GST number, and contact details.
    
    The Add Enquiry button creates a new customer request. Pick the company, add products they want, quantity, and any remarks.
    
    Each card on the board represents one order. You can drag cards between columns to change their status.
    
    Click any card to see full details and take actions like creating a quotation, sales order, or delivery challan.
    
    The Create Quotation button generates a price quote for the customer with products, quantities, prices, and terms.
    
    Use the Search bar to find specific enquiries, companies, or products.
    
    The Filter options let you see only certain stages or date ranges.
    
    Switch between Kanban Board, List View, and Calendar views using the tabs at the top.`,
    ta: `Sales Pipeline-க்கு வரவேற்கிறோம்! இது உங்கள் விற்பனை செயல்முறையின் இதயம்.
    
    Kanban Board அனைத்து ஆர்டர்களையும் இடமிருந்து வலமாக நிலைகளில் காட்டுகிறது: Enquiry, Quotation, Sales Order, Inward, Finished Goods, Delivery Challan, Invoice.
    
    மேலே ஒவ்வொரு நிலைக்கான எண்ணிக்கைகளைக் காட்டும் விரைவு புள்ளிவிவரங்கள் உள்ளன.
    
    Add Company பட்டன் புதிய வாடிக்கையாளர்களைச் சேர்க்க அனுமதிக்கிறது.
    
    Add Enquiry பட்டன் புதிய வாடிக்கையாளர் கோரிக்கையை உருவாக்குகிறது.
    
    ஒவ்வொரு அட்டையும் ஒரு ஆர்டரைக் குறிக்கிறது. நிலையை மாற்ற அட்டைகளை நெடுவரிசைகளுக்கு இடையே இழுக்கலாம்.`
  },
  '/production/scheduling': {
    en: `Welcome to Machine Scheduling! This page helps you plan production on your machines.
    
    The timeline shows all machines on the left and time slots across the top.
    
    Drag unscheduled jobs from the sidebar onto a machine's timeline to schedule them.
    
    Each colored block represents a scheduled job. The color indicates the priority or status.
    
    Double-click any scheduled block to edit its timing, machine, or other details.
    
    Use the date picker to navigate to different days or weeks.
    
    The filter buttons let you show only certain machines or job types.
    
    Right-click a scheduled job for quick actions like reschedule, cancel, or mark complete.
    
    The capacity indicator shows how loaded each machine is.
    
    Conflicts are highlighted in red - this means jobs overlap or exceed machine capacity.`,
    ta: `Machine Scheduling-க்கு வரவேற்கிறோம்! இந்தப் பக்கம் உங்கள் இயந்திரங்களில் உற்பத்தியைத் திட்டமிட உதவுகிறது.
    
    Timeline இடதுபுறத்தில் அனைத்து இயந்திரங்களையும், மேலே நேர slot-களையும் காட்டுகிறது.
    
    திட்டமிடாத வேலைகளை sidebar-லிருந்து இயந்திர timeline-க்கு இழுத்து திட்டமிடுங்கள்.
    
    ஒவ்வொரு வண்ண block-ம் திட்டமிடப்பட்ட வேலையைக் குறிக்கிறது.`
  },
  '/production/planning': {
    en: `Welcome to Production Planning! Here you manage all your production work orders.
    
    The table shows all work orders with their status, customer, product, quantity, and due date.
    
    Click New Work Order to create a new production order. Select the sales order, product, and quantity to produce.
    
    Each work order can have multiple job cards - one for each operation like cutting, machining, finishing.
    
    Click a work order row to see its job cards and track progress.
    
    Use the Status filter to see only pending, in-progress, or completed orders.
    
    The Actions column has buttons to create job cards, view details, or close the work order.
    
    Export the list to Excel using the Export button for reporting.`,
    ta: `Production Planning-க்கு வரவேற்கிறோம்! இங்கே நீங்கள் அனைத்து உற்பத்தி work orders-ஐயும் நிர்வகிக்கிறீர்கள்.`
  },
  '/finance/invoices': {
    en: `Welcome to Invoices! Here you create and manage all your sales invoices.
    
    The invoice list shows all invoices with number, date, customer, amount, and payment status.
    
    Click Create Invoice to make a new invoice. You can create from a delivery challan or directly.
    
    Each invoice shows line items with product, quantity, rate, tax, and total.
    
    The Record Receipt button lets you record payments against invoices.
    
    Use Print or Download to get a PDF of the invoice.
    
    The email button sends the invoice directly to the customer.
    
    Filter by date range, customer, or payment status to find specific invoices.
    
    Unpaid invoices are highlighted. You can see aging reports to track overdue payments.`,
    ta: `Invoices-க்கு வரவேற்கிறோம்! இங்கே நீங்கள் அனைத்து விற்பனை invoices-ஐயும் உருவாக்கி நிர்வகிக்கிறீர்கள்.`
  },
  '/finance/bank-entry': {
    en: `Welcome to Bank Entry! Here you record all bank transactions.
    
    Click Add Entry to record a deposit, withdrawal, or transfer.
    
    Select the bank account, enter the amount, date, and description.
    
    For customer receipts, link it to an invoice so it marks as paid.
    
    For supplier payments, link it to a purchase order.
    
    The Import Statement button lets you upload bank statements to reconcile transactions.
    
    View the running balance for each account.
    
    Transfer between accounts using the Transfer button.`,
    ta: `Bank Entry-க்கு வரவேற்கிறோம்! இங்கே நீங்கள் அனைத்து வங்கி பரிவர்த்தனைகளையும் பதிவு செய்கிறீர்கள்.`
  },
  '/accounts/ledger': {
    en: `Welcome to Ledger! This shows all account transactions.
    
    Select an account from the dropdown to see its transactions.
    
    Each row shows date, description, debit, credit, and running balance.
    
    Use the date filter to see transactions for a specific period.
    
    Export to PDF or Excel for reporting and auditing.
    
    Double-click any entry to see the full voucher details.
    
    The opening balance and closing balance are shown at top and bottom.`,
    ta: `Ledger-க்கு வரவேற்கிறோம்! இது அனைத்து கணக்கு பரிவர்த்தனைகளையும் காட்டுகிறது.`
  },
  '/accounts/trial-balance': {
    en: `Welcome to Trial Balance! This shows debit and credit totals for all accounts.
    
    All accounts are listed with their debit or credit balance.
    
    The totals at the bottom should match - this confirms your books are balanced.
    
    Use the date picker to see trial balance as of a specific date.
    
    Export to PDF or Excel for auditing purposes.
    
    Click any account to drill down into its ledger.`,
    ta: `Trial Balance-க்கு வரவேற்கிறோம்!`
  },
  '/inventory/stock': {
    en: `Welcome to Stock Overview! Here you see all your inventory.
    
    The table shows items with current quantity, location, and value.
    
    Use Add Stock to record incoming inventory.
    
    Use Stock Out to record items used or sold.
    
    The low stock alert shows items below minimum quantity.
    
    Click an item to see its movement history.
    
    Use filters to see only certain categories or locations.
    
    Export the full inventory list to Excel.`,
    ta: `Stock Overview-க்கு வரவேற்கிறோம்!`
  },
  '/purchasing/orders': {
    en: `Welcome to Purchase Orders! Here you manage orders to your suppliers.
    
    Click New Purchase Order to create an order.
    
    Select the supplier, add items with quantities and prices.
    
    Submit for approval or send directly to supplier.
    
    Track order status: Draft, Sent, Confirmed, Received.
    
    Record Goods Receipt when items arrive.
    
    View supplier-wise purchase history.`,
    ta: `Purchase Orders-க்கு வரவேற்கிறோம்!`
  },
  '/dashboard': {
    en: `Welcome to the Dashboard! This gives you a bird's eye view of your business.
    
    The KPI cards at the top show key metrics: sales this month, pending orders, revenue, and more.
    
    Click any KPI card to drill down into details.
    
    Charts show trends over time - sales, production, inventory levels.
    
    The recent activity section shows latest enquiries, orders, and deliveries.
    
    Use the date range picker to change the reporting period.
    
    Quick action buttons let you add enquiry, create invoice, or view reports.`,
    ta: `Dashboard-க்கு வரவேற்கிறோம்! இது உங்கள் வணிகத்தின் பறவைப் பார்வையை வழங்குகிறது.`
  },
  '/costing/job-costing': {
    en: `Welcome to Project Costing! Here you track costs for each project.
    
    See material cost, labor cost, machine cost, and overheads for each job.
    
    Compare estimated vs actual costs.
    
    Add cost entries for materials used, labor hours, and machine time.
    
    View profitability by project.
    
    Export cost reports for analysis.`,
    ta: `Project Costing-க்கு வரவேற்கிறோம்!`
  },
  '/engineering/cnc-vault': {
    en: `Welcome to Products and Drawings! Here you manage product specifications.
    
    Add new products with their specifications and drawings.
    
    Upload drawing files (PDF, DXF, DWG) for each product.
    
    Create Bill of Materials (BOM) linking components to products.
    
    Define routing - the sequence of operations to make the product.
    
    Track drawing revisions and version history.
    
    Search products by name, code, or customer.`,
    ta: `Products and Drawings-க்கு வரவேற்கிறோம்!`
  },
  '/admin/users': {
    en: `Welcome to User Management! Here you manage who can access the system.
    
    Add new users with their email and password.
    
    Assign roles: Admin, Manager, Operator, Viewer.
    
    Set permissions for what each user can see and do.
    
    Deactivate users who should no longer have access.
    
    View login history and audit trail.`,
    ta: `User Management-க்கு வரவேற்கிறோம்!`
  },
  '/support/center': {
    en: `Welcome to Support Center! Here you get help with the system.
    
    Browse frequently asked questions.
    
    Watch video tutorials for each module.
    
    Submit a support ticket for issues.
    
    Chat with support team.
    
    View system status and announcements.`,
    ta: `Support Center-க்கு வரவேற்கிறோம்!`
  },
  '/production/tracking': {
    en: `Welcome to Production Tracking! Here you monitor real-time machine activity.
    
    See which machines are running, idle, or under maintenance.
    
    View current job on each machine with progress percentage.
    
    Log production output - pieces completed, rejected, reworked.
    
    Record machine downtime with reasons.
    
    Track operator performance and efficiency.
    
    View shift-wise production summary.`,
    ta: `Production Tracking-க்கு வரவேற்கிறோம்!`
  },
  '/production/process-master': {
    en: `Welcome to Process Master! Here you define your manufacturing processes.
    
    Add new processes like Cutting, Turning, Milling, Grinding, Heat Treatment.
    
    Set standard cycle time for each process.
    
    Define setup time and teardown time.
    
    Link processes to machines that can perform them.
    
    Set cost rates per hour for each process.
    
    Create process sequences (routings) for products.`,
    ta: `Process Master-க்கு வரவேற்கிறோம்!`
  },
  '/accounts/profit-loss': {
    en: `Welcome to Profit and Loss! This shows your income and expenses.
    
    Revenue section shows all sales income.
    
    Cost of Goods Sold shows direct production costs.
    
    Gross Profit is Revenue minus COGS.
    
    Operating Expenses show overhead costs.
    
    Net Profit is your bottom line after all expenses.
    
    Compare with previous periods.
    
    Export for financial reporting.`,
    ta: `Profit & Loss-க்கு வரவேற்கிறோம்!`
  },
  '/accounts/balance-sheet': {
    en: `Welcome to Balance Sheet! This shows your financial position.
    
    Assets section shows what you own - cash, inventory, equipment.
    
    Liabilities show what you owe - loans, payables.
    
    Equity shows owner's investment and retained earnings.
    
    Assets must equal Liabilities plus Equity.
    
    View current vs previous period comparison.
    
    Export for auditing and reporting.`,
    ta: `Balance Sheet-க்கு வரவேற்கிறோம்!`
  },
  '/accounts/opening-balances': {
    en: `Welcome to Opening Balances! Here you set starting balances for accounts.
    
    Enter balances as of your accounting start date.
    
    Set customer opening receivables.
    
    Set supplier opening payables.
    
    Enter bank account opening balances.
    
    Set inventory opening values.
    
    This ensures your reports are accurate from day one.`,
    ta: `Opening Balances-க்கு வரவேற்கிறோம்!`
  },
  '/finance/petty-cash': {
    en: `Welcome to Petty Cash! Here you manage small daily expenses.
    
    Record petty cash withdrawals and expenses.
    
    Categorize expenses - tea, travel, stationery, etc.
    
    Maintain petty cash float balance.
    
    Request petty cash replenishment.
    
    View expense reports by category and date.
    
    Approve or reject expense requests.`,
    ta: `Petty Cash-க்கு வரவேற்கிறோம்!`
  },
  '/admin/access': {
    en: `Welcome to Access Management! Here you control what users can access.
    
    Create permission profiles for different roles.
    
    Assign modules each role can access.
    
    Set read, write, delete permissions separately.
    
    Enable or disable specific features per role.
    
    Apply permissions to users or groups.
    
    Audit who has access to sensitive data.`,
    ta: `Access Management-க்கு வரவேற்கிறோம்!`
  },
  '/reports/production': {
    en: `Welcome to Production Reports! Here you analyze production data.
    
    View production output by machine, product, or period.
    
    See rejection and rework rates.
    
    Analyze machine utilization percentage.
    
    Compare planned vs actual production.
    
    Track OEE - Overall Equipment Effectiveness.
    
    Export reports to Excel or PDF.
    
    Schedule automated report emails.`,
    ta: `Production Reports-க்கு வரவேற்கிறோம்!`
  },
};

// Walkthrough coach: shows what to enter in each field, why, and where it is saved, with a spotlight on the field, a pointer,
// spoken narration (the Help voice) and, after the real Save, a glowing dot that flies to the menu / tab holding the record.
// Start it from the Help area ("Guide me"), by saying "guide me", or let Auto-guide start it when a guided form opens.

const ls = {
  get: (k: string, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const readLang = (): GuideLang => { const v = ls.get('help.vlang', 'ta'); return v === 'en' || v === 'tanglish' ? v : 'ta'; };

type Rect = { x: number; y: number; w: number; h: number };
const rectOf = (el: Element | null): Rect | null => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
const same = (a: Rect | null, b: Rect | null) => (!a && !b) || (!!a && !!b && Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a.w - b.w) < 0.6 && Math.abs(a.h - b.h) < 0.6);

const CSS = `
@keyframes guidePulse{0%{box-shadow:0 0 0 0 rgba(249,115,22,.75)}70%{box-shadow:0 0 0 14px rgba(249,115,22,0)}100%{box-shadow:0 0 0 0 rgba(249,115,22,0)}}
@keyframes guideBob{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}
@keyframes guideBobUp{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes guideIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
@keyframes guideRing{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.4);opacity:0}}
@keyframes guidePop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
`;

export function GuideCoach() {
  const location = useLocation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState('');
  const [active, setActive] = useState<{ guide: Guide; i: number } | null>(null);
  const [picker, setPicker] = useState<Guide[] | null>(null);
  const [offer, setOffer] = useState<Guide | null>(null);
  const [lang, setLang] = useState<GuideLang>(readLang);
  const [voice, setVoice] = useState(() => ls.get('argus.guide.voice', '1') === '1');
  const [auto, setAuto] = useState(() => ls.get('argus.guide.auto', '0') === '1');
  const [rect, setRect] = useState<Rect | null>(null);
  const [toast, setToast] = useState('');
  const [teaching, setTeaching] = useState(false);   // Teaching mode: the walkthrough plays itself, narrated
  const [fullErpTeaching, setFullErpTeaching] = useState(false);  // Full ERP teaching: navigate through ALL pages
  const [erpPageIndex, setErpPageIndex] = useState(0);  // Current page index in full ERP teaching
  const teachRef = useRef(false);
  const fullErpRef = useRef(false);
  const queueRef = useRef<Guide[]>([]);
  const fallbackRef = useRef(false);
  const stepToken = useRef(0);
  const nextRef = useRef<() => void>(() => {});
  const nextPageRef = useRef<() => void>(() => {});
  const [flight, setFlight] = useState<{ key: number; from: { x: number; y: number }; to: Rect | null; caption: string; arrived: boolean } | null>(null);
  const targetEl = useRef<HTMLElement | null>(null);
  const autoShown = useRef('');
  const flightDot = useRef<HTMLDivElement>(null);

  const path = location.pathname;
  const offers = useMemo(() => guidesFor(GUIDES, path, dialog), [path, dialog]);
  const step: GuideStep | null = active ? active.guide.steps[active.i] ?? null : null;

  // Which pop-up is open: watch the page, cheaply.
  useEffect(() => {
    let t = 0;
    const read = () => setDialog(dialogTitle(topDialog()));
    const mo = new MutationObserver(() => { window.clearTimeout(t); t = window.setTimeout(read, 220); });
    mo.observe(document.body, { childList: true, subtree: true });
    read();
    return () => { mo.disconnect(); window.clearTimeout(t); };
  }, [path]);

  const close = useCallback(() => { teachRef.current = false; fullErpRef.current = false; fallbackRef.current = false; queueRef.current = []; stepToken.current += 1; setTeaching(false); setFullErpTeaching(false); setErpPageIndex(0); stopSpeaking(); setActive(null); setPicker(null); setFlight(null); setRect(null); targetEl.current = null; }, []);
  const start = useCallback((g: Guide) => {
    window.dispatchEvent(new Event('argus:voice-pause'));
    setOffer(null); setPicker(null); setFlight(null); setActive({ guide: g, i: 0 });
  }, []);

  // "Guide me" from the Help area / voice
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      const g = id ? GUIDES.find(x => x.id === id) : undefined;
      if (g) { start(g); return; }
      if (offers.length === 1) start(offers[0]);
      else if (offers.length > 1) setPicker(offers);
      else { setToast(lang === 'ta' ? 'இந்தத் திரைக்கு இன்னும் வழிகாட்டி இல்லை. கேள்வி கேளுங்கள்.' : 'There is no walkthrough for this screen yet. Ask Help a question instead.'); window.setTimeout(() => setToast(''), 4000); }
    };
    window.addEventListener('argus:guide', on);
    return () => window.removeEventListener('argus:guide', on);
  }, [offers, start, lang]);

  // A guided form opened: offer a walkthrough once, or start it straight away when Auto-guide is on.
  useEffect(() => {
    if (active) return;
    const g = offers[0];
    if (!g) { autoShown.current = ''; setOffer(null); return; }
    if (autoShown.current === g.id) return;
    autoShown.current = g.id;
    if (auto) { start(g); return; }
    let seen: string[] = []; try { seen = JSON.parse(ls.get('argus.guide.seen', '[]')); } catch { /* none */ }
    if (seen.includes(g.id)) return;
    ls.set('argus.guide.seen', JSON.stringify([...seen, g.id]));
    setOffer(g);
    const t = window.setTimeout(() => setOffer(o => (o?.id === g.id ? null : o)), 10000);
    return () => window.clearTimeout(t);
  }, [offers, active, auto, start]);

  // Entering a step: open what it needs, find the field, scroll to it, read it out.
  useEffect(() => {
    if (!active || !step) return;
    let off = false;
    stopSpeaking();
    const go = async () => {
      if (step.open) {
        const b = findTarget({ button: step.open });
        if (b && !findTarget(step.target)) { b.click(); await new Promise(r => window.setTimeout(r, 450)); }
      }
      if (off) return;
      const el = findTarget(step.target);
      targetEl.current = el;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const token = ++stepToken.current;
      // Teaching mode moves on by itself once the narration has finished (or after a pause when it is muted).
      const advance = () => {
        if (!teachRef.current || stepToken.current !== token) return;
        window.setTimeout(() => { if (teachRef.current && stepToken.current === token) nextRef.current(); }, 1500);
      };
      if (voice) say(stepSpeech(step, lang), advance, undefined);
      else if (teachRef.current) window.setTimeout(advance, 5000);
    };
    void go();
    return () => { off = true; stepToken.current += 1; stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.guide.id, active?.i, lang, voice]);

  // Keep the spotlight on the field while the page moves (scroll, a pop-up being dragged, a field appearing).
  useEffect(() => {
    if (!active || !step) return;
    let raf = 0; let n = 0;
    const tick = () => {
      if (n++ % 15 === 0 || !targetEl.current || !targetEl.current.isConnected) targetEl.current = findTarget(step.target);
      const r = rectOf(targetEl.current);
      setRect(prev => (same(prev, r) ? prev : r));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active?.guide.id, active?.i]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    setFlight(null);
    setActive(a => (a && a.i < a.guide.steps.length - 1 ? { ...a, i: a.i + 1 } : null));
  }, []);
  nextRef.current = next;
  const back = () => { setFlight(null); setActive(a => (a && a.i > 0 ? { ...a, i: a.i - 1 } : a)); };

  // Teaching mode (Ctrl+Shift): teach the ENTIRE ERP, navigating page by page with voice and animations.
  const teachCurrentPage = useCallback(() => {
    if (!teachRef.current) return;
    
    // ALWAYS use comprehensive page teaching first - teach ALL functions
    const pageTeaching = PAGE_TEACHINGS[path];
    if (pageTeaching) {
      fallbackRef.current = true;
      const token = ++stepToken.current;
      const pageTitle = pageTitles[path.replace(/^\//, '')] || path;
      const text = lang === 'ta' ? pageTeaching.ta : pageTeaching.en;
      
      // Show teaching text in toast
      setToast(text.length > 300 ? `${text.slice(0, 300)}…` : text);
      
      // Speak the teaching with voice
      say(text, () => {
        if (stepToken.current === token) {
          fallbackRef.current = false;
          setToast('');
          // After teaching the page, run any walkthroughs if available
          const currentOffers = guidesFor(GUIDES, path, dialog);
          if (currentOffers.length && fullErpRef.current) {
            queueRef.current = currentOffers.slice(1);
            start(currentOffers[0]);
          } else if (fullErpRef.current) {
            // Move to next page
            window.setTimeout(() => nextPageRef.current(), 2000);
          } else {
            teachRef.current = false;
            setTeaching(false);
          }
        }
      }, undefined);
      return;
    }
    
    // Fallback: use walkthroughs if available
    const currentOffers = guidesFor(GUIDES, path, dialog);
    if (currentOffers.length) {
      fallbackRef.current = false;
      queueRef.current = currentOffers.slice(1);
      start(currentOffers[0]);
      return;
    }
    
    // Last fallback: read from notes
    fallbackRef.current = true;
    const token = ++stepToken.current;
    const pageTitle = pageTitles[path.replace(/^\//, '')] || path;
    const intro = lang === 'ta' 
      ? `இது ${pageTitle} பக்கம். இந்தப் பக்கத்தைப் பற்றிய தகவல் இன்னும் சேர்க்கப்படவில்லை.` 
      : lang === 'tanglish' 
        ? `Ithu ${pageTitle} page. Intha page pathi info innum serkapadala.` 
        : `This is the ${pageTitle} page. Teaching content for this page is being prepared.`;
    const text = intro;
    setToast(text);
    say(text, () => {
      if (stepToken.current === token) {
        fallbackRef.current = false;
        setToast('');
        if (fullErpRef.current) {
          window.setTimeout(() => nextPageRef.current(), 2000);
        } else {
          teachRef.current = false;
          setTeaching(false);
        }
      }
    }, undefined);
  }, [path, dialog, lang, start]);

  // Navigate to next page in full ERP teaching
  const nextPage = useCallback(() => {
    if (!fullErpRef.current) return;
    const nextIndex = erpPageIndex + 1;
    if (nextIndex >= ALL_ERP_PAGES.length) {
      // Finished teaching all pages
      const done = lang === 'ta' ? 'ERP கற்பித்தல் முடிந்தது! நன்றி!' : lang === 'tanglish' ? 'ERP teaching mudinjiruchu! Nandri!' : 'ERP teaching completed! Thank you!';
      say(done, () => close(), undefined);
      return;
    }
    setErpPageIndex(nextIndex);
    const nextPagePath = ALL_ERP_PAGES[nextIndex].page;
    const nextPageLabel = ALL_ERP_PAGES[nextIndex].label;
    const transition = lang === 'ta' 
      ? `அடுத்து, ${nextPageLabel} பக்கத்திற்குச் செல்வோம்.`
      : lang === 'tanglish'
        ? `Aduthu, ${nextPageLabel} page-ku povom.`
        : `Next, let's go to ${nextPageLabel}.`;
    setToast(transition);
    say(transition, () => {
      navigate(`/${nextPagePath}`);
      setToast('');
    }, undefined);
  }, [erpPageIndex, lang, navigate, close]);
  nextPageRef.current = nextPage;

  useEffect(() => {
    const on = (e: Event) => {
      const want = (e as CustomEvent<{ on?: boolean; fullErp?: boolean }>).detail?.on;
      const wantFullErp = (e as CustomEvent<{ on?: boolean; fullErp?: boolean }>).detail?.fullErp ?? true; // Default to full ERP
      const turnOn = typeof want === 'boolean' ? want : !teachRef.current;
      if (!turnOn) { close(); return; }
      window.dispatchEvent(new Event('argus:voice-pause'));
      teachRef.current = true;
      setTeaching(true);
      
      if (wantFullErp) {
        // Full ERP teaching: start from the first page
        fullErpRef.current = true;
        setFullErpTeaching(true);
        setErpPageIndex(0);
        const firstPage = ALL_ERP_PAGES[0];
        const welcome = lang === 'ta'
          ? `வணக்கம்! ARGUS ERP முழுவதையும் கற்றுக்கொள்வோம். முதலில் ${firstPage.label} பக்கத்தில் தொடங்குவோம்.`
          : lang === 'tanglish'
            ? `Vanakkam! ARGUS ERP-ah muzhuva katrukkolam. Mudhalil ${firstPage.label} page-la thodanguvom.`
            : `Welcome! Let's learn the entire ARGUS ERP. We'll start with ${firstPage.label}.`;
        setToast(welcome);
        say(welcome, () => {
          navigate(`/${firstPage.page}`);
          setToast('');
        }, undefined);
      } else {
        // Teach only current page
        teachCurrentPage();
      }
    };
    window.addEventListener('argus:teach', on);
    return () => window.removeEventListener('argus:teach', on);
  }, [close, lang, navigate, teachCurrentPage]);

  // When path changes during full ERP teaching, teach the new page
  useEffect(() => {
    if (!fullErpRef.current || !teaching) return;
    // Small delay to let the page render
    const t = window.setTimeout(() => teachCurrentPage(), 1500);
    return () => window.clearTimeout(t);
  }, [path, teaching, teachCurrentPage]);

  useEffect(() => { window.dispatchEvent(new CustomEvent('argus:mode', { detail: { mode: 'teaching', on: teaching } })); }, [teaching]);

  // A walkthrough ended while teaching: carry on with the next one for this screen, or move to next page.
  useEffect(() => {
    if (!teaching || active || fallbackRef.current) return;
    const q = queueRef.current.shift();
    if (q) {
      start(q);
    } else if (fullErpRef.current) {
      // Move to next page after a pause
      window.setTimeout(() => nextPageRef.current(), 2000);
    } else {
      teachRef.current = false;
      setTeaching(false);
    }
  }, [teaching, active, start]);

  // The step waits for the real Save: then the dot flies to where the record now lives.
  useEffect(() => {
    if (!active || !step?.onSave) return;
    const want = step.onSave.button.trim().toLowerCase();
    const hadDialog = !!topDialog();
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (!b || !(b.textContent ?? '').trim().toLowerCase().includes(want)) return;
      const from = rectOf(b); if (!from) return;
      window.setTimeout(() => {
        const stillOpen = hadDialog && !!topDialog() && dialogTitle(topDialog()) === dialog;
        if (stillOpen) return;   // the form refused (a field is missing): stay on this step
        if (step.onSave!.okText && !document.body.innerText.toLowerCase().includes(step.onSave!.okText.toLowerCase())) return;   // a form on the page: wait for its "saved" message
        const dest = findTarget({ button: step.onSave!.flyTo }) ?? findTarget({ text: step.onSave!.flyTo });
        const caption = pick(step.onSave!.caption, lang);
        setFlight({ key: Date.now(), from: { x: from.x + from.w / 2, y: from.y + from.h / 2 }, to: rectOf(dest), caption, arrived: false });
        if (voice) say(caption, () => {}, undefined);
      }, 1000);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [active, step, lang, voice, dialog]);

  // Run the flight, then carry on to the next step.
  useEffect(() => {
    if (!flight) return;
    const dot = flightDot.current;
    const to = flight.to ? { x: flight.to.x + flight.to.w / 2, y: flight.to.y + flight.to.h / 2 } : { x: flight.from.x, y: flight.from.y - 160 };
    const mid = { x: (flight.from.x + to.x) / 2, y: Math.min(flight.from.y, to.y) - 140 };
    const frames = [
      { transform: `translate(${flight.from.x}px,${flight.from.y}px) scale(1)`, opacity: 1 },
      { transform: `translate(${mid.x}px,${mid.y}px) scale(1.5)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${to.x}px,${to.y}px) scale(.7)`, opacity: 1 },
    ];
    const anims: Animation[] = [];
    const ghosts = document.querySelectorAll<HTMLElement>('[data-guide-ghost]');
    ghosts.forEach((g, i) => anims.push(g.animate(frames.map(f => ({ ...f, opacity: 0.55 - i * 0.08 })), { duration: 1100, delay: (i + 1) * 55, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' })));
    const main = dot?.animate(frames, { duration: 1100, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    const t1 = window.setTimeout(() => setFlight(f => (f && f.key === flight.key ? { ...f, arrived: true } : f)), 1100);
    const t2 = window.setTimeout(() => next(), 4200);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); main?.cancel(); anims.forEach(a => a.cancel()); };
  }, [flight?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape ends the walkthrough (and is not also treated as "go back a page").
  useEffect(() => {
    if (!active && !picker) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [active, picker, close]);

  useEffect(() => () => stopSpeaking(), []);
  const toggleLang = () => { const n: GuideLang = lang === 'ta' ? 'en' : 'ta'; setLang(n); ls.set('help.vlang', n); };
  const toggleVoice = () => { const n = !voice; setVoice(n); ls.set('argus.guide.voice', n ? '1' : '0'); if (!n) stopSpeaking(); };
  const toggleAuto = () => { const n = !auto; setAuto(n); ls.set('argus.guide.auto', n ? '1' : '0'); };

  const ta = lang === 'ta';
  const L = (en: string, tm: string) => (ta ? tm : en);
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardTop = rect ? rect.y + rect.h / 2 > vh * 0.5 : false;   // target in the lower half: card goes to the top
  const arrowAbove = !!rect && rect.y > 150;

  const ui = (
    <>
      <style>{CSS}</style>

      {toast && <div role="status" className="fixed bottom-24 right-5 z-[95] max-w-xs rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-xl" style={{ animation: 'guideIn .25s ease-out' }}>{toast}</div>}
      
      {/* Full ERP Teaching progress indicator */}
      {fullErpTeaching && !active && (
        <div className="fixed top-20 right-5 z-[95] w-80 rounded-2xl border border-orange-200 bg-white p-4 shadow-2xl" style={{ animation: 'guideIn .3s ease-out' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600 animate-pulse"><PlayCircle size={22} /></span>
            <div>
              <p className="text-sm font-bold text-slate-800">{L('Teaching Entire ERP', 'முழு ERP கற்பித்தல்')}</p>
              <p className="text-xs text-slate-500">{L(`Page ${erpPageIndex + 1} of ${ALL_ERP_PAGES.length}`, `பக்கம் ${erpPageIndex + 1} / ${ALL_ERP_PAGES.length}`)}</p>
            </div>
          </div>
          <div className="mb-3">
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-orange-500 transition-all duration-500" style={{ width: `${((erpPageIndex + 1) / ALL_ERP_PAGES.length) * 100}%` }} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{ALL_ERP_PAGES[erpPageIndex]?.label}</span>
            <div className="flex gap-2">
              <button onClick={nextPage} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><SkipForward size={12} />{L('Skip', 'தவிர்')}</button>
              <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">{L('Stop', 'நிறுத்து')}</button>
            </div>
          </div>
        </div>
      )}

      {offer && !active && (
        <div className="fixed bottom-24 right-5 z-[95] w-72 rounded-2xl border border-orange-200 bg-white p-3.5 shadow-2xl" style={{ animation: 'guideIn .3s ease-out' }}>
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Compass size={17} /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800">{pick(offer.title, lang)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{L('Want me to walk you through it? I will tell you what to enter, why, and where it is saved.', 'நான் வழிகாட்டவா? என்ன எழுதுவது, ஏன், எங்கே சேமிக்கப்படும் என்று சொல்கிறேன்.')}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100" onClick={() => setOffer(null)}>{L('Not now', 'பிறகு')}</button>
            <button className="rounded-lg bg-orange-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-700" onClick={() => start(offer)}>{L('Guide me', 'வழிகாட்டு')}</button>
          </div>
        </div>
      )}

      {picker && !active && (
        <div className="fixed inset-0 z-[94] flex items-end justify-end p-5 pb-24">
          <div className="w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl" style={{ animation: 'guideIn .25s ease-out' }}>
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold text-slate-800">{L('Which walkthrough?', 'எந்த வழிகாட்டி?')}</p><button aria-label="Close" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={15} /></button></div>
            {picker.map(g => (
              <button key={g.id} onClick={() => start(g)} className="mb-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-orange-300 hover:bg-orange-50">
                <p className="text-sm font-semibold text-slate-800">{pick(g.title, lang)}</p>
                {g.blurb && <p className="text-xs text-slate-500">{pick(g.blurb, lang)}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {active && step && (
        <>
          {/* The dim (a huge static shadow) and the pulsing ring are separate layers: the ring's animation would otherwise replace the dim. */}
          {rect && !flight && (
            <div aria-hidden className="pointer-events-none fixed z-[90]" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12, borderRadius: 12, boxShadow: '0 0 0 9999px rgba(15,23,42,.5)', transition: 'all .25s ease' }}>
              <div className="absolute inset-0" style={{ borderRadius: 12, outline: '3px solid #f97316', animation: 'guidePulse 1.6s infinite' }} />
            </div>
          )}
          {rect && !flight && (
            <div aria-hidden className="pointer-events-none fixed z-[91]" style={{ left: rect.x + rect.w / 2 - 14, top: arrowAbove ? rect.y - 46 : rect.y + rect.h + 10, animation: `${arrowAbove ? 'guideBob' : 'guideBobUp'} .9s ease-in-out infinite` }}>
              <svg width="28" height="34" viewBox="0 0 28 34" fill="#f97316" style={{ transform: arrowAbove ? 'none' : 'rotate(180deg)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' }}><path d="M14 34 2 16h8V0h8v16h8z" /></svg>
            </div>
          )}

          {flight && (
            <>
              {[0, 1, 2, 3, 4].map(i => <div key={i} data-guide-ghost aria-hidden className="pointer-events-none fixed left-0 top-0 z-[92] -ml-2 -mt-2 h-4 w-4 rounded-full bg-orange-400" style={{ opacity: 0 }} />)}
              <div ref={flightDot} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[93] -ml-3 -mt-3 h-6 w-6 rounded-full bg-gradient-to-br from-amber-300 to-orange-600" style={{ boxShadow: '0 0 18px 6px rgba(249,115,22,.7)' }} />
              {flight.arrived && flight.to && (
                <>
                  <div aria-hidden className="pointer-events-none fixed z-[92] rounded-full border-4 border-orange-500" style={{ left: flight.to.x + flight.to.w / 2 - 22, top: flight.to.y + flight.to.h / 2 - 22, width: 44, height: 44, animation: 'guideRing 1.1s ease-out infinite' }} />
                  <div className="pointer-events-none fixed z-[93] flex max-w-[16rem] items-start gap-2 rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white shadow-2xl"
                    style={{ left: Math.min(Math.max(8, flight.to.x + flight.to.w / 2 - 128), window.innerWidth - 264), top: flight.to.y + flight.to.h + 18, animation: 'guidePop .35s ease-out' }}>
                    <Database size={14} className="mt-0.5 shrink-0" />{flight.caption}
                  </div>
                </>
              )}
            </>
          )}

          <div role="region" aria-label="Walkthrough" className={`fixed right-5 z-[95] w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl ${cardTop ? 'top-20' : 'bottom-24'}`} style={{ animation: 'guideIn .3s ease-out' }}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Compass size={15} /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">{pick(active.guide.title, lang)}</p>
                <p className="text-[10px] text-slate-400">{fullErpTeaching ? L(`ERP Teaching (${erpPageIndex + 1}/${ALL_ERP_PAGES.length}) · `, `ERP கற்பித்தல் (${erpPageIndex + 1}/${ALL_ERP_PAGES.length}) · `) : teaching ? L('Teaching mode · Ctrl+Shift to stop · ', 'கற்பித்தல் · நிறுத்த Ctrl+Shift · ') : ''}{L('Step', 'படி')} {active.i + 1} / {active.guide.steps.length}</p></div>
              <button type="button" aria-label={voice ? 'Mute narration' : 'Read aloud'} title={voice ? 'Mute' : 'Read aloud'} onClick={toggleVoice} className="rounded p-1.5 text-slate-400 hover:bg-slate-100">{voice ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
              <button type="button" aria-label="Language" title="தமிழ் / English" onClick={toggleLang} className="flex items-center gap-1 rounded p-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-100"><Languages size={14} />{ta ? 'EN' : 'தமிழ்'}</button>
              <button type="button" aria-label="Close walkthrough" onClick={close} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><X size={15} /></button>
            </div>
            <div className="max-h-[46vh] space-y-2.5 overflow-y-auto px-3.5 py-3">
              <p className="text-[15px] font-bold leading-snug text-slate-900">{pick(step.title, lang)}</p>
              <p className="text-[13px] leading-relaxed text-slate-700">{pick(step.say, lang)}</p>
              {step.why && <div className="rounded-lg bg-sky-50 px-2.5 py-2 text-xs text-sky-900"><span className="mr-1 inline-flex items-center gap-1 font-bold"><HelpCircle size={12} />{L('Why', 'ஏன்')}:</span>{pick(step.why, lang)}</div>}
              {step.saves && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900"><span className="mr-1 inline-flex items-center gap-1 font-bold"><Database size={12} />{L('Saved in', 'சேமிக்கப்படும் இடம்')}:</span>{pick(step.saves, lang)}</div>}
              {step.onSave && !flight && <p className="text-xs font-semibold text-orange-600">{L(`Now click “${step.onSave.button}”. I will show you where it goes.`, `இப்போது “${step.onSave.button}” அழுத்துங்கள். எங்கே போகிறது என்று காட்டுகிறேன்.`)}</p>}
              {step.target && !rect && !flight && <p className="text-[11px] text-slate-400">{L('That field is not on screen yet. Open the form first, then press Next.', 'அந்தப் புலம் இன்னும் திரையில் இல்லை. முதலில் படிவத்தைத் திறந்து, பிறகு Next அழுத்துங்கள்.')}</p>}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-500"><input type="checkbox" checked={auto} onChange={toggleAuto} />{L('Auto-guide', 'தானாக வழிகாட்டு')}</label>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={back} disabled={active.i === 0} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowLeft size={13} />{L('Back', 'பின்')}</button>
                <button type="button" onClick={active.i === active.guide.steps.length - 1 ? close : next} className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-600 px-3.5 text-xs font-bold text-white hover:bg-orange-700">{active.i === active.guide.steps.length - 1 ? L('Done', 'முடிந்தது') : L('Next', 'அடுத்து')}{active.i < active.guide.steps.length - 1 && <ArrowRight size={13} />}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
  return typeof document === 'undefined' ? null : createPortal(ui, document.body);
}
