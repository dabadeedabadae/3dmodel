import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { EventType, UserEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Precipitation, WeatherService } from '../weather/weather.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

const eventSelect = {
  id: true, title: true, eventType: true, startsAt: true, city: true, note: true, createdAt: true, updatedAt: true,
} as const;
type EventRow = Pick<UserEvent, keyof typeof eventSelect>;

/** an event is still "upcoming" for a few hours after it starts */
const ONGOING_MS = 3 * 3600_000;
const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_AHEAD_MS = 2 * 365 * 24 * 3600_000;

export type EventWeather =
  | { status: 'FORECAST'; city: string; cityFromProfile: boolean; location: string; temperatureC: number;
      precipitation: Precipitation; weatherCode: number; description: string;
      /** the request the recommendation service will get for this event (contract: weather + eventType) */
      recommendationInput: { weather: { temperatureC: number; precipitation: Precipitation }; eventType: EventType } }
  | { status: 'PAST' | 'TOO_FAR'; city: string; cityFromProfile: boolean; location: string; forecastFrom?: string }
  | { status: 'NO_CITY' }
  | { status: 'CITY_NOT_FOUND' | 'UNAVAILABLE'; city: string; cityFromProfile: boolean };

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService, private readonly weather: WeatherService) {}

  private parseDate(value: string): Date {
    const date = new Date(value);
    const t = date.getTime();
    if (!Number.isFinite(t) || t < MIN_DATE || t > Date.now() + MAX_AHEAD_MS) {
      throw new BadRequestException('The event date must be between the year 2000 and two years from now.');
    }
    return date;
  }

  private async profileCity(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { city: true } });
    return user?.city?.trim() || null;
  }

  private async weatherFor(event: EventRow, profileCity: string | null): Promise<EventWeather> {
    const city = event.city?.trim() || profileCity;
    if (!city) return { status: 'NO_CITY' };
    const cityFromProfile = !event.city?.trim();
    try {
      const w = await this.weather.at(city, event.startsAt);
      const location = [w.location.name, w.location.country].filter(Boolean).join(', ');
      if (w.status !== 'FORECAST') return { status: w.status, city, cityFromProfile, location, forecastFrom: w.forecastFrom };
      return {
        status: 'FORECAST', city, cityFromProfile, location, temperatureC: w.temperatureC,
        precipitation: w.precipitation, weatherCode: w.weatherCode, description: w.description,
        recommendationInput: {
          weather: { temperatureC: w.temperatureC, precipitation: w.precipitation }, eventType: event.eventType,
        },
      };
    } catch (err) {
      // the event itself is always returned; only its weather is missing
      if (err instanceof NotFoundException) return { status: 'CITY_NOT_FOUND', city, cityFromProfile };
      if (err instanceof HttpException) return { status: 'UNAVAILABLE', city, cityFromProfile };
      throw err;
    }
  }

  private async withWeather(userId: string, events: EventRow[], scope: 'upcoming' | 'past') {
    const city = await this.profileCity(userId);
    if (scope === 'past') return events.map((e) => ({ ...e, weather: null }));
    // sequential on purpose: the first call fills the cache that the others reuse
    const out = [];
    for (const e of events) out.push({ ...e, weather: await this.weatherFor(e, city) });
    return out;
  }

  async list(userId: string, scope: 'upcoming' | 'past' = 'upcoming') {
    const border = new Date(Date.now() - ONGOING_MS);
    const events = await this.prisma.userEvent.findMany({
      where: { userId, startsAt: scope === 'upcoming' ? { gte: border } : { lt: border } },
      orderBy: [{ startsAt: scope === 'upcoming' ? 'asc' : 'desc' }, { id: 'asc' }],
      take: 100, select: eventSelect,
    });
    return this.withWeather(userId, events, scope);
  }

  async get(userId: string, id: string) {
    const event = await this.prisma.userEvent.findFirst({ where: { id, userId }, select: eventSelect });
    if (!event) throw new NotFoundException('Event not found.');
    return { ...event, weather: await this.weatherFor(event, await this.profileCity(userId)) };
  }

  async create(userId: string, dto: CreateEventDto) {
    const event = await this.prisma.userEvent.create({
      data: {
        userId, title: dto.title, eventType: dto.eventType, startsAt: this.parseDate(dto.startsAt),
        city: dto.city ?? null, note: dto.note ?? null,
      },
      select: eventSelect,
    });
    return { ...event, weather: await this.weatherFor(event, await this.profileCity(userId)) };
  }

  async update(userId: string, id: string, dto: UpdateEventDto) {
    // Ownership is part of the WHERE clause: another user's id behaves as "not found".
    const result = await this.prisma.userEvent.updateMany({
      where: { id, userId },
      data: {
        title: dto.title ?? undefined, eventType: dto.eventType ?? undefined,
        startsAt: dto.startsAt ? this.parseDate(dto.startsAt) : undefined,
        city: dto.city, note: dto.note,
      },
    });
    if (!result.count) throw new NotFoundException('Event not found.');
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.userEvent.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Event not found.');
    return { id };
  }
}
