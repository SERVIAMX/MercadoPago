import { IsString, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class WebhookDataDto {
  @ApiProperty({ example: '123456789' })
  @IsString()
  id: string;
}

export class WebhookPaymentDto {
  @ApiProperty({ example: 'payment' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'payment.updated' })
  @IsString()
  action: string;

  @ApiPropertyOptional({ example: 12345 })
  @IsOptional()
  @IsNumber()
  user_id?: number;

  @ApiPropertyOptional({ type: WebhookDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data?: WebhookDataDto;
}
