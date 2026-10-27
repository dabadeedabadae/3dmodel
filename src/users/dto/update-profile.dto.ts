import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const clean = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() || null : value;

export class UpdateProfileDto {
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(80)
  name?: string | null;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(300)
  bio?: string | null;
}
