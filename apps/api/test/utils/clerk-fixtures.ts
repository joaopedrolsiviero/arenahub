// Payloads mínimos, mas estruturalmente reais (mesmo shape que o Clerk
// realmente envia), para os eventos user.* usados nos testes de webhook.

export function buildUserCreatedPayload(params: {
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
}): unknown {
  const emailId = `idn_${params.clerkId}`;

  return {
    type: 'user.created',
    object: 'event',
    data: {
      id: params.clerkId,
      object: 'user',
      username: null,
      first_name: params.firstName ?? null,
      last_name: params.lastName ?? null,
      image_url: params.imageUrl ?? '',
      has_image: false,
      primary_email_address_id: emailId,
      primary_phone_number_id: null,
      primary_web3_wallet_id: null,
      email_addresses: [{ id: emailId, object: 'email_address', email_address: params.email }],
      phone_numbers: [],
      web3_wallets: [],
      external_accounts: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'test' } },
  };
}

export function buildUserDeletedPayload(clerkId: string): unknown {
  return {
    type: 'user.deleted',
    object: 'event',
    data: { id: clerkId, object: 'user', deleted: true },
    event_attributes: { http_request: { client_ip: '127.0.0.1', user_agent: 'test' } },
  };
}
