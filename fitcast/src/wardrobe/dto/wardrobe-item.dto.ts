import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { FitTag, GarmentType } from '@prisma/client';
import { COLOR_NAMES, ColorName } from '../wardrobe.constants';

const color = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  return v === 'grey' ? 'gray' : v;
};

export class CreateWardrobeItemDto {
  @IsEnum(GarmentType)
  type!: GarmentType;

  @Transform(color)
  @IsIn(COLOR_NAMES)
  dominantColor!: ColorName;

  @IsEnum(FitTag)
  fitTag!: FitTag;
}

export class UpdateWardrobeItemDto {
  @IsOptional()
  @IsEnum(GarmentType)
  type?: GarmentType;

  @IsOptional()
  @Transform(color)
  @IsIn(COLOR_NAMES)
  dominantColor?: ColorName;

  @IsOptional()
  @IsEnum(FitTag)
  fitTag?: FitTag;
}
