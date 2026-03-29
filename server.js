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
    if (!token) return res.status(401).json({ message: 'Non autorisé' });
    const userResult = await pool.query('SELECT * FROM utilisateurs WHERE token = $1', [token]);
    if (!userResult.rows.length) return res.status(401).json({ message: 'Token invalide' });
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

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport-bankvi-${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // ===== HEADER =====
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#0C447C').text('BANKVI', 40, 40);
    doc.fontSize(10).font('Helvetica').fillColor('#6b6b6b').text('Rapport journalier', 40, 68);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a1a').text(u.nom, 400, 40, { align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor('#6b6b6b').text(u.boutique, 400, 56, { align: 'right' });
    doc.fontSize(10).fillColor('#6b6b6b').text(date, 400, 72, { align: 'right' });
    doc.moveTo(40, 90).lineTo(555, 90).strokeColor('#0C447C').lineWidth(2).stroke();

    // ===== MÉTRIQUES =====
    let y = 110;
    const metriques = [
      { label: "Chiffre d'affaires", val: totalVentes.toLocaleString('fr-FR') + ' F', color: '#1D9E75' },
      { label: 'Ventes du jour', val: ventes.rows.length.toString(), color: '#185FA5' },
      { label: 'Dettes en cours', val: totalDettes.toLocaleString('fr-FR') + ' F', color: '#D85A30' },
    ];

    metriques.forEach((m, i) => {
      const x = 40 + i * 172;
      doc.roundedRect(x, y, 160, 60, 6).fillColor('#f5f5f3').fill();
      doc.fontSize(9).font('Helvetica').fillColor('#6b6b6b').text(m.label, x + 10, y + 10);
      doc.fontSize(18).font('Helvetica-Bold').fillColor(m.color).text(m.val, x + 10, y + 26);
    });

    y += 80;

    // ===== VENTES =====
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a').text(`Ventes du jour (${ventes.rows.length})`, 40, y);
    y += 20;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
    y += 8;

    if (ventes.rows.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#a0a0a0').text('Aucune vente enregistrée aujourd\'hui', 40, y);
      y += 20;
    } else {
      const colsV = [40, 200, 290, 370, 450];
      const headersV = ['Produit', 'Quantité', 'Montant', 'Mode', 'Client'];
      headersV.forEach((h, i) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b6b6b').text(h, colsV[i], y);
      });
      y += 16;

      ventes.rows.forEach((v, idx) => {
        if (idx % 2 === 0) {
          doc.roundedRect(38, y - 3, 517, 18, 2).fillColor('#f9f9f9').fill();
        }
        doc.fontSize(9).font('Helvetica').fillColor('#1a1a1a');
        doc.text(v.produit.substring(0, 20), colsV[0], y);
        doc.text(v.quantite.toString(), colsV[1], y);
        doc.font('Helvetica-Bold').fillColor('#1D9E75').text(Number(v.montant).toLocaleString('fr-FR') + ' F', colsV[2], y);
        doc.font('Helvetica').fillColor('#1a1a1a').text(v.mode_paiement, colsV[3], y);
        doc.text(v.client || '—', colsV[4], y);
        y += 18;
      });

      doc.moveTo(40, y).lineTo(555, y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
      y += 8;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a1a').text('Total', 40, y);
      doc.fillColor('#1D9E75').text(totalVentes.toLocaleString('fr-FR') + ' F', colsV[2], y);
      y += 25;
    }

    // ===== DETTES =====
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a').text(`Dettes en cours (${dettes.rows.length})`, 40, y);
    y += 20;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
    y += 8;

    if (dettes.rows.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#a0a0a0').text('Aucune dette en cours', 40, y);
      y += 20;
    } else {
      const colsD = [40, 200, 320, 440];
      const headersD = ['Client', 'Produit', 'Montant', 'Date prévue'];
      headersD.forEach((h, i) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b6b6b').text(h, colsD[i], y);
      });
      y += 16;

      dettes.rows.forEach((d, idx) => {
        if (idx % 2 === 0) {
          doc.roundedRect(38, y - 3, 517, 18, 2).fillColor('#f9f9f9').fill();
        }
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a1a').text(d.client.substring(0, 20), colsD[0], y);
        doc.font('Helvetica').text(d.produit.substring(0, 20), colsD[1], y);
        doc.fillColor('#D85A30').text(Number(d.montant).toLocaleString('fr-FR') + ' F', colsD[2], y);
        doc.fillColor('#1a1a1a').text(d.date_remboursement || '—', colsD[3], y);
        y += 18;
      });

      doc.moveTo(40, y).lineTo(555, y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
      y += 8;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a1a').text('Total dû', 40, y);
      doc.fillColor('#D85A30').text(totalDettes.toLocaleString('fr-FR') + ' F', colsD[2], y);
      y += 25;
    }

    // ===== STOCKS CRITIQUES =====
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a').text(`Stocks critiques (${stocks.rows.length})`, 40, y);
    y += 20;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
    y += 8;

    if (stocks.rows.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#a0a0a0').text('Tous les stocks sont suffisants', 40, y);
      y += 20;
    } else {
      const colsS = [40, 200, 290, 370, 450];
      const headersS = ['Produit', 'Quantité', 'Seuil', 'Statut', 'Prix'];
      headersS.forEach((h, i) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b6b6b').text(h, colsS[i], y);
      });
      y += 16;

      stocks.rows.forEach((s, idx) => {
        if (idx % 2 === 0) {
          doc.roundedRect(38, y - 3, 517, 18, 2).fillColor('#f9f9f9').fill();
        }
        const statut = s.quantite === 0 ? 'Rupture' : 'Stock bas';
        const color  = s.quantite === 0 ? '#D85A30' : '#BA7517';
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a1a').text(s.nom.substring(0, 20), colsS[0], y);
        doc.font('Helvetica').text(s.quantite.toString(), colsS[1], y);
        doc.text(s.seuil_alerte.toString(), colsS[2], y);
        doc.fillColor(color).text(statut, colsS[3], y);
        doc.fillColor('#1a1a1a').text(Number(s.prix_unitaire).toLocaleString('fr-FR') + ' F', colsS[4], y);
        y += 18;
      });
    }

    // ===== FOOTER =====
    doc.fontSize(9).font('Helvetica').fillColor('#a0a0a0')
      .text(`Rapport généré par BANKVI — bankvi.onrender.com — ${new Date().toLocaleString('fr-FR')}`, 40, 780, { align: 'center' });

    doc.end();

  } catch(e) {
    console.error('Erreur rapport:', e);
    res.status(500).json({ message: e.message });
  }
});

app.use(express.static(path.join(__dirname)));

initDb().then(() => {
  app.listen(PORT, () => console.log(`BANKVI sur http://localhost:${PORT}`));
}).catch(e => console.error('Erreur DB:', e));