import { normalizePhoneE164 } from './phone.util';

describe('normalizePhoneE164', () => {
  it('mantém um telefone já em E.164', () => {
    expect(normalizePhoneE164('+5511999998888')).toBe('+5511999998888');
  });

  it('adiciona o "+" quando a Meta manda só dígitos (wa_id)', () => {
    expect(normalizePhoneE164('5511999998888')).toBe('+5511999998888');
  });

  it('remove espaços, parênteses e hífens', () => {
    expect(normalizePhoneE164('+55 (11) 99999-8888')).toBe('+5511999998888');
  });

  it('null/undefined/vazio viram null', () => {
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('   ')).toBeNull();
  });

  it('mesmo telefone em formatos diferentes normaliza pro mesmo valor (garantia de match exato)', () => {
    const a = normalizePhoneE164('+55 11 99999-8888');
    const b = normalizePhoneE164('5511999998888');
    expect(a).toBe(b);
  });
});
