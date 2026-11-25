import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Garment3d } from './garment3d';
import type { ItemAttributes } from './attributes';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWardrobeItemDto, UpdateWardrobeItemDto } from './dto/wardrobe-item.dto';

const itemSelect = {
  id: true, type: true, dominantColor: true, fitTag: true, imageUrl: true, garment3d: true, textureUrl: true, attributes: true,
  createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class WardrobeService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.wardrobeItem.findMany({
      where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: itemSelect,
    });
  }

  create(userId: string, dto: CreateWardrobeItemDto, imageUrl: string, garment3d: Garment3d | null = null, textureUrl: string | null = null,
    attributes: ItemAttributes | null = null) {
    return this.prisma.wardrobeItem.create({
      data: {
        userId, type: dto.type, dominantColor: dto.dominantColor, fitTag: dto.fitTag, imageUrl, textureUrl,
        garment3d: garment3d ? (garment3d as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        attributes: attributes && Object.keys(attributes).length ? (attributes as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
      select: itemSelect,
    });
  }

  async update(userId: string, id: string, dto: UpdateWardrobeItemDto) {
    // Ownership is part of the WHERE clause: another user's id behaves as "not found".
    const result = await this.prisma.wardrobeItem.updateMany({
      where: { id, userId }, data: { type: dto.type, dominantColor: dto.dominantColor, fitTag: dto.fitTag },
    });
    if (!result.count) throw new NotFoundException('Item not found.');
    return this.prisma.wardrobeItem.findUniqueOrThrow({ where: { id }, select: itemSelect });
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.wardrobeItem.findFirst({ where: { id, userId }, select: { imageUrl: true, textureUrl: true } });
    if (!item) throw new NotFoundException('Item not found.');
    await this.prisma.wardrobeItem.deleteMany({ where: { id, userId } });
    await removeUpload(item.imageUrl);
    if (item.textureUrl) await removeUpload(item.textureUrl);
    return { id };
  }
}

/** Deletes a stored upload; only paths under /uploads/ are touched. */
export async function removeUpload(imageUrl: string) {
  if (!imageUrl.startsWith('/uploads/') || imageUrl.includes('..')) return;
  await unlink(join(process.cwd(), imageUrl)).catch(() => undefined);
}
