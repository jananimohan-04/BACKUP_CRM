import { useMemo } from 'react';
import { navSections, type NavSection } from '@/config/navigation';
import { useAuth } from '@/contexts/AuthContext';

/**
 * The signed-in user's navigation tree: every section with only the items they
 * may see (legacy role gates AND module view access). Empty until permissions
 * load so unauthorized menus never flash. Shared by the Sidebar, TopNav and
 * BottomNav so all four menu positions show the exact same entries.
 */
export function useVisibleNavSections(): NavSection[] {
  const { profile, canView, permissions } = useAuth();
  return useMemo(() => {
    // One permission system: role gates (legacy) AND module view access.
    if (permissions === null) return [];
    return navSections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            (!i.roles || (profile && i.roles.includes(profile.role))) &&
            (!i.module || canView(i.module)),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [permissions, profile, canView]);
}

/** True when a nav entry reads as "current" for the given route. */
export function isNavItemActive(currentPage: string, itemPage: string): boolean {
  if (currentPage === itemPage) return true;
  if (currentPage.startsWith(itemPage + '/')) return true;
  if (itemPage === 'sales/pipeline' && (currentPage.startsWith('sales/') || currentPage === 'sales')) return true;
  return false;
}

/** True when any item of a section is the current page. */
export function isSectionActive(section: NavSection, currentPage: string): boolean {
  return section.items.some((i) => isNavItemActive(currentPage, i.page));
}
