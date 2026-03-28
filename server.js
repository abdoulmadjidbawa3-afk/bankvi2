const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bankvi_db_user:uF0ykwsfC5oWZX4g0Tebs9NxK3PFn4OO@dpg-d73pui1aae7s73b505a0-a/bankvi_db',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      boutique TEXT NOT NULL,
      tel TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      token TEXT
    );
    CREATE TABLE IF NOT EXISTS ventes (
      id SERIAL PRIMARY KEY,
      utilisateur_id INTEGER NOT NULL,
      produit TEXT NOT NULL,
      quantite INTEGER NOT NULL,
      montant REAL NOT NULL,
      mode_paiement TEXT NOT NULL,
      client TEXT DEFAULT '',
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dettes (
      id SERIAL PRIMARY KEY,
      utilisateur_id INTEGER NOT NULL,
      client TEXT NOT NULL,
      produit TEXT NOT NULL,
      montant REAL NOT NULL,
      date_remboursement TEXT DEFAULT '',
      statut TEXT DEFAULT 'en_cours',
      date_creation TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stocks (
      id SERIAL PRIMARY KEY,
      utilisateur_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      categorie TEXT NOT NULL,
      quantite INTEGER NOT NULL,
      seuil_alerte INTEGER DEFAULT 5,
      prix_unitaire REAL NOT NULL
    );
  `);
  console.log('Base de données PostgreSQL prête');
}

app.use(cors());
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));

async function auth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'Non autorisé' });
  const result = await pool.query('SELECT * FROM utilisateurs WHERE token = $1', [token]);
  if (!result.rows.length) return res.status(401).json({ message: 'Token invalide' });
  req.user = result.rows[0];
  next();
}

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { nom, boutique, tel, password } = req.body;
    if (!nom || !boutique || !tel || !password)
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });
    const existe = await pool.query('SELECT id FROM utilisateurs WHERE tel = $1', [tel]);
    if (existe.rows.length) return res.status(400).json({ message: 'Ce numéro est déjà utilisé' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await pool.query('INSERT INTO utilisateurs (nom, boutique, tel, password) VALUES ($1, $2, $3, $4)', [nom, boutique, tel, hash]);
    res.json({ message: 'Compte créé' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { tel, password } = req.body;
    if (!tel || !password)
      return res.status(400).json({ message: 'Tous les champs sont obligatoires' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const result = await pool.query('SELECT * FROM utilisateurs WHERE tel = $1 AND password = $2', [tel, hash]);
    if (!result.rows.length) return res.status(401).json({ message: 'Numéro ou mot de passe incorrect' });
    const u = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE utilisateurs SET token = $1 WHERE id = $2', [token, u.id]);
    res.json({ token, user: { id: u.id, nom: u.nom, boutique: u.boutique } });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// VENTES
app.get('/api/ventes', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ventes WHERE utilisateur_id = $1 ORDER BY date DESC', [req.user.id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/ventes', auth, async (req, res) => {
  try {
    const { produit, quantite, montant, mode_paiement, client } = req.body;
    if (!produit || !quantite || !montant || !mode_paiement)
      return res.status(400).json({ message: 'Champs manquants' });
    await pool.query(
      'INSERT INTO ventes (utilisateur_id, produit, quantite, montant, mode_paiement, client, date) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [req.user.id, produit, quantite, montant, mode_paiement, client || '']
    );
    res.json({ message: 'Vente enregistrée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// DETTES
app.get('/api/dettes', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dettes WHERE utilisateur_id = $1 ORDER BY date_creation DESC', [req.user.id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/dettes', auth, async (req, res) => {
  try {
    const { client, produit, montant, date_remboursement } = req.body;
    if (!client || !produit || !montant)
      return res.status(400).json({ message: 'Champs manquants' });
    await pool.query(
      'INSERT INTO dettes (utilisateur_id, client, produit, montant, date_remboursement, statut, date_creation) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [req.user.id, client, produit, montant, date_remboursement || '', 'en_cours']
    );
    res.json({ message: 'Dette enregistrée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/dettes/:id/payer', auth, async (req, res) => {
  try {
    await pool.query('UPDATE dettes SET statut = $1 WHERE id = $2 AND utilisateur_id = $3', ['payee', req.params.id, req.user.id]);
    res.json({ message: 'Dette payée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/dettes/:id', auth, async (req, res) => {
  try {
    const { client, produit, montant, date_remboursement } = req.body;
    await pool.query(
      'UPDATE dettes SET client=$1, produit=$2, montant=$3, date_remboursement=$4 WHERE id=$5 AND utilisateur_id=$6',
      [client, produit, montant, date_remboursement || '', req.params.id, req.user.id]
    );
    res.json({ message: 'Dette modifiée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/dettes/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM dettes WHERE id=$1 AND utilisateur_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Dette supprimée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// STOCKS
app.get('/api/stocks', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stocks WHERE utilisateur_id = $1 ORDER BY nom ASC', [req.user.id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/stocks', auth, async (req, res) => {
  try {
    const { nom, categorie, quantite, seuil_alerte, prix_unitaire } = req.body;
    if (!nom || !quantite || !prix_unitaire)
      return res.status(400).json({ message: 'Champs manquants' });
    await pool.query(
      'INSERT INTO stocks (utilisateur_id, nom, categorie, quantite, seuil_alerte, prix_unitaire) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, nom, categorie || 'Autre', quantite, seuil_alerte || 5, prix_unitaire]
    );
    res.json({ message: 'Produit ajouté' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/stocks/:id', auth, async (req, res) => {
  try {
    const { nom, categorie, quantite, seuil_alerte, prix_unitaire } = req.body;
    await pool.query(
      'UPDATE stocks SET nom=$1, categorie=$2, quantite=$3, seuil_alerte=$4, prix_unitaire=$5 WHERE id=$6 AND utilisateur_id=$7',
      [nom, categorie, quantite, seuil_alerte || 5, prix_unitaire, req.params.id, req.user.id]
    );
    res.json({ message: 'Stock modifié' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/stocks/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM stocks WHERE id=$1 AND utilisateur_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Stock supprimé' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// DASHBOARD
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const uid = req.user.id;
    const ventes = await pool.query(
      "SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count FROM ventes WHERE utilisateur_id = $1 AND date::date = CURRENT_DATE",
      [uid]
    );
    const dettes = await pool.query(
      "SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as count FROM dettes WHERE utilisateur_id = $1 AND statut = 'en_cours'",
      [uid]
    );
    const stocks = await pool.query(
      "SELECT COUNT(*) as count FROM stocks WHERE utilisateur_id = $1 AND quantite <= seuil_alerte",
      [uid]
    );
    res.json({
      ventes_jour:     Number(ventes.rows[0].total),
      ventes_count:    Number(ventes.rows[0].count),
      dettes_total:    Number(dettes.rows[0].total),
      dettes_count:    Number(dettes.rows[0].count),
      stocks_critique: Number(stocks.rows[0].count)
    });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.use(express.static(path.join(__dirname)));
app.get('/api/reset-db-bankvi-2026', async (req, res) => {
  try {
    await pool.query('DELETE FROM ventes');
    await pool.query('DELETE FROM dettes');
    await pool.query('DELETE FROM stocks');
    await pool.query('DELETE FROM utilisateurs');
    res.json({ message: 'Base de données vidée' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});
initDb().then(() => {
app.listen(PORT, () => console.log(`BANKVI sur http://localhost:${PORT}`));
}).catch(e => console.error('Erreur DB:', e));