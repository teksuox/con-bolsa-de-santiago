import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { supabaseService } from '../lib/supabaseService';
import {
  Cloud,
  Save,
  RotateCw,
  AlertTriangle,
  Lock,
  CheckCircle,
  Mail,
  Radio,
  ArrowRight,
  LogOut,
  Database,
  Download,
  Upload,
  Trash2,
  Check
} from 'lucide-react';

interface SupabaseSyncProps {
  onImport: (data: any) => void;
  getBackupData: () => any;
  onExportBackup?: () => void;
  onImportBackup?: (content: string) => Promise<void>;
  onClearAllData?: () => void;
}

export default function SupabaseSync({ onImport, getBackupData, onExportBackup, onImportBackup, onClearAllData }: SupabaseSyncProps) {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setLoading(true);
    setStatusMessage('Iniciando sesión en Supabase...');
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      setSuccessMessage('¡Sesión iniciada con éxito!');
      setStatusMessage('');

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const cloud = await supabaseService.pullAll();
        if (cloud.holdings.length > 0) {
          if (window.confirm('📍 Datos en la nube detectados\n\nHemos encontrado un respaldo de tu portafolio guardado en tu cuenta.\n\n¿Deseas descargar e importar estos datos ahora?')) {
            onImport({
              holdings: cloud.holdings,
              dividends: cloud.dividends,
              refunds: cloud.refunds,
              annualPerformancePercent: cloud.settings?.annualPerformancePercent ?? 8.5,
              customStocks: cloud.customStocks,
              alerts: cloud.alerts,
              investmentPlan: cloud.investmentPlan ?? undefined
            });
            setSuccessMessage('¡Portafolio sincronizado desde la nube!');
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    if (password.length < 8) { setErrorMessage('La contraseña debe tener mínimo 8 caracteres.'); return; }
    setLoading(true);
    setStatusMessage('Creando usuario en Supabase...');
    try {
      const { error: err } = await supabase.auth.signUp({ email, password });
      if (err) throw err;
      setSuccessMessage('¡Registro exitoso!');
      setStatusMessage('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al crear la cuenta.');
      setStatusMessage('');
    } finally {
      setLoading(false);
    }
  };

  const handleLogOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setSuccessMessage('Sesión cerrada correctamente.');
  };

  const handleUpload = async () => {
    const data = getBackupData();
    if (!data) { setErrorMessage('No hay datos para subir'); return; }
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('Sincronizando datos con Supabase...');
    try {
      // Sync each entity individually
      const promises: Promise<any>[] = [];
      for (const h of data.holdings) promises.push(supabaseService.syncHolding(h));
      for (const d of data.dividends || []) promises.push(supabaseService.syncDividend(d));
      for (const r of data.refunds || []) promises.push(supabaseService.syncRefund(r));
      for (const a of data.alerts || []) promises.push(supabaseService.syncAlert(a));
      for (const s of data.customStocks || []) promises.push(supabaseService.syncCustomStock(s));
      promises.push(supabaseService.syncSettings({ annualPerformancePercent: data.annualPerformancePercent }));
      if (data.investmentPlan) promises.push(supabaseService.syncInvestmentPlan(data.investmentPlan));
      await Promise.all(promises);
      setSuccessMessage('¡Datos sincronizados correctamente con Supabase!');
      setStatusMessage('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al sincronizar. ¿Tienes las tablas creadas?');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('Obteniendo datos desde la nube...');
    try {
      const cloud = await supabaseService.pullAll();
      const hasData = cloud.holdings.length > 0 || cloud.dividends.length > 0 || cloud.refunds.length > 0;
      if (!hasData) { setErrorMessage('No hay datos guardados en esta cuenta.'); setLoading(false); return; }
      if (!window.confirm('⚠️ ¿Estás seguro de que deseas reemplazar todos tus datos locales con los guardados en la nube? Esto sobrescribirá acciones, dividendos e impuestos vigentes.')) {
        setLoading(false); return;
      }
      // Import the data
      onImport({
        holdings: cloud.holdings,
        dividends: cloud.dividends,
        refunds: cloud.refunds,
        annualPerformancePercent: cloud.settings?.annualPerformancePercent ?? 8.5,
        customStocks: cloud.customStocks,
        alerts: cloud.alerts,
        investmentPlan: cloud.investmentPlan ?? undefined
      });
      setSuccessMessage('¡Datos descargados y restaurados localmente con éxito!');
      setStatusMessage('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al descargar el respaldo.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChangeForBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportBackup) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        JSON.parse(text);
        await onImportBackup(text);
        setImportStatus('success');
        setTimeout(() => setImportStatus('idle'), 4000);
      } catch (err: any) {
        setImportStatus('error');
        setImportError(err?.message || 'Archivo de respaldo dañado o incorrecto.');
        setTimeout(() => setImportStatus('idle'), 4000);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClearClick = async () => {
    if (!showClearConfirm) { setShowClearConfirm(true); return; }
    if (onClearAllData) await onClearAllData();
    setShowClearConfirm(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden text-slate-800">
      {/* Header Banner */}
      <div className="bg-slate-900 px-6 py-5 border-b border-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-teal-500 text-slate-950 rounded-xl">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">Sincronización en Nube</h3>
            <p className="text-[11px] text-slate-400 font-medium">Guarda tu portafolio, estados y dividendos en Supabase</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 bg-slate-950/65 border border-slate-800 px-3 py-1.5 rounded-lg text-[10px] font-mono text-zinc-300 self-start sm:self-auto">
          <Radio className={`w-3.5 h-3.5 shrink-0 ${session ? 'text-emerald-400' : 'text-rose-500'}`} />
          <span>Status: {session ? 'CLOUD ONLINE' : 'CLOUD OFFLINE'}</span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Auth Panel */}
        {!session ? (
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
            <div className="flex border-b border-slate-200 bg-slate-50">
              <button onClick={() => setAuthTab('login')}
                className={`flex-1 py-3 text-xs font-extrabold transition text-center border-r border-slate-200 cursor-pointer ${
                  authTab === 'login' ? 'bg-white text-slate-900 border-b-2 border-b-teal-500' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                }`}>Iniciar Sesión</button>
              <button onClick={() => setAuthTab('signup')}
                className={`flex-1 py-3 text-xs font-extrabold transition text-center cursor-pointer ${
                  authTab === 'signup' ? 'bg-white text-slate-900 border-b-2 border-b-teal-500' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                }`}>Crear Cuenta</button>
            </div>
            <div className="p-6">
              {authTab === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed mb-1">Ingresa con tu email de Supabase.</p>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                      <input type="email" required placeholder="correo@ejemplo.com" value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg pl-9.5 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Contraseña</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                      <input type="password" required placeholder="••••••••" value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg pl-9.5 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700" />
                    </div>
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg transition text-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {loading ? 'Conectando...' : 'Iniciar Sesión'} <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSignUp} className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed mb-1">Crea una cuenta en Supabase. Tus datos se guardarán de forma privada.</p>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Correo Electrónico</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                      <input type="email" required placeholder="inversor@bolsa.cl" value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg pl-9.5 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Contraseña (Mínimo 8 caracteres)</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                      <input type="password" required placeholder="••••••••" value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg pl-9.5 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700" />
                    </div>
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-slate-950 font-black rounded-lg transition text-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {loading ? 'Creando cuenta...' : 'Registrarse'} <CheckCircle className="w-4 h-4" />
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : (
          /* Logged In Dashboard */
          <div className="border border-emerald-200 rounded-xl overflow-hidden shadow-sm bg-emerald-50/20 p-5 space-y-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-150 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  {session.user?.email?.substring(0, 2).toUpperCase() || 'CL'}
                </div>
                <div>
                  <h5 className="text-[13px] font-extrabold text-slate-900">Autenticado en Supabase</h5>
                  <p className="text-[11px] text-slate-500 font-medium">{session.user?.email}</p>
                </div>
              </div>
              <button onClick={handleLogOut}
                className="text-[11px] font-bold text-slate-500 hover:text-rose-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer flex items-center gap-1">
                <LogOut className="w-3.5 h-3.5" /> Cerrar Sesión
              </button>
            </div>

            {/* Auto-sync toggle */}
            <div className="bg-white border border-slate-150 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5 select-none cursor-pointer" htmlFor="auto-sync-toggle">
                  <Radio className="w-4 h-4 text-teal-600" />
                  Forzar Sincronización Completa
                </label>
                <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                  Cada cambio se sincroniza individualmente con Supabase. Este botón fuerza un guardado completo de todos los datos.
                </p>
              </div>
              <button onClick={handleUpload} disabled={loading}
                className="text-xs font-extrabold text-slate-950 bg-teal-400 hover:bg-teal-500 transition px-4 py-2 rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-sm">
                <Save className="w-3.5 h-3.5" /> {loading ? 'Sincronizando...' : 'Sincronizar Todo'}
              </button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-150 p-4 rounded-xl space-y-3.5 flex flex-col justify-between">
                <div className="space-y-1">
                  <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Subir a la nube</span>
                  <p className="text-xs font-bold text-slate-900">Forzar Guardado Manual</p>
                  <p className="text-[10px] text-slate-400 leading-normal">Sube tu portafolio a Supabase. Sobrescribirá respaldos anteriores.</p>
                </div>
                <button onClick={handleUpload} disabled={loading}
                  className="w-full text-xs font-extrabold text-slate-950 bg-teal-400 hover:bg-teal-500 transition px-4 py-2 rounded-lg cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-sm">
                  <Save className="w-3.5 h-3.5" /> {loading ? 'Guardando...' : 'Guardar en Nube'}
                </button>
              </div>
              <div className="bg-white border border-slate-150 p-4 rounded-xl space-y-3.5 flex flex-col justify-between">
                <div className="space-y-1">
                  <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Descargar de la nube</span>
                  <p className="text-xs font-bold text-slate-900">Restaurar Datos</p>
                  <p className="text-[10px] text-slate-400 leading-normal">Descarga tus activos, dividendos e impuestos guardados en Supabase.</p>
                </div>
                <button onClick={handleDownload} disabled={loading}
                  className="w-full text-xs font-extrabold text-white bg-slate-900 hover:bg-slate-800 transition px-4 py-2 rounded-lg cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-sm">
                  <RotateCw className="w-3.5 h-3.5" /> {loading ? 'Descargando...' : 'Descargar de Nube'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Feedback messages */}
        {errorMessage && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-4 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            <span className="font-semibold">{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-4 rounded-xl flex items-start gap-2">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            <span className="font-semibold">{successMessage}</span>
          </div>
        )}
        {statusMessage && (
          <div className="bg-slate-950 text-slate-300 font-mono text-[10px] p-3 rounded-lg border border-slate-800 flex items-center justify-between shadow-inner">
            <span>📟 {statusMessage}</span>
          </div>
        )}
      </div>

      {/* Local Backup Section */}
      <div className="bg-white border-t border-slate-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center space-x-1.5">
            <Database className="w-4 h-4 text-slate-700" />
            <h3 className="font-bold text-slate-800 text-sm">Respaldo y Restauración</h3>
          </div>
          <span className="text-[10px] bg-sky-100 text-sky-700 font-mono px-1.5 py-0.5 rounded font-bold">Supabase</span>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[11px] text-slate-400 leading-relaxed">Tus datos nunca salen de tu navegador. Disfruta de total privacidad y mantén copias de seguridad.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Export */}
            <div className="bg-slate-50/70 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-800 block uppercase tracking-wider">Exportar Respaldo</span>
                <p className="text-[9px] text-slate-400 mt-0.5 leading-normal">Descarga tus datos en un archivo JSON local.</p>
              </div>
              <button onClick={onExportBackup}
                className="mt-2.5 flex items-center justify-center space-x-1.5 w-full bg-slate-900 text-white font-medium hover:bg-slate-800 text-[10px] py-2 rounded-md transition cursor-pointer">
                <Download className="w-3.5 h-3.5" />
                <span>Guardar Respaldo (.json)</span>
              </button>
            </div>
            {/* Import */}
            <div className="bg-slate-50/70 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-800 block uppercase tracking-wider">Restaurar Respaldo</span>
                <p className="text-[9px] text-slate-400 mt-0.5 leading-normal">Sube tu archivo para recuperar tu portafolio.</p>
              </div>
              <div className="mt-2.5">
                <input type="file" ref={fileInputRef} onChange={handleFileChangeForBackup} accept=".json" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center space-x-1.5 w-full bg-white text-slate-800 border border-slate-200 font-semibold hover:bg-slate-50 text-[10px] py-2 rounded-md transition cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  <span>Cargar Archivo Respaldo</span>
                </button>
                {importStatus === 'success' && (
                  <div className="mt-1.5 text-[9px] text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 p-1 rounded">
                    <Check className="w-3 h-3" /> ¡Respaldo importado con éxito!
                  </div>
                )}
                {importStatus === 'error' && (
                  <div className="mt-1.5 text-[9px] text-rose-600 font-medium bg-rose-50 p-1 rounded leading-normal">
                    ⚠ Error: {importError}
                  </div>
                )}
              </div>
            </div>
            {/* Reset */}
            <div className="bg-slate-50/70 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-rose-800 block uppercase tracking-wider">Reiniciar Aplicación</span>
                <p className="text-[9px] text-slate-400 mt-0.5 leading-normal">Borra todo tu portafolio. Acción irreversible.</p>
              </div>
              <div className="mt-2.5">
                {showClearConfirm ? (
                  <div className="space-y-1">
                    <button onClick={handleClearClick}
                      className="flex items-center justify-center space-x-1.5 w-full bg-rose-600 text-white font-medium hover:bg-rose-700 text-[10px] py-1.5 rounded-md transition cursor-pointer">
                      <Trash2 className="w-3 h-3" /> <span>Confirmar Borrado</span>
                    </button>
                    <button onClick={() => setShowClearConfirm(false)}
                      className="text-center block text-[9px] text-slate-500 hover:underline w-full py-0.5 cursor-pointer">Cancelar</button>
                  </div>
                ) : (
                  <button onClick={handleClearClick}
                    className="flex items-center justify-center space-x-1.5 w-full bg-rose-50 text-rose-700 border border-rose-200 font-medium hover:bg-rose-100 text-[10px] py-2 rounded-md transition cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" /> <span>Vaciar Datos</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
