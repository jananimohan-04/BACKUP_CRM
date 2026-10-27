// Pipeline Report: comprehensive sales funnel & stage conversion report across
// Enquiries, Quotations, Sales Orders, Deliveries (DC), and Invoices.
// Supports quick preset date filters (Today, Yesterday, This Week, Last Week,
// This Month, Last Month, This Year, All Time, Custom), company filtering,
// search, visual conversion funnel, breakdown by company & product, and full transaction logs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  Building2,
  Package,
  FileText,
  Truck,
  Receipt,
  Search,
  Upload,
  Printer,
  RefreshCcw,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Filter,
  DollarSign,
  Layers,
} from 'lucide-react';
import { Button, Badge } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { formatINR, todayISO } from '@/lib/format';
import { exportCsv, printHtml } from '@/lib/reportExport';
import { getProductBaseName } from '@/pages/sales/SalesPipelinePage';

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'all'
  | 'custom';

export type ReportTab = 'tracking' | 'overview' | 'companies' | 'products' | 'transactions';

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getSoAmount = (o: any): number => num((o as any)?.total_amount || (o as any)?.total_value || (o as any)?.value || (num(o?.quantity) * num((o as any)?.unit_price)));

const getSoRate = (o: any): number => {
  if (num((o as any)?.unit_price) > 0) return num((o as any)?.unit_price);
  const amt = getSoAmount(o);
  const q = num(o?.quantity);
  if (q > 0 && amt > 0) return Math.round((amt / q) * 100) / 100;
  if (Array.isArray(o?.items) && o.items.length > 0) {
    const first = o.items[0];
    return num(first?.unitPrice || first?.unit_price || first?.price || first?.rate);
  }
  return 0;
};

const getQuoAmount = (q: any): number => num(q?.total_value || (num(q?.quantity) * num(q?.unit_price)));
const getQuoRate = (q: any): number => num(q?.unit_price || (num(q?.quantity) > 0 ? getQuoAmount(q) / num(q?.quantity) : 0));

const getDcAmount = (d: any): number => num(d?.total_amount || (num(d?.dispatch_qty ?? d?.quantity) * num(d?.unit_price)));
const getDcRate = (d: any): number => num(d?.unit_price || (num(d?.dispatch_qty ?? d?.quantity) > 0 ? getDcAmount(d) / num(d?.dispatch_qty ?? d?.quantity) : 0));

const toISODate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function getDatePresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const todayStr = toISODate(now);

  if (preset === 'today') {
    return { from: todayStr, to: todayStr };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yStr = toISODate(y);
    return { from: yStr, to: yStr };
  }
  if (preset === 'this_week') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return { from: toISODate(monday), to: todayStr };
  }
  if (preset === 'last_week') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
    const lastMonday = new Date(d.setDate(diff));
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastSunday.getDate() + 6);
    return { from: toISODate(lastMonday), to: toISODate(lastSunday) };
  }
  if (preset === 'this_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toISODate(firstDay), to: todayStr };
  }
  if (preset === 'last_month') {
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toISODate(firstDayLastMonth), to: toISODate(lastDayLastMonth) };
  }
  if (preset === 'this_year') {
    const firstDayYear = new Date(now.getFullYear(), 0, 1);
    return { from: toISODate(firstDayYear), to: todayStr };
  }
  return { from: '', to: '' };
}

interface PipelineReportProps {
  embedded?: boolean;
  onBack?: () => void;
  onSwitchTab?: (tab: string) => void;
}

export function PipelineReportPage({ embedded = false, onBack, onSwitchTab }: PipelineReportProps) {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [customFrom, setCustomFrom] = useState(() => getDatePresetRange('this_month').from);
  const [customTo, setCustomTo] = useState(() => getDatePresetRange('this_month').to);
  const [selectedCompany, setSelectedCompany] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ReportTab>('tracking');
  const [txStageFilter, setTxStageFilter] = useState<string>('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Raw database tables
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  const activeRange = useMemo(() => {
    if (preset === 'custom') {
      return { from: customFrom, to: customTo };
    }
    return getDatePresetRange(preset);
  }, [preset, customFrom, customTo]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [enqRes, quoRes, soRes, dcRes, invRes, custRes] = await Promise.all([
        supabase
          .from('cnc_enquiries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase
          .from('cnc_quotations')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase
          .from('cnc_sales_orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase
          .from('cnc_deliveries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(4000),
        supabase
          .from('cnc_invoices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(4000),
        supabase
          .from('cnc_customers')
          .select('id,name')
          .order('name')
          .limit(2000),
      ]);

      if (enqRes.error) throw enqRes.error;
      if (quoRes.error) throw quoRes.error;
      if (soRes.error) throw soRes.error;
      if (dcRes.error) throw dcRes.error;
      if (invRes.error) throw invRes.error;

      setEnquiries(enqRes.data || []);
      setQuotations(quoRes.data || []);
      setSalesOrders(soRes.data || []);
      setDeliveries(dcRes.data || []);
      setInvoices(invRes.data || []);
      setCustomers(custRes.data || []);
    } catch (err: any) {
      console.error('Failed to load pipeline report data:', err);
      setError(err?.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Date & Company filter helper
  const isInRange = useCallback(
    (dateVal: any) => {
      if (!activeRange.from && !activeRange.to) return true;
      const dStr = String(dateVal || '').slice(0, 10);
      if (!dStr) return true;
      if (activeRange.from && dStr < activeRange.from) return false;
      if (activeRange.to && dStr > activeRange.to) return false;
      return true;
    },
    [activeRange]
  );

  const matchesCo = useCallback(
    (coVal: any) => {
      if (!selectedCompany) return true;
      return String(coVal || '').trim().toLowerCase() === selectedCompany.trim().toLowerCase();
    },
    [selectedCompany]
  );

  // Filtered lists
  const filteredEnquiries = useMemo(() => {
    return enquiries.filter((e) => {
      const d = e.received_date || e.created_at;
      if (!isInRange(d)) return false;
      if (!matchesCo(e.customer)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [e.enquiry_no, e.lead_no, e.customer, e.part_name, e.status].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [enquiries, isInRange, matchesCo, search]);

  const filteredQuotations = useMemo(() => {
    return quotations.filter((q) => {
      const d = q.created_at;
      if (!isInRange(d)) return false;
      if (!matchesCo(q.customer)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [q.quote_no, q.enquiry_no, q.customer, q.part_name, q.status].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [quotations, isInRange, matchesCo, search]);

  const filteredSalesOrders = useMemo(() => {
    return salesOrders.filter((o) => {
      const d = o.order_date || o.created_at;
      if (!isInRange(d)) return false;
      if (!matchesCo(o.customer)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [o.order_no, o.lead_no, o.customer, o.part_name, o.part_no, o.status].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [salesOrders, isInRange, matchesCo, search]);

  const filteredDeliveries = useMemo(() => {
    return deliveries.filter((dc) => {
      const d = dc.delivery_date || dc.created_at;
      if (!isInRange(d)) return false;
      if (!matchesCo(dc.customer_name)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [dc.delivery_no, dc.customer_name, dc.part_name, dc.sales_order_no, dc.status].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [deliveries, isInRange, matchesCo, search]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.cancelled) return false;
      const d = inv.invoice_date || inv.created_at;
      if (!isInRange(d)) return false;
      if (!matchesCo(inv.customer_name)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [inv.invoice_no, inv.customer_name, inv.part_name, inv.dc_no, inv.status].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [invoices, isInRange, matchesCo, search]);

  // Aggregated totals
  const stats = useMemo(() => {
    // 1. Enquiries
    const enqCount = filteredEnquiries.length;
    const enqQty = filteredEnquiries.reduce((s, e) => s + num(e.quantity), 0);
    const enqVal = filteredEnquiries.reduce((s, e) => s + num(e.estimated_value), 0);

    // 2. Quotations
    const quoCount = filteredQuotations.length;
    const quoQty = filteredQuotations.reduce((s, q) => s + num(q.quantity), 0);
    const quoVal = filteredQuotations.reduce((s, q) => s + getQuoAmount(q), 0);

    // 3. Sales Orders
    const soCount = filteredSalesOrders.length;
    const soQty = filteredSalesOrders.reduce((s, o) => s + num(o.quantity), 0);
    const soVal = filteredSalesOrders.reduce(
      (s, o) => s + getSoAmount(o),
      0
    );

    // 4. Deliveries
    const dcNos = new Set(filteredDeliveries.map((d) => d.delivery_no).filter(Boolean));
    const dcCount = dcNos.size || filteredDeliveries.length;
    const dcQty = filteredDeliveries.reduce((s, d) => s + num(d.dispatch_qty ?? d.quantity), 0);
    const dcVal = filteredDeliveries.reduce((s, d) => s + getDcAmount(d), 0);

    // 5. Invoices
    const invNos = new Set(filteredInvoices.map((i) => i.invoice_no).filter(Boolean));
    const invCount = invNos.size || filteredInvoices.length;
    const invQty = filteredInvoices.reduce((s, i) => s + num(i.quantity), 0);
    const invBasic = filteredInvoices.reduce((s, i) => s + num(i.basic_amount || i.total_amount), 0);
    const invTax = filteredInvoices.reduce((s, i) => s + num(i.tax_amount), 0);
    const invTotal = filteredInvoices.reduce((s, i) => s + num(i.total_amount), 0);
    const invPaid = filteredInvoices
      .filter((i) => String(i.payment_status || i.status).toLowerCase() === 'paid')
      .reduce((s, i) => s + num(i.total_amount), 0);
    const invDue = Math.max(0, invTotal - invPaid);

    // Conversion rates
    const enqToQuoteRate = enqCount > 0 ? Math.min(100, Math.round((quoCount / enqCount) * 100)) : 0;
    const quoteToSoRate = quoCount > 0 ? Math.min(100, Math.round((soCount / quoCount) * 100)) : 0;
    const soToDcRate = soCount > 0 ? Math.min(100, Math.round((dcCount / soCount) * 100)) : 0;
    const dcToInvRate = dcCount > 0 ? Math.min(100, Math.round((invCount / dcCount) * 100)) : 0;
    const overallConversion = enqCount > 0 ? Math.min(100, Math.round((invCount / enqCount) * 100)) : 0;

    return {
      enqCount,
      enqQty,
      enqVal,
      quoCount,
      quoQty,
      quoVal,
      soCount,
      soQty,
      soVal,
      dcCount,
      dcQty,
      dcVal,
      invCount,
      invQty,
      invBasic,
      invTax,
      invTotal,
      invPaid,
      invDue,
      enqToQuoteRate,
      quoteToSoRate,
      soToDcRate,
      dcToInvRate,
      overallConversion,
    };
  }, [filteredEnquiries, filteredQuotations, filteredSalesOrders, filteredDeliveries, filteredInvoices]);

  // Company breakdown
  const companyBreakdown = useMemo(() => {
    const map = new Map<string, any>();

    const get = (name: string) => {
      const clean = String(name || 'Unknown Company').trim();
      if (!map.has(clean)) {
        map.set(clean, {
          company: clean,
          enqCount: 0,
          enqVal: 0,
          quoCount: 0,
          quoVal: 0,
          soCount: 0,
          soVal: 0,
          dcCount: 0,
          dcQty: 0,
          dcVal: 0,
          invCount: 0,
          invTotal: 0,
          invPaid: 0,
          invDue: 0,
        });
      }
      return map.get(clean)!;
    };

    filteredEnquiries.forEach((e) => {
      const c = get(e.customer);
      c.enqCount += 1;
      c.enqVal += num(e.estimated_value);
    });

    filteredQuotations.forEach((q) => {
      const c = get(q.customer);
      c.quoCount += 1;
      c.quoVal += getQuoAmount(q);
    });

    filteredSalesOrders.forEach((o) => {
      const c = get(o.customer);
      c.soCount += 1;
      c.soVal += getSoAmount(o);
    });

    filteredDeliveries.forEach((d) => {
      const c = get(d.customer_name);
      c.dcCount += 1;
      c.dcQty += num(d.dispatch_qty ?? d.quantity);
      c.dcVal += getDcAmount(d);
    });

    filteredInvoices.forEach((i) => {
      const c = get(i.customer_name);
      c.invCount += 1;
      const tot = num(i.total_amount);
      c.invTotal += tot;
      if (String(i.payment_status || i.status).toLowerCase() === 'paid') {
        c.invPaid += tot;
      } else {
        c.invDue += tot;
      }
    });

    return Array.from(map.values()).sort((a, b) => (b.soVal + b.invTotal) - (a.soVal + a.invTotal));
  }, [filteredEnquiries, filteredQuotations, filteredSalesOrders, filteredDeliveries, filteredInvoices]);

  // Product breakdown
  const productBreakdown = useMemo(() => {
    const map = new Map<string, any>();

    const get = (name: string) => {
      const base = getProductBaseName(name) || String(name || 'Unnamed Product').trim();
      if (!map.has(base)) {
        map.set(base, {
          product: base,
          enqQty: 0,
          quoQty: 0,
          quoVal: 0,
          soQty: 0,
          soVal: 0,
          dcQty: 0,
          dcVal: 0,
          invQty: 0,
          invVal: 0,
        });
      }
      return map.get(base)!;
    };

    filteredEnquiries.forEach((e) => {
      const p = get(e.part_name);
      p.enqQty += num(e.quantity);
    });

    filteredQuotations.forEach((q) => {
      const p = get(q.part_name);
      p.quoQty += num(q.quantity);
      p.quoVal += getQuoAmount(q);
    });

    filteredSalesOrders.forEach((o) => {
      const p = get(o.part_name);
      p.soQty += num(o.quantity);
      p.soVal += getSoAmount(o);
    });

    filteredDeliveries.forEach((d) => {
      const p = get(d.part_name);
      p.dcQty += num(d.dispatch_qty ?? d.quantity);
      p.dcVal += getDcAmount(d);
    });

    filteredInvoices.forEach((i) => {
      const p = get(i.part_name);
      p.invQty += num(i.quantity);
      p.invVal += num(i.total_amount);
    });

    return Array.from(map.values()).sort((a, b) => (b.soVal + b.invVal) - (a.soVal + a.invVal));
  }, [filteredEnquiries, filteredQuotations, filteredSalesOrders, filteredDeliveries, filteredInvoices]);

  // Itemized Pipeline Tracking rows starting from Enquiry through to Invoicing
  const pipelineTrackingRows = useMemo(() => {
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const baseKey = (s: unknown) => norm(getProductBaseName(String(s ?? '')));

    const rows: any[] = [];
    const matchedQuo = new Set<string>();
    const matchedSo = new Set<string>();
    const matchedDc = new Set<string>();
    const matchedInv = new Set<string>();

    filteredEnquiries.forEach((e) => {
      const enqKey = norm(e.enquiry_no || e.lead_no);
      const co = e.customer || '';
      const prod = e.part_name || '';

      const quo = filteredQuotations.find((q) => {
        if (q.lead_id && q.lead_id === e.id) return true;
        if (enqKey && norm(q.enquiry_no) === enqKey) return true;
        return norm(q.customer) === norm(co) && baseKey(q.part_name) === baseKey(prod);
      });
      if (quo) matchedQuo.add(quo.id);

      const so = filteredSalesOrders.find((o) => {
        if (enqKey && norm(o.lead_no) === enqKey) return true;
        if (quo && (o.quotation_id === quo.id || (o.quote_no && norm(o.quote_no) === norm(quo.quote_no)))) return true;
        return norm(o.customer) === norm(co) && baseKey(o.part_name) === baseKey(prod);
      });
      if (so) matchedSo.add(so.id);

      const dcs = filteredDeliveries.filter((d) => {
        if (so && (d.sales_order_id === so.id || (d.sales_order_no && norm(d.sales_order_no) === norm(so.order_no)))) return true;
        return norm(d.customer_name) === norm(co) && baseKey(d.part_name) === baseKey(prod);
      });
      dcs.forEach((d) => matchedDc.add(d.id));

      const invs = filteredInvoices.filter((i) => {
        if (so && (i.sales_order_id === so.id || norm(i.sales_order_id) === norm(so.order_no))) return true;
        if (dcs.some((d) => norm(d.delivery_no) === norm(i.dc_no))) return true;
        return norm(i.customer_name) === norm(co) && baseKey(i.part_name) === baseKey(prod);
      });
      invs.forEach((i) => matchedInv.add(i.id));

      const enqQty = num(e.quantity);
      const quoQty = quo ? num(quo.quantity) : 0;
      const soQty = so ? num(so.quantity) : 0;
      const dcQty = dcs.reduce((s, d) => s + num(d.dispatch_qty ?? d.quantity), 0);
      const invQty = invs.reduce((s, i) => s + num(i.quantity), 0);
      const invVal = invs.reduce((s, i) => s + num(i.total_amount), 0);

      let stage = 'Enquiry';
      let stageTone = 'bg-amber-50 text-amber-800 border-amber-200';
      if (invQty > 0 || invs.length > 0) {
        stage = 'Invoiced';
        stageTone = 'bg-indigo-50 text-indigo-800 border-indigo-200';
      } else if (dcQty > 0 || dcs.length > 0) {
        stage = 'Delivered';
        stageTone = 'bg-rose-50 text-rose-800 border-rose-200';
      } else if (soQty > 0 || so) {
        stage = 'Sales Order';
        stageTone = 'bg-blue-50 text-blue-800 border-blue-200';
      } else if (quoQty > 0 || quo) {
        stage = 'Quotation';
        stageTone = 'bg-purple-50 text-purple-800 border-purple-200';
      }

      rows.push({
        id: `enq-${e.id}`,
        date: String(e.received_date || e.created_at || '').slice(0, 10),
        time: String(e.created_at || '').slice(11, 16),
        company: co,
        product: prod,
        enqDoc: e.enquiry_no || e.lead_no || '—',
        enqQty,
        enqVal: num(e.estimated_value),
        quoteDoc: quo?.quote_no || '—',
        quoQty,
        quoVal: quo ? getQuoAmount(quo) : 0,
        soDoc: so?.order_no || so?.lead_no || '—',
        soQty,
        soVal: so ? getSoAmount(so) : 0,
        dcDoc: dcs.map((d) => d.delivery_no).filter(Boolean).join(', ') || '—',
        dcQty,
        invDoc: invs.map((i) => i.invoice_no).filter(Boolean).join(', ') || '—',
        invQty,
        invVal,
        stage,
        stageTone,
      });
    });

    filteredSalesOrders.forEach((o) => {
      if (matchedSo.has(o.id)) return;
      const co = o.customer || '';
      const prod = o.part_name || '';

      const dcs = filteredDeliveries.filter((d) => {
        if (d.sales_order_id === o.id || (d.sales_order_no && norm(d.sales_order_no) === norm(o.order_no))) return true;
        return norm(d.customer_name) === norm(co) && baseKey(d.part_name) === baseKey(prod);
      });
      dcs.forEach((d) => matchedDc.add(d.id));

      const invs = filteredInvoices.filter((i) => {
        if (i.sales_order_id === o.id || norm(i.sales_order_id) === norm(o.order_no)) return true;
        if (dcs.some((d) => norm(d.delivery_no) === norm(i.dc_no))) return true;
        return norm(i.customer_name) === norm(co) && baseKey(i.part_name) === baseKey(prod);
      });
      invs.forEach((i) => matchedInv.add(i.id));

      const soQty = num(o.quantity);
      const dcQty = dcs.reduce((s, d) => s + num(d.dispatch_qty ?? d.quantity), 0);
      const invQty = invs.reduce((s, i) => s + num(i.quantity), 0);
      const invVal = invs.reduce((s, i) => s + num(i.total_amount), 0);

      let stage = 'Sales Order';
      let stageTone = 'bg-blue-50 text-blue-800 border-blue-200';
      if (invQty > 0 || invs.length > 0) {
        stage = 'Invoiced';
        stageTone = 'bg-indigo-50 text-indigo-800 border-indigo-200';
      } else if (dcQty > 0 || dcs.length > 0) {
        stage = 'Delivered';
        stageTone = 'bg-rose-50 text-rose-800 border-rose-200';
      }

      rows.push({
        id: `so-${o.id}`,
        date: String(o.order_date || o.created_at || '').slice(0, 10),
        time: String(o.created_at || '').slice(11, 16),
        company: co,
        product: prod,
        enqDoc: '—',
        enqQty: 0,
        enqVal: 0,
        quoteDoc: o.quote_no || '—',
        quoQty: 0,
        quoVal: 0,
        soDoc: o.order_no || o.lead_no || '—',
        soQty,
        soVal: getSoAmount(o),
        dcDoc: dcs.map((d) => d.delivery_no).filter(Boolean).join(', ') || '—',
        dcQty,
        invDoc: invs.map((i) => i.invoice_no).filter(Boolean).join(', ') || '—',
        invQty,
        invVal,
        stage,
        stageTone,
      });
    });

    filteredQuotations.forEach((q) => {
      if (matchedQuo.has(q.id)) return;
      rows.push({
        id: `quo-${q.id}`,
        date: String(q.created_at || '').slice(0, 10),
        time: String(q.created_at || '').slice(11, 16),
        company: q.customer || '',
        product: q.part_name || '',
        enqDoc: q.enquiry_no || '—',
        enqQty: 0,
        enqVal: 0,
        quoteDoc: q.quote_no || '—',
        quoQty: num(q.quantity),
        quoVal: getQuoAmount(q),
        soDoc: '—',
        soQty: 0,
        soVal: 0,
        dcDoc: '—',
        dcQty: 0,
        invDoc: '—',
        invQty: 0,
        invVal: 0,
        stage: 'Quotation',
        stageTone: 'bg-purple-50 text-purple-800 border-purple-200',
      });
    });

    return rows.sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time)));
  }, [filteredEnquiries, filteredQuotations, filteredSalesOrders, filteredDeliveries, filteredInvoices]);

  // Unified transactions feed
  const unifiedTransactions = useMemo(() => {
    const list: any[] = [];

    filteredEnquiries.forEach((e) => {
      list.push({
        type: 'Enquiry',
        typeBadge: 'bg-amber-100 text-amber-800 border-amber-300',
        date: String(e.received_date || e.created_at || '').slice(0, 10),
        time: String(e.created_at || '').slice(11, 16),
        docNo: e.enquiry_no || e.lead_no || '—',
        company: e.customer || '—',
        product: e.part_name || '—',
        qty: num(e.quantity),
        rate: e.quantity ? num(e.estimated_value) / num(e.quantity) : 0,
        amount: num(e.estimated_value),
        status: e.status || 'Active',
      });
    });

    filteredQuotations.forEach((q) => {
      list.push({
        type: 'Quotation',
        typeBadge: 'bg-purple-100 text-purple-800 border-purple-300',
        date: String(q.created_at || '').slice(0, 10),
        time: String(q.created_at || '').slice(11, 16),
        docNo: q.quote_no || '—',
        company: q.customer || '—',
        product: q.part_name || '—',
        qty: num(q.quantity),
        rate: getQuoRate(q),
        amount: getQuoAmount(q),
        status: q.status || 'Draft',
      });
    });

    filteredSalesOrders.forEach((o) => {
      list.push({
        type: 'Sales Order',
        typeBadge: 'bg-blue-100 text-blue-800 border-blue-300',
        date: String(o.order_date || o.created_at || '').slice(0, 10),
        time: String(o.created_at || '').slice(11, 16),
        docNo: o.order_no || o.lead_no || '—',
        company: o.customer || '—',
        product: o.part_name || '—',
        qty: num(o.quantity),
        rate: getSoRate(o),
        amount: getSoAmount(o),
        status: o.status || 'Confirmed',
      });
    });

    filteredDeliveries.forEach((d) => {
      list.push({
        type: 'Delivery Challan',
        typeBadge: 'bg-rose-100 text-rose-800 border-rose-300',
        date: String(d.delivery_date || d.created_at || '').slice(0, 10),
        time: String(d.created_at || '').slice(11, 16),
        docNo: d.delivery_no || '—',
        company: d.customer_name || '—',
        product: d.part_name || '—',
        qty: num(d.dispatch_qty ?? d.quantity),
        rate: getDcRate(d),
        amount: getDcAmount(d),
        status: d.status || 'Pending',
      });
    });

    filteredInvoices.forEach((i) => {
      list.push({
        type: 'Invoice',
        typeBadge: 'bg-indigo-100 text-indigo-800 border-indigo-300',
        date: String(i.invoice_date || i.created_at || '').slice(0, 10),
        time: String(i.created_at || '').slice(11, 16),
        docNo: i.invoice_no || '—',
        company: i.customer_name || '—',
        product: i.part_name || '—',
        qty: num(i.quantity),
        rate: i.quantity ? num(i.total_amount) / num(i.quantity) : 0,
        amount: num(i.total_amount),
        status: i.payment_status || i.status || 'Issued',
      });
    });

    list.sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time)));

    if (txStageFilter === 'all') return list;
    return list.filter((t) => t.type.toLowerCase().includes(txStageFilter.toLowerCase()));
  }, [filteredEnquiries, filteredQuotations, filteredSalesOrders, filteredDeliveries, filteredInvoices, txStageFilter]);

  // CSV Export
  const handleExportCSV = () => {
    const dateRangeLabel = activeRange.from && activeRange.to
      ? `${activeRange.from} to ${activeRange.to}`
      : 'All Time';

    const filename = `Pipeline_Report_${activeRange.from || 'all'}_${activeRange.to || 'time'}`;

    const rows: unknown[][] = [
      ['ARGUSCNC ERP - PIPELINE REPORT'],
      ['Date Range:', dateRangeLabel],
      ['Company Filter:', selectedCompany || 'All Companies'],
      ['Generated On:', todayISO()],
      [],
      ['--- PIPELINE STAGE SUMMARY ---'],
      ['Stage', 'Document Count', 'Total Quantity', 'Total Value (INR)', 'Conversion Rate'],
      ['Enquiries', stats.enqCount, stats.enqQty, stats.enqVal, `${stats.enqToQuoteRate}% to Quote`],
      ['Quotations', stats.quoCount, stats.quoQty, stats.quoVal, `${stats.quoteToSoRate}% to Order`],
      ['Sales Orders', stats.soCount, stats.soQty, stats.soVal, `${stats.soToDcRate}% to Delivery`],
      ['Delivery Challans (DC)', stats.dcCount, stats.dcQty, stats.dcVal, `${stats.dcToInvRate}% to Invoice`],
      ['Invoices', stats.invCount, stats.invQty, stats.invTotal, `Overall Conversion: ${stats.overallConversion}%`],
      ['Invoiced Basic', '', '', stats.invBasic, ''],
      ['Invoiced Tax', '', '', stats.invTax, ''],
      ['Invoiced Paid', '', '', stats.invPaid, ''],
      ['Invoiced Due / Pending', '', '', stats.invDue, ''],
      [],
      ['--- BREAKDOWN BY COMPANY ---'],
      ['Company', 'Enquiries', 'Quotations Count', 'Quotations Value', 'Sales Orders Count', 'Sales Value', 'DC Count', 'Delivered Qty', 'Invoices Count', 'Invoiced Value', 'Outstanding Due'],
      ...companyBreakdown.map((c) => [
        c.company,
        c.enqCount,
        c.quoCount,
        c.quoVal,
        c.soCount,
        c.soVal,
        c.dcCount,
        c.dcQty,
        c.invCount,
        c.invTotal,
        c.invDue,
      ]),
      [],
      ['--- BREAKDOWN BY PRODUCT ---'],
      ['Product Name', 'Enquired Qty', 'Quoted Qty', 'Quoted Value', 'Ordered Qty', 'Sales Value', 'Dispatched Qty', 'Dispatched Value', 'Invoiced Qty', 'Invoiced Value'],
      ...productBreakdown.map((p) => [
        p.product,
        p.enqQty,
        p.quoQty,
        p.quoVal,
        p.soQty,
        p.soVal,
        p.dcQty,
        p.dcVal,
        p.invQty,
        p.invVal,
      ]),
      [],
      ['--- DETAILED TRANSACTION LOG ---'],
      ['Date', 'Time', 'Stage / Type', 'Document No', 'Company', 'Product', 'Quantity', 'Unit Rate', 'Amount (INR)', 'Status'],
      ...unifiedTransactions.map((t) => [
        t.date,
        t.time,
        t.type,
        t.docNo,
        t.company,
        t.product,
        t.qty,
        Math.round(t.rate * 100) / 100,
        t.amount,
        t.status,
      ]),
    ];

    exportCsv(filename, rows);
  };

  // Printable HTML Report
  const handlePrint = () => {
    const rangeText = activeRange.from && activeRange.to
      ? `${activeRange.from} to ${activeRange.to}`
      : 'All Time';

    const bodyHtml = `
      <div class="brand">
        <div>
          <h1>ARGUSCNC ERP — Pipeline Report</h1>
          <div class="meta">Period: <b>${rangeText}</b> | Company: <b>${selectedCompany || 'All Companies'}</b> | Date: ${todayISO()}</div>
        </div>
      </div>

      <h3>1. Pipeline Stage Summary</h3>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th class="num">Documents</th>
            <th class="num">Total Qty</th>
            <th class="num">Total Value (₹)</th>
            <th>Conversion Rate</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Enquiries</td><td class="num">${stats.enqCount}</td><td class="num">${stats.enqQty}</td><td class="num">${formatINR(stats.enqVal)}</td><td>${stats.enqToQuoteRate}% to Quotation</td></tr>
          <tr><td>Quotations</td><td class="num">${stats.quoCount}</td><td class="num">${stats.quoQty}</td><td class="num">${formatINR(stats.quoVal)}</td><td>${stats.quoteToSoRate}% to Sales Order</td></tr>
          <tr><td>Sales Orders (Sales)</td><td class="num">${stats.soCount}</td><td class="num">${stats.soQty}</td><td class="num">${formatINR(stats.soVal)}</td><td>${stats.soToDcRate}% to Delivery</td></tr>
          <tr><td>Delivery Challans (DC)</td><td class="num">${stats.dcCount}</td><td class="num">${stats.dcQty}</td><td class="num">${formatINR(stats.dcVal)}</td><td>${stats.dcToInvRate}% to Invoiced</td></tr>
          <tr class="total"><td>Invoices (Total Billed)</td><td class="num">${stats.invCount}</td><td class="num">${stats.invQty}</td><td class="num">${formatINR(stats.invTotal)}</td><td>Overall: ${stats.overallConversion}%</td></tr>
          <tr><td>• Received / Paid Amount</td><td class="num">—</td><td class="num">—</td><td class="num" style="color: #15803d">${formatINR(stats.invPaid)}</td><td></td></tr>
          <tr><td>• Outstanding Due Balance</td><td class="num">—</td><td class="num">—</td><td class="num" style="color: #b91c1c">${formatINR(stats.invDue)}</td><td></td></tr>
        </tbody>
      </table>

      <h3>2. Company Performance Breakdown</h3>
      <table>
        <thead>
          <tr>
            <th>Company Name</th>
            <th class="num">Enquiries</th>
            <th class="num">Quotes Value</th>
            <th class="num">Orders Value</th>
            <th class="num">Delivered Qty</th>
            <th class="num">Invoiced Value</th>
            <th class="num">Due Amount</th>
          </tr>
        </thead>
        <tbody>
          ${companyBreakdown
            .slice(0, 30)
            .map(
              (c) => `
            <tr>
              <td>${c.company}</td>
              <td class="num">${c.enqCount}</td>
              <td class="num">${formatINR(c.quoVal)}</td>
              <td class="num">${formatINR(c.soVal)}</td>
              <td class="num">${c.dcQty}</td>
              <td class="num">${formatINR(c.invTotal)}</td>
              <td class="num">${formatINR(c.invDue)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;

    printHtml(`Pipeline Report - ${rangeText}`, bodyHtml);
  };

  const presetButtons: { id: DatePreset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'this_week', label: 'This Week' },
    { id: 'last_week', label: 'Last Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'this_year', label: 'This Year' },
    { id: 'all', label: 'All Time' },
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
              >
                ← Back
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
                <BarChart3 size={18} />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-tight">Pipeline Report</h1>
                <p className="text-xs text-slate-500">
                  Real-time sales funnel & stage conversion across Enquiries, Quotes, Sales Orders, DC, and Invoices
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />}
              onClick={loadData}
              disabled={loading}
              className="text-xs h-8"
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Printer size={13} />}
              onClick={handlePrint}
              disabled={loading}
              className="text-xs h-8"
            >
              Print
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={13} />}
              onClick={handleExportCSV}
              disabled={loading}
              className="text-xs h-8 !bg-teal-50 text-teal-800 border-teal-300 hover:!bg-teal-100"
            >
              Export CSV
            </Button>
          </div>
        </div>

        {/* Date Filter & Search Controls */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1.5 flex items-center gap-1">
              <Calendar size={13} /> Period:
            </span>
            {presetButtons.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setPreset(b.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                  preset === b.id
                    ? 'bg-teal-700 text-white font-bold shadow-xs'
                    : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Company filter & search */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {preset === 'custom' && (
              <div className="flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                <span className="text-slate-400 font-medium">From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-transparent border-0 p-0 text-xs text-slate-800 focus:ring-0"
                />
                <span className="text-slate-400 font-medium ml-1">To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-transparent border-0 p-0 text-xs text-slate-800 focus:ring-0"
                />
              </div>
            )}

            <select
              aria-label="Company Filter"
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="h-8 px-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg shadow-2xs focus:outline-none focus:border-teal-500 max-w-[170px] truncate"
            >
              <option value="">All Companies</option>
              {customers.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search report…"
                className="h-8 w-40 pl-8 pr-2.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500/30 focus:border-teal-500 placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* KPI 5-Stage Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* 1. Enquiry */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5 shadow-2xs relative overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1">
              <FileText size={12} /> 1. Enquiries
            </span>
            <Badge variant="warning" className="text-[10px] px-1.5 py-0.5">
              {stats.enqCount} cards
            </Badge>
          </div>
          <div className="text-lg font-black tabular-nums text-slate-900 leading-tight">
            {formatINR(stats.enqVal)}
          </div>
          <div className="mt-2 pt-2 border-t border-amber-100 flex items-center justify-between text-[11px] text-amber-900">
            <span>Total Qty: <b>{stats.enqQty} pcs</b></span>
            <span className="font-semibold text-amber-700">{stats.enqToQuoteRate}% to Quote</span>
          </div>
        </div>

        {/* 2. Quotation */}
        <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-3.5 shadow-2xs relative overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800 flex items-center gap-1">
              <Receipt size={12} /> 2. Quotations
            </span>
            <Badge variant="purple" className="text-[10px] px-1.5 py-0.5">
              {stats.quoCount} quotes
            </Badge>
          </div>
          <div className="text-lg font-black tabular-nums text-slate-900 leading-tight">
            {formatINR(stats.quoVal)}
          </div>
          <div className="mt-2 pt-2 border-t border-purple-100 flex items-center justify-between text-[11px] text-purple-900">
            <span>Total Qty: <b>{stats.quoQty} pcs</b></span>
            <span className="font-semibold text-purple-700">{stats.quoteToSoRate}% to Order</span>
          </div>
        </div>

        {/* 3. Sales Order */}
        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-3.5 shadow-2xs relative overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1">
              <CheckCircle2 size={12} /> 3. Sales Orders
            </span>
            <Badge variant="blue" className="text-[10px] px-1.5 py-0.5">
              {stats.soCount} orders
            </Badge>
          </div>
          <div className="text-lg font-black tabular-nums text-slate-900 leading-tight">
            {formatINR(stats.soVal)}
          </div>
          <div className="mt-2 pt-2 border-t border-blue-100 flex items-center justify-between text-[11px] text-blue-900">
            <span>Ordered: <b>{stats.soQty} pcs</b></span>
            <span className="font-semibold text-blue-700">{stats.soToDcRate}% to Delivery</span>
          </div>
        </div>

        {/* 4. DC (Deliveries) */}
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3.5 shadow-2xs relative overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 flex items-center gap-1">
              <Truck size={12} /> 4. Deliveries (DC)
            </span>
            <Badge variant="danger" className="text-[10px] px-1.5 py-0.5">
              {stats.dcCount} DCs
            </Badge>
          </div>
          <div className="text-lg font-black tabular-nums text-slate-900 leading-tight">
            {formatINR(stats.dcVal)}
          </div>
          <div className="mt-2 pt-2 border-t border-rose-100 flex items-center justify-between text-[11px] text-rose-900">
            <span>Dispatched: <b>{stats.dcQty} pcs</b></span>
            <span className="font-semibold text-rose-700">{stats.dcToInvRate}% to Invoiced</span>
          </div>
        </div>

        {/* 5. Invoices */}
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3.5 shadow-2xs relative overflow-hidden">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800 flex items-center gap-1">
              <DollarSign size={12} /> 5. Invoices
            </span>
            <Badge variant="indigo" className="text-[10px] px-1.5 py-0.5">
              {stats.invCount} invs
            </Badge>
          </div>
          <div className="text-lg font-black tabular-nums text-indigo-950 leading-tight">
            {formatINR(stats.invTotal)}
          </div>
          <div className="mt-2 pt-2 border-t border-indigo-100 flex items-center justify-between text-[11px] text-indigo-900">
            <span>Paid: <b className="text-emerald-700">{formatINR(stats.invPaid)}</b></span>
            <span>Due: <b className="text-rose-700">{formatINR(stats.invDue)}</b></span>
          </div>
        </div>
      </div>

      {/* Visual Conversion Funnel Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <TrendingUp size={14} className="text-teal-600" /> Pipeline Conversion Funnel
          </span>
          <span className="text-xs text-slate-500">
            Overall Enquiry → Invoiced Conversion: <b className="text-teal-700">{stats.overallConversion}%</b>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 pt-1 items-center">
          {/* Stage 1: Enquiry */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase font-bold text-amber-800">Enquiries</p>
            <p className="text-base font-black text-amber-950">{stats.enqCount}</p>
            <p className="text-[10px] text-amber-700 font-semibold">{formatINR(stats.enqVal)}</p>
          </div>

          <div className="hidden md:flex flex-col items-center justify-center text-slate-400">
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mb-1">
              {stats.enqToQuoteRate}%
            </span>
            <ArrowRight size={14} />
          </div>

          {/* Stage 2: Quotation */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase font-bold text-purple-800">Quotations</p>
            <p className="text-base font-black text-purple-950">{stats.quoCount}</p>
            <p className="text-[10px] text-purple-700 font-semibold">{formatINR(stats.quoVal)}</p>
          </div>

          <div className="hidden md:flex flex-col items-center justify-center text-slate-400">
            <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 mb-1">
              {stats.quoteToSoRate}%
            </span>
            <ArrowRight size={14} />
          </div>

          {/* Stage 3: Sales Order */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase font-bold text-blue-800">Sales Orders</p>
            <p className="text-base font-black text-blue-950">{stats.soCount}</p>
            <p className="text-[10px] text-blue-700 font-semibold">{formatINR(stats.soVal)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 pt-2 items-center">
          <div className="hidden md:block col-span-2"></div>

          {/* Stage 4: Delivery */}
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase font-bold text-rose-800">Deliveries (DC)</p>
            <p className="text-base font-black text-rose-950">{stats.dcCount} DCs</p>
            <p className="text-[10px] text-rose-700 font-semibold">{formatINR(stats.dcVal)}</p>
          </div>

          <div className="hidden md:flex flex-col items-center justify-center text-slate-400">
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 mb-1">
              {stats.dcToInvRate}%
            </span>
            <ArrowRight size={14} />
          </div>

          {/* Stage 5: Invoiced */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase font-bold text-indigo-800">Invoiced</p>
            <p className="text-base font-black text-indigo-950">{stats.invCount} Invs</p>
            <p className="text-[10px] text-indigo-700 font-semibold">{formatINR(stats.invTotal)}</p>
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50/70 px-4 pt-2 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('tracking')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'tracking'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <TrendingUp size={14} /> Pipeline Tracking (From Enquiry) ({pipelineTrackingRows.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers size={14} /> Stage Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('companies')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'companies'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 size={14} /> By Company ({companyBreakdown.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('products')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'products'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Package size={14} /> By Product ({productBreakdown.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('transactions')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'transactions'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText size={14} /> Transactions Feed ({unifiedTransactions.length})
          </button>
        </div>

        {/* Tab 0: Pipeline Tracking (From Enquiry) Table */}
        {activeTab === 'tracking' && (
          <div className="p-4 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[1000px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider text-left bg-slate-50/50">
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Product / Part</th>
                    <th className="py-2.5 px-3 text-right">1. Enquiry</th>
                    <th className="py-2.5 px-3 text-right">2. Quotation</th>
                    <th className="py-2.5 px-3 text-right">3. Ordered</th>
                    <th className="py-2.5 px-3 text-right">4. Delivered (DC)</th>
                    <th className="py-2.5 px-3 text-right">5. Invoiced</th>
                    <th className="py-2.5 px-3 text-center">Pipeline Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pipelineTrackingRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-400 italic">
                        No pipeline entries match this period and company filter.
                      </td>
                    </tr>
                  ) : (
                    pipelineTrackingRows.map((r, idx) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-600">
                          <span className="font-medium text-slate-900 block">{r.date}</span>
                          {r.time && <span className="text-[10px] text-slate-400">{r.time}</span>}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900 max-w-[200px] truncate" title={r.company}>
                          {r.company || '—'}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800 max-w-[220px] truncate" title={r.product}>
                          {r.product || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {r.enqQty > 0 ? (
                            <div>
                              <span className="font-bold text-amber-900">{r.enqQty} pcs</span>
                              <span className="text-[10px] text-slate-400 block font-mono">{r.enqDoc}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {r.quoQty > 0 ? (
                            <div>
                              <span className="font-bold text-purple-900">{r.quoQty} pcs</span>
                              <span className="text-[10px] text-slate-400 block font-mono">{r.quoteDoc}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {r.soQty > 0 ? (
                            <div>
                              <span className="font-bold text-blue-900">{r.soQty} pcs</span>
                              <span className="text-[10px] text-blue-600 block font-mono">{r.soDoc}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {r.dcQty > 0 ? (
                            <div>
                              <span className="font-bold text-rose-900">{r.dcQty} pcs</span>
                              <span className="text-[10px] text-rose-600 block font-mono">{r.dcDoc}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {r.invQty > 0 ? (
                            <div>
                              <span className="font-black text-indigo-950">{r.invQty} pcs</span>
                              <span className="text-[10px] text-indigo-700 block font-mono">{formatINR(r.invVal)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${r.stageTone}`}>
                            {r.stage}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 1: Stage Overview Table */}
        {activeTab === 'overview' && (
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider text-left bg-slate-50/50">
                    <th className="py-2.5 px-3">Pipeline Stage</th>
                    <th className="py-2.5 px-3 text-right">Document Count</th>
                    <th className="py-2.5 px-3 text-right">Total Quantity</th>
                    <th className="py-2.5 px-3 text-right">Total Amount (₹)</th>
                    <th className="py-2.5 px-3 text-right">Avg Transaction Size</th>
                    <th className="py-2.5 px-3 text-left pl-6">Next Stage Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-bold text-amber-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                      1. Enquiries
                    </td>
                    <td className="py-3 px-3 text-right font-black tabular-nums">{stats.enqCount}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{stats.enqQty} pcs</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-slate-900">
                      {formatINR(stats.enqVal)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                      {stats.enqCount > 0 ? formatINR(stats.enqVal / stats.enqCount) : '—'}
                    </td>
                    <td className="py-3 px-3 pl-6">
                      <span className="inline-flex items-center gap-1 font-bold text-amber-700">
                        {stats.enqToQuoteRate}% to Quotation
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-bold text-purple-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block"></span>
                      2. Quotations
                    </td>
                    <td className="py-3 px-3 text-right font-black tabular-nums">{stats.quoCount}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{stats.quoQty} pcs</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-slate-900">
                      {formatINR(stats.quoVal)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                      {stats.quoCount > 0 ? formatINR(stats.quoVal / stats.quoCount) : '—'}
                    </td>
                    <td className="py-3 px-3 pl-6">
                      <span className="inline-flex items-center gap-1 font-bold text-purple-700">
                        {stats.quoteToSoRate}% to Sales Order
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-bold text-blue-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                      3. Sales Orders
                    </td>
                    <td className="py-3 px-3 text-right font-black tabular-nums">{stats.soCount}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{stats.soQty} pcs</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-slate-900">
                      {formatINR(stats.soVal)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                      {stats.soCount > 0 ? formatINR(stats.soVal / stats.soCount) : '—'}
                    </td>
                    <td className="py-3 px-3 pl-6">
                      <span className="inline-flex items-center gap-1 font-bold text-blue-700">
                        {stats.soToDcRate}% to Delivery
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-bold text-rose-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                      4. Delivery Challans (DC)
                    </td>
                    <td className="py-3 px-3 text-right font-black tabular-nums">{stats.dcCount}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{stats.dcQty} pcs</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-slate-900">
                      {formatINR(stats.dcVal)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                      {stats.dcCount > 0 ? formatINR(stats.dcVal / stats.dcCount) : '—'}
                    </td>
                    <td className="py-3 px-3 pl-6">
                      <span className="inline-flex items-center gap-1 font-bold text-rose-700">
                        {stats.dcToInvRate}% to Invoiced
                      </span>
                    </td>
                  </tr>

                  <tr className="bg-indigo-50/30 hover:bg-indigo-50/60 font-bold transition-colors">
                    <td className="py-3 px-3 font-black text-indigo-950 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block"></span>
                      5. Invoices (Billed Total)
                    </td>
                    <td className="py-3 px-3 text-right font-black tabular-nums text-indigo-950">
                      {stats.invCount}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-indigo-950">{stats.invQty} pcs</td>
                    <td className="py-3 px-3 text-right font-black tabular-nums text-indigo-950">
                      {formatINR(stats.invTotal)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-indigo-900">
                      {stats.invCount > 0 ? formatINR(stats.invTotal / stats.invCount) : '—'}
                    </td>
                    <td className="py-3 px-3 pl-6">
                      <span className="text-emerald-700 font-bold">
                        Paid: {formatINR(stats.invPaid)} · Due: {formatINR(stats.invDue)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: By Company Table */}
        {activeTab === 'companies' && (
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[800px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider text-left bg-slate-50/50">
                    <th className="py-2.5 px-3">Company Name</th>
                    <th className="py-2.5 px-3 text-right">Enquiries</th>
                    <th className="py-2.5 px-3 text-right">Quotes Value</th>
                    <th className="py-2.5 px-3 text-right">Orders Value</th>
                    <th className="py-2.5 px-3 text-right">Delivered (DC) Qty</th>
                    <th className="py-2.5 px-3 text-right">Invoiced Value</th>
                    <th className="py-2.5 px-3 text-right">Outstanding Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {companyBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                        No activity found for this period and company filter.
                      </td>
                    </tr>
                  ) : (
                    companyBreakdown.map((c) => (
                      <tr key={c.company} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{c.company}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                          {c.enqCount > 0 ? <span className="font-bold text-amber-800">{c.enqCount}</span> : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {c.quoVal > 0 ? formatINR(c.quoVal) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-blue-900">
                          {c.soVal > 0 ? formatINR(c.soVal) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {c.dcQty > 0 ? `${c.dcQty} pcs` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-black text-indigo-950">
                          {c.invTotal > 0 ? formatINR(c.invTotal) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold">
                          {c.invDue > 0 ? (
                            <span className="text-rose-700">{formatINR(c.invDue)}</span>
                          ) : (
                            <span className="text-emerald-700">Clear</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: By Product Table */}
        {activeTab === 'products' && (
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[800px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider text-left bg-slate-50/50">
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3 text-right">Enquired Qty</th>
                    <th className="py-2.5 px-3 text-right">Quoted Qty & Value</th>
                    <th className="py-2.5 px-3 text-right">Ordered Qty & Value</th>
                    <th className="py-2.5 px-3 text-right">Delivered Qty</th>
                    <th className="py-2.5 px-3 text-right">Invoiced Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                        No product transactions found for this period.
                      </td>
                    </tr>
                  ) : (
                    productBreakdown.map((p) => (
                      <tr key={p.product} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{p.product}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                          {p.enqQty > 0 ? `${p.enqQty} pcs` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {p.quoQty > 0 ? (
                            <div>
                              <span>{p.quoQty} pcs</span>
                              <span className="text-[10px] text-slate-400 block">{formatINR(p.quoVal)}</span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-blue-900">
                          {p.soQty > 0 ? (
                            <div>
                              <span>{p.soQty} pcs</span>
                              <span className="text-[10px] text-blue-600 block">{formatINR(p.soVal)}</span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-rose-900">
                          {p.dcQty > 0 ? `${p.dcQty} pcs` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-black text-indigo-950">
                          {p.invVal > 0 ? formatINR(p.invVal) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Unified Transactions Feed */}
        {activeTab === 'transactions' && (
          <div className="p-4 space-y-3">
            {/* Filter buttons for transaction stage */}
            <div className="flex flex-wrap items-center gap-1.5 pb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
                <Filter size={12} /> Stage:
              </span>
              {[
                { id: 'all', label: `All (${unifiedTransactions.length})` },
                { id: 'enquiry', label: 'Enquiries' },
                { id: 'quotation', label: 'Quotations' },
                { id: 'sales order', label: 'Sales Orders' },
                { id: 'delivery', label: 'Delivery Challans' },
                { id: 'invoice', label: 'Invoices' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTxStageFilter(s.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                    txStageFilter === s.id
                      ? 'bg-slate-800 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[850px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider text-left bg-slate-50/50">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Stage</th>
                    <th className="py-2.5 px-3">Document #</th>
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 text-right">Total Amount (₹)</th>
                    <th className="py-2.5 px-3 text-left pl-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unifiedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 italic">
                        No transactions found for the chosen filters.
                      </td>
                    </tr>
                  ) : (
                    unifiedTransactions.slice(0, 150).map((t, idx) => (
                      <tr key={`${t.type}-${t.docNo}-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 tabular-nums text-slate-600 whitespace-nowrap">
                          {t.date}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${t.typeBadge}`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-800 whitespace-nowrap">
                          {t.docNo}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {t.company}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          {t.product}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium text-slate-800">
                          {t.qty > 0 ? t.qty : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-500">
                          {t.rate > 0 ? formatINR(t.rate) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900">
                          {t.amount > 0 ? formatINR(t.amount) : '—'}
                        </td>
                        <td className="py-2.5 px-3 pl-4">
                          <Badge variant="neutral" className="text-[10px]">
                            {t.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {unifiedTransactions.length > 150 && (
              <p className="text-[11px] text-slate-400 text-center pt-2">
                Showing first 150 of {unifiedTransactions.length} records. Use Export CSV to view all records.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
