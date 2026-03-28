let toutesLesDettes = [];

function filtrerDettes(filtre, el) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const filtrees = filtre === 'toutes' ? toutesLesDettes : toutesLesDettes.filter(d => d.statut === filtre);
  afficherDettes(filtrees);
}

function afficherDettes(dettes) {
  const liste = document.getElementById('liste-dettes');
  if (!liste) return;
  if (dettes.length === 0) {
    liste.innerHTML = '<p style="padding:1.5rem;text-align:center;color:#a0a0a0;">Aucune dette</p>';
    return;
  }
  liste.innerHTML = dettes.map(d => `
    <div class="list-card ${d.statut === 'en_cours' ? 'urgent' : ''}" id="dette-${d.id}">
      <div class="lc-left">
        <div class="lc-avatar ${d.statut === 'payee' ? 'green' : 'red'}">${d.client.substring(0,2).toUpperCase()}</div>
        <div>
          <p class="lc-name">${d.client}</p>
          <p class="lc-sub">${d.produit}</p>
        </div>
      </div>
      <div class="lc-right">
        <p class="lc-amount ${d.statut === 'payee' ? 'green' : 'red'}">${fmt(d.montant)}</p>
        <p class="lc-days">${new Date(d.date_creation).toLocaleDateString('fr-FR')}</p>
      </div>
    </div>
    ${d.statut === 'en_cours' ? `
    <div class="list-card-actions">
      <button class="btn-success-sm" onclick="marquerPaye(${d.id})">Marquer payé</button>
      <button class="btn-neutral-sm">Rappel envoyé</button>
    </div>` : ''}`).join('');
}

async function chargerDettes() {
  try {
    const res = await fetch(`${API}/dettes`, { headers: getHeaders() });
    toutesLesDettes = await res.json();
    const enCours = toutesLesDettes.filter(d => d.statut === 'en_cours');
    const total   = enCours.reduce((s,d) => s + d.montant, 0);
    document.getElementById('hero-amount').textContent = fmt(total);
    document.getElementById('hero-sub').textContent    = enCours.length + ' clients concernés';
    afficherDettes(toutesLesDettes);
  } catch(e) { console.log('Erreur dettes', e); }
}

async function enregistrerDette() {
  const client  = document.getElementById('dette-client').value.trim();
  const produit = document.getElementById('dette-produit').value.trim();
  const montant = document.getElementById('dette-montant').value;
  const date    = document.getElementById('dette-date').value;

  if (!client || !produit || !montant) { alert('Remplis les champs obligatoires'); return; }

  try {
    const res = await fetch(`${API}/dettes`, {
      method: 'POST', headers: getHeaders(),
      body: JSON.stringify({ client, produit, montant: Number(montant), date_remboursement: date })
    });
    if (!res.ok) { const e = await res.json(); alert(e.message); return; }
    document.getElementById('dette-client').value  = '';
    document.getElementById('dette-produit').value = '';
    document.getElementById('dette-montant').value = '';
    document.getElementById('dette-date').value    = '';
    document.getElementById('modal-dette').classList.remove('open');
    chargerDettes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

async function marquerPaye(id) {
  try {
    await fetch(`${API}/dettes/${id}/payer`, { method: 'PUT', headers: getHeaders() });
    chargerDettes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

document.getElementById('btn-save-dette').addEventListener('click', enregistrerDette);
chargerDettes();