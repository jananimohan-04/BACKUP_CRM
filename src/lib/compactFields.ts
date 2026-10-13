// Shared compact field styling for the pipeline entry forms, so every "New X" box lines up
// on the same one- or two-line layout instead of stacking a label above each input.

// Shorter variant of inputClass so the entry forms can fit their fields on a single line.
// No width here on purpose: every field appends its own w-[...] so the row can be packed tightly.
// The border colour comes from --entry-border: each tinted entry section sets it to its own
// accent, and anywhere else it falls back to slate-300 (see index.css :root).
export const compactInput =
  'h-7 px-2 py-0.5 text-xs font-medium rounded border border-[color:var(--entry-border)] bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm';

// Same field sized to fill its grid cell, for the product-line sub-tables.
export const compactCell = `${compactInput} w-full`;

// Inline label for the compact entry rows: sits beside the field instead of above it.
export const inlineLbl = 'whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-slate-600';
