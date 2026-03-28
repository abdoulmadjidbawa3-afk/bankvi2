const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'bankvi.db');

let db;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL, boutique TEXT NOT NULL,
      tel TEXT UNIQUE NOT NULL, password TEXT NOT NULL, token TEXT
    );
    CREATE TABLE IF NOT EXISTS ventes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utilisateur_id INTEGER NOT NULL, produit TEXT NOT NULL,
      quantite INTEGER NOT NULL, montant REAL NOT NULL,
      mode_paiement TEXT NOT NULL, client TEXT DEFAULT '',
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dettes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utilisateur_id INTEGER NOT NULL, client TEXT NOT NULL,
      produit TEXT NOT NULL, montant REAL NOT NULL,
      date_remboursement TEXT DEFAULT '', statut TEXT DEFAULT 'en_cours',
      date_creation TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utilisateur_id INTEGER NOT NULL, nom TEXT NOT NULL,
      categorie TEXT NOT NULL, quantite INTEGER NOT NULL,
      seuil_alerte INTEGER DEFAULT 5, prix_unitaire REAL NOT NULL
    );
  `);
  save();
  console.log('Base de données prête');
}

function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

app.use(cors());
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

// Auth middleware
function auth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'Non autorisé' });
  const rows = query('SELECT * FROM utilisateurs WHERE token = ?', [token]);
  if (!rows.length) return res.status(401).json({ message: 'Token invalide' });
  req.user = rows[0];
  next();
}

// REGISTER
app.post('/api/register', (req, res) => {
  try {
    const { nom, boutique, tel, password } = req.body;
    if (!nom || !boutique || !tel || !password)
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });
    const existe = query('SELECT id FROM utilisateurs WHERE tel = ?', [tel]);
    if (existe.length) return res.status(400).json({ message: 'Ce numéro est déjà utilisé' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    run('INSERT INTO utilisateurs (nom, boutique, tel, password) VALUES (?, ?, ?, ?)', [nom, boutique, tel, hash]);
    res.json({ message: 'Compte créé' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// LOGIN
app.post('/api/login', (req, res) => {
  try {
    const { tel, password } = req.body;
    if (!tel || !password)
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const rows = query('SELECT * FROM utilisateurs WHERE tel = ? AND password = ?', [tel, hash]);
    if (!rows.length) return res.status(401).json({ message: 'Numéro ou mot de passe incorrect' });
    const u = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    run('UPDATE utilisateurs SET token = ? WHERE id = ?', [token, u.id]);
    res.json({ token, user: { id: u.id, nom: u.nom, boutique: u.boutique } });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// VENTES
app.get('/api/ventes', auth, (req, res) => {
  try {
    const ventes = query('SELECT * FROM ventes WHERE utilisateur_id = ? ORDER BY date DESC', [req.user.id]);
    res.json(ventes);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/ventes', auth, (req, res) => {
  try {
    const { produit, quantite, montant, mode_paiement, client } = req.body;
    if (!produit || !quantite || !montant || !mode_paiement)
      return res.status(400).json({ message: 'Champs manquants' });
    run('INSERT INTO ventes (utilisateur_id, produit, quantite, montant, mode_paiement, client, date) VALUES (?, ?, ?, ?, ?, ?, datetime("now","localtime"))',
      [req.user.id, produit, quantite, montant, mode_paiement, client || '']);
    res.json({ message: 'Vente enregistrée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// DETTES
app.get('/api/dettes', auth, (req, res) => {
  try {
    const dettes = query('SELECT * FROM dettes WHERE utilisateur_id = ? ORDER BY date_creation DESC', [req.user.id]);
    res.json(dettes);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/dettes', auth, (req, res) => {
  try {
    const { client, produit, montant, date_remboursement } = req.body;
    if (!client || !produit || !montant)
      return res.status(400).json({ message: 'Champs manquants' });
    run('INSERT INTO dettes (utilisateur_id, client, produit, montant, date_remboursement, statut, date_creation) VALUES (?, ?, ?, ?, ?, "en_cours", datetime("now","localtime"))',
      [req.user.id, client, produit, montant, date_remboursement || '']);
    res.json({ message: 'Dette enregistrée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/dettes/:id/payer', auth, (req, res) => {
  try {
    run('UPDATE dettes SET statut = "payee" WHERE id = ? AND utilisateur_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Dette payée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// STOCKS
app.get('/api/stocks', auth, (req, res) => {
  try {
    const stocks = query('SELECT * FROM stocks WHERE utilisateur_id = ? ORDER BY nom ASC', [req.user.id]);
    res.json(stocks);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/stocks', auth, (req, res) => {
  try {
    const { nom, categorie, quantite, seuil_alerte, prix_unitaire } = req.body;
    if (!nom || !quantite || !prix_unitaire)
      return res.status(400).json({ message: 'Champs manquants' });
    run('INSERT INTO stocks (utilisateur_id, nom, categorie, quantite, seuil_alerte, prix_unitaire) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, nom, categorie || 'Autre', quantite, seuil_alerte || 5, prix_unitaire]);
    res.json({ message: 'Produit ajouté' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// DASHBOARD
app.get('/api/dashboard', auth, (req, res) => {
  try {
    const uid = req.user.id;
    const ventes = query('SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count FROM ventes WHERE utilisateur_id = ? AND date(date) = date("now","localtime")', [uid]);
    const dettes = query('SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count FROM dettes WHERE utilisateur_id = ? AND statut = "en_cours"', [uid]);
    const stocks = query('SELECT COUNT(*) as count FROM stocks WHERE utilisateur_id = ? AND quantite <= seuil_alerte', [uid]);
    res.json({
      ventes_jour:     ventes[0].total,
      ventes_count:    ventes[0].count,
      dettes_total:    dettes[0].total,
      dettes_count:    dettes[0].count,
      stocks_critique: stocks[0].count
    });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.use(express.static(path.join(__dirname)));

initDb().then(() => {
  app.listen(PORT, () => console.log(`BANKVI sur http://localhost:${PORT}`));
});