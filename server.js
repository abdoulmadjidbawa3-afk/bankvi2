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

    const stock = await pool.query(
      'SELECT * FROM stocks WHERE utilisateur_id = $1 AND LOWER(nom) LIKE LOWER($2)',
      [req.user.id, `%${produit.split(' ')[0]}%`]
    );

    if (stock.rows.length > 0) {
      const s = stock.rows[0];
      const nouvelleQte = Math.max(0, s.quantite - Number(quantite));
      await pool.query('UPDATE stocks SET quantite = $1 WHERE id = $2', [nouvelleQte, s.id]);
    }

    res.json({ message: 'Vente enregistrée', stock_mis_a_jour: stock.rows.length > 0 });
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

app.get('/api/dettes/retard', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM dettes
      WHERE utilisateur_id = $1
      AND statut = 'en_cours'
      AND date_remboursement != ''
      AND date_remboursement < CURRENT_DATE::text
      ORDER BY date_remboursement ASC
    `, [req.user.id]);
    res.json(result.rows);
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

// RAPPORT PDF
app.get('/api/rapport', async (req, res) => {
  try {
    const token = req.headers['authorization'] || req.query.token;
    if (!token) return res.status(401).send('Non autorisé');
    const userResult = await pool.query('SELECT * FROM utilisateurs WHERE token = $1', [token]);
    if (!userResult.rows.length) return res.status(401).send('Token invalide');
    const u = userResult.rows[0];

    const ventes = await pool.query(
      "SELECT * FROM ventes WHERE utilisateur_id = $1 AND date::date = CURRENT_DATE ORDER BY date DESC",
      [u.id]
    );
    const dettes = await pool.query(
      "SELECT * FROM dettes WHERE utilisateur_id = $1 AND statut = 'en_cours' ORDER BY date_creation DESC",
      [u.id]
    );
    const stocks = await pool.query(
      "SELECT * FROM stocks WHERE utilisateur_id = $1 AND quantite <= seuil_alerte ORDER BY quantite ASC",
      [u.id]
    );

    const totalVentes = ventes.rows.reduce((s, v) => s + Number(v.montant), 0);
    const totalDettes = dettes.rows.reduce((s, d) => s + Number(d.montant), 0);
    const date = new Date().toLocaleDateString('fr-FR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport BANKVI — ${date}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; color: #1a1a1a; padding: 2rem; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2rem; padding-bottom:1rem; border-bottom:2px solid #0C447C; }
  .logo { font-size:28px; font-weight:700; color:#0C447C; letter-spacing:-1px; }
  .logo span { color:#185FA5; }
  .header-info { text-align:right; font-size:13px; color:#6b6b6b; }
  .header-info strong { display:block; color:#1a1a1a; font-size:15px; }
  .metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-bottom:1.5rem; }
  .metric { background:#f5f5f3; border-radius:8px; padding:1rem; }
  .metric-label { font-size:11px; color:#6b6b6b; margin-bottom:4px; }
  .metric-val { font-size:22px; font-weight:700; }
  .metric-val.red { color:#D85A30; }
  .metric-val.green { color:#1D9E75; }
  .section { margin-bottom:1.5rem; }
  .section-title { font-size:13px; font-weight:700; color:#6b6b6b; text-transform:uppercase; letter-spacing:1px; margin-bottom:0.75rem; padding-bottom:6px; border-bottom:0.5px solid #e8e8e8; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { background:#f5f5f3; padding:8px 10px; text-align:left; font-size:11px; color:#6b6b6b; text-transform:uppercase; }
  td { padding:8px 10px; border-bottom:0.5px solid #e8e8e8; }
  .total-row td { background:#f5f5f3; font-weight:700; }
  .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:500; }
  .cash { background:#E1F5EE; color:#0F6E56; }
  .credit { background:#FAECE7; color:#993C1D; }
  .partial { background:#FAEEDA; color:#854F0B; }
  .out { background:#FAECE7; color:#993C1D; }
  .low { background:#FAEEDA; color:#854F0B; }
  .empty { color:#a0a0a0; font-style:italic; font-size:13px; padding:0.5rem 0; }
  .footer { margin-top:2rem; padding-top:1rem; border-top:0.5px solid #e8e8e8; text-align:center; font-size:11px; color:#a0a0a0; }
  @media print { body { padding:1rem; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">BANK<span>VI</span></div>
    <div style="font-size:13px;color:#6b6b6b;margin-top:4px;">Rapport journalier</div>
  </div>
  <div class="header-info">
    <strong>${u.nom}</strong>
    ${u.boutique}<br>${date}
  </div>
</div>
<div class="metrics">
  <div class="metric"><div class="metric-label">Chiffre d'affaires</div><div class="metric-val green">${totalVentes.toLocaleString('fr-FR')} F</div></div>
  <div class="metric"><div class="metric-label">Ventes du jour</div><div class="metric-val">${ventes.rows.length}</div></div>
  <div class="metric"><div class="metric-label">Dettes en cours</div><div class="metric-val red">${totalDettes.toLocaleString('fr-FR')} F</div></div>
</div>
<div class="section">
  <div class="section-title">Ventes du jour (${ventes.rows.length})</div>
  ${ventes.rows.length === 0 ? '<p class="empty">Aucune vente enregistrée aujourd\'hui</p>' : `
  <table>
    <thead><tr><th>Produit</th><th>Qté</th><th>Montant</th><th>Mode</th><th>Client</th></tr></thead>
    <tbody>
      ${ventes.rows.map(v => `<tr><td>${v.produit}</td><td>${v.quantite}</td><td><strong>${Number(v.montant).toLocaleString('fr-FR')} F</strong></td><td><span class="badge ${v.mode_paiement === 'Cash' ? 'cash' : v.mode_paiement === 'À crédit' ? 'credit' : 'partial'}">${v.mode_paiement}</span></td><td>${v.client || '—'}</td></tr>`).join('')}
      <tr class="total-row"><td colspan="2">Total</td><td colspan="3">${totalVentes.toLocaleString('fr-FR')} F</td></tr>
    </tbody>
  </table>`}
</div>
<div class="section">
  <div class="section-title">Dettes en cours (${dettes.rows.length})</div>
  ${dettes.rows.length === 0 ? '<p class="empty">Aucune dette en cours</p>' : `
  <table>
    <thead><tr><th>Client</th><th>Produit</th><th>Montant</th><th>Date prévue</th></tr></thead>
    <tbody>
      ${dettes.rows.map(d => `<tr><td><strong>${d.client}</strong></td><td>${d.produit}</td><td style="color:#D85A30;font-weight:700;">${Number(d.montant).toLocaleString('fr-FR')} F</td><td>${d.date_remboursement || '—'}</td></tr>`).join('')}
      <tr class="total-row"><td colspan="2">Total dû</td><td colspan="2" style="color:#D85A30;">${totalDettes.toLocaleString('fr-FR')} F</td></tr>
    </tbody>
  </table>`}
</div>
<div class="section">
  <div class="section-title">Stocks critiques (${stocks.rows.length})</div>
  ${stocks.rows.length === 0 ? '<p class="empty">Tous les stocks sont suffisants</p>' : `
  <table>
    <thead><tr><th>Produit</th><th>Quantité</th><th>Seuil</th><th>Statut</th><th>Prix unitaire</th></tr></thead>
    <tbody>
      ${stocks.rows.map(s => `<tr><td><strong>${s.nom}</strong></td><td>${s.quantite}</td><td>${s.seuil_alerte}</td><td><span class="badge ${s.quantite === 0 ? 'out' : 'low'}">${s.quantite === 0 ? 'Rupture' : 'Stock bas'}</span></td><td>${Number(s.prix_unitaire).toLocaleString('fr-FR')} F</td></tr>`).join('')}
    </tbody>
  </table>`}
</div>
<div class="footer">Rapport généré par BANKVI — bankvi.onrender.com — ${new Date().toLocaleString('fr-FR')}</div>
<script>window.print();</script>
</body>
</html>`;

    res.send(html);
  } catch(e) { res.status(500).send('Erreur: ' + e.message); }
});

app.use(express.static(path.join(__dirname)));

initDb().then(() => {
  app.listen(PORT, () => console.log(`BANKVI sur http://localhost:${PORT}`));
}).catch(e => console.error('Erreur DB:', e));