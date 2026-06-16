gsap.registerPlugin(ScrollTrigger);

/* ============================================
   SECTION 01 · HERO
   ============================================ */

const heroEl = document.querySelector('.s-hero');
const line1  = document.querySelector('.s-hero__line--1');
const line2  = document.querySelector('.s-hero__line--2');

gsap.set(line2, { opacity: 0, y: 14 });


/* ============================================
   먹붓 호버 효과 — Two-pass render

   Pass 1 (누적 버퍼):
     - FBM 노이즈로 불규칙한 원 경계 생성
     - 경계 바깥 붓털(bristle) 추가
     - 마우스 속도에 따라 이동 방향으로 늘어남
     - 이전 프레임 * decay → 잔상 후 소멸

   Pass 2 (최종 렌더):
     - height map으로 PNG 알파 제어
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

  // ── Ping-pong 렌더 타겟 ────────────────────────
  const RT = 512;
  const rtOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  };
  let rtA = new THREE.WebGLRenderTarget(RT, RT, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(RT, RT, rtOpts);

  // ── Pass 1: 누적 셰이더 ────────────────────────
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
    uniform vec2  uVelocity;   // 정규화된 이동 방향
    uniform float uElongate;   // 속도 기반 늘어남 (1.0=원형, 2.5=최대)
    uniform float uDecay;
    uniform float uRadius;
    uniform float uStamp;
    uniform float uAspect;
    varying vec2 vUv;

    // ── 노이즈 유틸리티 ──────────────────────────
    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),              hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    // FBM (5 옥타브)
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p  = p * 2.1 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      float prev = texture2D(uPrev, vUv).r * uDecay;

      // aspect 보정 거리
      vec2 diff = vUv - uMouse;
      diff.x   *= uAspect;

      // 속도 방향으로 로컬 좌표 회전
      vec2 vel   = normalize(uVelocity + vec2(0.00001, 0.0));
      vec2 local = vec2(
         diff.x * vel.x + diff.y * vel.y,
        -diff.x * vel.y + diff.y * vel.x
      );

      // 이동 방향(local.y)으로 늘어남
      vec2 shape = vec2(local.x, local.y / uElongate);

      float r     = uRadius;
      float d     = length(shape);
      float angle = atan(shape.y, shape.x);

      // 각도를 원 위의 점으로 변환 → 노이즈 연속성 보장
      vec2 cp = vec2(cos(angle), sin(angle));

      // ── 1. 불규칙한 외곽선 ─────────────────────
      // 저주파: 큰 굴곡 / 고주파: 잔 털 같은 엣지
      float edgeNoise  = fbm(cp * 3.0 + vec2(3.7, 1.9));
      float edgeNoise2 = fbm(cp * 8.0 + vec2(1.2, 4.8));
      float roughR     = r * (0.62 + edgeNoise * 0.48 + edgeNoise2 * 0.18);

      // 안쪽도 거칠게: transition 폭 넓힘
      float body = 1.0 - smoothstep(roughR * 0.60, roughR, d);

      // ── 2. 붓털 (bristle) ──────────────────────
      // 고주파 FBM으로 경계 바깥에 뻗는 가는 털
      float bristleNoise = fbm(cp * 10.0 + vec2(6.3, 2.4));
      float bristleLen   = r * 0.40 * bristleNoise;
      float outerR       = roughR + bristleLen;
      float inBristle    = smoothstep(roughR * 0.88, roughR * 1.02, d)
                         * (1.0 - smoothstep(outerR * 0.90, outerR, d));
      float bristles     = inBristle * bristleNoise;

      // ── 3. 합산 ───────────────────────────────
      float brush = clamp(body + bristles * 0.70, 0.0, 1.0);
      float stamp = uStamp * brush;

      gl_FragColor = vec4(clamp(prev + stamp, 0.0, 1.0), 0.0, 0.0, 1.0);
    }
  `;

  const accumUniforms = {
    uPrev:     { value: rtA.texture },
    uMouse:    { value: new THREE.Vector2(0.5, -1.0) },
    uVelocity: { value: new THREE.Vector2(0.0, 1.0) },
    uElongate: { value: 1.0 },
    uDecay:    { value: 0.982 },
    uRadius:   { value: 0.055 },
    uStamp:    { value: 0.0 },
    uAspect:   { value: W / H },
  };

  const accumScene = new THREE.Scene();
  accumScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: accumUniforms, vertexShader: accumVert, fragmentShader: accumFrag })
  ));

  // ── Pass 2: 최종 렌더 ──────────────────────────
  const loader = new THREE.TextureLoader();
  const texture = loader.load('assets/images/hero-bg.png');
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const TEX_ASPECT = 1719 / 915;

  const finalVert = /* glsl */`
    uniform sampler2D uHeightMap;
    uniform float     uTexAspect;
    uniform vec2      uResolution;
    varying vec2      vUv;
    varying float     vHeight;

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

  // ── 마우스 트래킹 + 속도 계산 ──────────────────
  const mouseUV    = new THREE.Vector2(0.5, -1.0); // 실제 마우스
  const smoothMouse = new THREE.Vector2(0.5, -1.0); // 딜레이 적용 마우스
  const prevMouse  = new THREE.Vector2(0.5, -1.0);
  let velX = 0, velY = 0;
  let dirX = 0, dirY = 1;
  let isInHero = false;

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

  // ── 렌더 루프 ──────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);

    // 딜레이: smoothMouse가 mouseUV를 천천히 따라옴
    smoothMouse.x += (mouseUV.x - smoothMouse.x) * 0.06;
    smoothMouse.y += (mouseUV.y - smoothMouse.y) * 0.06;

    // 속도 스무딩 (smoothMouse 기준으로 계산)
    const rawVX = smoothMouse.x - prevMouse.x;
    const rawVY = smoothMouse.y - prevMouse.y;
    velX += (rawVX - velX) * 0.25;
    velY += (rawVY - velY) * 0.25;
    prevMouse.copy(smoothMouse);

    const speed = Math.sqrt(velX * velX + velY * velY);
    if (speed > 0.0003) { dirX = velX / speed; dirY = velY / speed; }

    const elongate = 1.0 + Math.min(speed * 130.0, 1.4);

    // Pass 1
    accumUniforms.uPrev.value = rtA.texture;
    accumUniforms.uMouse.value.copy(smoothMouse);
    accumUniforms.uVelocity.value.set(dirX, dirY);
    accumUniforms.uElongate.value = elongate;
    accumUniforms.uStamp.value    = isInHero ? 0.18 : 0.0;
    renderer.setRenderTarget(rtB);
    renderer.render(accumScene, orthoCamera);

    const tmp = rtA; rtA = rtB; rtB = tmp;

    // Pass 2
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
