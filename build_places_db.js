/**
 * 댕댕로드 전국 애견 동반 장소 DB 구축 스크립트
 * 실행: node build_places_db.js
 * 결과: popular_places.json 생성
 * 
 * 사용 API: 한국관광공사 + 카카오 + 네이버
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const TOUR_API_KEY = process.env.TOUR_API_KEY;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 전국 주요 도시 좌표 (광역시/도청소재지 + 주요 관광지) ──
const CITIES = [
  // 수도권
  { name:'서울 강남', lat:37.4979, lng:127.0276 },
  { name:'서울 홍대', lat:37.5563, lng:126.9236 },
  { name:'서울 잠실', lat:37.5133, lng:127.1001 },
  { name:'서울 마포', lat:37.5663, lng:126.9014 },
  { name:'서울 용산', lat:37.5298, lng:126.9647 },
  { name:'서울 노원', lat:37.6542, lng:127.0568 },
  { name:'서울 강서', lat:37.5589, lng:126.8497 },
  { name:'인천 부평', lat:37.4897, lng:126.7230 },
  { name:'인천 송도', lat:37.3925, lng:126.6453 },
  { name:'수원', lat:37.2636, lng:127.0286 },
  { name:'성남 판교', lat:37.3947, lng:127.1112 },
  { name:'용인', lat:37.2411, lng:127.1775 },
  { name:'고양', lat:37.6583, lng:126.8320 },
  { name:'하남', lat:37.5397, lng:127.2148 },
  { name:'남양주', lat:37.6360, lng:127.2165 },
  { name:'파주', lat:37.7603, lng:126.7800 },
  { name:'가평', lat:37.8313, lng:127.5096 },
  { name:'양평', lat:37.4916, lng:127.4874 },
  // 경기 남부
  { name:'화성', lat:37.1996, lng:126.8313 },
  { name:'평택', lat:36.9921, lng:127.1128 },
  { name:'안성', lat:37.0078, lng:127.2797 },
  // 강원
  { name:'춘천', lat:37.8813, lng:127.7298 },
  { name:'강릉', lat:37.7519, lng:128.8761 },
  { name:'원주', lat:37.3422, lng:127.9201 },
  { name:'속초', lat:38.2070, lng:128.5918 },
  { name:'홍천', lat:37.6970, lng:127.8886 },
  { name:'평창', lat:37.3706, lng:128.3904 },
  { name:'철원', lat:38.1467, lng:127.3139 },
  // 충청
  { name:'대전 유성', lat:36.3624, lng:127.3565 },
  { name:'세종', lat:36.4800, lng:127.2890 },
  { name:'청주', lat:36.6424, lng:127.4890 },
  { name:'천안', lat:36.8151, lng:127.1139 },
  { name:'충주', lat:36.9910, lng:127.9259 },
  { name:'제천', lat:37.1325, lng:128.1908 },
  { name:'보령', lat:36.3330, lng:126.6127 },
  { name:'서산', lat:36.7847, lng:126.4503 },
  { name:'공주', lat:36.4465, lng:127.1191 },
  // 전라
  { name:'광주 상무', lat:35.1531, lng:126.8516 },
  { name:'전주', lat:35.8242, lng:127.1479 },
  { name:'순천', lat:34.9506, lng:127.4872 },
  { name:'여수', lat:34.7604, lng:127.6622 },
  { name:'목포', lat:34.8118, lng:126.3922 },
  { name:'남원', lat:35.4165, lng:127.3900 },
  { name:'담양', lat:35.3219, lng:126.9880 },
  { name:'고창', lat:35.4355, lng:126.7021 },
  // 경상
  { name:'부산 해운대', lat:35.1587, lng:129.1603 },
  { name:'부산 서면', lat:35.1556, lng:129.0590 },
  { name:'대구 동성로', lat:35.8714, lng:128.5980 },
  { name:'대구 수성', lat:35.8581, lng:128.6305 },
  { name:'울산', lat:35.5384, lng:129.3114 },
  { name:'창원', lat:35.2280, lng:128.6811 },
  { name:'경주', lat:35.8562, lng:129.2247 },
  { name:'포항', lat:36.0190, lng:129.3435 },
  { name:'안동', lat:36.5684, lng:128.7294 },
  { name:'구미', lat:36.1196, lng:128.3446 },
  { name:'진주', lat:35.1799, lng:128.1076 },
  { name:'통영', lat:34.8544, lng:128.4330 },
  { name:'거제', lat:34.8803, lng:128.6213 },
  { name:'남해', lat:34.8375, lng:127.8924 },
  { name:'하동', lat:35.0675, lng:127.7512 },
  // 제주
  { name:'제주시', lat:33.4996, lng:126.5312 },
  { name:'서귀포', lat:33.2541, lng:126.5600 },
  { name:'제주 협재', lat:33.3940, lng:126.2395 },
  { name:'제주 성산', lat:33.4588, lng:126.9426 },
];

// ── 검색 키워드 ──
const CAFE_KEYWORDS = ['애견카페', '반려견카페', '강아지카페', '펫카페', '도그카페'];
const RESTAURANT_KEYWORDS = ['애견식당', '반려견식당', '펫프렌들리식당', '애견동반식당', '반려동물동반레스토랑'];
const PARK_KEYWORDS = ['애견공원', '반려견공원', '반려견놀이터', '애견놀이터', '도그런'];

// ── 실내/실외 분류 ──
function classifyIndoor(name, category) {
  const indoorWords = ['카페', '식당', '레스토랑', '음식점', '펜션', '호텔', '리조트', '실내', '브런치', '베이커리'];
  const outdoorWords = ['공원', '놀이터', '산', '계곡', '해변', '캠핑', '야외', '숲', '도그런', '운동장', '산책'];
  const text = (name + ' ' + category).toLowerCase();
  if (outdoorWords.some(w => text.includes(w))) return false;
  if (indoorWords.some(w => text.includes(w))) return true;
  return true; // 기본값 실내
}

// ── 제외 키워드 (거짓 정보 필터) ──
const EXCLUDE_WORDS = ['미용', '샵', '살롱', '병원', '동물병원', '약국', '유치원', '훈련', '호텔(펫)', '분양'];

function isValid(name) {
  return !EXCLUDE_WORDS.some(w => name.includes(w));
}

// ── 카카오 장소 검색 ──
async function searchKakao(keyword, lat, lng) {
  try {
    const res = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
      params: { query: keyword, x: String(lng), y: String(lat), radius: 20000, size: 15, sort: 'distance' },
      timeout: 5000
    });
    return res.data.documents || [];
  } catch { return []; }
}

// ── 네이버 장소 검색 ──
async function searchNaver(query) {
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/local.json', {
      params: { query, display: 5, sort: 'comment' },
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
      timeout: 5000
    });
    return res.data.items || [];
  } catch { return []; }
}

// ── 한국관광공사 반려동물 동반 장소 ──
async function searchTourAPI(lat, lng, contentTypeId) {
  try {
    const url = `https://apis.data.go.kr/B551011/KorService2/locationBasedList2?serviceKey=${TOUR_API_KEY}&numOfRows=50&pageNo=1&MobileOS=ETC&MobileApp=daengdaengroad&_type=json&mapX=${lng}&mapY=${lat}&radius=20000&contentTypeId=${contentTypeId}&arrange=S`;
    const res = await axios.get(url, { timeout: 8000 });
    const items = res.data?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch { return []; }
}

// ── 중복 제거 ──
function deduplicate(places) {
  const seen = new Set();
  return places.filter(p => {
    const key = p.name.replace(/\s/g, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 메인 수집 함수 ──
async function buildDB() {
  console.log('🐾 댕댕로드 전국 DB 구축 시작!');
  console.log(`총 ${CITIES.length}개 도시 × (카페+식당+공원) 검색\n`);

  const cafeMap = new Map();
  const restaurantMap = new Map();
  const parkMap = new Map();

  let cityCount = 0;
  for (const city of CITIES) {
    cityCount++;
    process.stdout.write(`[${cityCount}/${CITIES.length}] ${city.name} 검색 중...`);

    // 카카오: 카페
    for (const kw of CAFE_KEYWORDS) {
      const results = await searchKakao(kw, city.lat, city.lng);
      for (const p of results) {
        if (!isValid(p.place_name)) continue;
        const key = p.place_name.replace(/\s/g, '').toLowerCase();
        if (!cafeMap.has(key)) {
          cafeMap.set(key, {
            name: p.place_name,
            address: p.road_address_name || p.address_name,
            lat: parseFloat(p.y),
            lng: parseFloat(p.x),
            phone: p.phone || '',
            url: p.place_url || '',
            category: p.category_name || '',
            indoor: classifyIndoor(p.place_name, p.category_name),
            source: 'kakao',
            score: 50
          });
        }
      }
      await sleep(100);
    }

    // 카카오: 식당
    for (const kw of RESTAURANT_KEYWORDS) {
      const results = await searchKakao(kw, city.lat, city.lng);
      for (const p of results) {
        if (!isValid(p.place_name)) continue;
        const key = p.place_name.replace(/\s/g, '').toLowerCase();
        if (!restaurantMap.has(key)) {
          restaurantMap.set(key, {
            name: p.place_name,
            address: p.road_address_name || p.address_name,
            lat: parseFloat(p.y),
            lng: parseFloat(p.x),
            phone: p.phone || '',
            url: p.place_url || '',
            category: p.category_name || '',
            indoor: true,
            source: 'kakao',
            score: 50
          });
        }
      }
      await sleep(100);
    }

    // 카카오: 공원
    for (const kw of PARK_KEYWORDS) {
      const results = await searchKakao(kw, city.lat, city.lng);
      for (const p of results) {
        if (!isValid(p.place_name)) continue;
        const key = p.place_name.replace(/\s/g, '').toLowerCase();
        if (!parkMap.has(key)) {
          parkMap.set(key, {
            name: p.place_name,
            address: p.road_address_name || p.address_name,
            lat: parseFloat(p.y),
            lng: parseFloat(p.x),
            phone: p.phone || '',
            url: p.place_url || '',
            category: p.category_name || '',
            indoor: false,
            source: 'kakao',
            score: 50
          });
        }
      }
      await sleep(100);
    }

    // 관광공사: 음식점(39) + 관광지(12)
    const tourFood = await searchTourAPI(city.lat, city.lng, '39');
    for (const p of tourFood) {
      if (!p.title || !isValid(p.title)) continue;
      const petKw = ['반려', '애견', '강아지', '펫', '도그'];
      if (!petKw.some(k => p.title.includes(k))) continue;
      const key = p.title.replace(/\s/g, '').toLowerCase();
      const isRest = p.title.includes('식당') || p.title.includes('레스토랑') || p.title.includes('음식');
      const target = isRest ? restaurantMap : cafeMap;
      if (!target.has(key)) {
        target.set(key, {
          name: p.title,
          address: (p.addr1||'') + (p.addr2?' '+p.addr2:''),
          lat: parseFloat(p.mapy),
          lng: parseFloat(p.mapx),
          phone: p.tel || '',
          url: `https://map.kakao.com/link/search/${encodeURIComponent(p.title)}`,
          category: '음식점',
          indoor: true,
          source: 'tourapi',
          verified: '한국관광공사 반려동물 동반 공식 인증',
          score: 80
        });
      }
    }
    await sleep(200);

    const tourAttr = await searchTourAPI(city.lat, city.lng, '12');
    for (const p of tourAttr) {
      if (!p.title || !isValid(p.title)) continue;
      const petKw = ['반려', '애견', '강아지', '펫', '공원', '놀이터', '도그'];
      if (!petKw.some(k => p.title.includes(k))) continue;
      const key = p.title.replace(/\s/g, '').toLowerCase();
      if (!parkMap.has(key)) {
        parkMap.set(key, {
          name: p.title,
          address: (p.addr1||'') + (p.addr2?' '+p.addr2:''),
          lat: parseFloat(p.mapy),
          lng: parseFloat(p.mapx),
          phone: p.tel || '',
          url: `https://map.kakao.com/link/search/${encodeURIComponent(p.title)}`,
          category: '관광지',
          indoor: classifyIndoor(p.title, '관광지'),
          source: 'tourapi',
          verified: '한국관광공사 반려동물 동반 공식 인증',
          score: 80
        });
      }
    }
    await sleep(200);

    // 네이버: 도시별 카페+식당
    const naverCafe = await searchNaver(`${city.name} 애견카페`);
    for (const p of naverCafe) {
      const name = p.title.replace(/<[^>]+>/g, '');
      if (!isValid(name)) continue;
      const key = name.replace(/\s/g, '').toLowerCase();
      if (!cafeMap.has(key)) {
        const lng = parseInt(p.mapx) / 1e7;
        const lat = parseInt(p.mapy) / 1e7;
        cafeMap.set(key, {
          name, address: p.roadAddress || p.address,
          lat, lng, phone: p.telephone || '',
          url: p.link || '', category: p.category || '',
          indoor: true, source: 'naver', score: 60
        });
      }
    }
    await sleep(300);

    const naverRest = await searchNaver(`${city.name} 반려견동반식당`);
    for (const p of naverRest) {
      const name = p.title.replace(/<[^>]+>/g, '');
      if (!isValid(name)) continue;
      const key = name.replace(/\s/g, '').toLowerCase();
      if (!restaurantMap.has(key)) {
        const lng = parseInt(p.mapx) / 1e7;
        const lat = parseInt(p.mapy) / 1e7;
        restaurantMap.set(key, {
          name, address: p.roadAddress || p.address,
          lat, lng, phone: p.telephone || '',
          url: p.link || '', category: p.category || '',
          indoor: true, source: 'naver', score: 60
        });
      }
    }
    await sleep(300);

    const count = cafeMap.size + restaurantMap.size + parkMap.size;
    console.log(` → 누적 ${count}개`);
  }

  // ── 좌표 없는 데이터 제거 ──
  const filterValid = arr => arr.filter(p =>
    p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng) &&
    p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132 // 한국 범위
  );

  const cafe = filterValid([...cafeMap.values()]);
  const restaurant = filterValid([...restaurantMap.values()]);
  const park = filterValid([...parkMap.values()]);

  const result = { cafe, restaurant, park };

  fs.writeFileSync('popular_places.json', JSON.stringify(result, null, 2), 'utf-8');

  console.log('\n✅ 완료!');
  console.log(`카페: ${cafe.length}개`);
  console.log(`식당: ${restaurant.length}개`);
  console.log(`공원: ${park.length}개`);
  console.log(`총 ${cafe.length + restaurant.length + park.length}개 → popular_places.json 저장됨`);
}

buildDB().catch(console.error);
