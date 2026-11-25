import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max,
  MaxLength, Min, ValidateIf,
} from 'class-validator';
import { EventType, FeedbackVerdict } from '@prisma/client';
import { PRECIPITATION } from '../admin/recommendation-test.dto';

const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** Either an event (its forecast and occasion) or an occasion with the current weather in a city. */
export class RecommendDto {
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ValidateIf((o: RecommendDto) => !o.eventId)
  @IsEnum(EventType, { message: 'Choose an event or an occasion.' })
  eventType?: EventType;

  /** only without an event: the city for the current weather; default is the profile city */
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  /** the swipe feed (I-77): up to 10 outfits not judged yet in this context, each with a purchase suggestion */
  @IsOptional()
  @IsBoolean()
  feed?: boolean;

  /** whose clothes to suggest (I-77): "men" leaves out skirts and dresses, "women" and "all" leave nothing out */
  @IsOptional()
  @IsIn(['men', 'women', 'all'])
  wear?: 'men' | 'women' | 'all';
}

export class FeedbackDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds!: string[];

  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsEnum(EventType)
  eventType!: EventType;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(60)
  temperatureC!: number;

  @IsIn(PRECIPITATION)
  precipitation!: (typeof PRECIPITATION)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  score?: number;

  /** null removes the verdict */
  @ValidateIf((o: FeedbackDto) => o.verdict !== null)
  @IsEnum(FeedbackVerdict)
  verdict!: FeedbackVerdict | null;
}

export class SaveOutfitDto {
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsEnum(EventType)
  eventType!: EventType;

  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds!: string[];

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(400)
  explanation?: string;
}
