import type { Guide } from './engine';

// Walkthroughs for inventory, purchasing, quotation tools and administration. Facts were read from the code.

export const SUPPLY_GUIDES: Guide[] = [
  {
    id: 'add-product-inventory',
    title: ['Add an inventory item', 'Inventory பொருளைச் சேர்'],
    blurb: ['A material or part you stock', 'நீங்கள் இருப்பில் வைக்கும் பொருள்'],
    match: { route: '/inventory/stock', modal: 'Add Product' },
    steps: [
      { target: { label: 'Product Code' }, title: ['Code and name', 'குறியீடும் பெயரும்'], say: ['A unique code and a name. Both are required.', 'தனித்துவமான குறியீடும் பெயரும். இரண்டும் கட்டாயம்.'] },
      { target: { label: 'Category' }, title: ['Category decides the kind', 'Category வகையை முடிவு செய்யும்'], say: ['A PURCHASED category makes it a bought raw item. A MANUFACTURED category makes it a part you make.', 'PURCHASED category வாங்கும் மூலப்பொருளாக்கும். MANUFACTURED category நீங்கள் தயாரிக்கும் பாகமாக்கும்.'] },
      { target: { label: 'Min Stock' }, title: ['Min stock and reorder', 'Min stock, Reorder'], say: ['Below Min Stock the item appears in Low Stock Alerts. Reorder Qty is the usual order size.', 'Min Stock-க்குக் கீழே சென்றால் Low Stock Alerts-ல் வரும். Reorder Qty வழக்கமான ஆர்டர் அளவு.'] },
      { target: { label: 'Rate' }, title: ['Rate', 'விலை'], say: ['Value per unit. It prices stock in the accounts and in costing. Changing it later revalues the stock.', 'ஒரு அலகின் மதிப்பு. கணக்கிலும் costing-லும் stock-ஐ மதிப்பிடும். பின்னர் மாற்றினால் stock மதிப்பு மாறும்.'] },
      { target: { label: 'Opening Qty' }, title: ['Opening quantity', 'தொடக்க அளவு'], say: ['Stock you already hold. If above zero an Opening Date is needed. Stock is never typed directly afterwards; use Adjust Stock or a goods receipt.', 'ஏற்கனவே உள்ள stock. பூஜ்யத்திற்கு மேல் எனில் Opening Date தேவை. பின்னர் stock-ஐ நேரடியாக மாற்ற முடியாது; Adjust Stock அல்லது goods receipt பயன்படுத்துங்கள்.'], saves: ['Inventory, and the stock ledger (stock movements).', 'Inventory, stock ledger (stock movements).'] },
      { target: { button: 'Save' }, title: ['Save', 'சேமி'], say: ['Click “Save”.', '“Save” அழுத்துங்கள்.'], onSave: { button: 'Save', flyTo: 'Stock Overview', caption: ['Saved. It is in Inventory > Stock Overview and its history is in Stock Movements.', 'சேமிக்கப்பட்டது. Inventory > Stock Overview-ல் உள்ளது; வரலாறு Stock Movements-ல்.'] } },
    ],
  },
  {
    id: 'adjust-stock',
    title: ['Adjust stock', 'Stock சரிசெய்'],
    blurb: ['Fix a count difference', 'எண்ணிக்கை வேறுபாட்டைச் சரி செய்'],
    match: { route: '/inventory/stock', modal: 'Adjust Stock' },
    steps: [
      { target: { text: 'Increase' }, title: ['Increase or decrease', 'கூட்டு / குறை'], say: ['Increase adds stock; Decrease removes it. You cannot remove more than you hold.', 'Increase stock-ஐக் கூட்டும்; Decrease குறைக்கும். இருப்பதை விட அதிகம் குறைக்க முடியாது.'] },
      { target: { label: 'Reason' }, title: ['Reason', 'காரணம்'], say: ['A reason is required, for example “physical count difference”.', 'காரணம் கட்டாயம், எ.கா. “physical count difference”.'], why: ['Every change is kept in the stock ledger with who did it and why.', 'ஒவ்வொரு மாற்றமும் யார், ஏன் என்பதுடன் stock ledger-ல் இருக்கும்.'] },
      { target: { button: 'Save Adjustment' }, title: ['Save', 'சேமி'], say: ['Click “Save Adjustment”.', '“Save Adjustment” அழுத்துங்கள்.'], saves: ['Stock movements (Adjustment) and the accounts.', 'Stock movements (Adjustment), கணக்கு.'], onSave: { button: 'Save Adjustment', flyTo: 'Stock Overview', caption: ['Saved in the stock ledger. The new stock shows in Stock Overview.', 'Stock ledger-ல் சேமிக்கப்பட்டது. புதிய stock, Stock Overview-ல் தெரியும்.'] } },
    ],
  },
  {
    id: 'new-supplier',
    title: ['Add a supplier', 'சப்ளையரைச் சேர்'],
    blurb: ['Who you buy from', 'நீங்கள் யாரிடம் வாங்குகிறீர்கள்'],
    match: { route: '/purchasing/suppliers', modal: 'New Supplier' },
    steps: [
      { target: { label: 'Supplier Code' }, title: ['Code and name', 'குறியீடும் பெயரும்'], say: ['Supplier Code and Supplier Name are required.', 'Supplier Code, Supplier Name கட்டாயம்.'] },
      { target: { label: 'GST Number' }, title: ['GST and payment terms', 'GST, பணம் செலுத்தும் விதிமுறை'], say: ['GST Number and PAN, and the Payment Terms (default Net 30).', 'GST Number, PAN, Payment Terms (default Net 30).'], why: ['Used on purchase orders and when you owe the supplier.', 'Purchase order-லும் சப்ளையருக்கு தர வேண்டியதைக் கணக்கிடவும் பயன்படும்.'] },
      { target: { button: 'Save' }, title: ['Save', 'சேமி'], say: ['Click “Save”.', '“Save” அழுத்துங்கள்.'], saves: ['Suppliers. You can now pick it on purchase orders and bank entries.', 'Suppliers. இனி purchase order, bank entry-ல் தேர்ந்தெடுக்கலாம்.'] },
    ],
  },
  {
    id: 'new-purchase-order',
    title: ['Raise a purchase order', 'Purchase order போடு'],
    blurb: ['Order material from a supplier', 'சப்ளையரிடம் பொருள் ஆர்டர்'],
    match: { route: '/purchasing/orders', modal: 'New Purchase Order' },
    steps: [
      { target: { label: 'Supplier' }, title: ['Supplier', 'சப்ளையர்'], say: ['Choose the supplier. Required.', 'சப்ளையரைத் தேர்ந்தெடுங்கள். கட்டாயம்.'] },
      { target: { label: 'Expected Delivery Date' }, title: ['Expected delivery', 'எதிர்பார்க்கும் டெலிவரி'], say: ['When you expect the material.', 'பொருள் வரும் என எதிர்பார்க்கும் தேதி.'] },
      { target: { button: 'Add Product' }, title: ['Lines', 'வரிகள்'], say: ['Add each material with Qty, Unit Price and Tax %.', 'ஒவ்வொரு பொருளுக்கும் Qty, Unit Price, Tax %.'] },
      { target: { button: 'Issue PO' }, title: ['Issue the PO', 'PO-வை வெளியிடு'], say: ['“Save Draft” keeps it for later. “Issue PO” sends it. When the goods arrive, record a Goods Receipt and post it to inventory.', '“Save Draft” பின்னர் வைத்துக்கொள்ளும். “Issue PO” வெளியிடும். பொருள் வந்ததும் Goods Receipt பதிந்து inventory-க்கு post செய்யுங்கள்.'], saves: ['Purchase orders. Stock and the supplier’s payable change only when the goods receipt is posted.', 'Purchase orders. Goods receipt post செய்யும்போதே stock, சப்ளையர் செலுத்த வேண்டியது மாறும்.'] },
    ],
  },
  {
    id: 'new-goods-receipt',
    title: ['Receive goods (GRN)', 'பொருள் பெறுதல் (GRN)'],
    blurb: ['Book material that arrived', 'வந்த பொருளைப் பதிவு செய்'],
    match: { route: '/purchasing/goods-receipt', modal: 'New Goods Receipt' },
    steps: [
      { target: { label: 'Purchase Order' }, title: ['Pick the purchase order', 'Purchase order-ஐத் தேர்ந்தெடு'], say: ['Choosing the PO loads its pending lines.', 'PO-வைத் தேர்ந்தால் அதன் நிலுவை வரிகள் வரும்.'] },
      { target: { label: 'Destination Warehouse' }, title: ['Warehouse', 'Warehouse'], say: ['Where the goods will be kept. Required.', 'பொருள் வைக்கப்படும் இடம். கட்டாயம்.'] },
      { target: { text: 'Received Now' }, title: ['What actually arrived', 'உண்மையில் வந்தது'], say: ['Enter the quantity received now for each line.', 'ஒவ்வொரு வரிக்கும் இப்போது பெற்ற அளவை உள்ளிடுங்கள்.'] },
      { target: { button: 'Save Draft' }, title: ['Save, then post', 'சேமி, பிறகு post'], say: ['Save Draft does not change stock yet. Open the receipt and click “Post to Inventory”. Then stock goes up and the supplier’s payable is booked.', 'Save Draft இன்னும் stock-ஐ மாற்றாது. Receipt-ஐத் திறந்து “Post to Inventory” அழுத்துங்கள். பிறகு stock கூடும்; சப்ளையர் செலுத்த வேண்டியது பதிவாகும்.'], saves: ['Goods receipts. After posting: stock movements, the PO status and the accounts.', 'Goods receipts. Post பிறகு: stock movements, PO நிலை, கணக்கு.'] },
    ],
  },
  {
    id: 'create-user',
    title: ['Add a user', 'பயனரைச் சேர்'],
    blurb: ['Give someone a login', 'ஒருவருக்கு login கொடு'],
    match: { route: '/admin/users', modal: 'Create User' },
    steps: [
      { target: { label: 'Gmail' }, title: ['Their Google email', 'அவர்களின் Google மின்னஞ்சல்'], say: ['Enter the exact Gmail the person will use. They sign in with “Continue with Google”; there are no passwords.', 'அவர் பயன்படுத்தும் சரியான Gmail-ஐ உள்ளிடுங்கள். அவர் “Continue with Google” மூலம் நுழைவார்; கடவுச்சொல் இல்லை.'] },
      { target: { label: 'Role' }, title: ['Role', 'பங்கு'], say: ['Company Admin manages the company’s users and has every module. User only gets the modules you grant in Access Management.', 'Company Admin நிறுவனத்தின் பயனர்களை நிர்வகிப்பார்; அனைத்து module-களும் உண்டு. User-க்கு Access Management-ல் நீங்கள் தரும் module-கள் மட்டுமே.'], why: ['New users see nothing until you grant them modules.', 'Module வழங்கும் வரை புதிய பயனருக்கு எதுவும் தெரியாது.'] },
      { target: { button: 'Create User' }, title: ['Create', 'உருவாக்கு'], say: ['Click “Create User”. Then open Access Management to choose what they can see and do.', '“Create User” அழுத்துங்கள். பிறகு Access Management-ல் அவர் பார்க்கவும் செய்யவும் வேண்டியவற்றைத் தேர்ந்தெடுங்கள்.'], saves: ['Users of the company.', 'நிறுவனத்தின் பயனர்கள்.'] },
    ],
  },
  {
    id: 'company-profile',
    title: ['Company profile for quotations', 'Quotation-க்கான நிறுவன விவரம்'],
    blurb: ['Address, phone and bank on the PDF', 'PDF-ல் முகவரி, தொலைபேசி, வங்கி'],
    match: { route: '/quotation/company-profile' },
    steps: [
      { target: { text: 'Organisation Logo' }, title: ['Logo and signature', 'Logo, கையொப்பம்'], say: ['The logo is printed in the PDF header. A signature or stamp is optional.', 'Logo PDF-ன் மேலே அச்சாகும். கையொப்பம் அல்லது முத்திரை விருப்பம்.'] },
      { target: { label: 'Organisation Name' }, title: ['Name, GSTIN, address', 'பெயர், GSTIN, முகவரி'], say: ['Your company name, GSTIN and address appear at the top right of every quotation.', 'நிறுவனப் பெயர், GSTIN, முகவரி ஒவ்வொரு quotation-ன் மேல் வலப்பக்கம் அச்சாகும்.'] },
      { target: { label: 'Branch' }, title: ['Bank details', 'வங்கி விவரம்'], say: ['Bank name, account number, branch, IFSC and UPI (a name@bank or a mobile number). They print at the bottom of the quotation.', 'வங்கிப் பெயர், கணக்கு எண், branch, IFSC, UPI (name@bank அல்லது மொபைல் எண்). Quotation-ன் கீழே அச்சாகும்.'] },
      { target: { button: 'Save Organisation Settings' }, title: ['Save', 'சேமி'], say: ['Click “Save Organisation Settings”.', '“Save Organisation Settings” அழுத்துங்கள்.'], saves: ['Shared with everyone in your company (needs the company-profile migration), and used on every quotation PDF.', 'உங்கள் நிறுவனத்தில் அனைவருடனும் பகிரப்படும் (company-profile migration தேவை); ஒவ்வொரு quotation PDF-லும் பயன்படும்.'] },
    ],
  },
];
