import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import * as bcrypt from 'bcrypt';

const profileSelect = {
  id: true, email: true, name: true, city: true, bio: true, isAdmin: true,
  createdAt: true, updatedAt: true,
  _count: { select: { wardrobeItems: true, savedOutfits: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw new NotFoundException('User not found');
    if (!await bcrypt.compare(dto.currentPassword, user.passwordHash)) {
      throw new BadRequestException('Текущий пароль указан неверно.');
    }
    if (Buffer.byteLength(dto.newPassword, 'utf8') > 72) {
      throw new BadRequestException('Новый пароль должен занимать не более 72 байт UTF-8.');
    }
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('Новый пароль должен отличаться от текущего.');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    const result = await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: user.passwordHash },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    if (!result.count) throw new BadRequestException('Пароль уже изменён. Войдите снова.');
    return { message: 'Пароль изменён. Войдите в аккаунт заново.' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Only editable profile fields; identity and privileges never come from the body.
    return this.prisma.user.update({
      where: { id: userId }, data: { name: dto.name, city: dto.city, bio: dto.bio },
      select: profileSelect,
    });
  }
}
