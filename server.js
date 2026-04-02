const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const { Pool }   = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ===== BASE DE DONNÉES =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bankvi_db_user:uF0ykwsfC5oWZX4g0Tebs9NxK3PFn4OO@dpg-d73pui1aae7s73b505a0-a/bankvi_db',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ===== LOGS =====
function log(niveau, message, data = {}) {
  const entry = {
    time:    new Date().toISOString(),
    niveau,
    message,
    ...data
  };
  if (niveau === 'ERROR') console.error(JSON.stringify(entry));
  else                    console.log(JSON.stringify(entry));
}

// ===== INIT BASE DE DONNÉES =====
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id         SERIAL PRIMARY KEY,
      nom        TEXT NOT NULL,
      boutique   TEXT NOT NULL,
      tel        TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      token      TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      last_login TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ventes (
      id              SERIAL PRIMARY KEY,
      utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      produit         TEXT NOT NULL,
      quantite        INTEGER NOT NULL,
      montant         REAL NOT NULL,
      mode_paiement   TEXT NOT NULL,
      client          TEXT DEFAULT '',
      date            TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS dettes (
      id                   SERIAL PRIMARY KEY,
      utilisateur_id       INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      client               TEXT NOT NULL,
      produit              TEXT NOT NULL,
      montant              REAL NOT NULL,
      date_remboursement   TEXT DEFAULT '',
      statut               TEXT DEFAULT 'en_cours',
      date_creation        TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stocks (
      id              SERIAL PRIMARY KEY,
      utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      nom             TEXT NOT NULL,
      categorie       TEXT NOT NULL,
      quantite        INTEGER NOT NULL,
      seuil_alerte    INTEGER DEFAULT 5,
      prix_unitaire   REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs_securite (
      id         SERIAL PRIMARY KEY,
      ip         TEXT,
      action     TEXT,
      detail     TEXT,
      user_id    INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ventes_user   ON ventes(utilisateur_id);
    CREATE INDEX IF NOT EXISTS idx_ventes_date   ON ventes(date);
    CREATE INDEX IF NOT EXISTS idx_dettes_user   ON dettes(utilisateur_id);
    CREATE INDEX IF NOT EXISTS idx_dettes_statut ON dettes(statut);
    CREATE INDEX IF NOT EXISTS idx_stocks_user   ON stocks(utilisateur_id);
    CREATE INDEX IF NOT EXISTS idx_token         ON utilisateurs(token);
  `);
  log('INFO', 'Base de données prête');
}

// ===== HELPERS =====
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/<[^>]*>/g, '').substring(0, 500);
}

function sanitizeNum(val) {
  const n = Number(val);
  return isNaN(n) || n < 0 ? 0 : n;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
}

async function logSecurite(ip, action, detail, userId = null) {
  try {
    await pool.query(
      'INSERT INTO logs_securite (ip, action, detail, user_id) VALUES ($1,$2,$3,$4)',
      [ip, action, detail, userId]
    );
  } catch(e) { /* silencieux */ }
}

// ===== RATE LIMITING =====
const tentatives = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip  = getIP(req);
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const data = tentatives.get(key) || { count:0, reset: now + windowMs };

    if (now > data.reset) { data.count = 0; data.reset = now + windowMs; }
    data.count++;
    tentatives.set(key, data);

    if (data.count > max) {
      log('WARN', 'Rate limit dépassé', { ip, path: req.path });
      logSecurite(ip, 'RATE_LIMIT', req.path);
      return res.status(429).json({ message: 'Trop de requêtes — réessaie dans quelques minutes' });
    }
    next();
  };
}

// Nettoyage mémoire toutes les 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of tentatives.entries()) {
    if (now > data.reset) tentatives.delete(key);
  }
}, 600000);

// ===== HTTPS FORCÉ =====
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// ===== HEADERS DE SÉCURITÉ =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('X-XSS-Protection',          '1; mode=block');
  res.setHeader('Referrer-Policy',           'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// ===== LOG TOUTES LES REQUÊTES =====
app.use((req, res, next) => {
  const start = Date.now();
  const ip    = getIP(req);
  res.on('finish', () => {
    const ms = Date.now() - start;
    log(res.statusCode >= 400 ? 'WARN' : 'INFO', 'Requête', {
      method: req.method,
      path:   req.path,
      status: res.statusCode,
      ms,
      ip,
    });
  });
  next();
});

// ===== CORS =====
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://bankvi.onrender.com']
    : '*',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(express.json({ limit: '50kb' }));

// ===== AUTH MIDDLEWARE =====
async function auth(req, res, next) {
  try {
    const token = req.headers['authorization'];
    if (!token || token.length < 10)
      return res.status(401).json({ message: 'Non autorisé' });

    const result = await pool.query(
      'SELECT id, nom, boutique, tel FROM utilisateurs WHERE token = $1',
      [token]
    );
    if (!result.rows.length) {
      logSecurite(getIP(req), 'TOKEN_INVALIDE', token.substring(0,10)+'...');
      return res.status(401).json({ message: 'Token invalide' });
    }
    req.user = result.rows[0];
    next();
  } catch(e) {
    log('ERROR', 'Auth error', { error: e.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

// ===== ROUTES =====
app.get('/',         (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/api/ping', auth, (req, res) => res.json({ status:'ok', user: req.user.nom }));

// ===== REGISTER =====
app.post('/api/register', rateLimit(5, 300000), async (req, res) => {
  const ip = getIP(req);
  try {
    const nom      = sanitize(req.body.nom);
    const boutique = sanitize(req.body.boutique);
    const tel      = sanitize(req.body.tel);
    const password = req.body.password;

    if (!nom || !boutique || !tel || !password)
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Mot de passe trop court (minimum 6 caractères)' });
    if (!/^[0-9+\s\-]{6,20}$/.test(tel))
      return res.status(400).json({ message: 'Numéro de téléphone invalide' });

    const existe = await pool.query('SELECT id FROM utilisateurs WHERE tel = $1', [tel]);
    if (existe.rows.length)
      return res.status(400).json({ message: 'Ce numéro est déjà utilisé' });

    // bcrypt — hash fort
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      'INSERT INTO utilisateurs (nom, boutique, tel, password) VALUES ($1,$2,$3,$4)',
      [nom, boutique, tel, hash]
    );

    log('INFO', 'Nouveau compte créé', { nom, boutique, ip });
    logSecurite(ip, 'REGISTER', `Nouveau compte: ${nom} / ${boutique}`);
    res.json({ message: 'Compte créé avec succès' });

  } catch(e) {
    log('ERROR', 'Register error', { error: e.message, ip });
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ===== LOGIN =====
app.post('/api/login', rateLimit(10, 300000), async (req, res) => {
  const ip = getIP(req);
  try {
    const tel      = sanitize(req.body.tel);
    const password = req.body.password;

    if (!tel || !password)
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });

    const result = await pool.query(
      'SELECT * FROM utilisateurs WHERE tel = $1',
      [tel]
    );

    if (!result.rows.length) {
      logSecurite(ip, 'LOGIN_ECHEC', `Numéro inconnu: ${tel}`);
      // Même message volontairement — ne pas révéler si le compte existe
      return res.status(401).json({ message: 'Numéro ou mot de passe incorrect' });
    }

    const u = result.rows[0];

    // Vérification bcrypt
    const valide = await bcrypt.compare(password, u.password);
    if (!valide) {
      logSecurite(ip, 'LOGIN_ECHEC', `Mauvais mot de passe pour: ${tel}`, u.id);
      return res.status(401).json({ message: 'Numéro ou mot de passe incorrect' });
    }

    const token = crypto.randomBytes(48).toString('hex');
    await pool.query(
      'UPDATE utilisateurs SET token=$1, last_login=NOW() WHERE id=$2',
      [token, u.id]
    );

    log('INFO', 'Connexion réussie', { nom: u.nom, ip });
    logSecurite(ip, 'LOGIN_OK', `Connexion: ${u.nom}`, u.id);

    res.json({
      token,
      user: { id: u.id, nom: u.nom, boutique: u.boutique }
    });

  } catch(e) {
    log('ERROR', 'Login error', { error: e.message, ip });
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ===== VENTES =====
app.get('/api/ventes', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ventes WHERE utilisateur_id=$1 ORDER BY date DESC LIMIT 500',
      [req.user.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.post('/api/ventes', auth, async (req, res) => {
  try {
    const produit       = sanitize(req.body.produit);
    const quantite      = sanitizeNum(req.body.quantite);
    const montant       = sanitizeNum(req.body.montant);
    const mode_paiement = sanitize(req.body.mode_paiement);
    const client        = sanitize(req.body.client || '');

    if (!produit || !quantite || !montant || !mode_paiement)
      return res.status(400).json({ message:'Champs manquants' });

    const modesValides = ['Cash','À crédit','Partiel'];
    if (!modesValides.includes(mode_paiement))
      return res.status(400).json({ message:'Mode de paiement invalide' });

    await pool.query(
      'INSERT INTO ventes (utilisateur_id,produit,quantite,montant,mode_paiement,client,date) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [req.user.id, produit, quantite, montant, mode_paiement, client]
    );

    // Stock diminue automatiquement
    const stock = await pool.query(
      'SELECT * FROM stocks WHERE utilisateur_id=$1 AND LOWER(nom) LIKE LOWER($2) LIMIT 1',
      [req.user.id, `%${produit.split(' ')[0]}%`]
    );
    if (stock.rows.length > 0) {
      const nouvelleQte = Math.max(0, stock.rows[0].quantite - quantite);
      await pool.query('UPDATE stocks SET quantite=$1 WHERE id=$2', [nouvelleQte, stock.rows[0].id]);
    }

    // Dette créée automatiquement si vente à crédit
    if (mode_paiement === 'À crédit' && client) {
      await pool.query(
        'INSERT INTO dettes (utilisateur_id,client,produit,montant,statut,date_creation) VALUES ($1,$2,$3,$4,$5,NOW())',
        [req.user.id, client, produit, montant, 'en_cours']
      );
    }

    res.json({ message:'Vente enregistrée' });
  } catch(e) {
    log('ERROR', 'Vente error', { error: e.message });
    res.status(500).json({ message:'Erreur serveur' });
  }
});

// ===== DETTES =====
app.get('/api/dettes/retard', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM dettes
      WHERE utilisateur_id=$1
        AND statut='en_cours'
        AND date_remboursement != ''
        AND date_remboursement < CURRENT_DATE::text
      ORDER BY date_remboursement ASC
    `, [req.user.id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.get('/api/dettes', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM dettes WHERE utilisateur_id=$1 ORDER BY date_creation DESC LIMIT 500',
      [req.user.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.post('/api/dettes', auth, async (req, res) => {
  try {
    const client             = sanitize(req.body.client);
    const produit            = sanitize(req.body.produit);
    const montant            = sanitizeNum(req.body.montant);
    const date_remboursement = sanitize(req.body.date_remboursement || '');

    if (!client || !produit || !montant)
      return res.status(400).json({ message:'Champs manquants' });

    await pool.query(
      'INSERT INTO dettes (utilisateur_id,client,produit,montant,date_remboursement,statut,date_creation) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [req.user.id, client, produit, montant, date_remboursement, 'en_cours']
    );
    res.json({ message:'Dette enregistrée' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.put('/api/dettes/:id/payer', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message:'ID invalide' });
    await pool.query(
      'UPDATE dettes SET statut=$1 WHERE id=$2 AND utilisateur_id=$3',
      ['payee', id, req.user.id]
    );
    res.json({ message:'Dette payée' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.put('/api/dettes/:id', auth, async (req, res) => {
  try {
    const id                 = parseInt(req.params.id);
    const client             = sanitize(req.body.client);
    const produit            = sanitize(req.body.produit);
    const montant            = sanitizeNum(req.body.montant);
    const date_remboursement = sanitize(req.body.date_remboursement || '');

    if (isNaN(id) || !client || !produit || !montant)
      return res.status(400).json({ message:'Données invalides' });

    await pool.query(
      'UPDATE dettes SET client=$1,produit=$2,montant=$3,date_remboursement=$4 WHERE id=$5 AND utilisateur_id=$6',
      [client, produit, montant, date_remboursement, id, req.user.id]
    );
    res.json({ message:'Dette modifiée' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.delete('/api/dettes/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message:'ID invalide' });
    await pool.query(
      'DELETE FROM dettes WHERE id=$1 AND utilisateur_id=$2',
      [id, req.user.id]
    );
    res.json({ message:'Dette supprimée' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

// ===== STOCKS =====
app.get('/api/stocks', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM stocks WHERE utilisateur_id=$1 ORDER BY nom ASC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.post('/api/stocks', auth, async (req, res) => {
  try {
    const nom           = sanitize(req.body.nom);
    const categorie     = sanitize(req.body.categorie || 'Autre');
    const quantite      = sanitizeNum(req.body.quantite);
    const seuil_alerte  = sanitizeNum(req.body.seuil_alerte) || 5;
    const prix_unitaire = sanitizeNum(req.body.prix_unitaire);

    if (!nom || !quantite || !prix_unitaire)
      return res.status(400).json({ message:'Champs manquants' });

    await pool.query(
      'INSERT INTO stocks (utilisateur_id,nom,categorie,quantite,seuil_alerte,prix_unitaire) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, nom, categorie, quantite, seuil_alerte, prix_unitaire]
    );
    res.json({ message:'Produit ajouté' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.put('/api/stocks/:id', auth, async (req, res) => {
  try {
    const id            = parseInt(req.params.id);
    const nom           = sanitize(req.body.nom);
    const categorie     = sanitize(req.body.categorie || 'Autre');
    const quantite      = sanitizeNum(req.body.quantite);
    const seuil_alerte  = sanitizeNum(req.body.seuil_alerte) || 5;
    const prix_unitaire = sanitizeNum(req.body.prix_unitaire);

    if (isNaN(id) || !nom || !prix_unitaire)
      return res.status(400).json({ message:'Données invalides' });

    await pool.query(
      'UPDATE stocks SET nom=$1,categorie=$2,quantite=$3,seuil_alerte=$4,prix_unitaire=$5 WHERE id=$6 AND utilisateur_id=$7',
      [nom, categorie, quantite, seuil_alerte, prix_unitaire, id, req.user.id]
    );
    res.json({ message:'Stock modifié' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

app.delete('/api/stocks/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message:'ID invalide' });
    await pool.query(
      'DELETE FROM stocks WHERE id=$1 AND utilisateur_id=$2',
      [id, req.user.id]
    );
    res.json({ message:'Stock supprimé' });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

// ===== DASHBOARD =====
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [ventes, dettes, stocks] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count FROM ventes WHERE utilisateur_id=$1 AND date::date=CURRENT_DATE", [uid]),
      pool.query("SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count FROM dettes WHERE utilisateur_id=$1 AND statut='en_cours'", [uid]),
      pool.query("SELECT COUNT(*) as count FROM stocks WHERE utilisateur_id=$1 AND quantite<=seuil_alerte", [uid]),
    ]);
    res.json({
      ventes_jour:     Number(ventes.rows[0].total)  || 0,
      ventes_count:    Number(ventes.rows[0].count)  || 0,
      dettes_total:    Number(dettes.rows[0].total)  || 0,
      dettes_count:    Number(dettes.rows[0].count)  || 0,
      stocks_critique: Number(stocks.rows[0].count)  || 0,
    });
  } catch(e) { res.status(500).json({ message:'Erreur serveur' }); }
});

// ===== RAPPORT PDF =====
app.get('/api/rapport', async (req, res) => {
  try {
    const token = req.headers['authorization'] || req.query.token;
    if (!token) return res.status(401).send('Non autorisé');

    const userResult = await pool.query('SELECT * FROM utilisateurs WHERE token=$1', [token]);
    if (!userResult.rows.length) return res.status(401).send('Token invalide');
    const u = userResult.rows[0];

    const [ventes, dettes, stocks] = await Promise.all([
      pool.query("SELECT * FROM ventes WHERE utilisateur_id=$1 AND date::date=CURRENT_DATE ORDER BY date DESC", [u.id]),
      pool.query("SELECT * FROM dettes WHERE utilisateur_id=$1 AND statut='en_cours' ORDER BY date_creation DESC", [u.id]),
      pool.query("SELECT * FROM stocks WHERE utilisateur_id=$1 AND quantite<=seuil_alerte ORDER BY quantite ASC", [u.id]),
    ]);

    const totalVentes = ventes.rows.reduce((s,v) => s+Number(v.montant), 0);
    const totalDettes = dettes.rows.reduce((s,d) => s+Number(d.montant), 0);
    const date = new Date().toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin:40, size:'A4' });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="rapport-bankvi-${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    doc.fontSize(24).font('Helvetica-Bold').fillColor('#0C447C').text('BANKVI',40,40);
    doc.fontSize(10).font('Helvetica').fillColor('#6b6b6b').text('Rapport journalier',40,68);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a1a').text(u.nom,400,40,{align:'right'});
    doc.fontSize(10).font('Helvetica').fillColor('#6b6b6b').text(u.boutique,400,56,{align:'right'});
    doc.text(date,400,72,{align:'right'});
    doc.moveTo(40,90).lineTo(555,90).strokeColor('#0C447C').lineWidth(2).stroke();

    let y = 110;
    [{label:"Chiffre d'affaires",val:totalVentes.toLocaleString('fr-FR')+' F',color:'#1D9E75'},
     {label:'Ventes du jour',val:ventes.rows.length.toString(),color:'#185FA5'},
     {label:'Dettes en cours',val:totalDettes.toLocaleString('fr-FR')+' F',color:'#D85A30'}
    ].forEach((m,i) => {
      const x = 40+i*172;
      doc.roundedRect(x,y,160,60,6).fillColor('#f5f5f3').fill();
      doc.fontSize(9).font('Helvetica').fillColor('#6b6b6b').text(m.label,x+10,y+10);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(m.color).text(m.val,x+10,y+28);
    });
    y += 80;

    const section = (title, rows, headers, cols, rowFn) => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a').text(`${title} (${rows.length})`,40,y);
      y += 18;
      doc.moveTo(40,y).lineTo(555,y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
      y += 8;
      if (!rows.length) { doc.fontSize(10).font('Helvetica').fillColor('#a0a0a0').text('Aucune donnée',40,y); y+=20; return; }
      headers.forEach((h,i) => doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b6b6b').text(h,cols[i],y));
      y += 16;
      rows.forEach((row,idx) => {
        if (idx%2===0) doc.roundedRect(38,y-3,517,18,2).fillColor('#f9f9f9').fill();
        rowFn(row,cols,y);
        y += 18;
      });
      y += 10;
    };

    section('Ventes du jour',ventes.rows,['Produit','Qté','Montant','Mode','Client'],[40,200,280,360,440],(v,c,yy)=>{
      doc.fontSize(9).font('Helvetica').fillColor('#1a1a1a').text(v.produit.substring(0,18),c[0],yy).text(v.quantite.toString(),c[1],yy);
      doc.font('Helvetica-Bold').fillColor('#1D9E75').text(Number(v.montant).toLocaleString('fr-FR')+' F',c[2],yy);
      doc.font('Helvetica').fillColor('#1a1a1a').text(v.mode_paiement,c[3],yy).text(v.client||'—',c[4],yy);
    });
    section('Dettes en cours',dettes.rows,['Client','Produit','Montant','Date prévue'],[40,180,310,430],(d,c,yy)=>{
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a1a').text(d.client.substring(0,18),c[0],yy);
      doc.font('Helvetica').text(d.produit.substring(0,18),c[1],yy);
      doc.fillColor('#D85A30').text(Number(d.montant).toLocaleString('fr-FR')+' F',c[2],yy);
      doc.fillColor('#1a1a1a').text(d.date_remboursement||'—',c[3],yy);
    });
    section('Stocks critiques',stocks.rows,['Produit','Quantité','Seuil','Statut','Prix'],[40,180,260,340,430],(s,c,yy)=>{
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a1a').text(s.nom.substring(0,18),c[0],yy);
      doc.font('Helvetica').text(s.quantite.toString(),c[1],yy).text(s.seuil_alerte.toString(),c[2],yy);
      doc.fillColor(s.quantite===0?'#D85A30':'#BA7517').text(s.quantite===0?'Rupture':'Stock bas',c[3],yy);
      doc.fillColor('#1a1a1a').text(Number(s.prix_unitaire).toLocaleString('fr-FR')+' F',c[4],yy);
    });

    doc.fontSize(9).font('Helvetica').fillColor('#a0a0a0')
       .text(`BANKVI — bankvi.onrender.com — ${new Date().toLocaleString('fr-FR')}`,40,780,{align:'center'});
    doc.end();
    log('INFO','Rapport généré',{user: u.nom});

  } catch(e) {
    log('ERROR','Rapport error',{error:e.message});
    res.status(500).json({message:e.message});
  }
});

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname), { maxAge:'1h', etag:true }));

// ===== 404 =====
app.use((req,res) => {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({message:'Route non trouvée'});
  res.sendFile(path.join(__dirname,'login.html'));
});

// ===== START =====
initDb().then(() => {
  app.listen(PORT, () => log('INFO', `BANKVI démarré sur le port ${PORT}`));
}).catch(e => {
  log('ERROR','Erreur démarrage DB',{error:e.message});
  process.exit(1);
});