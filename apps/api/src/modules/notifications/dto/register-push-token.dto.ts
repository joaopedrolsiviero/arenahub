import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// M7 — token real vem do Expo Push Service no formato
// "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"; nunca validamos o formato
// exato aqui (o Expo pode mudá-lo sem aviso) — só um `String` não vazio com
// um teto de tamanho generoso (defesa contra abuso, nunca uma regra de
// negócio). `platform` fechado em ios/android (as duas únicas plataformas
// nativas que este app builda — ver app.json); "web" fica pra quando/se
// existir um build web com push (não existe hoje).
export class RegisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}
