// Muestra los últimos pagos registrados en la DB. Uso: node scripts/check-db.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}

(async () => {
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USERNAME,
    password: env.DB_PASSWORD, database: env.DB_NAME, timezone: env.DB_TIMEZONE,
  });
  const [rows] = await conn.execute(
    `SELECT Id, OrderId, PaymentId, Status, PaymentStatus, PaymentStatusDetail,
            TotalAmount, ExternalReference, Referencia, ClientId, FhRegistro, FhActualizacion
     FROM Payments ORDER BY FhRegistro DESC LIMIT 8`,
  );
  console.log(`Últimos ${rows.length} registros en Payments:\n`);
  for (const r of rows) {
    console.log(`#${r.Id} | ${r.FhActualizacion?.toISOString?.() ?? r.FhRegistro}`);
    console.log(`   OrderId: ${r.OrderId} | PaymentId: ${r.PaymentId}`);
    console.log(`   Status: ${r.Status} | PaymentStatus: ${r.PaymentStatus} (${r.PaymentStatusDetail})`);
    console.log(`   Monto: ${r.TotalAmount} | ExtRef: ${r.ExternalReference} | Ref: ${r.Referencia} | Cliente: ${r.ClientId}`);
    console.log('');
  }
  await conn.end();
})().catch(e => console.error('Error DB:', e.message));
