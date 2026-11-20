import { ChevronRight, Globe2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { BreadcrumbItem, HierarchyLevel } from '../types/payments';
import { DiurnalThemeState } from '../utils/timeTheme';

interface TopBarProps {
  breadcrumbs: BreadcrumbItem[];
  theme: DiurnalThemeState;
  inspectorOpen: boolean;
  onNavigateBreadcrumb: (item: BreadcrumbItem) => void;
  onToggleInspector: () => void;
}

export function TopBar({
  breadcrumbs,
  theme,
  inspectorOpen,
  onNavigateBreadcrumb,
  onToggleInspector,
}: TopBarProps) {
  const isLight = theme.isLightUI;

  return (
    <header className="pointer-events-none absolute top-4 left-4 right-4 z-20 flex flex-wrap items-start justify-between gap-3">
      <div
        className={`pointer-events-auto flex flex-col gap-1.5 rounded-xl border px-4 py-2.5 shadow-sm transition-colors duration-300 ${
          isLight
            ? 'border-slate-300/80 bg-[#f8fafc]/94 text-slate-900'
            : 'border-slate-700/70 bg-[#0b1120]/92 text-slate-100'
        }`}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() =>
              onNavigateBreadcrumb({
                level: HierarchyLevel.WORLD,
                id: 'world',
                label: 'World',
              })
            }
            className="flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 whitespace-nowrap shrink-0"
          >
            <Globe2 className="h-4 w-4 text-sky-500 shrink-0" aria-hidden="true" />
            <span className="font-display text-sm font-bold tracking-tight whitespace-nowrap">
              Meridian PayAtlas
            </span>
          </button>

          <span
            className={`text-xs font-mono-tabular whitespace-nowrap ${
              isLight ? 'text-slate-600' : 'text-slate-400'
            }`}
          >
            {theme.formattedTime} <span aria-hidden="true">·</span> {theme.phaseLabel}
          </span>
        </div>

        <nav aria-label="Geographic drill-down breadcrumb" className="flex flex-wrap items-center gap-1 text-xs">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <span key={`${crumb.level}-${crumb.id}`} className="flex items-center gap-1">
                {idx > 0 && (
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isLight ? 'text-slate-400' : 'text-slate-500'
                    }`}
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onNavigateBreadcrumb(crumb)}
                  disabled={isLast}
                  className={`rounded px-1.5 py-0.5 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                    isLast
                      ? isLight
                        ? 'font-semibold text-slate-900 cursor-default'
                        : 'font-semibold text-white cursor-default'
                      : isLight
                        ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  {crumb.label}
                </button>
              </span>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        onClick={onToggleInspector}
        aria-label={inspectorOpen ? 'Hide payments breakdown panel' : 'Show payments breakdown panel'}
        className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-sm transition-colors duration-200 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
          isLight
            ? 'border-slate-300/80 bg-[#f8fafc]/94 text-slate-800 hover:bg-white'
            : 'border-slate-700/70 bg-[#0b1120]/92 text-slate-200 hover:bg-slate-900'
        }`}
      >
        {inspectorOpen ? (
          <>
            <PanelRightClose className="h-4 w-4 text-sky-500" aria-hidden="true" />
            <span>Hide Data Panel</span>
          </>
        ) : (
          <>
            <PanelRightOpen className="h-4 w-4 text-sky-500" aria-hidden="true" />
            <span>Show Data Panel</span>
          </>
        )}
      </button>
    </header>
  );
}
