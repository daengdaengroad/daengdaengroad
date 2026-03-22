require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

/* =========================
   ✅ 프론트 (핵심 추가)
========================= */
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
   기존 라우트 유지
========================= */

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

/* =========================
   🔥 카카오 로그인 콜백 (없으면 반드시 필요)
========================= */
app.get('/auth/kakao/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post(
      'https://kauth.kakao.com/oauth/token',
      null,
      {
        params: {
          grant_type: 'authorization_code',
          client_id: process.env.KAKAO_REST_KEY,
          redirect_uri: 'https://daengdaengroad-production.up.railway.app/auth/kakao/callback',
          code
        }
      }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get(
      'https://kapi.kakao.com/v2/user/me',
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const user = userRes.data;

    // ✅ 프론트로 이동
    res.redirect(`/?login=success&user=${encodeURIComponent(JSON.stringify(user))}`);

  } catch (err) {
    console.error('카카오 로그인 오류:', err.message);
    res.redirect('/?login=fail');
  }
});

/* =========================
   API (기존 유지)
========================= */

// 예시 health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* =========================
   ❌ 기존 '/' 삭제됨
========================= */
// app.get('/', (req, res) => {
//   res.json({ status: 'ok' });
// });

/* =========================
   ✅ SPA 대응 (핵심)
========================= */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =========================
   서버 실행
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 서버 실행: ${PORT}`);
});