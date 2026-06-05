import {
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  IsPositive,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SpeiPayerDto {
  @ApiProperty({ example: 'comprador@ejemplo.com' })
  @IsEmail()
  email: string;
}

export class CreateSpeiPaymentDto {
  @ApiProperty({ example: 150.5, description: 'Monto a cobrar vía SPEI (MXN)' })
  @IsNumber()
  @IsPositive()
  transaction_amount: number;

  @ApiProperty({ type: SpeiPayerDto })
  @ValidateNested()
  @Type(() => SpeiPayerDto)
  payer: SpeiPayerDto;

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
}
