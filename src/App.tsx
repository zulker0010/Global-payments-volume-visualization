import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { HoverTooltip } from './components/HoverTooltip';
import { PaymentsInspector } from './components/PaymentsInspector';
import { TopBar } from './components/TopBar';
import {
  CONTINENTS,
  resolveSelectionData,
} from './data/paymentsDataset';
import {
  BreadcrumbItem,
  CityNode,
  CountryNode,
  HierarchyLevel,
  HoverInfo,
  LocalAreaNode,
  PaymentMetric,
  TimeMode,
} from './types/payments';
import { computeDiurnalTheme, getBrowserDecimalHour } from './utils/timeTheme';
import { GlobeScene } from './webgl/GlobeScene';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeScene | null>(null);
  const syntheticCountriesRef = useRef<Map<string, CountryNode>>(new Map());

  // Hierarchy selection state
  const [level, setLevel] = useState<HierarchyLevel>(HierarchyLevel.WORLD);
  const [continentId, setContinentId] = useState<string | null>(null);
  const [countryId, setCountryId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [localAreaId, setLocalAreaId] = useState<string | null>(null);

  // Metric & Diurnal time-of-day state
  const [activeMetric, setActiveMetric] = useState<PaymentMetric>(PaymentMetric.VOLUME);
  const [timeMode, setTimeMode] = useState<TimeMode>(TimeMode.BROWSER_CLOCK);
  const [hourFloat, setHourFloat] = useState<number>(() => getBrowserDecimalHour());

  // UI chrome state
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [contextLost, setContextLost] = useState<boolean>(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  const theme = useMemo(() => computeDiurnalTheme(hourFloat), [hourFloat]);

  // Sync Tailwind dark class on <html> with diurnal theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme.isLightUI) {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  }, [theme.isLightUI]);

  // Browser clock & Auto-Transition animation loop
  useEffect(() => {
    if (timeMode === TimeMode.MANUAL) return;

    if (timeMode === TimeMode.BROWSER_CLOCK) {
      setHourFloat(getBrowserDecimalHour());
      const id = window.setInterval(() => {
        setHourFloat(getBrowserDecimalHour());
      }, 15000);
      return () => window.clearInterval(id);
    }

    // TimeMode.AUTO_CYCLE: smooth continuous diurnal sweep
    let rafId = 0;
    let lastTime = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      setHourFloat((prev) => (prev + dt * 0.65) % 24);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [timeMode]);

  // Track viewport size for tooltip clamping
  useEffect(() => {
    const onResize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Navigation handlers
  const handleSelectWorld = useCallback(() => {
    setLevel(HierarchyLevel.WORLD);
    setContinentId(null);
    setCountryId(null);
    setCityId(null);
    setLocalAreaId(null);
    setHoverInfo(null);
  }, []);

  const handleSelectContinent = useCallback((contId: string) => {
    setLevel(HierarchyLevel.CONTINENT);
    setContinentId(contId);
    setCountryId(null);
    setCityId(null);
    setLocalAreaId(null);
    setHoverInfo(null);
  }, []);

  const handleSelectCountry = useCallback((country: CountryNode) => {
    syntheticCountriesRef.current.set(country.id, country);
    setLevel(HierarchyLevel.COUNTRY);
    setContinentId(country.continentId);
    setCountryId(country.id);
    setCityId(null);
    setLocalAreaId(null);
    setHoverInfo(null);
  }, []);

  const handleSelectCity = useCallback((city: CityNode) => {
    setLevel(HierarchyLevel.CITY);
    setCountryId(city.countryId);
    setCityId(city.id);
    setLocalAreaId(null);
    setHoverInfo(null);
  }, []);

  const handleSelectLocalArea = useCallback((area: LocalAreaNode) => {
    setLevel(HierarchyLevel.LOCAL_AREA);
    setLocalAreaId(area.id);
    setHoverInfo(null);
  }, []);

  const handleStepBack = useCallback(() => {
    setHoverInfo(null);
    if (level === HierarchyLevel.LOCAL_AREA) {
      setLevel(HierarchyLevel.CITY);
      setLocalAreaId(null);
    } else if (level === HierarchyLevel.CITY) {
      setLevel(HierarchyLevel.COUNTRY);
      setCityId(null);
      setLocalAreaId(null);
    } else if (level === HierarchyLevel.COUNTRY) {
      if (continentId) {
        setLevel(HierarchyLevel.CONTINENT);
        setCountryId(null);
      } else {
        handleSelectWorld();
      }
    } else if (level === HierarchyLevel.CONTINENT) {
      handleSelectWorld();
    }
  }, [level, continentId, handleSelectWorld]);

  const handleNavigateBreadcrumb = useCallback(
    (item: BreadcrumbItem) => {
      setHoverInfo(null);
      if (item.level === HierarchyLevel.WORLD) {
        handleSelectWorld();
      } else if (item.level === HierarchyLevel.CONTINENT) {
        handleSelectContinent(item.id);
      } else if (item.level === HierarchyLevel.COUNTRY) {
        setLevel(HierarchyLevel.COUNTRY);
        setCountryId(item.id);
        setCityId(null);
        setLocalAreaId(null);
      } else if (item.level === HierarchyLevel.CITY) {
        setLevel(HierarchyLevel.CITY);
        setCityId(item.id);
        setLocalAreaId(null);
      }
    },
    [handleSelectContinent, handleSelectWorld]
  );

  // Store callbacks in ref so Three.js mount effect runs strictly once
  const callbacksRef = useRef({
    onSelectContinent: handleSelectContinent,
    onSelectCountry: handleSelectCountry,
    onSelectCity: handleSelectCity,
    onSelectLocalArea: handleSelectLocalArea,
    onHoverChange: setHoverInfo,
    onContextLostChange: setContextLost,
  });
  callbacksRef.current = {
    onSelectContinent: handleSelectContinent,
    onSelectCountry: handleSelectCountry,
    onSelectCity: handleSelectCity,
    onSelectLocalArea: handleSelectLocalArea,
    onHoverChange: setHoverInfo,
    onContextLostChange: setContextLost,
  };

  // Initialize Three.js WebGL Globe once
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const sceneInstance = new GlobeScene(
      mountEl,
      {
        level: HierarchyLevel.WORLD,
        continentId: null,
        countryId: null,
        cityId: null,
        localAreaId: null,
        metric: PaymentMetric.VOLUME,
        hourFloat: getBrowserDecimalHour(),
        syntheticCountries: syntheticCountriesRef.current,
      },
      {
        onSelectContinent: (id) => callbacksRef.current.onSelectContinent(id),
        onSelectCountry: (country) => callbacksRef.current.onSelectCountry(country),
        onSelectCity: (city) => callbacksRef.current.onSelectCity(city),
        onSelectLocalArea: (area) => callbacksRef.current.onSelectLocalArea(area),
        onHoverChange: (info) => callbacksRef.current.onHoverChange(info),
        onContextLostChange: (lost) => callbacksRef.current.onContextLostChange(lost),
      }
    );

    globeRef.current = sceneInstance;
    return () => {
      sceneInstance.dispose();
      globeRef.current = null;
    };
  }, []);

  // Push React state updates to GlobeScene without tearing down WebGL
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.updateState({
      level,
      continentId,
      countryId,
      cityId,
      localAreaId,
      metric: activeMetric,
      hourFloat,
      syntheticCountries: syntheticCountriesRef.current,
    });
  }, [level, continentId, countryId, cityId, localAreaId, activeMetric, hourFloat]);

  // Trigger camera resize cleanly when inspector drawer opens/closes
  useEffect(() => {
    const id = window.setTimeout(() => {
      globeRef.current?.onResize();
    }, 30);
    return () => window.clearTimeout(id);
  }, [inspectorOpen]);

  // Keyboard shortcuts: H toggles bottom dock, Escape steps up hierarchy
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (e.key === 'Escape') {
        handleStepBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStepBack]);

  // Resolve current hierarchy data & breadcrumbs
  const resolved = useMemo(
    () =>
      resolveSelectionData(
        level,
        continentId,
        countryId,
        cityId,
        localAreaId,
        syntheticCountriesRef.current
      ),
    [level, continentId, countryId, cityId, localAreaId]
  );

  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [
      { level: HierarchyLevel.WORLD, id: 'world', label: 'World' },
    ];
    if (resolved.continent) {
      items.push({
        level: HierarchyLevel.CONTINENT,
        id: resolved.continent.id,
        label: resolved.continent.name,
      });
    } else if (continentId) {
      const c = CONTINENTS.find((x) => x.id === continentId);
      if (c) items.push({ level: HierarchyLevel.CONTINENT, id: c.id, label: c.name });
    }
    if (resolved.country) {
      items.push({
        level: HierarchyLevel.COUNTRY,
        id: resolved.country.id,
        label: resolved.country.name,
      });
    }
    if (resolved.city) {
      items.push({
        level: HierarchyLevel.CITY,
        id: resolved.city.id,
        label: resolved.city.name,
      });
    }
    if (resolved.localArea) {
      items.push({
        level: HierarchyLevel.LOCAL_AREA,
        id: resolved.localArea.id,
        label: resolved.localArea.name,
      });
    }
    return items;
  }, [resolved, continentId]);

  return (
    <div
      className={`relative flex h-screen w-screen overflow-hidden ${
        theme.isLightUI ? 'bg-[#e8eef5] text-slate-900' : 'bg-[#060913] text-slate-100'
      }`}
    >
      {/* Main 3D WebGL Viewport */}
      <main className="relative h-full min-w-0 flex-1 overflow-hidden bg-[#040812]">
        <div
          ref={canvasMountRef}
          className="h-full w-full"
          aria-label="Interactive 3D global digital payments WebGL globe"
        />

        {contextLost && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-6 text-center text-white">
            <div className="max-w-sm">
              <p className="font-display text-lg font-semibold">WebGL Context Suspended</p>
              <p className="mt-2 text-sm text-slate-300">
                Graphics acceleration paused temporarily. Restoring 3D globe rendering automatically.
              </p>
            </div>
          </div>
        )}

        <TopBar
          breadcrumbs={breadcrumbs}
          theme={theme}
          inspectorOpen={inspectorOpen}
          onNavigateBreadcrumb={handleNavigateBreadcrumb}
          onToggleInspector={() => setInspectorOpen((prev) => !prev)}
        />

        <BottomDock
          collapsed={dockCollapsed}
          onToggleCollapse={() => setDockCollapsed((prev) => !prev)}
          activeMetric={activeMetric}
          onChangeMetric={setActiveMetric}
          timeMode={timeMode}
          onChangeTimeMode={setTimeMode}
          hourFloat={hourFloat}
          onScrubHour={setHourFloat}
          theme={theme}
          canResetToWorld={level !== HierarchyLevel.WORLD}
          onResetWorld={handleSelectWorld}
        />

        <HoverTooltip
          hover={hoverInfo}
          activeMetric={activeMetric}
          theme={theme}
          viewportWidth={viewportSize.w}
          viewportHeight={viewportSize.h}
        />
      </main>

      {/* Docked Analytical Payments Inspector */}
      <PaymentsInspector
        open={inspectorOpen}
        level={level}
        title={resolved.title}
        subtitle={resolved.subtitle}
        profile={resolved.profile}
        continentId={resolved.continent?.id || continentId}
        country={resolved.country}
        city={resolved.city}
        localAreaId={resolved.localArea?.id || localAreaId}
        activeMetric={activeMetric}
        hourFloat={hourFloat}
        theme={theme}
        onSelectContinent={handleSelectContinent}
        onSelectCountry={handleSelectCountry}
        onSelectCity={handleSelectCity}
        onSelectLocalArea={handleSelectLocalArea}
        onStepBack={handleStepBack}
        onClose={() => setInspectorOpen(false)}
      />
    </div>
  );
}
