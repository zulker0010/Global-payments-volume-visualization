import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  findGeoCountryAtLatLon,
  getGeoCountries,
  latLonToVector3,
  vector3ToLatLon,
} from '../data/geoIndex';
import {
  computeSnapshotForHour,
  CONTINENTS,
  getAllFlagshipCountries,
  getMetricBreakdown,
  getOrCreateCountryForGeo,
  GLOBAL_PAYMENT_ARCS,
} from '../data/paymentsDataset';
import {
  CHANNEL_META,
  CityNode,
  ComputedPaymentSnapshot,
  CountryNode,
  HierarchyLevel,
  HoverInfo,
  LocalAreaNode,
  PaymentChannel,
  PaymentMetric,
} from '../types/payments';
import { computeDiurnalTheme, DiurnalThemeState } from '../utils/timeTheme';
import { createProceduralEarthTextures, EarthTextureBundle } from './earthTextures';

const EARTH_RADIUS = 10;

// Module-scope reusable math objects (zero GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _stepQuat = new THREE.Quaternion();

// Shared 3D spherical FBM GLSL chunk (seam-free across antimeridian and poles)
const GLSL_SPHERE_NOISE = `
float hash31(vec3 p) {
  p = fract(p * vec3(443.8975, 397.2973, 491.1871));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3d(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm4(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3d(p);
    p = p * 2.07 + vec3(13.1, 7.7, 5.3);
    a *= 0.5;
  }
  return v;
}
`;

export interface GlobeSceneCallbacks {
  onSelectContinent: (continentId: string) => void;
  onSelectCountry: (country: CountryNode) => void;
  onSelectCity: (city: CityNode) => void;
  onSelectLocalArea: (area: LocalAreaNode) => void;
  onHoverChange: (hover: HoverInfo | null) => void;
  onContextLostChange?: (lost: boolean) => void;
}

export interface GlobeSceneState {
  level: HierarchyLevel;
  continentId: string | null;
  countryId: string | null;
  cityId: string | null;
  localAreaId: string | null;
  metric: PaymentMetric;
  hourFloat: number;
  syntheticCountries: Map<string, CountryNode>;
}

interface ClickTargetPayload {
  level: HierarchyLevel;
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  snapshot: ComputedPaymentSnapshot;
  continentId?: string;
  country?: CountryNode;
  city?: CityNode;
  localArea?: LocalAreaNode;
}

interface BeaconRecord {
  group: THREE.Group;
  bars: [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh];
  cap: THREE.Mesh;
  hitMesh: THREE.Mesh;
  payload: ClickTargetPayload;
  baseScale: number;
}

function createStarSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.55, 'rgba(200, 225, 255, 0.2)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GlobeScene {
  private container: HTMLElement;
  private callbacks: GlobeSceneCallbacks;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private envRenderTarget: THREE.WebGLRenderTarget;

  private earthTextures: EarthTextureBundle;
  private starSpriteTex: THREE.CanvasTexture;
  private earthMesh: THREE.Mesh;
  private earthMaterial: THREE.MeshPhysicalMaterial;
  private earthShaderUniforms: Record<string, THREE.IUniform> | null = null;

  private cloudMesh: THREE.Mesh;
  private cloudMat: THREE.ShaderMaterial;
  private targetCloudOpacity = 0.78;

  private atmosphereMesh: THREE.Mesh;
  private atmosphereMat: THREE.ShaderMaterial;
  private bordersLine: THREE.LineSegments;
  private bordersMat: THREE.LineBasicMaterial;
  private activeCountryLine: THREE.LineSegments;
  private activeCountryMat: THREE.LineBasicMaterial;
  private graticuleLine: THREE.LineSegments;
  private graticuleMat: THREE.LineBasicMaterial;
  private starsPoints: THREE.Points;
  private starsMat: THREE.PointsMaterial;

  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  private markersGroup = new THREE.Group();
  private arcsGroup = new THREE.Group();
  private cityRingGroup = new THREE.Group();

  private beacons: BeaconRecord[] = [];
  private clickableMeshes: THREE.Object3D[] = [];
  private arcMaterials: THREE.ShaderMaterial[] = [];

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private lastHoverRaycast = 0;
  private hoveredHitMesh: THREE.Object3D | null = null;

  private cameraFlyActive = false;
  private desiredCamPos = new THREE.Vector3(0, 8, 28);
  private desiredTarget = new THREE.Vector3(0, 0, 0);

  private currentState: GlobeSceneState;
  private themeState: DiurnalThemeState;

  private frameId = 0;
  private clock = new THREE.Clock();
  private disposed = false;

  // Shared geometries & materials for markers
  private discGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.04, 18);
  private barGeo = new THREE.BoxGeometry(0.08, 1, 0.08);
  private capGeo = new THREE.OctahedronGeometry(0.08, 0);
  private hitSphereGeo = new THREE.SphereGeometry(0.55, 10, 10);
  private hitMat = new THREE.MeshBasicMaterial({ visible: false });
  private ringGeo = new THREE.RingGeometry(0.24, 0.31, 24);

  private channelBarMats: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  private discMat: THREE.MeshStandardMaterial;
  private capMat: THREE.MeshStandardMaterial;

  constructor(
    container: HTMLElement,
    initialState: GlobeSceneState,
    callbacks: GlobeSceneCallbacks
  ) {
    this.container = container;
    this.currentState = initialState;
    this.callbacks = callbacks;
    this.themeState = computeDiurnalTheme(initialState.hourFloat);

    // 1. Software WebGL Guard
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer Setup
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    // 3. Scene & Camera (deep cosmic space, no hazy white fog)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.themeState.skyBgHex);

    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 260);
    latLonToVector3(24, 15, 28.5, this.camera.position);
    this.desiredCamPos.copy(this.camera.position);

    // 4. Studio Environment Map (RoomEnvironment) for realistic ocean/metal reflections
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.42;
    pmremGenerator.dispose();

    // 5. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 11.4;
    this.controls.maxDistance = 42;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.85;
    this.controls.addEventListener('start', () => {
      this.cameraFlyActive = false;
    });

    // 6. Orbital Lighting Rig (Crisp Sunlight + Subtle Space Fill)
    this.hemiLight = new THREE.HemisphereLight(
      this.themeState.hemiSkyHex,
      this.themeState.hemiGroundHex,
      this.themeState.hemiIntensity
    );
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(
      this.themeState.sunColorHex,
      this.themeState.sunIntensity
    );
    this.sunLight.position.set(22, 12, 18);
    if (!this.isSoftwareGl) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(1024, 1024);
      this.sunLight.shadow.camera.left = -14;
      this.sunLight.shadow.camera.right = 14;
      this.sunLight.shadow.camera.top = 14;
      this.sunLight.shadow.camera.bottom = -14;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x4f75b5, 0.25);
    this.fillLight.position.set(-22, -8, -18);
    this.scene.add(this.fillLight);

    // 7. Procedural NASA-Style Earth Textures + Photorealistic PBR Biome Shader
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.earthTextures = createProceduralEarthTextures(maxAniso);
    this.starSpriteTex = createStarSpriteTexture();

    this.earthMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughnessMap: this.earthTextures.roughnessTexture,
      roughness: 1.0,
      metalness: 0.04,
      normalMap: this.earthTextures.normalTexture,
      normalScale: new THREE.Vector2(0.85, 0.85),
      clearcoat: 0.32,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.55,
    });

    this.earthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uBiomeMap = { value: this.earthTextures.biomeDataTexture };
      shader.uniforms.uNightMap = { value: this.earthTextures.nightLightsTexture };
      shader.uniforms.uSunDir = { value: new THREE.Vector3(1, 0.3, 0.5).normalize() };
      shader.uniforms.uNightGlow = { value: this.themeState.nightWeight };
      shader.uniforms.uTwilightStrength = {
        value: Math.max(this.themeState.dawnWeight, this.themeState.duskWeight),
      };
      shader.uniforms.uAmbientFill = { value: this.themeState.ambientFillLevel };
      shader.uniforms.uTerminatorColor = { value: new THREE.Color(this.themeState.terminatorHex) };
      shader.uniforms.uAtmosColor = { value: new THREE.Color(this.themeState.atmosphereHex) };

      this.earthShaderUniforms = shader.uniforms;

      shader.vertexShader =
        `varying vec2 vEarthUv;
        varying vec3 vSphereDir;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormalDir;
        varying vec3 vViewSpaceNormal;
        varying vec3 vViewSpacePos;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vEarthUv = uv;
          vSphereDir = normalize(position);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vWorldNormalDir = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vViewSpaceNormal = normalize(normalMatrix * normal);
          vViewSpacePos = (modelViewMatrix * vec4(position, 1.0)).xyz;`
        );

      shader.fragmentShader =
        `uniform sampler2D uBiomeMap;
        uniform sampler2D uNightMap;
        uniform vec3 uSunDir;
        uniform float uNightGlow;
        uniform float uTwilightStrength;
        uniform float uAmbientFill;
        uniform vec3 uTerminatorColor;
        uniform vec3 uAtmosColor;
        varying vec2 vEarthUv;
        varying vec3 vSphereDir;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormalDir;
        varying vec3 vViewSpaceNormal;
        varying vec3 vViewSpacePos;
        ${GLSL_SPHERE_NOISE}\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            vec4 bData = texture2D(uBiomeMap, vEarthUv);
            float landMask = smoothstep(0.38, 0.62, bData.r);
            float elevOrShelf = bData.g;
            float aridWeight = bData.b;

            // Seamless 3D spherical multi-octave noise for infinite zoom detail
            float nMacro = fbm4(vSphereDir * 7.5);
            float nDetail = fbm4(vSphereDir * 32.0);
            float nMicro = noise3d(vSphereDir * 110.0);

            // --- OCEAN BATHYMETRY ---
            vec3 abyssalOcean = vec3(0.014, 0.058, 0.145);
            vec3 midOcean = vec3(0.028, 0.145, 0.315);
            vec3 shelfOcean = vec3(0.075, 0.365, 0.475);
            float shelfMask = smoothstep(0.04, 0.72, elevOrShelf);
            vec3 oceanCol = mix(abyssalOcean, midOcean, 0.35 + 0.45 * nMacro);
            oceanCol = mix(oceanCol, shelfOcean, shelfMask * 0.72);

            // --- CONTINENTAL BIOMES ---
            float absLat = abs(vSphereDir.y); // 0 = equator, 1 = pole
            vec3 tropicalForest = vec3(0.055, 0.165, 0.068);
            vec3 temperateGreen = vec3(0.115, 0.215, 0.095);
            vec3 steppeDry = vec3(0.32, 0.29, 0.18);
            vec3 desertSand = vec3(0.56, 0.44, 0.29);
            vec3 alpineRock = vec3(0.32, 0.30, 0.28);
            vec3 snowIce = vec3(0.86, 0.91, 0.96);

            float vegMix = smoothstep(0.05, 0.55, absLat);
            vec3 landCol = mix(tropicalForest, temperateGreen, vegMix);
            landCol = mix(landCol, steppeDry, smoothstep(0.35, 0.78, nMacro + absLat * 0.25) * 0.65);

            // Arid deserts (Sahara, Arabia, Outback, Gobi, SW US)
            float desertMask = clamp(aridWeight * (0.75 + 0.45 * nDetail), 0.0, 1.0);
            vec3 duneColor = mix(desertSand, vec3(0.68, 0.54, 0.36), nMicro);
            landCol = mix(landCol, duneColor, desertMask * 0.88);

            // High mountain rock & ridges
            float mtnMask = smoothstep(0.32, 0.82, elevOrShelf);
            landCol = mix(landCol, alpineRock * (0.75 + 0.5 * nDetail), mtnMask * 0.78);

            // Organic surface grain
            landCol *= (0.82 + 0.36 * nDetail) * (0.92 + 0.16 * nMicro);

            // Polar ice caps & Himalayan/Andean snow peaks
            float polarSnow = smoothstep(0.76, 0.91, absLat + (nMacro - 0.5) * 0.12);
            float peakSnow = smoothstep(0.62, 0.88, elevOrShelf + (nDetail - 0.5) * 0.18);
            float snowMask = clamp(max(polarSnow, peakSnow), 0.0, 1.0);
            landCol = mix(landCol, snowIce, snowMask * 0.92);

            vec3 albedo = mix(oceanCol, landCol, landMask);

            // Solar terminator twilight & horizon Rayleigh scatter
            vec3 sunNorm = normalize(uSunDir);
            float sunDot = dot(normalize(vWorldNormalDir), sunNorm);
            float dayIllum = smoothstep(-0.16, 0.24, sunDot);
            float terminatorBand = exp(-pow(sunDot * 5.2, 2.0));

            // Keep night-side subtly readable with deep moonlight floor
            vec3 nightTint = albedo * (0.14 + uAmbientFill * 0.55);
            vec3 litTint = mix(nightTint, albedo, dayIllum);
            litTint = mix(litTint, uTerminatorColor * 0.72, terminatorBand * (0.16 + 0.26 * uTwilightStrength));

            // Front-face Rayleigh atmospheric limb haze (signature shot-from-space blue edge)
            vec3 viewDir = normalize(-vViewSpacePos);
            float limb = pow(1.0 - max(dot(normalize(vViewSpaceNormal), viewDir), 0.0), 3.3);
            vec3 limbColor = mix(uTerminatorColor, uAtmosColor, smoothstep(-0.2, 0.35, sunDot));
            litTint = mix(litTint, limbColor, limb * (0.28 + 0.52 * dayIllum));

            // Specular sun glint over oceans
            vec3 worldCamDir = normalize(cameraPosition - vWorldPos);
            vec3 halfVec = normalize(sunNorm + worldCamDir);
            float oceanGlint = pow(max(dot(normalize(vWorldNormalDir), halfVec), 0.0), 48.0);
            litTint += vec3(1.0, 0.92, 0.78) * oceanGlint * (1.0 - landMask) * dayIllum * 0.42;

            diffuseColor.rgb *= litTint;`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            vec3 nightSample = texture2D(uNightMap, vEarthUv).rgb;
            float sunDotE = dot(normalize(vWorldNormalDir), normalize(uSunDir));
            float darkSide = smoothstep(0.14, -0.22, sunDotE);
            float nightReveal = clamp(darkSide * 1.15 + uNightGlow * 0.75 + uTwilightStrength * 0.28, 0.04, 1.35);
            totalEmissiveRadiance += nightSample * nightReveal * 1.45;`
          );
    };

    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 128, 96);
    this.earthMesh = new THREE.Mesh(earthGeo, this.earthMaterial);
    this.earthMesh.receiveShadow = !this.isSoftwareGl;
    this.scene.add(this.earthMesh);

    // 8. 3D Volumetric-Look Atmospheric Cloud Layer (Seamless 3D Spherical FBM)
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
        uZoomOpacity: { value: 0.78 },
        uTerminatorColor: { value: new THREE.Color(this.themeState.terminatorHex) },
      },
      vertexShader: `
        varying vec3 vSpherePos;
        varying vec3 vWorldNormal;
        void main() {
          vSpherePos = normalize(position);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform float uZoomOpacity;
        uniform vec3 uTerminatorColor;
        varying vec3 vSpherePos;
        varying vec3 vWorldNormal;
        ${GLSL_SPHERE_NOISE}

        void main() {
          // Drift clouds westward + add trade-wind swirl distortion
          float angle = uTime * 0.0085;
          float ca = cos(angle);
          float sa = sin(angle);
          vec3 p = vec3(
            vSpherePos.x * ca - vSpherePos.z * sa,
            vSpherePos.y,
            vSpherePos.x * sa + vSpherePos.z * ca
          );

          // Domain warping for cyclonic cloud bands
          vec3 warp = vec3(
            fbm4(p * 3.4 + vec3(1.7, 9.2, 3.1)),
            fbm4(p * 3.4 + vec3(8.3, 2.8, 5.4)),
            fbm4(p * 3.4 + vec3(4.1, 6.5, 7.9))
          );
          float clouds = fbm4(p * 4.8 + warp * 1.45);
          float wisp = fbm4(p * 14.0 - warp * 0.6);
          float density = smoothstep(0.46, 0.78, clouds * 0.75 + wisp * 0.25);

          float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
          float dayLight = smoothstep(-0.18, 0.28, sunDot);
          float twilight = exp(-pow(sunDot * 5.0, 2.0));

          vec3 cloudDay = vec3(0.97, 0.98, 1.0);
          vec3 cloudNight = vec3(0.06, 0.09, 0.16);
          vec3 col = mix(cloudNight, cloudDay, dayLight);
          col = mix(col, uTerminatorColor * 1.1, twilight * 0.42);

          float alpha = density * uZoomOpacity * (0.22 + 0.78 * dayLight);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.008, 96, 72),
      this.cloudMat
    );
    this.cloudMesh.renderOrder = 2;
    this.scene.add(this.cloudMesh);

    // 9. Outer Atmospheric Rayleigh Limb Glow
    this.atmosphereMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(this.themeState.atmosphereHex) },
        uTerminatorColor: { value: new THREE.Color(this.themeState.terminatorHex) },
        uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
        uIntensity: { value: 0.9 },
      },
      vertexShader: `
        varying vec3 vNormalView;
        varying vec3 vNormalWorld;
        varying vec3 vViewPos;
        void main() {
          vNormalView = normalize(normalMatrix * normal);
          vNormalWorld = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uTerminatorColor;
        uniform vec3 uSunDir;
        uniform float uIntensity;
        varying vec3 vNormalView;
        varying vec3 vNormalWorld;
        varying vec3 vViewPos;
        void main() {
          vec3 viewDir = normalize(vViewPos);
          float fresnel = pow(0.62 - dot(vNormalView, viewDir), 4.0);
          float sunAlign = dot(normalize(vNormalWorld), normalize(uSunDir));
          float daySide = smoothstep(-0.35, 0.45, sunAlign);
          float sunsetBand = exp(-pow(sunAlign * 4.5, 2.0));
          vec3 scatterCol = mix(uColor, uTerminatorColor, sunsetBand * 0.48);
          float alpha = clamp(fresnel * uIntensity * (0.25 + 0.75 * daySide), 0.0, 0.85);
          gl_FragColor = vec4(scatterCol, alpha);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphereMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.068, 64, 48),
      this.atmosphereMat
    );
    this.scene.add(this.atmosphereMesh);

    // 10. Subtle Orbital Graticule & Realistic Multi-Temperature Starfield
    this.graticuleMat = new THREE.LineBasicMaterial({
      color: this.themeState.gridHex,
      transparent: true,
      opacity: 0.08,
    });
    this.graticuleLine = this.buildGraticule(EARTH_RADIUS + 0.012);
    this.scene.add(this.graticuleLine);

    const { points: stars, material: starsMat } = this.buildStarfield();
    this.starsPoints = stars;
    this.starsMat = starsMat;
    this.scene.add(this.starsPoints);

    // 11. Subtle Country Border Outlines + Active Country Highlight
    this.bordersMat = new THREE.LineBasicMaterial({
      color: this.themeState.borderHex,
      transparent: true,
      opacity: 0.2,
    });
    this.bordersLine = this.buildWorldBorders(EARTH_RADIUS + 0.02);
    this.scene.add(this.bordersLine);

    this.activeCountryMat = new THREE.LineBasicMaterial({
      color: this.themeState.highlightBorderHex,
      transparent: true,
      opacity: 0.95,
    });
    this.activeCountryLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      this.activeCountryMat
    );
    this.activeCountryLine.visible = false;
    this.scene.add(this.activeCountryLine);

    // 12. Shared Marker Materials
    this.discMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.82,
      roughness: 0.24,
    });
    this.capMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.65,
      roughness: 0.2,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.55,
    });
    const channels = [
      PaymentChannel.MOBILE_WALLETS,
      PaymentChannel.MFS,
      PaymentChannel.CARD_PAYMENTS,
      PaymentChannel.NFC_CONTACTLESS,
    ];
    this.channelBarMats = channels.map(
      (ch) =>
        new THREE.MeshStandardMaterial({
          color: CHANNEL_META[ch].colorInt,
          emissive: CHANNEL_META[ch].colorInt,
          emissiveIntensity: 0.42,
          metalness: 0.25,
          roughness: 0.38,
        })
    ) as [
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
    ];

    this.scene.add(this.markersGroup);
    this.scene.add(this.arcsGroup);
    this.scene.add(this.cityRingGroup);

    // 13. Initialize Markers & Theme
    this.rebuildHierarchyVisuals();
    this.applyThemeUniforms();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.startLoop();
  }

  private buildGraticule(radius: number): THREE.LineSegments {
    const positions: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 6) {
        latLonToVector3(lat, lon, radius, _v1);
        latLonToVector3(lat, lon + 6, radius, _v2);
        positions.push(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z);
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -84; lat < 84; lat += 6) {
        latLonToVector3(lat, lon, radius, _v1);
        latLonToVector3(lat + 6, lon, radius, _v2);
        positions.push(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geo, this.graticuleMat);
  }

  private buildStarfield(): { points: THREE.Points; material: THREE.PointsMaterial } {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const r = 72 + Math.random() * 90;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      positions[i * 3] = r * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = r * Math.cos(theta);
      positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);

      // Realistic stellar spectral color distribution (blue-white, white, warm amber)
      const temp = Math.random();
      const brightness = 0.45 + Math.pow(Math.random(), 2.2) * 0.55;
      if (temp < 0.25) {
        colors[i * 3] = 0.72 * brightness;
        colors[i * 3 + 1] = 0.85 * brightness;
        colors[i * 3 + 2] = 1.0 * brightness;
      } else if (temp < 0.75) {
        colors[i * 3] = 0.96 * brightness;
        colors[i * 3 + 1] = 0.97 * brightness;
        colors[i * 3 + 2] = 1.0 * brightness;
      } else {
        colors[i * 3] = 1.0 * brightness;
        colors[i * 3 + 1] = 0.85 * brightness;
        colors[i * 3 + 2] = 0.68 * brightness;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.55,
      map: this.starSpriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return { points: new THREE.Points(geo, material), material };
  }

  private buildWorldBorders(radius: number): THREE.LineSegments {
    const countries = getGeoCountries();
    const positions: number[] = [];

    for (const country of countries) {
      for (const poly of country.polygons) {
        for (const ring of poly.rings) {
          for (let i = 0; i < ring.coords.length - 1; i++) {
            const [lon1, lat1] = ring.coords[i];
            const [lon2, lat2] = ring.coords[i + 1];
            if (Math.abs(lon1 - lon2) > 180) continue;
            latLonToVector3(lat1, lon1, radius, _v1);
            latLonToVector3(lat2, lon2, radius, _v2);
            positions.push(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geo, this.bordersMat);
  }

  private updateActiveCountryHighlight(country: CountryNode | null) {
    if (!country) {
      this.activeCountryLine.visible = false;
      return;
    }

    const geoCountries = getGeoCountries();
    const match = geoCountries.find(
      (gc) =>
        (country.isoNumeric && gc.isoNumeric === country.isoNumeric) ||
        gc.name.toLowerCase() === country.name.toLowerCase()
    );

    if (!match) {
      this.activeCountryLine.visible = false;
      return;
    }

    const positions: number[] = [];
    const r = EARTH_RADIUS + 0.036;
    for (const poly of match.polygons) {
      for (const ring of poly.rings) {
        for (let i = 0; i < ring.coords.length - 1; i++) {
          const [lon1, lat1] = ring.coords[i];
          const [lon2, lat2] = ring.coords[i + 1];
          if (Math.abs(lon1 - lon2) > 180) continue;
          latLonToVector3(lat1, lon1, r, _v1);
          latLonToVector3(lat2, lon2, r, _v2);
          positions.push(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z);
        }
      }
    }

    this.activeCountryLine.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.activeCountryLine.geometry = geo;
    this.activeCountryLine.visible = true;
  }

  private clearGroup(group: THREE.Group) {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  }

  private createCompositeBeacon(
    lat: number,
    lon: number,
    baseScale: number,
    payload: ClickTargetPayload
  ): BeaconRecord {
    const group = new THREE.Group();
    const surfacePos = latLonToVector3(lat, lon, EARTH_RADIUS + 0.025, new THREE.Vector3());
    group.position.copy(surfacePos);

    const normal = surfacePos.clone().normalize();
    group.quaternion.setFromUnitVectors(_up, normal);

    const disc = new THREE.Mesh(this.discGeo, this.discMat);
    disc.scale.set(baseScale, baseScale, baseScale);
    disc.position.y = 0.02 * baseScale;
    disc.castShadow = !this.isSoftwareGl;
    disc.receiveShadow = !this.isSoftwareGl;
    group.add(disc);

    const offset = 0.065 * baseScale;
    const offsets: Array<[number, number]> = [
      [-offset, -offset],
      [offset, -offset],
      [-offset, offset],
      [offset, offset],
    ];

    const makeBar = (ox: number, oz: number, idx: number): THREE.Mesh => {
      const bar = new THREE.Mesh(this.barGeo, this.channelBarMats[idx]);
      bar.position.set(ox, 0.5, oz);
      bar.scale.set(baseScale, 1, baseScale);
      bar.castShadow = !this.isSoftwareGl;
      group.add(bar);
      return bar;
    };

    const bars: [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh] = [
      makeBar(offsets[0][0], offsets[0][1], 0),
      makeBar(offsets[1][0], offsets[1][1], 1),
      makeBar(offsets[2][0], offsets[2][1], 2),
      makeBar(offsets[3][0], offsets[3][1], 3),
    ];

    const cap = new THREE.Mesh(this.capGeo, this.capMat);
    cap.scale.setScalar(baseScale);
    group.add(cap);

    const hitMesh = new THREE.Mesh(this.hitSphereGeo, this.hitMat);
    hitMesh.scale.setScalar(Math.max(0.7, baseScale * 1.15));
    hitMesh.position.y = 0.45 * baseScale;
    hitMesh.userData.payload = payload;
    group.add(hitMesh);

    this.clickableMeshes.push(hitMesh);
    this.markersGroup.add(group);

    return { group, bars, cap, hitMesh, payload, baseScale };
  }

  private buildArc(
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number,
    colorHex: number,
    altitude: number,
    tubeRadius: number
  ) {
    const start = latLonToVector3(fromLat, fromLon, EARTH_RADIUS + 0.05, new THREE.Vector3());
    const end = latLonToVector3(toLat, toLon, EARTH_RADIUS + 0.05, new THREE.Vector3());
    const dist = start.distanceTo(end);

    const points: THREE.Vector3[] = [];
    const segments = 36;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = new THREE.Vector3().lerpVectors(start, end, t).normalize();
      const arcLift = Math.sin(t * Math.PI) * (altitude + dist * 0.14);
      p.multiplyScalar(EARTH_RADIUS + 0.05 + arcLift);
      points.push(p);
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, 36, tubeRadius, 6, false);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(colorHex) },
        uOpacity: { value: 0.8 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float pulse = smoothstep(0.0, 0.25, fract(vUv.x * 1.5 - uTime * 0.45)) *
                        (1.0 - smoothstep(0.25, 0.55, fract(vUv.x * 1.5 - uTime * 0.45)));
          float baseLine = 0.22;
          float alpha = (baseLine + pulse * 0.85) * uOpacity;
          vec3 col = uColor * (0.9 + pulse * 0.95);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(tubeGeo, mat);
    this.arcMaterials.push(mat);
    this.arcsGroup.add(mesh);
  }

  private buildCityMetroGrid(lat: number, lon: number, radiusScale: number) {
    this.clearGroup(this.cityRingGroup);
    const center = latLonToVector3(lat, lon, EARTH_RADIUS + 0.03, new THREE.Vector3());
    const normal = center.clone().normalize();
    const ringContainer = new THREE.Group();
    ringContainer.position.copy(center);
    ringContainer.quaternion.setFromUnitVectors(_up, normal);

    const ringRadii = [0.22 * radiusScale, 0.44 * radiusScale, 0.68 * radiusScale];
    ringRadii.forEach((rad, idx) => {
      const geo = new THREE.RingGeometry(rad - 0.008 * radiusScale, rad, 48);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: this.themeState.highlightBorderHex,
        transparent: true,
        opacity: 0.52 - idx * 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      ringContainer.add(new THREE.Mesh(geo, mat));
    });

    this.cityRingGroup.add(ringContainer);
  }

  private rebuildHierarchyVisuals() {
    this.arcsGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    });
    this.arcMaterials.forEach((m) => m.dispose());
    this.arcMaterials = [];
    this.clearGroup(this.arcsGroup);

    this.cityRingGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose();
        ((obj as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
    this.clearGroup(this.cityRingGroup);

    this.clearGroup(this.markersGroup);
    this.beacons = [];
    this.clickableMeshes = [];

    const { level, continentId, countryId, cityId, localAreaId, hourFloat, syntheticCountries } =
      this.currentState;

    // Fade cloud cover gracefully when zooming down to city/local areas so district markers are sharp
    this.targetCloudOpacity =
      level === HierarchyLevel.LOCAL_AREA
        ? 0.12
        : level === HierarchyLevel.CITY
          ? 0.22
          : level === HierarchyLevel.COUNTRY
            ? 0.55
            : 0.78;

    const allCountries = getAllFlagshipCountries();
    const activeCountry =
      (countryId &&
        (allCountries.find((c) => c.id === countryId) ||
          syntheticCountries.get(countryId))) ||
      null;

    this.updateActiveCountryHighlight(
      level === HierarchyLevel.COUNTRY ||
        level === HierarchyLevel.CITY ||
        level === HierarchyLevel.LOCAL_AREA
        ? activeCountry
        : null
    );

    if (level === HierarchyLevel.WORLD || level === HierarchyLevel.CONTINENT) {
      for (const cont of CONTINENTS) {
        const snap = computeSnapshotForHour(cont.profile, hourFloat);
        const isCurrentCont = level === HierarchyLevel.CONTINENT && cont.id === continentId;

        const ringGroup = new THREE.Group();
        const pos = latLonToVector3(cont.lat, cont.lon, EARTH_RADIUS + 0.03, new THREE.Vector3());
        ringGroup.position.copy(pos);
        ringGroup.quaternion.setFromUnitVectors(_up, pos.clone().normalize());

        const rMesh = new THREE.Mesh(
          this.ringGeo,
          new THREE.MeshBasicMaterial({
            color: isCurrentCont
              ? this.themeState.highlightBorderHex
              : this.themeState.borderHex,
            transparent: true,
            opacity: isCurrentCont ? 0.9 : 0.4,
            side: THREE.DoubleSide,
          })
        );
        rMesh.rotation.x = -Math.PI / 2;
        rMesh.scale.setScalar(isCurrentCont ? 2.4 : 1.7);
        ringGroup.add(rMesh);

        const hit = new THREE.Mesh(this.hitSphereGeo, this.hitMat);
        hit.scale.setScalar(0.95);
        hit.userData.payload = {
          level: HierarchyLevel.CONTINENT,
          id: cont.id,
          name: cont.name,
          subtitle: `${cont.countries.length} Markets`,
          lat: cont.lat,
          lon: cont.lon,
          snapshot: snap,
          continentId: cont.id,
        } satisfies ClickTargetPayload;
        ringGroup.add(hit);
        this.clickableMeshes.push(hit);
        this.markersGroup.add(ringGroup);

        const showCountry = level === HierarchyLevel.WORLD || cont.id === continentId;
        if (!showCountry) continue;

        for (const country of cont.countries) {
          const cSnap = computeSnapshotForHour(country.profile, hourFloat);
          const scale = level === HierarchyLevel.CONTINENT ? 1.15 : 0.92;
          const payload: ClickTargetPayload = {
            level: HierarchyLevel.COUNTRY,
            id: country.id,
            name: country.name,
            subtitle: `${country.cities.length} Cities · ${country.currencyCode}`,
            lat: country.lat,
            lon: country.lon,
            snapshot: cSnap,
            continentId: cont.id,
            country,
          };
          const rec = this.createCompositeBeacon(country.lat, country.lon, scale, payload);
          this.beacons.push(rec);
        }
      }

      for (const arc of GLOBAL_PAYMENT_ARCS) {
        this.buildArc(
          arc.fromLat,
          arc.fromLon,
          arc.toLat,
          arc.toLon,
          CHANNEL_META[arc.channel].colorInt,
          0.4,
          0.025
        );
      }
    } else if (level === HierarchyLevel.COUNTRY && activeCountry) {
      activeCountry.cities.forEach((city, idx) => {
        const snap = computeSnapshotForHour(city.profile, hourFloat);
        const payload: ClickTargetPayload = {
          level: HierarchyLevel.CITY,
          id: city.id,
          name: city.name,
          subtitle: `${city.populationLabel} · ${city.localAreas.length} Local Areas`,
          lat: city.lat,
          lon: city.lon,
          snapshot: snap,
          continentId: activeCountry.continentId,
          country: activeCountry,
          city,
        };
        const rec = this.createCompositeBeacon(city.lat, city.lon, 0.85, payload);
        this.beacons.push(rec);

        if (idx > 0) {
          const prev = activeCountry.cities[idx - 1];
          this.buildArc(
            prev.lat,
            prev.lon,
            city.lat,
            city.lon,
            CHANNEL_META[snap.peakChannel].colorInt,
            0.22,
            0.018
          );
        }
      });
    } else if ((level === HierarchyLevel.CITY || level === HierarchyLevel.LOCAL_AREA) && activeCountry) {
      const activeCity = activeCountry.cities.find((ct) => ct.id === cityId) || activeCountry.cities[0];
      if (activeCity) {
        this.buildCityMetroGrid(activeCity.lat, activeCity.lon, 1.0);

        const count = activeCity.localAreas.length;
        activeCity.localAreas.forEach((area, idx) => {
          const dLat = area.lat - activeCity.lat;
          const dLon = area.lon - activeCity.lon;
          const dist = Math.hypot(dLat, dLon);
          const angle =
            dist > 0.005
              ? Math.atan2(dLat, dLon)
              : (idx / Math.max(count, 1)) * Math.PI * 2;
          const visualRadiusDeg = Math.max(dist * 4.5, 0.48);
          const vLat = activeCity.lat + Math.sin(angle) * visualRadiusDeg;
          const vLon = activeCity.lon + Math.cos(angle) * visualRadiusDeg;

          const snap = computeSnapshotForHour(area.profile, hourFloat);
          const isSelectedArea = level === HierarchyLevel.LOCAL_AREA && area.id === localAreaId;
          const payload: ClickTargetPayload = {
            level: HierarchyLevel.LOCAL_AREA,
            id: area.id,
            name: area.name,
            subtitle: `${area.districtType} · ${activeCity.name}`,
            lat: vLat,
            lon: vLon,
            snapshot: snap,
            continentId: activeCountry.continentId,
            country: activeCountry,
            city: activeCity,
            localArea: area,
          };

          const rec = this.createCompositeBeacon(
            vLat,
            vLon,
            isSelectedArea ? 0.58 : 0.42,
            payload
          );
          this.beacons.push(rec);

          this.buildArc(
            activeCity.lat,
            activeCity.lon,
            vLat,
            vLon,
            CHANNEL_META[snap.peakChannel].colorInt,
            0.09,
            0.01
          );
        });
      }
    }

    this.updateBeaconHeights();
  }

  private updateBeaconHeights() {
    const { hourFloat, metric, level } = this.currentState;
    for (const rec of this.beacons) {
      let profile = null;
      if (rec.payload.localArea) profile = rec.payload.localArea.profile;
      else if (rec.payload.city) profile = rec.payload.city.profile;
      else if (rec.payload.country) profile = rec.payload.country.profile;

      const snap = profile
        ? computeSnapshotForHour(profile, hourFloat)
        : rec.payload.snapshot;
      rec.payload.snapshot = snap;

      const breakdown = getMetricBreakdown(snap, metric);
      const pcts = [
        breakdown.percentages.mobileWallets,
        breakdown.percentages.mfs,
        breakdown.percentages.cardPayments,
        breakdown.percentages.nfcContactless,
      ];

      const maxScaleHeight =
        level === HierarchyLevel.LOCAL_AREA
          ? 0.9
          : level === HierarchyLevel.CITY
            ? 0.7
            : level === HierarchyLevel.COUNTRY
              ? 1.15
              : 1.65;

      const activityMult = 0.72 + snap.activityIndex * 0.45;
      let tallest = 0.2;

      for (let i = 0; i < 4; i++) {
        const h = Math.max(0.08, (pcts[i] / 100) * maxScaleHeight * activityMult * rec.baseScale);
        rec.bars[i].scale.y = h;
        rec.bars[i].position.y = 0.04 * rec.baseScale + h * 0.5;
        if (h > tallest) tallest = h;
      }

      rec.cap.position.y = 0.04 * rec.baseScale + tallest + 0.14 * rec.baseScale;
    }
  }

  private flyCameraTo(lat: number, lon: number, distance: number, targetAtSurface: boolean) {
    latLonToVector3(lat, lon, EARTH_RADIUS, _v1);
    const normal = _v1.clone().normalize();

    if (targetAtSurface) {
      this.desiredTarget.copy(_v1).multiplyScalar(0.995);
      latLonToVector3(lat - 3.2, lon - 2.5, EARTH_RADIUS + distance, this.desiredCamPos);
      this.controls.minDistance = 0.9;
      this.controls.maxDistance = 12;
    } else {
      this.desiredTarget.set(0, 0, 0);
      latLonToVector3(lat - 6, lon, EARTH_RADIUS + distance, this.desiredCamPos);
      if (this.desiredCamPos.length() < EARTH_RADIUS + 2) {
        this.desiredCamPos.copy(normal).multiplyScalar(EARTH_RADIUS + distance);
      }
      this.controls.minDistance = 11.4;
      this.controls.maxDistance = 42;
    }
    this.cameraFlyActive = true;
  }

  public updateState(nextState: GlobeSceneState, triggerCameraFly = false) {
    const prev = this.currentState;
    const hierarchyChanged =
      prev.level !== nextState.level ||
      prev.continentId !== nextState.continentId ||
      prev.countryId !== nextState.countryId ||
      prev.cityId !== nextState.cityId ||
      prev.localAreaId !== nextState.localAreaId;

    const hourChanged = Math.abs(prev.hourFloat - nextState.hourFloat) > 0.002;
    const metricChanged = prev.metric !== nextState.metric;

    this.currentState = nextState;

    if (hourChanged) {
      this.themeState = computeDiurnalTheme(nextState.hourFloat);
      this.applyThemeUniforms();
    }

    if (hierarchyChanged) {
      this.rebuildHierarchyVisuals();
    } else if (hourChanged || metricChanged) {
      this.updateBeaconHeights();
    }

    if (triggerCameraFly || hierarchyChanged) {
      this.triggerFlyForCurrentState();
    }
  }

  private triggerFlyForCurrentState() {
    const { level, continentId, countryId, cityId, localAreaId, syntheticCountries } =
      this.currentState;

    if (level === HierarchyLevel.WORLD) {
      this.flyCameraTo(24, 15, 18.5, false);
      return;
    }
    if (level === HierarchyLevel.CONTINENT && continentId) {
      const cont = CONTINENTS.find((c) => c.id === continentId);
      if (cont) this.flyCameraTo(cont.lat, cont.lon, cont.cameraDistance - EARTH_RADIUS + 4, false);
      return;
    }

    const country =
      (countryId &&
        (getAllFlagshipCountries().find((c) => c.id === countryId) ||
          syntheticCountries.get(countryId))) ||
      null;

    if (level === HierarchyLevel.COUNTRY && country) {
      this.flyCameraTo(country.lat, country.lon, 6.4, false);
      return;
    }

    if (level === HierarchyLevel.CITY && country) {
      const city = country.cities.find((ct) => ct.id === cityId) || country.cities[0];
      if (city) {
        this.flyCameraTo(city.lat, city.lon, 2.55, true);
      }
      return;
    }

    if (level === HierarchyLevel.LOCAL_AREA && country) {
      const city = country.cities.find((ct) => ct.id === cityId) || country.cities[0];
      const beacon = this.beacons.find((b) => b.payload.id === localAreaId);
      if (beacon) {
        this.flyCameraTo(beacon.payload.lat, beacon.payload.lon, 1.35, true);
      } else if (city) {
        const area = city.localAreas.find((la) => la.id === localAreaId) || city.localAreas[0];
        if (area) this.flyCameraTo(area.lat, area.lon, 1.35, true);
      }
    }
  }

  private applyThemeUniforms() {
    const t = this.themeState;
    (this.scene.background as THREE.Color).setHex(t.skyBgHex);

    this.sunLight.color.setHex(t.sunColorHex);
    this.sunLight.intensity = t.sunIntensity;
    this.hemiLight.color.setHex(t.hemiSkyHex);
    this.hemiLight.groundColor.setHex(t.hemiGroundHex);
    this.hemiLight.intensity = t.hemiIntensity;

    const sunR = 34;
    this.sunLight.position.set(
      Math.cos(t.sunLongitudeRad) * sunR,
      Math.sin(t.sunDeclinationRad) * sunR + 6,
      Math.sin(t.sunLongitudeRad) * sunR
    );

    _v1.copy(this.sunLight.position).normalize();

    this.bordersMat.color.setHex(t.borderHex);
    this.bordersMat.opacity = 0.2;
    this.activeCountryMat.color.setHex(t.highlightBorderHex);
    this.graticuleMat.color.setHex(t.gridHex);
    this.graticuleMat.opacity = 0.08;
    this.starsMat.opacity = 0.88 - t.dayWeight * 0.22;

    this.atmosphereMat.uniforms.uColor.value.setHex(t.atmosphereHex);
    this.atmosphereMat.uniforms.uTerminatorColor.value.setHex(t.terminatorHex);
    this.atmosphereMat.uniforms.uSunDir.value.copy(_v1);
    this.atmosphereMat.uniforms.uIntensity.value =
      0.72 + t.dayWeight * 0.22 + (t.dawnWeight + t.duskWeight) * 0.25;

    this.cloudMat.uniforms.uSunDir.value.copy(_v1);
    this.cloudMat.uniforms.uTerminatorColor.value.setHex(t.terminatorHex);

    if (this.earthShaderUniforms) {
      this.earthShaderUniforms.uSunDir.value.copy(_v1);
      this.earthShaderUniforms.uNightGlow.value = t.nightWeight;
      this.earthShaderUniforms.uTwilightStrength.value = Math.max(t.dawnWeight, t.duskWeight);
      this.earthShaderUniforms.uAmbientFill.value = t.ambientFillLevel;
      this.earthShaderUniforms.uTerminatorColor.value.setHex(t.terminatorHex);
      this.earthShaderUniforms.uAtmosColor.value.setHex(t.atmosphereHex);
    }
  }

  private bindEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('resize', this.onResize);
  }

  private updatePointerNdc(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerMove = (e: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastHoverRaycast < 45) return;
    this.lastHoverRaycast = now;

    this.updatePointerNdc(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.clickableMeshes, false);
    if (hits.length > 0) {
      const hitObj = hits[0].object;
      this.hoveredHitMesh = hitObj;
      const payload = hitObj.userData.payload as ClickTargetPayload;
      this.renderer.domElement.style.cursor = 'pointer';
      this.callbacks.onHoverChange({
        level: payload.level,
        id: payload.id,
        name: payload.name,
        subtitle: payload.subtitle,
        lat: payload.lat,
        lon: payload.lon,
        screenX: e.clientX,
        screenY: e.clientY,
        snapshot: payload.snapshot,
      });
      return;
    }

    this.hoveredHitMesh = null;

    if (
      this.currentState.level === HierarchyLevel.WORLD ||
      this.currentState.level === HierarchyLevel.CONTINENT
    ) {
      const globeHits = this.raycaster.intersectObject(this.earthMesh, false);
      if (globeHits.length > 0) {
        const { lat, lon } = vector3ToLatLon(globeHits[0].point);
        const geoCountry = findGeoCountryAtLatLon(lat, lon);
        if (geoCountry) {
          const countryNode = getOrCreateCountryForGeo(geoCountry);
          const snap = computeSnapshotForHour(countryNode.profile, this.currentState.hourFloat);
          this.renderer.domElement.style.cursor = 'pointer';
          this.callbacks.onHoverChange({
            level: HierarchyLevel.COUNTRY,
            id: countryNode.id,
            name: countryNode.name,
            subtitle: `${countryNode.cities.length} Cities · Click to inspect`,
            lat: countryNode.lat,
            lon: countryNode.lon,
            screenX: e.clientX,
            screenY: e.clientY,
            snapshot: snap,
          });
          return;
        }
      }
    }

    this.renderer.domElement.style.cursor = 'grab';
    this.callbacks.onHoverChange(null);
  };

  private onPointerLeave = () => {
    this.hoveredHitMesh = null;
    this.callbacks.onHoverChange(null);
  };

  private onPointerUp = (e: PointerEvent) => {
    const moveDist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y
    );
    if (moveDist > 6) return;

    this.updatePointerNdc(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.clickableMeshes, false);
    if (hits.length > 0) {
      const payload = hits[0].object.userData.payload as ClickTargetPayload;
      if (payload.level === HierarchyLevel.CONTINENT && payload.continentId) {
        this.callbacks.onSelectContinent(payload.continentId);
      } else if (payload.level === HierarchyLevel.COUNTRY && payload.country) {
        this.callbacks.onSelectCountry(payload.country);
      } else if (payload.level === HierarchyLevel.CITY && payload.city) {
        this.callbacks.onSelectCity(payload.city);
      } else if (payload.level === HierarchyLevel.LOCAL_AREA && payload.localArea) {
        this.callbacks.onSelectLocalArea(payload.localArea);
      }
      return;
    }

    const globeHits = this.raycaster.intersectObject(this.earthMesh, false);
    if (globeHits.length > 0) {
      const { lat, lon } = vector3ToLatLon(globeHits[0].point);
      const geoCountry = findGeoCountryAtLatLon(lat, lon);
      if (geoCountry) {
        const countryNode = getOrCreateCountryForGeo(geoCountry);
        this.callbacks.onSelectCountry(countryNode);
      }
    }
  };

  public onResize = () => {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.callbacks.onContextLostChange?.(true);
  };

  private handleContextRestored = () => {
    this.callbacks.onContextLostChange?.(false);
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    if (!sync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const delta = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.getElapsedTime();

      // Drift atmospheric clouds smoothly and adapt opacity to zoom depth
      this.cloudMat.uniforms.uTime.value = elapsed;
      this.cloudMat.uniforms.uZoomOpacity.value = THREE.MathUtils.damp(
        this.cloudMat.uniforms.uZoomOpacity.value,
        this.targetCloudOpacity,
        3.5,
        delta
      );

      for (const mat of this.arcMaterials) {
        mat.uniforms.uTime.value = elapsed;
      }

      for (const rec of this.beacons) {
        rec.cap.rotation.y += delta * 1.4;
        const isHovered = this.hoveredHitMesh === rec.hitMesh;
        const targetS = isHovered ? rec.baseScale * 1.35 : rec.baseScale;
        rec.cap.scale.setScalar(THREE.MathUtils.damp(rec.cap.scale.x, targetS, 10, delta));
      }

      if (this.cameraFlyActive) {
        const lambda = 4.6;
        const alpha = 1 - Math.exp(-lambda * delta);

        this.controls.target.x = THREE.MathUtils.damp(
          this.controls.target.x,
          this.desiredTarget.x,
          lambda,
          delta
        );
        this.controls.target.y = THREE.MathUtils.damp(
          this.controls.target.y,
          this.desiredTarget.y,
          lambda,
          delta
        );
        this.controls.target.z = THREE.MathUtils.damp(
          this.controls.target.z,
          this.desiredTarget.z,
          lambda,
          delta
        );

        _v1.copy(this.camera.position).sub(this.controls.target);
        _v2.copy(this.desiredCamPos).sub(this.desiredTarget);

        const curDist = _v1.length() || 1;
        const targetDist = _v2.length() || 1;
        _v1.normalize();
        _v2.normalize();

        _quat.setFromUnitVectors(_v1, _v2);
        _stepQuat.identity().slerp(_quat, alpha);
        _v1.applyQuaternion(_stepQuat).normalize();

        const nextDist = THREE.MathUtils.damp(curDist, targetDist, lambda, delta);
        this.camera.position.copy(this.controls.target).addScaledVector(_v1, nextDist);

        const minSurfaceClearance = EARTH_RADIUS + 0.65;
        if (this.camera.position.length() < minSurfaceClearance) {
          this.camera.position.normalize().multiplyScalar(minSurfaceClearance);
        }

        if (
          this.camera.position.distanceTo(this.desiredCamPos) < 0.04 &&
          this.controls.target.distanceTo(this.desiredTarget) < 0.02
        ) {
          this.cameraFlyActive = false;
        }
      }

      this.controls.update();
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    dom.removeEventListener('webglcontextlost', this.handleContextLost);
    dom.removeEventListener('webglcontextrestored', this.handleContextRestored);
    window.removeEventListener('resize', this.onResize);

    this.controls.dispose();
    this.earthTextures.dispose();
    this.starSpriteTex.dispose();
    this.envRenderTarget.dispose();

    this.discGeo.dispose();
    this.barGeo.dispose();
    this.capGeo.dispose();
    this.hitSphereGeo.dispose();
    this.ringGeo.dispose();
    this.discMat.dispose();
    this.capMat.dispose();
    this.hitMat.dispose();
    this.channelBarMats.forEach((m) => m.dispose());

    this.scene.traverse((obj) => {
      if (
        (obj as THREE.Mesh).isMesh ||
        (obj as THREE.LineSegments).isLineSegments ||
        (obj as THREE.Points).isPoints
      ) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (dom.parentNode === this.container) {
      this.container.removeChild(dom);
    }
  }
}
