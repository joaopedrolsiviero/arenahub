import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

  // URL de uma foto já hospedada externamente pelo OWNER/ADMIN — nunca um
  // upload de arquivo (o projeto não tem infraestrutura de armazenamento
  // de mídia; ver comentário em schema.prisma, model Court). String vazia
  // é um valor válido aqui (nunca em `IsUrl` puro) — é o sinal que o
  // formulário de edição usa pra "remover a foto"; `CourtsService.update`
  // converte `''` pra `null` antes de persistir.
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsUrl({}, { message: 'A foto precisa ser uma URL válida.' })
  @MaxLength(2048)
  imageUrl?: string;
}
