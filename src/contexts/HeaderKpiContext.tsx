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
}

const HeaderKpiContext = createContext<HeaderKpiContextValue | null>(null);

export function HeaderKpiProvider({ children }: { children: React.ReactNode }) {
  const [kpis, setKpisState] = useState<HeaderKpi[]>([]);

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
    <HeaderKpiContext.Provider value={{ kpis, setKpis, header, setHeader }}>
      {children}
    </HeaderKpiContext.Provider>
  );
}

export function useHeaderKpis() {
  const ctx = useContext(HeaderKpiContext);
  if (!ctx) throw new Error('useHeaderKpis must be used within HeaderKpiProvider');
  return ctx;
}
