import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WeatherService } from './weather.service';

@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weather: WeatherService, private readonly prisma: PrismaService) {}

  /**
   * Current weather and a 16-day forecast. `city` is optional: without it the city from the user's profile is used.
   * Signed-in users only, so the endpoint does not work as an open proxy.
   */
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser, @Query('city') cityParam?: string) {
    if (cityParam !== undefined && (typeof cityParam !== 'string' || cityParam.length > 100)) {
      throw new BadRequestException('The city name must be at most 100 characters.');
    }
    let city = cityParam?.trim();
    const fromProfile = !city;
    if (!city) {
      const profile = await this.prisma.user.findUnique({ where: { id: user.id }, select: { city: true } });
      city = profile?.city?.trim();
    }
    if (!city) throw new BadRequestException('Set your city in the profile settings or enter a city.');
    const { location, current, daily } = await this.weather.forecast(city);
    return {
      city, fromProfile, location, current, daily,
      // what the recommendation service would receive for "right now"
      recommendationWeather: { temperatureC: current.temperatureC, precipitation: current.precipitation },
    };
  }
}
