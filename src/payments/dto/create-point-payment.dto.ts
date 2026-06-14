import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsBoolean,
  IsInt,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePointPaymentDto {
  @ApiProperty({ example: 150.5, description: 'Monto a cobrar en la terminal Point (MXN)' })
  @IsNumber()
  @IsPositive()
  transaction_amount: number;

  @ApiPropertyOptional({
    example: 'GERTEC_MP35P__8701123456789',
    description: 'ID del Point Smart. Si se omite, usa MP_POINT_DEVICE_ID del .env',
  })
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiPropertyOptional({ example: 'Pago de servicio Servia' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'orden-123', description: 'ID de orden interno' })
  @IsOptional()
  @IsString()
  external_reference?: string;

  @ApiPropertyOptional({ example: '456', description: 'ID interno del cliente' })
  @IsOptional()
  @IsString()
  client_id?: string;

  @ApiPropertyOptional({ example: '789', description: 'ID del historial de balance' })
  @IsOptional()
  @IsString()
  id_history_balance?: string;

  @ApiPropertyOptional({ example: true, description: 'Imprimir ticket en la terminal' })
  @IsOptional()
  @IsBoolean()
  print_on_terminal?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Número de mensualidades (cuotas)' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  installments?: number;
}

export class SetPointModeDto {
  @ApiProperty({
    example: 'PDV',
    enum: ['PDV', 'STANDALONE'],
    description: 'PDV = integrado (cobra por API). STANDALONE = terminal manual.',
  })
  @IsIn(['PDV', 'STANDALONE'])
  mode: 'PDV' | 'STANDALONE';
}
