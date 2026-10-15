import { useState } from 'react';
import { Shield, Zap, Award } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// TEMPORARY (local dev only): password sign-in is shown only when running the dev server
// against the LOCAL Supabase, because it has no Google OAuth credentials. Against the hosted
// project (and in every hosted build) the screen is Google-only, exactly like production.
// TODO: remove once local Google OAuth works.
const isLocalDev =
  import.meta.env.DEV &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
  /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(String(import.meta.env.VITE_SUPABASE_URL ?? ''));

export function LoginScreen() {
  const { signInWithGoogle, signInWithPassword, errorMessage } = useAuth();
  const [loading, setLoading] = useState(false);
  const [devEmail, setDevEmail] = useState('jananimohan44@gmail.com');
  const [devPassword, setDevPassword] = useState('');

  // Redirects to Google; on return AuthProvider checks the account against the ERP user list.
  const handleGoogle = async () => {
    setLoading(true);
    await signInWithGoogle();
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left — Cinematic CNC Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-navy-950">
        {/* Gradient background simulating CNC machining environment */}
        <div className="absolute inset-0 bg-gradient-to-br from-navy-950 via-navy-900 to-brand-950" />
        <div className="absolute inset-0 bg-grid-dark opacity-40" />

        {/* Simulated CNC machine glow */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-500/15 rounded-full blur-[100px]" />

        {/* Decorative precision lines */}
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <line x1="0" y1="30%" x2="100%" y2="30%" stroke="url(#lineGrad)" strokeWidth="1" />
          <line x1="0" y1="60%" x2="100%" y2="60%" stroke="url(#lineGrad)" strokeWidth="1" />
          <line x1="0" y1="80%" x2="100%" y2="80%" stroke="url(#lineGrad)" strokeWidth="1" />
        </svg>

        {/* Content overlay */}
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <img src="/arguscnc-logo.jpg" alt="ARGUSCNC Logo" className="h-28 w-auto object-contain drop-shadow-xl rounded-md" />

          <div className="max-w-md">
            <h2 className="text-4xl font-bold leading-tight mb-4">
              Creating Future Factories<br />
              <span className="bg-gradient-to-r from-brand-400 to-accent-400 bg-clip-text text-transparent">
                Powered by ARGUSCNC™
              </span>
            </h2>
            <p className="text-navy-300 text-sm leading-relaxed mb-8">
              The complete enterprise resource planning platform for CNC machining operations. 
              From enquiry to dispatch — manage your entire shop floor with precision.
            </p>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <Shield className="text-brand-400 mb-2" size={20} />
                <p className="text-xs font-semibold">ISO 9001</p>
                <p className="text-[10px] text-navy-400">Compliant</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <Zap className="text-accent-400 mb-2" size={20} />
                <p className="text-xs font-semibold">Real-time</p>
                <p className="text-[10px] text-navy-400">Shop Floor</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <Award className="text-amber-400 mb-2" size={20} />
                <p className="text-xs font-semibold">AS9100D</p>
                <p className="text-[10px] text-navy-400">Aerospace</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs text-navy-400">
            <span>v3.2.1 Enterprise</span>
            <span>•</span>
            <span>99.98% Uptime</span>
            <span>•</span>
            <span>SOC 2 Certified</span>
          </div>
        </div>
      </div>

      {/* Right — Google sign-in */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <img src="/arguscnc-logo.jpg" alt="ARGUSCNC Logo" className="h-24 w-auto object-contain rounded-md" />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-800">Welcome Back</h2>
            <p className="text-sm text-slate-500 mt-1.5">Sign in to your ARGUSCNC ERP account</p>
          </div>

          {!isLocalDev && (
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 hover:border-brand-400 hover:shadow-lg hover:shadow-brand-100 rounded-lg px-4 py-3 text-sm font-semibold text-slate-700 transition-all active:scale-[0.98] disabled:opacity-70"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-slate-300 border-t-brand-600 rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            <span>Continue with Google</span>
          </button>
          )}

          {isLocalDev && (
            <form
              className="mt-6 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50/60 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void signInWithPassword(devEmail.trim(), devPassword);
              }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Local dev only — temporary
              </p>
              <p className="mt-1 text-[11px] text-amber-700/80">
                Google OAuth isn’t configured locally — sign in with the local dev
                password instead.
              </p>
              <input
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                autoComplete="username"
                className="mt-3 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
              />
              <input
                type="password"
                value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Password"
                className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !devPassword}
                className="mt-3 w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-amber-700 active:scale-[0.98] disabled:opacity-60"
              >
                Sign in with password
              </button>
            </form>
          )}

          {errorMessage && (
            <p className="mt-4 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{errorMessage}</p>
          )}

          <div className="mt-8 pt-6 border-t border-slate-200">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <Shield size={12} />
              <span>Access is limited to accounts registered by your administrator</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
