// Normalização de telefone para E.164 (Fase 16) — usada tanto ao
// sincronizar User.phone do Clerk (que já entrega E.164, mas defesa em
// profundidade nunca custa) quanto ao resolver a identidade de quem envia
// uma mensagem de WhatsApp (a Meta Cloud API entrega `wa_id` como dígitos
// puros, SEM o "+" — ex: "5511999998888"). Mesma função nos dois lados
// garante que a comparação seja sempre exata, nunca uma string "quase
// igual" (item 7 do prompt da fase).
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const digits = raw.trim().replace(/[^\d]/g, '');
  if (digits.length === 0) {
    return null;
  }
  return `+${digits}`;
}
