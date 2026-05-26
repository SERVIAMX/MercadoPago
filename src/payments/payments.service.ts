import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import MercadoPagoConfig, { Order, Payment, PaymentMethod } from 'mercadopago';
import { v4 as uuidv4 } from 'uuid';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Payment as PaymentEntity } from './entities/payment.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly mpClient: MercadoPagoConfig;
  private readonly order: Order;
  private readonly payment: Payment;
  private readonly paymentMethod: PaymentMethod;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepo: Repository<PaymentEntity>,
  ) {
    this.mpClient = new MercadoPagoConfig({
      accessToken: this.configService.get<string>('MP_ACCESS_TOKEN'),
      options: { timeout: 10000 },
    });
    this.order = new Order(this.mpClient);
    this.payment = new Payment(this.mpClient);
    this.paymentMethod = new PaymentMethod(this.mpClient);
  }

  async createPayment(dto: CreatePaymentDto) {
    const amount = dto.transaction_amount.toFixed(2);

    // Codifica clientId + order reference — solo caracteres permitidos por MP
    const ordRef     = dto.external_reference ?? `${Date.now()}`;
    const externalRef = dto.client_id
      ? `c_${dto.client_id}__o_${ordRef}`
      : `o_${ordRef}`;

    try {
      const response = await this.order.create({
        body: {
          type: 'online',
          processing_mode: 'automatic',
          total_amount: amount,
          description: dto.description ?? 'Pago en línea',
          external_reference: externalRef,
          payer: {
            email: dto.payer.email,
            ...(dto.payer.identification?.type && dto.payer.identification?.number && {
              identification: dto.payer.identification,
            }),
          },
          transactions: {
            payments: [{
              amount,
              payment_method: {
                id: dto.payment_method_id,
                type: dto.payment_method_type ?? 'credit_card',
                token: dto.token,
                installments: dto.installments ?? 1,
                statement_descriptor: 'SERVIA',
              },
            }],
          },
        },
        requestOptions: { idempotencyKey: uuidv4() },
      } as any);

      const firstPayment = (response as any).transactions?.payments?.[0];
      const { clientId } = this.parseExternalRef(externalRef);

      this.logger.log(`Orden creada: ${response.id} | Estado: ${(response as any).status}`);

      const result = {
        order_id:             response.id,
        payment_id:           firstPayment?.id,
        status:               (response as any).status,
        payment_status:       firstPayment?.status,
        payment_status_detail: firstPayment?.status_detail,
        total_amount:         (response as any).total_amount,
        external_reference:   (response as any).external_reference,
        date_created:         (response as any).date_created,
        client_id:            clientId ?? null,
      };

      await this.savePayment(result);
      await this.forwardToServiaAPI(result);
      return result;

    } catch (error) {
      const cause = error?.cause ?? error;
      if (cause?.data) {
        const order        = cause.data;
        const firstPayment = order.transactions?.payments?.[0];
        const { clientId } = this.parseExternalRef(externalRef);

        this.logger.warn(`Pago rechazado — Orden: ${order.id} | Detalle: ${firstPayment?.status_detail}`);

        const result = {
          order_id:             order.id,
          payment_id:           firstPayment?.id,
          status:               order.status,
          payment_status:       firstPayment?.status,
          payment_status_detail: firstPayment?.status_detail,
          total_amount:         order.total_amount,
          external_reference:   order.external_reference,
          date_created:         order.created_date,
          client_id:            clientId ?? null,
        };

        await this.savePayment(result);
        await this.forwardToServiaAPI(result);
        return result;
      }

      this.logger.error('Error al crear orden de pago — sin datos recuperables', error?.message ?? error);
      throw new BadRequestException(
        cause?.message ?? cause?.[0]?.description ?? 'No se pudo procesar el pago',
      );
    }
  }

  async getOrder(id: string) {
    try {
      const response     = await this.order.get({ id } as any);
      const r            = response as any;
      const firstPayment = r.transactions?.payments?.[0];
      return {
        order_id:             r.id,
        payment_id:           firstPayment?.id,
        status:               r.status,
        payment_status:       firstPayment?.status,
        payment_status_detail: firstPayment?.status_detail,
        total_amount:         r.total_amount,
        currency:             r.currency,
        external_reference:   r.external_reference,
        description:          r.description,
        date_created:         r.created_date,
        date_updated:         r.last_updated_date,
        payer: { email: r.payer?.email },
        payments: r.transactions?.payments?.map((p: any) => ({
          id:             p.id,
          status:         p.status,
          status_detail:  p.status_detail,
          amount:         p.amount,
          paid_amount:    p.paid_amount,
          payment_method: p.payment_method?.id,
          installments:   p.payment_method?.installments,
        })),
      };
    } catch (error) {
      this.logger.error(`Error al obtener orden ${id}`, error);
      throw new NotFoundException(`Orden ${id} no encontrada`);
    }
  }

  async getPaymentMethods() {
    try {
      const methods = await this.paymentMethod.get({});
      return methods
        .filter((m) => ['credit_card', 'debit_card'].includes(m.payment_type_id))
        .map((m) => ({
          id:                 m.id,
          name:               m.name,
          type:               m.payment_type_id,
          thumbnail:          m.thumbnail,
          min_allowed_amount: m.min_allowed_amount,
          max_allowed_amount: m.max_allowed_amount,
        }));
    } catch (error) {
      this.logger.error('Error al obtener métodos de pago', error);
      throw new BadRequestException('No se pudieron obtener los métodos de pago');
    }
  }

  private parseExternalRef(ref: string): { clientId?: string; orderId?: string } {
    if (!ref) return {};
    // Formato: "c_{clientId}__o_{orderId}"  o  "o_{orderId}"
    const match = ref.match(/^(?:c_(.+?)__)?o_(.+)$/);
    return { clientId: match?.[1], orderId: match?.[2] };
  }

  async handleWebhook(body: any) {
    const type       = body.type;
    const resourceId = body.data?.id;

    if (!resourceId) return { received: true };

    this.logger.log(`Webhook recibido — tipo: ${type} | id: ${resourceId}`);

    try {
      const paymentInfo              = await this.payment.get({ id: resourceId });
      const { clientId, orderId }    = this.parseExternalRef(paymentInfo.external_reference ?? '');

      this.logger.log(`Webhook — cliente: ${clientId ?? 'N/A'} | orden: ${orderId ?? 'N/A'} | estado: ${paymentInfo.status}`);

      const payload = {
        payment_id:         String(paymentInfo.id),
        status:             paymentInfo.status,
        status_detail:      paymentInfo.status_detail,
        client_id:          clientId ?? null,
        order_id:           orderId  ?? null,
        amount:             paymentInfo.transaction_amount,
        currency:           paymentInfo.currency_id,
        date_approved:      paymentInfo.date_approved,
        external_reference: paymentInfo.external_reference,
      };

      await this.savePayment({
        order_id:             orderId ?? resourceId,
        payment_id:           String(paymentInfo.id),
        status:               paymentInfo.status,
        payment_status:       paymentInfo.status,
        payment_status_detail: paymentInfo.status_detail ?? '',
        total_amount:         paymentInfo.transaction_amount ?? 0,
        external_reference:   paymentInfo.external_reference ?? null,
        client_id:            clientId ?? null,
      });
      await this.forwardToServiaAPI(payload);

      return { received: true, ...payload };
    } catch {
      return { received: true };
    }
  }

  private async savePayment(data: {
    order_id: string;
    payment_id: string;
    status: string;
    payment_status: string;
    payment_status_detail: string;
    total_amount: string | number;
    external_reference: string;
    client_id?: string | number | null;
  }) {
    try {
      await this.paymentRepo.upsert(
        {
          orderId:             data.order_id,
          paymentId:           data.payment_id,
          status:              data.status,
          paymentStatus:       data.payment_status,
          paymentStatusDetail: data.payment_status_detail,
          totalAmount:         Number(data.total_amount),
          externalReference:   data.external_reference ?? null,
          userId:              0,
          clientId:            data.client_id ? Number(data.client_id) : null,
        },
        ['paymentId'],
      );

      this.logger.log(`DB ✅ Pago guardado/actualizado — PaymentId: ${data.payment_id}`);
    } catch (err) {
      this.logger.error(`DB ❌ Error guardando pago: ${err.message}`, err.stack);
    }
  }

  private async forwardToServiaAPI(payload: Record<string, any>) {
    const forwardUrl = this.configService.get<string>('MP_WEBHOOK_FORWARD_URL');
    if (!forwardUrl) return;

    try {
      const res = await fetch(forwardUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      this.logger.log(`Forward a ServiaAPI → ${res.status} ${forwardUrl}`);
    } catch (err) {
      this.logger.warn(`No se pudo hacer forward a ServiaAPI: ${err.message}`);
    }
  }
}
