import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { WardrobeModule } from './wardrobe/wardrobe.module';
import { WeatherModule } from './weather/weather.module';
import { EventsModule } from './events/events.module';
import { RecommendationsModule } from './recommendations/recommendations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AdminModule,
    WardrobeModule,
    WeatherModule,
    EventsModule,
    RecommendationsModule,
  ],
})
export class AppModule {}
