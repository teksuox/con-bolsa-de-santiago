import React, { useState } from 'react';
import { TrendingUp, DollarSign, Wallet, Calendar, FileCheck, Cloud, Shield, Github, Lock, BarChart3, PieChart, ArrowRight, CheckCircle } from 'lucide-react';
import TermsPage from './TermsPage';

interface LandingPageProps {
  onStart: () => void;
}

export default function LandingPage({ onStart }: LandingPageProps) {
  const [showTerms, setShowTerms] = useState(false);

  if (showTerms) {
    return <TermsPage onBack={() => setShowTerms(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
      {/* Nav */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-slate-700/50">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center text-slate-900 font-extrabold text-sm">BS</div>
          <span className="font-bold text-sm">Bolsa de Santiago</span>
        </div>
        <button
          onClick={onStart}
          className="bg-teal-500 hover:bg-teal-400 text-slate-900 text-xs font-bold px-5 py-2 rounded-lg transition"
        >
          Ingresar
        </button>
      </div>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12 md:py-20">
        {/* Hero */}
        <div className="text-center mb-16 md:mb-24">
          <div className="inline-flex items-center space-x-1 bg-teal-500/10 border border-teal-500/20 rounded-full px-4 py-1.5 text-teal-400 text-xs font-semibold mb-6">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Portafolio para la Bolsa de Santiago</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6">
            Controla tus inversiones
            <br />
            <span className="text-teal-400">en la bolsa chilena</span>
          </h1>
          <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto mb-8 leading-relaxed">
            Registra tus acciones, sigue precios en vivo, calcula rentabilidad, 
            dividendos e impuestos. Todo sincronizado a la nube, con respaldo local 
            y sin que tus datos salgan de tu control.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onStart}
              className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold px-8 py-3.5 rounded-xl text-sm transition flex items-center space-x-2 shadow-lg shadow-teal-500/20"
            >
              <span>Comenzar gratis</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-8 py-3.5 rounded-xl text-sm transition border border-slate-700"
            >
              Ver funcionalidades
            </button>
          </div>
        </div>

        {/* Features */}
        <div id="features" className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-16">
          {[
            { icon: BarChart3, title: 'Portafolio en vivo', desc: 'Precios actualizados desde Yahoo Finance cada 3 minutos. Ve el valor de tus acciones en tiempo real.' },
            { icon: DollarSign, title: 'Dividendos', desc: 'Sincroniza automáticamente las fechas de pago desde la bolsa. Lleva el control de lo recibido y lo estimado.' },
            { icon: FileCheck, title: 'Operación Renta', desc: 'Calcula devolución de impuestos SII. Registra tus dividendos y créditos fiscales para la declaración anual.' },
            { icon: PieChart, title: 'Rentabilidad P&L', desc: 'Gráfico histórico de ganancias y pérdidas con datos reales de cierre de Yahoo. Filtra por mes, año o rango personalizado.' },
            { icon: Wallet, title: 'Plan de Inversión', desc: 'Define tu presupuesto mensual y asignación por ticker. Visualiza tu progreso y ajusta tu estrategia.' },
            { icon: Cloud, title: 'Respaldo Cloud + Local', desc: 'Datos sincronizados a Supabase con cifrado. Respaldo automático en localStorage. Sin pérdida de información.' },
          ].map((feat, i) => {
            const Icon = feat.icon;
            return (
              <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 hover:bg-slate-800 transition">
                <div className="w-10 h-10 bg-teal-500/10 rounded-lg flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5 text-teal-400" />
                </div>
                <h3 className="font-bold text-sm mb-1.5">{feat.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{feat.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Security / Privacy */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 md:p-8 mb-16">
          <div className="flex items-center space-x-2 mb-4">
            <Shield className="w-5 h-5 text-teal-400" />
            <h2 className="font-bold text-sm">Privacidad y seguridad de tus datos</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4 text-xs text-slate-400">
            <div className="flex items-start space-x-2.5">
              <CheckCircle className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
              <span>Tus datos financieros (acciones, dividendos, impuestos) <strong className="text-slate-300">no se comparten con terceros ni se venden</strong>.</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <CheckCircle className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
              <span>La información se almacena en Supabase (proveedor cloud con cifrado en reposo y tránsito).</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <CheckCircle className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
              <span>Puedes eliminar todos tus datos en cualquier momento desde la sección Respaldo Cloud.</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <CheckCircle className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
              <span>Sin telemetría ni tracking de uso. Tus datos son solo tuyos.</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>&copy; {new Date().getFullYear()} Bolsa de Santiago Portafolio</span>
          <button onClick={() => setShowTerms(true)} className="hover:text-slate-300 transition underline underline-offset-2">
            Términos y condiciones
          </button>
        </div>
      </footer>
    </div>
  );
}
