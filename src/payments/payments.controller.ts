import {
  Controller,
  Post,
  Get,
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
    summary: 'Webhook de notificaciones de Mercado Pago',
    description:
      'Configurar en https://www.mercadopago.com.mx/developers/panel/notifications',
  })
  @ApiOkResponse({ description: 'Notificación procesada' })
  webhook(@Body() body: WebhookPaymentDto) {
    return this.paymentsService.handleWebhook(body);
  }
}
