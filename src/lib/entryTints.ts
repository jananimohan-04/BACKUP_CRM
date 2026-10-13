// Tints the inline "New X" entry form with the colour of that module's chip in the top KPI strip,
// so the form reads as belonging to the stage instead of a plain white panel.
//
// Inline entry forms carry no header band - the module colour comes from the panel wash plus the
// accent input borders, which saves a row of vertical space for the single-line field row. The
// body is washed with the 200 shade so it is clearly tinted without hurting the readability of the
// white inputs inside.
//
// `panel` also publishes the module's accent as --entry-border, which compactFields.compactInput
// reads for its border. That keeps every control inside the box on the module's own colour
// without needing a per-field class at each call site.
//
// `head` / `title` / `note` are still used by the popup (Edit / View) dialogs, which keep a header
// band because a floating dialog has no other way to say which module it belongs to.
export interface EntryTint {
  /** Panel: border + body wash + the accent used for input borders inside the form. */
  panel: string;
  /** Header band gradient - popup dialogs only. */
  head: string;
  title: string;
  note: string;
}

export const ENTRY_TINT: Record<string, EntryTint> = {
  Enquiry: {
    panel: 'border-blue-400 bg-blue-200 [--entry-border:theme(colors.blue.400)]',
    head: 'bg-gradient-to-br from-blue-800 to-blue-950 border-b-blue-950',
    title: 'text-white',
    note: 'text-blue-100/85',
  },
  Quotation: {
    panel: 'border-violet-400 bg-violet-200 [--entry-border:theme(colors.violet.400)]',
    head: 'bg-gradient-to-br from-violet-800 to-violet-950 border-b-violet-950',
    title: 'text-white',
    note: 'text-violet-100/85',
  },
  'Sales Order': {
    panel: 'border-emerald-400 bg-emerald-200 [--entry-border:theme(colors.emerald.400)]',
    head: 'bg-gradient-to-br from-emerald-800 to-emerald-950 border-b-emerald-950',
    title: 'text-white',
    note: 'text-emerald-100/85',
  },
  Inward: {
    panel: 'border-amber-400 bg-amber-200 [--entry-border:theme(colors.amber.400)]',
    head: 'bg-gradient-to-br from-amber-700 to-amber-900 border-b-amber-950',
    title: 'text-white',
    note: 'text-amber-100/85',
  },
  'Finished Goods': {
    panel: 'border-teal-400 bg-teal-200 [--entry-border:theme(colors.teal.400)]',
    head: 'bg-gradient-to-br from-teal-800 to-teal-950 border-b-teal-950',
    title: 'text-white',
    note: 'text-teal-100/85',
  },
  Rejected: {
    panel: 'border-rose-400 bg-rose-200 [--entry-border:theme(colors.rose.400)]',
    head: 'bg-gradient-to-br from-rose-800 to-rose-950 border-b-rose-950',
    title: 'text-white',
    note: 'text-rose-100/85',
  },
  DC: {
    panel: 'border-fuchsia-400 bg-fuchsia-200 [--entry-border:theme(colors.fuchsia.400)]',
    head: 'bg-gradient-to-br from-fuchsia-800 to-purple-950 border-b-purple-950',
    title: 'text-white',
    note: 'text-fuchsia-100/85',
  },
  Invoice: {
    panel: 'border-indigo-400 bg-indigo-200 [--entry-border:theme(colors.indigo.400)]',
    head: 'bg-gradient-to-br from-indigo-800 to-indigo-950 border-b-indigo-950',
    title: 'text-white',
    note: 'text-indigo-100/85',
  },
};

/** Convenience for the four inline forms that live in SalesPipelinePage. */
export const tint = (stage: string): EntryTint => ENTRY_TINT[stage] ?? ENTRY_TINT.Enquiry;
