import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useStickyTableHeads } from './lib/useStickyTableHeads';
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { PortalApp } from './pages/portal/PortalApp';
import { LoginScreen } from './components/LoginScreen';
import { AccessDenied } from './components/AccessDenied';
import { AuthProvider, useAuth, type ErpRole } from './contexts/AuthContext';
import { AdminAssistant } from './components/AdminAssistant';
import { VoiceControl } from './components/VoiceControl';
import { SavedProductsDatalist } from './lib/savedProducts';
import { Time24Normalizer } from './components/Time24Normalizer';
import { DatalistOpenAll } from './components/DatalistOpenAll';
import { EscBack } from './components/EscBack';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { TopNav } from './components/layout/TopNav';
import { BottomNav } from './components/layout/BottomNav';
import { NavPositionProvider, useNavPosition } from './contexts/NavPositionContext';
import { HeaderKpiProvider } from './contexts/HeaderKpiContext';
import { Dashboard } from './pages/Dashboard';

import {
  PartsPage,
  DrawingsPage,
  BOMPage,
  WorkInstructionsPage,
  RevisionsPage,
  CNCVaultPage
} from './pages/engineering/EngineeringPages';

import {
  ProductionPlanningPage,
  WorkOrdersPage,
  JobCardsPage,
  CNCOperationsPage,
  ShopFloorPage,
  ProductionTrackingPage
} from './pages/production/ProductionPages';
import { FinishedGoodsPage } from './pages/production/unified/FinishedGoodsPage';
import { SchedulingPage } from './pages/production/unified/SchedulingPage';
import { ProcessMasterPage } from './pages/production/unified/ProcessMasterPage';

import {
  SalesPipelinePage,
  LeadsPage,
  CustomersPage,
  QuotationsPage,
  SalesOrdersPage,
} from './pages/sales/SalesPages';

import { DeliveriesPage } from './pages/operations/OperationsPages';
import { BalanceSheetPage } from './pages/accounts/BalanceSheetPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { LedgerPage } from './pages/accounts/LedgerPage';
import {
  MetalCalculatorPage, CreateQuotationPage, ClientLibraryPage, ProductLibraryPage,
  TermsLibraryPage, QuotationLibraryPage, CompanyProfilePage,
} from './pages/quotation/QuotationToolPages';
import { TrialBalancePage } from './pages/accounts/TrialBalancePage';
import { ProfitLossPage } from './pages/accounts/ProfitLossPage';
import { InvoicesPage } from './pages/finance/InvoicesPage';
import { BankCashPage } from './pages/finance/BankCashPage';
import { BankEntryPage } from './pages/finance/BankEntryPage';
import { PettyCashPage } from './pages/finance/PettyCashPage';
import { PettyCashMainPage } from './pages/finance/PettyCashMainPage';
import { LedgerDashboardPage } from './pages/finance/LedgerDashboardPage';

import {
  RawMaterialsPage, ComponentsPage, StockMovementsPage, WarehousesPage, MaterialRequestsPage, LowStockPage
} from './pages/inventory/InventoryPages';

import {
  SuppliersPage, PurchaseRequisitionsPage, PurchaseOrdersPage, GoodsReceiptPage, SupplierPerformancePage
} from './pages/purchasing/PurchasingPages';

import {
  InspectionPlansPage, IncomingInspectionPage, InProcessInspectionPage, FinalInspectionPage, NCRPage, CorrectiveActionsPage
} from './pages/quality/QualityPages';

import {
  MachinesPage, PreventiveMaintenancePage, BreakdownMaintenancePage, MaintenanceHistoryPage, MachineDowntimePage
} from './pages/maintenance/MaintenancePages';

import {
  MaterialCostPage, MachineCostPage, LabourCostPage, ToolingCostPage, OverheadCostPage, JobCostingPage, QuoteCostingPage
} from './pages/costing/CostingPages';

import {
  ProductionReportsPage, SalesReportsPage, InventoryReportsPage, QualityReportsPage, MachineUtilizationReportsPage, CostAnalysisReportsPage
} from './pages/reports/ReportsPages';
import { QuantityTrackingPage } from './pages/reports/QuantityTrackingPage';

import {
  UsersPage, CompaniesPage, SettingsPage, AuditLogsPage, AccessPage
} from './pages/admin/AdminPages';
import { SupportCenterPage } from './pages/support/SupportCenterPage';
import { RequireModule, moduleForPage } from '@/components/auth/RequireModule';
import { getPageTheme } from './lib/pageThemes';
import { isTauri } from './lib/desktop/isTauri';
import { UpdateCenter } from './components/desktop/UpdateCenter';
import { DesktopToasts } from './lib/desktop/toast';

// Placeholder Component for unbuilt pages
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-slate-50">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{title}</h2>
        <p className="text-slate-500">This module is currently under development.</p>
      </div>
    </div>
  );
}

// UI convenience only: the database refuses these operations for other roles anyway.
function RequireRole({ roles, children }: { roles: ErpRole[]; children: ReactElement }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) return <PlaceholderPage title="Not Authorized" />;
  return children;
}

function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useStickyTableHeads(mainRef, location.pathname);
  // User-chosen menu position (Left / Right / Top / Bottom) — persisted per user.
  const { position } = useNavPosition();

  // Remove leading slash for matching with Lovable's navigation config
  const currentPage = location.pathname.substring(1) || 'sales/pipeline';

  const handleNavigate = (page: string) => {
    navigate(`/${page}`);
  };

  const { signOut, company, refreshPermissions } = useAuth();

  // Re-read effective permissions on every navigation so an admin's change
  // applies without forcing the affected user to log in again.
  useEffect(() => { void refreshPermissions(); }, [location.pathname, refreshPermissions]);

  const handleLogout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <HeaderKpiProvider>
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Left menu position: the classic sidebar (default). */}
      {position === 'left' && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          side="left"
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top menu position: logo + category bar above the page header. */}
        {position === 'top' && (
          <TopNav
            currentPage={currentPage}
            onNavigate={handleNavigate}
            onMenuClick={() => setMobileMenuOpen(true)}
          />
        )}
        <Topbar 
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          onMenuClick={() => setMobileMenuOpen(true)}
          hideMobileMenu={position === 'top' || position === 'bottom'}
        />
        {/* Keyed by company so every page refetches when the Super Admin switches company */}
        <main ref={mainRef} key={company?.id ?? 'all-companies'} className="flex-1 overflow-y-auto scrollbar-dark transition-[background] duration-500" style={{ background: getPageTheme(location.pathname).gradient }}>
          <RequireModule module={moduleForPage(currentPage)}>
          <Routes>
            <Route path="/" element={<Navigate to="/sales/pipeline" replace />} />
            <Route path="/dashboard" element={<Dashboard onNavigate={handleNavigate} />} />
            
            {/* Sales */}
            <Route path="/sales/pipeline" element={<SalesPipelinePage />} />
            <Route path="/sales/leads" element={<LeadsPage />} />
            <Route path="/sales/customers" element={<CustomersPage />} />
            <Route path="/sales/quotations" element={<QuotationsPage />} />
            <Route path="/sales/orders" element={<SalesOrdersPage />} />
            
            {/* Operations */}
            <Route path="/operations/delivery" element={<DeliveriesPage />} />
            <Route path="/operations/challan" element={<Navigate to="/operations/delivery" replace />} />
            <Route path="/finance/invoices" element={<InvoicesPage />} />
            <Route path="/finance/bank-entries" element={<BankCashPage />} />
            <Route path="/finance/bank-entry" element={<BankEntryPage />} />
            <Route path="/finance/petty-cash" element={<PettyCashMainPage />} />
            <Route path="/finance/ledger-dashboard" element={<LedgerDashboardPage />} />
            
            {/* Engineering */}
            <Route path="/engineering/parts" element={<PartsPage />} />
            <Route path="/engineering/drawings" element={<DrawingsPage />} />
            <Route path="/engineering/bom" element={<BOMPage />} />
            <Route path="/engineering/work-instructions" element={<WorkInstructionsPage />} />
            <Route path="/engineering/cnc-vault/*" element={<CNCVaultPage />} />

            {/* Production */}
            <Route path="/production/planning" element={<ProductionPlanningPage />} />
            <Route path="/production/work-orders" element={<WorkOrdersPage />} />
            <Route path="/production/job-cards" element={<JobCardsPage />} />
            <Route path="/production/scheduling" element={<SchedulingPage />} />
            <Route path="/production/cnc-operations" element={<CNCOperationsPage />} />
            <Route path="/production/shop-floor" element={<ShopFloorPage />} />
            <Route path="/production/tracking" element={<ProductionTrackingPage />} />
            <Route path="/production/process-master" element={<ProcessMasterPage />} />
            <Route path="/production/finished-goods" element={<FinishedGoodsPage />} />

            {/* Inventory */}
            <Route path="/inventory/raw-materials" element={<RawMaterialsPage />} />
            <Route path="/inventory/components" element={<ComponentsPage />} />
            <Route path="/inventory/stock" element={<InventoryPage />} />
            <Route path="/inventory/movements" element={<StockMovementsPage />} />
            <Route path="/inventory/requests" element={<MaterialRequestsPage />} />
            <Route path="/inventory/warehouse" element={<WarehousesPage />} />
            <Route path="/inventory/alerts" element={<LowStockPage />} />

            {/* Purchasing */}
            <Route path="/purchasing/suppliers" element={<SuppliersPage />} />
            <Route path="/purchasing/requisitions" element={<PurchaseRequisitionsPage />} />
            <Route path="/purchasing/orders" element={<PurchaseOrdersPage />} />
            <Route path="/purchasing/goods-receipt" element={<GoodsReceiptPage />} />
            <Route path="/purchasing/supplier-performance" element={<SupplierPerformancePage />} />

            {/* Quality */}
            <Route path="/quality/inspection-plans" element={<InspectionPlansPage />} />
            <Route path="/quality/incoming" element={<IncomingInspectionPage />} />
            <Route path="/quality/in-process" element={<InProcessInspectionPage />} />
            <Route path="/quality/final" element={<FinalInspectionPage />} />
            <Route path="/quality/ncr" element={<NCRPage />} />
            <Route path="/quality/corrective-actions" element={<CorrectiveActionsPage />} />

            {/* Maintenance */}
            <Route path="/maintenance/machines" element={<MachinesPage />} />
            <Route path="/maintenance/preventive" element={<PreventiveMaintenancePage />} />
            <Route path="/maintenance/breakdown" element={<BreakdownMaintenancePage />} />
            <Route path="/maintenance/history" element={<MaintenanceHistoryPage />} />
            <Route path="/maintenance/downtime" element={<MachineDowntimePage />} />

            {/* Costing */}
            <Route path="/costing/material" element={<MaterialCostPage />} />
            <Route path="/costing/machine" element={<MachineCostPage />} />
            <Route path="/costing/labour" element={<LabourCostPage />} />
            <Route path="/costing/tooling" element={<ToolingCostPage />} />
            <Route path="/costing/overhead" element={<OverheadCostPage />} />
            <Route path="/costing/job-costing" element={<JobCostingPage />} />
            <Route path="/costing/job_costing" element={<JobCostingPage />} />
            <Route path="/costing/quote-costing" element={<QuoteCostingPage />} />

            {/* Create Quotation */}
            <Route path="/quotation/metal-calculator" element={<MetalCalculatorPage />} />
            <Route path="/quotation/create" element={<CreateQuotationPage />} />
            <Route path="/quotation/client-library" element={<ClientLibraryPage />} />
            <Route path="/quotation/product-library" element={<ProductLibraryPage />} />
            <Route path="/quotation/terms-library" element={<TermsLibraryPage />} />
            <Route path="/quotation/library" element={<QuotationLibraryPage />} />
            <Route path="/quotation/company-profile" element={<CompanyProfilePage />} />

            {/* Accounts */}
            <Route path="/accounts/ledger" element={<LedgerPage />} />
            <Route path="/accounts/trial-balance" element={<TrialBalancePage />} />
            <Route path="/accounts/profit-loss" element={<ProfitLossPage />} />
            <Route path="/accounts/balance-sheet" element={<BalanceSheetPage />} />

            {/* Reports */}
            <Route path="/reports/production" element={<ProductionReportsPage />} />
            <Route path="/reports/order-tracking" element={<QuantityTrackingPage />} />
            <Route path="/reports/sales" element={<SalesReportsPage />} />
            <Route path="/reports/inventory" element={<InventoryReportsPage />} />
            <Route path="/reports/quality" element={<QualityReportsPage />} />
            <Route path="/reports/machine-utilization" element={<MachineUtilizationReportsPage />} />
            <Route path="/reports/cost-analysis" element={<CostAnalysisReportsPage />} />

            {/* Administration */}
            <Route path="/admin/users" element={<RequireRole roles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><UsersPage /></RequireRole>} />
            <Route path="/admin/companies" element={<RequireRole roles={['SUPER_ADMIN']}><CompaniesPage /></RequireRole>} />
            <Route path="/admin/access" element={<RequireRole roles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AccessPage /></RequireRole>} />
            <Route path="/admin/roles" element={<Navigate to="/admin/access" replace />} />
            <Route path="/admin/permissions" element={<Navigate to="/admin/access" replace />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
            <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
            <Route path="/support/center" element={<SupportCenterPage />} />

            {/* Fallback */}
            <Route path="*" element={<PlaceholderPage title="Page Not Found" />} />
          </Routes>
          </RequireModule>
        </main>
        {/* Bottom menu position: compact bar docked to the bottom edge (reserves its own space). */}
        {position === 'bottom' && (
          <BottomNav currentPage={currentPage} onNavigate={handleNavigate} />
        )}
      </div>
      {/* Right menu position: the same sidebar docked to the right edge. */}
      {position === 'right' && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          side="right"
        />
      )}
      {/* Top/bottom positions: mobile navigation is a slide-in drawer of the same sidebar. */}
      {(position === 'top' || position === 'bottom') && (
        <Sidebar
          mobileOnly
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />
      )}
      <AdminAssistant />
      <VoiceControl />
      <SavedProductsDatalist />
      <Time24Normalizer />
      <DatalistOpenAll />
      <EscBack />
    </div>
    </HeaderKpiProvider>
  );
}

function ErpGate() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === 'signed_out') return <LoginScreen />;
  if (status !== 'authorized') return <AccessDenied />;
  return <MainLayout />;
}

function ErpApp() {
  return (
    <AuthProvider>
      <NavPositionProvider>
        <ErpGate />
      </NavPositionProvider>
    </AuthProvider>
  );
}

function App() {
  // Desktop-only overlays (update card + shell toasts). Rendered as null in the
  // web build path at runtime — isTauri() is false in a browser — so the deployed
  // web app keeps rendering exactly what it rendered before.
  const desktop = isTauri();
  return (
    <BrowserRouter>
      {desktop && <UpdateCenter />}
      {desktop && <DesktopToasts />}
      <Routes>
        <Route path="/portal/*" element={<PortalApp />} />
        <Route path="/*" element={<ErpApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
