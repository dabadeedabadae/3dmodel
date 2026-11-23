import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { EventType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** empty optional text → null (clears the field) */
const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class CreateEventDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the event a name.' })
  @MaxLength(100)
  title!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  /** an instant with its offset, e.g. new Date(local).toISOString() in the browser */
  @IsISO8601({ strict: true }, { message: 'startsAt must be a date and time (ISO 8601).' })
  startsAt!: string;

  /** null / empty: the city from the profile is used for the weather */
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class UpdateEventDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the event a name.' })
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'startsAt must be a date and time (ISO 8601).' })
  startsAt?: string;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export const EVENT_SCOPES = ['upcoming', 'past'] as const;
export class ListEventsQuery {
  @IsOptional()
  @IsIn(EVENT_SCOPES)
  scope?: (typeof EVENT_SCOPES)[number];
}
