import { useEffect, useState } from 'react';
import { useHeaderKpis } from '@/contexts/HeaderKpiContext';
import { PettyCashPage } from './PettyCashPage';
import { MemberPettyCashPage } from './MemberPettyCashPage';

// One Petty Cash menu, two tabs in the top bar: the entry register and the members' balances.
const TABS = ['Petty Cash Entry', 'Members Petty Cash'] as const;

export function PettyCashMainPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Petty Cash Entry');
  const { setTabs } = useHeaderKpis();
  useEffect(() => {
    setTabs(TABS.map(label => ({ label, active: label === tab, onClick: () => setTab(label) })));
    return () => setTabs([]);
  }, [tab, setTabs]);
  return (
    <>
      {/* Tabs for screens below lg; on desktop they sit in the top bar. */}
      <div className="flex lg:hidden items-center gap-4 border-b border-slate-200 px-4 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Petty Cash Entry' ? <PettyCashPage /> : <MemberPettyCashPage />}
    </>
  );
}
