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
   - 배경: #e1e1e1 (CSS) + 투명 캔버스 (alpha: true)
   - 평면 구간: PNG 알파 낮음(0.28) → e1e1e1 위에 흐릿하게 깔림
   - 마우스 근처: Gaussian bump으로 솟아오르며 알파 1.0 + 3D 조명
   - 범프 기저부: 컨택트 섀도(어두운 고리) → "들려올라오는" 느낌
   ============================================ */
(function initHeroBg() {
  const canvas = document.getElementById('hero-canvas');

  // alpha: true → 캔버스 배경 투명, CSS #e1e1e1 바닥이 비침
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // 완전 투명

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const loader = new THREE.TextureLoader();
  const texture = loader.load('assets/images/hero-bg.png');
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  const TEX_ASPECT = 1719 / 915;

  // ── 버텍스 셰이더 ─────────────────────────────
  const vertexShader = /* glsl */`
    uniform vec2  uMouse;
    uniform float uRadius;
    uniform float uStrength;
    uniform float uTexAspect;
    uniform vec2  uResolution;

    varying vec2  vUv;
    varying float vHeight;

    void main() {
      float screenAspect = uResolution.x / uResolution.y;

      // cover UV: 텍스처 비율 맞춤
      vec2 coverUV = uv;
      if (screenAspect > uTexAspect) {
        float scale = uTexAspect / screenAspect;
        coverUV.y = coverUV.y * scale + (1.0 - scale) * 0.5;
      } else {
        float scale = screenAspect / uTexAspect;
        coverUV.x = coverUV.x * scale + (1.0 - scale) * 0.5;
      }
      vUv = coverUV;

      vec3 pos  = position;
      vec2 vPos = (pos.xy + 1.0) * 0.5;
      vec2 mPos = (uMouse + 1.0) * 0.5;

      vec2 diff = vPos - mPos;
      diff.x   *= screenAspect;
      float d   = length(diff);

      // 가우시안 범프
      float bump = uStrength * exp(-(d * d) / (2.0 * uRadius * uRadius));
      pos.z     += bump;
      vHeight    = bump;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  // ── 프래그먼트 셰이더 ─────────────────────────
  // 핵심:
  //   1. bumpAlpha: 범프 높이에 따라 투명도 0.28 → 1.0
  //      → 평면 구간: 흐릿, 범프 구간: 완전 불투명
  //   2. 컨택트 섀도: 범프 기저부(경사 최대 구간) 어둡게
  //   3. 스펙큘러 하이라이트: 범프 정상부 밝게
  const fragmentShader = /* glsl */`
    uniform sampler2D uTexture;
    uniform float     uStrength;

    varying vec2  vUv;
    varying float vHeight;

    void main() {
      vec4 color = texture2D(uTexture, vUv);

      // ── 1. 알파: 범프 높이 기반 (평면=0.28, 범프=1.0) ──
      float bumpNorm  = vHeight / max(uStrength, 0.001);
      float bumpAlpha = mix(0.28, 1.0, smoothstep(0.0, 0.35, bumpNorm));

      // ── 2. 법선 기반 조명 ────────────────────────────
      float dHx = dFdx(vHeight);
      float dHy = dFdy(vHeight);
      vec3  N   = normalize(vec3(-dHx * 18.0, dHy * 18.0, 1.0));

      vec3  L   = normalize(vec3(0.8, 1.0, 1.8));
      vec3  V   = vec3(0.0, 0.0, 1.0);
      vec3  H   = normalize(L + V);

      float diffuseStr = 0.32;
      float Lz         = dot(vec3(0,0,1), normalize(vec3(0.8,1.0,1.8)));
      float ambient    = 1.0 - Lz * diffuseStr;
      float diffuse    = max(dot(N, L), 0.0) * diffuseStr;
      float specular   = pow(max(dot(N, H), 0.0), 80.0) * 0.18;

      // ── 3. 컨택트 섀도 — 범프 기저부(경사 최대 구간) 어둡게 ──
      float slope       = length(vec2(dHx, dHy));
      float contactDark = 1.0 - clamp(slope * 10.0, 0.0, 0.45);

      // ── 4. 범프 정상부 밝기 보정 ─────────────────────
      float peakBoost = 1.0 + smoothstep(0.6, 1.0, bumpNorm) * 0.12;

      float lighting = (ambient + diffuse + specular) * contactDark * peakBoost;

      gl_FragColor = vec4(color.rgb * lighting, bumpAlpha);
    }
  `;

  // ── 머티리얼 & 메시 ───────────────────────────
  const uniforms = {
    uTexture:    { value: texture },
    uMouse:      { value: new THREE.Vector2(0, -9999) },
    uRadius:     { value: 0.16 },   // 범프 반경 (작게 = 국소 효과)
    uStrength:   { value: 0.16 },   // 범프 높이
    uTexAspect:  { value: TEX_ASPECT },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 160, 160), material);
  scene.add(plane);

  // ── 마우스 트래킹 ─────────────────────────────
  let targetX = 0, targetY = -9999;
  let mx = 0,      my = -9999;

  heroEl.addEventListener('mousemove', (e) => {
    targetX =  (e.clientX / window.innerWidth)  * 2 - 1;
    targetY = -(e.clientY / window.innerHeight) * 2 + 1;
  });

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
    mx += (targetX - mx) * 0.07;
    my += (targetY - my) * 0.07;
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
