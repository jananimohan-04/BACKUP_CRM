/**
 * Per-page colour theming for CNCFORGE ERP.
 *
 * Every route and every Sales Pipeline stage gets its own rich, saturated
 * jewel-tone gradient.  No black.  "Dark means dark, don't use too-dark
 * colours" — the luminance band sits around 15-25 %.
 *
 * Usage
 * ─────
 *   import { getPageTheme, getSalesStageTheme } from '@/lib/pageThemes';
 *
 *   // Inside App.tsx  (route-level)
 *   const theme = getPageTheme(location.pathname);
 *   <main style={{ background: theme.gradient }}>
 *
 *   // Inside SalesPipelinePage  (stage-level, overrides the route theme)
 *   const theme = getSalesStageTheme(activeView);
 *   <div style={{ background: theme.gradient }}>
 */

export interface PageTheme {
  /** CSS `background` value — usually a linear-gradient. */
  gradient: string;
  /** A readable label (dev only). */
  label: string;
}

/* ── Sales Pipeline stage themes ────────────────────────────────────── */

const STAGE_THEMES: Record<string, PageTheme> = {
  pipeline: {
    gradient: 'linear-gradient(135deg, #1c324f 0%, #244065 50%, #15263d 100%)',
    label: 'Steel Azure (Kanban Board)',
  },
  enquiry_list: {
    gradient: 'linear-gradient(135deg, #143b70 0%, #1a4a8c 50%, #10305c 100%)',
    label: 'Deep Sapphire Blue (Enquiries)',
  },
  quotation_list: {
    gradient: 'linear-gradient(135deg, #461e68 0%, #572780 50%, #381854 100%)',
    label: 'Royal Amethyst (Quotations)',
  },
  sales_order_list: {
    gradient: 'linear-gradient(135deg, #0d503c 0%, #12654c 50%, #0a3f2f 100%)',
    label: 'Deep Emerald Jade (Sales Orders)',
  },
  inward_list: {
    gradient: 'linear-gradient(135deg, #73390c 0%, #8c460f 50%, #592c09 100%)',
    label: 'Deep Warm Bronze (Inward)',
  },
  fg_list: {
    gradient: 'linear-gradient(135deg, #0f545e 0%, #136875 50%, #0c424a 100%)',
    label: 'Deep Ocean Teal (Finished Goods)',
  },
  rejected_list: {
    gradient: 'linear-gradient(135deg, #6d1830 0%, #841e3b 50%, #541225 100%)',
    label: 'Deep Crimson Wine (Rejected)',
  },
  dc_list: {
    gradient: 'linear-gradient(135deg, #753017 0%, #8e3c1d 50%, #5a2512 100%)',
    label: 'Deep Terracotta Rust (DC)',
  },
  invoice_list: {
    gradient: 'linear-gradient(135deg, #24286d 0%, #2d3288 50%, #1b1e55 100%)',
    label: 'Deep Midnight Indigo (Invoices)',
  },
};

/** Resolve the Sales Pipeline's active view to a page theme. */
export function getSalesStageTheme(activeView: string): PageTheme {
  return STAGE_THEMES[activeView] ?? STAGE_THEMES.pipeline;
}

/* ── Route-level themes (every sidebar page) ────────────────────────── */

interface RouteRule {
  /** Prefix to match against `location.pathname` (without leading slash). */
  prefix: string;
  theme: PageTheme;
}

const ROUTE_RULES: RouteRule[] = [
  // Sales Pipeline is handled by getSalesStageTheme inside the page itself,
  // but when the route first mounts (before any stage is clicked) this gives
  // it the kanban board colour.
  { prefix: 'sales', theme: STAGE_THEMES.pipeline },

  // Dashboard
  { prefix: 'dashboard', theme: { gradient: 'linear-gradient(135deg, #163e72 0%, #1c4d8e 50%, #11315b 100%)', label: 'Deep Royal Cobalt (Dashboard)' } },

  // Engineering
  { prefix: 'engineering', theme: { gradient: 'linear-gradient(135deg, #413654 0%, #514369 50%, #332a42 100%)', label: 'Deep Bronze Slate (Engineering)' } },

  // Production
  { prefix: 'production/scheduling', theme: { gradient: 'linear-gradient(135deg, #472766 0%, #57307d 50%, #371e4f 100%)', label: 'Deep Amethyst (Scheduling)' } },
  { prefix: 'production/tracking', theme: { gradient: 'linear-gradient(135deg, #114d59 0%, #16606f 50%, #0d3c46 100%)', label: 'Deep Marine Teal (Machine Log)' } },
  { prefix: 'production/process-master', theme: { gradient: 'linear-gradient(135deg, #571d40 0%, #6c2450 50%, #431631 100%)', label: 'Deep Plum Magenta (Process Master)' } },
  { prefix: 'production/finished-goods', theme: { gradient: 'linear-gradient(135deg, #0f545e 0%, #136875 50%, #0c424a 100%)', label: 'Deep Ocean Teal (Finished Goods)' } },
  { prefix: 'production', theme: { gradient: 'linear-gradient(135deg, #144c3a 0%, #1a5f49 50%, #0f3b2d 100%)', label: 'Deep Forest Pine (Production)' } },

  // Operations / Logistics
  { prefix: 'operations', theme: { gradient: 'linear-gradient(135deg, #753017 0%, #8e3c1d 50%, #5a2512 100%)', label: 'Deep Terracotta Rust (Delivery)' } },

  // Finance
  { prefix: 'finance/invoices', theme: { gradient: 'linear-gradient(135deg, #24286d 0%, #2d3288 50%, #1b1e55 100%)', label: 'Deep Midnight Indigo (Invoices)' } },
  { prefix: 'finance', theme: { gradient: 'linear-gradient(135deg, #223552 0%, #2b4266 50%, #1a293f 100%)', label: 'Deep Midnight Slate (Finance)' } },

  // Accounts
  { prefix: 'accounts', theme: { gradient: 'linear-gradient(135deg, #223552 0%, #2b4266 50%, #1a293f 100%)', label: 'Deep Midnight Slate (Accounts)' } },

  // Costing
  { prefix: 'costing', theme: { gradient: 'linear-gradient(135deg, #511f59 0%, #652770 50%, #3e1744 100%)', label: 'Deep Mulberry (Costing)' } },

  // Quotation tools
  { prefix: 'quotation', theme: { gradient: 'linear-gradient(135deg, #461e68 0%, #572780 50%, #381854 100%)', label: 'Royal Amethyst (Quotation Tools)' } },

  // Inventory
  { prefix: 'inventory', theme: { gradient: 'linear-gradient(135deg, #444218 0%, #54521e 50%, #353313 100%)', label: 'Deep Golden Olive (Inventory)' } },

  // Purchasing
  { prefix: 'purchasing', theme: { gradient: 'linear-gradient(135deg, #651b40 0%, #7d2250 50%, #4e1531 100%)', label: 'Deep Raspberry Wine (Purchasing)' } },

  // Quality
  { prefix: 'quality', theme: { gradient: 'linear-gradient(135deg, #174667 0%, #1d5780 50%, #123650 100%)', label: 'Deep Cerulean (Quality)' } },

  // Maintenance
  { prefix: 'maintenance', theme: { gradient: 'linear-gradient(135deg, #61301a 0%, #773b20 50%, #4b2514 100%)', label: 'Deep Rust Leather (Maintenance)' } },

  // Reports
  { prefix: 'reports', theme: { gradient: 'linear-gradient(135deg, #253250 0%, #2e3e64 50%, #1c263e 100%)', label: 'Deep Slate Cobalt (Reports)' } },

  // Admin
  { prefix: 'admin', theme: { gradient: 'linear-gradient(135deg, #41214c 0%, #51295f 50%, #32193b 100%)', label: 'Deep Eggplant Mauve (Admin)' } },
];

const DEFAULT_THEME: PageTheme = {
  gradient: 'linear-gradient(135deg, #163e72 0%, #1c4d8e 50%, #11315b 100%)',
  label: 'Deep Royal Cobalt (Default)',
};

/**
 * Resolve a pathname (e.g. `/sales/pipeline`, `/dashboard`) to its page
 * theme.  The first matching prefix wins — more specific prefixes are listed
 * first in ROUTE_RULES.
 */
export function getPageTheme(pathname: string): PageTheme {
  const clean = pathname.replace(/^\/+/, '').toLowerCase();
  for (const rule of ROUTE_RULES) {
    if (clean.startsWith(rule.prefix)) return rule.theme;
  }
  return DEFAULT_THEME;
}
