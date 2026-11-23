import { Body, Controller, Get, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import { RecommendationTestDto } from './recommendation-test.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  @Get('overview')
  async overview() {
    const [users, wardrobeItems, savedOutfits] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.wardrobeItem.count(),
      this.prisma.savedOutfit.count(),
    ]);
    return { users, wardrobeItems, savedOutfits };
  }

  @Get('users')
  users() {
    return this.prisma.user.findMany({
      take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, email: true, isAdmin: true, createdAt: true,
        _count: { select: { wardrobeItems: true, savedOutfits: true } },
      },
    });
  }

  @Get('wardrobe')
  wardrobe() {
    return this.prisma.wardrobeItem.findMany({
      take: 100, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, type: true, dominantColor: true, fitTag: true, imageUrl: true, createdAt: true,
        user: { select: { email: true } } },
    });
  }

  @Get('outfits')
  outfits() {
    return this.prisma.savedOutfit.findMany({
      take: 100, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, name: true, eventType: true, createdAt: true,
        user: { select: { email: true } }, _count: { select: { items: true } } },
    });
  }

  /**
   * Test bench for the recommendation service. Builds the request exactly as the
   * contract in recommendation-service/README.md defines it (metadata only: no photos,
   * no e-mail, no tokens) and forwards it if RECOMMENDATION_SERVICE_URL is set.
   * The recommendation logic itself lives in the Python service and is not touched here.
   */
  @Post('recommendations/test')
  @HttpCode(200)
  async recommendationTest(@Body() dto: RecommendationTestDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found.');
    const wardrobe = await this.prisma.wardrobeItem.findMany({
      where: { userId: dto.userId }, take: 200, orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, dominantColor: true, fitTag: true },
    });
    const payload = {
      wardrobe,
      weather: { temperatureC: dto.temperatureC, precipitation: dto.precipitation },
      eventType: dto.eventType,
      limit: dto.limit,
    };
    const base = this.config.get<string>('RECOMMENDATION_SERVICE_URL');
    if (!base) return { payload, service: null };
    const started = Date.now();
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/recommendations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep raw text */ }
      return { payload, service: { url: base, status: response.status, ms: Date.now() - started, body } };
    } catch (err) {
      return { payload, service: { url: base, status: 0, ms: Date.now() - started, body: { error: err instanceof Error ? err.message : String(err) } } };
    }
  }
}
