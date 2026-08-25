import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsIanaTimezone } from '../validators/is-iana-timezone.validator';

// Regex de slug: minúsculas, dígitos e hífen simples entre palavras — sem
// espaço, sem maiúscula, sem hífen duplicado/nas pontas. Simples e
// determinístico, conforme pedido — não há utilitário de slug no projeto
// ainda, e o slug é fornecido pelo cliente (não derivado do nome aqui).
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateArenaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, {
    message: 'slug deve conter apenas letras minúsculas, números e hífens (ex: arena-central)',
  })
  slug!: string;

  // Obrigatório na criação, mesmo existindo default no banco (Fase 5): o
  // default só existe para não quebrar a migration em arenas já existentes
  // — uma arena NOVA precisa declarar seu timezone real explicitamente
  // (silenciosamente herdar "America/Sao_Paulo" produziria disponibilidade
  // sistematicamente errada para uma arena em outro fuso).
  @IsIanaTimezone()
  timezone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  // Fase 16: `phone_number_id` estável da Meta Cloud API (dígitos puros,
  // nunca o número de telefone em si — ver docs/ARCHITECTURE.md, Fase 16,
  // "Identidade da arena"). Opcional: a maioria das arenas não tem WhatsApp
  // configurado. Reaproveita a autorização já existente de
  // `PATCH /arenas/:arenaId` (OWNER/ADMIN) — nenhum endpoint novo só para
  // isso.
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'whatsappPhoneNumberId deve conter apenas dígitos' })
  whatsappPhoneNumberId?: string;
}
