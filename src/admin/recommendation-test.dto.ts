import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsUUID, Max, Min } from 'class-validator';
import { EventType } from '@prisma/client';

export const PRECIPITATION = ['NONE', 'RAIN', 'SNOW', 'MIXED'] as const;

export class RecommendationTestDto {
  @IsUUID()
  userId!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(60)
  temperatureC!: number;

  @IsIn(PRECIPITATION)
  precipitation!: (typeof PRECIPITATION)[number];

  @IsEnum(EventType)
  eventType!: EventType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  limit = 5;
}
