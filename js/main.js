gsap.registerPlugin(ScrollTrigger);

/* ============================================
   SECTION 01 · HERO
   ============================================ */

const heroEl = document.querySelector('.s-hero');
const line1  = document.querySelector('.s-hero__line--1');
const line2  = document.querySelector('.s-hero__line--2');

gsap.set(line2, { opacity: 0, y: 14 });


/* ============================================
   양각 호버 효과 — Three.js 커스텀 셰이더

   원리:
   - PlaneGeometry(2,2, 128,128): 128×128 분할 → 부드러운 곡면
   - 버텍스 셰이더: 마우스 UV 주변에 가우시안 범프 생성 (국소 영역만 상승)
   - 프래그먼트 셰이더: dFdx/dFdy로 법선 계산 → 조명 적용
   - 범프 밖은 PNG 원본 그대로, 마우스 근처만 3D로 솟아오름
   ============================================ */
(function initHeroBg() {
  const canvas = document.getElementById('hero-canvas');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  // ── 텍스처 로드 ──────────────────────────────
  const loader = new THREE.TextureLoader();
  const texture = loader.load('assets/images/hero-bg.png');
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  // hero-bg.png 원본 비율 (1719×915)
  const TEX_ASPECT = 1719 / 915;

  // ── 버텍스 셰이더 ─────────────────────────────
  // uMouse: 마우스 위치 (-1~1, NDC)
  // uRadius: 범프 반경 (aspect 보정된 UV 공간)
  // uStrength: 최대 Z 변위량
  const vertexShader = /* glsl */`
    uniform vec2  uMouse;
    uniform float uRadius;
    uniform float uStrength;
    uniform float uTexAspect;
    uniform vec2  uResolution;

    varying vec2  vUv;
    varying float vHeight;

    void main() {
      // cover UV: 화면과 텍스처 비율 맞춤
      float screenAspect = uResolution.x / uResolution.y;
      vec2 coverUV = uv;
      if (screenAspect > uTexAspect) {
        float scale = uTexAspect / screenAspect;
        coverUV.y = coverUV.y * scale + (1.0 - scale) * 0.5;
      } else {
        float scale = screenAspect / uTexAspect;
        coverUV.x = coverUV.x * scale + (1.0 - scale) * 0.5;
      }
      vUv = coverUV;

      vec3 pos = position;

      // 버텍스 UV (0~1)
      vec2 vPos = (pos.xy + 1.0) * 0.5;
      // 마우스 UV (0~1)
      vec2 mPos = (uMouse + 1.0) * 0.5;

      // aspect 보정 거리 계산 → 화면에서 원형으로 보임
      vec2 diff = vPos - mPos;
      diff.x   *= screenAspect;
      float d   = length(diff);

      // 가우시안 범프 — 마우스 근처만 Z 방향으로 상승
      float bump = uStrength * exp(-(d * d) / (2.0 * uRadius * uRadius));
      pos.z     += bump;
      vHeight    = bump;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  // ── 프래그먼트 셰이더 ─────────────────────────
  // dFdx/dFdy로 범프 기울기 → 법선 계산 → 조명 적용
  // 범프 밖(slope ≈ 0)은 조명 변화 없음 → PNG 원본 그대로 보임
  const fragmentShader = /* glsl */`
    uniform sampler2D uTexture;

    varying vec2  vUv;
    varying float vHeight;

    void main() {
      vec4 color = texture2D(uTexture, vUv);

      // 화면공간 미분으로 표면 법선 추정
      float dHx = dFdx(vHeight);
      float dHy = dFdy(vHeight);
      vec3  N   = normalize(vec3(-dHx * 14.0, dHy * 14.0, 1.0));

      // 조명: ambient + diffuse + specular
      // 캘리브레이션: 플랫 법선(0,0,1)일 때 lighting = 1.0 → 원본 색 보존
      // L.z = dot((0,0,1), normalize(0.6,0.8,1.5)) ≈ 0.754
      // ambient = 1.0 - 0.754 * diffuseStr
      vec3  L            = normalize(vec3(0.6, 0.8, 1.5));
      vec3  V            = vec3(0.0, 0.0, 1.0);
      vec3  H            = normalize(L + V);

      float diffuseStr   = 0.26;
      float ambient      = 1.0 - 0.754 * diffuseStr;   // ≈ 0.804
      float diffuse      = max(dot(N, L), 0.0) * diffuseStr;
      float specular     = pow(max(dot(N, H), 0.0), 90.0) * 0.10;

      // 범프 밖: ambient + diffuse(flat) ≈ 1.0 → 원본 그대로
      // 범프 엣지: diffuse 변화 + specular → 3D 음영 표현
      float lighting = ambient + diffuse + specular;

      gl_FragColor = vec4(color.rgb * lighting, 1.0);
    }
  `;

  // ── 머티리얼 & 메시 ───────────────────────────
  const uniforms = {
    uTexture:    { value: texture },
    uMouse:      { value: new THREE.Vector2(0, -9999) }, // 초기값: 화면 밖
    uRadius:     { value: 0.22 },   // 범프 반경 (aspect 보정 UV 기준)
    uStrength:   { value: 0.11 },   // 최대 Z 변위
    uTexAspect:  { value: TEX_ASPECT },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });

  // 128×128 분할 — 가우시안 곡면을 부드럽게 표현
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 128, 128), material);
  scene.add(plane);

  // ── 마우스 트래킹 ─────────────────────────────
  let targetX = 0, targetY = -9999;
  let mx = 0,      my = -9999;

  heroEl.addEventListener('mousemove', (e) => {
    targetX =  (e.clientX / window.innerWidth)  * 2 - 1;
    targetY = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // 마우스가 섹션 벗어나면 범프 화면 밖으로 이동
  heroEl.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = -9999;
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  });

  // ── 렌더 루프 ─────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);
    mx += (targetX - mx) * 0.08;
    my += (targetY - my) * 0.08;
    uniforms.uMouse.value.set(mx, my);
    renderer.render(scene, camera);
  }
  tick();
})();


/* ============================================
   SECTION 02 · VIDEO MASK REVEAL
   ============================================ */
gsap.fromTo('.s-video__mask',
  { clipPath: 'inset(20% 25% 20% 25%)' },
  {
    clipPath: 'inset(0% 0% 0% 0%)',
    ease: 'none',
    scrollTrigger: {
      trigger: '.s-video',
      start: 'top top',
      end: '+=1000',
      pin: true,
      scrub: 1,
    },
  }
);


/* ============================================
   SECTION 01 · 텍스트 크로스페이드
   ============================================ */
const heroTl = gsap.timeline({
  scrollTrigger: {
    trigger: '.s-hero',
    start:   'top top',
    end:     '+=600',
    pin:     true,
    scrub:   0.9,
  }
});

heroTl
  .to(line1, { opacity: 0, y: -14, duration: 0.45 })
  .to(line2, { opacity: 1, y:   0, duration: 0.45 }, 0.3);
