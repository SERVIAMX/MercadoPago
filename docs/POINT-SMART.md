# Point Smart — Guía paso a paso

Cómo cobrar con tu terminal **Point Smart** de Mercado Pago desde esta API.

> **Resumen del flujo:** tu backend crea una *intención de pago* → la terminal
> despierta y pide la tarjeta → el cliente paga físicamente → Mercado Pago avisa
> por **webhook** con el pago real → tu sistema lo marca como pagado.

```
┌──────────┐   POST /payments/point    ┌───────────────┐
│ Tu app   │ ────────────────────────► │ Mercado Pago  │
│ (backend)│                           │ Point API     │
└──────────┘                           └──────┬────────┘
     ▲                                        │ despierta
     │                                        ▼
     │                                 ┌───────────────┐
     │   POST /payments/webhook-point  │ Point Smart   │  ← cliente
     │ ◄────────────────────────────── │ (terminal)    │     paga aquí
     │        (pago confirmado)        └───────────────┘
```

---

## Requisitos previos (una sola vez)

| # | Qué | Dónde |
|---|-----|-------|
| 1 | Tener el **Point Smart** encendido y con internet (WiFi o datos) | Físico |
| 2 | Credenciales de **producción** (`APP_USR-...`) en `MP_ACCESS_TOKEN` | `.env` |
| 3 | La cuenta de MP debe tener **Point habilitado** | Panel MP |
| 4 | Un dominio público con **HTTPS** para recibir el webhook | Tu servidor |

> ⚠️ Point Smart **no tiene sandbox**. Todo se prueba con la terminal física y
> credenciales de producción. Empieza con un monto pequeño (ej. $1.00).

---

## Paso 1 — Obtener el `device_id` de tu terminal

Llama a este endpoint de tu propia API:

```http
GET /payments/point/devices
```

Respuesta:

```json
[
  {
    "id": "GERTEC_MP35P__8701123456789",
    "pos_id": 12345,
    "store_id": "67890",
    "external_pos_id": "SUC001POS001",
    "operating_mode": "STANDALONE"
  }
]
```

👉 Copia el campo **`id`** (ej. `GERTEC_MP35P__8701123456789`). Ese es tu `device_id`.

> Si la lista llega vacía: la terminal no está vinculada a esta cuenta o está
> apagada. Revísala en la **app de Mercado Pago → Point → tus dispositivos**.

---

## Paso 2 — Poner la terminal en modo PDV (integrado)

Para que la terminal acepte cobros por API debe estar en modo **`PDV`**
(no `STANDALONE`). Se hace una sola vez:

```http
PATCH /payments/point/devices/GERTEC_MP35P__8701123456789/mode
Content-Type: application/json

{ "mode": "PDV" }
```

Respuesta:

```json
{ "device_id": "GERTEC_MP35P__8701123456789", "operating_mode": "PDV" }
```

> La terminal mostrará en pantalla que está en modo integrado / "esperando
> operaciones". Si la pones de nuevo en `STANDALONE` vuelve al cobro manual.

---

## Paso 3 — Guardar el `device_id` en el `.env`

Así no tienes que enviarlo en cada cobro:

```env
## Point Smart (terminal física)
MP_POINT_DEVICE_ID=GERTEC_MP35P__8701123456789
```

Reinicia el servidor para que tome el cambio (`npm run start:dev`).

---

## Paso 4 — Configurar el webhook en el panel de Mercado Pago

Aquí es donde Mercado Pago te avisará que el cliente ya pagó.

1. Entra a **[Tus integraciones](https://www.mercadopago.com.mx/developers/panel/app)** → tu aplicación.
2. Menú **Webhooks** → **Configurar notificaciones**.
3. En **URL de producción** pon:
   ```
   https://TU-DOMINIO.com/payments/webhook-point
   ```
4. En **Eventos**, marca **Integraciones de Point** (topic `point_integration_wh`).
5. Guarda.

> El webhook **debe ser HTTPS y público**. Para probar en local usa
> [ngrok](https://ngrok.com): `ngrok http 3000` y usa la URL `https://xxxx.ngrok.io/payments/webhook-point`.

---

## Paso 5 — Cobrar 🎉

Cuando quieras cobrar, llama:

```http
POST /payments/point
Content-Type: application/json

{
  "transaction_amount": 150.50,
  "description": "Pago de servicio Servia",
  "client_id": "456",
  "external_reference": "orden-123",
  "print_on_terminal": true
}
```

| Campo | Obligatorio | Notas |
|-------|:-----------:|-------|
| `transaction_amount` | ✅ | En pesos con decimales (`150.50`). La API lo convierte a centavos. |
| `device_id` | ❌ | Si lo omites usa `MP_POINT_DEVICE_ID`. |
| `description` | ❌ | Texto en el ticket. |
| `client_id` | ❌ | Tu ID interno de cliente (se reenvía a Servia). |
| `external_reference` | ❌ | Tu ID de orden. Si lo omites se genera con timestamp. |
| `print_on_terminal` | ❌ | `true` imprime ticket en la terminal. |
| `installments` | ❌ | Mensualidades (cuotas). Default 1. |

Respuesta inmediata (la terminal ya está pidiendo la tarjeta):

```json
{
  "payment_intent_id": "c9d8e7f6...",
  "device_id": "GERTEC_MP35P__8701123456789",
  "state": "OPEN",
  "amount": 150.50,
  "external_reference": "c_456__o_orden-123",
  "client_id": "456"
}
```

👉 Guarda el **`payment_intent_id`** por si necesitas consultar o cancelar.

En este punto **la terminal muestra el monto** y el cliente paga (tarjeta,
contactless o CoDi según tu modelo).

---

## Paso 6 — Recibir la confirmación (automático)

Cuando el cliente termina de pagar, Mercado Pago llama a tu
`POST /payments/webhook-point`. Tu API automáticamente:

1. Consulta el estado real de la intención.
2. Si terminó (`FINISHED`), trae el **pago definitivo** con su `payment_id`.
3. Lo guarda/actualiza en la tabla **`Payments`**.
4. Hace *forward* a Servia (si `MP_WEBHOOK_FORWARD_URL` está configurado).

No tienes que hacer nada: solo escuchar. El payload que recibe Servia:

```json
{
  "payment_intent_id": "c9d8e7f6...",
  "payment_id": "1234567890",
  "device_id": "GERTEC_MP35P__8701123456789",
  "state": "FINISHED",
  "status": "approved",
  "status_detail": "accredited",
  "amount": 150.50,
  "currency": "MXN",
  "date_approved": "2026-06-13T12:00:00.000-06:00",
  "external_reference": "c_456__o_orden-123",
  "client_id": "456"
}
```

> Lo importante: **`status: "approved"`** = pago acreditado. ✅

---

## Consultar y cancelar

**Consultar estado** (por si no llegó el webhook o quieres hacer *polling*):

```http
GET /payments/point/c9d8e7f6...
```

```json
{
  "payment_intent_id": "c9d8e7f6...",
  "state": "FINISHED",
  "payment_id": "1234567890",
  "amount": 150.50
}
```

**Cancelar** una intención que aún no se cobró (libera la terminal):

```http
DELETE /payments/point/GERTEC_MP35P__8701123456789/c9d8e7f6...
```

---

## Estados de una intención (`state`)

| Estado | Significado |
|--------|-------------|
| `OPEN` | Creada, esperando que la terminal la tome |
| `ON_TERMINAL` | La terminal ya muestra el monto al cliente |
| `PROCESSING` | El cliente está pagando |
| `FINISHED` | ✅ Pago realizado (revisa `status` del pago: `approved`) |
| `CANCELED` | Cancelada (por API o por el cajero en la terminal) |
| `ERROR` / `ABANDONED` | Falló o el cliente no completó |

---

## Errores comunes

| Síntoma | Causa / Solución |
|---------|------------------|
| `GET /point/devices` devuelve vacío | Terminal apagada o no vinculada a esta cuenta. |
| `Falta device_id` | Configura `MP_POINT_DEVICE_ID` o envíalo en el body. |
| La terminal no despierta | No está en modo `PDV`. Repite el Paso 2. |
| Nunca llega el webhook | URL no es HTTPS/pública, o falta marcar el topic `point_integration_wh`. |
| `401` / `invalid token` | `MP_ACCESS_TOKEN` no es de producción (`APP_USR-...`). |

---

## Checklist rápido

- [ ] `MP_ACCESS_TOKEN` de producción en `.env`
- [ ] `GET /payments/point/devices` → copiar `id`
- [ ] `PATCH .../mode` con `{ "mode": "PDV" }`
- [ ] `MP_POINT_DEVICE_ID` en `.env` + reiniciar servidor
- [ ] Webhook `point_integration_wh` → `https://tu-dominio/payments/webhook-point`
- [ ] `POST /payments/point` con un monto de prueba
- [ ] Confirmar que llega el webhook con `status: approved`
