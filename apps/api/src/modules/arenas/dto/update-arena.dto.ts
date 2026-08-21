import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateArenaDto } from './create-arena.dto';

// slug fica de fora deliberadamente: é tratado como estável após a criação
// nesta fase (editar slug implica cuidar de URLs quebradas, fora de escopo
// aqui — não foi pedido, e não custa nada deixar a decisão registrada).
export class UpdateArenaDto extends PartialType(OmitType(CreateArenaDto, ['slug'] as const)) {}
