import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WardrobeController } from './wardrobe.controller';
import { WardrobeService } from './wardrobe.service';

@Module({ imports: [AuthModule], controllers: [WardrobeController], providers: [WardrobeService] })
export class WardrobeModule {}
