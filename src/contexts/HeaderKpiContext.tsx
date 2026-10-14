import { createContext, useCallback, useContext, useState } from 'react';

/**
 * Sales Pipeline KPI strip, shared between the Topbar (which renders it inline
 * after the breadcrumbs) and SalesPipelinePage (which computes the counts).
 * Only the pipeline page ever provides KPIs; on every other page the Topbar
 * falls back to its normal breadcrumb-only layout.
 */
export interface HeaderKpi {
  key: string;
  label: string;
  count: number;
  /** Tailwind classes for the tile gradient/border. */
  tile: string;
  /** Tailwind classes for the icon chip. */
  icon: string;
  /** Inline SVG path `d` for the lucide-style icon. */
  iconPath: string;
  onClick: () => void;
  active?: boolean;
  /** Tailwind classes for the module-specific active highlight glow & border. */
  activeClass?: string;
  /** Tailwind classes for the active ping dot. */
  dotClass?: string;
}

interface HeaderKpiContextValue {
  kpis: HeaderKpi[];
  setKpis: (kpis: HeaderKpi[]) => void;
  /** Opt-in page title rendered inline in the top bar (same line as date/profile).
   *  Pages that set it hide their own PageHeader to avoid duplication. */
  header: { title: string; subtitle?: string } | null;
  setHeader: (h: { title: string; subtitle?: string } | null) => void;
  /** Company-wise filter for the records ('down datas') across the top 8 pages. */
  companyFilter: string;
  setCompanyFilter: (company: string) => void;
  companyOptions: string[];
  setCompanyOptions: (options: string[]) => void;
}

const HeaderKpiContext = createContext<HeaderKpiContextValue | null>(null);

export function HeaderKpiProvider({ children }: { children: React.ReactNode }) {
  const [kpis, setKpisState] = useState<HeaderKpi[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>('All Companies');
  const [companyOptions, setCompanyOptionsState] = useState<string[]>([]);

  const setCompanyOptions = useCallback((next: string[]) => {
    setCompanyOptionsState(prev => {
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
      return next;
    });
  }, []);

  // Only rewrite the array when the contents actually changed — SalesPipelinePage
  // recomputes counts on every render and this context sits above the whole app.
  const setKpis = useCallback((next: HeaderKpi[]) => {
    setKpisState(prev => {
      if (prev.length === next.length && prev.every((k, i) =>
        k.key === next[i].key && k.label === next[i].label && k.count === next[i].count && k.active === next[i].active)) return prev;
      return next;
    });
  }, []);

  const [header, setHeaderState] = useState<{ title: string; subtitle?: string } | null>(null);

  const setHeader = useCallback((next: { title: string; subtitle?: string } | null) => {
    setHeaderState(prev => {
      if (prev?.title === next?.title && prev?.subtitle === next?.subtitle) return prev;
      return next;
    });
  }, []);

  return (
    <HeaderKpiContext.Provider value={{ kpis, setKpis, header, setHeader, companyFilter, setCompanyFilter, companyOptions, setCompanyOptions }}>
      {children}
    </HeaderKpiContext.Provider>
  );
}

const defaultHeaderKpiContext: HeaderKpiContextValue = {
  kpis: [],
  setKpis: () => {},
  header: null,
  setHeader: () => {},
  companyFilter: 'All Companies',
  setCompanyFilter: () => {},
  companyOptions: [],
  setCompanyOptions: () => {},
};

export function useHeaderKpis() {
  const ctx = useContext(HeaderKpiContext);
  return ctx || defaultHeaderKpiContext;
}
