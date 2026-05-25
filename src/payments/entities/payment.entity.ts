import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('Payments')
@Unique('UK_PaymentId', ['paymentId'])
@Index('IDX_OrderId', ['orderId'])
@Index('IDX_UserId', ['userId'])
@Index('IDX_Status', ['status'])
@Index('IDX_PaymentStatus', ['paymentStatus'])
export class Payment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, name: 'Id' })
  id: number;

  @Column({ type: 'varchar', length: 50, name: 'OrderId' })
  orderId: string;

  @Column({ type: 'varchar', length: 50, name: 'PaymentId' })
  paymentId: string;

  @Column({ type: 'varchar', length: 30, name: 'Status' })
  status: string;

  @Column({ type: 'varchar', length: 30, name: 'PaymentStatus' })
  paymentStatus: string;

  @Column({ type: 'varchar', length: 50, name: 'PaymentStatusDetail' })
  paymentStatusDetail: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'TotalAmount' })
  totalAmount: number;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'ExternalReference' })
  externalReference: string | null;

  @Column({ type: 'bigint', unsigned: true, name: 'UserId' })
  userId: number;

  @CreateDateColumn({ type: 'timestamp', name: 'FhRegistro' })
  fhRegistro: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'FhActualizacion' })
  fhActualizacion: Date;
}
