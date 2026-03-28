function selectMode(el) {
  document.querySelectorAll('.pay-mode').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
}

function switchTab(el, periode) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  chargerVentes(periode);
}

function getBadgeMode(mode) {
  if (mode === 'Cash') return 'cash';
  if (mode === 'À crédit') return 'credit';
  return 'partial';
}

async function chargerVentes(periode = 'jour') {
  const liste = document.getElementById('liste-ventes');
  if (!liste) return;
  try {
    const res    = await fetch(`${API}/ventes`, { headers: getHeaders() });
    const ventes = await res.json();

    const now = new Date();
    const filtrees = ventes.filter(v => {
      const d = new Date(v.date);
      if (periode === 'jour')    return d.toDateString() === now.toDateString();
      if (periode === 'semaine') { const diff = (now - d) / 86400000; return diff <= 7; }
      if (periode === 'mois')    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return true;
    });

    const total = filtrees.reduce((s, v) => s + v.montant, 0);
    const cash  = filtrees.filter(v => v.mode_paiement === 'Cash').reduce((s,v) => s + v.montant, 0);
    const credit = filtrees.filter(v => v.mode_paiement === 'À crédit').reduce((s,v) => s + v.montant, 0);

    document.getElementById('hero-amount').textContent = fmt(total);
    document.getElementById('hero-sub').textContent    = filtrees.length + ' ventes enregistrées';
    document.getElementById('stat-cash').textContent   = fmt(cash);
    document.getElementById('stat-credit').textContent = fmt(credit);

    if (filtrees.length === 0) {
      liste.innerHTML = '<p style="padding:1.5rem;text-align:center;color:#a0a0a0;">Aucune vente pour cette période</p>';
      return;
    }
    liste.innerHTML = filtrees.map(v => `
      <div class="list-card">
        <div class="lc-left">
          <div class="lc-avatar green">V</div>
          <div>
            <p class="lc-name">${v.produit}</p>
            <p class="lc-sub">Qté: ${v.quantite} — ${new Date(v.date).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</p>
          </div>
        </div>
        <div class="lc-right">
          <p class="lc-amount green">+${fmt(v.montant)}</p>
          <span class="badge-mode ${getBadgeMode(v.mode_paiement)}">${v.mode_paiement}</span>
        </div>
      </div>`).join('');
  } catch(e) { console.log('Erreur ventes', e); }
}

async function enregistrerVente() {
  const produit  = document.getElementById('vente-produit').value.trim();
  const quantite = document.getElementById('vente-quantite').value;
  const montant  = document.getElementById('vente-montant').value;
  const mode     = document.querySelector('.pay-mode.active')?.textContent.trim() || 'Cash';
  const client   = document.getElementById('vente-client').value.trim();

  if (!produit || !quantite || !montant) { alert('Remplis les champs obligatoires'); return; }

  try {
    const res = await fetch(`${API}/ventes`, {
      method: 'POST', headers: getHeaders(),
      body: JSON.stringify({ produit, quantite: Number(quantite), montant: Number(montant), mode_paiement: mode, client })
    });
    if (!res.ok) { const e = await res.json(); alert(e.message); return; }

    if (mode === 'À crédit' && client) {
      await fetch(`${API}/dettes`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ client, produit, montant: Number(montant), date_remboursement: '' })
      });
    }
    document.getElementById('vente-produit').value  = '';
    document.getElementById('vente-quantite').value = '';
    document.getElementById('vente-montant').value  = '';
    document.getElementById('vente-client').value   = '';
    document.getElementById('modal-vente').classList.remove('open');
    chargerVentes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

document.getElementById('btn-save-vente').addEventListener('click', enregistrerVente);
chargerVentes();