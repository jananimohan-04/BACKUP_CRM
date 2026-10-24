import { calcLine, calcTotals, type QuoteLine, type QuoteTaxInput } from './quotationCalc';
import { exportCsv } from './reportExport';
import type { QuoteSeller } from './companyProfile';
import { calcWorkings, hasWorkings, rowCost } from './quotationWorkings';

export interface QuoteClient { key: string; name: string; email: string; phone: string; address: string; gstin: string }

export interface QuoteDoc {
  quoteNo: string;
  date: string; // yyyy-mm-dd
  sellerName: string;
  /** '' = main organisation profile, else the id of a sub-company. */
  sellerRef?: string;
  clients: QuoteClient[];
  lines: QuoteLine[];
  tax: QuoteTaxInput;
  terms: string;
  notes: string;
}

export const PDF_THEMES = {
  orange: { label: 'Orange', rgb: [234, 88, 12] as [number, number, number] },
  blue: { label: 'Blue', rgb: [37, 99, 235] as [number, number, number] },
  slate: { label: 'Slate', rgb: [51, 65, 85] as [number, number, number] },
};
export type PdfThemeId = keyof typeof PDF_THEMES;

// jsPDF's built-in fonts have no rupee glyph.
const inr = (n: number) => 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('-') : '');

export async function buildQuotePdf(doc: QuoteDoc, withWorkings: boolean, themeId: PdfThemeId, seller?: QuoteSeller) {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  const theme = PDF_THEMES[themeId].rgb;
  const W = pdf.internal.pageSize.getWidth();
  const t = calcTotals(doc.lines, doc.tax);

  const sellerName = seller?.name || doc.sellerName;
  // An unreadable image must never stop the PDF being produced.
  // 'center': x / yy are the centre of the box the image sits in.
  const addImage = (data: string, x: number, yy: number, maxW: number, maxH: number, align: 'left' | 'right' | 'center' = 'left') => {
    try {
      const props = pdf.getImageProperties(data);
      const k = Math.min(maxW / props.width, maxH / props.height);
      const w = props.width * k, h = props.height * k;
      pdf.addImage(data, props.fileType, align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, align === 'center' ? yy - h / 2 : yy, w, h);
      return { w, h };
    } catch { return null; }
  };

  pdf.setFillColor(...theme); pdf.rect(0, 0, W, 22, 'F');
  let titleX = 14;
  if (seller?.logo) {
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(10, 3, 30, 16, 1.5, 1.5, 'F');
    if (addImage(seller.logo, 25, 11, 26, 13, 'center')) titleX = 46;   // centred in the white box (x 10-40, y 3-19)
  }
  pdf.setTextColor(255); pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
  pdf.text('QUOTATION', titleX, 14);
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
  pdf.text(sellerName, W - 14, 10, { align: 'right' });
  pdf.text(`No: ${doc.quoteNo}   Date: ${dmy(doc.date)}`, W - 14, 16, { align: 'right' });

  pdf.setTextColor(30); let y = 32;
  let sellerEnd = 0;
  if (seller) {
    const lines = [seller.address, seller.gstin && `GSTIN: ${seller.gstin}`, seller.phones.join(', '), seller.website].filter(Boolean) as string[];
    pdf.setFontSize(8.5); pdf.setTextColor(90);
    let sy = 29;
    for (const l of lines) { const w = pdf.splitTextToSize(l, 80) as string[]; pdf.text(w, W - 14, sy, { align: 'right' }); sy += 4 * w.length; }
    sellerEnd = sy;
    pdf.setFontSize(10); pdf.setTextColor(30);
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('To:', 14, y); y += 5;
  pdf.setFont('helvetica', 'normal');
  for (const c of doc.clients) {
    const lines = [c.name, c.address, [c.phone, c.email].filter(Boolean).join('  |  '), c.gstin && `GSTIN: ${c.gstin}`].filter(Boolean) as string[];
    // The issuing company's details sit in a 80 mm column on the right, so the client text wraps before it instead of running under it.
    for (const l of lines) { const w = pdf.splitTextToSize(l, seller ? W - 28 - 84 : W - 28) as string[]; pdf.text(w, 14, y); y += 4.6 * w.length; }
    y += 2;
  }

  const rows = doc.lines.filter(l => calcLine(l).active).map((l, i) => {
    const r = calcLine(l);
    const base = [String(i + 1), l.hsn, l.description, `${l.qty} ${l.unit}`];
    return withWorkings
      ? [...base, inr(Number(l.unitPrice.replace(/,/g, '')) || 0), l.discount ? `${l.discount}%` : '-', inr(r.discountedUnit), inr(r.amount)]
      : [...base, inr(r.discountedUnit), inr(r.amount)];
  });
  const head = withWorkings
    ? [['Sl', 'HSN/SAC', 'Description', 'Qty', 'Unit Price', 'Disc.', 'Disc. Unit Price', 'Amount']]
    : [['Sl', 'HSN/SAC', 'Description', 'Qty', 'Rate', 'Amount']];
  autoTable(pdf, {
    startY: Math.max(y, sellerEnd) + 2, head, body: rows, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: theme, textColor: 255 },
    columnStyles: withWorkings ? { 4: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } } : { 4: { halign: 'right' }, 5: { halign: 'right' } },
  });

  const totalsRows: string[][] = [['Total before tax', inr(t.subtotal)]];
  if (t.cgst) totalsRows.push([`CGST @ ${doc.tax.cgst}%`, inr(t.cgst)]);
  if (t.sgst) totalsRows.push([`SGST @ ${doc.tax.sgst}%`, inr(t.sgst)]);
  if (t.igst) totalsRows.push([`IGST @ ${doc.tax.igst}%`, inr(t.igst)]);
  if (t.roundOff) totalsRows.push(['Round off', `${t.roundOff > 0 ? '+' : '-'}${inr(Math.abs(t.roundOff))}`]);
  totalsRows.push(['TOTAL AMOUNT', inr(t.total)]);
  autoTable(pdf, {
    // @ts-expect-error lastAutoTable is added by the plugin
    startY: pdf.lastAutoTable.finalY + 4, body: totalsRows, theme: 'plain', styles: { fontSize: 9.5 },
    margin: { left: W - 100 }, columnStyles: { 1: { halign: 'right' } },
    didParseCell: d => { if (d.row.index === totalsRows.length - 1) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [241, 245, 249]; } },
  });

  // @ts-expect-error lastAutoTable is added by the plugin
  let yy = pdf.lastAutoTable.finalY + 8;
  const block = (title: string, body: string) => {
    if (!body.trim()) return;
    const wrapped = pdf.splitTextToSize(body, W - 28) as string[];
    if (yy + 6 + wrapped.length * 4.4 > 285) { pdf.addPage(); yy = 16; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.text(title, 14, yy); yy += 5;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.text(wrapped, 14, yy); yy += wrapped.length * 4.4 + 4;
  };
  if (withWorkings) {
    for (const l of doc.lines.filter(x => calcLine(x).active && hasWorkings(x.workings))) {
      const w = l.workings!; const r = calcWorkings(w);
      const rows: string[][] = [];
      for (const [label, list] of [['Material', w.materials], ['Process', w.processes], ['Other', w.others]] as const) {
        for (const x of list) { const c = rowCost(x); if (!Number.isNaN(c) && c > 0) rows.push([label, x.description || '-', `${x.qty} x ${x.rate}`, inr(c)]); }
      }
      rows.push(['', 'Profit margin', `${w.marginPct || 0}%`, inr(r.profit)], ['', 'Cost of one unit', '', inr(r.total)]);
      // @ts-expect-error lastAutoTable is added by the plugin
      const startY = (yy > pdf.lastAutoTable.finalY ? yy : pdf.lastAutoTable.finalY) + 4;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(30);
      if (startY > 265) { pdf.addPage(); yy = 16; } else yy = startY;
      pdf.text(`Workings: ${l.description}`, 14, yy);
      autoTable(pdf, { startY: yy + 2, head: [['Type', 'Item', 'Qty x Rate', 'Cost']], body: rows, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: theme, textColor: 255 }, columnStyles: { 3: { halign: 'right' } } });
      // @ts-expect-error lastAutoTable is added by the plugin
      yy = pdf.lastAutoTable.finalY + 6;
    }
  }
  block('Terms & Conditions', doc.terms);
  block('Notes', doc.notes);
  if (seller?.bankLines.length) block('Bank & Payment Details', seller.bankLines.join('\n'));
  if (seller) {
    const need = seller.signature ? 34 : 18;
    if (yy + need > 285) { pdf.addPage(); yy = 16; }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(60);
    pdf.text(`For ${sellerName}`, W - 14, yy, { align: 'right' });
    if (seller.signature) addImage(seller.signature, W - 14, yy + 2, 45, 20, 'right');
    pdf.text('Authorised Signatory', W - 14, yy + (seller.signature ? 26 : 14), { align: 'right' });
  }
  return pdf;
}

export async function downloadQuotePdf(doc: QuoteDoc, withWorkings: boolean, themeId: PdfThemeId, seller?: QuoteSeller) {
  (await buildQuotePdf(doc, withWorkings, themeId, seller)).save(`${doc.quoteNo.replace(/[^\w-]+/g, '_')}${withWorkings ? '_workings' : ''}.pdf`);
}

export function exportQuoteCsv(doc: QuoteDoc) {
  const t = calcTotals(doc.lines, doc.tax);
  const rows: unknown[][] = [
    ['Quotation', doc.quoteNo], ['Date', dmy(doc.date)], ['Clients', doc.clients.map(c => c.name).join('; ')], [],
    ['Sl', 'HSN/SAC', 'Description', 'Qty', 'Unit', 'Unit Price', 'Discount %', 'Discounted Unit Price', 'Amount'],
  ];
  doc.lines.filter(l => calcLine(l).active).forEach((l, i) => {
    const r = calcLine(l);
    rows.push([i + 1, l.hsn, l.description, l.qty, l.unit, l.unitPrice, l.discount || 0, r.discountedUnit, r.amount]);
  });
  rows.push([], ['', '', '', '', '', '', '', 'Total before tax', t.subtotal]);
  if (t.cgst) rows.push(['', '', '', '', '', '', '', `CGST ${doc.tax.cgst}%`, t.cgst]);
  if (t.sgst) rows.push(['', '', '', '', '', '', '', `SGST ${doc.tax.sgst}%`, t.sgst]);
  if (t.igst) rows.push(['', '', '', '', '', '', '', `IGST ${doc.tax.igst}%`, t.igst]);
  rows.push(['', '', '', '', '', '', '', 'Round off', t.roundOff], ['', '', '', '', '', '', '', 'TOTAL', t.total]);
  exportCsv(doc.quoteNo.replace(/[^\w-]+/g, '_'), rows);
}

/** Plain-text summary used for WhatsApp and e-mail bodies. */
export function quoteSummaryText(doc: QuoteDoc): string {
  const t = calcTotals(doc.lines, doc.tax);
  const items = doc.lines.filter(l => calcLine(l).active).map((l, i) => `${i + 1}. ${l.description || 'Item'} - ${l.qty} ${l.unit} x ${inr(calcLine(l).discountedUnit)} = ${inr(calcLine(l).amount)}`);
  return [`Quotation ${doc.quoteNo} (${dmy(doc.date)}) from ${doc.sellerName}`, '', ...items, '', `Total before tax: ${inr(t.subtotal)}`, `Total amount: ${inr(t.total)}`].join('\n');
}
