import {
  IsString,
  IsNumber,
  IsInt,
  IsEmail,
  IsOptional,
  IsPositive,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PayerIdentificationDto {
  @ApiProperty({ example: 'RFC', description: 'RFC o CURP en México' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'XAXX010101000' })
  @IsString()
  number: string;
}

export class PayerDto {
  @ApiProperty({ example: 'comprador@ejemplo.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ type: PayerIdentificationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayerIdentificationDto)
  identification?: PayerIdentificationDto;
}

export class CreatePaymentDto {
  @ApiProperty({ example: 150.5 })
  @IsNumber()
  @IsPositive()
  transaction_amount: number;

  @ApiProperty({
    description: 'Card token generado por MercadoPago.js en el frontend',
  })
  @IsString()
  token: string;

  @ApiProperty({ example: 'visa', description: 'visa, master, amex, etc.' })
  @IsString()
  payment_method_id: string;

  @ApiPropertyOptional({ example: 'credit_card', description: 'credit_card | debit_card' })
  @IsOptional()
  @IsString()
  payment_method_type?: string;

  @ApiPropertyOptional({ example: 1, description: 'Número de mensualidades (default: 1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;

  @ApiProperty({ type: PayerDto })
  @ValidateNested()
  @Type(() => PayerDto)
  payer: PayerDto;

  @ApiPropertyOptional({ example: 'Compra en tienda' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'orden-123',
    description: 'ID de orden interno',
  })
  @IsOptional()
  @IsString()
  external_reference?: string;

  @ApiPropertyOptional({
    example: 'user-456',
    description: 'Tu ID interno del usuario que está pagando',
  })
  @IsOptional()
  @IsString()
  user_id?: string;
}
