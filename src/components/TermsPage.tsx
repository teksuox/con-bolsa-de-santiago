import React from 'react';
import { ArrowLeft, Shield, Lock, Database, Trash2, FileText, Mail } from 'lucide-react';

interface TermsPageProps {
  onBack: () => void;
}

export default function TermsPage({ onBack }: TermsPageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-slate-700/50">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver</span>
        </button>
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-slate-900 font-extrabold text-xs">BS</div>
          <span className="font-bold text-xs">Bolsa de Santiago</span>
        </div>
      </div>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        <div className="flex items-center space-x-2 mb-8">
          <FileText className="w-5 h-5 text-teal-400" />
          <h1 className="text-xl font-extrabold">Términos y condiciones de uso</h1>
        </div>

        <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
          {/* 1. Aceptación */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">1. Aceptación de los términos</h2>
            <p>
              Al utilizar esta aplicación ("Bolsa de Santiago Portafolio"), declaras haber leído, entendido y aceptado 
              los presentes términos y condiciones. Si no estás de acuerdo, no debes usar la aplicación.
            </p>
          </section>

          {/* 2. Datos */}
          <section className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center space-x-2 mb-4">
              <Shield className="w-5 h-5 text-teal-400" />
              <h2 className="text-white font-bold text-base">2. Uso de tus datos</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start space-x-2.5">
                <Lock className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white">No venta de datos:</strong> Nosotros <strong className="text-teal-400">no vendemos, alquilamos, cedemos ni compartimos</strong> tus datos personales o financieros con terceros bajo ninguna circunstancia. 
                  La información que registras (acciones, dividendos, rentabilidad) es exclusivamente para tu uso dentro de la aplicación.
                </div>
              </div>
              <div className="flex items-start space-x-2.5">
                <Database className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white">Almacenamiento:</strong> Tus datos se guardan en Supabase (proveedor cloud con cifrado en reposo y en tránsito) 
                  y en tu navegador (localStorage) como respaldo local. No hay servidores propios ni terceros con acceso.
                </div>
              </div>
              <div className="flex items-start space-x-2.5">
                <Trash2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white">Eliminación:</strong> Puedes eliminar todos tus datos en cualquier momento desde la sección "Respaldo Cloud" dentro de la aplicación. 
                  Esto borra tu información de la nube y del almacenamiento local.
                </div>
              </div>
              <div className="flex items-start space-x-2.5">
                <Mail className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white">Correo electrónico:</strong> Tu correo se usa únicamente para la autenticación (inicio de sesión) 
                  a través de Supabase Auth. No se usa para newsletters, marketing ni ningún otro propósito.
                </div>
              </div>
            </div>
          </section>

          {/* 3. Responsabilidad */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">3. Sin asesoría financiera</h2>
            <p>
              Esta aplicación es una herramienta de registro y seguimiento. <strong className="text-white">No proporciona asesoría financiera, 
              recomendaciones de inversión ni garantiza rentabilidades futuras</strong>. Toda decisión de inversión es responsabilidad exclusiva del usuario.
            </p>
          </section>

          {/* 4. Exactitud */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">4. Exactitud de la información</h2>
            <p>
              Los precios de acciones provienen de Yahoo Finance y la Bolsa de Santiago (BCS). 
              Si bien se actualizan periódicamente, pueden presentar retrasos o diferencias con el valor real de mercado. 
              No garantizamos la exactitud absoluta de los datos mostrados.
            </p>
          </section>

          {/* 5. Privacidad */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">5. Privacidad y tracking</h2>
            <p>
              La aplicación <strong className="text-white">no utiliza cookies de tracking, analytics de terceros ni recopila información de navegación</strong>. 
              No hay publicidad, ni seguimiento de comportamiento. Toda la lógica se ejecuta en tu navegador o en el servidor propio.
            </p>
          </section>

          {/* 6. Seguridad */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">6. Seguridad</h2>
            <p>
              La conexión entre tu navegador y el servidor utiliza HTTPS. Las contraseñas son gestionadas por Supabase Auth 
              (hash bcrypt, session JWT). 
              Eres responsable de mantener segura tu contraseña y sesión.
            </p>
          </section>

          {/* 7. Modificaciones */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">7. Cambios en los términos</h2>
            <p>
              Nos reservamos el derecho de modificar estos términos en cualquier momento. 
              Los cambios serán notificados dentro de la aplicación. El uso continuado después de los cambios constituye aceptación de los nuevos términos.
            </p>
          </section>

          {/* 8. Contacto */}
          <section>
            <h2 className="text-white font-bold text-base mb-2">8. Contacto</h2>
            <p>
              Ante cualquier duda sobre estos términos, puedes escribir al correo proporcionado en la sección de Respaldo Cloud de la aplicación.
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-700/50 text-center">
          <button
            onClick={onBack}
            className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold px-6 py-3 rounded-xl text-sm transition"
          >
            Volver
          </button>
          <p className="text-xs text-slate-500 mt-4">&copy; {new Date().getFullYear()} Bolsa de Santiago Portafolio</p>
        </div>
      </main>
    </div>
  );
}
