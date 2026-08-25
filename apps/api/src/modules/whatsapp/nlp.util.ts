import { DateTime } from 'luxon';
import { Weekday } from '@prisma/client';
import { weekdayFromIso } from '../operating-hours/operating-hours.util';

// Item 27 do prompt da fase: "a estrutura final deve possuir data ISO
// validada pelo servidor" — o LLM (quando usado) só extrai a FRASE ("amanhã",
// "sábado que vem"), nunca calcula a data absoluta sozinho. Toda a
// aritmética de data/hora vive aqui, determinística e testável sem mock de
// IA nenhum — e reaproveitada pra também tratar atalhos que nem precisam de
// IA (item 40: "1", "2", "sim", "não", "cancelar").

// U+0300–U+036F = marcas diacríticas combinantes (o que sobra de "á", "ã",
// "ç" etc. depois de normalize('NFD') separar a letra base do acento).
const DIACRITICS_PATTERN = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(DIACRITICS_PATTERN, '');
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  domingo: Weekday.SUNDAY,
  segunda: Weekday.MONDAY,
  'segunda-feira': Weekday.MONDAY,
  terca: Weekday.TUESDAY,
  'terca-feira': Weekday.TUESDAY,
  quarta: Weekday.WEDNESDAY,
  'quarta-feira': Weekday.WEDNESDAY,
  quinta: Weekday.THURSDAY,
  'quinta-feira': Weekday.THURSDAY,
  sexta: Weekday.FRIDAY,
  'sexta-feira': Weekday.FRIDAY,
  sabado: Weekday.SATURDAY,
};

/**
 * Resolve uma frase de data relativa contra a data/hora REAL atual (`now`,
 * sempre no timezone da arena — nunca do servidor). Devolve `null` quando a
 * frase não é reconhecida (o chamador deve pedir esclarecimento, nunca
 * adivinhar).
 */
export function parseRelativeDatePhrase(phrase: string, now: DateTime): DateTime | null {
  const text = normalize(phrase);
  const today = now.startOf('day');

  if (text === 'hoje') return today;
  if (text === 'amanha') return today.plus({ days: 1 });
  if (text === 'depois de amanha') return today.plus({ days: 2 });

  const nextPrefix = text.startsWith('proxima ') ? text.slice('proxima '.length) : null;
  const weekdayName = nextPrefix ?? text;
  const weekday = WEEKDAY_BY_NAME[weekdayName];
  if (weekday) {
    // Próxima ocorrência daquele dia da semana, incluindo HOJE se hoje já
    // for esse dia (ex: perguntar "sábado" num sábado significa hoje) —
    // "próxima <dia>" força pular pra semana seguinte mesmo se hoje bater.
    let candidate = today;
    if (nextPrefix && weekdayFromIso(candidate.weekday) === weekday) {
      candidate = candidate.plus({ days: 1 });
    }
    while (weekdayFromIso(candidate.weekday) !== weekday) {
      candidate = candidate.plus({ days: 1 });
    }
    return candidate;
  }

  // dd/mm explícito — assume o ano corrente, ou o próximo se a data já
  // passou este ano (nunca uma data no passado a partir de uma frase que
  // claramente pretende ser futura).
  const explicit = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (explicit) {
    const day = Number(explicit[1]);
    const month = Number(explicit[2]);
    let candidate = DateTime.fromObject({ year: now.year, month, day }, { zone: now.zone });
    if (!candidate.isValid) return null;
    if (candidate < today) {
      candidate = candidate.plus({ years: 1 });
    }
    return candidate.startOf('day');
  }

  return null;
}

export interface ParsedTime {
  hour: number;
  minute: number;
}

/** "19h", "19:30", "19h30", "19" — nunca interpretação livre ("sete da noite" pede esclarecimento). */
export function parseTimePhrase(phrase: string): ParsedTime | null {
  const text = normalize(phrase).replace(/\s+/g, '');

  let match = text.match(/^(\d{1,2})h(\d{2})?$/);
  if (!match) {
    match = text.match(/^(\d{1,2}):(\d{2})$/);
  }
  if (match) {
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return { hour, minute };
    }
    return null;
  }

  const bare = text.match(/^(\d{1,2})$/);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour >= 0 && hour < 24) {
      return { hour, minute: 0 };
    }
  }

  return null;
}

// Item 17: confirmação exige uma frase INTEIRA e inequívoca — nunca match
// parcial/substring, senão "acho que sim" ou "19h então" contariam como
// confirmação (o prompt lista esses dois exatamente como NÃO devendo
// confirmar). Comparado sempre contra o texto já normalizado (sem acento),
// então "não"/"nao" convergem pro mesmo valor — só precisa estar num dos
// dois sets uma vez.
const CONFIRM_PHRASES = new Set([
  'sim',
  'confirmo',
  'confirmar',
  'confirma',
  'pode reservar',
  'pode confirmar',
  'pode cancelar',
  'ok confirmo',
]);
const DENY_PHRASES = new Set([
  'nao',
  'cancela',
  'cancelar',
  'nao quero',
  'nao confirmo',
  'deixa pra la',
  'deixa para la',
]);

export function isConfirmation(text: string): boolean {
  return CONFIRM_PHRASES.has(normalize(text));
}

export function isDenial(text: string): boolean {
  return DENY_PHRASES.has(normalize(text));
}

/** "1", "2", "opção 2" — seleção numérica de uma lista apresentada anteriormente. Base 1 (primeira opção = "1"). */
export function parseNumericChoice(text: string): number | null {
  const match = normalize(text).match(/^(?:opcao\s*)?(\d{1,2})$/);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}
