/**
 * Utilities for formatting Work Order and Production Order options in select dropdowns.
 * Ensures consistent display across all pages in the project:
 *   WO No — Product Name (Company Name) — Date & Time · Qty: X
 */

/**
 * Formats a Date object or timestamp into standard display: "DD-MM-YYYY hh:mm A"
 * e.g., "15-10-2026 11:28 AM"
 */
export function formatWoDateTime(isoOrDate: unknown): string {
  if (!isoOrDate) return '';
  const d = new Date(String(isoOrDate));
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 becomes 12
  const hh = pad(hours);
  return `${dd}-${mm}-${yyyy} ${hh}:${minutes} ${ampm}`;
}

/**
 * Parses a work order object and returns clean components:
 * - basePart: Product name without trailing timestamp
 * - customer: Company / customer name
 * - dateTime: Extracted or formatted created_at / order_date
 * - qty: Quantity string
 * - woNo: Work order number
 */
export function parseWorkOrderDetails(wo: any) {
  const rawPart = String(wo?.part_name || wo?.partName || wo?.product_name || wo?.productName || '').trim();

  // Check if date-time is already embedded in part_name:
  // e.g. "PRESSURE RING - 15-10-2026 11:28 AM" or "PRESSURE RING - 21-10-2026 10:28"
  const dtRegex = /\s*-\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?|\d{1,2}[A-Za-z]{3}\d{2,4}[-,]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*$/i;
  const match = dtRegex.exec(rawPart);

  let basePart = rawPart;
  let dateTime = '';

  if (match) {
    dateTime = match[1].trim();
    basePart = rawPart.replace(match[0], '').trim();
  }

  if (!dateTime) {
    const rawDate = wo?.created_at || wo?.createdAt || wo?.order_date || wo?.orderDate || wo?.start_date;
    dateTime = formatWoDateTime(rawDate);
  }

  const customer = String(wo?.customer || wo?.customer_name || wo?.party_name || wo?.company || '').trim();
  const woNo = String(wo?.wo_no || wo?.woNo || wo?.work_order || '').trim();
  const qty = wo?.quantity ?? wo?.qty ?? '';

  return {
    basePart: basePart || 'Product',
    customer,
    dateTime,
    qty: qty !== '' ? String(qty) : '',
    woNo,
  };
}

/**
 * Standard display label for Work Orders in select dropdowns:
 * Shows Product Name + Company Name + Date & Time + Qty (with WO No prefix).
 * e.g.: "WO-2026-3762 — PRESSURE RING (MUKIL ENGINEERING) — 15-10-2026 11:28 AM · Qty: 157"
 */
export function formatWorkOrderOption(wo: any): string {
  if (!wo) return '';
  const { basePart, customer, dateTime, qty, woNo } = parseWorkOrderDetails(wo);

  // A part order reads "Part – Product", with how many were ordered and how many are still remaining:
  //   WO-2026-3762 — Gear Housing – Pressure Ring (MUKIL) — 15-10-2026 11:28 AM · Qty: 157 · Remaining: 57
  if (wo.is_part_order === true) {
    const product = String(wo.product_name ?? '').trim();
    const total = Number(wo.quantity) || 0;
    const left = Math.max(0, total - (Number(wo.completed) || 0));
    const head = `${basePart}${product ? ` – ${product}` : ''}`;
    return `${head}${customer ? ` (${customer})` : ''}${dateTime ? ` — ${dateTime}` : ''} · Qty: ${total} · Remaining: ${left}`;
  }

  const prefix = ''; // the work order number is not shown; the product / part says which order it is
  const custPart = customer ? ` (${customer})` : '';
  const dtPart = dateTime ? ` — ${dateTime}` : '';
  const qtyPart = qty ? ` · Qty: ${qty}` : '';

  return `${prefix}${basePart}${custPart}${dtPart}${qtyPart}`;
}

/** What to call a production order on screen (its number is not shown): the part – product, or the product. */
export function workOrderTitle(wo: any): string {
  if (!wo) return '';
  const name = String(wo.part_name ?? wo.partName ?? '').trim();
  const product = String(wo.product_name ?? '').trim();
  if (wo.is_part_order === true && product) return `${name} – ${product}`;
  return name || 'Production order';
}
