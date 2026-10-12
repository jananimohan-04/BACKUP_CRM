import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type ErpRole = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';

export interface ErpProfile {
  id: string;
  email: string;
  full_name: string;
  role: ErpRole;
  status: 'Active' | 'Inactive';
  company_id: string | null;
  active_company_id: string | null;
}

export interface ErpCompany {
  id: string;
  company_name: string;
  code: string | null;
  status: 'Active' | 'Inactive';
}

// Mirrors the `status` values returned by the erp_get_session() database function.
export type AuthStatus =
  | 'loading'
  | 'signed_out'
  | 'authorized'
  | 'not_registered'
  | 'inactive'
  | 'company_inactive'
  | 'not_google'
  | 'account_conflict'
  | 'error';

interface AuthContextValue {
  status: AuthStatus;
  /** Email of the Google account currently signed in to Supabase (may be unregistered). */
  email: string | null;
  profile: ErpProfile | null;
  /** The company whose data is currently visible. Null only for a Super Admin viewing all companies. */
  company: ErpCompany | null;
  /** Companies the Super Admin can switch between (empty for everyone else). */
  companies: ErpCompany[];
  isSuperAdmin: boolean;
  isCompanyAdmin: boolean;
  errorMessage: string | null;
  signInWithGoogle: () => Promise<void>;
  /** TEMPORARY (local dev only): password sign-in. Remove once Google OAuth is configured locally. */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setActiveCompany: (companyId: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionPayload {
  status: AuthStatus;
  email?: string | null;
  user?: ErpProfile | null;
  company?: ErpCompany | null;
  companies?: ErpCompany[] | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ErpProfile | null>(null);
  const [company, setCompany] = useState<ErpCompany | null>(null);
  const [companies, setCompanies] = useState<ErpCompany[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadedForUser = useRef<string | null>(null);

  const clear = useCallback(() => {
    loadedForUser.current = null;
    setEmail(null);
    setProfile(null);
    setCompany(null);
    setCompanies([]);
    setErrorMessage(null);
  }, []);

  // Role, company and status always come from the database (erp_get_session), never from client state.
  const loadErpSession = useCallback(async () => {
    const { data, error } = await supabase.rpc('erp_get_session');
    if (error) {
      console.error('erp_get_session failed:', error);
      setErrorMessage(error.message);
      setStatus('error');
      return;
    }
    const payload = data as SessionPayload;
    setEmail(payload.email ?? null);
    setProfile(payload.user ?? null);
    setCompany(payload.company ?? null);
    setCompanies(payload.companies ?? []);
    setErrorMessage(null);
    setStatus(payload.status);
  }, []);

  useEffect(() => {
    const handleSession = (userId: string | null) => {
      if (!userId) {
        clear();
        setStatus('signed_out');
        return;
      }
      if (loadedForUser.current === userId) return; // token refreshes don't need a reload
      loadedForUser.current = userId;
      setStatus('loading');
      loadErpSession();
    };

    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session?.user.id ?? null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer: calling other supabase methods inside this callback can deadlock supabase-js.
      setTimeout(() => handleSession(session?.user.id ?? null), 0);
    });
    return () => subscription.unsubscribe();
  }, [clear, loadErpSession]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard',
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      setErrorMessage(error.message);
      setStatus('error');
    }
  }, []);

  // TEMPORARY (local dev only): Google OAuth has no credentials configured locally, so this
  // lets you sign in against the local Supabase with a password instead. The onAuthStateChange
  // listener above picks the session up and loads the ERP profile as usual.
  // TODO: delete this callback and the matching form in LoginScreen.tsx once
  // SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET are set for local dev.
  const signInWithPassword = useCallback(async (emailAddress: string, password: string) => {
    setErrorMessage(null);
    setStatus('loading');
    const { error } = await supabase.auth.signInWithPassword({ email: emailAddress, password });
    if (error) {
      setErrorMessage(error.message);
      setStatus('error');
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clear();
    setStatus('signed_out');
  }, [clear]);

  const refresh = useCallback(async () => {
    await loadErpSession();
  }, [loadErpSession]);

  const setActiveCompany = useCallback(async (companyId: string | null) => {
    const { error } = await supabase.rpc('erp_set_active_company', { p_company_id: companyId });
    if (error) {
      alert('Could not switch company: ' + error.message);
      return;
    }
    await loadErpSession();
  }, [loadErpSession]);

  const value: AuthContextValue = {
    status,
    email,
    profile,
    company,
    companies,
    isSuperAdmin: status === 'authorized' && profile?.role === 'SUPER_ADMIN',
    isCompanyAdmin: status === 'authorized' && profile?.role === 'COMPANY_ADMIN',
    errorMessage,
    signInWithGoogle,
    signInWithPassword,
    signOut,
    refresh,
    setActiveCompany,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
