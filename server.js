require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// ── MongoDB 연결 ──
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB 연결 성공!'))
    .catch(e => console.error('❌ MongoDB 연결 실패:', e.message));
} else {
  console.log('⚠️ MONGODB_URI 없음 - 파일 저장 모드로 동작');
}

// ── 유저 스키마 ──
const userSchema = new mongoose.Schema({
  kakaoId:  { type: String, required: true, unique: true },
  nickname: String,
  profileImage: String,
  dogName:  String,
  dogBreed: String,
  dogSize:  String,
  dogPhoto: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

// ── 후기 스키마 ──
const reviewSchema = new mongoose.Schema({
  placeId:   { type: String, required: true, index: true },
  placeName: String,
  kakaoId:   String,
  dogName:   String,
  dogBreed:  String,
  stars:     Number,
  text:      String,
  date:      String,
  createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 정적 파일 CORS 헤더
app.use('/public', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.static(__dirname));
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});
app.get('/icon-:size.png', (req, res) => {
  res.sendFile(path.join(__dirname, `icon-${req.params.size}.png`));
});

// ── API 키 설정 ──
const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY;
const GROQ_API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
];
let groqKeyIndex = 0;
function getGroqKey() {
  const key = GROQ_API_KEYS[groqKeyIndex % GROQ_API_KEYS.length];
  groqKeyIndex++;
  return key;
}
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const TOUR_API_KEY = process.env.TOUR_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── 활동 유형별 검색 키워드 & 반경 ──
const ACTIVITY_CONFIG = {
  '애견카페': {
    keywords: ['애견카페', '반려견카페', '강아지카페', '펫카페', '도그카페'],
    keywordsLong: ['애견카페', '반려견 동반 카페', '펫프렌들리 카페', '강아지 카페', '애견 테마카페'],
    extraKeywords: {
      '애견 식당': ['애견 식당', '반려견 식당', '반려동물 식당', '펫프렌들리 레스토랑', '애견 동반 식당'],
      '애견 공원': ['애견 공원', '반려견 공원', '반려견 놀이터', '애견 놀이터', '반려동물 공원']
    },
    tourTypes: ['39', '12'],
    courseGuide: '코스 순서: ①애견카페 1곳 → ②애견식당 1곳 → ③애견공원 1곳. 이 순서와 조합을 반드시 지킬 것.'
  },
  '애견식당': {
    keywords: ['애견 식당', '반려견 식당', '반려동물 식당', '펫프렌들리 레스토랑', '애견 동반 식당'],
    keywordsLong: ['반려견 동반 레스토랑', '펫프렌들리 음식점', '애견 동반 음식점', '반려동물 동반 레스토랑', '강아지 동반 식당'],
    extraKeywords: {
      '애견카페': ['애견카페', '반려견카페', '강아지카페', '펫카페', '도그카페'],
      '애견 공원': ['애견 공원', '반려견 공원', '반려견 놀이터', '애견 놀이터', '반려동물 공원']
    },
    tourTypes: ['39', '12'],
    courseGuide: '코스 순서: ①애견식당 1곳 → ②애견카페 1곳 → ③애견공원 1곳. 이 순서와 조합을 반드시 지킬 것.'
  }
};

const DURATION_CONFIG = {
  '30분 거리':  { minKm: 0,  maxKm: 20,  driveMin: 30,  label: '차로 30분 이내' },
  '1시간 거리': { minKm: 50, maxKm: 100, driveMin: 60,  label: '차로 1시간 전후' },
  '2시간 이상': { minKm: 100, maxKm: 200, driveMin: 120, label: '차로 2시간 전후' },
};
const RADIUS_BY_DURATION = {
  '30분 거리': 20000, '1시간 거리': 100000,
  '1시간': 20000, '반나절': 50000, '하루종일': 100000
};

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

// 카카오 장소 상세 정보 (반려동물 태그 확인)
async function checkKakaoPetTag(placeId) {
  try {
    const res = await axios.get(`https://place.map.kakao.com/main/v/${placeId}`, {
      headers: { 'Referer': 'https://map.kakao.com', 'User-Agent': 'Mozilla/5.0' },
      timeout: 3000
    });
    const data = res.data;
    const tags = JSON.stringify(data).toLowerCase();
    return tags.includes('반려') || tags.includes('애견') || tags.includes('펫') || tags.includes('pet');
  } catch { return null; } // null = 확인 불가 (제외 안 함)
}

// ── 한국관광공사 반려동물 동반여행 API ──
// KorService1 위치기반 조회 + petTourYN=Y (반려동물 동반 가능 필터)
async function searchTourPlaces(lat, lng, radius, activityType, minKm=0) {
  try {
    const actConfig = ACTIVITY_CONFIG[activityType] || ACTIVITY_CONFIG['냄새 탐험'];
    const types = actConfig.tourTypes || ['12'];
    const radiusM = Math.min(radius, 20000);
    const results = [];

    for (const typeId of types) {
      try {
        // KorService1 위치기반 + petTourYN=Y 반려동물 동반 가능만
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
      url: `https://map.kakao.com/link/search/${encodeURIComponent(p.title)}`,
      lat: parseFloat(p.mapy),
      lng: parseFloat(p.mapx),
      distance: calcDistance(lat, lng, parseFloat(p.mapy), parseFloat(p.mapx)),
      source: 'tourapi',
      verified: '한국관광공사 반려동물 동반 공식 인증'
    })).filter(p => {
      if (!isNaN(p.lat) && !isNaN(p.lng) && p.distance <= radius/1000) {
        const petKw = ['반려','애견','강아지','도그런','펫','공원','산책','계곡','수영','운동장','놀이터','카페'];
        return petKw.some(k => (p.name||'').includes(k));
      }
      return false;
    });

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

// ── 네이버 로컬 검색 ──
async function searchNaverPlaces(query, display = 5) {
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/local.json', {
      params: { query, display, sort: 'comment' },
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      },
      timeout: 5000
    });
    const items = res.data?.items || [];
    return items.map(p => {
      const lng = parseInt(p.mapx) / 1e7;
      const lat = parseInt(p.mapy) / 1e7;
      return {
        name: p.title.replace(/<[^>]+>/g, ''),
        address: p.address,
        roadAddress: p.roadAddress,
        lat, lng,
        phone: p.telephone || '',
        url: p.link || '',
        source: 'naver',
        category: p.category || '',
        reviewCount: parseInt(p.reviewCount || p.review_count || 0),
        rating: parseFloat(p.rating || p.grade || 0)
      };
    });
  } catch(e) {
    console.log('네이버 검색 오류:', e.message, e.response?.data);
    return [];
  }
}



// ── 카카오 이미지 검색 ──
const imgCache = {};
async function getPlaceImage(placeName, placeId) {
  const cacheKey = placeId || placeName;
  if (imgCache[cacheKey] !== undefined) return imgCache[cacheKey];

  // 1차: 카카오 플레이스 사진 API (placeId 있을 때)
  if (placeId) {
    try {
      const res = await axios.get(`https://place.map.kakao.com/photo/list/spot/${placeId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://map.kakao.com',
          'Accept': 'application/json'
        },
        timeout: 4000
      });
      const photos = res.data?.photos || res.data?.photoList || [];
      const url = photos[0]?.url || photos[0]?.src || '';
      if (url) {
        imgCache[cacheKey] = url;
        return url;
      }
    } catch {}
  }

  // 2차: 카카오 이미지 검색 API
  const queries = [placeName, `${placeName} 강아지`, `${placeName} 애견`];
  for (const query of queries) {
    try {
      const res = await axios.get('https://dapi.kakao.com/v2/search/image', {
        params: { query, size: 5, sort: 'accuracy' },
        headers: { 'Authorization': `KakaoAK ${KAKAO_REST_KEY}` },
        timeout: 3000
      });
      const docs = res.data?.documents || [];
      const valid = docs.find(d => (d.width||0) >= 400 && (d.height||0) >= 300);
      const url = valid?.image_url || docs[0]?.image_url || '';
      if (url) {
        imgCache[cacheKey] = url;
        return url;
      }
    } catch {}
  }

  imgCache[cacheKey] = '';
  return '';
}

// ── 거리 계산 (km) ──
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── 코스 생성 API ──
app.post('/api/generate-course', async (req, res) => {
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  const { activity, duration, dogName, dogBreed, dogSize } = req.body;
  const durConfig = DURATION_CONFIG[duration] || DURATION_CONFIG['1시간 거리'];
  const radius = req.body.radius ? parseInt(req.body.radius) : durConfig.maxKm * 1000;
  const minKm = durConfig.minKm;
  const driveMin = durConfig.driveMin;

  console.log('요청 파라미터:', { lat, lng, activity, duration, radius });

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: '위치 정보가 올바르지 않아요' });
  }
  if (!activity || !duration) {
    return res.status(400).json({ error: '활동과 시간 정보가 필요해요' });
  }
  const config = ACTIVITY_CONFIG[activity] || ACTIVITY_CONFIG['친구 만나기'];
  const cacheKey = getCacheKey(lat, lng, activity, duration);

  console.log(`코스 생성 요청: ${activity} / ${duration} / 반경 ${radius/1000}km`);

  // ── 캐시 체크 ──
  const forceRefresh = req.body.forceRefresh === true;
  const cached = !forceRefresh && getFromCache(cacheKey);
  if (cached) {
    console.log(`✅ 캐시 히트: ${cacheKey}`);
    // 캐시에서도 완전 중복 없는 3개 선택
    const prevNames = new Set(req.body.prevPlaceNames || []);
    const final3 = [];
    const usedInFinal = new Set();
    for (const course of cached) {
      if (final3.length >= 3) break;
      const names = course.places.map(p => p.name);
      if (prevNames.size > 0 && names.some(n => prevNames.has(n))) continue;
      if (names.some(n => usedInFinal.has(n))) continue;
      final3.push(course);
      names.forEach(n => usedInFinal.add(n));
    }
    if (final3.length < 3) {
      for (const course of cached) {
        if (final3.length >= 3) break;
        if (!final3.includes(course)) final3.push(course);
      }
    }
    return res.json({ success: true, courses: final3, fromCache: true });
  }
  console.log(forceRefresh ? `🔄 강제 새로고침 → Groq 호출` : `캐시 미스 → Groq 호출 (3개 생성해서 캐시 저장)`);  

  try {
    // 1. 카카오맵 + 한국관광공사 API 병렬 검색
    // 카카오는 최대 20km 제한 → 큰 반경은 중간점에서 여러번 검색
    async function searchKakaoMultiRadius(keywords, centerLat, centerLng, maxRadius, minRadius) {
      const results = [];
      // 0.9도 ≈ 100km, 0.45도 ≈ 50km, 0.2도 ≈ 20km
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
              // 1시간 이상 / 2시간: 50~100km 범위 12방향으로 촘촘하게
              { lat: centerLat + 0.55, lng: centerLng },
              { lat: centerLat - 0.55, lng: centerLng },
              { lat: centerLat, lng: centerLng + 0.75 },
              { lat: centerLat, lng: centerLng - 0.75 },
              { lat: centerLat + 0.4, lng: centerLng + 0.5 },
              { lat: centerLat - 0.4, lng: centerLng + 0.5 },
              { lat: centerLat + 0.4, lng: centerLng - 0.5 },
              { lat: centerLat - 0.4, lng: centerLng - 0.5 },
              { lat: centerLat + 0.7, lng: centerLng + 0.3 },
              { lat: centerLat - 0.7, lng: centerLng - 0.3 },
              { lat: centerLat + 0.3, lng: centerLng + 0.8 },
              { lat: centerLat - 0.3, lng: centerLng - 0.8 },
            ];

      for (const point of searchPoints) {
        for (const kw of keywords) {
          const places = await searchKakaoPlaces(kw, point.lat, point.lng, 20000);
          results.push(...places);
        }
      }
      return results;
    }

    // 2시간 이상(minKm>20)이면 관광공사 제외 - 가까운 데이터만 줌
    // 카테고리별 장소 수집
    const cafeKeywords = ['애견카페', '반려견카페', '강아지카페', '펫카페', '도그카페'];
    const restaurantKeywords = ['애견 식당', '반려견 식당', '반려동물 식당', '펫프렌들리 레스토랑', '애견 동반 식당'];
    const parkKeywords = ['애견 공원', '반려견 공원', '반려견 놀이터', '애견 놀이터', '반려동물 공원'];

    const [cafeKakao, restaurantKakao, parkKakao,
           cafeNaver, restaurantNaver, parkNaver] = await Promise.all([
      searchKakaoMultiRadius(cafeKeywords, lat, lng, radius, minKm),
      searchKakaoMultiRadius(restaurantKeywords, lat, lng, radius, minKm),
      searchKakaoMultiRadius(parkKeywords, lat, lng, radius, minKm),
      Promise.all(cafeKeywords.slice(0,3).map(q => searchNaverPlaces(q, 10))).then(r => r.flat()),
      Promise.all(restaurantKeywords.slice(0,3).map(q => searchNaverPlaces(q, 10))).then(r => r.flat()),
      Promise.all(parkKeywords.slice(0,3).map(q => searchNaverPlaces(q, 10))).then(r => r.flat()),
    ]);

    // 카테고리별 거리 필터링 및 태그 부착
    function filterAndTag(places, tag) {
      return places.map(p => {
        const pLat = parseFloat(p.lat||p.y||0);
        const pLng = parseFloat(p.lng||p.x||0);
        const dist = (pLat && pLng) ? calcDistance(lat, lng, pLat, pLng) : 999;
        return { ...p, lat: pLat, lng: pLng, distance: parseFloat(dist.toFixed(2)), catTag: tag };
      }).filter(p => p.lat && p.lng && p.distance >= minKm && p.distance <= radius/1000);
    }

    function normPlace(p, defaultSource) {
      return {
        ...p,
        lat: p.lat||parseFloat(p.y||0),
        lng: p.lng||parseFloat(p.x||0),
        name: p.name||p.place_name||'',
        address: p.address||p.address_name||'',
        phone: p.phone||'',
        url: p.url||p.place_url||'',
        source: p.source||defaultSource,
        reviewCount: parseInt(p.reviewCount||0),
        rating: parseFloat(p.rating||0)
      };
    }
    const cafePlaces = filterAndTag([...cafeKakao, ...cafeNaver].map(p=>normPlace(p,'kakao')), 'cafe');
    const restaurantPlaces = filterAndTag([...restaurantKakao, ...restaurantNaver].map(p=>normPlace(p,'kakao')), 'restaurant');
    const parkPlaces = filterAndTag([...parkKakao, ...parkNaver].map(p=>normPlace(p,'kakao')), 'park');

    // 후기 평점 기반 정렬 (후기 없으면 거리순)
    const reviewData = loadReviews();
    function getScore(p) {
      // 1. 앱 내부 후기 (실제 방문자) - 가중치 최대
      const inAppReviews = reviewData[p.id] || reviewData[p.name] || [];
      const inAppAvg = inAppReviews.length ? inAppReviews.reduce((s,x)=>s+x.stars,0)/inAppReviews.length : 0;
      const inAppScore = inAppAvg * Math.log(inAppReviews.length + 1) * 3;

      // 2. 수동 인기DB 점수 (0~100)
      const popularScore = getPopularScore(p.name) * 0.5;

      // 3. 후기 없고 인기DB도 없으면 거리 가까울수록 보너스
      const distBonus = (inAppReviews.length === 0 && popularScore === 0)
        ? Math.max(0, 10 - (p.distance||10)) * 0.15
        : 0;

      return inAppScore + popularScore + distBonus;
    }
    function dedupByName(arr) {
      const seen = new Set();
      return arr
        .filter(p => { if(seen.has(p.name)) return false; seen.add(p.name); return true; })
        .sort((a,b) => getScore(b) - getScore(a)); // 평점 높은 순
    }
    const cafeFinal = dedupByName(cafePlaces).slice(0, 20);
    const restaurantFinal = dedupByName(restaurantPlaces).slice(0, 20);
    const parkFinal = dedupByName(parkPlaces).slice(0, 20);

    console.log(`카테고리별(실시간): 카페${cafeFinal.length}개 식당${restaurantFinal.length}개 공원${parkFinal.length}개`);

    // 카카오Results/tourResults/naverResults 호환을 위한 통합
    const kakaoResults = [...cafeKakao, ...restaurantKakao, ...parkKakao];
    const tourResults = [];
    const naverResults = [...cafeNaver, ...restaurantNaver, ...parkNaver];

    // 카카오 결과 변환 + 실제 거리 기반 필터링
    const kakaoPlaces = kakaoResults.map(p => ({
      id: p.id,
      name: p.place_name,
      category: p.category_name,
      address: p.address_name,
      roadAddress: p.road_address_name,
      phone: p.phone,
      url: p.place_url,
      lat: parseFloat(p.y),
      lng: parseFloat(p.x),
      distance: calcDistance(lat, lng, parseFloat(p.y), parseFloat(p.x)),
      source: 'kakao',
      reviewCount: 0,
      rating: 0
    })).filter(p => {
      if (p.distance > radius / 1000) return false;
      if (p.distance < minKm) return false;
      // 펫샵/미용 제외
      const excludeWords = ['미용', '샵', '살롱', '병원', '동물병원', '약국', '호텔', '유치원'];
      if (excludeWords.some(k => p.name.includes(k))) return false;

      // 이름에 반려견 관련 키워드 직접 포함된 곳만
      const petKeywords = ['반려견', '반려동물', '애견', '강아지', '펫프렌들리', '펫카페', '도그카페', '애견카페'];
      return petKeywords.some(k => p.name.includes(k));
    });

    // 2. 두 소스 병합 + 중복 제거
    // 네이버 결과 거리 계산 후 필터링
    const naverWithDist = naverResults.map(p => ({
      ...p,
      distance: calcDistance(lat, lng, p.lat, p.lng)
    })).filter(p => {
      if (!isNaN(p.lat) && !isNaN(p.lng) && p.distance >= minKm && p.distance <= radius/1000) {
        if (activity === '물놀이') {
          const waterWords = ['수영장', '계곡', '물놀이', '워터파크', '풀장', '풀빌라'];
          return waterWords.some(k => p.name.includes(k));
        }
        return true;
      }
      return false;
    });
    console.log(`네이버 장소: ${naverWithDist.length}개`);

    const allPlaces = [...tourResults, ...kakaoPlaces, ...naverWithDist];
    const unique = deduplicatePlaces(allPlaces);

    if (unique.length === 0) {
      const msg = activity === '물놀이'
        ? '이 지역 주변 50~100km 내에 반려견 수영장·계곡·풀빌라를 찾지 못했어요. 30분 거리로 바꿔보세요!'
        : `${durConfig.label} 범위에 ${activity} 장소가 부족해요. 다른 활동이나 거리를 선택해보세요.`;
      return res.status(404).json({ error: msg });
    }

    // 카테고리 순서대로 정렬
    const catOrder = activity === '애견카페' ? ['cafe','restaurant','park'] : ['restaurant','cafe','park'];
    unique.sort((a, b) => {
      const ai = catOrder.indexOf(a.catTag||'park');
      const bi = catOrder.indexOf(b.catTag||'park');
      if (ai !== bi) return ai - bi;
      return a.distance - b.distance;
    });

    console.log(`수집된 장소: 관광공사 ${tourResults.length}개 + 카카오 ${kakaoPlaces.length}개 → 중복제거 후 ${unique.length}개`);
    if (tourResults.length > 0) {
      console.log('관광공사 장소 샘플:', tourResults.slice(0,3).map(p=>`${p.name}(${p.address})`));
    }
    if (kakaoPlaces.length > 0) {
      console.log('카카오 장소 샘플:', kakaoPlaces.slice(0,3).map(p=>`${p.name}(${p.address})`));
    }

    // 3. Groq에게 코스 설계 요청
    const sizeLabel = dogSize === 'small' ? '소형견(10kg 미만)' : dogSize === 'medium' ? '중형견(10~25kg)' : '대형견(25kg 이상)';

    // source 표시 추가 (선언 먼저)
    const uniqueWithSource = unique.slice(0, 20).map(p => ({
      ...p,
      verified: p.source === 'tourapi' ? '한국관광공사 반려동물 동반 공식 인증' : '카카오맵 검색'
    }));
    // 장소명 → 거리 맵
    const placeDistMap = {};
    uniqueWithSource.forEach(p => { placeDistMap[p.name] = parseFloat(p.distance || 0); });

    // ── 스마트 코스 조합 ──
    // popular_places.json DB와 실시간 검색 결과 병합 후 점수 기반 정렬
    function mergeWithDB(places, cat) {
      const dbPlaces = (POPULAR_DB[cat] || []).map(p => ({
        ...p, catTag: cat,
        distance: (p.lat && p.lng) ? calcDistance(lat, lng, p.lat, p.lng) : 999,
      })).filter(p => p.distance >= minKm && p.distance <= radius/1000);
      const all = [...places, ...dbPlaces];
      // 이름 기준 중복 제거 (DB 데이터 우선)
      const seen = new Set();
      return all.filter(p => {
        const key = (p.name||'').replace(/\s/g,'').toLowerCase();
        if(seen.has(key)) return false;
        seen.add(key); return true;
      });
    }

    function getSmartScore(p) {
      // 1. 앱 내부 후기 (가중치 최대)
      const inAppReviews = reviewData[p.id] || reviewData[p.name] || [];
      const inAppAvg = inAppReviews.length ? inAppReviews.reduce((s,x)=>s+x.stars,0)/inAppReviews.length : 0;
      const inAppScore = inAppAvg * Math.log(inAppReviews.length + 1) * 5;

      // 2. popular_places DB 인기 점수
      const popularScore = (p.score || getPopularScore(p.name)) * 0.6;

      // 3. 관광공사 공식 인증 보너스
      const verifiedBonus = p.source === 'tourapi' ? 15 : 0;

      // 4. 거리 점수
      const dist = p.distance || 0;
      const distScore = Math.max(0, 20 - dist) * 0.3;

      // 5. 네이버 리뷰 수 보너스
      const naverScore = Math.log((p.reviewCount||0) + 1) * 0.5;

      // 6. 반려견 관련성 점수
      const petScore = getPetRelevanceScore(p);

      // 7. 전화번호 점수
      const phoneScore = getPhoneScore(p);

      return inAppScore + popularScore + verifiedBonus + distScore + naverScore + petScore + phoneScore;
    }

    function smartDedupSort(arr) {
      const seen = new Set();
      return arr
        .filter(p => {
          if (!hasValidAddress(p)) return false; // 주소 없는 곳 제외
          const key = (p.name||'').replace(/\s/g,'').toLowerCase();
          if(seen.has(key)) return false;
          seen.add(key); return true;
        })
        .sort((a,b) => getSmartScore(b) - getSmartScore(a));
    }

    // ── 엄격한 반려견 관련성 검증 ──
    const PET_KEYWORDS = ['반려', '애견', '펫', '강아지', '도그', 'dog', 'pet', '댕댕'];
    const CHAIN_BRAND_REGEX = /^(.+?)(점|지점|호점|센터|타워|몰|마트|파크)$/;

    // 체인점 브랜드명 추출
    function getBrandName(name) {
      const m = name.match(CHAIN_BRAND_REGEX);
      return m ? m[1] : name;
    }

    // 반려견 관련성 점수 (0~30)
    function getPetRelevanceScore(p) {
      const name = (p.name || '').toLowerCase();
      const category = (p.category || '').toLowerCase();
      const combined = name + ' ' + category;

      // 관광공사 인증 = 완전 신뢰
      if (p.source === 'tourapi') return 30;

      // 업체명에 반려견 키워드 있으면 높은 점수
      if (PET_KEYWORDS.some(k => combined.includes(k))) return 25;

      // 카카오 카테고리에 반려동물 관련 태그 있으면
      if (category.includes('반려') || category.includes('애견') || category.includes('펫')) return 20;

      // 키워드 검색으로 나온 결과 (이미 애견 관련 키워드로 검색됨) = 기본 신뢰
      return 10;
    }

    // 코스 방향성 체크 (장소들이 왔다갔다 하지 않는지)
    function isDirectionalCourse(places) {
      if (places.length < 3) return true;
      // 출발지 기준 각도 계산 - 방향이 크게 바뀌면 false
      const angles = places.map(p => Math.atan2(p.lat - lat, p.lng - lng) * 180 / Math.PI);
      const maxAngleDiff = Math.max(...angles) - Math.min(...angles);
      return maxAngleDiff <= 180; // 180도 이상 벌어지면 왔다갔다
    }

    // 같은 브랜드 체인점 코스 내 중복 제거
    function hasBrandDuplicate(cafe, rest, park) {
      const brands = [cafe, rest, park].map(p => getBrandName(p.name));
      return new Set(brands).size < brands.length;
    }

    // 전화번호 없는 곳 패널티 (폐업 가능성)
    function getPhoneScore(p) {
      return (p.phone && p.phone.trim()) ? 5 : -5;
    }

    // 주소 없는 곳 제외
    function hasValidAddress(p) {
      return !!(p.address && p.address.trim().length > 3);
    }

    // DB와 실시간 검색 결과 병합
    // 카테고리 교차 오염 제거 - 카페풀에서 식당성 키워드 제거
    const restaurantWords = ['식당', '파스타', '레스토랑', '고깃집', '삼겹', '치킨', '족발', '국밥', '순대', '곱창', '돈까스', '피자', '버거', '햄버거', '분식', '냉면', '우동', '라멘', '초밥', '스시'];

    const cafeMergedFiltered = smartDedupSort(mergeWithDB(cafePlaces, 'cafe'))
      .filter(p => !restaurantWords.some(w => p.name.toLowerCase().includes(w)))
      .slice(0, 30);
    const restaurantMergedFiltered = smartDedupSort(mergeWithDB(restaurantPlaces, 'restaurant'))
      .slice(0, 30);
    const parkMergedFiltered = smartDedupSort(mergeWithDB(parkPlaces, 'park'))
      .slice(0, 30);

    // 카카오 상세 태그 확인 (상위 10개만 - 속도 유지)
    async function verifyTopCandidates(arr) {
      const top10 = arr.slice(0, 10);
      await Promise.all(top10.map(async p => {
        if (p.id || p.place_id) {
          const hasPetTag = await checkKakaoPetTag(p.id || p.place_id);
          if (hasPetTag === true) p.petTagVerified = true;
          if (hasPetTag === false) p.petTagVerified = false;
        }
      }));
      // 태그 확인 결과 반영: false면 제일 뒤로
      return arr.sort((a, b) => {
        if (a.petTagVerified === false && b.petTagVerified !== false) return 1;
        if (b.petTagVerified === false && a.petTagVerified !== false) return -1;
        return getSmartScore(b) - getSmartScore(a);
      });
    }

    const [cafeMerged, restaurantMerged, parkMerged] = await Promise.all([
      verifyTopCandidates(cafeMergedFiltered),
      verifyTopCandidates(restaurantMergedFiltered),
      verifyTopCandidates(parkMergedFiltered),
    ]);

    console.log('카페 상위(스마트):', cafeMerged.slice(0,3).map(p=>
      `${p.name}(점수${getSmartScore(p).toFixed(1)}, ${(p.distance||0).toFixed(1)}km)`
    ));
    console.log(`카테고리별: 카페${cafeMerged.length}개 식당${restaurantMerged.length}개 공원${parkMerged.length}개`);

    // ── 코스 3개 조합: 카페/식당/공원 각각 완전히 다른 업체 ──
    function isCoherentCourse(places) {
      if (places.length < 2) return true;
      for (let i = 0; i < places.length - 1; i++) {
        const d = calcDistance(places[i].lat, places[i].lng, places[i+1].lat, places[i+1].lng);
        if (d > 20) return false;
      }
      return true;
    }

    function makeCourse(cafe, rest, park) {
      const orderedPlaces = catOrder.map(cat => {
        if(cat==='cafe') return {...cafe, catTag:'cafe'};
        if(cat==='restaurant') return {...rest, catTag:'restaurant'};
        return {...park, catTag:'park'};
      });
      if (!isCoherentCourse(orderedPlaces)) return null;
      if (!isDirectionalCourse(orderedPlaces)) return null; // 방향성 체크
      if (hasBrandDuplicate(cafe, rest, park)) return null; // 체인점 중복 체크
      const maxDist = orderedPlaces.reduce((m, p) => Math.max(m, p.distance||0), 0);
      const firstName = orderedPlaces[0]?.name || '';
      return {
        title: `${firstName} 코스`,
        theme: catOrder.map(c => c==='cafe'?'카페':c==='restaurant'?'식당':'공원').join('→'),
        driveTime: calcDriveTime(maxDist),
        driveMin: Math.round((maxDist / 50) * 60) + 20,
        totalDistance: parseFloat(maxDist.toFixed(1)),
        score: getSmartScore(orderedPlaces[0]),
        places: orderedPlaces.map((p, idx) => ({
          name: p.name, address: p.address || '',
          distance: parseFloat((p.distance||0).toFixed(1)),
          driveTime: calcDriveTime(p.distance||0),
          driveMin: Math.round(((p.distance||0)/80)*60),
          phone: p.phone || '', url: p.url || '',
          lat: p.lat, lng: p.lng,
          reason: idx===0 ? `${p.name}에서 시작하는 코스` : `함께 방문하기 좋은 곳`,
          catTag: p.catTag
        })),
        highlight: `${firstName}부터 시작하는 알찬 코스`
      };
    }

    // 카페/식당/공원 각 풀에서 상위 15개씩 사용
    const prevPlaceNames = new Set(req.body.prevPlaceNames || []);
    const filterPrev = arr => prevPlaceNames.size > 0
      ? arr.filter(p => !prevPlaceNames.has(p.name))
      : arr;

    const cafePool = filterPrev(cafeMerged).slice(0, 15);
    const restPool = filterPrev(restaurantMerged).slice(0, 15);
    const parkPool = filterPrev(parkMerged).slice(0, 15);

    // 코스 1: cafe[0] + rest[0] + park[0] (최적 조합 탐색)
    // 코스 2: cafe[1] + rest[1] + park[1] (완전 다른 업체)
    // 코스 3: cafe[2] + rest[2] + park[2]
    const final3 = [];
    const usedCafes = new Set();
    const usedRests = new Set();
    const usedParks = new Set();

    // 각 코스마다 사용 안 된 카페/식당/공원 조합 찾기
    for (let attempt = 0; final3.length < 3 && attempt < cafePool.length * restPool.length; attempt++) {
      // 사용 안 된 카페 찾기
      const cafe = cafePool.find(p => !usedCafes.has(p.name));
      const rest = restPool.find(p => !usedRests.has(p.name));
      const park = parkPool.find(p => !usedParks.has(p.name));

      if (!cafe || !rest || !park) break;

      const course = makeCourse(cafe, rest, park);
      if (course) {
        final3.push(course);
        usedCafes.add(cafe.name);
        usedRests.add(rest.name);
        usedParks.add(park.name);
      } else {
        // 거리 조건 실패 시 park 교체 시도
        let found = false;
        for (const altPark of parkPool) {
          if (usedParks.has(altPark.name)) continue;
          const c2 = makeCourse(cafe, rest, altPark);
          if (c2) {
            final3.push(c2);
            usedCafes.add(cafe.name);
            usedRests.add(rest.name);
            usedParks.add(altPark.name);
            found = true;
            break;
          }
        }
        if (!found) {
          // 이 카페는 skip
          usedCafes.add(cafe.name);
        }
      }
    }

    // 못 채운 경우 중복 허용
    if (final3.length < 3) {
      for (let ci = 0; ci < cafePool.length && final3.length < 3; ci++) {
        for (let ri = 0; ri < restPool.length && final3.length < 3; ri++) {
          for (let pi = 0; pi < parkPool.length && final3.length < 3; pi++) {
            const c = makeCourse(cafePool[ci], restPool[ri], parkPool[pi]);
            if (c && !final3.find(x => x.title === c.title)) final3.push(c);
          }
        }
      }
    }

    const builtCourses = final3;

    if (builtCourses.length > 0) {
      builtCourses.forEach(c => {
        if (c.places?.[0]) {
          c.placeId = c.places[0].id || '';
          c.placeName = c.places[0].name;
        }
      });
      console.log(`코스 조합 완료: ${builtCourses.map(c=>c.places.map(p=>p.name).join('+')).join(' / ')}`);

      setToCache(cacheKey, builtCourses);

      // AI 코스 설명 생성 (Groq - 무료)
      try {
        await Promise.all(builtCourses.map(async (course) => {
          const placeNames = course.places.map(p => `${p.name}(${p.catTag==='cafe'?'카페':p.catTag==='restaurant'?'식당':'공원'})`).join(', ');
          const weatherInfo = req.body.weather || '';
          const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.1-8b-instant',
            max_tokens: 120,
            messages: [
              { role: 'system', content: '너는 반려견 드라이브 코스를 소개하는 따뜻한 어시스턴트야. 항상 한국어로 답해.' },
              { role: 'user', content: `이 코스를 설레고 따뜻하게 한 줄로 소개해줘. (40자 이내, 이모지 1개, 한국어)
코스: ${placeNames}
드라이브: ${course.driveTime}
${weatherInfo ? '날씨: '+weatherInfo : ''}
규칙: 특정 견종/크기 언급 금지. 코스의 매력과 하루 흐름을 자연스럽게 표현. 설명만 출력.` }
            ]
          }, {
            headers: { 'Authorization': `Bearer ${getGroqKey()}`, 'Content-Type': 'application/json' },
            timeout: 8000
          });
          course.aiComment = response.data.choices[0]?.message?.content?.trim() || '';
        }));
      } catch(e) {
        console.error('AI 설명 생성 오류:', e.message);
      }

      return res.json({ success: true, courses: builtCourses });
    }
    // ── 후기 평점 기반 정렬 ──
    const reviews = loadReviews();
    const scoredPlaces = uniqueWithSource.map(p => {
      const placeReviews = reviews[p.id] || reviews[p.name] || [];
      const avgRating = placeReviews.length
        ? placeReviews.reduce((s, r) => s + r.stars, 0) / placeReviews.length
        : 0;
      const reviewCount = placeReviews.length;
      // 점수 = 평점 × log(후기수+1) + 거리 가까울수록 보너스
      const distScore = Math.max(0, 10 - (p.distance || 10));
      const score = (avgRating * Math.log(reviewCount + 1)) + (distScore * 0.3);
      return { ...p, avgRating, reviewCount, score };
    });

    // 평점/후기 있는 곳 우선, 없으면 거리순
    scoredPlaces.sort((a, b) => {
      if (b.reviewCount !== a.reviewCount) return b.score - a.score;
      return (a.distance||99) - (b.distance||99);
    });

    console.log('상위 장소:', scoredPlaces.slice(0,3).map(p =>
      `${p.name}(★${p.avgRating.toFixed(1)},후기${p.reviewCount}개,${(p.distance||0).toFixed(1)}km)`
    ));

    // 장소 데이터 극도로 압축 (토큰 최소화)
    const compactPlaces = scoredPlaces.map(p => ({
      n: p.name,
      a: (p.address||'').replace('경기도','경기').replace('서울특별시','서울').split(' ').slice(0,4).join(' '),
      d: parseFloat((p.distance||0).toFixed(1)),
      t: p.catTag||'park'  // cafe/restaurant/park
    }));

    // 규칙을 한줄로 압축
    // 드라이브 시간 = 거리(km) / 60 * 60분 (시속 60km 기준)
    const firstCat = activity === '애견카페' ? 'cafe' : 'restaurant';
    const courseOrder = activity === '애견카페'
      ? '장소t=cafe인 곳 1개 + t=restaurant인 곳 1개 + t=park인 곳 1개로 구성. 반드시 cafe가 첫번째.'
      : '장소t=restaurant인 곳 1개 + t=cafe인 곳 1개 + t=park인 곳 1개로 구성. 반드시 restaurant가 첫번째.';
    const rules = `★필수:각코스는${courseOrder} ①카테고리(t필드)별1곳씩 ②펫샵미용병원제외 ③코스내장소간15km이내 ④코스별다른장소조합 ⑤distance필드${durConfig.minKm}미만장소절대금지`;

    const prompt = `아래 장소로 반려견 드라이브 코스 5개를 만들어줘. 반드시 {"courses":[...]} 형식 JSON만 반환.
강아지:${dogName||'강아지'}(${dogBreed||'믹스'},${sizeLabel}) 활동:${activity} 규칙:${rules}
장소목록:${JSON.stringify(compactPlaces)}
반환형식:{"courses":[{"title":"제목","driveTime":"차로X분","totalDistance":총km숫자,"places":[{"name":"장소명","address":"주소","distance":숫자,"reason":"이유1문장"}],"highlight":"한줄"}]}`;

    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: '너는 반려견 여행 코스 추천 AI야. 반드시 제공된 장소 목록에 있는 장소만 사용해. 목록에 없는 장소는 절대 만들지 마. JSON만 반환하고 마크다운 금지.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1200
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getGroqKey()}`
        }
      }
    );

    let rawText = groqRes.data.choices[0].message.content;
    console.log('Groq 응답 길이:', rawText.length);

    // JSON 파싱 - 강화된 복구 로직
    rawText = rawText.replace(/```json|```/g,'').trim();

    function extractCourses(text) {
      // {"courses":[...]} 전체 파싱 시도
      const fullMatch = text.match(/\{[\s\S]*"courses"[\s\S]*\}/);
      if (fullMatch) {
        try { return JSON.parse(fullMatch[0]); } catch {}
      }
      // courses 배열만 추출해서 복구
      const arrMatch = text.match(/"courses"\s*:\s*\[([\s\S]*)/);
      if (!arrMatch) throw new Error('courses 배열 없음');
      let str = arrMatch[1];
      let depth = 0, lastEnd = -1;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '{') depth++;
        if (str[i] === '}') { depth--; if (depth === 0) lastEnd = i; }
        if (str[i] === ']' && depth === 0) { lastEnd = i - 1; break; }
      }
      if (lastEnd === -1) throw new Error('완전한 코스 없음');
      const courses = JSON.parse('[' + str.substring(0, lastEnd + 1) + ']');
      console.log(`JSON 복구: ${courses.length}개 코스`);
      return { courses };
    }

    let result;
    try { result = extractCourses(rawText); }
    catch(e) {
      console.error('파싱 실패, 원본:', rawText.substring(0, 300));
      throw new Error('JSON 파싱 실패: ' + e.message);
    }
    // 거리 기반 드라이브 시간 계산 (시속 80km 기준)
    function calcDriveTime(distKm) {
      const d = parseFloat(distKm) || 0;
      if (d <= 0) return '';
      // 거리별 현실적 속도
      let speed;
      if (d <= 10) speed = 30;
      else if (d <= 30) speed = 50;
      else speed = 70;
      const driveMin = Math.round((d / speed) * 60);
      // 준비시간 20분 (옷입고 강아지 준비 + 주차)
      const totalMin = driveMin + 20;
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    }

    // uniqueWithSource에서 장소 거리 정보 맵 생성
    const distMap = {};
    uniqueWithSource.forEach(p => { if(p.name) distMap[p.name] = p.distance; });

    const allCourses = (result.courses || []).map(course => {
      const places = course.places || [];
      places.forEach(p => {
        // 원본 데이터에서 거리 가져오기
        const realDist = distMap[p.name] || parseFloat(p.distance || 0);
        if (realDist > 0) {
          p.distance = realDist;
          p.driveTime = calcDriveTime(realDist);
          p.driveMin = Math.round((realDist / 80) * 60);
        }
      });
      const maxDist = places.reduce((m, p) => Math.max(m, parseFloat(p.distance)||0), 0);
      if (maxDist > 0) {
        course.driveTime = calcDriveTime(maxDist);
        course.totalDistance = parseFloat(maxDist.toFixed(1));
      }
      console.log(`  코스: ${course.title} → ${course.driveTime} (${maxDist}km)`);
      return course;
    });
    console.log(`코스 생성 완료: ${allCourses.length}개 → 캐시 저장`);

    // 캐시에 전체 저장
    setToCache(cacheKey, allCourses);

    // 랜덤 3개 반환
    const returnCourses = [...allCourses].sort(() => Math.random() - 0.5).slice(0, 3);
    res.json({
      success: true,
      courses: returnCourses,
      meta: { totalPlacesFound: unique.length, activity, duration, radius: radius / 1000 }
    });

  } catch (err) {
    console.error('코스 생성 오류:', err.message);
    if (err.response) {
      console.error('응답 상태:', err.response.status);
      console.error('응답 데이터:', JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({ error: '코스 생성 중 오류가 발생했어요.', detail: err.message, data: err.response?.data });
  }
});

// ── 코스 캐시 (24시간) ──
const CACHE_FILE = path.join(__dirname, 'course_cache.json');
const CACHE_TTL = 48 * 60 * 60 * 1000; // 48시간

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveCache(data) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8'); } catch {}
}

// 위치를 5km 격자로 반올림 (캐시 키용)
function gridLat(lat) { return Math.round(lat / 0.09) * 0.09; }   // ~10km
function gridLng(lng) { return Math.round(lng / 0.11) * 0.11; }   // ~10km

function getCacheKey(lat, lng, activity, duration) {
  return `v5_${gridLat(lat).toFixed(3)}_${gridLng(lng).toFixed(3)}_${activity}_${duration}`;
}

function getFromCache(key) {
  return null; // 캐시 비활성화 - 항상 새로 생성
}

function setToCache(key, courses) {
  // 캐시 비활성화
}

// ── 후기 파일 경로 ──
const REVIEWS_FILE = path.join(__dirname, 'reviews.json');

// ── 인기 장소 수동 DB ──
let POPULAR_DB = { cafe: [], restaurant: [], park: [] };
try {
  POPULAR_DB = JSON.parse(fs.readFileSync(path.join(__dirname, 'popular_places.json'), 'utf-8'));
  console.log(`인기DB 로드: 카페${POPULAR_DB.cafe.length}개 식당${POPULAR_DB.restaurant.length}개 공원${POPULAR_DB.park.length}개`);
} catch(e) { console.log('인기DB 없음'); }

function getPopularScore(name) {
  const allPlaces = [...POPULAR_DB.cafe, ...POPULAR_DB.restaurant, ...POPULAR_DB.park];
  const found = allPlaces.find(p => name.includes(p.name) || p.name.includes(name));
  return found ? found.score : 0;
}
function loadReviews() {
  try { return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveReviews(data) {
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 장소 이미지 검색 (네이버) ──
const placeImgCache = {};
app.get('/api/place-image', async (req, res) => {
  const name = req.query.name || '';
  if (!name) return res.json({ url: '' });
  if (placeImgCache[name] !== undefined) return res.json({ url: placeImgCache[name] });
  // 429 방지: 동시 요청 제한
  await new Promise(r => setTimeout(r, 200));

  // 업소명만 단순 검색
  try {
    const r = await axios.get('https://openapi.naver.com/v1/search/image', {
      params: { query: name, display: 5, sort: 'sim', filter: 'large' },
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      },
      timeout: 4000
    });
    const items = r.data?.items || [];
    console.log(`이미지 검색 [${name}]: ${items.length}개`);
    if (items.length > 0) console.log('샘플 필드:', Object.keys(items[0]), '썸네일:', items[0]?.thumbnail?.substring(0,50));
    const valid = items.find(it => parseInt(it.sizewidth||0) >= 300 && parseInt(it.sizeheight||0) >= 200);
    const url = valid?.thumbnail || valid?.link || items[0]?.thumbnail || items[0]?.link || '';
    if (url) {
      placeImgCache[name] = url;
      return res.json({ url });
    }
  } catch(e) {
    if (e.response?.status === 429) {
      console.log('이미지 API 한도 초과 - 잠시 대기');
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log('이미지 검색 오류:', e.message);
    }
  }
  placeImgCache[name] = '';
  res.json({ url: '' });
});

// ── 날씨 API ──
app.get('/api/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const driveMin = parseInt(req.query.driveMin) || 30; // 드라이브 예상 시간(분)

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: '위치 정보 없음' });
  }

  try {
    // 현재 날씨 + 3시간 예보 동시 요청
    const [currentRes, forecastRes] = await Promise.all([
      axios.get(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=kr`),
      axios.get(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=kr&cnt=4`)
    ]);

    const current = currentRes.data;
    const forecast = forecastRes.data;

    // 도착 예정 시간대 예보 (driveMin 후)
    const arrivalIndex = Math.min(Math.floor(driveMin / 90), 3); // 3시간 단위
    const arrivalForecast = forecast.list[arrivalIndex];

    // 날씨 상태 분류
    function classifyWeather(weatherId) {
      if (weatherId >= 200 && weatherId < 300) return { icon: '⛈️', label: '천둥번개', bad: true };
      if (weatherId >= 300 && weatherId < 400) return { icon: '🌦️', label: '이슬비', bad: true };
      if (weatherId >= 500 && weatherId < 600) return { icon: '🌧️', label: '비', bad: true };
      if (weatherId >= 600 && weatherId < 700) return { icon: '❄️', label: '눈', bad: true };
      if (weatherId >= 700 && weatherId < 800) return { icon: '🌫️', label: '안개', bad: false };
      if (weatherId === 800) return { icon: '☀️', label: '맑음', bad: false };
      if (weatherId === 801) return { icon: '🌤️', label: '구름 조금', bad: false };
      if (weatherId <= 804) return { icon: '☁️', label: '흐림', bad: false };
      return { icon: '🌡️', label: '보통', bad: false };
    }

    const currentWeather = classifyWeather(current.weather[0].id);
    const arrivalWeather = classifyWeather(arrivalForecast.weather[0].id);

    // 도착 시간 - 한국 시간(UTC+9) 기준
    const arrivalTime = new Date(Date.now() + driveMin * 60 * 1000);
    // toLocaleString으로 한국 시간 직접 추출
    const koreaTime = new Date(arrivalTime.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const arrivalHour = koreaTime.getHours();
    const arrivalMin = koreaTime.getMinutes();
    // 10분 단위로 반올림
    const roundedMin = Math.round(arrivalMin / 10) * 10;
    let arrivalLabel;
    if (roundedMin === 0 || roundedMin === 60) {
      const h = roundedMin === 60 ? (arrivalHour + 1) % 24 : arrivalHour;
      arrivalLabel = `${h}시경`;
    } else {
      arrivalLabel = `${arrivalHour}시 ${roundedMin}분경`;
    }

    res.json({
      current: {
        ...currentWeather,
        temp: Math.round(current.main.temp),
        desc: current.weather[0].description
      },
      arrival: {
        ...arrivalWeather,
        temp: Math.round(arrivalForecast.main.temp),
        desc: arrivalForecast.weather[0].description,
        timeLabel: arrivalLabel
      },
      warning: arrivalWeather.bad
        ? `${arrivalLabel} ${arrivalWeather.icon} ${arrivalWeather.label} 예보`
        : null
    });
  } catch (e) {
    console.error('날씨 API 오류:', e.message);
    res.status(500).json({ error: '날씨 정보를 가져올 수 없어요' });
  }
});

// ── 카카오 로그인 ──
const KAKAO_REDIRECT_URI = 'https://daengdaengroad-production.up.railway.app/auth/kakao/callback';

// 1. 카카오 인증 페이지로 리다이렉트
app.get('/auth/kakao', (req, res) => {
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_KEY}&redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&response_type=code`;
  res.redirect(kakaoAuthUrl);
});

// 2. 카카오 콜백 - 토큰 교환 & 유저 저장
app.get('/auth/kakao/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    console.log('카카오 토큰 요청 params:', {
      client_id: KAKAO_REST_KEY,
      client_secret: process.env.KAKAO_CLIENT_SECRET ? process.env.KAKAO_CLIENT_SECRET.substring(0,5)+'...' : 'MISSING',
      redirect_uri: KAKAO_REDIRECT_URI
    });
    // 토큰 교환
    const tokenRes = await axios.post('https://kauth.kakao.com/oauth/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: KAKAO_REST_KEY,
        client_secret: process.env.KAKAO_CLIENT_SECRET,
        redirect_uri: KAKAO_REDIRECT_URI,
        code
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const accessToken = tokenRes.data.access_token;

    // 유저 정보 가져오기
    const userRes = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const kakaoUser = userRes.data;
    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname || '댕댕이 집사';
    const profileImage = kakaoUser.kakao_account?.profile?.profile_image_url || '';

    // MongoDB에 유저 저장 (없으면 생성, 있으면 업데이트)
    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOneAndUpdate(
        { kakaoId },
        { kakaoId, nickname, profileImage, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      console.log(`카카오 로그인: ${nickname} (${kakaoId})`);
    }

    // dogPhoto는 base64라 URL에 넣으면 431 에러 → 제외
    const userInfo = encodeURIComponent(JSON.stringify({
      kakaoId,
      nickname,
      profileImage,
      dogName: user?.dogName || '',
      dogBreed: user?.dogBreed || '',
      dogSize: user?.dogSize || 'small'
    }));
    res.redirect(`/?login=success&user=${userInfo}`);

  } catch (e) {
    console.error('카카오 로그인 오류:', e.message);
    console.error('카카오 에러 상세:', JSON.stringify(e.response?.data || {}));
    res.redirect('/?error=login_failed');
  }
});

// ── 네이버 로그인 ──
const NAVER_REDIRECT_URI = 'https://daengdaengroad-production.up.railway.app/auth/naver/callback';
const NAVER_LOGIN_CLIENT_ID = process.env.NAVER_LOGIN_CLIENT_ID;
const NAVER_LOGIN_CLIENT_SECRET = process.env.NAVER_LOGIN_CLIENT_SECRET;

app.get('/auth/naver', (req, res) => {
  const state = Math.random().toString(36).substring(2);
  const url = `https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=${NAVER_LOGIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(NAVER_REDIRECT_URI)}&state=${state}`;
  res.redirect(url);
});

app.get('/auth/naver/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect('/?error=no_code');
  try {
    const tokenRes = await axios.post('https://nid.naver.com/oauth2.0/token', null, {
      params: { grant_type: 'authorization_code', client_id: NAVER_LOGIN_CLIENT_ID, client_secret: NAVER_LOGIN_CLIENT_SECRET, code, state },
      timeout: 5000
    });
    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const naverUser = userRes.data.response;
    const userId = 'naver_' + naverUser.id;
    const nickname = naverUser.nickname || naverUser.name || '댕댕이 집사';
    const profileImage = naverUser.profile_image || '';

    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOneAndUpdate(
        { kakaoId: userId },
        { kakaoId: userId, nickname, profileImage, updatedAt: new Date() },
        { upsert: true, new: true }
      );
    }
    const userInfo = encodeURIComponent(JSON.stringify({
      kakaoId: userId, nickname, profileImage,
      dogName: user?.dogName || '', dogBreed: user?.dogBreed || '',
      dogSize: user?.dogSize || 'small'
    }));
    res.redirect(`/?login=success&user=${userInfo}`);
  } catch (e) {
    console.error('네이버 로그인 오류:', e.message);
    res.redirect('/?error=login_failed');
  }
});

// ── 구글 로그인 ──
const GOOGLE_REDIRECT_URI = 'https://daengdaengroad-production.up.railway.app/auth/google/callback';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

app.get('/auth/google', (req, res) => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&response_type=code&scope=profile&access_type=offline`;
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code'
    }, { timeout: 5000 });
    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const googleUser = userRes.data;
    const userId = 'google_' + googleUser.id;
    const nickname = googleUser.name || '댕댕이 집사';
    const profileImage = googleUser.picture || '';

    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOneAndUpdate(
        { kakaoId: userId },
        { kakaoId: userId, nickname, profileImage, updatedAt: new Date() },
        { upsert: true, new: true }
      );
    }
    const userInfo = encodeURIComponent(JSON.stringify({
      kakaoId: userId, nickname, profileImage,
      dogName: user?.dogName || '', dogBreed: user?.dogBreed || '',
      dogSize: user?.dogSize || 'small'
    }));
    res.redirect(`/?login=success&user=${userInfo}`);
  } catch (e) {
    console.error('구글 로그인 오류:', e.message);
    res.redirect('/?error=login_failed');
  }
});

// 3. 유저 프로필 저장 (강아지 정보)
app.post('/api/user/profile', async (req, res) => {
  const { kakaoId, dogName, dogBreed, dogSize, dogPhoto } = req.body;
  if (!kakaoId) return res.status(400).json({ error: 'kakaoId 필요' });
  try {
    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { kakaoId },
        { dogName, dogBreed, dogSize, dogPhoto, updatedAt: new Date() }
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 후기 조회 ──
app.get('/api/reviews/:placeId', async (req, res) => {
  const placeId = decodeURIComponent(req.params.placeId);
  try {
    if (mongoose.connection.readyState === 1) {
      const placeReviews = await Review.find({ placeId }).sort({ createdAt: -1 }).limit(100).lean();
      const avg = placeReviews.length
        ? (placeReviews.reduce((s, r) => s + r.stars, 0) / placeReviews.length).toFixed(1)
        : null;
      return res.json({ reviews: placeReviews, avg, count: placeReviews.length });
    }
  } catch(e) { console.error('MongoDB 후기 조회 오류:', e.message); }
  const reviews = loadReviews();
  const placeReviews = reviews[placeId] || [];
  const avg = placeReviews.length
    ? (placeReviews.reduce((s, r) => s + r.stars, 0) / placeReviews.length).toFixed(1)
    : null;
  res.json({ reviews: placeReviews, avg, count: placeReviews.length });
});

// ── 후기 작성 ──
app.post('/api/reviews', async (req, res) => {
  const { placeId, placeName, kakaoId, dogName, dogBreed, stars, text } = req.body;
  if (!placeId || !text || !stars) return res.status(400).json({ error: '필수 항목 누락' });
  const reviewData = {
    placeId, placeName, kakaoId: kakaoId || '',
    dogName: dogName || '익명', dogBreed: dogBreed || '',
    stars: parseInt(stars), text,
    date: new Date().toLocaleDateString('ko-KR'),
  };
  try {
    if (mongoose.connection.readyState === 1) {
      const review = await Review.create(reviewData);
      console.log(`후기 저장(MongoDB): ${placeName} - ${dogName} (★${stars})`);
      return res.json({ success: true, review });
    }
  } catch(e) { console.error('MongoDB 후기 저장 오류:', e.message); }
  const reviews = loadReviews();
  if (!reviews[placeId]) reviews[placeId] = [];
  const review = { id: Date.now(), ...reviewData, createdAt: new Date().toISOString() };
  reviews[placeId].unshift(review);
  if (reviews[placeId].length > 100) reviews[placeId] = reviews[placeId].slice(0, 100);
  saveReviews(reviews);
  res.json({ success: true, review });
});

// ── 리뷰 요약 API (Claude) ──
app.post('/api/review-summary', async (req, res) => {
  const { placeName, reviews } = req.body;
  if (!reviews || reviews.length < 2) return res.json({ summary: null });
  if (!ANTHROPIC_API_KEY) return res.json({ summary: null });

  try {
    const reviewTexts = reviews.slice(0, 10).map((r, i) =>
      `${i+1}. ★${r.stars} - ${r.text}`
    ).join('\n');

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `다음은 "${placeName}"에 대한 반려견 동반 방문 후기들이에요. 핵심을 한 문장(30자 이내)으로 요약해주세요. 이모지 1개 포함. 한국어로.\n\n${reviewTexts}`
      }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 8000
    });

    const summary = response.data.content[0]?.text?.trim() || null;
    console.log(`리뷰 요약 [${placeName}]: ${summary}`);
    res.json({ summary });
  } catch (e) {
    console.error('리뷰 요약 오류:', e.message);
    res.json({ summary: null });
  }
});

// ── 챗봇 API (Claude) ──
app.post('/api/chat', async (req, res) => {
  const { message, dogName, dogBreed, dogSize, location, weather, history } = req.body;
  if (!message) return res.status(400).json({ error: '메시지 없음' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API 키 없음' });

  // 메시지 길이 제한
  const trimmedMessage = message.slice(0, 500);
  const trimmedHistory = (history || []).slice(-4).map(h => ({
    role: h.role,
    content: String(h.content).slice(0, 300)
  }));

  try {
    const sizeLabel = dogSize === 'small' ? '소형견' : dogSize === 'medium' ? '중형견' : '대형견';
    const systemPrompt = `너는 댕댕로드의 반려견 드라이브 코스 전문 AI 어시스턴트야.
사용자 강아지 정보: 이름 ${dogName||'강아지'}, 견종 ${dogBreed||'믹스'}, 크기 ${sizeLabel}
현재 위치: ${location||'위치 미확인'}
현재 날씨: ${weather||'날씨 미확인'}

답변 규칙:
- 반드시 한국어로 친근하게 답변
- 강아지 이름을 자연스럽게 활용
- 반려견 드라이브, 장소 추천, 날씨 관련 질문에 전문적으로 답변
- 답변은 3문장 이내로 간결하게
- 코스 추천 요청 시 "홈 화면에서 코스 만들기를 눌러보세요!" 안내
- 이모지 적절히 사용`;

    const messages = [
      ...trimmedHistory,
      { role: 'user', content: trimmedMessage }
    ];

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 15000
    });

    const reply = response.data.content[0]?.text?.trim() || '죄송해요, 잠시 후 다시 시도해주세요.';
    res.json({ reply });
  } catch (e) {
    console.error('챗봇 오류:', e.message);
    res.status(500).json({ error: '챗봇 오류', reply: '잠시 후 다시 시도해주세요 🐾' });
  }
});

// ── 헬스체크 ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '댕댕로드 서버 정상 작동 중 🐾' });
});
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '댕댕로드 서버 정상 작동 중 🐾' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐾 댕댕로드 서버 시작! http://localhost:${PORT}`);
});
