# Documentación del Proyecto — Portafolio Bolsa de Santiago

## Resumen para el Usuario

App web para gestionar un portafolio de inversiones en la Bolsa de Santiago.
Permite registrar acciones, ver precios en vivo, calcular rentabilidad, proyectar dividendos e impuestos, con sincronización a la nube.

### Funcionalidades por Sección

| Sección | Descripción |
|---------|-------------|
| **Resumen** | Dashboard con gráfico de evolución del portafolio (semana/mes/año), **gráfico intradiario hoy** (snapshots cada 3 min), **benchmark IPSA** (toggle overlay), rentabilidad, concentración por sector, métricas compactas |
| **Mi Portafolio** | CRUD de acciones: registrar compras (ticker, cantidad, precio, fecha), editar precio actual, ver rentabilidad por posición, plusvalía/minusvalía, cambio diario, % del portafolio |
| **Bolsa de Santiago** | Cotizaciones en vivo desde Yahoo Finance. Buscar y agregar cualquier ticker chileno. Alertas de precio con notificación sonora. Filtros por sector/portafolio. "Simular Compra" agrega 1 acción al portafolio. Expandir para ver chart histórico |
| **Plan de Inversión** | Sub-tab **Asignación**: presupuesto mensual, distribuir % entre acciones. Sub-tab **Proyección**: tabla 25 años con dividendos, impuesto Global Complementario progresivo, meta de sueldo mensual. Parámetros editables: capital, aporte mensual, aumento anual, años, meta. Checkboxes: incluir crédito fiscal, seguir aportando tras meta, aporte suma a la meta |
| **Dividendos** | Sub-tab **Lista**: tabla de dividendos agrupados por ticker, editar montos/fechas, sincronizar desde Yahoo. Sub-tab **Calendario**: grid mensual con pagos, navegación entre meses/años, suma mensual y anual |
| **Operación Renta** | Registro de devoluciones de impuestos (año, monto, fecha, estado). Caja educativa sobre crédito IDPC 27% y Global Complementario |
| **Historial** | Sub-tab **Ganancias y Pérdidas**: tabla diaria con valor cartera, cambio $ y %, filtro por período. Sub-tab **Dividendos**: histórico de dividendos recibidos |
| **Respaldo Cloud** | Login Supabase, subir/bajar datos, exportar/importar JSON, limpiar datos. Sincronización automática Realtime |

### Flujo de Datos

```
Yahoo Finance API ←→ Servidor Express (server.ts) ←→ Cliente React (App.tsx)
                         ↕                            ↕
                   Supabase (cloud DB)        localStorage (offline backup)
```

- Los precios se actualizan cada 3 minutos automáticamente
- Cada refresh captura un snapshot intradiario del valor del portafolio (guardado en localStorage)
- El gráfico intradiario se actualiza cada 30s desde localStorage (sin llamadas a la API)
- Botón "IPSA" en el gráfico de evolución compara rendimiento del portafolio vs IPSA
- Los cambios se guardan en localStorage inmediatamente y se sincronizan con Supabase en segundo plano
- Multi-dispositivo: los cambios hechos en otro dispositivo llegan vía WebSocket Realtime

### Tecnologías

React 19, TypeScript, Vite 6, Tailwind CSS v4, Express.js, Supabase (PostgreSQL + Auth + Realtime), Yahoo Finance API, mindicador.cl, Docker, PWA (Service Worker)

---

## Documentación Técnica para el Agente

### Reglas de Modificación (AGENTS.md)

1. Backup en git antes de modificar (`backup:` prefix)
2. `npx tsc --noEmit` después de cada cambio
3. `docker compose build --no-cache app && docker compose up -d`
4. Informar al usuario que los cambios están en vivo
5. Responder siempre en español

### Estructura del Proyecto

```
/
├── server.ts              # Servidor Express (857 líneas) - proxy Yahoo + static
├── src/
│   ├── main.tsx           # Entry point React + PWA
│   ├── App.tsx            # Componente principal (1487 líneas) - estado global
│   ├── types.ts           # Interfaces TypeScript
│   ├── utils.ts           # formatCLP, formatPercent, isMarketOpen, normalizeTicker
│   ├── data.ts            # Datos iniciales (10 acciones hardcodeadas)
│   ├── index.css          # Tailwind v4 + fuentes
│   ├── components/
│   │   ├── LandingPage.tsx         # Página de aterrizaje
│   │   ├── LoginPage.tsx           # Login/Signup Supabase Auth
│   │   ├── Header.tsx              # Navegación + indicadores (UF, Dólar)
│   │   ├── MyPortfolio.tsx         # CRUD portafolio (851 líneas)
│   │   ├── MarketWatch.tsx         # Cotizaciones en vivo (553 líneas)
│   │   ├── ChartsAndAnalytics.tsx  # Dashboard gráficos (462 líneas)
│   │   ├── DividendTracker.tsx     # Dividendos lista+calendario (870 líneas)
│   │   ├── DividendHistory.tsx     # Historial dividendos
│   │   ├── TaxRefunds.tsx          # Operación Renta
│   │   ├── ProfitHistory.tsx       # P&L histórico (489 líneas)
│   │   ├── HistoryPage.tsx         # Contenedor historial con sub-tabs
│   │   ├── StockHistoryVisualizer.tsx  # Chart precio histórico (498 líneas)
│   │   ├── InvestmentPlan.tsx      # Plan inversión + proyección (~800 líneas)
│   │   ├── SupabaseSync.tsx        # Sincronización cloud (447 líneas)
│   │   ├── TermsPage.tsx           # Términos y condiciones
│   │   └── Header.tsx              # Header con tabs e indicadores
│   ├── lib/
│   │   ├── supabase.ts             # Cliente Supabase
│   │   ├── supabaseService.ts      # Capa CRUD genérica (283 líneas)
│   │   ├── supabaseRealtime.ts     # Suscripciones WebSocket
│   │   ├── useSortable.ts          # Hook para tablas ordenables
│   │   ├── dailySave.ts            # Auto-guardado diario a Supabase
│   │   └── intradaySnapshot.ts     # Snapshots intradiarios (cada 3 min en localStorage)
│   └── utils/
│       └── stockHistory.ts         # Generación de historial simulado
├── public/
│   ├── sw.js                       # Service Worker PWA
│   ├── manifest.json               # Manifest PWA
│   └── icon-*.png / icon.svg       # Iconos
├── sql/                            # Esquema SQL de Supabase (8 tablas)
├── scripts/test-supabase.mjs       # Script de prueba
├── docker-compose.yml              # Producción (puerto 3003)
├── Dockerfile                       # Multi-stage build
├── package.json                    # Dependencias y scripts
├── tsconfig.json / vite.config.ts  # Config TS + Vite
└── .env                            # Variables de entorno locales
```

### Estado Global (App.tsx)

**Variables de estado principales:**
- `holdings: StockHolding[]` — acciones del portafolio
- `dividends: DividendPayment[]` — dividendos registrados
- `refunds: TaxRefund[]` — devoluciones de impuestos
- `marketStocks: MarketStock[]` — cotizaciones de Yahoo
- `alerts: StockAlert[]` — alarmas de precio
- `searchedTickers: Set<string>` — tickers buscados por el usuario
- `showLoginPage`, `showLanding` — navegación

**Handlers CRUD (todos en App.tsx):**
- `handleAddHolding`, `handleUpdateHoldingPrice`, `handleResetManualPrice`, `handleUpdateHoldingYield`, `handleDeleteHolding`
- `handleAddDividend`, `handleUpdateDividend`, `handleToggleReceived`, `handleDeleteDividend`
- `handleAddRefund`, `handleDeleteRefund`
- `handleToggleAlert`, `handleUpdateTargetPrice`, `handleResetAlert`
- `handleSearchAndAddStock`, `handleRefreshSingleStock`, `handleDeleteMarketStock`, `handleRestoreAllMarketStocks`
- `handleRefreshMarketData`, `handleSyncDividends`
- `handleExportBackup`, `handleImportBackup`, `handleClearAllData`

**Efectos clave:**
- **Mount**: carga localStorage → Supabase → fetch cotizaciones
- **Auto-refresh 3min**: polling silencioso a `/api/market-stocks`
- **Realtime**: suscripciones a cambios en Supabase (sync multi-dispositivo)
- **Auto-backfill**: una vez al día envía historial faltante
- **URL routing**: sincroniza `window.history` con tab activa
- **Session heartbeat**: cada 30s verifica sesión Supabase

### Servidor Express (server.ts)

**Endpoints:**

| Ruta | Función |
|------|---------|
| `GET /api/market-stocks?additional=TICKER` | Cotizaciones de Yahoo Finance para tickers IPSA + adicionales |
| `GET /api/search-stock?q=TICKER` | Busca ticker individual en Yahoo |
| `GET /api/chile-indicators` | UF, UTM, Dólar (mindicador.cl) + IPSA (Yahoo) |
| `GET /api/portfolio-history?tickers=X&range=6mo` | Historial precios diarios desde Yahoo |
| `POST /api/sync-dividends` | Sincroniza dividendos históricos y estimados desde Yahoo |
| `POST /api/backfill-history` | Rellena datos históricos faltantes en Supabase |

**Caché en servidor:**
- `stockCache`: TTL 1.5 min para cotizaciones
- `indicatorsCache`: TTL 1 hora para UF, UTM, Dólar
- Supabase `market_data` tabla como caché persistente de historial

**Alias de tickers Yahoo:**
`CENCOSHOP → CENCOMALLS`, y otros mapeos necesarios para que Yahoo reconozca los símbolos chilenos.

### Base de Datos Supabase (8 tablas)

| Tabla | PK | Descripción |
|-------|----|-------------|
| `holdings` | `id` | Acciones del portafolio (user_id, ticker, shares, buyPrice, currentPrice, etc.) |
| `dividends` | `id` | Dividendos (user_id, ticker, amountPerShare, payoutDate, received, estimated) |
| `refunds` | `id` | Devoluciones impuestos (user_id, year, amount, received) |
| `alerts` | `(user_id, ticker)` | Alarmas de precio (starredPrice, targetPrice, triggered) |
| `custom_stocks` | `(user_id, ticker)` | Acciones personalizadas buscadas |
| `settings` | `user_id` | Configuración (annualPerformancePercent) |
| `monthly_pnl` | `(user_id, month)` | Datos P&L por mes en JSONB |
| `investment_plans` | `user_id` | Plan de inversión en JSONB |
| `intraday_snapshots` | `(user_id, date)` | Snapshots intradiarios (JSONB) |
| `market_data` | `key` | Caché del servidor (sin RLS) |

Todas las tablas de usuario tienen RLS con política `user_id = auth.uid()` y Realtime habilitado.

### Cálculos Financieros

**Daily P&L:**
```
Si hay previousClose: dailyPnL = shares × (currentPrice - previousClose)
Si no: changePerShare = currentPrice × changePercent / (100 + changePercent)
       dailyPnL = shares × changePerShare
```

**Rentabilidad posición:**
```
absProfit = (currentPrice - buyPrice) × shares
relProfit = absProfit / (buyPrice × shares) × 100
```

**Valor portafolio:**
```
marketValue = Σ(shares × currentPrice)     // Valorización de Mercado
costBasis = Σ(shares × buyPrice)            // Capital Aportado Total
plusvalia = marketValue - costBasis
```

**Proyección de inversión (InvestmentPlan.tsx):**
```
Por cada año:
  annualContrib = monthly × months
  avgCap = cap + annualContrib / 2
  dividends = avgCap × yield × months / 12
  grossDiv = dividends / 0.73
  tax = calcTax(grossDiv)        // Según tramo SII
  credit = grossDiv × 0.27
  refund = credit - tax
  endCap = cap + effectiveContrib + reinvested
```

**Global Complementario (tramos SII AT 2026):**
```
Tramo 1:  $0 – $11.265.804     → 0%
Tramo 2:  $11.265.804 – $25.035.120  → 4%   (rebaja $450.632)
Tramo 3:  $25.035.120 – $41.725.200  → 8%   (rebaja $1.452.037)
Tramo 4:  $41.725.200 – $58.415.280  → 13.5% (rebaja $3.746.923)
Tramo 5:  $58.415.280 – $75.105.360  → 23%  (rebaja $9.296.375)
Tramo 6:  $75.105.360 – $100.140.480 → 30.4% (rebaja $14.854.171)
Tramo 7:  $100.140.480 – $258.696.240 → 35% (rebaja $19.460.633)
Tramo 8:  $258.696.240+ → 40% (rebaja $32.395.445)
```

**Merge Cloud-Local:**
`mergeByUpdatedAt<T>(local, cloud)` — para cada item, gana el que tenga `updatedAt` más reciente.

### Patrones de Código

1. **Optimistic UI**: estado se actualiza inmediatamente, sync a Supabase es fire-and-forget
2. **Dual persistence**: localStorage (instantáneo) + Supabase (persistente)
3. **Cache 3 niveles**: navegador (localStorage/sessionStorage) → servidor (memoria) → Supabase (market_data)
4. **ID prefix system**: `h-` (holdings), `div-` (manual), `div-sys-` (sincronizado), `tax-` (refunds)
5. **URL routing**: sin React Router, usa `history.replaceState` + `popstate`
6. **Manual price lock**: `manualPrice: true` evita que auto-refresh sobrescriba precio editado

### Scripts de Desarrollo

```bash
npm run dev          # Inicia servidor + Vite en modo desarrollo
npm run build        # Build producción (Vite + esbuild server)
npm run start        # Inicia servidor en producción
npx tsc --noEmit     # TypeScript check
```

### Docker

```bash
docker compose build --no-cache app && docker compose up -d
```

Puerto mapeado: `3003:3003`. Puerto interno: `3002` (definido en `.env`).
