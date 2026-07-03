import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { supabaseService } from '../lib/supabaseService';
import { Cloud, Mail, Lock, ArrowRight, CheckCircle, AlertTriangle, Eye, EyeOff, TrendingUp } from 'lucide-react';

interface LoginPageProps {
  onLogin: (data?: any) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user && mode === 'login') {
        const cloud = await supabaseService.pullAll();
        if (cloud.holdings.length > 0) {
          onLogin({
            holdings: cloud.holdings,
            dividends: cloud.dividends,
            refunds: cloud.refunds,
            annualPerformancePercent: cloud.settings?.annualPerformancePercent ?? 8.5,
            customStocks: cloud.customStocks,
            alerts: cloud.alerts,
            investmentPlan: cloud.investmentPlan ?? undefined
          });
          return;
        }
      }
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Error de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-500/10 rounded-2xl border border-teal-500/20 mb-4">
            <TrendingUp className="w-8 h-8 text-teal-400" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Portafolio <span className="text-teal-400">Bolsa de Santiago</span></h1>
          <p className="text-sm text-slate-400 mt-1">Sincroniza tu portafolio en la nube</p>
        </div>

        {/* Auth card */}
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            <button onClick={() => setMode('login')}
              className={`flex-1 py-3.5 text-sm font-bold transition text-center cursor-pointer ${
                mode === 'login' ? 'bg-white text-slate-900 border-b-2 border-b-teal-500' : 'bg-slate-50 text-slate-400 hover:text-slate-600'
              }`}>Iniciar Sesión</button>
            <button onClick={() => setMode('signup')}
              className={`flex-1 py-3.5 text-sm font-bold transition text-center cursor-pointer ${
                mode === 'signup' ? 'bg-white text-slate-900 border-b-2 border-b-teal-500' : 'bg-slate-50 text-slate-400 hover:text-slate-600'
              }`}>Crear Cuenta</button>
          </div>

          <div className="p-6">
            <form onSubmit={handleAuth} className="space-y-4">
              {mode === 'login' ? (
                <p className="text-xs text-slate-500">Ingresa con tu email y contraseña de Supabase.</p>
              ) : (
                <p className="text-xs text-slate-500">Crea una cuenta para guardar tu portafolio en la nube.</p>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Correo Electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="email" required placeholder="correo@ejemplo.com" value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-10 pr-3 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 text-slate-700 placeholder:text-slate-300 transition" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type={showPassword ? 'text' : 'password'} required placeholder="••••••••" value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-10 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 text-slate-700 placeholder:text-slate-300 transition" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition text-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {mode === 'login' ? 'Iniciando sesión...' : 'Creando cuenta...'}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {mode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Continue without account */}
        <div className="text-center mt-6">
          <button onClick={() => onLogin()}
            className="text-sm text-slate-400 hover:text-white transition cursor-pointer font-medium">
            Continuar sin cuenta <span className="text-slate-500">→</span>
          </button>
          <p className="text-[10px] text-slate-600 mt-2">Puedes usar la aplicación sin conexión a la nube.</p>
        </div>
      </div>
    </div>
  );
}
