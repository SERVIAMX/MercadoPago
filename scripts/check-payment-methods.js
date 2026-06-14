// Lista los medios de pago habilitados para la cuenta y resalta SPEI (bank_transfer).
// Uso: node scripts/check-payment-methods.js
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const tokenLine = lines.find(l => /^\s*MP_ACCESS_TOKEN\s*=/.test(l));
const token = tokenLine ? tokenLine.split('=').slice(1).join('=').trim() : null;

if (!token) { console.error('No hay MP_ACCESS_TOKEN activo en .env'); process.exit(1); }
console.log(`Cuenta: ${token.split('-').pop()} | App: ${token.split('-')[1]}`);
console.log('---');

(async () => {
  const res = await fetch('https://api.mercadopago.com/v1/payment_methods', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`HTTP ${res.status}`);
  const methods = await res.json();
  if (!Array.isArray(methods)) { console.log(JSON.stringify(methods, null, 2)); return; }

  // Agrupa por tipo
  const byType = {};
  for (const m of methods) {
    (byType[m.payment_type_id] ??= []).push(`${m.id} [${m.status}]`);
  }
  for (const [type, ids] of Object.entries(byType)) {
    console.log(`\n${type}:`);
    console.log('  ' + ids.join(', '));
  }

  console.log('\n=== SPEI / transferencias ===');
  const transfer = methods.filter(m =>
    m.payment_type_id === 'bank_transfer' || /clabe|spei|pix/i.test(m.id));
  if (transfer.length === 0) {
    console.log('❌ NO aparece ningún medio de transferencia. SPEI NO está habilitado en esta cuenta.');
  } else {
    transfer.forEach(m => console.log(`  ${m.id} — status: ${m.status} — ${m.name}`));
  }
})().catch(e => console.error('Fallo:', e));
