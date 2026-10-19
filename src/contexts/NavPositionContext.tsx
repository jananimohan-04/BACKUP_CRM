import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

/** The four dock positions the main ERP menu can adopt. */
export type NavPosition = 'left' | 'right' | 'top' | 'bottom';

export const NAV_POSITIONS: NavPosition[] = ['left', 'right', 'top', 'bottom'];

/**
 * Where the user's menu position is stored. The backend has no user-preferences
 * table yet, so the choice is persisted per signed-in user in localStorage —
 * it survives refreshes, route changes and re-login on the same browser without
 * touching authentication or session handling.
 */
const STORAGE_PREFIX = 'erp.navPosition.';
const DEFAULT_POSITION: NavPosition = 'left';

function isValidPosition(value: unknown): value is NavPosition {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom';
}

function storageKey(userId: string | null): string {
  return STORAGE_PREFIX + (userId ?? 'signed-out');
}

function readStored(userId: string | null): NavPosition {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (isValidPosition(raw)) return raw;
  } catch {
    // Private mode / storage blocked: the default position applies for this session.
  }
  return DEFAULT_POSITION;
}

interface NavPositionValue {
  /** Currently docked menu position. Defaults to 'left'. */
  position: NavPosition;
  /** Apply (and persist) a new position instantly — no reload, route intact. */
  setPosition: (position: NavPosition) => void;
}

const NavPositionContext = createContext<NavPositionValue | null>(null);

export function NavPositionProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [position, setPositionState] = useState<NavPosition>(() => readStored(userId));

  // The ERP profile loads after sign-in: adopt the signed-in user's saved position.
  useEffect(() => {
    setPositionState(readStored(userId));
  }, [userId]);

  // Keep other open tabs of the same user in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId)) return;
      if (isValidPosition(e.newValue)) setPositionState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const setPosition = useCallback(
    (next: NavPosition) => {
      setPositionState(next);
      try {
        localStorage.setItem(storageKey(userId), next);
      } catch {
        // Private mode etc: the position still applies for this session.
      }
    },
    [userId],
  );

  const value = useMemo<NavPositionValue>(() => ({ position, setPosition }), [position, setPosition]);
  return <NavPositionContext.Provider value={value}>{children}</NavPositionContext.Provider>;
}

export function useNavPosition(): NavPositionValue {
  const ctx = useContext(NavPositionContext);
  if (!ctx) throw new Error('useNavPosition must be used within NavPositionProvider');
  return ctx;
}
