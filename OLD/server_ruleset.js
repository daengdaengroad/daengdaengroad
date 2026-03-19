const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'daengdaengroad.html'));
});

// ── API 키 설정 ──
const KAKAO_REST_KEY = 'f7ca04239f07af1f3869fcba05b14617';
const TOUR_API_KEY = '233d065589508f0b299039342c1f94700c77477af936e0bc31f210b8091f1ef1';

// ── 활동 유형별 검색 키워드 & 반경 ──
const ACTIVITY_CONFIG = {
  '냄새 탐험': {
    keywords: ['반려견 공원', '애견 공원', '반려견 산책로', '반려동물 공원', '강아지 산책', '반려견 놀이터', '애견 산책'],
    keywordsLong: ['반려견 숲', '반려동물 동반', '애견 동반 공원', '펫프렌들리 공원', '반려견 자연'],
    tourTypes: ['12', '28'],
    courseGuide: '자연 산책로/공원 1곳 + 펫프렌들리 카페 1곳 조합'
  },
  '물놀이': {
    keywords: ['반려견 수영장', '애견 수영장', '강아지 수영', '반려견 계곡', '펫 워터파크'],
    keywordsLong: ['반려견 물놀이', '애견 계곡', '반려동물 수영', '펫 풀장', '강아지 물'],
    tourTypes: ['12', '28'],
    courseGuide: '물놀이 장소 1곳 + 근처 카페나 공원 1곳 조합'
  },
  '에너지 발산': {
    keywords: ['도그런', '반려견 운동장', '애견 운동장', '강아지 운동장', '반려견 놀이터'],
    keywordsLong: ['도그런', '반려견 운동장', '애견 운동장', '반려견 놀이터', '반려동물 공원'],
    tourTypes: ['28', '12'],
    courseGuide: '도그런/운동장 1곳 + 카페 1곳 조합. 공원 2개 금지.'
  },
  '친구 만나기': {
    keywords: ['애견카페', '반려견카페', '강아지카페', '펫카페', '도그카페'],
    keywordsLong: ['애견카페', '반려견 동반 카페', '펫프렌들리 카페', '강아지 카페', '애견 동반 식당'],
    tourTypes: ['39', '32'],
    courseGuide: '펫카페 1곳 + 반려견 동반 식당 or 공원 1곳 조합'
  }
};

const DURATION_CONFIG = {
  '30분 거리': { minKm: 0,  maxKm: 20,  driveMin: 30,  label: '차로 30분 이내' },
  '1시간 거리': { minKm: 15, maxKm: 50,  driveMin: 60,  label: '차로 1시간 이내' },
  '2시간 이상': { minKm: 50, maxKm: 100, driveMin: 120, label: '차로 2시간 전후' },
};

// ── 장소 카테고리 분류 ──
function classifyPlace(place, keywords) {
  const name = place.name || '';
  const nameL = name.toLowerCase();
  const addr = place.address || '';
  const addrL = addr.toLowerCase();
  const combined = (nameL + ' ' + addrL).toLowerCase();

  // 카테고리 우선순위: 더 구체적인 것부터
  const patterns = [
    { cat: '도그런', re: /도그런|dog\s*run|언더독|반려견\s*체험|펫\s*플레이|강아지\s*운동장|애견\s*운동장/ },
    { cat: '수영장', re: /수영장|물놀이|워터파크|펫\s*풀|계곡|물\s*근처|래프팅/ },
    { cat: '카페', re: /카페|café|coffee|펫카페|애견카페|반려견\s*카페|도그\s*카페/ },
    { cat: '식당', re: /레스토랑|음식점|식당|카페|펍|바|식음|구이|국밥|면|밥|음식/ },
    { cat: '숙박', re: /호텔|펜션|콘도|숙박|글램핑|캠핑|게스트\s*하우스/ },
    { cat: '공원', re: /공원|파크|산책로|숲|녹지|대공원|근린공원|나무/ },
    { cat: '미용', re: /미용|그루밍|샤워|목욕|미장원/ },
    { cat: '병원', re: /병원|동물\s*병원|수의|진료|클리닉/ },
    { cat: '펫샵', re: /펫\s*샵|애견\s*용품|강아지\s*용품/ },
  ];

  for (const { cat, re } of patterns) {
    if (re.test(combined)) return cat;
  }
  return '기타';
}

// ── 카카오맵 장소 검색 ──
async function searchKakaoPlaces(keyword, lat, lng, radius) {
  try {
    const res = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
      params: {
        query: keyword,
        x: String(lng),
        y: String(lat),
        radius: 20000,
        size: 15,
        sort: 'distance'
      }
    });
    return res.data.documents || [];
  } catch (e) {
    console.error(`카카오 검색 오류 (${keyword}):`, e.message);
    return [];
  }
}

// ── 한국관광공사 반려동물 동반여행 API ──
async function searchTourPlaces(lat, lng, radius, activityType, minKm=0) {
  try {
    const actConfig = ACTIVITY_CONFIG[activityType] || ACTIVITY_CONFIG['냄새 탐험'];
    const types = actConfig.tourTypes || ['12'];
    const radiusM = Math.min(radius, 20000);
    const results = [];

    for (const typeId of types) {
      try {
        const url = `https://apis.data.go.kr/B551011/KorService2/locationBasedList2?serviceKey=${TOUR_API_KEY}&numOfRows=30&pageNo=1&MobileOS=ETC&MobileApp=daengdaengroad&_type=json&mapX=${String(lng)}&mapY=${String(lat)}&radius=${String(radiusM)}&contentTypeId=${typeId}&arrange=S`;
        const res = await axios.get(url);
        const items = res.data?.response?.body?.items?.item || [];
        const arr = Array.isArray(items) ? items : (items ? [items] : []);
        results.push(...arr);
        console.log(`관광공사 타입${typeId}: ${arr.length}개`);
      } catch(e2) {
        console.error(`관광공사 타입${typeId} 오류:`, e2.response?.status, e2.message);
      }
    }

    console.log(`관광공사 전체 ${results.length}개 수집`);
    if (results.length > 0) {
      const sample = results.slice(0,2).map(p => `${p.title}(dist:${calcDistance(lat,lng,parseFloat(p.mapy),parseFloat(p.mapx)).toFixed(1)}km)`);
      console.log('관광공사 샘플:', sample);
    }

    return results.map(p => ({
      id: 'tour_' + p.contentid,
      name: p.title,
      category: p.contenttypeid === '39' ? '음식점' : p.contenttypeid === '32' ? '숙박' : p.contenttypeid === '28' ? '레포츠' : '관광지',
      address: (p.addr1 || '') + (p.addr2 ? ' ' + p.addr2 : ''),
      roadAddress: p.addr1 || '',
      phone: p.tel || '',
      url: `https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=${p.contentid}`,
      lat: parseFloat(p.mapy),
      lng: parseFloat(p.mapx),
      distance: calcDistance(lat, lng, parseFloat(p.mapy), parseFloat(p.mapx)),
      source: 'tourapi',
      verified: '한국관광공사 반려동물 동반 공식 인증'
    })).filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.distance <= radius/1000);

  } catch (e) {
    console.error('관광공사 API 오류:', e.message);
    return [];
  }
}

// ── 중복 장소 제거 ──
function deduplicatePlaces(places) {
  const seen = new Set();
  return places.filter(p => {
    const key = p.id || p.place_name + p.address_name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 거리 계산 (km) ──
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── 이동 시간 추정 (km당 약 3분, 기본값 5분) ──
function estimateDriveTime(distanceKm) {
  return Math.max(5, Math.round(distanceKm * 3));
}

// ── 체류 시간 추정 (카테고리별) ──
function estimateStayTime(category) {
  const stayTimes = {
    '도그런': 60,
    '수영장': 90,
    '카페': 40,
    '식당': 50,
    '공원': 60,
    '기타': 45
  };
  return stayTimes[category] || 45;
}

// ── 규칙기반 코스 생성 ──
function generateCoursesByRules(places, startLat, startLng, activity, duration, durConfig, dogName, dogSize) {
  console.log(`규칙기반 코스 생성: 전체 ${places.length}개 장소 분석중...`);

  // 거리 필터링
  const validPlaces = places.filter(p => 
    p.distance >= durConfig.minKm && p.distance <= durConfig.maxKm && !isNaN(p.lat) && !isNaN(p.lng)
  );

  if (validPlaces.length === 0) {
    console.warn('유효한 장소 부족');
    return [];
  }

  // 카테고리 분류
  const categorized = {};
  validPlaces.forEach(p => {
    const cat = p.category || classifyPlace(p, ACTIVITY_CONFIG[activity]?.keywords || []);
    if (!categorized[cat]) categorized[cat] = [];
    categorized[cat].push(p);
  });

  console.log('카테고리별 장소 분포:', Object.keys(categorized).map(k => `${k}:${categorized[k].length}`).join(', '));

  // 활동별 코스 구성 규칙
  const courseTemplates = getCourseCombinations(activity, categorized);
  
  if (courseTemplates.length === 0) {
    console.warn('코스 템플릿 생성 불가');
    return [];
  }

  // 각 템플릿으로 코스 생성 (5개까지 시도)
  const courses = [];
  const usedPlaceIds = new Set();

  for (const template of courseTemplates) {
    if (courses.length >= 5) break;

    const course = buildCourse(template, categorized, startLat, startLng, usedPlaceIds, activity, dogName, dogSize);
    if (course) {
      courses.push(course);
      // 사용된 장소 기록 (다양성 확보)
      course.places.forEach(p => usedPlaceIds.add(p.id));
    }
  }

  console.log(`코스 생성 완료: ${courses.length}개`);
  return courses;
}

// ── 활동별 코스 조합 규칙 생성 ──
function getCourseCombinations(activity, categorized) {
  const templates = [];
  
  if (activity === '냄새 탐험') {
    // 공원/산책로 + 카페
    const parks = categorized['공원'] || [];
    const cafes = categorized['카페'] || [];
    if (parks.length > 0 && cafes.length > 0) {
      for (let i = 0; i < Math.min(3, parks.length); i++) {
        for (let j = 0; j < Math.min(3, cafes.length); j++) {
          templates.push({
            primary: { cat: '공원', idx: i },
            secondary: { cat: '카페', idx: j },
            title: '자연 속 여유로운 산책'
          });
        }
      }
    }
  } 
  else if (activity === '물놀이') {
    // 수영장 + 카페/식당
    const pools = categorized['수영장'] || [];
    const cafes = categorized['카페'] || [];
    const restaurants = categorized['식당'] || [];
    const secondary = [...cafes, ...restaurants];
    if (pools.length > 0 && secondary.length > 0) {
      for (let i = 0; i < Math.min(3, pools.length); i++) {
        for (let j = 0; j < Math.min(3, secondary.length); j++) {
          templates.push({
            primary: { cat: '수영장', idx: i },
            secondary: { cat: cafes[j] ? '카페' : '식당', idx: j },
            title: '물놀이 후 휴식'
          });
        }
      }
    }
  }
  else if (activity === '에너지 발산') {
    // 도그런/운동장 + 카페 (공원 제외)
    const dogRuns = categorized['도그런'] || [];
    const playgrounds = categorized['기타']?.filter(p => /운동장|놀이터/.test(p.name)) || [];
    const sports = [...dogRuns, ...playgrounds];
    const cafes = categorized['카페'] || [];
    if (sports.length > 0 && cafes.length > 0) {
      for (let i = 0; i < Math.min(3, sports.length); i++) {
        for (let j = 0; j < Math.min(3, cafes.length); j++) {
          templates.push({
            primary: { cat: sports[i]?.category === '도그런' ? '도그런' : '운동장', idx: i },
            secondary: { cat: '카페', idx: j },
            title: '에너지 발산 후 카페'
          });
        }
      }
    }
  }
  else if (activity === '친구 만나기') {
    // 펫카페 + 식당/공원
    const cafes = categorized['카페'] || [];
    const restaurants = categorized['식당'] || [];
    const parks = categorized['공원'] || [];
    const secondary = [...restaurants, ...parks];
    if (cafes.length > 0 && secondary.length > 0) {
      for (let i = 0; i < Math.min(3, cafes.length); i++) {
        for (let j = 0; j < Math.min(3, secondary.length); j++) {
          templates.push({
            primary: { cat: '카페', idx: i },
            secondary: { cat: restaurants[j] ? '식당' : '공원', idx: j },
            title: '펫카페에서 친구 만나기'
          });
        }
      }
    }
  }

  return templates.slice(0, 15); // 15개까지 시도
}

// ── 각 템플릿으로 코스 구축 ──
function buildCourse(template, categorized, startLat, startLng, usedPlaceIds, activity, dogName, dogSize) {
  const { primary, secondary, title: baseTitle } = template;
  
  const primaryCat = primary.cat;
  const primaryPlaces = categorized[primaryCat] || [];
  
  if (primaryPlaces.length <= primary.idx) return null;
  const primaryPlace = primaryPlaces[primary.idx];
  
  if (usedPlaceIds.has(primaryPlace.id)) return null;

  const secondaryCat = secondary.cat;
  const secondaryPlaces = (categorized[secondaryCat] || []).filter(p => p.id !== primaryPlace.id && !usedPlaceIds.has(p.id));
  
  if (secondaryPlaces.length === 0) return null;
  const secondaryPlace = secondaryPlaces[secondary.idx % secondaryPlaces.length];

  // 두 장소 거리 확인 (10km 이내)
  const distBetween = calcDistance(primaryPlace.lat, primaryPlace.lng, secondaryPlace.lat, secondaryPlace.lng);
  if (distBetween > 10) return null;

  // 코스 정보 계산
  const dist1 = primaryPlace.distance;
  const dist2 = secondaryPlace.distance;
  const driveMin1 = estimateDriveTime(dist1);
  const driveMin2 = estimateDriveTime(distBetween);
  const stayMin1 = estimateStayTime(primaryCat);
  const stayMin2 = estimateStayTime(secondaryCat);
  
  const totalDistance = dist1 + distBetween;
  const totalDriveTime = driveMin1 + driveMin2;
  const totalStayTime = stayMin1 + stayMin2;
  const totalTime = Math.ceil((totalDriveTime + totalStayTime) / 60);

  // 추천 시간대
  let bestTime = '오전 10시';
  if (primaryCat === '수영장' || primaryCat === '도그런') {
    bestTime = '오전 9시~12시';
  } else if (secondaryCat === '식당') {
    bestTime = activity === '친구 만나기' ? '오후 12시~2시' : '저녁 6시~7시';
  }

  const sizeLabel = dogSize === 'small' ? '소형견' : dogSize === 'medium' ? '중형견' : '대형견';

  return {
    title: baseTitle,
    theme: `${sizeLabel}에게 좋은 ${activity}`,
    totalDistance: Number(totalDistance.toFixed(1)),
    driveTime: `차로 ${totalDriveTime}분`,
    totalTime: `약 ${totalTime}시간`,
    bestTime,
    places: [
      {
        name: primaryPlace.name,
        address: primaryPlace.address,
        lat: parseFloat(primaryPlace.lat?.toFixed(4)),
        lng: parseFloat(primaryPlace.lng?.toFixed(4)),
        distance: Number(dist1.toFixed(1)),
        driveMin: driveMin1,
        phone: primaryPlace.phone || '',
        url: primaryPlace.url || '',
        id: primaryPlace.id,
        reason: `${dogName || '강아지'}이 좋아할 ${primaryCat} 명소예요`,
        tip: `${primaryCat === '도그런' ? '목줄은 벗고 자유롭게!' : '시간에 여유를 가지고 방문하세요'}`,
        stayMin: stayMin1
      },
      {
        name: secondaryPlace.name,
        address: secondaryPlace.address,
        lat: parseFloat(secondaryPlace.lat?.toFixed(4)),
        lng: parseFloat(secondaryPlace.lng?.toFixed(4)),
        distance: Number(dist2.toFixed(1)),
        driveMin: driveMin2,
        phone: secondaryPlace.phone || '',
        url: secondaryPlace.url || '',
        id: secondaryPlace.id,
        reason: `여행을 더 풍성하게 해주는 ${secondaryCat}`,
        tip: `펫 동반 가능 여부를 미리 확인하세요`,
        stayMin: stayMin2
      }
    ],
    highlight: `${primaryCat}에서 즐겁고, ${secondaryCat}에서 휴식하는 완벽한 조합`
  };
}

// ── 코스 생성 API ──
app.post('/api/generate-course', async (req, res) => {
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const { activity, duration, dogName, dogBreed, dogSize } = req.body;
  const durConfig = DURATION_CONFIG[duration] || DURATION_CONFIG['1시간 거리'];
  const radius = req.body.radius ? parseInt(req.body.radius) : durConfig.maxKm * 1000;
  const minKm = durConfig.minKm;

  console.log('요청 파라미터:', { lat, lng, activity, duration, radius });

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: '위치 정보가 올바르지 않아요' });
  }
  if (!activity || !duration) {
    return res.status(400).json({ error: '활동과 시간 정보가 필요해요' });
  }

  console.log(`코스 생성 요청: ${activity} / ${duration} / 반경 ${radius/1000}km`);

  try {
    // 1. 카카오맵 + 한국관광공사 API 병렬 검색
    async function searchKakaoMultiRadius(keywords, centerLat, centerLng, maxRadius, minRadius) {
      const results = [];
      const searchPoints = maxRadius <= 20000
        ? [{ lat: centerLat, lng: centerLng }]
        : maxRadius <= 50000
          ? [
              { lat: centerLat + 0.22, lng: centerLng },
              { lat: centerLat - 0.22, lng: centerLng },
              { lat: centerLat, lng: centerLng + 0.33 },
              { lat: centerLat, lng: centerLng - 0.33 },
              { lat: centerLat + 0.15, lng: centerLng + 0.22 },
              { lat: centerLat - 0.15, lng: centerLng - 0.22 },
            ]
          : [
              { lat: centerLat + 0.55, lng: centerLng },
              { lat: centerLat - 0.55, lng: centerLng },
              { lat: centerLat, lng: centerLng + 0.75 },
              { lat: centerLat, lng: centerLng - 0.75 },
              { lat: centerLat + 0.4, lng: centerLng + 0.5 },
              { lat: centerLat - 0.4, lng: centerLng + 0.5 },
              { lat: centerLat + 0.4, lng: centerLng - 0.5 },
              { lat: centerLat - 0.4, lng: centerLng - 0.5 },
            ];

      for (const point of searchPoints) {
        for (const kw of keywords) {
          const places = await searchKakaoPlaces(kw, point.lat, point.lng, 20000);
          results.push(...places);
        }
      }
      return results;
    }

    const config = ACTIVITY_CONFIG[activity] || ACTIVITY_CONFIG['친구 만나기'];
    const [kakaoResults, tourResults] = await Promise.all([
      searchKakaoMultiRadius(minKm > 20 ? (config.keywordsLong || config.keywords) : config.keywords, lat, lng, radius, minKm),
      searchTourPlaces(lat, lng, radius, activity, minKm)
    ]);

    // 2. 카카오맵 결과 변환
    const kakaoPlaces = kakaoResults.map(p => ({
      id: 'kakao_' + p.id,
      name: p.place_name,
      category: p.category_name || '기타',
      address: p.address_name,
      phone: p.phone || '',
      url: p.place_url || '',
      lat: p.y,
      lng: p.x,
      distance: calcDistance(lat, lng, p.y, p.x),
      source: 'kakao',
      verified: '카카오맵 검색'
    }));

    const allPlaces = [...tourResults, ...kakaoPlaces];
    const unique = deduplicatePlaces(allPlaces);

    if (unique.length === 0) {
      console.log('장소 없음 - 관광공사:', tourResults.length, '카카오:', kakaoPlaces.length);
      return res.status(404).json({ error: `${durConfig.label} 범위(${minKm}~${durConfig.maxKm}km)에 ${activity} 장소가 없어요. 다른 활동이나 거리를 선택해보세요.` });
    }

    // 관광공사 데이터 우선 정렬
    unique.sort((a, b) => {
      if (a.source === 'tourapi' && b.source !== 'tourapi') return -1;
      if (b.source === 'tourapi' && a.source !== 'tourapi') return 1;
      return a.distance - b.distance;
    });

    console.log(`수집된 장소: 관광공사 ${tourResults.length}개 + 카카오 ${kakaoPlaces.length}개 → 중복제거 후 ${unique.length}개`);

    // 3. 규칙기반 코스 생성 (LLM 대체)
    const courses = generateCoursesByRules(unique, lat, lng, activity, duration, durConfig, dogName, dogSize);

    if (courses.length === 0) {
      return res.status(404).json({ 
        error: `충분한 장소 데이터로 코스를 만들 수 없어요. 다른 조건을 시도해보세요.`,
        detail: `수집된 장소: ${unique.length}개`
      });
    }

    // 캐시에 저장
    const cacheKey = `${Math.round(lat / 0.045) * 0.045}_${Math.round(lng / 0.055) * 0.055}_${activity}_${duration}`;
    setToCache(cacheKey, courses);

    // 랜덤 3개 반환
    const returnCourses = courses.sort(() => Math.random() - 0.5).slice(0, 3);
    res.json({
      success: true,
      courses: returnCourses,
      meta: { totalPlacesFound: unique.length, activity, duration, radius: radius / 1000, algorithm: 'rule-based' }
    });

  } catch (err) {
    console.error('코스 생성 오류:', err.message);
    if (err.response) {
      console.error('응답 상태:', err.response.status);
      console.error('응답 데이터:', JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({ error: '코스 생성 중 오류가 발생했어요.', detail: err.message });
  }
});

// ── 코스 캐시 (24시간) ──
const CACHE_FILE = path.join(__dirname, 'course_cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveCache(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8'); } catch {}
}

function getFromCache(key) {
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL) {
    delete cache[key];
    saveCache(cache);
    return null;
  }
  const pool = entry.courses;
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(3, shuffled.length));
}

function setToCache(key, courses) {
  const cache = loadCache();
  cache[key] = { createdAt: Date.now(), courses };
  const keys = Object.keys(cache);
  if (keys.length > 100) {
    const oldest = keys.sort((a,b) => cache[a].createdAt - cache[b].createdAt)[0];
    delete cache[oldest];
  }
  saveCache(cache);
}

// ── 후기 관리 ──
const REVIEWS_FILE = path.join(__dirname, 'reviews.json');
function loadReviews() {
  try { return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveReviews(data) {
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

app.get('/api/reviews/:placeId', (req, res) => {
  const reviews = loadReviews();
  const placeId = decodeURIComponent(req.params.placeId);
  const placeReviews = reviews[placeId] || [];
  const avg = placeReviews.length
    ? (placeReviews.reduce((s, r) => s + r.stars, 0) / placeReviews.length).toFixed(1)
    : null;
  res.json({ reviews: placeReviews, avg, count: placeReviews.length });
});

app.post('/api/reviews', (req, res) => {
  const { placeId, placeName, dogName, dogBreed, stars, text } = req.body;
  if (!placeId || !text || !stars) return res.status(400).json({ error: '필수 항목 누락' });
  const reviews = loadReviews();
  if (!reviews[placeId]) reviews[placeId] = [];
  const review = {
    id: Date.now(),
    placeName,
    dogName: dogName || '익명',
    dogBreed: dogBreed || '',
    stars: parseInt(stars),
    text,
    date: new Date().toLocaleDateString('ko-KR'),
    createdAt: new Date().toISOString()
  };
  reviews[placeId].unshift(review);
  if (reviews[placeId].length > 100) reviews[placeId] = reviews[placeId].slice(0, 100);
  saveReviews(reviews);
  console.log(`후기 저장: ${placeName} - ${dogName} (★${stars})`);
  res.json({ success: true, review });
});

// ── 헬스체크 ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '댕댕로드 서버 정상 작동 중 🐾', algorithm: 'rule-based' });
});
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '댕댕로드 서버 정상 작동 중 🐾', algorithm: 'rule-based' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐾 댕댕로드 서버 시작! (규칙기반 알고리즘) http://localhost:${PORT}`);
});
