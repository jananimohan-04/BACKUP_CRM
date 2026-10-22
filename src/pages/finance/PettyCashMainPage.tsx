import { PettyCashPage } from './PettyCashPage';

// Petty Cash is a single page now. The "Members Petty Cash" tab was removed; money given to or returned by a member is
// entered here with the "Paid to" member box and the "Payable to Members" ledger. MemberPettyCashPage.tsx (the balances
// table) is kept in the project but is no longer shown.
export function PettyCashMainPage() {
  return <PettyCashPage />;
}
