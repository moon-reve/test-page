gsap.registerPlugin(ScrollTrigger);

/* ============================================
   SECTION 01 · HERO
   ============================================ */

const heroEl = document.querySelector('.s-hero');
const line1  = document.querySelector('.s-hero__line--1');
const line2  = document.querySelector('.s-hero__line--2');

gsap.set(line2, { opacity: 0, y: 14 });


/* ============================================
   양각 효과 — Three.js

   구조:
   - OrthographicCamera + PlaneGeometry(2,2) → 화면 전체 채움
   - 배경 PNG를 map(텍스처) + bumpMap(높낮이 정보) 동시 사용
   - AmbientLight: 기본 밝기 유지
   - PointLight: 마우스 좌표로 실시간 이동 → 방향성 그림자로 양각 표현
   ============================================ */
(function initHeroBg() {
  const canvas = document.getElementById('hero-canvas');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();

  // OrthographicCamera: -1~1 범위 → PlaneGeometry(2,2)이 정확히 꽉 참
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  // 텍스처 로드
  const loader = new THREE.TextureLoader();

  function loadCoverTexture(url, callback) {
    return loader.load(url, (tex) => {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      // background-size: cover 동작 재현
      const imgW = tex.image.width;
      const imgH = tex.image.height;
      const screenAspect = window.innerWidth / window.innerHeight;
      const imgAspect    = imgW / imgH;
      if (screenAspect > imgAspect) {
        tex.repeat.set(1, imgAspect / screenAspect);
        tex.offset.set(0, (1 - imgAspect / screenAspect) / 2);
      } else {
        tex.repeat.set(screenAspect / imgAspect, 1);
        tex.offset.set((1 - screenAspect / imgAspect) / 2, 0);
      }
      if (callback) callback(tex);
    });
  }

  const bgTex   = loadCoverTexture('assets/images/hero-bg.png');
  const bumpTex = loadCoverTexture('assets/images/hero-bg.png');

  const material = new THREE.MeshStandardMaterial({
    map:       bgTex,
    bumpMap:   bumpTex,
    bumpScale: 0.18,   // 양각 강도 — 높을수록 깊이감 증가
    roughness: 0.9,
    metalness: 0.0,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(plane);

  // 기본 환경광 — 낮게 유지해야 DirectionalLight 대비가 보임
  const ambient = new THREE.AmbientLight(0xfff6e8, 0.55);
  scene.add(ambient);

  // DirectionalLight: 방향에 따라 bumpMap 음영 뚜렷하게 표현
  // PointLight보다 양각 효과가 훨씬 강하게 나타남
  const dirLight = new THREE.DirectionalLight(0xfffaf0, 1.8);
  dirLight.position.set(0, 0.5, 1);
  scene.add(dirLight);

  // 마우스 → 정규화 좌표 (-1 ~ 1)
  let targetX = 0, targetY = 0;
  let lx = 0,      ly = 0;

  heroEl.addEventListener('mousemove', (e) => {
    targetX =  (e.clientX / window.innerWidth)  * 2 - 1;
    targetY = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // 리사이즈 대응
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 렌더 루프 — lerp로 빛 방향이 부드럽게 따라옴
  function tick() {
    requestAnimationFrame(tick);
    lx += (targetX - lx) * 0.06;
    ly += (targetY - ly) * 0.06;
    // 마우스 위치를 빛의 방향 벡터로 변환 (얕은 각도일수록 음영 강조)
    dirLight.position.set(lx * 2.5, ly * 1.8, 1.0);
    renderer.render(scene, camera);
  }
  tick();
})();


/* ============================================
   SECTION 02 · VIDEO MASK REVEAL

   - 섹션 pin (1000px 동안 유지)
   - clip-path: 작은 액자 → 전체 화면으로 확장
   - scrub: 스크롤 속도에 정직하게 반응
   ============================================ */
gsap.fromTo('.s-video__mask',
  {
    clipPath: 'inset(20% 25% 20% 25%)',
  },
  {
    clipPath: 'inset(0% 0% 0% 0%)',
    ease: 'none',
    scrollTrigger: {
      trigger: '.s-video',
      start: 'top top',
      end: '+=1000',
      pin: true,
      scrub: 1,
      // markers: true,
    },
  }
);


/* ============================================
   스크롤 트리거 · pin + 텍스트 크로스페이드

   - 섹션을 top에 고정(pin)
   - 600px 스크롤하는 동안 pin 유지
   - line-1 → 사라지고, line-2 → 올라오며 나타남
   ============================================ */
const heroTl = gsap.timeline({
  scrollTrigger: {
    trigger: '.s-hero',
    start:   'top top',
    end:     '+=600',
    pin:     true,
    scrub:   0.9,
    // markers: true, // 디버그 시 주석 해제
  }
});

heroTl
  .to(line1, { opacity: 0, y: -14, duration: 0.45 })
  .to(line2, { opacity: 1, y:   0, duration: 0.45 }, 0.3);
