import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { UPLOAD_ROOT } from './wardrobe/wardrobe.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Garment photos: random UUID file names, no directory listing. Local MVP storage.
  // Textures are read by WebGL, which needs CORS even for images; only the frontend origin is allowed.
  const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001';
  app.useStaticAssets(join(process.cwd(), UPLOAD_ROOT), {
    prefix: '/uploads/', index: false, dotfiles: 'deny',
    setHeaders: (res) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); },
  });
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
