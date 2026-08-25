import { DateTime } from 'luxon';
import {
  isConfirmation,
  isDenial,
  parseNumericChoice,
  parseRelativeDatePhrase,
  parseTimePhrase,
} from './nlp.util';

// 2026-08-20 é quinta-feira (mesma data de referência usada nos testes de
// OperationalMetricsService, Fase 12) — reaproveitada aqui pela mesma razão:
// já sabemos o dia da semana de cabeça, o que torna as asserções de
// "próximo sábado" etc. fáceis de verificar à mão.
const THURSDAY = DateTime.fromISO('2026-08-20T15:00:00', { zone: 'America/Sao_Paulo' });

describe('parseRelativeDatePhrase', () => {
  it('"hoje" resolve pro dia de hoje', () => {
    expect(parseRelativeDatePhrase('hoje', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-08-20');
  });

  it('"amanhã" (com acento) resolve corretamente', () => {
    expect(parseRelativeDatePhrase('amanhã', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-08-21');
  });

  it('"amanha" (sem acento) resolve igual', () => {
    expect(parseRelativeDatePhrase('amanha', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-08-21');
  });

  it('"depois de amanhã" soma 2 dias', () => {
    expect(parseRelativeDatePhrase('depois de amanhã', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe(
      '2026-08-22',
    );
  });

  it('nome de dia da semana igual a hoje resolve pra HOJE (quinta perguntada numa quinta)', () => {
    expect(parseRelativeDatePhrase('quinta', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-08-20');
  });

  it('"sábado" (dia futuro na mesma semana) resolve pro próximo sábado', () => {
    expect(parseRelativeDatePhrase('sábado', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-08-22');
  });

  it('"segunda" (já passou nesta semana) resolve pra segunda da semana SEGUINTE', () => {
    expect(parseRelativeDatePhrase('segunda', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-08-24');
  });

  it('"próxima quinta" pula a ocorrência de hoje, mesmo perguntado numa quinta', () => {
    expect(parseRelativeDatePhrase('próxima quinta', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe(
      '2026-08-27',
    );
  });

  it('dd/mm explícito no ano corrente', () => {
    expect(parseRelativeDatePhrase('25/12', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2026-12-25');
  });

  it('dd/mm que já passou este ano avança pro ano seguinte', () => {
    expect(parseRelativeDatePhrase('01/01', THURSDAY)?.toFormat('yyyy-MM-dd')).toBe('2027-01-01');
  });

  it('frase não reconhecida devolve null (nunca adivinha)', () => {
    expect(parseRelativeDatePhrase('semana que vem', THURSDAY)).toBeNull();
    expect(parseRelativeDatePhrase('qualquer coisa', THURSDAY)).toBeNull();
  });
});

describe('parseTimePhrase', () => {
  it('"19h" vira {hour:19, minute:0}', () => {
    expect(parseTimePhrase('19h')).toEqual({ hour: 19, minute: 0 });
  });

  it('"19h30" vira {hour:19, minute:30}', () => {
    expect(parseTimePhrase('19h30')).toEqual({ hour: 19, minute: 30 });
  });

  it('"19:30" vira {hour:19, minute:30}', () => {
    expect(parseTimePhrase('19:30')).toEqual({ hour: 19, minute: 30 });
  });

  it('"19" (sem sufixo) vira {hour:19, minute:0}', () => {
    expect(parseTimePhrase('19')).toEqual({ hour: 19, minute: 0 });
  });

  it('hora fora do intervalo 0-23 é inválida', () => {
    expect(parseTimePhrase('25h')).toBeNull();
    expect(parseTimePhrase('24')).toBeNull();
  });

  it('minuto fora do intervalo 0-59 é inválido', () => {
    expect(parseTimePhrase('19h75')).toBeNull();
  });

  it('frase livre ("sete da noite") não é interpretada — pede esclarecimento', () => {
    expect(parseTimePhrase('sete da noite')).toBeNull();
  });
});

describe('isConfirmation / isDenial (item 17 — nunca match parcial)', () => {
  it('"sim", "confirmo", "pode reservar" confirmam', () => {
    expect(isConfirmation('sim')).toBe(true);
    expect(isConfirmation('Confirmo')).toBe(true);
    expect(isConfirmation('pode reservar')).toBe(true);
  });

  it('"acho que sim" NUNCA confirma (frase ambígua, mesmo contendo "sim")', () => {
    expect(isConfirmation('acho que sim')).toBe(false);
  });

  it('"pode ser" e "talvez" nunca confirmam', () => {
    expect(isConfirmation('pode ser')).toBe(false);
    expect(isConfirmation('talvez')).toBe(false);
  });

  it('"19h então" nunca confirma (contém um horário, não uma confirmação)', () => {
    expect(isConfirmation('19h então')).toBe(false);
  });

  it('"não", "cancela", "cancelar" negam', () => {
    expect(isDenial('não')).toBe(true);
    expect(isDenial('nao')).toBe(true);
    expect(isDenial('cancela')).toBe(true);
  });

  it('mensagem qualquer não é nem confirmação nem negação', () => {
    expect(isConfirmation('oi tudo bem?')).toBe(false);
    expect(isDenial('oi tudo bem?')).toBe(false);
  });
});

describe('parseNumericChoice', () => {
  it('"1", "2" viram números', () => {
    expect(parseNumericChoice('1')).toBe(1);
    expect(parseNumericChoice('2')).toBe(2);
  });

  it('"opção 2" também funciona', () => {
    expect(parseNumericChoice('opção 2')).toBe(2);
  });

  it('"0" é inválido (base 1, sem opção zero)', () => {
    expect(parseNumericChoice('0')).toBeNull();
  });

  it('texto não numérico devolve null', () => {
    expect(parseNumericChoice('quadra 2')).toBeNull();
    expect(parseNumericChoice('sim')).toBeNull();
  });
});
