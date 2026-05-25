import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsModule } from './payments/payments.module';

const dbLogger = new Logger('TypeORM');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host:     config.get<string>('DB_HOST'),
        port:     config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities:    [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging:     config.get<string>('DB_LOGGING') === 'true',
        timezone:    config.get<string>('DB_TIMEZONE') ?? '-06:00',
        extra: {
          connectionLimit:    5,
          connectTimeout:     60000,
          waitForConnections: true,
        },
        keepConnectionAlive: true,
        retryAttempts:       5,
        retryDelay:          3000,
        // Log de conexión exitosa
        applicationName: 'mercadopago-nest',
      }),
    }),

    PaymentsModule,
  ],
})
export class AppModule {}
