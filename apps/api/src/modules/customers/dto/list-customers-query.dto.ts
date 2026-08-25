import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Fase 14: primeira paginação da API — página+limite simples (nunca
// cursor/keyset, que seria complexidade desnecessária pro volume esperado
// de clientes de uma arena nesta fase). `limit` tem teto explícito (50) pra
// nunca aceitar uma página arbitrariamente grande.
export class ListCustomersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}
