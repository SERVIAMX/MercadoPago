import { Injectable, BadRequestException, NotFoundException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import MercadoPagoConfig, { Order, Payment, PaymentMethod } from 'mercadopago';
import { v4 as uuidv4 } from 'uuid';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateSpeiPaymentDto } from './dto/create-spei-payment.dto';
import { CreatePointPaymentDto } from './dto/create-point-payment.dto';
import { Payment as PaymentEntity } from './entities/payment.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  // Cliente Orders API — tarjetas
  private readonly mpClient: MercadoPagoConfig;
  private readonly order: Order;
  private readonly payment: Payment;
  private readonly paymentMethod: PaymentMethod;
  // Cliente Payments API — SPEI
  private readonly mpClientSpei: MercadoPagoConfig;
  private readonly paymentSpei: Payment;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepo: Repository<PaymentEntity>,
  ) {
    const accessToken = this.configService.get<string>('MP_ACCESS_TOKEN') ?? '';
    const publicKey   = this.configService.get<string>('MP_PUBLIC_KEY') ?? '';
    this.logger.log(
      `MP credenciales cargadas → ` +
      `env: ${accessToken.startsWith('TEST-') ? '🧪 SANDBOX' : '✅ PROD'} | ` +
      `AccessToken app: ${accessToken.split('-')[1]} / cuenta: ${accessToken.split('-').pop()} | ` +
      `PublicKey: ${publicKey.slice(0, 14)}...`,
    );

    this.mpClient = new MercadoPagoConfig({
      accessToken: this.configService.get<string>('MP_ACCESS_TOKEN'),
      options: { timeout: 10000 },
    });
    this.order         = new Order(this.mpClient);
    this.payment       = new Payment(this.mpClient);
    this.paymentMethod = new PaymentMethod(this.mpClient);

    this.mpClientSpei = new MercadoPagoConfig({
      accessToken: this.configService.get<string>('MP_ACCESS_TOKEN_SPEI'),
      options: { timeout: 10000 },
    });
    this.paymentSpei = new Payment(this.mpClientSpei);
  }

  /**
   * SPEI usa Orders API (/v1/orders) con MP_ACCESS_TOKEN (APP_USR).
   * MP no acepta credenciales TEST- en Orders; en sandbox se usa APP_USR + comprador @testuser.com.
   */
  private resolveSpeiPayerEmail(email: string): string {
    const normalized = email?.trim();
    if (!normalized) {
      throw new BadRequestException('Falta payer.email en la petición SPEI.');
    }
    if (normalized.toLowerCase().endsWith('@testuser.com')) {
      return normalized;
    }
    const testBuyer =
      this.configService.get<string>('MP_TEST_BUYER_EMAIL_SPEI') ??
      this.configService.get<string>('MP_TEST_BUYER_EMAIL');
    if (testBuyer?.trim()) {
      return testBuyer.trim();
    }
    return normalized;
  }

  private extractNumericPaymentId(ticketUrl?: string | null): string | null {
    if (!ticketUrl) return null;
    const match = ticketUrl.match(/\/payments\/(\d+)\//);
    return match?.[1] ?? null;
  }

  private extractSpeiData(source: any) {
    const isOrder = source?.transactions?.payments != null;
    const firstPayment = isOrder
      ? source.transactions.payments[0]
      : source;
    const pm = firstPayment?.payment_method ?? source?.payment_method;
    const td = source?.transaction_details ?? firstPayment?.transaction_details;

    const clabe =
      pm?.data?.reference_id
      ?? td?.payment_method_reference_id
      ?? pm?.reference
      ?? null;

    const referencia =
      pm?.data?.external_reference_id
      ?? td?.acquirer_reference
      ?? null;

    return {
      order_id:           isOrder ? String(source.id) : String(source.order?.id ?? source.id),
      payment_id:         String(firstPayment?.id ?? source.id),
      status:             source.status ?? firstPayment?.status,
      status_detail:      source.status_detail ?? firstPayment?.status_detail,
      clabe,
      referencia:         referencia ? String(referencia) : null,
      banco:              td?.financial_institution ?? 'STP',
      amount:             source.total_amount ?? source.transaction_amount,
      external_reference: source.external_reference,
      date_of_expiration: firstPayment?.date_of_expiration ?? source.date_of_expiration,
      sandbox_url:        pm?.ticket_url ?? pm?.data?.external_resource_url ?? td?.external_resource_url ?? null,
      date_approved:      source.date_approved ?? firstPayment?.date_approved,
      currency:           source.currency ?? source.currency_id,
    };
  }

  private async enrichSpeiFromPayment<T extends {
    clabe?: string | null;
    referencia?: string | null;
    sandbox_url?: string | null;
  }>(spei: T, orderSource?: any): Promise<T> {
    if (spei.referencia && spei.clabe) return spei;

    const ticketUrl =
      orderSource?.transactions?.payments?.[0]?.payment_method?.ticket_url
      ?? spei.sandbox_url;
    const paymentId = this.extractNumericPaymentId(ticketUrl);
    if (!paymentId) return spei;

    try {
      const payment = await this.payment.get({ id: paymentId }) as any;
      const enriched = this.extractSpeiData(payment);
      return {
        ...spei,
        clabe: spei.clabe ?? enriched.clabe,
        referencia: spei.referencia ?? enriched.referencia,
        sandbox_url: spei.sandbox_url ?? enriched.sandbox_url,
      };
    } catch {
      return spei;
    }
  }

  private readonly speiPendingStatuses = ['action_required', 'pending', 'processing'];

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isSpeiProcessingError(error: any): boolean {
    return /processing_error/i.test(this.extractMpErrorMessage(error, ''));
  }

  /** Evita crear otra orden en MP si ya hay una SPEI pendiente con la misma ref y monto. */
  private async findReusablePendingSpei(
    externalRef: string,
    amount: number,
    clientId?: number | null,
  ) {
    const rows = await this.paymentRepo.find({
      where: {
        externalReference: externalRef,
        paymentStatus: In(this.speiPendingStatuses),
        ...(clientId != null ? { clientId } : {}),
      },
      order: { fhRegistro: 'DESC' },
      take: 5,
    });

    for (const row of rows) {
      if (Math.abs(Number(row.totalAmount) - amount) > 0.009) continue;
      if (!row.orderId?.startsWith('ORD')) continue;

      try {
        const raw  = await this.order.get({ id: row.orderId } as any);
        const spei = await this.enrichSpeiFromPayment(this.extractSpeiData(raw), raw);
        if (!this.speiPendingStatuses.includes(String(spei.status)) || !spei.clabe) continue;
        return spei;
      } catch {
        continue;
      }
    }
    return null;
  }

  private buildSpeiResponse(
    spei: ReturnType<PaymentsService['extractSpeiData']>,
    clientId: string | null,
    dto: CreateSpeiPaymentDto,
    reused = false,
  ) {
    return {
      order_id:           spei.order_id,
      payment_id:         spei.payment_id,
      status:             spei.status,
      status_detail:      spei.status_detail,
      clabe:              spei.clabe,
      referencia:         spei.referencia,
      banco:              spei.banco,
      amount:             spei.amount,
      external_reference: spei.external_reference,
      date_of_expiration: spei.date_of_expiration,
      client_id:          clientId,
      sandbox_url:        spei.sandbox_url,
      ...(reused && { reused_pending: true }),
      ...(dto.id_history_balance && { id_history_balance: dto.id_history_balance }),
    };
  }

  private async persistSpeiResult(
    spei: ReturnType<PaymentsService['extractSpeiData']>,
    clientId: string | null,
    dto: CreateSpeiPaymentDto,
  ) {
    await this.savePayment({
      order_id:             spei.order_id,
      payment_id:           spei.payment_id,
      status:               spei.status ?? 'action_required',
      payment_status:       spei.status ?? 'action_required',
      payment_status_detail: spei.status_detail ?? '',
      total_amount:         spei.amount ?? 0,
      external_reference:   spei.external_reference ?? null,
      referencia:           spei.referencia ?? null,
      client_id:            clientId,
      id_history_balance:   dto.id_history_balance ?? null,
    });
  }

  private async createSpeiOrder(body: Record<string, unknown>, idempotencyKey: string) {
    const maxAttempts = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.order.create({
          body,
          requestOptions: { idempotencyKey: `${idempotencyKey}-a${attempt}` },
        } as any);
      } catch (error) {
        lastError = error;
        if (!this.isSpeiProcessingError(error) || attempt === maxAttempts) throw error;
        this.logger.warn(`SPEI processing_error — reintento ${attempt}/${maxAttempts - 1}`);
        await this.delay(1500 * attempt);
      }
    }
    throw lastError;
  }

  private async fetchSpeiResource(id: string) {
    if (id.startsWith('ORD')) {
      return this.order.get({ id } as any);
    }
    return this.payment.get({ id });
  }
  private getCardTestBuyerEmail(): string {
    return (
      this.configService.get<string>('MP_TEST_BUYER_EMAIL') ??
      'test_user_1114942131583705234@testuser.com'
    );
  }

  /** Tarjetas: valida email según credenciales Orders (MP_ACCESS_TOKEN). */
  private resolveCardPayerEmail(email: string): string {
    const token = this.configService.get<string>('MP_ACCESS_TOKEN') ?? '';
    const isTest = token.startsWith('TEST-');
    const normalized = email?.trim().toLowerCase();

    if (isTest) {
      if (normalized?.endsWith('@testuser.com')) return email.trim();
      if (!normalized) {
        throw new BadRequestException(
          'Falta payer.email. En sandbox usa el comprador de prueba (@testuser.com).',
        );
      }
      throw new BadRequestException(
        `Email "${email}" no válido en sandbox. Usa ${this.getCardTestBuyerEmail()}.`,
      );
    }

    if (normalized?.endsWith('@testuser.com')) {
      throw new BadRequestException(
        'Tarjetas en producción (APP_USR): no uses emails @testuser.com. Usa el email real del comprador.',
      );
    }
    if (!normalized) {
      throw new BadRequestException('Falta payer.email en la petición.');
    }
    return email.trim();
  }

  private extractMpErrorMessage(error: any, fallback: string): string {
    const src = error?.cause ?? error;

    if (typeof src === 'string') return src;
    if (src?.message) return String(src.message);

    const mpErrors = src?.errors;
    if (Array.isArray(mpErrors) && mpErrors.length > 0) {
      const e = mpErrors[0];
      const paymentDetail = src?.data?.transactions?.payments?.[0]?.status_detail;
      const parts = [e.message, ...(e.details ?? []), paymentDetail].filter(Boolean);
      return parts.join(' — ');
    }

    if (Array.isArray(src) && src[0]?.description) return src[0].description;

    const paymentDetail = src?.data?.transactions?.payments?.[0]?.status_detail;
    if (paymentDetail) return String(paymentDetail);

    return fallback;
  }

  private mapMercadoPagoError(message: string, context?: 'spei' | 'card'): string {
    const rules: Array<[RegExp, string]> = [
      [/processing_error/i,
        context === 'spei'
          ? 'Mercado Pago no pudo generar una CLABE nueva (processing_error). ' +
            'Tu integración está correcta; el fallo es del procesador SPEI de MP. ' +
            'Si ya tienes una transferencia pendiente, reutilízala. ' +
            'Si persiste, contacta soporte MP (developers) con el x-request-id del log del servidor ' +
            'y verifica que la cuenta vendedor tenga SPEI/transferencias habilitado.'
          : 'Error de procesamiento en Mercado Pago. Intenta de nuevo en unos minutos.'],
      [/payer email forbidden/i,
        context === 'spei'
          ? 'Email de comprador no válido para SPEI. Usa el @testuser.com del COMPRADOR de prueba ' +
            'de la misma app que MP_ACCESS_TOKEN (developers → Cuentas de prueba). ' +
            'SPEI usa Orders API con credenciales APP_USR, no TEST-.'
          : 'Email del comprador no permitido. En sandbox usa @testuser.com del comprador de prueba; en producción usa un email real.'],
      [/invalid_credentials|test credentials are not supported/i,
        'SPEI requiere Orders API con MP_ACCESS_TOKEN (APP_USR). Las credenciales TEST- no funcionan en /v1/orders.'],
      [/live credentials.*test/i,
        'Credenciales de producción con usuario de prueba. Usa APP_USR en prod o TEST- en sandbox, en frontend y backend.'],
    ];
    return rules.find(([re]) => re.test(message))?.[1] ?? message;
  }

  async createPayment(dto: CreatePaymentDto) {
    const amount = dto.transaction_amount.toFixed(2);
    const payerEmail = this.resolveCardPayerEmail(dto.payer.email);

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
            email: payerEmail,
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
        ...(dto.id_history_balance && { id_history_balance: dto.id_history_balance }),
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
          ...(dto.id_history_balance && { id_history_balance: dto.id_history_balance }),
        };

        await this.savePayment(result);
        await this.forwardToServiaAPI(result);
        throw new HttpException(result, HttpStatus.BAD_REQUEST);
      }

      const rawMessage = this.extractMpErrorMessage(error, 'No se pudo procesar el pago');
      this.logger.error('Error al crear orden de pago — sin datos recuperables', rawMessage);
      throw new BadRequestException(this.mapMercadoPagoError(String(rawMessage), 'card'));
    }
  }

  async createSpeiPayment(dto: CreateSpeiPaymentDto) {
    const ordRef      = dto.external_reference ?? `${Date.now()}`;
    const externalRef = dto.client_id
      ? `c_${dto.client_id}__o_${ordRef}`
      : `o_${ordRef}`;

    const amount     = dto.transaction_amount.toFixed(2);
    const payerEmail = this.resolveSpeiPayerEmail(dto.payer.email);
    const { clientId } = this.parseExternalRef(externalRef);
    const clientIdNum  = clientId ? Number(clientId) : null;

    this.logger.log(`SPEI → Orders API | payer.email: ${payerEmail}`);

    const existing = await this.findReusablePendingSpei(externalRef, dto.transaction_amount, clientIdNum);
    if (existing) {
      this.logger.log(`SPEI → reutilizando orden pendiente ${existing.order_id}`);
      const result = this.buildSpeiResponse(existing, clientId ?? null, dto, true);
      await this.persistSpeiResult(existing, clientId ?? null, dto);
      await this.forwardToServiaAPI(result);
      return result;
    }

    const orderBody = {
      type: 'online',
      processing_mode: 'automatic',
      marketplace: 'NONE',
      total_amount: amount,
      external_reference: externalRef,
      payer: {
        email: payerEmail,
        first_name: 'Comprador',
      },
      transactions: {
        payments: [{
          amount,
          payment_method: {
            id: 'clabe',
            type: 'bank_transfer',
          },
        }],
      },
    };

    try {
      const response = await this.createSpeiOrder(
        orderBody,
        `spei-${externalRef}-${amount}`,
      );

      const r    = response as any;
      const spei = await this.enrichSpeiFromPayment(this.extractSpeiData(r), r);

      this.logger.log(`SPEI creado: ${spei.order_id} | CLABE: ${spei.clabe} | Referencia: ${spei.referencia}`);

      const result = this.buildSpeiResponse(spei, clientId ?? null, dto);
      await this.persistSpeiResult(spei, clientId ?? null, dto);
      await this.forwardToServiaAPI(result);

      return result;

    } catch (error) {
      if (this.isSpeiProcessingError(error)) {
        const fallback = await this.findReusablePendingSpei(externalRef, dto.transaction_amount, clientIdNum);
        if (fallback) {
          this.logger.warn(`SPEI processing_error — devolviendo orden pendiente ${fallback.order_id}`);
          const result = this.buildSpeiResponse(fallback, clientId ?? null, dto, true);
          await this.persistSpeiResult(fallback, clientId ?? null, dto);
          await this.forwardToServiaAPI(result);
          return result;
        }
      }

      const rawMessage = this.extractMpErrorMessage(error, 'No se pudo generar el pago SPEI');
      this.logger.error(
        `Error al crear pago SPEI (payer: ${payerEmail})`,
        rawMessage,
        JSON.stringify(error?.cause ?? error),
      );
      throw new BadRequestException(this.mapMercadoPagoError(String(rawMessage), 'spei'));
    }
  }

  /** SPEI delega en el handler unificado (compatibilidad con /payments/webhook-spei). */
  async handleSpeiWebhook(body: any) {
    return this.handleWebhook(body);
  }

  async simulateSpeiPayment(id: string) {
    // Usa exactamente el mismo flujo que el webhook real
    this.logger.log(`🧪 Simulando webhook SPEI — id: ${id}`);
    return this.handleSpeiWebhook({ data: { id } });
  }

  async getSpeiPayment(id: string) {
    try {
      const raw  = await this.fetchSpeiResource(id) as any;
      const spei = await this.enrichSpeiFromPayment(this.extractSpeiData(raw), raw);
      return {
        order_id:           spei.order_id,
        payment_id:         spei.payment_id,
        status:             spei.status,
        status_detail:      spei.status_detail,
        clabe:              spei.clabe,
        referencia:         spei.referencia,
        banco:              spei.banco,
        amount:             spei.amount,
        external_reference: spei.external_reference,
        date_of_expiration: spei.date_of_expiration,
        date_approved:      spei.date_approved,
        sandbox_url:        spei.sandbox_url,
      };
    } catch (error) {
      this.logger.error(`Error al obtener pago SPEI ${id}`, error);
      throw new NotFoundException(`Pago SPEI ${id} no encontrado`);
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

  /**
   * Webhook UNIFICADO — procesa notificaciones de tarjetas y SPEI (Orders API),
   * sin importar si MP envía un id de orden (ORD...) o de pago (numérico/PAY...).
   * Tanto /payments/webhook como /payments/webhook-spei entran aquí.
   */
  async handleWebhook(body: any) {
    const type       = body?.type ?? body?.topic ?? body?.action;
    const resourceId = body?.data?.id ?? body?.id ?? body?.resource;
    if (!resourceId) return { received: true };

    this.logger.log(`Webhook recibido — tipo: ${type ?? 'N/A'} | id: ${resourceId}`);

    try {
      const raw  = await this.resolveNotificationSource(String(resourceId));
      const data = await this.enrichSpeiFromPayment(this.extractSpeiData(raw), raw);
      const { clientId, orderId } = this.parseExternalRef(data.external_reference ?? '');

      this.logger.log(
        `Webhook — cliente: ${clientId ?? 'N/A'} | orden: ${data.order_id ?? orderId ?? 'N/A'} | ` +
        `pago: ${data.payment_id} | estado: ${data.status} (${data.status_detail})`,
      );

      const payload = {
        order_id:           data.order_id ?? orderId ?? null,
        payment_id:         data.payment_id,
        status:             data.status,
        status_detail:      data.status_detail,
        amount:             data.amount,
        currency:           data.currency,
        external_reference: data.external_reference ?? null,
        date_approved:      data.date_approved,
        client_id:          clientId ?? null,
        // Campos SPEI (ausentes en tarjetas)
        ...(data.clabe && { clabe: data.clabe, referencia: data.referencia, banco: data.banco }),
      };

      // MP entrega el id numérico del pago (sin link a la orden), distinto del
      // id Orders (PAY...) que guardamos al crear. Para no duplicar, primero
      // intentamos CONCILIAR el registro existente por external_reference + monto.
      const reconciled = await this.reconcileExistingPayment({
        externalReference: data.external_reference ?? null,
        amount:            Number(data.amount ?? 0),
        status:            data.status ?? '',
        statusDetail:      data.status_detail ?? '',
        referencia:        data.referencia ?? null,
      });

      if (!reconciled) {
        await this.savePayment({
          order_id:              data.order_id ?? orderId ?? String(resourceId),
          payment_id:            data.payment_id,
          status:                data.status ?? '',
          payment_status:        data.status ?? '',
          payment_status_detail: data.status_detail ?? '',
          total_amount:          data.amount ?? 0,
          external_reference:    data.external_reference ?? null,
          referencia:            data.referencia ?? null,
          client_id:             clientId ?? null,
        });
      }

      // Forward a Servia con el MISMO formato que el pago con tarjeta (createPayment),
      // para que Servia lo procese idéntico: con id_history_balance cubre saldo
      // pendiente; sin él, asigna saldo nuevo. client_id e id_history_balance se
      // toman del registro original (MP no los devuelve en el webhook).
      const forwardPayload = {
        order_id:              reconciled?.orderId ?? data.order_id ?? orderId ?? null,
        payment_id:            data.payment_id,
        status:                data.status,
        payment_status:        data.status,
        payment_status_detail: data.status_detail,
        total_amount:          data.amount,
        external_reference:    data.external_reference ?? null,
        client_id:             reconciled?.clientId ?? clientId ?? null,
        ...(reconciled?.idHistoryBalance != null && {
          id_history_balance: reconciled.idHistoryBalance,
        }),
      };
      await this.forwardToServiaAPI(forwardPayload);

      this.logger.log(`Webhook ✅ procesado — pago ${data.payment_id} | status: ${data.status}`);
      return { received: true, ...forwardPayload };

    } catch (error) {
      const httpStatus = error?.status ?? error?.cause?.status;
      this.logger.error(
        `Error procesando webhook (id: ${resourceId})`,
        this.extractMpErrorMessage(error, String(error)),
      );
      // 404 = recurso ajeno/inexistente → no tiene caso reintentar.
      if (httpStatus === 404) return { received: true };
      // Otros fallos (transitorios) → 5xx para que Mercado Pago REINTENTE (no silenciar con 200).
      throw new HttpException(
        { received: false, error: 'webhook_processing_failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** Resuelve el recurso de una notificación a su ORDEN (preferido) o pago. */
  private async resolveNotificationSource(resourceId: string): Promise<any> {
    const id = String(resourceId);
    if (id.startsWith('ORD')) {
      return this.order.get({ id } as any);
    }
    // id de pago (numérico o PAY...): trae el pago y, si referencia una orden, sube a ella
    const payment = await this.payment.get({ id }) as any;
    const linkedOrderId = payment?.order?.id;
    if (linkedOrderId && String(linkedOrderId).startsWith('ORD')) {
      try {
        return await this.order.get({ id: String(linkedOrderId) } as any);
      } catch {
        return payment;
      }
    }
    return payment;
  }

  // ───────────────────────────── POINT SMART ─────────────────────────────
  // Point Smart NO usa Orders/Payments API directo: usa la Point Integration API.
  // Flujo: 1) creas una "intención de pago" en la terminal  2) el cliente paga
  // físicamente  3) MP avisa por webhook (point_integration_wh) con el payment_id real.

  /** Llamada cruda a la Point Integration API (el SDK v2 no la cubre). */
  private async pointRequest<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const accessToken = this.configService.get<string>('MP_ACCESS_TOKEN') ?? '';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (body) headers['Content-Type'] = 'application/json';
    // Point exige idempotencia en los POST de intención de pago
    if (method === 'POST') headers['X-Idempotency-Key'] = uuidv4();

    const res = await fetch(`https://api.mercadopago.com${path}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg = data?.message ?? data?.error ?? `Point API ${res.status}`;
      this.logger.error(`Point API ${method} ${path} → ${res.status}: ${text}`);
      throw new BadRequestException(`Mercado Pago Point: ${msg}`);
    }
    return data as T;
  }

  /** Lista las terminales Point asociadas a la cuenta (necesitas el id para cobrar). */
  async listPointDevices() {
    const data = await this.pointRequest('GET', '/point/integration-api/devices');
    return (data?.devices ?? []).map((d: any) => ({
      id:              d.id,
      pos_id:          d.pos_id,
      store_id:        d.store_id,
      external_pos_id: d.external_pos_id,
      operating_mode:  d.operating_mode,
    }));
  }

  /** Cambia el modo: PDV (integrado, cobra por API) o STANDALONE (manual). */
  async setPointDeviceMode(deviceId: string, mode: 'PDV' | 'STANDALONE') {
    const data = await this.pointRequest(
      'PATCH',
      `/point/integration-api/devices/${deviceId}`,
      { operating_mode: mode },
    );
    this.logger.log(`Point device ${deviceId} → modo ${mode}`);
    return { device_id: deviceId, operating_mode: data?.operating_mode ?? mode };
  }

  /** Crea la intención de pago: la terminal "despierta" y pide la tarjeta. */
  async createPointPayment(dto: CreatePointPaymentDto) {
    const deviceId =
      dto.device_id ?? this.configService.get<string>('MP_POINT_DEVICE_ID');
    if (!deviceId) {
      throw new BadRequestException(
        'Falta device_id. Configura MP_POINT_DEVICE_ID o envíalo en la petición.',
      );
    }

    const ordRef      = dto.external_reference ?? `${Date.now()}`;
    const externalRef = dto.client_id
      ? `c_${dto.client_id}__o_${ordRef}`
      : `o_${ordRef}`;

    // Point recibe el monto en CENTAVOS (entero), no en decimales.
    const amountCents = Math.round(dto.transaction_amount * 100);

    const body: Record<string, unknown> = {
      amount: amountCents,
      additional_info: {
        external_reference: externalRef,
        print_on_terminal: dto.print_on_terminal ?? true,
      },
    };
    if (dto.description) body.description = dto.description;
    if (dto.installments && dto.installments > 1) {
      body.payment = { installments: dto.installments, type: 'credit_card' };
    }

    const intent = await this.pointRequest(
      'POST',
      `/point/integration-api/devices/${deviceId}/payment-intents`,
      body,
    );

    const { clientId } = this.parseExternalRef(externalRef);
    this.logger.log(
      `Point intent creada: ${intent.id} | device: ${deviceId} | estado: ${intent.state}`,
    );

    const result = {
      payment_intent_id:  intent.id,
      device_id:          deviceId,
      state:              intent.state,
      amount:             dto.transaction_amount,
      external_reference: externalRef,
      client_id:          clientId ?? null,
      ...(dto.id_history_balance && { id_history_balance: dto.id_history_balance }),
    };

    // Guarda la intención como pendiente; el pago real llega por webhook.
    await this.savePayment({
      order_id:              String(intent.id),
      payment_id:            String(intent.id),
      status:                intent.state ?? 'OPEN',
      payment_status:        'pending',
      payment_status_detail: 'point_intent_created',
      total_amount:          dto.transaction_amount,
      external_reference:    externalRef,
      client_id:             clientId ?? null,
      id_history_balance:    dto.id_history_balance ?? null,
    });

    return result;
  }

  /** Consulta el estado de una intención de pago Point. */
  async getPointPaymentIntent(id: string) {
    const intent = await this.pointRequest(
      'GET',
      `/point/integration-api/payment-intents/${id}`,
    );
    return {
      payment_intent_id:  intent.id,
      device_id:          intent.device_id,
      state:              intent.state,
      amount:             intent.amount != null ? Number(intent.amount) / 100 : null,
      payment_id:         intent.payment?.id ?? null,
      external_reference: intent.additional_info?.external_reference ?? null,
    };
  }

  /** Cancela una intención de pago aún no cobrada (libera la terminal). */
  async cancelPointPaymentIntent(deviceId: string, intentId: string) {
    await this.pointRequest(
      'DELETE',
      `/point/integration-api/devices/${deviceId}/payment-intents/${intentId}`,
    );
    this.logger.log(`Point intent cancelada: ${intentId} | device: ${deviceId}`);
    return { canceled: true, payment_intent_id: intentId, device_id: deviceId };
  }

  /** Webhook de Point: cuando la intención termina (FINISHED) trae el pago real. */
  async handlePointWebhook(body: any) {
    const intentId = body?.data?.id ?? body?.id ?? body?.payment_intent_id;
    if (!intentId) return { received: true };

    this.logger.log(`Webhook Point recibido — intent: ${intentId}`);

    try {
      const intent = await this.pointRequest(
        'GET',
        `/point/integration-api/payment-intents/${intentId}`,
      ) as any;

      const externalReference = intent.additional_info?.external_reference ?? null;
      const { clientId } = this.parseExternalRef(externalReference ?? '');
      const paymentId = intent.payment?.id;

      // La intención terminó con un pago real → trae el Payment definitivo.
      if (intent.state === 'FINISHED' && paymentId) {
        const paymentInfo = await this.payment.get({ id: String(paymentId) }) as any;

        const payload = {
          payment_intent_id:  String(intent.id),
          payment_id:         String(paymentInfo.id),
          device_id:          intent.device_id,
          state:              intent.state,
          status:             paymentInfo.status,
          status_detail:      paymentInfo.status_detail,
          amount:             paymentInfo.transaction_amount,
          currency:           paymentInfo.currency_id,
          date_approved:      paymentInfo.date_approved,
          external_reference: externalReference,
          client_id:          clientId ?? null,
        };

        await this.savePayment({
          order_id:              String(intent.id),
          payment_id:            String(paymentInfo.id),
          status:                intent.state,
          payment_status:        paymentInfo.status,
          payment_status_detail: paymentInfo.status_detail ?? '',
          total_amount:          paymentInfo.transaction_amount ?? 0,
          external_reference:    externalReference,
          client_id:             clientId ?? null,
        });
        await this.forwardToServiaAPI(payload);

        this.logger.log(
          `Point ✅ Pago confirmado — payment_id: ${paymentInfo.id} | status: ${paymentInfo.status}`,
        );
        return { received: true, ...payload };
      }

      // Estados intermedios (ON_TERMINAL, PROCESSING) o CANCELED/ERROR.
      const state = String(intent.state ?? '');
      const payload = {
        payment_intent_id:  String(intent.id),
        device_id:          intent.device_id,
        state,
        amount:             intent.amount != null ? Number(intent.amount) / 100 : null,
        external_reference: externalReference,
        client_id:          clientId ?? null,
      };

      await this.savePayment({
        order_id:              String(intent.id),
        payment_id:            String(intent.id),
        status:                state,
        payment_status:        ['CANCELED', 'ERROR', 'ABANDONED'].includes(state)
          ? 'cancelled'
          : 'pending',
        payment_status_detail: `point_${state.toLowerCase()}`,
        total_amount:          intent.amount != null ? Number(intent.amount) / 100 : 0,
        external_reference:    externalReference,
        client_id:             clientId ?? null,
      });
      await this.forwardToServiaAPI(payload);

      return { received: true, ...payload };
    } catch (error) {
      this.logger.error(`Error procesando webhook Point ${intentId}`, error);
      return { received: true };
    }
  }

  /**
   * Actualiza un registro existente (pendiente) que coincida por external_reference + monto,
   * preservando su OrderId/PaymentId originales. Evita duplicados por el doble id de MP.
   * Devuelve true si concilió un registro; false si no encontró ninguno.
   */
  private async reconcileExistingPayment(p: {
    externalReference: string | null;
    amount: number;
    status: string;
    statusDetail: string;
    referencia: string | null;
  }): Promise<PaymentEntity | null> {
    if (!p.externalReference) return null;

    const rows = await this.paymentRepo.find({
      where: { externalReference: p.externalReference },
      order: { fhRegistro: 'DESC' },
      take: 20,
    });
    if (rows.length === 0) return null;

    const amountMatches = (r: PaymentEntity) =>
      Math.abs(Number(r.totalAmount) - p.amount) < 0.009;

    // Prefiere el pendiente con monto exacto; si no, cualquiera con monto exacto.
    const target =
      rows.find((r) => amountMatches(r) && this.speiPendingStatuses.includes(r.paymentStatus)) ??
      rows.find((r) => amountMatches(r));
    if (!target) return null;

    target.status              = p.status;
    target.paymentStatus       = p.status;
    target.paymentStatusDetail = p.statusDetail;
    if (p.referencia) target.referencia = p.referencia;

    await this.paymentRepo.save(target);
    this.logger.log(
      `DB ✅ Conciliado #${target.id} (${target.orderId}) → ${p.status} (${p.statusDetail})`,
    );
    return target;
  }

  private async savePayment(data: {
    order_id: string;
    payment_id: string;
    status: string;
    payment_status: string;
    payment_status_detail: string;
    total_amount: string | number;
    external_reference: string;
    referencia?: string | null;
    client_id?: string | number | null;
    id_history_balance?: string | number | null;
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
          ...(data.referencia !== undefined && {
            referencia: data.referencia ?? null,
          }),
          ...(data.id_history_balance !== undefined && {
            idHistoryBalance: data.id_history_balance ? Number(data.id_history_balance) : null,
          }),
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
