import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Sport } from '@prisma/client';

export class CreateCourtDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(Sport)
  sport!: Sport;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // Opcionais na criação (com default no banco) — a quadra pode ser
  // cadastrada e ter preço/duração/buffer ajustados depois via PATCH.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerSlot?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(24 * 60)
  slotDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  bufferMinutes?: number;
}
