const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// ====== NUEVO: Importar Stripe REAL ======
const stripe = require('stripe')('sk_test_51SzMjvGhbQMsA6UZtRXvR5nseUDVFa95MVWoRd6ilWgWWozIa5rPMIsoRwe08cUwPVtv8t11FOsBHG9xllhL3ydT00BUgSEOdE'); // ⚠️ REEMPLAZAR CON TU CLAVE SECRETA

const nodemailer = require('nodemailer');

// ⚠️ IMPORTANTE: Para que funcione debés crear una "Contraseña de aplicación" de Google:
// 1. Entrá a myaccount.google.com
// 2. Seguridad → Verificación en 2 pasos (activala si no la tenés)
// 3. Seguridad → Contraseñas de aplicaciones → crear una nueva → copiá las 16 letras
// 4. Pegá esas 16 letras en GMAIL_APP_PASSWORD abajo
const GMAIL_APP_PASSWORD = 'fnun scwr nkkp qdpq';

const transporterMail = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'sarmientomiranda89@gmail.com',
    pass: GMAIL_APP_PASSWORD
  }
});

const app = express();

// app.use(helmet());

app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // No aplicar rate limit a los endpoints de polling frecuente
    const skipPaths = [
      '/get-followers/',
      '/get-notifications/',
      '/health'
    ];
    return skipPaths.some(p => req.path.startsWith(p));
  }
});
app.use(limiter);

const users = [];

const bannedWords = [
  'puto','puta','mierda','idiota','estupido','pendejo','gilipollas','cabron','culero','maldito',
  'carajo','joder','imbecil','tarado','tonto','bobo','baboso','patan','bruto','necio','asno',
  'burro','inutil','inservible','torpe','lerdo','pesimo','horrible','repugnante','asqueroso',
  'cochino','sucio','porqueria','basura','escoria','chafa','cutre','ridiculo','payaso','bufon',
  'pelotudo','boludo','pavote','menso','sonso','zopenco','majadero','cretino','memo',
  'papanatas','fantasma','infeliz','fracasado','desgraciado','desastre','vergüenza',
  'fastidioso','molesto','odioso','pesado','loco','chalado','pirado','desquiciado',
  'insufrible','irritante','hipocrita','falso','mentiroso','tramposo','estafador','rata',
  'tacaño','avaro','ruin','malvado','cruel','abusivo','grosero','ordinario','vulgar',
  'maleducado','patetico','insolente','arrogante','engreido','egocentrico','presumido',
  'soberbio','altanero','vanidoso','prepotente','mandon','cinico','burlon','cobarde',
  'miedoso','arrastrado','lamebotas','servil','mediocre','insignificante','irrelevante',
  'amargado','resentido','toxico','conflictivo','problematico','nefasto','fatal',
  'detestable','despreciable','vomitivo','repelente','insoportable'
];

function normalizeForCheck(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/0/g,'o')
    .replace(/1/g,'i')
    .replace(/3/g,'e')
    .replace(/4/g,'a')
    .replace(/5/g,'s')
    .replace(/7/g,'t')
    .replace(/[^a-z0-9]/g,'');
}

const USERS_FILE = path.join(__dirname, 'users.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
} catch(e){
  console.error('Could not create uploads dir', e);
}

function saveUsersToFile() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    console.log('💾 users.json guardado correctamente. Total usuarios:', users.length);
  } catch (e) {
    console.error('❌ ERROR guardando users.json:', e);
  }
}

try {
  if (fs.existsSync(USERS_FILE)) {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach(u => users.push(u));
      console.log('✅ Usuarios cargados:', users.length);
    }
  }
} catch(e){
  console.warn('⚠️ No se pudo leer users.json', e);
}

// Lista de usuarios verificados (misma que el frontend)
const VERIFIED_USERNAMES = [
  'matiasoficial','matias_devoficial','fandeclarastack🔨','fandeclarastack',
  'synergioficial','lauramartina_ltg','estrella⭐','aurora💤','isabella',
  'chezmily','emmis','premium','noeli 🍪','zoey🫧','sonia🐈','vanessa🙃',
  'marisol☀️🌻','nayeli🫠','selena🍒','mireydrops🤩🤩🩵','emilia🧡',
  'yesenia','liana','zoe','galletas','fandeclarita','dalia','aylin','dayra',
  "estefanía💕", "brianna🎶", "coral🐚", "natalia", "maribel", "fabia🌷",
  "rodrigo", "eliza", "janeth🦜", "joana", "kiara🪽"
];

// Función para detectar país desde la request
const https = require('https');

// Función para obtener la IP real del usuario (considerando proxies)
function getRealIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    for (const ip of ips) {
      if (
        !ip.startsWith('127.') &&
        !ip.startsWith('::1') &&
        !ip.startsWith('10.') &&
        !ip.startsWith('192.168.') &&
        !/^172\.(1[6-9]|2\d|3[01])\./.test(ip)
      ) {
        return ip;
      }
    }
  }
  return req.connection?.remoteAddress || req.socket?.remoteAddress || '';
}

// Función para detectar el país real por IP usando ip-api.com (gratis, sin clave)
// Retorna el nombre del país en español, o null si no se puede detectar
function detectCountryByIP(ip) {
  return new Promise((resolve) => {
    // Si es IP local (localhost, desarrollo), no se puede detectar país real
    if (
      !ip ||
      ip === '::1' ||
      ip === '127.0.0.1' ||
      ip.startsWith('127.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    ) {
      resolve(null);
      return;
    }

    const url = `https://ip-api.com/json/${ip}?fields=status,country&lang=es`;
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(null); }
    }, 4000);

    https.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        clearTimeout(timer);
        if (resolved) return;
        resolved = true;
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === 'success' && parsed.country) {
            resolve(parsed.country);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => {
      clearTimeout(timer);
      if (!resolved) { resolved = true; resolve(null); }
    });
  });
}

// Migración completa de campos faltantes en cuentas existentes
let _migrationNeeded = false;
users.forEach(u => {
  // bioUpdatedAt
  if (u.bio && u.bio.trim().length > 0 && !u.bioUpdatedAt) {
    u.bioUpdatedAt = Date.now();
    _migrationNeeded = true;
  }
  // createdAt: NO poner fecha de hoy si no la tenemos. Dejar null para cuentas antiguas.
  if (u.createdAt === undefined) {
    u.createdAt = null;
    _migrationNeeded = true;
  }
  // country: dejar como desconocido si no está guardado
  if (u.country === undefined) {
    u.country = null;
    _migrationNeeded = true;
  }
const isVerifiedUser = VERIFIED_USERNAMES.includes((u.username || '').toLowerCase());
  if (isVerifiedUser && !u.verifiedAt) {
    u.verifiedAt = new Date().toISOString();
    _migrationNeeded = true;
    console.log(`✅ Fecha de verificación asignada (migración) a ${u.username}: ${u.verifiedAt}`);
  }
});
if (_migrationNeeded) {
  saveUsersToFile();
  console.log('✅ Migración limpia aplicada');
}

// ===== SISTEMA DE BLOQUEOS EN SERVIDOR =====
const blocksServerData = {};
const BLOCKS_FILE = path.join(__dirname, 'blocks.json');

try {
  if (fs.existsSync(BLOCKS_FILE)) {
    const raw = fs.readFileSync(BLOCKS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    Object.assign(blocksServerData, parsed);
    console.log('✅ Bloqueos cargados:', Object.keys(blocksServerData).length);
  }
} catch(e) {
  console.warn('⚠️ No se pudo leer blocks.json', e);
}

function saveBlocksToFile() {
  try {
    fs.writeFileSync(BLOCKS_FILE, JSON.stringify(blocksServerData, null, 2), 'utf8');
  } catch(e) {
    console.error('Error guardando blocks.json:', e);
  }
}

app.post('/block-user', (req, res) => {
  try {
    const { blockerId, blockedId } = req.body;
    if (!blockerId || !blockedId) return res.status(400).json({ message: 'IDs requeridos' });
    if (!blocksServerData[blockerId]) blocksServerData[blockerId] = [];
    if (!blocksServerData[blockerId].includes(blockedId)) {
      blocksServerData[blockerId].push(blockedId);
    }
    saveBlocksToFile();
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});

app.post('/unblock-user', (req, res) => {
  try {
    const { blockerId, blockedId } = req.body;
    if (!blocksServerData[blockerId]) return res.json({ success: true });
    blocksServerData[blockerId] = blocksServerData[blockerId].filter(id => id !== blockedId);
    saveBlocksToFile();
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});

// Devuelve lista de IDs que bloquearon a este userId
app.get('/get-blocked-by/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const blockedBy = [];
    Object.entries(blocksServerData).forEach(([blockerId, blockedList]) => {
      if (Array.isArray(blockedList) && blockedList.includes(userId)) {
        blockedBy.push(blockerId);
      }
    });
    res.json({ blockedBy });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});

// Devuelve lista de IDs que este userId bloqueó
app.get('/get-blocks/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const blocked = blocksServerData[userId] || [];
    res.json({ blocked });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});
// ===== FIN SISTEMA DE BLOQUEOS EN SERVIDOR =====

app.post('/send-report', async (req, res) => {
  try {
    const { username, email, problema } = req.body;
    if (!username || !email || !problema) {
      return res.status(400).json({ message: 'Todos los campos son requeridos' });
    }
    const fecha = new Date().toLocaleString('es-ES');
    const mailOptions = {
      from: `"Synergi Reportes" <sarmientomiranda89@gmail.com>`,
      to: 'sarmientomiranda89@gmail.com',
      replyTo: email,
      subject: `[SYNERGI] Reporte de usuario: ${username}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f4f4;padding:24px;border-radius:10px;">
          <div style="background:linear-gradient(135deg,#0ea5e9,#38bdf8);padding:20px;border-radius:8px 8px 0 0;text-align:center;">
            <h2 style="color:white;margin:0;font-size:22px;">📋 Nuevo Reporte — Synergi</h2>
          </div>
          <div style="background:white;padding:20px;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
              <tr style="background:#f9f9f9;">
                <td style="padding:10px 12px;font-weight:bold;color:#555;width:130px;">Usuario</td>
                <td style="padding:10px 12px;color:#222;">${username}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;font-weight:bold;color:#555;">Correo</td>
                <td style="padding:10px 12px;color:#222;">${email}</td>
              </tr>
              <tr style="background:#f9f9f9;">
                <td style="padding:10px 12px;font-weight:bold;color:#555;">Fecha</td>
                <td style="padding:10px 12px;color:#222;">${fecha}</td>
              </tr>
            </table>
            <div style="background:#f0f9ff;border-left:4px solid #38bdf8;padding:14px 16px;border-radius:4px;">
              <strong style="color:#0c4a6e;">Problema reportado:</strong>
              <p style="margin:8px 0 0;color:#333;white-space:pre-wrap;line-height:1.6;">${problema}</p>
            </div>
          </div>
        </div>
      `
    };
    await transporterMail.sendMail(mailOptions);
    console.log(`📧 Reporte enviado de ${username} (${email})`);
    res.json({ success: true });
  } catch(err) {
    console.error('❌ Error enviando reporte:', err.message);
    res.status(500).json({ message: 'Error al enviar el reporte', error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

const PUBLIC_DIR = path.join(__dirname, '.');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, p) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }));
}

app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '1d',
  setHeaders: (res, p) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (res.removeHeader) {
      try { res.removeHeader('Cross-Origin-Embedder-Policy'); } catch(e){}
    }
  }
}));

app.post('/check-username', (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length < 1) {
    return res.status(400).json({ available: false, message: 'El nombre es obligatorio.' });
  }
  const name = username.trim();
  if (name.length > 30) {
    return res.status(400).json({ available: false, message: 'Máximo 30 caracteres permitido.' });
  }
  if (name.includes('@')) {
    return res.status(400).json({ available: false, message: 'El símbolo @ no está permitido.' });
  }
  if (/[\u2705\u2714\u2611]/.test(name)) {
    return res.status(400).json({ available: false, message: 'Emojis de verificación no permitidos.' });
  }
  const norm = normalizeForCheck(name);
  for (const bw of bannedWords) {
    if (norm.includes(bw)) {
      return res.status(400).json({ available: false, message: 'Nombre de usuario inapropiado.' });
    }
  }
  const exists = users.some(u => (u.username || '').toLowerCase() === name.toLowerCase());
  if (exists) {
    return res.status(409).json({ available: false, message: 'Nombre de usuario ya registrado.' });
  }
  return res.status(200).json({ available: true });
});

app.post('/register', async (req, res) => {
  const { dob, username, password } = req.body;
  if (!password || password.length > 10) {
    return res.status(400).json({ message: 'La contraseña no debe superar los 10 caracteres.' });
  }
  if (!username || username.length < 1) {
    return res.status(400).json({ message: 'Nombre de usuario obligatorio.' });
  }
  if (username.length > 30) {
    return res.status(400).json({ message: 'Nombre de usuario demasiado largo.' });
  }
  if (username.includes('@')) {
    return res.status(400).json({ message: 'El símbolo @ no está permitido.' });
  }
  if (/[\u2705\u2714\u2611]/.test(username)) {
    return res.status(400).json({ message: 'Emojis de verificación no permitidos.' });
  }
  const normName = normalizeForCheck(username);
  for (const bw of bannedWords) {
    if (normName.includes(bw)) {
      return res.status(400).json({ message: 'Nombre de usuario inapropiado.' });
    }
  }
  const already = users.some(u => (u.username || '').toLowerCase() === (username.trim().toLowerCase()));
  if (already) {
    return res.status(409).json({ message: 'Nombre de usuario ya existe.' });
  }
  const salt = bcrypt.genSaltSync(10);

  // Detectar el país real por IP del usuario al momento del registro
  const realIP = getRealIP(req);
  const country = await detectCountryByIP(realIP);
  console.log(`🌍 Registro: ${username.trim()} | IP: ${realIP} | País detectado: ${country || 'No detectado'}`);

  const user = {
    id: uuidv4(),
    username: username.trim(),
    name: username.trim(),
    dob,
    passwordHash: bcrypt.hashSync(password, salt),
    bio: '',
    avatar: null,
    coins: 0,
    isPremium: false,
    premiumUntil: null,
    followers: 0,
    following: 0,
    likes: 0,
    creations: 0,
    lastNicknameChange: 0,
    isCreator: false,
    followerIds: [],
    followingIds: [],
    createdAt: new Date().toISOString(),
    country: country
  };
  users.push(user);
  saveUsersToFile();
  console.log(`✅ Nueva cuenta: ${user.username}`);
  res.status(201).json({ id: user.id, username: user.username });
});

app.post('/register-google', async (req, res) => {
  try {
    const { email, name, googleId, picture } = req.body;
    if (!email || !googleId) {
      return res.status(400).json({ message: 'Datos de Google incompletos' });
    }

    // Si ya existe un usuario con este googleId → login directo
    const existente = users.find(u => u.googleId === googleId);
    if (existente) {
      const safe = { ...existente };
      delete safe.passwordHash;
      return res.status(200).json({ id: safe.id, username: safe.username, name: safe.name, avatar: safe.avatar || '' });
    }

    // Generar username único a partir del email
    let baseUsername = (email.split('@')[0] || 'usuario').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 25);
    if (!baseUsername) baseUsername = 'usuario';
    let finalUsername = baseUsername;
    let counter = 1;
    while (users.some(u => (u.username || '').toLowerCase() === finalUsername.toLowerCase())) {
      finalUsername = baseUsername + counter;
      counter++;
    }

    const ip = getRealIP(req);
    const country = await detectCountryByIP(ip);

    const user = {
      id: uuidv4(),
      username: finalUsername,
      name: name || finalUsername,
      dob: null,
      passwordHash: null,
      googleId: googleId,
      email: email,
      bio: '',
      avatar: picture || null,
      coins: 0,
      isPremium: false,
      premiumUntil: null,
      followers: 0,
      following: 0,
      likes: 0,
      creations: 0,
      lastNicknameChange: 0,
      isCreator: false,
      followerIds: [],
      followingIds: [],
      createdAt: new Date().toISOString(),
      country: country
    };

    users.push(user);
    saveUsersToFile();
    console.log(`✅ Nueva cuenta Google: ${user.username} (${email})`);
    res.status(201).json({ id: user.id, username: user.username, name: user.name, avatar: user.avatar || '' });
  } catch(err) {
    console.error('Error register-google:', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/get-user', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).json({ message: 'username required' });
  const u = users.find(x => (x.username||'').toLowerCase() === (username||'').toLowerCase());
  if (!u) return res.status(404).json({ message: 'Usuario no encontrado' });
  let changed = false;
  if (u.bio && u.bio.trim().length > 0 && !u.bioUpdatedAt) {
    u.bioUpdatedAt = Date.now();
    changed = true;
  }
  if (u.createdAt === undefined) {
    u.createdAt = null;
    changed = true;
  }
  // Si el usuario no tiene país guardado, detectarlo por IP real ahora y guardarlo permanentemente
  if (!u.country) {
    const realIP = getRealIP(req);
    const detectedCountry = await detectCountryByIP(realIP);
    if (detectedCountry) {
      u.country = detectedCountry;
      changed = true;
      console.log(`🌍 País detectado para ${u.username}: ${detectedCountry}`);
    }
  }
const isVerifiedUser = VERIFIED_USERNAMES.includes((u.username || '').toLowerCase());
  if (isVerifiedUser && !u.verifiedAt) {
    u.verifiedAt = new Date().toISOString();
    changed = true;
    console.log(`✅ Fecha de verificación asignada a ${u.username}: ${u.verifiedAt}`);
  }
  if (changed) saveUsersToFile();
  const safe = { ...u };
  delete safe.passwordHash;
  res.json({ user: safe });
});

app.get('/search-users', (req, res) => {
  const query = req.query.q;
  const excludeId = req.query.exclude;
  const requesterId = req.query.requester || null; // ID del usuario que hace la búsqueda

  if (!query || query.trim() === '') {
    return res.json({ users: [] });
  }

  const searchTerm = query.toLowerCase().trim();

  // IDs de usuarios que bloquearon al requester (ellos NO deben aparecer en sus resultados)
  // Nº2: si mi amiga bloqueó a Clara, mi amiga no aparece cuando Clara busca
  const blockedByRequester_ids = requesterId
    ? Object.entries(blocksServerData)
        .filter(([bId, bList]) => Array.isArray(bList) && bList.includes(requesterId))
        .map(([bId]) => bId)
    : [];

  const results = [];
  for (const user of users) {
    if (excludeId && user.id === excludeId) continue;
    if (requesterId && user.id === requesterId) continue;

    // Nº2: si este usuario bloqueó al requester → no mostrarlo
    if (requesterId && blockedByRequester_ids.includes(user.id)) continue;

    const username = (user.username || '').toLowerCase();
    const name = (user.name || '').toLowerCase();
    if (username.includes(searchTerm) || name.includes(searchTerm)) {
      const safeUser = { ...user };
      delete safeUser.passwordHash;
      delete safeUser.dob;
      results.push(safeUser);
    }
  }

  const limitedResults = results.slice(0, 20);
  res.json({ users: limitedResults });
});

app.get('/get-all-users', (req, res) => {
  const safeUsers = users.map(user => {
    const safe = { ...user };
    delete safe.passwordHash;
    delete safe.dob;
    return safe;
  });
  res.json({ users: safeUsers });
});

app.get('/get-followers/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  res.json({ 
    followers: user.followers || 0,
    following: user.following || 0 
  });
});

app.get('/get-followers-list/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  const followerIds = user.followerIds || [];
  const followers = followerIds.map(id => {
    const u = users.find(user => user.id === id);
    return u ? {
      id: u.id,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      coins: u.coins,
      isPremium: u.isPremium
    } : null;
  }).filter(Boolean);
  res.json({ followers });
});

app.get('/get-following-list/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  const followingIds = user.followingIds || [];
  const following = followingIds.map(id => {
    const u = users.find(user => user.id === id);
    return u ? {
      id: u.id,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      coins: u.coins,
      isPremium: u.isPremium
    } : null;
  }).filter(Boolean);
  res.json({ following });
});

app.post('/follow', (req, res) => {
  const { followerId, followedId } = req.body;
  if (!followerId || !followedId) {
    return res.status(400).json({ message: 'IDs requeridos' });
  }
  const follower = users.find(u => u.id === followerId);
  const followed = users.find(u => u.id === followedId);
  if (!follower || !followed) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  if (!follower.followingIds) follower.followingIds = [];
  if (!followed.followerIds) followed.followerIds = [];
  if (follower.followingIds.includes(followedId)) {
    return res.status(400).json({ message: 'Ya sigues a este usuario' });
  }
  follower.followingIds.push(followedId);
  followed.followerIds.push(followerId);
  follower.following = follower.followingIds.length;
  followed.followers = followed.followerIds.length;
  saveUsersToFile();
  res.json({ 
    success: true,
    follower: { following: follower.following },
    followed: { followers: followed.followers }
  });
});

app.post('/unfollow', (req, res) => {
  const { followerId, followedId } = req.body;
  const follower = users.find(u => u.id === followerId);
  const followed = users.find(u => u.id === followedId);
  if (!follower || !followed) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  if (follower.followingIds) {
    const index = follower.followingIds.indexOf(followedId);
    if (index > -1) follower.followingIds.splice(index, 1);
  }
  if (followed.followerIds) {
    const index = followed.followerIds.indexOf(followerId);
    if (index > -1) followed.followerIds.splice(index, 1);
  }
  follower.following = follower.followingIds ? follower.followingIds.length : 0;
  followed.followers = followed.followerIds ? followed.followerIds.length : 0;
  saveUsersToFile();
  res.json({ 
    success: true,
    follower: { following: follower.following },
    followed: { followers: followed.followers }
  });
});

app.post('/update-profile', (req, res) => {
  try {
    const { id, username, name, bio, avatarData } = req.body;
    if (!id) return res.status(400).json({ message: 'id required' });
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    if (username && username.trim().length > 0 && username.trim().toLowerCase() !== (user.username||'').toLowerCase()) {
      const norm = normalizeForCheck(username);
      for (const bw of bannedWords) {
        if (norm.includes(bw)) {
          return res.status(400).json({ message: 'Nombre de usuario inapropiado.' });
        }
      }
      const exists = users.some(u => (u.username||'').toLowerCase() === username.trim().toLowerCase() && u.id !== id);
      if (exists) {
        return res.status(409).json({ message: 'Nombre de usuario ya existe.' });
      }
      if (username.length > 30) {
        return res.status(400).json({ message: 'Nombre de usuario demasiado largo.' });
      }
      if (username.includes('@')) {
        return res.status(400).json({ message: 'El símbolo @ no está permitido.' });
      }
      if (/[\u2705\u2714\u2611]/.test(username)) {
        return res.status(400).json({ message: 'Emojis de verificación no permitidos.' });
      }
      if (!user.usernameHistory) user.usernameHistory = [];
      user.usernameHistory.push({
        username: user.username,
        changedAt: Date.now()
      });
      user.username = username.trim();
    }

    if (typeof name === 'string' && name.trim() !== (user.name || '')) {
      const now = Date.now();
      const last = user.lastNicknameChange || 0;
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      if (now - last < threeDaysMs) {
        const msLeft = (last + threeDaysMs) - now;
        return res.status(400).json({ message: `Aún no puedes cambiar el apodo. Intenta más tarde (${Math.ceil(msLeft/(1000*60*60))} hrs).` });
      }
      user.name = name.trim();
      user.lastNicknameChange = now;
    }
    // función //
   if (typeof bio === 'string') {
      if (bio.trim().length > 0) {
        if (bio.trim() !== (user.bio || '').trim()) {
          // Bio cambió → actualizar timestamp
          user.bioUpdatedAt = Date.now();
        } else if (!user.bioUpdatedAt) {
          // Bio no cambió pero nunca tuvo timestamp → darle uno ahora
          user.bioUpdatedAt = Date.now();
        }
        user.bio = bio.trim();
      } else if (!user.bio || user.bio.trim().length === 0) {
        user.bio = '';
      }
    }
    // fin de la función
    if (avatarData && typeof avatarData === 'string' && avatarData.indexOf('base64') !== -1) {
      const matches = avatarData.match(/^data:(image\/\w+);base64,(.+)$/);
      if (matches) {
        const mime = matches[1];
        const ext = mime.split('/')[1] || 'png';
        const b64 = matches[2];
        const filenameOnly = `${user.id}_${Date.now()}.${ext}`;
        const filepath = path.join(UPLOADS_DIR, filenameOnly);
        fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));
        user.avatar = `uploads/${filenameOnly}`.replace(/\\/g, '/');
      }
    }

    saveUsersToFile();
    const safe = { ...user };
    delete safe.passwordHash;
    res.json({ user: safe });
  } catch (err) {
    console.error('Error update-profile', err);
    res.status(500).json({ message: 'Error interno' });
  }
});

app.post('/update-coins', (req, res) => {
  try {
    const { userId, coins, isPremium, premiumUntil } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (coins !== undefined) user.coins = coins;
    if (isPremium !== undefined) user.isPremium = isPremium;
    if (premiumUntil !== undefined) user.premiumUntil = premiumUntil;
    saveUsersToFile();
    res.json({ 
      success: true, 
      coins: user.coins, 
      isPremium: user.isPremium,
      premiumUntil: user.premiumUntil
    });
  } catch (err) {
    console.error('Error update-coins', err);
    res.status(500).json({ message: 'Error interno' });
  }
});

app.get('/get-coins/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  res.json({ 
    coins: user.coins || 0,
    isPremium: user.isPremium || false,
    premiumUntil: user.premiumUntil
  });
});

app.get('/get-user-by-id/:userId', async (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  let changed = false;
  if (!user.bioUpdatedAt && user.bio && user.bio.trim().length > 0) {
    user.bioUpdatedAt = Date.now();
    changed = true;
  }
  const isVerifiedUser = VERIFIED_USERNAMES.includes((user.username || '').toLowerCase());
  if (isVerifiedUser && !user.verifiedAt) {
    user.verifiedAt = new Date().toISOString();
    changed = true;
    console.log(`✅ Fecha de verificación asignada a ${user.username}: ${user.verifiedAt}`);
  }
  if (changed) saveUsersToFile();
  const safe = { ...user };
  delete safe.passwordHash;
  res.json({ user: safe });
});

// ====== 💳 SISTEMA DE PAGOS REAL CON STRIPE ======

// 🚀 ENDPOINT: Crear sesión de pago REAL
app.post('/create-premium-session', async (req, res) => {
  try {
    const { userId, username, type } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'userId required' });
    }
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    // Crear sesión de checkout REAL en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Synergi Premium - Suscripción Mensual',
              description: '3,000 monedas + beneficios premium por 30 días',
              images: ['https://tu-dominio.com/logo-premium.png'], // Opcional: tu logo
            },
            unit_amount: 1945, // $4.99 en centavos (19.45 * 100)
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `http://localhost:3000/payment-success?session_id={CHECKOUT_SESSION_ID}&userId=${userId}`,
      cancel_url: 'http://localhost:3000/payment-cancel',
      client_reference_id: userId,
      customer_email: user.email || `${username}@synergi.com`,
      metadata: {
        userId: userId,
        username: username,
        type: type || 'premium_monthly'
      }
    });
    
    console.log(`💳 Sesión de pago creada para ${username}: ${session.id}`);
    
    // Devolver URL de pago REAL
    res.json({ 
      url: session.url,
      sessionId: session.id
    });
    
  } catch (error) {
    console.error('❌ Error creando sesión de pago:', error);
    res.status(500).json({ 
      message: 'Error al crear sesión de pago',
      error: error.message 
    });
  }
});

// 🎉 ENDPOINT: Confirmar pago exitoso
app.get('/payment-success', async (req, res) => {
  try {
    const { session_id, userId } = req.query;
    
    if (!session_id || !userId) {
      return res.status(400).send('Parámetros faltantes');
    }
    
    // Verificar sesión con Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    if (session.payment_status === 'paid') {
      const user = users.find(u => u.id === userId);
      
      if (user) {
        // Activar premium por 30 días
        const premiumUntil = new Date();
        premiumUntil.setDate(premiumUntil.getDate() + 30);
        
        user.isPremium = true;
        user.premiumUntil = premiumUntil.getTime();
        user.coins = (user.coins || 0) + 15000; // Bonus de monedas
        
        saveUsersToFile();
        
        console.log(`✅ Premium activado para ${user.username}`);
        
        // Redirigir al usuario con mensaje de éxito
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>¡Pago Exitoso!</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 20px;
                text-align: center;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              }
              h1 { color: #667eea; margin-bottom: 20px; }
              p { font-size: 18px; color: #333; }
              .premium-icon { font-size: 80px; margin-bottom: 20px; }
              .btn {
                display: inline-block;
                margin-top: 30px;
                padding: 15px 40px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                text-decoration: none;
                border-radius: 50px;
                font-weight: bold;
              }
              .btn:hover { transform: translateY(-2px); }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="premium-icon">✨</div>
              <h1>¡Pago Exitoso!</h1>
              <p><strong>¡Bienvenido a Synergi Premium!</strong></p>
              <p>Has recibido 3,000 monedas</p>
              <p>Tu suscripción estará activa por 30 días</p>
              <a href="/" class="btn">Volver a Synergi</a>
            </div>
            <script>
              setTimeout(() => {
                window.location.href = '/';
              }, 5000);
            </script>
          </body>
          </html>
        `);
      }
    } else {
      res.status(400).send('El pago no se completó correctamente');
    }
    
  } catch (error) {
    console.error('❌ Error verificando pago:', error);
    res.status(500).send('Error al verificar el pago');
  }
});

// ❌ ENDPOINT: Pago cancelado
app.get('/payment-cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Pago Cancelado</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          text-align: center;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        }
        h1 { color: #f5576c; margin-bottom: 20px; }
        p { font-size: 18px; color: #333; }
        .icon { font-size: 80px; margin-bottom: 20px; }
        .btn {
          display: inline-block;
          margin-top: 30px;
          padding: 15px 40px;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
          text-decoration: none;
          border-radius: 50px;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">😔</div>
        <h1>Pago Cancelado</h1>
        <p>No se completó la suscripción a Synergi Premium</p>
        <p>Puedes intentar nuevamente cuando quieras</p>
        <a href="/" class="btn">Volver a Synergi</a>
      </div>
      <script>
        setTimeout(() => {
          window.location.href = '/';
        }, 5000);
      </script>
    </body>
    </html>
  `);
});

// 🔔 WEBHOOK: Recibir eventos de Stripe (renovaciones automáticas, cancelaciones, etc.)
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = 'TU_WEBHOOK_SECRET_AQUI'; // ⚠️ REEMPLAZAR
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.log(`⚠️ Error webhook signature: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Manejar diferentes tipos de eventos
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log(`✅ Pago completado: ${session.id}`);
      break;
      
    case 'invoice.payment_succeeded':
      // Renovación automática exitosa
      const invoice = event.data.object;
      const userId = invoice.metadata.userId;
      if (userId) {
        const user = users.find(u => u.id === userId);
        if (user) {
          const premiumUntil = new Date();
          premiumUntil.setDate(premiumUntil.getDate() + 30);
          user.premiumUntil = premiumUntil.getTime();
          saveUsersToFile();
          console.log(`✅ Premium renovado para ${user.username}`);
        }
      }
      break;
      
    case 'customer.subscription.deleted':
      // Suscripción cancelada
      const subscription = event.data.object;
      const canceledUserId = subscription.metadata.userId;
      if (canceledUserId) {
        const user = users.find(u => u.id === canceledUserId);
        if (user) {
          user.isPremium = false;
          saveUsersToFile();
          console.log(`❌ Premium cancelado para ${user.username}`);
        }
      }
      break;
      
    default:
      console.log(`Evento no manejado: ${event.type}`);
  }
  
  res.json({ received: true });
});

app.post('/renew-premium', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ message: 'userId required' });
  }
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  const now = new Date();
  let premiumUntil = user.premiumUntil ? new Date(user.premiumUntil) : now;
  if (user.isPremium && premiumUntil > now) {
    premiumUntil.setDate(premiumUntil.getDate() + 30);
  } else {
    premiumUntil = new Date(now);
    premiumUntil.setDate(premiumUntil.getDate() + 30);
  }
  user.isPremium = true;
  user.premiumUntil = premiumUntil.getTime();
  saveUsersToFile();
  res.json({ 
    success: true, 
    message: 'Premium renovado exitosamente',
    premiumUntil: user.premiumUntil
  });
});

// ====== DESCARGA REAL DE WINDOWS ======
app.get('/download/windows', (req, res) => {
  const filePath = path.join(__dirname, 'downloads', 'SynergiSetup.exe');
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Instalador no disponible aún.');
  }
  
  res.setHeader('Content-Disposition', 'attachment; filename="SynergiSetup.exe"');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.download(filePath, 'SynergiSetup.exe');
});

// FUNCIÓN DE BORRAR LA CUENTA EN EL SERVIDOR

app.post('/delete-account', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ message: 'id required' });
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return res.status(404).json({ message: 'Usuario no encontrado' });
    const username = users[index].username;
    users.splice(index, 1);
    saveUsersToFile();
    console.log(`🗑️ Cuenta eliminada permanentemente: ${username}`);
    res.json({ success: true });
  } catch(err) {
    console.error('Error delete-account', err);
    res.status(500).json({ message: 'Error interno' });
  }
});

app.post('/update-country', async (req, res) => {
  try {
    const { userId, country } = req.body;
    if (!userId || !country) return res.status(400).json({ message: 'userId y country requeridos' });
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (user.country !== country) {
      user.country = country;
      saveUsersToFile();
      console.log(`🌍 País actualizado para ${user.username}: ${country}`);
    }
    res.json({ success: true, country: user.country });
  } catch (err) {
    console.error('Error update-country:', err);
    res.status(500).json({ message: 'Error interno' });
  }
});

// FIN DE LA FUNCIÓN

app.get('/get-expiring-notifications/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  const notifications = [];
  const now = Date.now();
  if (user.isPremium && user.premiumUntil) {
    const daysLeft = Math.ceil((user.premiumUntil - now) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 3 && daysLeft > 0) {
      notifications.push({
        type: 'premium_expiry',
        message: `Tu suscripción Premium expira en ${daysLeft} día(s). Renueva ahora para no perder beneficios.`,
        timestamp: now
      });
    }
  }
  res.json({ notifications });
});

// NUEVA FUNCIÓN //

app.post('/delete-account', (req, res) => {
  const { id } = req.body;
  const index = users.findIndex(u => u.id === id);
  if (index !== -1) {
    console.log('🗑️ Borrando:', users[index].username);
    users.splice(index, 1);
    saveUsersToFile();
  }
  res.json({ success: true });
});

// FIN DE LA NUEVA FUNCIÓN//

// NUEVA FUNCIÓN AÑANIDA-SISTEMA DE NOTAS //

// ===== SISTEMA DE NOTAS GLOBAL =====
const notesData = {};
const NOTES_FILE = path.join(__dirname, 'notes.json');

try {
  if (fs.existsSync(NOTES_FILE)) {
    const raw = fs.readFileSync(NOTES_FILE, 'utf8');
    Object.assign(notesData, JSON.parse(raw));
    console.log('✅ Notas cargadas:', Object.keys(notesData).length);
  }
} catch(e) { console.warn('⚠️ No se pudo leer notes.json', e); }

function saveNotesToFile() {
  try { fs.writeFileSync(NOTES_FILE, JSON.stringify(notesData, null, 2), 'utf8'); } catch(e) {}
}

app.post('/save-note', (req, res) => {
  try {
    const { userId, text, visibility } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    if (!text || !text.trim()) {
      delete notesData[userId];
    } else {
      notesData[userId] = { text: text.trim(), visibility: visibility || 'all', timestamp: Date.now() };
    }
    saveNotesToFile();
    res.json({ success: true });
  } catch(err) {
    console.error('Error save-note:', err);
    res.status(500).json({ message: 'Error interno' });
  }
});

app.get('/get-note/:userId', (req, res) => {
  const { userId } = req.params;
  const note = notesData[userId] || null;
  if (note && note.timestamp) {
    const ahora = Date.now();
    const veinticuatroHoras = 24 * 60 * 60 * 1000;
    if (ahora - note.timestamp > veinticuatroHoras) {
      delete notesData[userId];
      saveNotesToFile();
      return res.json({ note: null });
    }
  }
  res.json({ note });
});

// ===== FIN SISTEMA DE NOTAS =====

// Limpieza automática cada hora: borra notas vencidas (más de 24 horas)
setInterval(() => {
  const ahora = Date.now();
  const veinticuatroHoras = 24 * 60 * 60 * 1000;
  let eliminadas = 0;
  for (const userId in notesData) {
    const note = notesData[userId];
    if (note && note.timestamp && (ahora - note.timestamp > veinticuatroHoras)) {
      delete notesData[userId];
      eliminadas++;
    }
  }
  if (eliminadas > 0) {
    saveNotesToFile();
    console.log(`🗑️ Notas expiradas eliminadas: ${eliminadas}`);
  }
}, 60 * 60 * 1000); // cada 1 hora

// ===== FIN SISTEMA DE NOTAS =====

// NUEVA FUNCIÓN AÑADIDA //

const notifications = {};
const NOTIFICATIONS_FILE = path.join(__dirname, 'notifications.json');

try {
  if (fs.existsSync(NOTIFICATIONS_FILE)) {
    const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    Object.assign(notifications, parsed);
    console.log('✅ Notificaciones cargadas');
  }
} catch(e) {
  console.warn('⚠️ No se pudo leer notifications.json', e);
}

function saveNotificationsToFile() {
  try {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2), 'utf8');
  } catch(e) {
    console.error('Error guardando notifications.json:', e);
  }
}

app.post('/create-notification', (req, res) => {
  try {
    const { userId, type, data, timestamp } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    if (!notifications[userId]) notifications[userId] = [];
    const notif = { id: Date.now(), type, data, timestamp: timestamp || Date.now(), read: false };
    notifications[userId].unshift(notif);
    if (notifications[userId].length > 100) notifications[userId].pop();
    saveNotificationsToFile();
    res.json({ success: true, notif });
  } catch(err) {
    console.error('Error create-notification:', err);
    res.status(500).json({ message: 'Error interno' });
  }
});

app.get('/get-notifications/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    let userNotifs = notifications[userId] || [];

    // Nº1: Filtrar notificaciones de usuarios bloqueados (en ambas direcciones)
    // - usuarios que este userId bloqueó
    const blockedByThisUser = blocksServerData[userId] || [];
    // - usuarios que bloquearon a este userId
    const usersWhoBlockedThisUser = Object.entries(blocksServerData)
      .filter(([bId, bList]) => Array.isArray(bList) && bList.includes(userId))
      .map(([bId]) => bId);
    const todosLosBloqueados = [...new Set([...blockedByThisUser, ...usersWhoBlockedThisUser])];

    if (todosLosBloqueados.length > 0) {
      userNotifs = userNotifs.filter(notif => {
        const fromId = notif.data && (notif.data.followerId || notif.data.fromUserId);
        if (!fromId) return true;
        return !todosLosBloqueados.includes(fromId);
      });
    }

    userNotifs = userNotifs.map(notif => {
      // ✅ Copia profunda de data para no mutar el objeto original
      const updatedNotif = { ...notif, data: { ...notif.data } };
      if (['mention_bio', 'mention_nota'].includes(notif.type) && notif.data && notif.data.fromUserId) {
        const fromUser = users.find(u => u.id === notif.data.fromUserId);
        if (fromUser) {
          updatedNotif.data.fromName = fromUser.name || fromUser.username;
          updatedNotif.data.fromUsername = fromUser.username;
          updatedNotif.data.fromAvatar = fromUser.avatar || '';
          // ✅ NUEVO: mandar avatarUpdated para que el cache buster sea correcto
          updatedNotif.data.fromAvatarUpdated = fromUser.avatarUpdated || null;
        }
      } else if (notif.type === 'follow' && notif.data && notif.data.followerId) {
        const follower = users.find(u => u.id === notif.data.followerId);
        if (follower) {
          updatedNotif.data.followerName = follower.name || follower.username;
          updatedNotif.data.followerUsername = follower.username;
          updatedNotif.data.followerAvatar = follower.avatar || '';
          // ✅ NUEVO: mandar avatarUpdated para que el cache buster sea correcto
          updatedNotif.data.followerAvatarUpdated = follower.avatarUpdated || null;
        }
      }
      return updatedNotif;
    });
    res.json({ notifications: userNotifs });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});

app.post('/mark-notifications-read', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    if (notifications[userId]) {
      notifications[userId].forEach(n => n.read = true);
      saveNotificationsToFile();
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});

// FIN DE LA FUNCIÓN //

// nuevo //

// ===== SISTEMA DE ACTIVIDAD EN TIEMPO REAL =====
app.post('/update-activity', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    user.lastSeen = Date.now();
    // No se guarda en disco para no sobrecargar con escrituras frecuentes
    res.json({ success: true, lastSeen: user.lastSeen });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});

app.get('/get-activity/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    const lastSeen = user.lastSeen || null;
    const now = Date.now();
    const ONLINE_UMBRAL_MS = 5 * 60 * 1000; // 5 minutos = activo
    const isOnline = !!(lastSeen && (now - lastSeen < ONLINE_UMBRAL_MS));
    res.json({ lastSeen, isOnline });
  } catch(err) {
    res.status(500).json({ message: 'Error interno' });
  }
});
// ===== FIN SISTEMA DE ACTIVIDAD =====

app.post('/register-facebook', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!email || !name) {
      return res.status(400).json({ message: 'Nombre y correo requeridos' });
    }

    // Si ya existe un usuario con este email de Facebook → login directo
    const existente = users.find(u => u.facebookEmail === email.toLowerCase());
    if (existente) {
      const safe = { ...existente };
      delete safe.passwordHash;
      return res.status(200).json({ id: safe.id, username: safe.username, name: safe.name, avatar: safe.avatar || '' });
    }

    // Generar username único a partir del nombre
    let baseUsername = name.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 20).toLowerCase();
    if (!baseUsername || baseUsername.length < 2) baseUsername = 'usuario';
    let finalUsername = baseUsername;
    let counter = 1;
    while (users.some(u => (u.username || '').toLowerCase() === finalUsername.toLowerCase())) {
      finalUsername = baseUsername + counter;
      counter++;
    }

    const ip = getRealIP(req);
    const country = await detectCountryByIP(ip);

    const user = {
      id: uuidv4(),
      username: finalUsername,
      name: name.trim(),
      dob: null,
      passwordHash: null,
      facebookEmail: email.toLowerCase(),
      bio: '',
      avatar: null,
      coins: 0,
      isPremium: false,
      premiumUntil: null,
      followers: 0,
      following: 0,
      likes: 0,
      creations: 0,
      lastNicknameChange: 0,
      isCreator: false,
      followerIds: [],
      followingIds: [],
      createdAt: new Date().toISOString(),
      country: country
    };

    users.push(user);
    saveUsersToFile();
    console.log(`✅ Nueva cuenta Facebook: ${user.username} (${email})`);
    res.status(201).json({ id: user.id, username: user.username, name: user.name, avatar: user.avatar || '' });
  } catch(err) {
    console.error('Error register-facebook:', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ===== SISTEMA DE PRE-REGISTROS GLOBAL =====
const preregistros = [];
const PREREGISTROS_FILE = path.join(__dirname, 'preregistros.json');

try {
  if (fs.existsSync(PREREGISTROS_FILE)) {
    const raw = fs.readFileSync(PREREGISTROS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach(p => preregistros.push(p));
      console.log('✅ Pre-registros cargados:', preregistros.length);
    }
  }
} catch(e) {
  console.warn('⚠️ No se pudo leer preregistros.json', e);
}

function savePreregistrosToFile() {
  try {
    fs.writeFileSync(PREREGISTROS_FILE, JSON.stringify(preregistros, null, 2), 'utf8');
  } catch(e) {
    console.error('❌ Error guardando preregistros.json:', e);
  }
}

app.get('/get-preregistros-count', (req, res) => {
  res.json({ count: preregistros.length });
});

app.post('/check-preregistro', (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ available: false, message: 'Nombre requerido.' });
    }
    const lower = username.trim().toLowerCase();
    if (lower.length > 30) {
      return res.status(400).json({ available: false, message: 'Máximo 30 caracteres.' });
    }
    if (lower.includes('@')) {
      return res.status(400).json({ available: false, message: 'No uses el símbolo @.' });
    }
    const inPreregistros = preregistros.some(p => (p.username || '').toLowerCase() === lower);
    if (inPreregistros) {
      return res.json({ available: false, message: 'Este nombre ya fue reservado.' });
    }
    const inUsers = users.some(u => (u.username || '').toLowerCase() === lower);
    if (inUsers) {
      return res.json({ available: false, message: 'Este nombre ya está registrado en Synergi.' });
    }
    return res.json({ available: true });
  } catch(err) {
    res.status(500).json({ available: false, message: 'Error interno.' });
  }
});

app.post('/save-preregistro', (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, message: 'Nombre requerido.' });
    }
    const lower = username.trim().toLowerCase();
    if (lower.length > 30) {
      return res.status(400).json({ success: false, message: 'Máximo 30 caracteres.' });
    }
    const inPreregistros = preregistros.some(p => (p.username || '').toLowerCase() === lower);
    const inUsers = users.some(u => (u.username || '').toLowerCase() === lower);
    if (inPreregistros || inUsers) {
      return res.json({ success: false, message: 'Este nombre ya fue reservado o registrado.' });
    }
    preregistros.push({ username: username.trim(), reservedAt: new Date().toISOString() });
    savePreregistrosToFile();
    console.log(`📝 Pre-registro: @${username.trim()} | Total: ${preregistros.length}`);
    return res.json({ success: true, total: preregistros.length });
  } catch(err) {
    console.error('Error en /save-preregistro:', err);
    res.status(500).json({ success: false, message: 'Error interno.' });
  }
});
// ===== FIN SISTEMA DE PRE-REGISTROS GLOBAL =====

const PORT = 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ===============================================');
  console.log('🚀  SERVIDOR SYNERGI CON PAGOS REALES STRIPE');
  console.log('🚀 ===============================================');
  console.log(`🚀  URL: http://localhost:${PORT}`);
  console.log('🚀  Estado: ✅ ACTIVO');
  console.log('🚀 ===============================================');
  console.log('');
});




















































