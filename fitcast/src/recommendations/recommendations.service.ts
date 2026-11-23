import {
  BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventType } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { Precipitation, WeatherService } from '../weather/weather.service';
import { FeedbackDto, RecommendDto, SaveOutfitDto } from './dto';

const itemSelect = { id: true, type: true, dominantColor: true, fitTag: true, imageUrl: true } as const;
const outfitSelect = {
  id: true, name: true, eventType: true, explanation: true, createdAt: true,
  event: { select: { id: true, title: true, startsAt: true } },
  items: { select: { item: { select: itemSelect } } },
} as const;

/** an outfit's identity: its item ids, sorted */
export const outfitKey = (ids: string[]) => [...ids].sort().join(',');
const contextOf = (eventId: string | null | undefined, eventType: EventType) => (eventId ? `event:${eventId}` : `type:${eventType}`);

interface ServiceOutfit {
  items: string[]; score: number; explanation: string;
  breakdown: { occasion: number; weather: number; color: number; fit: number | null };
}
interface ServiceResponse { status: 'OK' | 'NO_VALID_OUTFITS'; outfits: ServiceOutfit[]; warnings: string[] }

const NO_FORECAST: Record<string, string> = {
  TOO_FAR: 'The forecast for this event is not available yet (it covers the next 16 days).',
  PAST: 'This event has already started.',
  NO_CITY: 'Set a city in your profile or for the event to get outfits for its weather.',
  CITY_NOT_FOUND: 'The event city was not found, so there is no forecast for it.',
  UNAVAILABLE: 'The weather service is unavailable right now. Try again later.',
};

@Injectable()
export class RecommendationsService {
  private readonly log = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly events: EventsService, private readonly weather: WeatherService,
  ) {}

  /** The conditions an outfit is picked for: an event's forecast, or the current weather in a city. */
  private async conditions(userId: string, dto: RecommendDto) {
    if (dto.eventId) {
      const event = await this.events.get(userId, dto.eventId);
      const w = event.weather;
      if (!w || w.status !== 'FORECAST') {
        throw new ConflictException(NO_FORECAST[w?.status ?? 'PAST'] ?? 'There is no forecast for this event.');
      }
      return {
        eventId: event.id, eventTitle: event.title, startsAt: event.startsAt, eventType: event.eventType,
        location: w.location, temperatureC: w.temperatureC, precipitation: w.precipitation, description: w.description,
      };
    }
    let city = dto.city;
    if (!city) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { city: true } });
      city = user?.city?.trim() || undefined;
    }
    if (!city) throw new BadRequestException('Set your city in the profile settings or enter a city.');
    const { location, current } = await this.weather.forecast(city);
    return {
      eventId: null, eventTitle: null, startsAt: null, eventType: dto.eventType!,
      location: [location.name, location.country].filter(Boolean).join(', '),
      temperatureC: current.temperatureC, precipitation: current.precipitation, description: current.description,
    };
  }

  private async callService(payload: unknown): Promise<ServiceResponse> {
    const base = this.config.get<string>('RECOMMENDATION_SERVICE_URL');
    if (!base) throw new ServiceUnavailableException('The recommendation service is not configured.');
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/$/, '')}/recommendations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.log.warn(`recommendation service unreachable: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException('The recommendation service is unavailable right now. Try again later.');
    }
    if (!response.ok) {
      this.log.warn(`recommendation service answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
      throw new BadGatewayException('The recommendation service could not build outfits.');
    }
    return response.json() as Promise<ServiceResponse>;
  }

  async recommend(userId: string, dto: RecommendDto) {
    const limit = dto.limit ?? 3;
    const ctx = await this.conditions(userId, dto);
    const wardrobe = await this.prisma.wardrobeItem.findMany({
      where: { userId }, take: 200, orderBy: { createdAt: 'desc' }, select: itemSelect,
    });
    const context = contextOf(ctx.eventId, ctx.eventType);
    const [feedback, saved] = await Promise.all([
      this.prisma.outfitFeedback.findMany({ where: { userId, context }, select: { outfitKey: true, verdict: true } }),
      this.prisma.savedOutfit.findMany({
        where: ctx.eventId ? { userId, eventId: ctx.eventId } : { userId, eventId: null, eventType: ctx.eventType },
        select: { id: true, items: { select: { itemId: true } } },
      }),
    ]);
    const verdicts = new Map(feedback.map((f) => [f.outfitKey, f.verdict]));
    const savedIds = new Map(saved.map((s) => [outfitKey(s.items.map((i) => i.itemId)), s.id]));

    // the service sees metadata only (no photos, e-mail or tokens), exactly the contract fields
    const result = await this.callService({
      wardrobe: wardrobe.map(({ id, type, dominantColor, fitTag }) => ({ id, type, dominantColor, fitTag })),
      weather: { temperatureC: ctx.temperatureC, precipitation: ctx.precipitation },
      eventType: ctx.eventType, limit: 5,
    });
    const byId = new Map(wardrobe.map((i) => [i.id, i]));
    const all = result.outfits
      .filter((o) => o.items.every((id) => byId.has(id)))
      .map((o) => {
        const key = outfitKey(o.items);
        return { key, items: o.items.map((id) => byId.get(id)!), score: o.score, breakdown: o.breakdown,
          explanation: o.explanation, feedback: verdicts.get(key) ?? null, savedOutfitId: savedIds.get(key) ?? null };
      });
    // outfits the user said "doesn't fit" to, for this event or occasion, are not shown again
    const visible = all.filter((o) => o.feedback !== 'DISLIKE');
    return {
      context: {
        eventId: ctx.eventId, eventTitle: ctx.eventTitle, startsAt: ctx.startsAt, eventType: ctx.eventType,
        location: ctx.location,
        weather: { temperatureC: ctx.temperatureC, precipitation: ctx.precipitation as Precipitation, description: ctx.description },
      },
      status: visible.length ? 'OK' : 'NO_VALID_OUTFITS',
      outfits: visible.slice(0, limit),
      hiddenDisliked: all.length - visible.length,
      warnings: result.warnings,
    };
  }

  private async assertOwnItems(userId: string, itemIds: string[]) {
    const count = await this.prisma.wardrobeItem.count({ where: { userId, id: { in: itemIds } } });
    if (count !== itemIds.length) throw new NotFoundException('Some items were not found in your wardrobe.');
  }
  private async assertOwnEvent(userId: string, eventId?: string) {
    if (eventId && !(await this.prisma.userEvent.count({ where: { id: eventId, userId } }))) {
      throw new NotFoundException('Event not found.');
    }
  }

  async feedback(userId: string, dto: FeedbackDto) {
    await this.assertOwnItems(userId, dto.itemIds);
    await this.assertOwnEvent(userId, dto.eventId);
    const key = outfitKey(dto.itemIds);
    const context = contextOf(dto.eventId, dto.eventType);
    const where = { userId_outfitKey_context: { userId, outfitKey: key, context } };
    if (dto.verdict === null) {
      await this.prisma.outfitFeedback.deleteMany({ where: { userId, outfitKey: key, context } });
      return { outfitKey: key, verdict: null };
    }
    const data = {
      itemIds: [...dto.itemIds].sort(), eventId: dto.eventId ?? null, eventType: dto.eventType,
      temperatureC: dto.temperatureC, precipitation: dto.precipitation, score: dto.score ?? null, verdict: dto.verdict,
    };
    const row = await this.prisma.outfitFeedback.upsert({
      where, create: { userId, outfitKey: key, context, ...data }, update: data,
      select: { outfitKey: true, verdict: true },
    });
    return row;
  }

  listOutfits(userId: string) {
    return this.prisma.savedOutfit.findMany({
      where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, select: outfitSelect,
    }).then((rows) => rows.map(({ items, ...o }) => ({ ...o, items: items.map((i) => i.item) })));
  }

  async saveOutfit(userId: string, dto: SaveOutfitDto) {
    await this.assertOwnItems(userId, dto.itemIds);
    await this.assertOwnEvent(userId, dto.eventId);
    // the same items for the same event are one outfit: saving twice returns the first one
    const same = await this.prisma.savedOutfit.findMany({
      where: { userId, eventId: dto.eventId ?? null, eventType: dto.eventType },
      select: { id: true, items: { select: { itemId: true } } },
    });
    const key = outfitKey(dto.itemIds);
    const existing = same.find((s) => outfitKey(s.items.map((i) => i.itemId)) === key);
    const id = existing?.id ?? (await this.prisma.savedOutfit.create({
      data: {
        userId, eventType: dto.eventType, eventId: dto.eventId ?? null, explanation: dto.explanation ?? null,
        name: dto.name ?? `Outfit ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        items: { create: dto.itemIds.map((itemId) => ({ itemId })) },
      },
      select: { id: true },
    })).id;
    const row = await this.prisma.savedOutfit.findUniqueOrThrow({ where: { id }, select: outfitSelect });
    return { ...row, items: row.items.map((i) => i.item) };
  }

  async deleteOutfit(userId: string, id: string) {
    const result = await this.prisma.savedOutfit.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Outfit not found.');
    return { id };
  }
}
