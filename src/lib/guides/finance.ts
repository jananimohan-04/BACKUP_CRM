import type { Guide } from './engine';

// Walkthroughs for invoices, bank, petty cash and the accounts pages. Facts were read from the code.

export const FINANCE_GUIDES: Guide[] = [
  {
    id: 'invoice',
    title: ['Make an invoice', 'Invoice போடு'],
    blurb: ['Bill a delivered order', 'டெலிவரி ஆன ஆர்டருக்கு பில்'],
    match: { route: '/finance/invoices' },
    steps: [
      { target: { label: 'Delivery Challan' }, title: ['Start from the delivery challan', 'Delivery challan-லிருந்து தொடங்குங்கள்'], say: ['Pick the DC number, or type one. Picking it pulls in the customer, the products and the quantities. A DC that is already billed no longer appears.', 'DC எண்ணைத் தேர்ந்தெடுக்கவும் அல்லது எழுதவும். தேர்ந்தால் வாடிக்கையாளர், பொருட்கள், அளவுகள் தானாக வரும். ஏற்கனவே பில் போட்ட DC பட்டியலில் வராது.'], why: ['It links the invoice to what was actually sent.', 'உண்மையில் அனுப்பியதுடன் invoice-ஐ இணைக்கிறது.'] },
      { target: { label: 'Company' }, title: ['Company', 'நிறுவனம்'], say: ['The customer being billed. Required.', 'பில் போடப்படும் வாடிக்கையாளர். கட்டாயம்.'] },
      { target: { label: 'Due Days' }, title: ['Payment terms and due days', 'பணம் செலுத்தும் விதிமுறை, நாட்கள்'], say: ['Due Days is added to the date to give the due date. Choose Payment Terms or enter custom terms.', 'தேதியுடன் Due Days சேர்ந்து செலுத்த வேண்டிய தேதி வரும். Payment Terms தேர்ந்தெடுக்கவும் அல்லது புதியதை எழுதவும்.'], why: ['Overdue invoices are counted from this date.', 'தாமதமான invoice-கள் இந்தத் தேதியிலிருந்து கணக்கிடப்படும்.'] },
      { target: { label: 'Reference' }, title: ['Products on the invoice', 'Invoice-ல் பொருட்கள்'], say: ['Each row is a product. Reference suggests deliveries, sales orders and in-stock parts. Then check Qty, Unit, Rate, GST % and Disc %. Qty above zero and a rate are required.', 'ஒவ்வொரு வரியும் ஒரு பொருள். Reference, deliveries, sales orders, இருப்பிலுள்ள parts ஆகியவற்றைப் பரிந்துரைக்கும். பிறகு Qty, Unit, Rate, GST %, Disc % சரிபார்க்கவும். Qty (பூஜ்யத்திற்கு மேல்), Rate கட்டாயம்.'], why: ['Tax and the total are calculated from these rows.', 'வரியும் மொத்தமும் இந்த வரிகளிலிருந்து கணக்கிடப்படும்.'] },
      { target: { button: 'Save Invoice' }, title: ['Save the invoice', 'Invoice-ஐச் சேமி'], say: ['Click “Save Invoice” (or “Save & Print” for a printout). The invoice number is created if you leave it blank.', '“Save Invoice” அழுத்துங்கள் (அச்சிட “Save & Print”). Invoice எண்ணை விட்டால் தானாக உருவாகும்.'], saves: ['Invoices, and in the books: Debit Trade Receivables, Credit Sales and GST. It shows in this table and in the customer’s ledger.', 'Invoices; கணக்கில்: Trade Receivables டெபிட், Sales மற்றும் GST கிரெடிட். இந்த அட்டவணையிலும் வாடிக்கையாளர் ledger-லும் தெரியும்.'], onSave: { button: 'Save Invoice', flyTo: 'All Invoices', caption: ['Saved. See it in the invoice list and in the customer’s ledger. Record the receipt when the money arrives.', 'சேமிக்கப்பட்டது. Invoice பட்டியலிலும் வாடிக்கையாளர் ledger-லும் பாருங்கள். பணம் வந்ததும் receipt பதிவு செய்யுங்கள்.'], okText: 'saved' } },
    ],
  },
  {
    id: 'bank-manual-entry',
    title: ['Add a bank entry by hand', 'Bank entry கையால்'],
    blurb: ['One money-in or money-out line', 'ஒரு வரவு / செலவு'],
    match: { route: '/finance/bank-entry', modal: 'Manual Entry' },
    steps: [
      { target: { label: 'Date' }, title: ['Date', 'தேதி'], say: ['The day the money moved in the bank.', 'வங்கியில் பணம் நகர்ந்த நாள்.'] },
      { target: { label: 'Debit' }, title: ['Debit or credit', 'Debit அல்லது Credit'], say: ['Debit means money went out of the bank. Credit means money came in. Fill only one of the two.', 'Debit என்றால் வங்கியிலிருந்து பணம் போனது. Credit என்றால் வந்தது. இரண்டில் ஒன்றை மட்டும் நிரப்புங்கள்.'] },
      { target: { label: 'Type' }, title: ['Type and ledger', 'Type, Ledger'], say: ['Say what the money was for. The Ledger is the account on the other side, for example a customer, a supplier or an expense. One of Type or Ledger is required.', 'பணம் எதற்கு என்று சொல்லுங்கள். Ledger என்பது மறுபக்க கணக்கு: வாடிக்கையாளர், சப்ளையர் அல்லது செலவு. Type அல்லது Ledger ஒன்று கட்டாயம்.'], why: ['This decides which ledger and report the entry shows in.', 'எந்த ledger, report-ல் இந்தப் பதிவு தெரியும் என்பதை இது தீர்மானிக்கும்.'] },
      { target: { button: 'Save' }, title: ['Save', 'சேமி'], say: ['Click “Save”.', '“Save” அழுத்துங்கள்.'], saves: ['Bank transactions and the books (Debit/Credit posted to the bank and the ledger). Shows in the table below.', 'Bank transactions மற்றும் கணக்கு (வங்கி, ledger-ல் Debit/Credit பதிவு). கீழே உள்ள அட்டவணையில் தெரியும்.'], onSave: { button: 'Save', flyTo: 'Txn No', caption: ['Saved. It is in the bank table below and in the ledger.', 'சேமிக்கப்பட்டது. கீழே உள்ள bank அட்டவணையிலும் ledger-லும் உள்ளது.'] } },
    ],
  },
  {
    id: 'bank-entry-page',
    title: ['Bank Entry page', 'Bank Entry பக்கம்'],
    blurb: ['Import a statement or add a line', 'Statement இறக்கு அல்லது ஒரு வரி சேர்'],
    match: { route: '/finance/bank-entry' },
    steps: [
      { target: { text: 'Select Bank' }, title: ['Choose the bank first', 'முதலில் வங்கி'], say: ['Select the bank account. Everything on this page posts to it.', 'வங்கிக் கணக்கைத் தேர்ந்தெடுங்கள். இந்தப் பக்கத்தில் உள்ள அனைத்தும் அதில் பதிவாகும்.'] },
      { target: { placeholder: 'Paste rows here' }, title: ['Paste or upload the statement', 'Statement-ஐ ஒட்டவும் / ஏற்றவும்'], say: ['Upload the bank file or paste its rows. Check the preview: every row needs a Type or a Ledger, and rows with errors are not saved.', 'வங்கிக் கோப்பை ஏற்றவும் அல்லது வரிகளை ஒட்டவும். Preview-ஐப் பாருங்கள்: ஒவ்வொரு வரிக்கும் Type அல்லது Ledger வேண்டும்; பிழையுள்ள வரிகள் சேமிக்கப்படாது.'] },
      { target: { button: 'Manual Entry' }, title: ['One line by hand', 'ஒரு வரி கையால்'], say: ['“Manual Entry” adds a single line without a file.', '“Manual Entry” கோப்பு இல்லாமல் ஒரு வரியைச் சேர்க்கும்.'] },
    ],
  },
  {
    id: 'petty-cash',
    title: ['Petty cash entry', 'Petty cash பதிவு'],
    blurb: ['Small cash given or spent', 'கொடுத்த / செலவு செய்த சிறு பணம்'],
    match: { route: '/finance/petty-cash' },
    steps: [
      { target: { label: 'Value date' }, title: ['Value date', 'தேதி'], say: ['The date of the cash movement.', 'பணம் நகர்ந்த தேதி.'] },
      { target: { label: 'Paid to' }, title: ['Paid to', 'யாருக்கு'], say: ['The member or party who received or returned the money. For money given to a member choose the member ledger and select the member here.', 'பணம் பெற்ற அல்லது திருப்பிய உறுப்பினர் / நபர். உறுப்பினருக்கு கொடுத்த பணத்திற்கு member ledger-ஐத் தேர்ந்து இங்கே உறுப்பினரைத் தேர்ந்தெடுங்கள்.'], why: ['It builds each member’s balance: money given less what they spent.', 'ஒவ்வொரு உறுப்பினரின் இருப்பை உருவாக்கும்: கொடுத்த பணம் கழித்து அவர் செலவு செய்தது.'] },
      { target: { label: 'Debit (out)' }, title: ['Amount', 'தொகை'], say: ['Debit is cash going out. Credit is cash coming back in. Enter one, not both.', 'Debit என்பது வெளியே செல்லும் பணம்; Credit என்பது திரும்ப வருவது. ஒன்றை மட்டும் உள்ளிடுங்கள்.'] },
      { target: { label: 'Bank name' }, title: ['Bank or cash account', 'வங்கி / ரொக்கக் கணக்கு'], say: ['Which bank or cash account the money moved through.', 'எந்த வங்கி அல்லது ரொக்கக் கணக்கு வழியாக பணம் நகர்ந்தது.'] },
      { target: { label: 'Ledger name' }, title: ['Ledger', 'Ledger'], say: ['The account on the other side, for example an expense. You must pick one from the list.', 'மறுபக்க கணக்கு, எ.கா. ஒரு செலவு. பட்டியலில் இருந்து ஒன்றைத் தேர்ந்தெடுக்க வேண்டும்.'] },
      { target: { button: 'Save entry' }, title: ['Save', 'சேமி'], say: ['Click “Save entry”. Only administrators can record petty cash.', '“Save entry” அழுத்துங்கள். நிர்வாகிகள் மட்டுமே petty cash பதிவு செய்யலாம்.'], saves: ['Bank transactions and the ledger, shown in “Petty cash details” below.', 'Bank transactions, ledger; கீழே “Petty cash details”-ல் தெரியும்.'], onSave: { button: 'Save entry', flyTo: 'Petty cash details', caption: ['Saved and posted to the ledger. It is in “Petty cash details”.', 'சேமிக்கப்பட்டு ledger-ல் பதிவாகியது. “Petty cash details”-ல் உள்ளது.'], okText: 'entry saved' } },
    ],
  },
  {
    id: 'opening-balances',
    title: ['Opening balances', 'தொடக்க இருப்புகள்'],
    blurb: ['Enter what you had when you started', 'தொடங்கும்போது இருந்தவற்றை உள்ளிடு'],
    match: { route: '/accounts/opening-balances' },
    steps: [
      { target: { text: 'Bank Opening Balances' }, title: ['Three kinds of opening entries', 'மூன்று வகை தொடக்க பதிவுகள்'], say: ['Bank balances, what customers owe and what you owe suppliers, and stock in the warehouse. Enter each as a draft, then post.', 'வங்கி இருப்பு, வாடிக்கையாளர் தர வேண்டியது, சப்ளையருக்கு நீங்கள் தர வேண்டியது, கிடங்கில் உள்ள stock. ஒவ்வொன்றையும் draft ஆக உள்ளிட்டு பிறகு post செய்யுங்கள்.'], why: ['Every ledger, bank balance and stock report starts from these figures.', 'ஒவ்வொரு ledger, வங்கி இருப்பு, stock அறிக்கையும் இந்த எண்களிலிருந்தே தொடங்கும்.'] },
      { target: { button: 'Add Bank Balance' }, title: ['Add an entry', 'பதிவைச் சேர்'], say: ['The button changes with the tab. Pick the account or the customer or supplier, the date and the amount. One entry per account, party or product.', 'Tab-க்கு ஏற்ப பொத்தான் மாறும். கணக்கு அல்லது வாடிக்கையாளர்/சப்ளையர், தேதி, தொகையைத் தேர்ந்தெடுங்கள். ஒரு கணக்கு, நபர், பொருளுக்கு ஒரு பதிவு.'], saves: ['Saved as a draft. It counts in the books only after you post it.', 'Draft ஆக சேமிக்கப்படும். Post செய்த பிறகே கணக்கில் சேரும்.'] },
      { target: { button: 'Validate, Preview & Post' }, title: ['Check, then post', 'சரிபார்த்து post செய்'], say: ['Tick the drafts, then click here. You see the exact debit and credit lines first. Posted entries cannot be edited; reverse them if something is wrong.', 'Draft-களை டிக் செய்து இங்கே அழுத்துங்கள். முதலில் துல்லியமான debit, credit வரிகள் தெரியும். Post செய்தவை திருத்த முடியாது; தவறெனில் reverse செய்யுங்கள்.'], saves: ['Journal entries and stock movements. Customer and supplier balances appear in the ledger against their names.', 'Journal entries, stock movements. வாடிக்கையாளர், சப்ளையர் இருப்பு ledger-ல் அவர்கள் பெயருக்கு எதிரே தெரியும்.'] },
    ],
  },
  {
    id: 'record-receipt',
    title: ['Record a receipt', 'Receipt பதிவு'],
    blurb: ['Money received against an invoice', 'Invoice-க்கு வந்த பணம்'],
    match: { route: '/finance/invoices', modal: 'Record Company Receipt' },
    steps: [
      { target: { label: 'Bank / Cash Account' }, title: ['Where did the money go?', 'பணம் எங்கே சென்றது?'], say: ['Choose the bank or cash account that received it.', 'பணம் பெற்ற வங்கி அல்லது ரொக்கக் கணக்கைத் தேர்ந்தெடுங்கள்.'] },
      { target: { label: 'Amount' }, title: ['Amount', 'தொகை'], say: ['It starts at the balance due. Enter less for a part payment.', 'நிலுவைத் தொகையில் தொடங்கும். பகுதி செலுத்தலுக்கு குறைவாக உள்ளிடுங்கள்.'], why: ['The invoice moves to Partially Paid or Paid.', 'Invoice, Partially Paid அல்லது Paid ஆக மாறும்.'] },
      { target: { button: 'Record Receipt' }, title: ['Save', 'சேமி'], say: ['Click “Record Receipt”.', '“Record Receipt” அழுத்துங்கள்.'], saves: ['Bank transactions and the ledger: Debit the bank, Credit the customer. The invoice balance goes down.', 'Bank transactions, ledger: வங்கி டெபிட், வாடிக்கையாளர் கிரெடிட். Invoice நிலுவை குறையும்.'], onSave: { button: 'Record Receipt', flyTo: 'Received', caption: ['Saved. The invoice’s Received and Balance have updated.', 'சேமிக்கப்பட்டது. Invoice-ன் Received, Balance புதுப்பிக்கப்பட்டது.'] } },
    ],
  },
];
