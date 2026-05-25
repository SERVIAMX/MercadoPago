/**
 * Crea dos usuarios de prueba en Mercado Pago:
 *  - Vendedor (seller): sus credenciales TEST- van en el .env del backend
 *  - Comprador (buyer): su email va como payer.email al hacer pagos de prueba
 *
 * Ejecutar: node scripts/crear-usuarios-prueba.js
 */

const ACCESS_TOKEN = 'APP_USR-7480078197051075-051916-fa5b73a9b65b9bc9e086fa05cda0b61e-3414342728';

async function crearUsuario(tipo) {
  const res = await fetch('https://api.mercadopago.com/users/test', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site_id: 'MLM' }), // MLM = México
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Error creando usuario ${tipo}:`, JSON.stringify(data, null, 2));
    return null;
  }

  console.log(`\n✅ Usuario de prueba creado (${tipo}):`);
  console.log(`   ID:           ${data.id}`);
  console.log(`   Nickname:     ${data.nickname}`);
  console.log(`   Email:        ${data.email}`);
  console.log(`   Password:     ${data.password}`);
  return data;
}

(async () => {
  console.log('Creando usuarios de prueba en Mercado Pago (México)...\n');

  const seller = await crearUsuario('VENDEDOR');
  const buyer  = await crearUsuario('COMPRADOR');

  if (!seller || !buyer) {
    console.log('\n⚠️  Revisa el error de arriba.');
    return;
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log('PRÓXIMOS PASOS:');
  console.log('──────────────────────────────────────────────────');
  console.log(`
1. Entra a mercadopago.com.mx con las credenciales del VENDEDOR:
   Email:    ${seller.email}
   Password: ${seller.password}

2. Ve a: mercadopago.com.mx/developers/panel
   → Crea una nueva aplicación (o entra a la existente)
   → En "Credenciales de prueba" copia el Public Key y Access Token (empiezan con TEST-)

3. Actualiza tu .env con las credenciales TEST- del vendedor:
   MP_PUBLIC_KEY=TEST-xxxx...
   MP_ACCESS_TOKEN=TEST-xxxx...

4. Actualiza checkout.html con la Public Key TEST- del vendedor.

5. Para hacer pagos de prueba usa el email del COMPRADOR como payer.email:
   ${buyer.email}
   Password: ${buyer.password}
`);
})();
