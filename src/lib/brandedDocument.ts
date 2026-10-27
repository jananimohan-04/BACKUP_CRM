import { formatDate } from '@/lib/format';
import { productOnly } from '@/lib/productLabel';

export interface BrandedDocumentInput {
  companyName: string;
  title: string;
  documentNo: string;
  date: string | null | undefined;
  details: [string, string | number | null | undefined][];
  columns: string[];
  rows: (string | number)[][];
  totals?: [string, string][];
  /** Right-hand info block rendered next to `details` (premium layout only). */
  details2?: [string, string | number | null | undefined][];
  /** Remarks / notes section (premium layout only). */
  remarks?: string | null | undefined;
  /** Signature labels rendered as a footer row (premium layout only). */
  signatures?: string[];
  /** Premium industrial styling (navy + orange, header/footer, signatures). Omit for the classic look. */
  premium?: boolean;
}

/** Logo on a curved (rounded-corner) white badge so it never looks pasted as a sharp rectangle. */
export async function addRoundedLogo(doc: any, x: number, y: number, w: number, h: number) {
  try {
    const response = await fetch('/arguscnc-logo.jpg');
    if (!response.ok) return;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 3, 3, 'F');
    const pad = 1.2;
    doc.addImage(dataUrl, 'JPEG', x + pad, y + pad, w - pad * 2, h - pad * 2);
  } catch {
    // The document stays printable without the logo.
  }
}

async function buildBrandedDocument(input: BrandedDocumentInput) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  if (input.premium) {
    return buildPremiumDocument(doc, autoTable, input, pageWidth);
  }
  let y = 15;

  await addRoundedLogo(doc, 14, 12, 42, 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(input.companyName || 'ARGUS CNC', 62, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(input.title, 62, 27);
  doc.text(`Document No: ${input.documentNo || '—'}`, 62, 33);
  doc.text(`Date: ${formatDate(input.date) || '—'}`, pageWidth - 14, 33, { align: 'right' });
  doc.setDrawColor(220, 226, 235);
  doc.line(14, 38, pageWidth - 14, 38);

  autoTable(doc, {
    startY: 43,
    body: input.details.map(([label, value]) => [label, String(value ?? '—')]),
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 } },
    margin: { left: 14, right: 14 },
  });
  const afterDetails = (doc as any).lastAutoTable?.finalY ?? 60;
  autoTable(doc, {
    startY: afterDetails + 5,
    head: [input.columns],
    body: input.rows,
    theme: 'grid',
    headStyles: { fillColor: [31, 52, 77], textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2.5 },
    margin: { left: 14, right: 14 },
  });

  let bottom = (doc as any).lastAutoTable?.finalY ?? afterDetails + 10;
  for (const [label, value] of input.totals ?? []) {
    bottom += 7;
    doc.setFont('helvetica', label === 'Total' ? 'bold' : 'normal');
    doc.text(label, pageWidth - 68, bottom);
    doc.text(value, pageWidth - 14, bottom, { align: 'right' });
  }
  return doc;
}

async function buildPremiumDocument(
  doc: any,
  autoTable: any,
  input: BrandedDocumentInput,
  pageWidth: number,
) {
  const NAVY: [number, number, number] = [30, 58, 95];
  const ORANGE: [number, number, number] = [234, 88, 12];
  const GREY: [number, number, number] = [100, 116, 139];
  const LIGHT: [number, number, number] = [248, 250, 252];
  const ML = 14;
  const MR = 14;
  const contentW = pageWidth - ML - MR;
  const val = (v: string | number | null | undefined) => String(v ?? '').trim() || '—';

  // Header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 36, 'F');
  await addRoundedLogo(doc, ML, 8, 40, 17);
  const tx = 60;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(input.companyName || 'ARGUS CNC', tx, 15);
  doc.setTextColor(251, 146, 60);
  doc.setFontSize(12);
  doc.text(String(input.title || '').toUpperCase(), tx, 23);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Document No: ${input.documentNo || '—'}`, tx, 29.5);
  doc.text(`Date: ${formatDate(input.date) || '—'}`, pageWidth - MR, 29.5, { align: 'right' });

  let y = 42;
  // Info blocks side by side
  const colW = (contentW - 6) / 2;
  const infoOpts = {
    theme: 'plain' as const,
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold' as const, textColor: GREY, cellWidth: 34 } },
  };
  autoTable(doc, {
    startY: y,
    body: input.details.map(([label, value]) => [label, val(value)]),
    tableWidth: colW,
    margin: { left: ML },
    ...infoOpts,
  });
  const leftEnd = (doc as any).lastAutoTable?.finalY ?? y;
  if (input.details2?.length) {
    autoTable(doc, {
      startY: y,
      body: input.details2.map(([label, value]) => [label, val(value)]),
      tableWidth: colW,
      margin: { left: ML + colW + 6 },
      ...infoOpts,
    });
  }
  const rightEnd = (doc as any).lastAutoTable?.finalY ?? y;
  y = Math.max(leftEnd, rightEnd) + 4;

  // Items table (autoTable paginates automatically)
  autoTable(doc, {
    startY: y,
    head: [input.columns],
    body: input.rows,
    theme: 'grid',
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: LIGHT },
    styles: { fontSize: 9, cellPadding: 2.5, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 20, halign: 'center' },
    },
    margin: { left: ML, right: MR },
  });
  y = (doc as any).lastAutoTable?.finalY ?? y + 10;

  const ensureSpace = (needed: number) => {
    if (y + needed > 258) {
      doc.addPage();
      y = 20;
    }
  };

  // Delivery summary box
  if (input.totals?.length) {
    ensureSpace(30);
    const boxW = 82;
    autoTable(doc, {
      startY: y + 2,
      head: [['DELIVERY SUMMARY', '']],
      body: input.totals.map(([label, value]) => [label, value]),
      tableWidth: boxW,
      margin: { left: pageWidth - MR - boxW },
      theme: 'grid',
      headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9, fontStyle: 'bold', halign: 'center' },
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: {
        0: { textColor: GREY },
        1: { halign: 'right', fontStyle: 'bold', textColor: NAVY },
      },
    });
    y = (doc as any).lastAutoTable?.finalY ?? y + 20;
  }

  // Declaration
  ensureSpace(24);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text('Declaration:', ML, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  const declLines: string[] = doc.splitTextToSize('Goods mentioned above have been delivered in good condition.', contentW);
  doc.text(declLines, ML, y);
  y += declLines.length * 5 + 6;

  // Signatures
  ensureSpace(56);
  const sigW = (contentW - 12) / 3;
  doc.setFontSize(9);
  (input.signatures?.length ? input.signatures : ['Prepared By', 'Checked By', 'Received By']).forEach((label, i) => {
    const x = ML + i * (sigW + 6);
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.4);
    doc.line(x, y + 12, x + sigW, y + 12);
    doc.setTextColor(...GREY);
    doc.setFont('helvetica', 'normal');
    doc.text(label, x, y + 18);
  });
  y += 30;
  const sigW2 = (contentW - 6) / 2;
  const sigRow2: Array<[string, number]> = [
    ['Customer Signature', ML],
    [`For ${input.companyName || 'the Company'} — Authorized Signatory`, ML + sigW2 + 6],
  ];
  sigRow2.forEach(([label, x]) => {
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.4);
    doc.line(x, y + 12, x + sigW2, y + 12);
    doc.setTextColor(...GREY);
    doc.setFont('helvetica', 'normal');
    doc.text(label, x, y + 18);
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`Generated by ${input.companyName || 'Argus ERP'}`, ML, 288);
    doc.text(`Page ${i} of ${pages}`, pageWidth - MR, 288, { align: 'right' });
  }
  return doc;
}

export async function downloadBrandedDocument(input: BrandedDocumentInput) {
  const doc = await buildBrandedDocument(input);
  doc.save(`${input.documentNo || input.title.replace(/\s+/g, '_')}.pdf`);
}

export async function viewBrandedDocument(input: BrandedDocumentInput) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Allow pop-ups to preview the PDF.');
  try {
    const doc = await buildBrandedDocument(input);
    const url = URL.createObjectURL(doc.output('blob'));
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
}

// -------------------------------------------------------------------------------------
// Product costing / final pricing document (multi-section premium A4).
// Same navy/orange theme and logo handling as the premium builder above.
// Amounts arrive pre-formatted as strings (core PDF fonts lack the ₹ glyph).
// -------------------------------------------------------------------------------------

export interface CostingDocumentInput {
  companyName: string;
  documentNo: string;
  date: string | null | undefined;
  infoLeft: [string, string][];
  infoRight: [string, string][];
  /** Single quotation detail row: [no, customer, product, qty, unit price, discount, tax, total]. */
  quotationRow: string[];
  materials: { code: string; name: string; qty: string; unit: string; rate: string; total: string }[];
  ops: { op: string; machine: string; mHours: string; mRate: string; mCost: string; operator: string; lHours: string; lRate: string; lCost: string }[];
  processes: { seq: string; process: string; machine: string; cycle: string; setup: string; rate: string; comp: string; cost: string }[];
  summary: [string, string][];
  approval: [string, string][];
  signatures?: string[];
}

async function loadLogo(doc: any, x: number, y: number, w: number, h: number) {
  await addRoundedLogo(doc, x, y, w, h);
}

async function buildCostingDocument(input: CostingDocumentInput) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const NAVY: [number, number, number] = [30, 58, 95];
  const GREY: [number, number, number] = [100, 116, 139];
  const LIGHT: [number, number, number] = [248, 250, 252];
  const INK: [number, number, number] = [30, 41, 59];
  const ML = 14;
  const MR = 14;
  const contentW = pageWidth - ML - MR;
  const val = (v: string | number | null | undefined) => String(v ?? '').trim() || '—';

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 36, 'F');
  await loadLogo(doc, ML, 8, 40, 17);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(input.companyName || 'ARGUS CNC', 60, 15);
  doc.setTextColor(251, 146, 60);
  doc.setFontSize(12);
  doc.text('PRODUCT COSTING / FINAL PRICING', 60, 23);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Document No: ${input.documentNo || '—'}`, 60, 29.5);
  doc.text(`Date: ${input.date ? formatDate(input.date) : '—'}`, pageWidth - MR, 29.5, { align: 'right' });

  let y = 42;
  const colW = (contentW - 6) / 2;
  const infoOpts = {
    theme: 'plain' as const,
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold' as const, textColor: GREY, cellWidth: 34 } },
  };
  autoTable(doc, {
    startY: y, body: input.infoLeft.map(([l, v]) => [l, val(v)]),
    tableWidth: colW, margin: { left: ML }, ...infoOpts,
  });
  const leftEnd = (doc as any).lastAutoTable?.finalY ?? y;
  autoTable(doc, {
    startY: y, body: input.infoRight.map(([l, v]) => [l, val(v)]),
    tableWidth: colW, margin: { left: ML + colW + 6 }, ...infoOpts,
  });
  y = Math.max(leftEnd, (doc as any).lastAutoTable?.finalY ?? y) + 4;

  const ensureSpace = (needed: number) => {
    if (y + needed > 258) {
      doc.addPage();
      y = 20;
    }
  };
  const section = (title: string, head: string[], body: string[][], columnStyles?: Record<number, any>) => {
    ensureSpace(30);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text(title, ML, y);
    y += 2;
    autoTable(doc, {
      startY: y, head: [head], body,
      theme: 'grid',
      headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: LIGHT },
      styles: { fontSize: 8, cellPadding: 2, textColor: INK },
      columnStyles,
      margin: { left: ML, right: MR },
    });
    y = (doc as any).lastAutoTable?.finalY ?? y + 10;
  };
  const R = { halign: 'right' as const };
  const C = { halign: 'center' as const };

  section('1. Quotation Details', ['Quotation No', 'Company', 'Product', 'Qty', 'Unit Price', 'Discount', 'Tax', 'Quoted Total'],
    [input.quotationRow.map(val)], { 0: C, 3: R, 4: R, 5: R, 6: R, 7: R });
  section('2. Material Cost',
    ['Code', 'Material', 'Req. Qty', 'Unit', 'Unit Cost', 'Total'],
    input.materials.map(m => [m.code, m.name, m.qty, m.unit, m.rate, m.total]),
    { 2: R, 4: R, 5: R });
  section('3. Machine & Labour Cost',
    ['Operation', 'Machine', 'Mc Hrs', 'Mc Rate', 'Mc Cost', 'Operator', 'Lab Hrs', 'Lab Rate', 'Lab Cost'],
    input.ops.map(o => [o.op, o.machine, o.mHours, o.mRate, o.mCost, o.operator, o.lHours, o.lRate, o.lCost]),
    { 2: R, 3: R, 4: R, 6: R, 7: R, 8: R });
  section('4. Process Costing',
    ['Seq', 'Process', 'Machine', 'Cycle', 'Setup', 'Cost/Hour', 'Comp. Cost', 'Process Cost'],
    input.processes.map(p => [p.seq, p.process, p.machine, p.cycle, p.setup, p.rate, p.comp, p.cost]),
    { 0: C, 3: R, 4: R, 5: R, 6: R, 7: R });
  section('5. Final Price Summary', ['Component', 'Amount'],
    input.summary.map(([l, v]) => [l, v]), { 1: R });

  if (input.approval.length) {
    section('6. Approval Details', ['Field', 'Value'],
      input.approval.map(([l, v]) => [l, val(v)]), {});
  }

  ensureSpace(56);
  const sigW = (contentW - 12) / 3;
  doc.setFontSize(9);
  (input.signatures?.length ? input.signatures : ['Prepared By', 'Checked By', 'Approved By']).forEach((label, i) => {
    const x = ML + i * (sigW + 6);
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.4);
    doc.line(x, y + 12, x + sigW, y + 12);
    doc.setTextColor(...GREY);
    doc.setFont('helvetica', 'normal');
    doc.text(`${label} / Date / Signature`, x, y + 18);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`Generated by ${input.companyName || 'Argus ERP'}`, ML, 288);
    doc.text(`Page ${i} of ${pages}`, pageWidth - MR, 288, { align: 'right' });
  }
  return doc;
}

export async function downloadCostingDocument(input: CostingDocumentInput) {
  const doc = await buildCostingDocument(input);
  doc.save(`${input.documentNo || 'costing'}.pdf`);
}

export async function viewCostingDocument(input: CostingDocumentInput) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Allow pop-ups to preview the PDF.');
  try {
    const doc = await buildCostingDocument(input);
    const url = URL.createObjectURL(doc.output('blob'));
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
}

// -------------------------------------------------------------------------------------
// Delivery Challan print (classic full-detail format): letterhead, customer/DC
// box, item table (S.No / Part Name / HSN / Qty / Unit / Price / Amount),
// category/process box, signature boxes with captured signatures, footer.
// Amounts arrive pre-formatted as strings (core PDF fonts lack the ₹ glyph).
// -------------------------------------------------------------------------------------

export interface DeliveryChallanItem {
  partName: string;
  hsn: string;
  qty: string;
  unit: string;
  price: string;
  amount: string;
}

export interface DeliveryChallanInput {
  companyName: string;
  letterheadLine1?: string;
  letterheadLine2?: string;
  letterheadContact?: string;
  dcNo: string;
  dcDate: string | null | undefined;
  ewayBill: string;
  poNumber: string;
  placeOfSupply: string;
  customerName: string;
  customerAddress: string;
  customerGstin: string;
  customerCode: string;
  category: string;
  packaging: string;
  enquiryNo: string;
  process: string;
  transportNo: string;
  phoneNo: string;
  receiverName: string;
  senderName?: string;
  items: DeliveryChallanItem[];
  customerSignature?: string | null;
  authorizedSignature?: string | null;
}

function challanDate(iso: string | null | undefined): string {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || '—';
}

async function buildDeliveryChallanDocument(input: DeliveryChallanInput, docInstance?: any) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = docInstance || new jsPDF({ unit: 'mm', format: 'a4' });
  const startPage = docInstance ? doc.getNumberOfPages() + 1 : 1;
  if (docInstance) {
    doc.addPage();
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  const NAVY: [number, number, number] = [30, 58, 95];
  const ORANGE: [number, number, number] = [234, 88, 12];
  const GREY: [number, number, number] = [100, 116, 139];
  const INK: [number, number, number] = [30, 41, 59];
  const TINT: [number, number, number] = [248, 250, 252];
  const LINE: [number, number, number] = [226, 232, 240];
  const ML = 14;
  const MR = 14;
  const contentW = pageWidth - ML - MR;
  const cx = pageWidth / 2;
  const compName = String(input.companyName || 'ARGUS TECHNOLOGIES').toUpperCase();
  const val = (v: string | number | null | undefined) => String(v ?? '').trim() || '—';

  // ---- Premium header: logo left, company centre, document meta right ----
  try {
    const response = await fetch('/arguscnc-logo.jpg');
    if (response.ok) {
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      doc.addImage(dataUrl, 'JPEG', ML, 9, 34, 14);
    }
  } catch { /* printable without the logo */ }
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(compName, cx, 16, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('DOCUMENT NO.', pageWidth - MR, 11, { align: 'right' });
  doc.setFontSize(10.5);
  doc.setTextColor(...NAVY);
  doc.text(val(input.dcNo), pageWidth - MR, 15.5, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('DATE', pageWidth - MR, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(challanDate(input.dcDate), pageWidth - MR, 24.5, { align: 'right' });

  let y = 29;
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.8);
  doc.line(ML, y, pageWidth - MR, y);
  y += 6;

  // ---- Title band: subtle tint, orange accent bar, navy text ----
  doc.setFillColor(...TINT);
  doc.rect(ML, y, contentW, 10, 'F');
  doc.setFillColor(...ORANGE);
  doc.rect(ML, y, 1.6, 10, 'F');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('DELIVERY CHALLAN', ML + 5.5, y + 7);
  y += 13;

  const sectionTitle = (t: string) => {
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(t, ML, y);
    y += 2;
    doc.setDrawColor(...ORANGE);
    doc.setLineWidth(0.7);
    doc.line(ML, y, ML + 14, y);
    y += 5;
  };

  // ---- Top row: customer card left, DC card right, items below ----
  const halfW = (contentW - 5) / 2;
  // A value that wraps onto a second line (a long address) gets a taller row, so it never runs into the next label.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const custValues = [val(input.customerName), val(input.customerAddress), val(input.customerGstin), val(input.customerCode), val(input.phoneNo)];
  const custLines = custValues.map((v) => (doc.splitTextToSize(v || '—', halfW - 10) as string[]).slice(0, 2));
  const custRowH = custLines.map((l) => 10 + (l.length - 1) * 4.4);
  const custOff = custRowH.map((_, i) => custRowH.slice(0, i).reduce((a, b) => a + b, 0));
  const topCardH = Math.max(5 * 10, custRowH.reduce((a, b) => a + b, 0)) + 5;
  if (y + 12 + topCardH > 278) {
    doc.addPage();
    y = 15;
  }
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('CUSTOMER & DELIVERY DETAILS', ML, y);
  doc.text('DC DETAILS', ML + halfW + 5, y);
  y += 2;
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.7);
  doc.line(ML, y, ML + 14, y);
  doc.line(ML + halfW + 5, y, ML + halfW + 19, y);
  y += 5;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, y, halfW, topCardH, 1.5, 1.5, 'FD');
  doc.roundedRect(ML + halfW + 5, y, halfW, topCardH, 1.5, 1.5, 'FD');
  const custRows: [string, string][] = [
    ['Customer Name', val(input.customerName)],
    ['Customer Address', val(input.customerAddress)],
    ['Customer GSTIN', val(input.customerGstin)],
    ['Customer Code', val(input.customerCode)],
    ['Phone Number', val(input.phoneNo)],
  ];
  // Right card pairs a DC field with a DC-detail field per row so both
  // cards stay the same height and every required field is kept.
  const dcRows: [string, string, string, string][] = [
    ['DC Number', val(input.dcNo), 'Category', val(input.category)],
    ['E-Way Bill No', val(input.ewayBill), 'Process of DC', val(input.process)],
    ['PO Number', val(input.poNumber), 'Packaging Details', val(input.packaging)],
    ['Place of Supply', val(input.placeOfSupply), 'Transport Number', val(input.transportNo)],
    ['DC Date', challanDate(input.dcDate), 'Enquiry Number', val(input.enquiryNo)],
  ];
  custRows.forEach(([label], i) => {
    const ry = y + 4.5 + custOff[i];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(label.toUpperCase(), ML + 4.5, ry);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(custLines[i], ML + 4.5, ry + 4.4);
    if (i < custRows.length - 1) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      const sepY = y + custOff[i] + custRowH[i] + 2.5;
      doc.line(ML + 4.5, sepY, ML + halfW - 4.5, sepY);
    }
  });
  const miniW = (halfW - 9) / 2;
  dcRows.forEach(([ll, lv, rl, rv], i) => {
    const ry = y + 4.5 + i * 10;
    const mini = (x: number, label: string, value: string) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...GREY);
      doc.text(label.toUpperCase(), x, ry);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      const wrapped: string[] = doc.splitTextToSize(value || '—', miniW - 1);
      doc.text(wrapped.slice(0, 2), x, ry + 4.2);
    };
    const rx = ML + halfW + 5;
    mini(rx + 4.5, ll, lv);
    mini(rx + 4.5 + miniW + 1, rl, rv);
    if (i < dcRows.length - 1) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.line(rx + 4.5, y + (i + 1) * 10 + 2.5, rx + halfW - 4.5, y + (i + 1) * 10 + 2.5);
    }
  });
  y += topCardH + 4;

  const ensureSpace = (needed: number) => {
    if (y + needed > 278) {
      doc.addPage();
      y = 15;
    }
  };

  // ---- Item table: navy header, light separators, repeating head ----
  sectionTitle('ITEM DETAILS');
  autoTable(doc, {
    startY: y,
    head: [['S.No', 'Part Name / Description', 'HSN', 'Quantity', 'Unit', 'Price', 'Amount']],
    body: (input.items.length ? input.items : [{ partName: '', hsn: '', qty: '', unit: '', price: '', amount: '' }])
      .map((it, i) => [String(i + 1).padStart(2, '0'), productOnly(it.partName || ''), it.hsn || '', it.qty || '', it.unit || '', it.price || '', it.amount || '']),
    theme: 'grid',
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: TINT },
    styles: { fontSize: 9, cellPadding: 2.6, textColor: INK, lineColor: LINE, lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: 13, halign: 'center' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 19, halign: 'right' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: ML, right: MR },
  });
  y = (doc as any).lastAutoTable?.finalY ?? y + 10;
  y += 4;

  // ---- Signature section (title + boxes stay together) ----
  const sigBoxW = (contentW - 5) / 2;
  const sigBoxH = 42;
  ensureSpace(7 + sigBoxH + 4);
  sectionTitle('SIGNATURES');
  const drawSigBox = (
    x: number, title: string, roleLabel: string, nameLabel: string, nameValue: string,
    sig: string | null | undefined,
  ) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, sigBoxW, sigBoxH, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(title, x + sigBoxW / 2, y + 6, { align: 'center' });
    let drawn = false;
    if (sig) {
      try {
        const w = Math.min(sigBoxW - 24, 58);
        doc.addImage(sig, 'PNG', x + (sigBoxW - w) / 2, y + 9.5, w, w / 4);
        drawn = true;
      } catch { /* blank area below */ }
    }
    if (!drawn) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.25);
      doc.line(x + 14, y + 25, x + sigBoxW - 14, y + 25);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text(roleLabel, x + sigBoxW / 2, y + 30, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(`${nameLabel}: ${nameValue || '__________________'}`, x + sigBoxW / 2, y + 36, { align: 'center' });
  };
  drawSigBox(ML, 'RECEIVED BY CUSTOMER', 'Customer Signature', 'Receiver Name', String(input.receiverName || ''), input.customerSignature);
  drawSigBox(ML + sigBoxW + 5, `FOR ${compName}`, 'Authorized Signatory', 'Authorized Name', String(input.senderName || ''), input.authorizedSignature);
  y += sigBoxH + 6;

  // ---- Subtle footer on every page ----
  const endPage = doc.getNumberOfPages();
  for (let i = startPage; i <= endPage; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(ML, 284, pageWidth - MR, 284);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(compName, ML, 289);
    doc.setFont('helvetica', 'normal');
    const totalDcPages = endPage - startPage + 1;
    const pageNum = i - startPage + 1;
    doc.text(`Page ${pageNum} of ${totalDcPages}`, pageWidth - MR, 289, { align: 'right' });
  }
  return doc;
}

export async function downloadDeliveryChallan(input: DeliveryChallanInput) {
  const doc = await buildDeliveryChallanDocument(input);
  doc.save(`${input.dcNo || 'Delivery_Challan'}.pdf`);
}

/** The challan as a PDF blob URL, for showing inside a popup. The caller revokes it. */
export async function deliveryChallanPreviewUrl(input: DeliveryChallanInput): Promise<string> {
  const doc = await buildDeliveryChallanDocument(input);
  return URL.createObjectURL(doc.output('blob'));
}

export async function viewDeliveryChallan(input: DeliveryChallanInput) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Allow pop-ups to preview the PDF.');
  try {
    const doc = await buildDeliveryChallanDocument(input);
    const url = URL.createObjectURL(doc.output('blob'));
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
}

// -------------------------------------------------------------------------------------
// Sales Invoice print (classic full-detail format): title bar, letterhead,
// party/DC box, item table (SI No / HSN / Description / Qty / Unit / Price /
// Amount), totals with amount-in-words, declaration + bank boxes, signatures,
// computer-generated note, outer page border.
// Numbers arrive raw and are formatted here without a currency symbol (core
// PDF fonts lack the ₹ glyph, which is why the old PDF showed corrupted text).
// -------------------------------------------------------------------------------------

export interface SalesInvoiceItem {
  description: string;
  hsn: string;
  qty: number;
  unit: string;
  price: number;
  amount: number;
}

export interface SalesInvoiceInput {
  companyName: string;
  companyGstin?: string;
  title?: string;
  docNo: string;
  invDate: string | null | undefined;
  partyName: string;
  partyAddress?: string;
  partyCode?: string;
  partyGstin?: string;
  dcNo?: string;
  dcDate?: string | null | undefined;
  poNo?: string;
  items: SalesInvoiceItem[];
  basicValue: number;
  cgstRate?: number | null;
  cgstAmt: number;
  sgstRate?: number | null;
  sgstAmt: number;
  igstRate?: number | null;
  igstAmt: number;
  roundOff: number;
  grandTotal: number;
  bankLines?: string[];
  /** Terms printed on the invoice (the company's default terms from the Terms library). */
  terms?: string;
  /** @deprecated old name for the box text; `terms` wins. */
  declaration?: string;
}

/** Company printables already stored on the companies row (read-only). */
export async function fetchCompanyPrintDetails(companyId: string | null | undefined): Promise<{ gstin: string; bankLines: string[] }> {
  if (!companyId) return { gstin: '', bankLines: [] };
  try {
    const { supabase } = await import('@/lib/supabase');
    const r = await supabase.from('companies').select('gstin,bank_details').eq('id', companyId).limit(1).maybeSingle();
    const row: any = !r.error ? r.data : null;
    return {
      gstin: String(row?.gstin || ''),
      bankLines: String(row?.bank_details || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
    };
  } catch {
    return { gstin: '', bankLines: [] };
  }
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function wordsTwo(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

function wordsThree(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? wordsTwo(r) : '');
}

/** Indian-system number to words: 13865 → "Thirteen Thousand Eight Hundred Sixty Five". */
export function inWordsIndian(n: number): string {
  const v = Math.floor(Math.abs(n) || 0);
  if (!v) return 'Zero';
  const parts: string[] = [];
  let rest = v;
  const cr = Math.floor(rest / 1e7);
  rest %= 1e7;
  const lakh = Math.floor(rest / 1e5);
  rest %= 1e5;
  const th = Math.floor(rest / 1000);
  rest %= 1000;
  if (cr) parts.push(wordsThree(cr) + ' Crore');
  if (lakh) parts.push(wordsTwo(lakh) + ' Lakh');
  if (th) parts.push(wordsTwo(th) + ' Thousand');
  if (rest) parts.push(wordsThree(rest));
  return parts.join(' ');
}

/** "Thirteen Thousand Eight Hundred Sixty Five Rupees Only" (paise appended when present). */
export function amountInWords(total: number): string {
  const t = Number(total) || 0;
  const rupees = Math.floor(t + 1e-9);
  const paise = Math.round((t - rupees) * 100);
  return `${inWordsIndian(rupees)} Rupees${paise ? ' and ' + wordsTwo(paise) + ' Paise' : ''} Only`;
}

async function buildSalesInvoiceDocument(input: SalesInvoiceInput) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const INK: [number, number, number] = [0, 0, 0];
  const GREY: [number, number, number] = [110, 110, 110];
  const SHADING: [number, number, number] = [232, 232, 232];
  const GRID: [number, number, number] = [90, 90, 90];
  const OB = 8;
  const ML = 12;
  const MR = 12;
  const contentW = pageWidth - ML - MR;
  const cx = pageWidth / 2;
  const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const val = (v: string | number | null | undefined) => String(v ?? '').trim() || '—';
  const taxLabel = (name: string, rate: number | null | undefined) =>
    rate != null ? `${name} @ ${rate}%` : name;

  let y = 14;
  // Title bar
  doc.setFillColor(...SHADING);
  doc.rect(ML, y, contentW, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(String(input.title || 'Sales Invoice'), cx, y + 6.5, { align: 'center' });
  y += 13;

  // Letterhead
  try {
    const response = await fetch('/arguscnc-logo.jpg');
    if (response.ok) {
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      doc.addImage(dataUrl, 'JPEG', ML + 2, y, 32, 14);
    }
  } catch { /* printable without the logo */ }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(String(input.companyName || 'ARGUS TECHNOLOGIES').toUpperCase(), cx, y + 6, { align: 'center' });
  y += 11;
  if (String(input.companyGstin || '').trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text(`GSTIN: ${String(input.companyGstin).trim()}`, cx, y, { align: 'center' });
    doc.setTextColor(...INK);
    y += 4;
  }
  y += 7;

  const gridOpts: any = {
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, textColor: INK, lineColor: GRID, lineWidth: 0.3 },
    margin: { left: ML, right: MR },
  };
  const labelCell = (w: number) => ({ fontStyle: 'bold' as const, cellWidth: w });

  // Party / document box
  autoTable(doc, {
    startY: y,
    body: [
      ['Company Name', val(input.partyName), 'Doc. No', val(input.docNo)],
      ['Company Address', val(input.partyAddress), 'DC Number', val(input.dcNo)],
      ['Company Code', val(input.partyCode), 'DC Date', challanDate(input.dcDate)],
      ['Company GSTIN', val(input.partyGstin), 'P.O. Number', val(input.poNo)],
      ['', '', 'Date', challanDate(input.invDate)],
    ],
    columnStyles: { 0: labelCell(26), 1: {}, 2: labelCell(26), 3: {} },
    ...gridOpts,
  });
  y = (doc as any).lastAutoTable?.finalY ?? y + 10;
  y += 3;

  // Item table
  autoTable(doc, {
    startY: y,
    head: [['SI No', 'HSN CODE', 'DESCRIPTION', 'QTY', 'UNIT', 'PRICE', 'AMOUNT']],
    body: (input.items.length ? input.items : [{ description: '', hsn: '', qty: 0, unit: '', price: 0, amount: 0 }])
      .map((it, i) => [String(i + 1), it.hsn || '', productOnly(it.description || ''), it.qty ? fmt(it.qty) : '', it.unit || '', it.price ? fmt(it.price) : '', it.amount ? fmt(it.amount) : '']),
    theme: 'grid',
    headStyles: { fillColor: SHADING, textColor: 0, fontSize: 9, fontStyle: 'bold', halign: 'center', lineColor: GRID, lineWidth: 0.3 },
    styles: { fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: GRID, lineWidth: 0.3 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: ML, right: MR },
  });
  y = (doc as any).lastAutoTable?.finalY ?? y + 10;
  y += 3;

  const ensureSpace = (needed: number) => {
    if (y + needed > 272) {
      doc.addPage();
      y = 14;
    }
  };

  // Totals: amount-in-words left, tax stack right
  const rightW = 96;
  const leftW = contentW - rightW - 3;
  const totalRows: string[][] = [
    ['Total Amount Before Tax', fmt(input.basicValue)],
    [`Add: ${taxLabel('CGST', input.cgstRate)}`, fmt(input.cgstAmt)],
    [`Add: ${taxLabel('SGST', input.sgstRate)}`, fmt(input.sgstAmt)],
    [`Add: ${taxLabel('IGST', input.igstRate)}`, fmt(input.igstAmt)],
    ['Round Off', fmt(input.roundOff)],
    ['Total', fmt(input.grandTotal)],
  ];
  ensureSpace(52);
  autoTable(doc, {
    startY: y,
    body: [[`Rupees (in words):\n${amountInWords(input.grandTotal)}`]],
    tableWidth: leftW,
    margin: { left: ML },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5, textColor: INK, lineColor: GRID, lineWidth: 0.3, fontStyle: 'bold' },
  });
  const leftEnd = (doc as any).lastAutoTable?.finalY ?? y;
  autoTable(doc, {
    startY: y,
    body: totalRows,
    tableWidth: rightW,
    margin: { left: ML + leftW + 3 },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: GRID, lineWidth: 0.3 },
    columnStyles: { 0: {}, 1: { cellWidth: 30, halign: 'right' } },
    didParseCell: (d: any) => {
      if (d.section === 'body' && d.row.index === totalRows.length - 1) d.cell.styles.fontStyle = 'bold';
    },
  });
  y = Math.max(leftEnd, (doc as any).lastAutoTable?.finalY ?? y) + 3;

  // Terms + bank details boxes
  const declTitle = 'Terms';
  const declBody = String(input.terms || input.declaration ||
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.');
  const bankBody = (input.bankLines && input.bankLines.length ? input.bankLines : ['—']).join('\n');
  const declLines: string[] = doc.splitTextToSize(declBody, (contentW - 3) / 2 - 10);
  const bankLines: string[] = doc.splitTextToSize(bankBody, (contentW - 3) / 2 - 10);
  const boxesH = Math.max(30, 12 + Math.max(declLines.length, bankLines.length) * 4.4);
  ensureSpace(boxesH + 4);
  const boxW = (contentW - 3) / 2;
  const drawInfoBox = (x: number, title: string, lines: string[]) => {
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.3);
    doc.rect(x, y, boxW, boxesH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(title, x + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(lines, x + 4, y + 12);
  };
  drawInfoBox(ML, declTitle, declLines);
  drawInfoBox(ML + boxW + 3, 'Bank Details', bankLines);
  y += boxesH + 12;

  // Signatures
  ensureSpace(26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Signature of the Company', ML, y + 12);
  doc.text('Authorised Signature', pageWidth - MR, y + 12, { align: 'right' });
  y += 18;

  // Computer-generated note
  ensureSpace(14);
  doc.setFontSize(8);
  const note = '*** This is a computer-generated Original Document and does not require a physical signature. ***';
  const noteW = doc.getTextWidth(note) + 10;
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.3);
  doc.roundedRect(cx - noteW / 2, y, noteW, 8, 1, 1, 'D');
  doc.text(note, cx, y + 5.5, { align: 'center' });
  y += 12;

  // Outer border + page numbers (only numbered past one page)
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.rect(OB, OB, pageWidth - OB * 2, 281);
    if (pages > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text(`Page ${i} of ${pages}`, pageWidth - MR, 286, { align: 'right' });
    }
  }
  return doc;
}

export async function downloadSalesInvoice(input: SalesInvoiceInput) {
  const doc = await buildSalesInvoiceDocument(input);
  doc.save(`${input.docNo || 'Sales_Invoice'}.pdf`);
}

/** The invoice as a PDF blob URL, for showing inside a popup. The caller revokes it. */
export async function salesInvoicePreviewUrl(input: SalesInvoiceInput): Promise<string> {
  const doc = await buildSalesInvoiceDocument(input);
  return URL.createObjectURL(doc.output('blob'));
}

export async function viewSalesInvoice(input: SalesInvoiceInput) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Allow pop-ups to preview the PDF.');
  try {
    const doc = await buildSalesInvoiceDocument(input);
    const url = URL.createObjectURL(doc.output('blob'));
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
}

/** Combines Sales Invoice and Delivery Challan into a single multi-page PDF */
export async function buildCombinedInvoiceAndDcDocument(invoiceInput: SalesInvoiceInput, dcInput: DeliveryChallanInput) {
  const doc = await buildSalesInvoiceDocument(invoiceInput);
  await buildDeliveryChallanDocument(dcInput, doc);
  return doc;
}

/** The combined invoice and DC as a PDF blob URL, for showing inside a popup. The caller revokes it. */
export async function combinedInvoiceAndDcPreviewUrl(invoiceInput: SalesInvoiceInput, dcInput: DeliveryChallanInput): Promise<string> {
  const doc = await buildCombinedInvoiceAndDcDocument(invoiceInput, dcInput);
  return URL.createObjectURL(doc.output('blob'));
}

export async function downloadCombinedInvoiceAndDc(invoiceInput: SalesInvoiceInput, dcInput: DeliveryChallanInput) {
  const doc = await buildCombinedInvoiceAndDcDocument(invoiceInput, dcInput);
  const safeInv = (invoiceInput.docNo || 'Invoice').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeDc = (dcInput.dcNo || 'DC').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`${safeInv}_with_DC_${safeDc}.pdf`);
}

export async function viewCombinedInvoiceAndDc(invoiceInput: SalesInvoiceInput, dcInput: DeliveryChallanInput) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Allow pop-ups to preview the PDF.');
  try {
    const doc = await buildCombinedInvoiceAndDcDocument(invoiceInput, dcInput);
    const url = URL.createObjectURL(doc.output('blob'));
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
}
