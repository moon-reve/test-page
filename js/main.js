gsap.registerPlugin(ScrollTrigger);

/* ============================================
   SECTION 01 · HERO
   ============================================ */

const heroEl = document.querySelector('.s-hero');
const line1  = document.querySelector('.s-hero__line--1');
const line2  = document.querySelector('.s-hero__line--2');

gsap.set(line2, { opacity: 0, y: 14 });


/* ============================================
   붓터치 호버 효과 — Two-pass render

   Pass 1 (누적 버퍼):
     - 매 프레임 마우스 위치에 타원형 스탬프 찍기
     - 이전 프레임 * decay → 서서히 사라지는 잔상
     - ping-pong WebGLRenderTarget (512×512)

   Pass 2 (최종 렌더):
     - 누적 텍스처를 height map으로 읽어 버텍스 변위
     - 알파: height 낮으면 투명(e1e1e1 바닥 노출), 높으면 불투명
   ============================================ */
(function initHeroBg() {
  const canvas = document.getElementById('hero-canvas');
  let W = window.innerWidth, H = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);

  const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  orthoCamera.position.z = 1;

  // ── Ping-pong 렌더 타겟 (512×512, 충분히 부드러움) ──
  const RT = 512;
  const rtOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  };
  let rtA = new THREE.WebGLRenderTarget(RT, RT, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(RT, RT, rtOpts);

  // ── Pass 1: 누적 셰이더 ────────────────────────────
  // uMouse: 마우스 UV (0~1, y 반전)
  // uVelocity: 이동 방향 단위벡터 → 타원 방향 결정
  // uDecay: 잔상 지속 시간 (0.982 ≈ ~3초 후 소멸)
  // uStamp: 이번 프레임 찍는 양 (마우스 없으면 0)
  const accumVert = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const accumFrag = /* glsl */`
    precision highp float;
    uniform sampler2D uPrev;
    uniform vec2  uMouse;
    uniform float uDecay;
    uniform float uRadius;
    uniform float uStamp;
    uniform float uAspect;
    varying vec2  vUv;

    void main() {
      float prev = texture2D(uPrev, vUv).r * uDecay;

      // aspect 보정 후 원형 거리 계산
      vec2 diff = vUv - uMouse;
      diff.x   *= uAspect;
      float d2  = dot(diff, diff) / (uRadius * uRadius);
      float stamp = uStamp * exp(-d2 * 0.5);

      gl_FragColor = vec4(clamp(prev + stamp, 0.0, 1.0), 0.0, 0.0, 1.0);
    }
  `;

  const accumUniforms = {
    uPrev:   { value: rtA.texture },
    uMouse:  { value: new THREE.Vector2(0.5, -1.0) },
    uDecay:  { value: 0.982 },
    uRadius: { value: 0.055 },
    uStamp:  { value: 0.0 },
    uAspect: { value: W / H },
  };
  const accumScene = new THREE.Scene();
  accumScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: accumUniforms, vertexShader: accumVert, fragmentShader: accumFrag })
  ));

  // ── Pass 2: 최종 렌더 ──────────────────────────────
  const loader = new THREE.TextureLoader();
  const texture = loader.load('assets/images/hero-bg.png');
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const TEX_ASPECT = 1719 / 915;

  const finalVert = /* glsl */`
    uniform sampler2D uHeightMap;
    uniform float     uTexAspect;
    uniform vec2      uResolution;

    varying vec2  vUv;
    varying float vHeight;

    void main() {
      float screenAspect = uResolution.x / uResolution.y;
      vec2 coverUV = uv;
      if (screenAspect > uTexAspect) {
        float scale = uTexAspect / screenAspect;
        coverUV.y = coverUV.y * scale + (1.0 - scale) * 0.5;
      } else {
        float scale = screenAspect / uTexAspect;
        coverUV.x = coverUV.x * scale + (1.0 - scale) * 0.5;
      }
      vUv     = coverUV;
      vHeight = texture2D(uHeightMap, uv).r;

      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const finalFrag = /* glsl */`
    uniform sampler2D uTexture;
    varying vec2  vUv;
    varying float vHeight;

    void main() {
      vec4 color     = texture2D(uTexture, vUv);
      float bumpAlpha = mix(0.01, 1.0, smoothstep(0.0, 0.35, vHeight));
      gl_FragColor   = vec4(color.rgb, bumpAlpha);
    }
  `;

  const finalUniforms = {
    uTexture:    { value: texture },
    uHeightMap:  { value: rtA.texture },
    uTexAspect:  { value: TEX_ASPECT },
    uResolution: { value: new THREE.Vector2(W, H) },
  };
  const finalScene = new THREE.Scene();
  finalScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2, 160, 160),
    new THREE.ShaderMaterial({ uniforms: finalUniforms, vertexShader: finalVert, fragmentShader: finalFrag, transparent: true })
  ));

  // ── 마우스 트래킹 ──────────────────────────────────
  const mouseUV = new THREE.Vector2(0.5, -1.0);
  let isInHero  = false;

  heroEl.addEventListener('mousemove', (e) => {
    mouseUV.set(e.clientX / window.innerWidth, 1.0 - e.clientY / window.innerHeight);
    isInHero = true;
  });
  heroEl.addEventListener('mouseleave', () => { isInHero = false; });

  window.addEventListener('resize', () => {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H);
    finalUniforms.uResolution.value.set(W, H);
    accumUniforms.uAspect.value = W / H;
  });

  // ── 렌더 루프 ──────────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);

    // Pass 1: 누적 버퍼 업데이트
    accumUniforms.uPrev.value  = rtA.texture;
    accumUniforms.uMouse.value.copy(mouseUV);
    accumUniforms.uStamp.value = isInHero ? 0.15 : 0.0;
    renderer.setRenderTarget(rtB);
    renderer.render(accumScene, orthoCamera);

    // ping-pong
    const tmp = rtA; rtA = rtB; rtB = tmp;

    // Pass 2: 최종 렌더
    finalUniforms.uHeightMap.value = rtA.texture;
    renderer.setRenderTarget(null);
    renderer.render(finalScene, orthoCamera);
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
