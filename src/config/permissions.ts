import type { ErpRole } from '@/contexts/AuthContext';

// Central permission registry: ONE system driving sidebar, top KPI menu,
// Kanban/list/calendar views and route guards. Module keys MUST match the
// database (erp_table_modules / user_module_permissions.module_key).

export type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';

export interface ModuleDef {
  key: string;
  label: string;
  category: string;
  /** Actions the UI offers for this module (subset — only what the app supports). */
  actions: PermAction[];
  /** App route pages (without leading slash) belonging to this module. */
  pages: string[];
}

export const PERM_CATEGORIES = [
  'Overview',
  'Sales',
  'Production',
  'Logistics',
  'Finance',
  'Inventory & Purchasing',
  'Administration',
] as const;

const V: PermAction[] = ['view'];
const VCED: PermAction[] = ['view', 'create', 'edit', 'delete'];
const VCEDX: PermAction[] = ['view', 'create', 'edit', 'delete', 'export'];

export const MODULE_CATALOG: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', category: 'Overview', actions: [...V], pages: ['dashboard'] },
  { key: 'reports', label: 'Reports', category: 'Overview', actions: ['view', 'export'], pages: ['reports/production', 'reports/order-tracking', 'reports/sales', 'reports/inventory', 'reports/quality', 'reports/machine-utilization', 'reports/cost-analysis'] },

  { key: 'sales-pipeline', label: 'Sales Pipeline', category: 'Sales', actions: [...VCED], pages: ['sales/pipeline'] },
  { key: 'enquiries', label: 'Enquiries', category: 'Sales', actions: [...VCEDX], pages: [] },
  { key: 'quotations', label: 'Quotations', category: 'Sales', actions: [...VCEDX], pages: ['sales/quotations', 'quotation/metal-calculator', 'quotation/create', 'quotation/client-library', 'quotation/product-library', 'quotation/terms-library', 'quotation/library', 'quotation/company-profile'] },
  { key: 'sales-orders', label: 'Sales Orders', category: 'Sales', actions: [...VCEDX], pages: ['sales/orders'] },
  { key: 'companies', label: 'All Companies', category: 'Sales', actions: [...VCEDX], pages: ['sales/leads', 'sales/customers'] },

  { key: 'production', label: 'Production', category: 'Production', actions: [...VCED], pages: ['production/planning', 'production/work-orders', 'production/job-cards'] },
  { key: 'scheduling', label: 'Scheduling', category: 'Production', actions: [...VCED], pages: ['production/scheduling'] },
  { key: 'machine-log', label: 'Machine Log', category: 'Production', actions: [...VCED], pages: ['production/cnc-operations', 'production/shop-floor', 'production/tracking'] },
  { key: 'process-master', label: 'Process Master', category: 'Production', actions: [...VCED], pages: ['production/process-master'] },
  { key: 'finished-goods', label: 'Finished Goods', category: 'Production', actions: ['view', 'create', 'edit', 'delete', 'approve'], pages: ['production/finished-goods'] },
  { key: 'rejected', label: 'Rejected Entry', category: 'Production', actions: [...VCED], pages: [] },

  { key: 'inward', label: 'Inward', category: 'Logistics', actions: [...VCEDX], pages: [] },
  { key: 'delivery', label: 'Delivery Challan', category: 'Logistics', actions: [...VCEDX], pages: ['operations/delivery', 'operations/challan'] },

  { key: 'invoices', label: 'Invoices', category: 'Finance', actions: [...VCEDX], pages: ['finance/invoices'] },
  { key: 'bank-entry', label: 'Bank Entry', category: 'Finance', actions: [...VCEDX], pages: ['finance/bank-entries', 'finance/bank-entry'] },
  { key: 'ledger', label: 'Ledger', category: 'Finance', actions: [...VCEDX], pages: ['accounts/ledger', 'accounts/trial-balance', 'accounts/profit-loss', 'accounts/balance-sheet', 'finance/ledger-dashboard'] },
  { key: 'petty-cash', label: 'Petty Cash', category: 'Finance', actions: [...VCEDX], pages: ['finance/petty-cash'] },
  { key: 'project-costing', label: 'Project Costing', category: 'Finance', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'], pages: ['costing/job-costing', 'costing/job_costing'] },
  { key: 'product-costing', label: 'Product Costing', category: 'Finance', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'], pages: ['costing/material', 'costing/machine', 'costing/labour', 'costing/tooling', 'costing/overhead', 'costing/quote-costing'] },

  { key: 'inventory', label: 'Inventory', category: 'Inventory & Purchasing', actions: [...VCEDX], pages: ['inventory/raw-materials', 'inventory/components', 'inventory/stock', 'inventory/movements', 'inventory/requests', 'inventory/warehouse', 'inventory/alerts'] },
  { key: 'suppliers', label: 'Suppliers', category: 'Inventory & Purchasing', actions: [...VCEDX], pages: ['purchasing/suppliers', 'purchasing/supplier-performance'] },
  { key: 'purchase-requisitions', label: 'Purchase Requisitions', category: 'Inventory & Purchasing', actions: [...VCEDX], pages: ['purchasing/requisitions'] },
  { key: 'purchase-orders', label: 'Purchase Orders', category: 'Inventory & Purchasing', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'], pages: ['purchasing/orders'] },
  { key: 'grn', label: 'Goods Receipt / GRN', category: 'Inventory & Purchasing', actions: [...VCEDX], pages: ['purchasing/goods-receipt'] },
  { key: 'engineering', label: 'Products and Drawings', category: 'Inventory & Purchasing', actions: [...VCED], pages: ['engineering/parts', 'engineering/drawings', 'engineering/bom', 'engineering/work-instructions', 'engineering/cnc-vault'] },
  { key: 'quality', label: 'Quality', category: 'Inventory & Purchasing', actions: [...VCED], pages: ['quality/inspection-plans', 'quality/incoming', 'quality/in-process', 'quality/final', 'quality/ncr', 'quality/corrective-actions'] },
  { key: 'maintenance', label: 'Maintenance', category: 'Inventory & Purchasing', actions: [...VCED], pages: ['maintenance/machines', 'maintenance/preventive', 'maintenance/breakdown', 'maintenance/history', 'maintenance/downtime'] },

  { key: 'admin-users', label: 'User Management', category: 'Administration', actions: [...V], pages: ['admin/users'] },
  { key: 'admin-companies', label: 'Company Management', category: 'Administration', actions: [...V], pages: ['admin/companies'] },
  { key: 'admin-access', label: 'Access Management', category: 'Administration', actions: [...V], pages: ['admin/access', 'admin/roles', 'admin/permissions'] },
  { key: 'settings', label: 'Settings', category: 'Administration', actions: [...V], pages: ['admin/settings'] },
  { key: 'audit-logs', label: 'Audit Logs', category: 'Administration', actions: [...V], pages: ['admin/audit-logs'] },
];

export const MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);

/** Route page (no leading slash) -> owning module. Unmapped pages stay open (current behaviour). */
export const PAGE_MODULE: Record<string, string> = Object.fromEntries(
  MODULE_CATALOG.flatMap((m) => m.pages.map((p) => [p, m.key])),
);

/** Kanban stage -> module owning that column and its records. */
export const STAGE_MODULE: Record<string, string> = {
  Enquiry: 'enquiries',
  Quotation: 'quotations',
  'Sales Order': 'sales-orders',
  Inward: 'inward',
  'Finished Goods': 'finished-goods',
  DC: 'delivery',
  Invoice: 'invoices',
  Rejected: 'rejected',
};

/** Modules a Company Admin may never grant (reserved for Super Admin). Mirrors erp_save_permissions. */
export const ADMIN_RESERVED_MODULES = ['admin-companies', 'admin-access', 'settings', 'audit-logs'];

export type ActionFlags = Record<PermAction, boolean>;
export type PermMatrix = Record<string, ActionFlags>;

const emptyFlags = (): ActionFlags => ({ view: false, create: false, edit: false, delete: false, approve: false, export: false });
const fullFlags = (): ActionFlags => ({ view: true, create: true, edit: true, delete: true, approve: true, export: true });

export const emptyMatrix = (): PermMatrix =>
  Object.fromEntries(MODULE_KEYS.map((k) => [k, emptyFlags()]));

export const fullMatrix = (): PermMatrix =>
  Object.fromEntries(MODULE_KEYS.map((k) => [k, fullFlags()]));

/** Rows from erp_get_permissions() -> matrix (missing modules default to no access). */
export function rowsToMatrix(rows: { module_key: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_approve: boolean; can_export: boolean }[] | null | undefined): PermMatrix {
  const m = emptyMatrix();
  (rows ?? []).forEach((r) => {
    if (!m[r.module_key]) return;
    m[r.module_key] = {
      view: !!r.can_view, create: !!r.can_create, edit: !!r.can_edit,
      delete: !!r.can_delete, approve: !!r.can_approve, export: !!r.can_export,
    };
  });
  return m;
}

/** Effective matrix: admins get everything (authority comes from the role, as before). */
export function effectiveMatrix(role: ErpRole | null | undefined, rows: Parameters<typeof rowsToMatrix>[0]): PermMatrix {
  if (role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN') return fullMatrix();
  return rowsToMatrix(rows);
}

/** Matrix -> RPC payload shape {module: {view,create,...}} (only modules with any grant). */
export function matrixToPayload(matrix: PermMatrix): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [k, f] of Object.entries(matrix)) {
    if (f.view || f.create || f.edit || f.delete || f.approve || f.export) {
      out[k] = { view: f.view, create: f.create, edit: f.edit, delete: f.delete, approve: f.approve, export: f.export };
    }
  }
  return out;
}
