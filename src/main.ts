import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Sirve la carpeta examples/ en http://localhost:PORT/checkout.html
  app.useStaticAssets(join(__dirname, '..', 'examples'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();
  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Mercado Pago API')
    .setDescription('NestJS + Mercado Pago Checkout API (México)')
    .setVersion('1.0')
    .addServer('http://localhost:3003/api', 'Producción')
    .addTag('payments', 'Pagos con tarjeta y webhooks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    ignoreGlobalPrefix: true,
  });
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.APP_PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Servidor corriendo en http://localhost:${port}/api`);
  console.log(`📄 Swagger UI en http://localhost:${port}/api/docs`);
}
bootstrap();
