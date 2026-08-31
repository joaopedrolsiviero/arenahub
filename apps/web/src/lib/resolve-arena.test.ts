import { resolveArenaBySlugOrLegacyId } from './resolve-arena';
import { api, ApiError } from './api';

jest.mock('./api', () => {
  const actual = jest.requireActual('./api');
  return {
    ...actual,
    api: {
      discoverArenaBySlug: jest.fn(),
      discoverArena: jest.fn(),
    },
  };
});

const mockedDiscoverArenaBySlug = api.discoverArenaBySlug as jest.Mock;
const mockedDiscoverArena = api.discoverArena as jest.Mock;

const arena = { id: 'arena-1', slug: 'arena-central', name: 'Arena Central' };

describe('resolveArenaBySlugOrLegacyId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("kind 'ok' quando o parâmetro já é o slug canônico — uma única requisição", async () => {
    mockedDiscoverArenaBySlug.mockResolvedValue(arena);

    const result = await resolveArenaBySlugOrLegacyId('arena-central');

    expect(result).toEqual({ kind: 'ok', arena });
    expect(mockedDiscoverArena).not.toHaveBeenCalled();
  });

  it("kind 'legacy-id' quando o slug não bate mas o valor é um id antigo válido (Fase 32: nunca quebra link já compartilhado)", async () => {
    mockedDiscoverArenaBySlug.mockRejectedValue(new ApiError(404, 'Arena não encontrada.'));
    mockedDiscoverArena.mockResolvedValue(arena);

    const result = await resolveArenaBySlugOrLegacyId('arena-1');

    expect(result).toEqual({ kind: 'legacy-id', arena });
    expect(mockedDiscoverArena).toHaveBeenCalledWith(null, 'arena-1');
  });

  it("kind 'not-found' quando nem slug nem id batem com nenhuma arena", async () => {
    mockedDiscoverArenaBySlug.mockRejectedValue(new ApiError(404, 'Arena não encontrada.'));
    mockedDiscoverArena.mockRejectedValue(new ApiError(404, 'Arena não encontrada.'));

    const result = await resolveArenaBySlugOrLegacyId('nada-disso-existe');

    expect(result).toEqual({ kind: 'not-found' });
  });

  it('propaga um erro que não seja 404 (nunca esconde uma falha real de rede/servidor atrás de "não encontrada")', async () => {
    mockedDiscoverArenaBySlug.mockRejectedValue(new ApiError(500, 'Erro interno do servidor.'));

    await expect(resolveArenaBySlugOrLegacyId('arena-central')).rejects.toBeInstanceOf(ApiError);
    expect(mockedDiscoverArena).not.toHaveBeenCalled();
  });
});
