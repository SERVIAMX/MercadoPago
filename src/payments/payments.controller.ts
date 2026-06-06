import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateSpeiPaymentDto } from './dto/create-spei-payment.dto';
import { WebhookPaymentDto } from './dto/webhook-payment.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un pago con tarjeta (Checkout API)' })
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(dto);
  }

  @Post('spei')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generar CLABE SPEI para pago por transferencia interbancaria' })
  createSpei(@Body() dto: CreateSpeiPaymentDto) {
    return this.paymentsService.createSpeiPayment(dto);
  }

  @Put('spei/:id/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '🧪 SANDBOX — Simular pago SPEI aprobado' })
  @ApiParam({ name: 'id', example: '1347006273' })
  simulateSpei(@Param('id') id: string) {
    return this.paymentsService.simulateSpeiPayment(id);
  }

  @Get('spei/:id')
  @ApiOperation({ summary: 'Consultar estado de un pago SPEI por payment_id' })
  @ApiParam({ name: 'id', example: '1347006273' })
  getSpeiPayment(@Param('id') id: string) {
    return this.paymentsService.getSpeiPayment(id);
  }

  @Get('config/methods')
  @ApiOperation({ summary: 'Listar métodos de pago disponibles para México' })
  getMethods() {
    return this.paymentsService.getPaymentMethods();
  }

  @Get('order/:id')
  @ApiOperation({ summary: 'Obtener orden por ID (ORDTST01... o ORD...)' })
  @ApiParam({ name: 'id', example: 'ORDTST01KS6G4D3PMET16FN6M2XSWEZC' })
  findOrder(@Param('id') id: string) {
    return this.paymentsService.getOrder(id);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de notificaciones de Mercado Pago (tarjetas — API Orders)',
    description: 'Configurar en la app Orders del panel de MP',
  })
  @ApiOkResponse({ description: 'Notificación procesada' })
  webhook(@Body() body: WebhookPaymentDto) {
    return this.paymentsService.handleWebhook(body);
  }

  @Post('webhook-spei')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de notificaciones de Mercado Pago (SPEI — API Pagos)',
    description: 'Configurar en la app SPEI del panel de MP',
  })
  @ApiOkResponse({ description: 'Notificación SPEI procesada' })
  webhookSpei(@Body() body: any) {
    return this.paymentsService.handleSpeiWebhook(body);
  }
}
