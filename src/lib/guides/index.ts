import type { Guide } from './engine';
import { SALES_GUIDES } from './sales';
import { OPERATIONS_GUIDES } from './operations';
import { FINANCE_GUIDES } from './finance';
import { SUPPLY_GUIDES } from './supply';

/** Every walkthrough. To cover another screen, add a Guide to one of these files: no other code changes. */
export const GUIDES: Guide[] = [...SALES_GUIDES, ...OPERATIONS_GUIDES, ...FINANCE_GUIDES, ...SUPPLY_GUIDES];
