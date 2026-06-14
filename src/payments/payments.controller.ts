import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
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
import {
  CreatePointPaymentDto,
  SetPointModeDto,
} from './dto/create-point-payment.dto';

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

  // ───────────────────────────── POINT SMART ─────────────────────────────

  @Get('point/devices')
  @ApiOperation({ summary: 'Listar terminales Point Smart de la cuenta' })
  listPointDevices() {
    return this.paymentsService.listPointDevices();
  }

  @Patch('point/devices/:id/mode')
  @ApiOperation({ summary: 'Cambiar modo de la terminal (PDV = integrado / STANDALONE)' })
  @ApiParam({ name: 'id', example: 'GERTEC_MP35P__8701123456789' })
  setPointMode(@Param('id') id: string, @Body() dto: SetPointModeDto) {
    return this.paymentsService.setPointDeviceMode(id, dto.mode);
  }

  @Post('point')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cobrar en el Point Smart (crea intención de pago)' })
  createPoint(@Body() dto: CreatePointPaymentDto) {
    return this.paymentsService.createPointPayment(dto);
  }

  @Get('point/:id')
  @ApiOperation({ summary: 'Consultar estado de una intención de pago Point' })
  @ApiParam({ name: 'id', example: '7d6a3...' })
  getPointIntent(@Param('id') id: string) {
    return this.paymentsService.getPointPaymentIntent(id);
  }

  @Delete('point/:deviceId/:intentId')
  @ApiOperation({ summary: 'Cancelar una intención de pago Point no cobrada' })
  @ApiParam({ name: 'deviceId', example: 'GERTEC_MP35P__8701123456789' })
  @ApiParam({ name: 'intentId', example: '7d6a3...' })
  cancelPointIntent(
    @Param('deviceId') deviceId: string,
    @Param('intentId') intentId: string,
  ) {
    return this.paymentsService.cancelPointPaymentIntent(deviceId, intentId);
  }

  @Post('webhook-point')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de notificaciones del Point Smart',
    description: 'Configurar con topic "point_integration_wh" en el panel de MP',
  })
  @ApiOkResponse({ description: 'Notificación Point procesada' })
  webhookPoint(@Body() body: any) {
    return this.paymentsService.handlePointWebhook(body);
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
    summary: 'Webhook UNIFICADO de Mercado Pago (tarjetas + SPEI — API Orders)',
    description: 'Configurar con el evento "Pagos" en el panel de MP. Acepta el payload tal cual lo envía MP.',
  })
  @ApiOkResponse({ description: 'Notificación procesada' })
  webhook(@Body() body: any) {
    // Sin DTO estricto: MP envía campos extra (api_version, live_mode, etc.)
    // que el ValidationPipe global rechazaría con 400.
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
