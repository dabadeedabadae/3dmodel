import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from './admin.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

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
      select: { id: true, type: true, dominantColor: true, fitTag: true, createdAt: true,
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
}
