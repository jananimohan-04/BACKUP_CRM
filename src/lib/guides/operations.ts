import type { Guide } from './engine';

// Walkthroughs for dispatch, production and finished goods. Facts were read from the code.

export const OPERATIONS_GUIDES: Guide[] = [
  {
    id: 'new-delivery-challan',
    title: ['Make a delivery challan (DC)', 'Delivery Challan (DC) உருவாக்கு'],
    blurb: ['Send finished goods to the customer', 'முடிந்த பொருளை வாடிக்கையாளருக்கு அனுப்பு'],
    match: { route: '/sales/pipeline', modal: 'New Delivery Challan' },
    steps: [
      { target: { label: 'DC No' }, title: ['DC number', 'DC எண்'], say: ['A number is suggested. It must be unique; a repeat is refused.', 'எண் பரிந்துரைக்கப்படும். தனித்துவமாக இருக்க வேண்டும்; மீண்டும் வந்தால் ஏற்கப்படாது.'], why: ['The invoice later links to this DC number.', 'பின்னர் invoice இந்த DC எண்ணுடன் இணையும்.'] },
      { target: { label: 'Company' }, title: ['Company', 'நிறுவனம்'], say: ['Pick the customer. Address, GSTIN, phone, PO number and process are filled in for you.', 'வாடிக்கையாளரைத் தேர்ந்தெடுங்கள். முகவரி, GSTIN, தொலைபேசி, PO எண், process தானாக நிரம்பும்.'] },
      { target: { label: 'Category' }, title: ['Category', 'வகை'], say: ['Why the goods are leaving: After Process, Returnable, Rejected, Sold, Stock and so on. Use “+” to add your own.', 'பொருள் ஏன் செல்கிறது: After Process, Returnable, Rejected, Sold, Stock போன்றவை. “+” மூலம் புதியதைச் சேர்க்கலாம்.'] },
      { target: { label: 'Process' }, title: ['Process', 'Process'], say: ['The outside or service process the goods are sent for, such as Anodizing or Heat Treatment. This is not the Process Master list.', 'பொருள் அனுப்பப்படும் வெளிச் செயல்முறை, எ.கா. Anodizing, Heat Treatment. இது Process Master பட்டியல் அல்ல.'] },
      { target: { label: 'Vehicle No' }, title: ['Vehicle and e-way bill', 'வாகனம் மற்றும் e-way bill'], say: ['Vehicle number and e-way bill number, if you have them. They print on the DC.', 'வாகன எண், e-way bill எண் இருந்தால் கொடுங்கள். DC-ல் அச்சாகும்.'] },
      { target: { text: 'Qty' }, title: ['Products and quantity', 'பொருட்களும் அளவும்'], say: ['Tick each product to send and enter Qty. It cannot be more than the finished stock available. “+ Add Part” adds a row.', 'அனுப்ப வேண்டிய ஒவ்வொரு பொருளையும் டிக் செய்து Qty கொடுங்கள். கிடைக்கும் finished stock-ஐ விட அதிகம் கூடாது. “+ Add Part” புதிய வரி.'], why: ['Delivered quantity reduces finished goods and updates the sales order.', 'அனுப்பிய அளவு finished goods-ஐக் குறைத்து sales order-ஐப் புதுப்பிக்கும்.'] },
      { target: { button: 'Save' }, title: ['Save', 'சேமி'], say: ['Click “Save” (or “Save & Print” to print the DC).', '“Save” அழுத்துங்கள் (DC அச்சிட “Save & Print”).'], saves: ['Deliveries (status Pending). It appears in the DELIVERY CHALLAN column, the Delivery Challans list, Operations > Delivery and Qty Tracking.', 'Deliveries (நிலை Pending). DELIVERY CHALLAN நெடுவரிசை, Delivery Challans பட்டியல், Operations > Delivery, Qty Tracking-ல் தெரியும்.'], onSave: { button: 'Save', flyTo: 'Delivery Challans', caption: ['Saved. The DC is in the DELIVERY CHALLAN stage. Next: make the invoice from it.', 'சேமிக்கப்பட்டது. DC இப்போது DELIVERY CHALLAN நிலையில் உள்ளது. அடுத்து: இதிலிருந்து invoice போடுங்கள்.'] } },
    ],
  },
  {
    id: 'finished-goods-costing',
    title: ['Move to Finished Goods with costing', 'Costing உடன் Finished Goods-க்கு நகர்த்து'],
    blurb: ['Why project cost is 0 and how to fill it', 'Project cost ஏன் 0, எப்படி நிரப்புவது'],
    match: { route: '/sales/pipeline', modal: 'Finished Goods + Costing' },
    steps: [
      { target: { text: 'Section 1' }, title: ['Which product, how many, where', 'எந்தப் பொருள், எவ்வளவு, எங்கே'], say: ['Tick the product that is finished, choose its warehouse (the default is starred), and enter the good quantity finished. The cost below scales with this quantity.', 'முடிந்த பொருளை டிக் செய்து, warehouse-ஐத் தேர்ந்தெடுங்கள் (default நட்சத்திரக் குறியுடன்), முடிந்த நல்ல அளவைக் கொடுங்கள். கீழே உள்ள செலவு இந்த அளவுக்கு ஏற்ப மாறும்.'], why: ['Only good quantity becomes finished goods stock.', 'நல்ல அளவு மட்டுமே finished goods stock ஆகும்.'] },
      { target: { text: 'Project Costing' }, title: ['Where project cost comes from', 'Project cost எங்கிருந்து வருகிறது'], say: ['Material cost comes from the product’s BOM priced with inventory rates, or from linked goods-purchase inwards. Process cost comes from the job cards already run, or from the product’s active Part Routing priced with Process Master rates. If a product has none of these, project cost stays 0. Use “Add material to costing” and “Add operation to costing” to type the cost in by hand.', 'Material செலவு: பொருளின் BOM-ஐ inventory விலையுடன் அல்லது இணைந்த goods-purchase inward-ஐ வைத்து வரும். Process செலவு: ஏற்கனவே ஓடிய job card-களிலிருந்து, அல்லது பொருளின் active Part Routing-ஐ Process Master விலையுடன் வைத்து வரும். இவை எதுவும் இல்லையெனில் project cost 0. “Add material to costing”, “Add operation to costing” மூலம் கையால் உள்ளிடலாம்.'] },
      { target: { text: 'Final Price' }, title: ['Final price', 'இறுதி விலை'], say: ['The approved final price is what the invoice uses. It starts from the quotation without GST; change it if you agreed another rate.', 'ஒப்புதல் பெற்ற இறுதி விலையையே invoice பயன்படுத்தும். GST இல்லாத quotation விலையிலிருந்து தொடங்கும்; வேறு விலை ஒப்புக்கொண்டிருந்தால் மாற்றுங்கள்.'] },
      { target: { button: 'Save Draft' }, title: ['Save Draft', 'Save Draft'], say: ['Keeps this costing as a version without moving the card.', 'அட்டையை நகர்த்தாமல் இந்த costing-ஐ ஒரு பதிப்பாகச் சேமிக்கும்.'] },
      { target: { button: 'Approve & Move to Finished Goods' }, title: ['Approve and move', 'ஒப்புதல் அளித்து நகர்த்து'], say: ['This saves the approved costing and creates the finished goods. If the order is only partly finished, the inward card stays open for the next batch.', 'ஒப்புதல் பெற்ற costing-ஐச் சேமித்து finished goods-ஐ உருவாக்கும். ஆர்டர் பகுதியளவு முடிந்திருந்தால் அடுத்த batch-க்காக inward அட்டை திறந்தே இருக்கும்.'], saves: ['Costing sheet, finished goods batch and the FINISHED GOODS column.', 'Costing sheet, finished goods batch, FINISHED GOODS நெடுவரிசை.'], onSave: { button: 'Approve & Move to Finished Goods', flyTo: 'Finished Goods', caption: ['Done. The product is in FINISHED GOODS, ready for a delivery challan.', 'முடிந்தது. பொருள் FINISHED GOODS-ல் உள்ளது; delivery challan-க்கு தயார்.'] } },
    ],
  },
  {
    id: 'add-planned-operations',
    title: ['Plan operations', 'Operations-ஐத் திட்டமிடு'],
    blurb: ['Put planned work on the timeline', 'திட்டமிட்ட வேலையை timeline-ல் இடு'],
    match: { route: '/production/scheduling', modal: 'Add planned operations' },
    steps: [
      { target: { text: 'Part name' }, title: ['Part and quantity', 'பாகமும் அளவும்'], say: ['Choose the part and the planned quantity. Both are required.', 'பாகத்தையும் திட்டமிட்ட அளவையும் தேர்ந்தெடுங்கள். இரண்டும் கட்டாயம்.'] },
      { target: { text: 'Process' }, title: ['Process and operator', 'Process, operator'], say: ['Choose the process; the machine type comes from it. Operator is optional.', 'Process-ஐத் தேர்ந்தெடுங்கள்; machine வகை அதிலிருந்து வரும். Operator விருப்பம்.'] },
      { target: { text: 'Date' }, title: ['Date and time', 'தேதி, நேரம்'], say: ['Set the date, start and end. End must be after start. The “+” button adds the next line starting when this one ends.', 'தேதி, தொடக்கம், முடிவு கொடுங்கள். முடிவு தொடக்கத்திற்குப் பிறகு. “+” அடுத்த வரியை இது முடியும் நேரத்தில் தொடங்கச் சேர்க்கும்.'] },
      { target: { button: 'Save' }, title: ['Save the plan', 'திட்டத்தைச் சேமி'], say: ['Click “Save”.', '“Save” அழுத்துங்கள்.'], saves: ['Operation plans. They show in Planned Timeline, Planned List View and Comparison. A work order is created if none is open for the part.', 'Operation plans. Planned Timeline, Planned List View, Comparison-ல் தெரியும். பாகத்திற்கு திறந்த work order இல்லையெனில் ஒன்று உருவாகும்.'], onSave: { button: 'Save', flyTo: 'Planned Timeline', caption: ['Saved on the Planned Timeline.', 'Planned Timeline-ல் சேமிக்கப்பட்டது.'] } },
    ],
  },
  {
    id: 'add-actual-runs',
    title: ['Record work done', 'முடிந்த வேலையைப் பதிவு செய்'],
    blurb: ['Enter what the machines actually ran', 'இயந்திரங்கள் உண்மையில் ஓடியதைப் பதிவு செய்'],
    match: { route: '/production/scheduling', modal: 'Add actual runs' },
    steps: [
      { target: { text: 'Part name' }, title: ['Part and finished quantity', 'பாகமும் முடிந்த அளவும்'], say: ['The part and how many good pieces were finished in this run.', 'பாகமும் இந்த ஓட்டத்தில் முடிந்த நல்ல எண்ணிக்கையும்.'] },
      { target: { text: 'Start' }, title: ['Date and time', 'தேதி, நேரம்'], say: ['When the run happened. It cannot end in the future; plan ahead on the Planned Timeline instead.', 'ஓட்டம் நடந்த நேரம். எதிர்காலத்தில் முடியக்கூடாது; முன்கூட்டியே திட்டமிட Planned Timeline பயன்படுத்துங்கள்.'] },
      { target: { button: 'Save' }, title: ['Save the runs', 'ஓட்டங்களைச் சேமி'], say: ['Click “Save”.', '“Save” அழுத்துங்கள்.'], saves: ['Job cards (Completed). The work order’s completed quantity goes up and it becomes Completed when the target is reached. Shows in Actual Timeline, Job Card, WIP and Completed.', 'Job cards (Completed). Work order-ன் completed அளவு கூடும்; இலக்கு எட்டினால் Completed ஆகும். Actual Timeline, Job Card, WIP, Completed-ல் தெரியும்.'], onSave: { button: 'Save', flyTo: 'Actual Timeline', caption: ['Saved on the Actual Timeline and in the work order’s progress.', 'Actual Timeline-லும் work order முன்னேற்றத்திலும் சேமிக்கப்பட்டது.'] } },
    ],
  },
  {
    id: 'rejected-page',
    title: ['Record a rejection', 'Rejection பதிவு'],
    blurb: ['Pieces that failed quality', 'தரத்தில் தோற்ற பொருட்கள்'],
    match: { route: '/sales/pipeline', modal: 'Rejected' },
    steps: [
      { target: { label: 'Product' }, title: ['Product', 'பொருள்'], say: ['Choose the company, then the order, then the product that was rejected.', 'நிறுவனம், பிறகு ஆர்டர், பிறகு நிராகரிக்கப்பட்ட பொருளைத் தேர்ந்தெடுங்கள்.'] },
      { target: { label: 'Rejected Qty' }, title: ['Rejected quantity', 'நிராகரித்த அளவு'], say: ['How many pieces failed. It must be above zero.', 'எத்தனை பொருட்கள் தோற்றன. பூஜ்யத்திற்கு மேல்.'], why: ['Rejected pieces never become finished stock, delivery or invoice quantity.', 'நிராகரித்தவை finished stock, delivery, invoice அளவாக மாறாது.'] },
      { target: { label: 'Type' }, title: ['Type and reason', 'வகையும் காரணமும்'], say: ['Pick the type, such as Dimensional Failure or Surface Defect, and write the reason.', 'வகையைத் தேர்ந்தெடுக்கவும் (Dimensional Failure, Surface Defect போன்றவை), காரணத்தை எழுதவும்.'], saves: ['Production batches. Shown in the Rejected list and in Qty Tracking > Rejection Breakdown.', 'Production batches. Rejected பட்டியலிலும் Qty Tracking > Rejection Breakdown-லும் தெரியும்.'] },
    ],
  },
];
