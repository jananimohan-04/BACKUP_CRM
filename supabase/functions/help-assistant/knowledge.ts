// The help assistant's knowledge: short notes about how each part of the ERP works, in English and Tamil. The assistant
// answers ONLY from these notes (plus the name of the page the person is on), and says "not sure" when the answer is not
// here. To teach it something new, add or edit a note and redeploy the function:  supabase functions deploy help-assistant
//
// Each note: id, title, `pages` (route prefixes where it is the first thing offered), `keywords` (English words, Tamil
// words and Tanglish spellings people actually type or say), and `body` (English steps, then Tamil).
// NOTE: written from the screens as built; have a team member who uses the ERP daily review the Tamil wording.

export interface Note { id: string; title: string; pages: string[]; keywords: string[]; body: string }

export const NOTES: Note[] = [
  {
    id: 'overview', title: 'The whole process, start to finish', pages: ['/dashboard'],
    keywords: ['process', 'flow', 'start', 'overview', 'how', 'steps', 'order', 'முழு', 'செயல்முறை', 'eppadi', 'muraii', 'process enna', 'flow enna', 'ellam'],
    body: `EN: The order goes through these stages, shown as tiles at the top of Sales Pipeline:
1. Enquiries - a customer asks for a price.
2. Quotations - we send the price. The quoted price becomes the "planned price" in Project Costing.
3. Sales Orders - the customer confirms: product, quantity, delivery date.
4. Inward - material and parts that come in (from the customer, or bought by us).
5. Production - each part is planned and made (Production, Scheduling and the Actual runs).
6. Finished Goods - the parts are combined into the finished product, costed and moved here.
7. Rejected - pieces that failed.
8. Delivery Challan (DC) - the goods are sent out.
9. Invoices - the bill is made from the DC.
10. Qty Track - shows ordered, finished, delivered and invoiced quantities for each order.
TA: ஆர்டர் இந்த நிலைகள் வழியாகச் செல்கிறது (Sales Pipeline மேலே உள்ள டைல்கள்): Enquiry (விலை கேட்பு) → Quotation (விலைப்புள்ளி) → Sales Order (ஆர்டர் உறுதி) → Inward (உள்வரும் பொருள்/பாகங்கள்) → Production (உற்பத்தி) → Finished Goods (முடிந்த பொருள்) → Rejected (நிராகரிப்பு) → Delivery Challan (அனுப்புதல்) → Invoice (பில்) → Qty Track (அளவு கண்காணிப்பு).`,
  },
  {
    id: 'pipeline', title: 'Sales Pipeline screen', pages: ['/sales/pipeline', '/sales'],
    keywords: ['pipeline', 'tile', 'tiles', 'card', 'cards', 'board', 'stage', 'sales pipeline', 'kanban', 'டைல்', 'sales', 'enquiry', 'enquiries', 'inquiry'],
    body: `EN: Sales Pipeline is the main working page. The coloured tiles at the top are the stages (Enquiries, Quotations, Sales Orders, Inward, Finished Goods, Rejected, Delivery Challan, Invoices, Qty Track); the number on each tile is how many records are in it. Click a tile to open that stage. Each record is a card; use the eye icon to view, the pencil to edit and the bin to delete. The search box above the list finds records.
TA: Sales Pipeline தான் முக்கிய வேலைப் பக்கம். மேலே உள்ள வண்ண டைல்கள் நிலைகள்; டைலில் உள்ள எண் அந்த நிலையில் எத்தனை பதிவுகள் என்பதைக் காட்டும். டைலை கிளிக் செய்தால் அந்த நிலை திறக்கும். கண் குறியீடு = பார்க்க, பென்சில் = திருத்த, குப்பைத் தொட்டி = நீக்க.`,
  },
  {
    id: 'quotation', title: 'Quotation', pages: ['/quotation'],
    keywords: ['quotation', 'quote', 'price', 'unit price', 'export', 'pdf', 'excel', 'terms', 'விலைப்புள்ளி', 'quotation podurathu', 'quote create'],
    body: `EN: Create a quotation from the Quotations tile (Create Quotation). Add each product with quantity and UNIT PRICE. If the export or download buttons do nothing, a row has no unit price - enter it for every row. The popup can be dragged, minimised or maximised. The price you quote becomes the planned price in Project Costing, so enter it carefully. Terms & Conditions come from the Terms library (Quotation > Terms Library); the default terms are printed.
TA: Quotations டைலில் Create Quotation மூலம் உருவாக்கவும். ஒவ்வொரு பொருளுக்கும் Qty மற்றும் Unit Price கொடுக்கவும். Export/Download பட்டன்கள் வேலை செய்யவில்லை என்றால் ஏதாவது ஒரு வரியில் Unit Price இல்லை என்று அர்த்தம். இங்கு கொடுக்கும் விலை Project Costing-ல் "planned price" ஆகும்.`,
  },
  {
    id: 'sales-order', title: 'Sales Order', pages: ['/sales/orders'],
    keywords: ['sales order', 'order', 'so', 'po', 'customer po', 'delivery date', 'ஆர்டர்', 'order podurathu'],
    body: `EN: A Sales Order is the customer's confirmed order: company, product(s), quantity, price, delivery date and the customer's PO number. Open the Sales Orders tile to add one or open one from an accepted quotation. Sales order numbers look like SO-2026-1234. The ordered quantity here is what Production, Finished Goods, Delivery and Invoices are checked against.
TA: Sales Order என்பது வாடிக்கையாளர் உறுதிசெய்த ஆர்டர்: நிறுவனம், பொருள், அளவு, விலை, டெலிவரி தேதி, PO எண். இங்குள்ள அளவுக்கு எதிராகத்தான் Production, Finished Goods, Delivery, Invoice சரிபார்க்கப்படும்.`,
  },
  {
    id: 'inward', title: 'Inward (material and parts coming in)', pages: ['/sales/inward'],
    keywords: ['inward', 'inwards', 'category', 'goods purchase', 'service purchase', 'customer dc', 'new part', 'no dc', 'expenses', 'part name', 'petty cash', 'paid by', 'company', 'reference', 'add another', 'உள்வரவு', 'inward podurathu', 'purchase'],
    body: `EN: Use Inward when material or parts come in. Pick the CATEGORY first:
- CUSTOMER DC: material the customer sent with a delivery challan.
- NO DC: customer material that came without a challan.
- NEW PART: a new part for a new project.
(These three flow on to Production as parts to make.)
- GOODS PURCHASE: parts or material we bought. The Part Name is typed by hand.
- SERVICE PURCHASE: outside service we bought (for example heat treatment).
- EXPENSES: a company expense (product, part and company are optional).
COMPANY means "from whom" it came. Pick the product from the dropdown (Product - Company - date time - Qty), then type the part name, quantity and price. "+ Add part" adds another line. "Petty cash" is for something a team member paid from their own pocket: tick it, choose who paid in "Paid by", and enter "Amount paid" (leave empty if the full amount). "Save & Add Another Inward" saves and keeps the form open; "Submit" saves and closes it.
TA: பொருள்/பாகங்கள் உள்ளே வரும்போது Inward பயன்படுத்தவும். முதலில் CATEGORY தேர்வு: CUSTOMER DC (வாடிக்கையாளர் DC உடன் அனுப்பிய பொருள்), NO DC (DC இல்லாமல் வந்தது), NEW PART (புதிய திட்டத்தின் பாகம்) - இவை Production-க்குச் செல்லும். GOODS PURCHASE (நாம் வாங்கிய பொருள், Part Name கையால் எழுத வேண்டும்), SERVICE PURCHASE (வெளிச் சேவை), EXPENSES (செலவு). COMPANY = யாரிடமிருந்து வந்தது. Petty cash = குழு உறுப்பினர் தன் பணத்தில் கொடுத்தது; "Paid by" தேர்வு செய்யவும்.`,
  },
  {
    id: 'production', title: 'Production orders and parts', pages: ['/production/planning', '/production'],
    keywords: ['production', 'part', 'parts', 'product', 'ordered', 'remaining', 'work order', 'planning', 'உற்பத்தி', 'production podurathu', 'part order'],
    body: `EN: A product is made of parts. In Production, a production order is made for one PART of a product: choose the Product, then the Part. Each part shows "Ordered N - Remaining R": ordered is what came in on the inward, remaining is what no production order has taken yet. You cannot plan more than the remaining. Only CUSTOMER DC, NEW PART and NO DC inwards give parts to make. The Work Orders list shows part, company, quantities and progress; use the "All" dropdown in a column heading to filter. Work-order numbers are not shown on screen.
TA: ஒரு பொருள் பல பாகங்களால் ஆனது. Production-ல் ஒரு பாகத்துக்கு (Part) ஆர்டர் உருவாக்கப்படும்: முதலில் Product, பிறகு Part தேர்வு. "Ordered N - Remaining R": வந்த அளவு மற்றும் இன்னும் திட்டமிடாத அளவு. Remaining-ஐ விட அதிகமாகத் திட்டமிட முடியாது.`,
  },
  {
    id: 'scheduling', title: 'Scheduling and actual runs', pages: ['/production/scheduling'],
    keywords: ['scheduling', 'schedule', 'planned', 'actual', 'timeline', 'run', 'runs', 'add runs', 'operator', 'process', 'machine', 'job board', 'time', 'duplicate', 'plus', '+', 'finished qty', 'planned qty', 'திட்டம்', 'schedule podurathu'],
    body: `EN: Scheduling has tabs: Planned Timeline, Actual Timeline, Comparison, Job Board, Actual (List View) and Planned (List View).
- Planned = what we intend; Actual = what really ran.
- Press "+ Add runs" (Actual) or "Add plan" (Planned) to enter lines: Part name, Finished qty (Planned qty for plans), Process, Operator, Date, Start, End. Press the orange "+" at the end of a line to add the next line: same part, quantity, process and operator, starting when the line above ends and lasting as long (09:00-10:00 becomes 10:00-11:00). Then "Save N runs".
- Actual runs cannot end in the future. The finished quantity of each actual run is added to that part's finished total.
- You can also drag on the calendar to start a line at that time.
TA: Scheduling-ல் Planned Timeline (திட்டம்), Actual Timeline (உண்மையில் நடந்தது), Comparison, Job Board, List View டேப்கள் உள்ளன. "+ Add runs" அல்லது "Add plan" அழுத்தி வரிகளை நிரப்பவும்: Part, Finished qty, Process, Operator, Date, Start, End. வரியின் இறுதியில் உள்ள ஆரஞ்சு "+" அடுத்த வரியை சேர்க்கும் (அதே பாகம்/அளவு, முந்தைய வரி முடிந்த நேரத்தில் தொடங்கி அதே நீளம்; 9:00-10:00 → 10:00-11:00). பிறகு Save.`,
  },
  {
    id: 'finished-goods', title: 'Finished Goods and costing', pages: ['/production/finished-goods'],
    keywords: ['finished goods', 'finished', 'fg', 'costing', 'approve', 'move', 'warehouse', 'combine', 'parts combined', 'product', 'qty', 'முடிந்த', 'finished goods podurathu', 'cost'],
    body: `EN: Finished Goods is where the parts are combined into the finished product. Open the Finished Goods tile (or an inward card) to get the popup: choose the Product (Product - Company - date time - Qty), enter the finished Qty, and pick the warehouse (the default is shown, change it if needed). The popup lists the parts combined into the product (goods purchase, service purchase and new part inwards) with their amounts. Check the quotation and costing on the page, then press "Approve & Move to Finished Goods". If you delete a Finished Goods card, the order comes back one box earlier only.
TA: Finished Goods-ல் பாகங்கள் சேர்ந்து முடிந்த பொருளாகும். Product தேர்வு செய்து, முடிந்த Qty கொடுத்து, Warehouse தேர்வு (default காட்டப்படும்). பொருளில் சேர்ந்த பாகங்களின் பட்டியலும் தொகையும் காட்டப்படும். சரிபார்த்து "Approve & Move to Finished Goods" அழுத்தவும்.`,
  },
  {
    id: 'dc', title: 'Delivery Challan (DC)', pages: ['/operations/delivery', '/operations/challan'],
    keywords: ['dc', 'delivery challan', 'challan', 'delivery', 'category', 'process', 'dc process', 'vehicle', 'eway', 'e-way', 'party', 'supply', 'packaging', 'notes', 'send', 'அனுப்பு', 'dc podurathu', 'challan podurathu'],
    body: `EN: Create a Delivery Challan from the Delivery Challan tile. Fill the DC number, date, company (address, GSTIN, code and phone fill in), E-Way Bill, PO No, place of supply, packaging, vehicle number, then the CATEGORY (After Process, Cancelled, Rejected, Returnable, REWORK, SEND FOR SERVICE, Sold, Stock, Without Process) and the DC PROCESS (Anodizing, Heat Treatment, Polishing and so on). Both are dropdowns; press "+" to add a new one. The DC process list is separate from the machine processes in Process Master. Tick the products to send, enter quantity (not more than the available finished goods) and save. A DC number can only be used once.
TA: Delivery Challan டைலில் இருந்து DC உருவாக்கவும். DC எண், தேதி, நிறுவனம், E-Way Bill, PO எண், வாகன எண் ஆகியவற்றை நிரப்பி CATEGORY மற்றும் DC PROCESS தேர்வு செய்யவும் (புதியது வேண்டுமெனில் "+" அழுத்தவும்). DC Process என்பது Process Master-ன் இயந்திர process-இலிருந்து வேறு. அனுப்பும் பொருட்களைத் தேர்வு செய்து அளவு கொடுத்து Save.`,
  },
  {
    id: 'invoice', title: 'Invoice', pages: ['/finance/invoices'],
    keywords: ['invoice', 'bill', 'tax invoice', 'print', 'pdf', 'download', 'gst', 'cgst', 'sgst', 'igst', 'round off', 'terms', 'total', 'பில்', 'invoice podurathu', 'bill podurathu'],
    body: `EN: Invoices are made from a delivery challan (or entered in Finance > Invoices). The invoice shows items, the basic value, CGST/SGST/IGST, round off and the TOTAL, with Terms and Bank Details at the bottom. "Download" saves the PDF; "Print" opens the print box for the same PDF. The terms printed come from the Terms library default. The quantity invoiced is checked against what was delivered.
TA: Invoice, Delivery Challan-லிருந்து உருவாக்கப்படும். பொருட்கள், அடிப்படை மதிப்பு, CGST/SGST/IGST, Round off, TOTAL, கீழே Terms மற்றும் Bank Details இருக்கும். Download = PDF சேமிக்க; Print = அதே PDF-ஐ அச்சிட.`,
  },
  {
    id: 'rejected', title: 'Rejected pieces', pages: ['/sales/rejected'],
    keywords: ['rejected', 'rejection', 'reject', 'rework', 'defect', 'நிராகரிப்பு', 'reject podurathu'],
    body: `EN: Rejected shows pieces that failed. Record the quantity rejected against the product; rejected pieces never count as finished goods and cannot be delivered or invoiced. Rework can be sent out again through a DC with the category REWORK.
TA: Rejected-ல் தோல்வியடைந்த பொருட்கள் பதிவாகும். இவை Finished Goods-ஆக கணக்கில் வராது; Delivery/Invoice செய்ய முடியாது. மறுவேலை தேவையெனில் DC-ல் category REWORK தேர்வு.`,
  },
  {
    id: 'qty-track', title: 'Qty Track', pages: ['/reports/quantity-tracking', '/reports'],
    keywords: ['qty', 'quantity', 'track', 'tracking', 'ordered', 'finished', 'delivered', 'invoiced', 'balance', 'அளவு', 'qty track'],
    body: `EN: Qty Track shows, for every sales order, the ordered quantity, what is finished, delivered and invoiced, and the balance. Use it to see what is still pending. Part production is not counted as finished product here.
TA: Qty Track ஒவ்வொரு ஆர்டருக்கும் ordered, finished, delivered, invoiced அளவுகள் மற்றும் மீதியைக் காட்டும். பாகங்களின் உற்பத்தி இங்கு முடிந்த பொருளாகக் கணக்கில் வராது.`,
  },
  {
    id: 'petty-cash', title: 'Petty cash', pages: ['/finance/petty-cash'],
    keywords: ['petty cash', 'petty', 'cash', 'paid to', 'paid by', 'member', 'debit', 'credit', 'ledger', 'payable to members', 'total balance', 'money in', 'money out', 'சில்லறை', 'petty cash enna'],
    body: `EN: Petty Cash Entry records small cash payments. Fill: value date, description, PAID TO (a member - pick from the dropdown or "+ Add new member"), Debit (money out) or Credit (money in), bank/cash account and the ledger. For money given to or returned by a team member use the ledger "Payable to Members" - the Paid to member is then required. The table below lists every entry with its company, who paid, debit, credit and ledger; use the "All" dropdowns in the headings to filter. The top bar shows Money In, Money Out and the Total Balance (green = in, red = out). Entries marked Petty cash on an Inward also appear here.
TA: Petty Cash Entry சிறிய பண செலவுகளைப் பதிவு செய்யும். தேதி, விவரம், PAID TO (உறுப்பினர்), Debit (வெளியே) அல்லது Credit (உள்ளே), வங்கி/Cash கணக்கு, Ledger ஆகியவற்றை நிரப்பவும். உறுப்பினருக்குக் கொடுத்த/திருப்பிப் பெற்ற பணத்துக்கு ledger "Payable to Members". மேலே Money In, Money Out, Total Balance தெரியும் (பச்சை = உள்ளே, சிவப்பு = வெளியே).`,
  },
  {
    id: 'finance-accounts', title: 'Bank entry, ledger and accounts', pages: ['/finance/bank-entry', '/accounts'],
    keywords: ['bank', 'bank entry', 'ledger', 'trial balance', 'profit', 'loss', 'balance sheet', 'accounts', 'account', 'receipt', 'payment', 'வங்கி', 'bank entry podurathu'],
    body: `EN: Bank Entry records money received or paid through a bank or cash account. Ledger shows the account-wise transactions; Trial Balance checks debits equal credits; Profit & Loss and Balance Sheet are the statements. Invoices, purchases, petty cash and expenses post to the ledger automatically. Only administrators can record bank entries.
TA: Bank Entry வங்கி/Cash வழியாக வந்த/சென்ற பணத்தைப் பதிவு செய்யும். Ledger கணக்குவாரியான பரிவர்த்தனைகள்; Trial Balance debit = credit சரிபார்க்கும்; Profit & Loss, Balance Sheet அறிக்கைகள். Invoice, Purchase, Petty cash தானாக ledger-ல் பதிவாகும்.`,
  },
  {
    id: 'inventory', title: 'Inventory and warehouses', pages: ['/inventory', '/purchasing'],
    keywords: ['inventory', 'stock', 'warehouse', 'transfer', 'adjust', 'raw material', 'purchase', 'purchase order', 'grn', 'item', 'location', 'இருப்பு', 'stock enna'],
    body: `EN: Inventory lists raw materials, bought-out items, tools, consumables and finished goods with stock, value and reorder level. Use Stock Adjustment to correct a count and Stock Transfer to move stock between warehouses. Warehouses are made in Warehouse Master (one is the default). Purchase handles purchase orders and goods receipts.
TA: Inventory-ல் மூலப்பொருள், வாங்கிய பொருட்கள், கருவிகள், முடிந்த பொருட்கள் ஆகியவற்றின் இருப்பு, மதிப்பு, reorder level இருக்கும். Stock Adjustment = எண்ணிக்கை திருத்த; Stock Transfer = Warehouse-களுக்கிடையே மாற்ற. Warehouse Master-ல் Warehouse உருவாக்கலாம் (ஒன்று default).`,
  },
  {
    id: 'tips', title: 'Shortcuts, voice and apps', pages: [],
    keywords: ['esc', 'escape', 'back', 'voice', 'mic', 'microphone', 'speak', 'tamil', 'filter', 'all', 'dropdown', 'search', 'app', 'apk', 'android', 'desktop', 'install', 'download', 'tips', 'shortcut', 'login', 'google', 'sign in'],
    body: `EN: Esc takes you back to the page you used before (it first closes any open popup, and leaves a typing box). The orange mic button (bottom left) turns on voice entry: say a field name and its value ("company Aabee", "quantity 50"), or "save". Columns in tables have an "All" dropdown in the heading to filter. A text box with a list shows the whole list when you click it. Sign in with your Google account that the administrator added. The ERP can be installed as a Windows app or an Android app; the Android app needs internet.
TA: Esc அழுத்தினால் முந்தைய பக்கத்துக்குச் செல்லும் (திறந்த popup இருந்தால் முதலில் அதை மூடும்). கீழே இடதுபுற ஆரஞ்சு மைக் = குரல் மூலம் நிரப்ப ("company Aabee", "quantity 50", "save"). அட்டவணைத் தலைப்பில் உள்ள "All" dropdown மூலம் வடிகட்டலாம்.`,
  },
  {
    id: 'access', title: 'Users, roles and access', pages: ['/admin/users', '/admin/access', '/admin/settings'],
    keywords: ['user', 'users', 'role', 'access', 'permission', 'admin', 'add user', 'login', 'cannot see', 'no access', 'settings', 'company', 'பயனர்', 'access illai'],
    body: `EN: Administrators add users in User Management and choose what each person may see or do in Access Management (view, create, edit, delete, export). If a menu or button is missing for someone, it is because their access does not include it - ask an administrator. Company details (name, GST, bank) are in Settings.
TA: User Management-ல் நிர்வாகி பயனர்களைச் சேர்ப்பார்; Access Management-ல் ஒவ்வொருவரும் எதைப் பார்க்கலாம்/செய்யலாம் என்பதைத் தேர்வு செய்வார். ஒருவருக்கு மெனு அல்லது பட்டன் தெரியவில்லை என்றால் அவருக்கு அந்த அணுகல் இல்லை - நிர்வாகியிடம் கேளுங்கள்.`,
  },
];

/** Notes ranked for one question: the page's own notes first, then by how many question words match. */
export function pickNotes(question: string, page: string, limit = 4): Note[] {
  const words = question.toLowerCase().replace(/[^\p{L}\p{N}+\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
  const scored = NOTES.map((n) => {
    let s = n.pages.some((p) => page === p || page.startsWith(p + '/')) ? 2 : 0;
    const hay = `${n.title} ${n.keywords.join(' ')}`.toLowerCase();
    for (const w of words) if (hay.includes(w)) s += 1;
    return { n, s };
  }).sort((a, b) => b.s - a.s);
  const top = scored.filter((x) => x.s > 0).slice(0, limit).map((x) => x.n);
  // Always give the overview so the model can place the answer in the whole process.
  if (!top.some((n) => n.id === 'overview')) top.push(NOTES[0]);
  return top;
}
