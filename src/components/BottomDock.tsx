import {
  ChevronDown,
  ChevronUp,
  Clock,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  METRIC_META,
  PaymentMetric,
  TimeMode,
} from '../types/payments';
import { DiurnalThemeState, formatHourToClock } from '../utils/timeTheme';

interface BottomDockProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeMetric: PaymentMetric;
  onChangeMetric: (metric: PaymentMetric) => void;
  timeMode: TimeMode;
  onChangeTimeMode: (mode: TimeMode) => void;
  hourFloat: number;
  onScrubHour: (hour: number) => void;
  theme: DiurnalThemeState;
  canResetToWorld: boolean;
  onResetWorld: () => void;
}

const METRICS_ORDER: PaymentMetric[] = [
  PaymentMetric.VOLUME,
  PaymentMetric.AMOUNT,
  PaymentMetric.CUSTOMER_COUNT,
  PaymentMetric.MERCHANT_COUNT,
];

const TIME_PRESETS = [
  { label: 'Dawn', hour: 6.5 },
  { label: 'Day', hour: 13.0 },
  { label: 'Dusk', hour: 18.25 },
  { label: 'Night', hour: 23.0 },
];

export function BottomDock({
  collapsed,
  onToggleCollapse,
  activeMetric,
  onChangeMetric,
  timeMode,
  onChangeTimeMode,
  hourFloat,
  onScrubHour,
  theme,
  canResetToWorld,
  onResetWorld,
}: BottomDockProps) {
  const isLight = theme.isLightUI;

  const surfaceClass = isLight
    ? 'border-slate-300/85 bg-[#f8fafc]/95 text-slate-900'
    : 'border-slate-700/75 bg-[#0b1120]/94 text-slate-100';

  const segBgClass = isLight ? 'bg-slate-200/80' : 'bg-slate-900/90';
  const activeSegClass = isLight
    ? 'bg-white text-slate-950 shadow-sm'
    : 'bg-sky-500 text-slate-950 shadow-sm';
  const inactiveSegClass = isLight
    ? 'text-slate-700 hover:text-slate-950'
    : 'text-slate-300 hover:text-white';

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex w-[min(900px,94vw)] -translate-x-1/2 flex-col items-center">
      {/* Collapse / Expand Handle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className={`pointer-events-auto mb-1.5 flex items-center gap-1.5 rounded-t-lg border px-3 py-1 text-xs font-medium shadow-sm transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${surfaceClass}`}
      >
        {collapsed ? (
          <>
            <ChevronUp className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
            <span>Show Controls (H)</span>
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
            <span>Hide Controls (H)</span>
          </>
        )}
      </button>

      {/* Main Dock Body */}
      <div
        className={`pointer-events-auto w-full rounded-xl border px-4 py-3 shadow-lg transition-transform duration-200 ease-out ${surfaceClass} ${
          collapsed ? 'translate-y-[120%] pointer-events-none opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="flex flex-col gap-3">
          {/* Row 1: 3D Pillar Metric Focus + View Reset */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  isLight ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                3D Height Metric
              </span>
              <div className={`flex items-center gap-1 rounded-lg p-1 ${segBgClass}`}>
                {METRICS_ORDER.map((m) => {
                  const isActive = activeMetric === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onChangeMetric(m)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                        isActive ? activeSegClass : inactiveSegClass
                      }`}
                    >
                      {METRIC_META[m].shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {canResetToWorld && (
              <button
                type="button"
                onClick={onResetWorld}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                  isLight
                    ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <RotateCcw className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                <span>World Overview</span>
              </button>
            )}
          </div>

          <div
            className={`h-px w-full ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}
            aria-hidden="true"
          />

          {/* Row 2: Diurnal Time-of-Day Automatic Transition Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className={`flex items-center gap-1 rounded-lg p-1 ${segBgClass}`}>
                <button
                  type="button"
                  onClick={() => onChangeTimeMode(TimeMode.BROWSER_CLOCK)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                    timeMode === TimeMode.BROWSER_CLOCK ? activeSegClass : inactiveSegClass
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Local Clock</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeTimeMode(
                      timeMode === TimeMode.AUTO_CYCLE
                        ? TimeMode.MANUAL
                        : TimeMode.AUTO_CYCLE
                    )
                  }
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                    timeMode === TimeMode.AUTO_CYCLE ? activeSegClass : inactiveSegClass
                  }`}
                >
                  {timeMode === TimeMode.AUTO_CYCLE ? (
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>Auto-Transition</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTimeMode(TimeMode.MANUAL)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                    timeMode === TimeMode.MANUAL ? activeSegClass : inactiveSegClass
                  }`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Manual</span>
                </button>
              </div>
            </div>

            {/* 24h Scrubber */}
            <div className="flex min-w-[210px] flex-1 items-center gap-2.5">
              <label htmlFor="diurnal-hour-slider" className="sr-only">
                Time of day hour
              </label>
              <input
                id="diurnal-hour-slider"
                type="range"
                min={0}
                max={23.95}
                step={0.05}
                value={hourFloat}
                onChange={(e) => {
                  onChangeTimeMode(TimeMode.MANUAL);
                  onScrubHour(parseFloat(e.target.value));
                }}
                className="h-1.5 w-full cursor-pointer accent-sky-500"
              />
              <span className="font-mono-tabular w-12 text-right text-xs font-semibold">
                {formatHourToClock(hourFloat)}
              </span>
            </div>

            {/* Phase Quick Jumps */}
            <div className="flex items-center gap-1">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    onChangeTimeMode(TimeMode.MANUAL);
                    onScrubHour(p.hour);
                  }}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                    isLight
                      ? 'text-slate-600 hover:bg-slate-200 hover:text-slate-950'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
