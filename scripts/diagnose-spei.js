// Diagnóstico SPEI — llama directo a la Orders API de MP y muestra el error crudo.
// Uso: node scripts/diagnose-spei.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Lee el primer MP_ACCESS_TOKEN NO comentado del .env
const envPath = path.join(__dirname, '..', '.env');
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const tokenLine = lines.find(l => /^\s*MP_ACCESS_TOKEN\s*=/.test(l));
const token = tokenLine ? tokenLine.split('=').slice(1).join('=').trim() : null;

if (!token) {
  console.error('No se encontró MP_ACCESS_TOKEN activo en .env');
  process.exit(1);
}

// Muestra solo prefijo/sufijo para identificar la cuenta sin exponer el token
const masked = `${token.slice(0, 18)}...${token.slice(-12)}`;
console.log(`Token activo: ${masked}`);
console.log(`App / cuenta: ${token.split('-')[1]} / ${token.split('-').pop()}`);
console.log('---');

const body = {
  type: 'online',
  processing_mode: 'automatic',
  marketplace: 'NONE',
  total_amount: '1.00',
  external_reference: `diag-spei-${Date.now()}`,
  payer: { email: 'luisnm93@gmail.com', first_name: 'Comprador' },
  transactions: {
    payments: [{
      amount: '1.00',
      payment_method: { id: 'clabe', type: 'bank_transfer' },
    }],
  },
};

(async () => {
  const res = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(`x-request-id: ${res.headers.get('x-request-id')}`);
  console.log('--- respuesta cruda de MP ---');
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
})().catch(e => console.error('Fallo de red:', e));
