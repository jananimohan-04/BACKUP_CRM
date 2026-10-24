import type { Guide, GuideStep } from './engine';

// Walkthroughs for the Sales Pipeline. Facts (field names, what is saved where) were read from the code, not guessed.
// Texts are [English, Tamil]; a step points at a field by the words on screen.

const quoteSteps = (): GuideStep[] => [
  {
    target: { text: 'Add Client / Company' },
    title: ['Pick the client', 'வாடிக்கையாளரைத் தேர்ந்தெடுங்கள்'],
    say: ['The client table shows who this quotation is for. Use “Select Client” to add one or more companies. Address and GSTIN come from the company you saved in Add Company.', 'இந்த quotation யாருக்கு என்பதை இந்த அட்டவணை காட்டும். “Select Client” மூலம் ஒன்று அல்லது பல நிறுவனங்களைச் சேருங்கள். முகவரி, GSTIN ஆகியவை Add Company-ல் சேமித்ததிலிருந்து வரும்.'],
    why: ['The PDF prints the client name, address and GSTIN at the top.', 'PDF-ன் மேலே வாடிக்கையாளர் பெயர், முகவரி, GSTIN அச்சாகும்.'],
  },
  {
    target: { button: 'Select Client' },
    title: ['Select Client', 'Select Client'],
    say: ['Click here and search the company name. You can tick several companies to send the same quotation to all of them.', 'இங்கே அழுத்தி நிறுவனப் பெயரைத் தேடுங்கள். ஒரே quotation-ஐ பலருக்கு அனுப்ப பல நிறுவனங்களைத் தேர்வு செய்யலாம்.'],
  },
  {
    target: { text: 'Description' },
    title: ['Describe the product', 'பொருளை விவரியுங்கள்'],
    say: ['In each row type or pick the product in Description, then enter Qty, Unit, Unit Price and Discount %. Use “Workings” to build the price from material, process and margin.', 'ஒவ்வொரு வரியிலும் Description-ல் பொருளை எழுதவும் அல்லது தேர்வு செய்யவும். பிறகு Qty, Unit, Unit Price, Discount % கொடுங்கள். “Workings” மூலம் பொருள், செயல்முறை, லாபம் சேர்த்து விலையை உருவாக்கலாம்.'],
    why: ['These lines are the price table on the PDF and they decide the totals.', 'இந்த வரிகளே PDF-ன் விலை அட்டவணை; மொத்தத் தொகையையும் இவையே முடிவு செய்யும்.'],
  },
  {
    target: { button: 'Add Product' },
    title: ['More products', 'மேலும் பொருட்கள்'],
    say: ['“Add Product” adds another row. “From Product Library” fills a row from products you saved before.', '“Add Product” புதிய வரியைச் சேர்க்கும். “From Product Library” முன்பு சேமித்த பொருளை நிரப்பும்.'],
  },
  {
    target: { text: 'Terms & Conditions' },
    title: ['Terms and conditions', 'விதிமுறைகள்'],
    say: ['Payment stages, delivery and validity go here. “Import T&C” loads a saved template.', 'பணம் செலுத்தும் முறை, டெலிவரி, செல்லுபடி காலம் இங்கே. “Import T&C” சேமித்த வார்ப்புருவை ஏற்றும்.'],
    why: ['It is printed at the bottom of the PDF, so the customer sees the same terms you agreed.', 'PDF-ன் கீழே அச்சாகும்; நீங்கள் ஒப்புக்கொண்ட விதிமுறைகளையே வாடிக்கையாளர் பார்ப்பார்.'],
  },
  {
    target: { text: 'TOTAL AMOUNT BEFORE TAX' },
    title: ['Tax and total', 'வரி மற்றும் மொத்தம்'],
    say: ['Set CGST and SGST (or IGST for another state). The total is worked out for you.', 'CGST, SGST (வேறு மாநிலமெனில் IGST) அமையுங்கள். மொத்தம் தானாகக் கணக்கிடப்படும்.'],
  },
  {
    target: { button: 'Save Quote' },
    title: ['Save the quotation', 'Quotation-ஐச் சேமியுங்கள்'],
    say: ['Click “Save Quote” (the PDF, WhatsApp and email buttons also save). It needs at least one product with a quantity and a price.', '“Save Quote” அழுத்துங்கள் (PDF, WhatsApp, email பொத்தான்களும் சேமிக்கும்). ஒரு பொருளுக்கு அளவும் விலையும் அவசியம்.'],
    saves: ['Quotation Library, and when opened from an enquiry card also the QUOTATIONS stage (the enquiry moves from Enquiry to Quotation).', 'Quotation Library; enquiry அட்டையிலிருந்து திறந்திருந்தால் QUOTATIONS நிலையிலும் (enquiry, Enquiry-யிலிருந்து Quotation-க்கு நகரும்).'],
    onSave: { button: 'Save Quote', flyTo: 'Quotations', caption: ['Saved. It is now in QUOTATIONS and in the Quotation Library.', 'சேமிக்கப்பட்டது. இது இப்போது QUOTATIONS-லும் Quotation Library-யிலும் உள்ளது.'], okText: 'saved' },
  },
];

export const SALES_GUIDES: Guide[] = [
  {
    id: 'pipeline-overview',
    title: ['Sales Pipeline tour', 'Sales Pipeline சுற்றுலா'],
    blurb: ['How an order moves from enquiry to invoice', 'Enquiry முதல் Invoice வரை ஒரு ஆர்டர் எப்படி நகரும்'],
    match: { route: '/sales/pipeline' },
    steps: [
      { target: { text: 'Kanban Board' }, title: ['One board for the whole job', 'முழு வேலைக்கும் ஒரே பலகை'], say: ['Every order moves left to right: Enquiry, Quotation, Sales Order, Inward, Finished Goods, Delivery Challan, Invoice. Switch between Kanban Board, List View and Calendar here.', 'ஒவ்வொரு ஆர்டரும் இடமிருந்து வலமாக நகரும்: Enquiry, Quotation, Sales Order, Inward, Finished Goods, Delivery Challan, Invoice. Kanban Board, List View, Calendar இங்கே மாற்றலாம்.'] },
      { target: { button: 'Add Company' }, title: ['Start with the company', 'முதலில் நிறுவனம்'], say: ['Add the customer once here. Later you only pick it from a list.', 'வாடிக்கையாளரை ஒருமுறை இங்கே சேருங்கள். பிறகு பட்டியலில் தேர்ந்தால் போதும்.'], saves: ['Company master (customers). It appears under “All Company Library”.', 'நிறுவனப் பட்டியல் (customers). “All Company Library”-ல் தெரியும்.'] },
      { target: { text: 'New opportunities' }, title: ['Enquiry column', 'Enquiry நெடுவரிசை'], say: ['New customer requests start here. Use “Add Enquiry” in this column.', 'புதிய வாடிக்கையாளர் கோரிக்கைகள் இங்கே தொடங்கும். இந்த நெடுவரிசையில் “Add Enquiry” பயன்படுத்துங்கள்.'] },
      { target: { text: 'Confirmed orders' }, title: ['Sales Order column', 'Sales Order நெடுவரிசை'], say: ['When a customer confirms, drag the quotation card here (or use Move to Next Stage). A sales order is created for you.', 'வாடிக்கையாளர் உறுதி செய்தால் quotation அட்டையை இங்கே இழுக்கவும் (அல்லது Move to Next Stage). Sales order தானாக உருவாகும்.'] },
      { target: { text: 'Billed & Completed' }, title: ['Invoice column', 'Invoice நெடுவரிசை'], say: ['The last stage. Delivered goods are billed here and the order is complete.', 'கடைசி நிலை. டெலிவரி ஆன பொருட்களுக்கு இங்கே பில் போடப்படும்; ஆர்டர் முடிந்தது.'] },
      { target: { text: 'Enquiries' }, title: ['The top tiles', 'மேலே உள்ள கட்டங்கள்'], say: ['Each tile opens the full list for that stage: Enquiries, Quotations, Sales Orders, Inward, Finished Goods, Rejected, Delivery Challans, Invoices and Qty Tracking.', 'ஒவ்வொரு கட்டமும் அந்த நிலையின் முழுப் பட்டியலைத் திறக்கும்: Enquiries, Quotations, Sales Orders, Inward, Finished Goods, Rejected, Delivery Challans, Invoices, Qty Tracking.'] },
    ],
  },
  {
    id: 'add-company',
    title: ['Add a company', 'நிறுவனத்தைச் சேர்'],
    blurb: ['Customer details you enter once', 'ஒருமுறை உள்ளிடும் வாடிக்கையாளர் விவரம்'],
    match: { route: '/sales/pipeline', modal: 'Add Company' },
    steps: [
      { target: { label: 'Company Name' }, title: ['Company name', 'நிறுவனப் பெயர்'], say: ['Type the customer name, or pick an existing one to fill the rest automatically. This is the only required field. A name that already exists is refused.', 'வாடிக்கையாளர் பெயரை எழுதுங்கள்; ஏற்கனவே இருந்தால் தேர்ந்தெடுத்து மற்றவற்றை தானாக நிரப்புங்கள். இது ஒன்றே கட்டாயம். ஏற்கனவே உள்ள பெயர் ஏற்கப்படாது.'], why: ['Every enquiry, quotation, DC and invoice is linked to this name.', 'ஒவ்வொரு enquiry, quotation, DC, invoice-ம் இந்தப் பெயருடன் இணைக்கப்படும்.'], saves: ['Customer master (cnc_customers).', 'Customer master (cnc_customers).'] },
      { target: { label: 'Address' }, title: ['Address', 'முகவரி'], say: ['The billing address. It is printed on quotations, delivery challans and invoices.', 'பில்லிங் முகவரி. Quotation, delivery challan, invoice-ல் அச்சாகும்.'] },
      { target: { label: 'GST No.' }, title: ['GST number', 'GST எண்'], say: ['The customer’s GSTIN, 15 characters.', 'வாடிக்கையாளரின் GSTIN, 15 எழுத்துகள்.'], why: ['Needed on tax invoices and shown on the quotation.', 'வரி invoice-ல் தேவை; quotation-லும் காட்டப்படும்.'] },
      { target: { text: 'Contact Persons' }, title: ['Contact person', 'தொடர்பு நபர்'], say: ['Name, phone and email of who you deal with. “+ Add Contact Person” adds more rows.', 'நீங்கள் தொடர்புகொள்ளும் நபரின் பெயர், தொலைபேசி, மின்னஞ்சல். “+ Add Contact Person” கூடுதல் வரிகளைச் சேர்க்கும்.'], why: ['The phone and email appear on the quotation and are used for WhatsApp and email.', 'தொலைபேசி, மின்னஞ்சல் quotation-ல் வரும்; WhatsApp, email அனுப்பவும் பயன்படும்.'] },
      { target: { label: 'Source' }, title: ['Source', 'மூலம்'], say: ['How this customer came to you: Direct, Website, Referral, Phone, Email or Other.', 'இந்த வாடிக்கையாளர் எப்படி வந்தார்: Direct, Website, Referral, Phone, Email அல்லது Other.'] },
      { target: { button: 'Save Company' }, title: ['Save', 'சேமி'], say: ['Click “Save Company”.', '“Save Company” அழுத்துங்கள்.'], saves: ['Company master. It does not create an enquiry; add that next.', 'Company master. இது enquiry-ஐ உருவாக்காது; அடுத்து அதைச் சேருங்கள்.'], onSave: { button: 'Save Company', flyTo: 'All Company Library', caption: ['Saved in the company list. Find it in “All Company Library”.', 'நிறுவனப் பட்டியலில் சேமிக்கப்பட்டது. “All Company Library”-ல் பாருங்கள்.'] } },
    ],
  },
  {
    id: 'new-enquiry',
    title: ['Add an enquiry', 'Enquiry சேர்'],
    blurb: ['A customer asks for a product', 'வாடிக்கையாளர் ஒரு பொருளைக் கேட்கிறார்'],
    match: { route: '/sales/pipeline', modal: 'New Enquiry' },
    steps: [
      { target: { label: 'Company' }, title: ['Which company asked?', 'எந்த நிறுவனம் கேட்டது?'], say: ['Type or pick the company. If it is new, use “+ Add New Company” first.', 'நிறுவனத்தை எழுதவும் அல்லது தேர்வு செய்யவும். புதியதெனில் முதலில் “+ Add New Company”.'], why: ['The enquiry is filed under this company.', 'Enquiry இந்த நிறுவனத்தின் கீழ் சேமிக்கப்படும்.'] },
      { target: { placeholder: 'Product Name' }, title: ['What do they want?', 'என்ன கேட்கிறார்கள்?'], say: ['Enter the product name. At least one product is needed. “+ Add Product” adds more lines.', 'பொருளின் பெயரை எழுதுங்கள். குறைந்தது ஒரு பொருள் அவசியம். “+ Add Product” மேலும் வரிகளைச் சேர்க்கும்.'], why: ['The same name flows to the quotation and then to the sales order.', 'இதே பெயர் quotation-க்கும் பிறகு sales order-க்கும் செல்லும்.'] },
      { target: { placeholder: 'Qty' }, title: ['Quantity', 'அளவு'], say: ['How many they need. It cannot be negative.', 'எத்தனை தேவை. எதிர்மறையாக இருக்கக்கூடாது.'] },
      { target: { button: 'Upload file' }, title: ['Drawing or file', 'வரைபடம் / கோப்பு'], say: ['Attach the customer drawing for this product. Pick the company first.', 'இந்தப் பொருளுக்கான வரைபடத்தை இணையுங்கள். முதலில் நிறுவனத்தைத் தேர்ந்தெடுக்கவும்.'], saves: ['Stored with the enquiry and shown under Products and Drawings.', 'Enquiry-உடன் சேமிக்கப்படும்; Products and Drawings-ல் தெரியும்.'] },
      { target: { placeholder: 'Remarks' }, title: ['Remarks', 'குறிப்புகள்'], say: ['Anything the team should know: finish, tolerance, deadline.', 'குழு தெரிந்துகொள்ள வேண்டியவை: finish, tolerance, காலக்கெடு.'] },
      { target: { button: 'Save Enquiry' }, title: ['Save the enquiry', 'Enquiry-ஐச் சேமியுங்கள்'], say: ['Click “Save Enquiry”. An enquiry number is created automatically.', '“Save Enquiry” அழுத்துங்கள். Enquiry எண் தானாக உருவாகும்.'], saves: ['Enquiries (status New, stage Enquiry). The card appears in the ENQUIRY column.', 'Enquiries (நிலை New). அட்டை ENQUIRY நெடுவரிசையில் தோன்றும்.'], onSave: { button: 'Save Enquiry', flyTo: 'Enquiries', caption: ['Saved. Your enquiry is now in the ENQUIRY column and in the Enquiries list.', 'சேமிக்கப்பட்டது. உங்கள் enquiry இப்போது ENQUIRY நெடுவரிசையிலும் Enquiries பட்டியலிலும் உள்ளது.'] } },
    ],
  },
  { id: 'create-quotation-popup', title: ['Create a quotation', 'Quotation உருவாக்கு'], blurb: ['Price an enquiry and send it', 'Enquiry-க்கு விலை போட்டு அனுப்பு'], match: { route: '/sales/pipeline', modal: 'Create Quotation' }, steps: quoteSteps() },
  { id: 'create-quotation-page', title: ['Create a quotation', 'Quotation உருவாக்கு'], blurb: ['Price a product and send it', 'பொருளுக்கு விலை போட்டு அனுப்பு'], match: { route: '/quotation/create' }, steps: quoteSteps() },
  {
    id: 'new-sales-order',
    title: ['Add a sales order', 'Sales Order சேர்'],
    blurb: ['A confirmed customer order', 'உறுதி செய்யப்பட்ட ஆர்டர்'],
    match: { route: '/sales/pipeline', modal: 'New Sales Order' },
    steps: [
      { target: { label: 'Company' }, title: ['Customer', 'வாடிக்கையாளர்'], say: ['Pick the customer who placed the order. Required.', 'ஆர்டர் கொடுத்த வாடிக்கையாளரைத் தேர்வு செய்யுங்கள். கட்டாயம்.'] },
      { target: { label: 'Order Date' }, title: ['Order date', 'ஆர்டர் தேதி'], say: ['The day the customer confirmed. Required.', 'வாடிக்கையாளர் உறுதி செய்த நாள். கட்டாயம்.'] },
      { target: { label: 'Delivery Date' }, title: ['Delivery date', 'டெலிவரி தேதி'], say: ['The promised delivery date. It must be after the order date.', 'வாக்களித்த டெலிவரி தேதி. ஆர்டர் தேதிக்குப் பிறகு இருக்க வேண்டும்.'], why: ['Production planning and the calendar use it.', 'உற்பத்தித் திட்டமும் நாட்காட்டியும் இதைப் பயன்படுத்தும்.'] },
      { target: { label: 'PO No' }, title: ['Customer PO', 'வாடிக்கையாளர் PO'], say: ['The customer’s purchase order number, if they gave one.', 'வாடிக்கையாளர் PO எண் இருந்தால் எழுதுங்கள்.'], why: ['It is printed on the delivery challan and the invoice.', 'Delivery challan, invoice-ல் அச்சாகும்.'] },
      { target: { placeholder: 'Product name' }, title: ['Products', 'பொருட்கள்'], say: ['Enter each product with Qty, Unit Price and GST %. At least one product is required. “+ Add Product” adds a row.', 'ஒவ்வொரு பொருளுக்கும் Qty, Unit Price, GST % கொடுங்கள். குறைந்தது ஒரு பொருள் அவசியம். “+ Add Product” புதிய வரி.'], why: ['These lines become the order value and what production will make.', 'இவை ஆர்டர் மதிப்பாகவும் உற்பத்தி செய்ய வேண்டியவையாகவும் மாறும்.'] },
      { target: { button: 'Save Order' }, title: ['Save the order', 'ஆர்டரைச் சேமி'], say: ['Click “Save Order”.', '“Save Order” அழுத்துங்கள்.'], saves: ['Sales Orders (status Confirmed). The card appears in the SALES ORDER column.', 'Sales Orders (நிலை Confirmed). அட்டை SALES ORDER நெடுவரிசையில் தோன்றும்.'], onSave: { button: 'Save Order', flyTo: 'Sales Orders', caption: ['Saved. The order is in SALES ORDER and counted under Qty Tracking.', 'சேமிக்கப்பட்டது. ஆர்டர் SALES ORDER-லும் Qty Tracking-லும் உள்ளது.'] } },
    ],
  },
  {
    id: 'new-inward',
    title: ['Add an inward entry', 'Inward பதிவு'],
    blurb: ['Material or goods received', 'பெறப்பட்ட பொருள்'],
    match: { route: '/sales/pipeline', modal: 'New Inward Entry' },
    steps: [
      { target: { label: 'Category' }, title: ['Choose the category first', 'முதலில் வகையைத் தேர்ந்தெடுங்கள்'], say: ['The category decides what happens next. CUSTOMER DC, NO DC and NEW PART bring the customer’s material and create draft work orders for production. GOODS PURCHASE and SERVICE PURCHASE are bills from a supplier. EXPENSES are company expenses.', 'வகை அடுத்து என்ன நடக்கும் என்பதை முடிவு செய்யும். CUSTOMER DC, NO DC, NEW PART வாடிக்கையாளரின் பொருளைப் பெற்று உற்பத்திக்கு draft work order உருவாக்கும். GOODS PURCHASE, SERVICE PURCHASE சப்ளையர் பில்கள். EXPENSES நிறுவனச் செலவுகள்.'], why: ['Purchases go to the ledger as money you owe; customer material goes to production.', 'கொள்முதல் நீங்கள் செலுத்த வேண்டிய தொகையாக ledger-க்கு செல்லும்; வாடிக்கையாளர் பொருள் உற்பத்திக்கு செல்லும்.'] },
      { target: { label: 'Company' }, title: ['Who sent it?', 'யார் அனுப்பினார்?'], say: ['The customer or the supplier. Required for every category except EXPENSES.', 'வாடிக்கையாளர் அல்லது சப்ளையர். EXPENSES தவிர மற்ற அனைத்திற்கும் கட்டாயம்.'] },
      { target: { label: 'Inward Date' }, title: ['Inward date', 'பெற்ற தேதி'], say: ['The day the goods or the bill arrived.', 'பொருள் அல்லது பில் வந்த நாள்.'] },
      { target: { label: 'Reference No.' }, title: ['Reference number', 'குறிப்பு எண்'], say: ['The supplier’s invoice number or the customer’s DC number.', 'சப்ளையர் invoice எண் அல்லது வாடிக்கையாளர் DC எண்.'] },
      { target: { button: 'Choose Files' }, title: ['Attach the bill or DC', 'பில் / DC இணை'], say: ['Upload a photo or PDF of the bill or DC. Up to 50 MB each.', 'பில் அல்லது DC-ன் படம்/PDF-ஐ ஏற்றுங்கள். ஒவ்வொன்றும் 50 MB வரை.'] },
      { target: { placeholder: 'Part Name' }, title: ['Part, quantity and price', 'பாகம், அளவு, விலை'], say: ['For each line enter Part Name, Qty and Price (all required, above zero), then Disc % and GST % if any. Total is worked out. “Add part” adds a line.', 'ஒவ்வொரு வரிக்கும் Part Name, Qty, Price (கட்டாயம், பூஜ்யத்திற்கு மேல்), தேவைப்பட்டால் Disc %, GST %. Total தானாக வரும். “Add part” புதிய வரி.'], why: ['Purchase lines become the bill amount in the ledger.', 'கொள்முதல் வரிகள் ledger-ல் பில் தொகையாக மாறும்.'] },
      { target: { button: 'Submit' }, title: ['Submit', 'சமர்ப்பி'], say: ['Click “Submit”, or “Save & Add Another Inward” to keep going.', '“Submit” அழுத்துங்கள்; தொடர “Save & Add Another Inward”.'], saves: ['Inward list (one row per line). Customer material also becomes a card in the INWARD column and a draft work order in Production.', 'Inward பட்டியல் (ஒவ்வொரு வரிக்கும் ஒரு பதிவு). வாடிக்கையாளர் பொருள் INWARD நெடுவரிசையில் அட்டையாகவும் Production-ல் draft work order ஆகவும் மாறும்.'], onSave: { button: 'Submit', flyTo: 'Inward', caption: ['Saved. See it under Inward; customer material also went to Production as a draft order.', 'சேமிக்கப்பட்டது. Inward-ல் பாருங்கள்; வாடிக்கையாளர் பொருள் Production-க்கும் draft ஆக சென்றது.'] } },
    ],
  },
];
