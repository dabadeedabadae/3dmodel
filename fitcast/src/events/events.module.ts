import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WeatherModule } from '../weather/weather.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({ imports: [AuthModule, WeatherModule], controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
