import { Linking } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useUpdateMyProfile } from '@/hooks/useUpdateMyProfile';
import {
  useExpoPushToken,
  usePushPermissionStatus,
  useRemovePushToken,
  useRequestPushPermission,
} from '@/hooks/usePushToken';
import { ApiError } from '@/api/client';
import { formatDate } from '@/lib/format';
import PerfilScreen from './perfil';

jest.mock('@/lib/env', () => ({
  env: { apiUrl: 'https://api.example.test/v1', clerkPublishableKey: 'pk_test_x' },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn(), useUser: jest.fn() }));
jest.mock('@/hooks/useMyProfile', () => ({ useMyProfile: jest.fn() }));
jest.mock('@/hooks/useUpdateMyProfile', () => ({ useUpdateMyProfile: jest.fn() }));
jest.mock('@/hooks/usePushToken', () => ({
  usePushPermissionStatus: jest.fn(),
  useExpoPushToken: jest.fn(),
  useRemovePushToken: jest.fn(),
  useRequestPushPermission: jest.fn(),
}));

const mockedUseAuth = useAuth as jest.Mock;
const mockedUseUser = useUser as jest.Mock;
const mockedUseMyProfile = useMyProfile as jest.Mock;
const mockedUseUpdateMyProfile = useUpdateMyProfile as jest.Mock;
const mockedUsePushPermissionStatus = usePushPermissionStatus as jest.Mock;
const mockedUseExpoPushToken = useExpoPushToken as jest.Mock;
const mockedUseRemovePushToken = useRemovePushToken as jest.Mock;
const mockedUseRequestPushPermission = useRequestPushPermission as jest.Mock;

const profile = {
  id: 'user-1',
  email: 'cliente@example.com',
  name: 'Cliente Exemplo',
  phone: '+5511999999999',
  avatarUrl: null,
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-01-15T00:00:00.000Z',
};

function mockProfileQuery(overrides: Record<string, unknown> = {}) {
  mockedUseMyProfile.mockReturnValue({
    isPending: false,
    isError: false,
    data: profile,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  });
}

function mockUpdateMutation(overrides: Record<string, unknown> = {}) {
  const mutateAsync = jest.fn().mockResolvedValue(undefined);
  mockedUseUpdateMyProfile.mockReturnValue({ mutateAsync, isPending: false, ...overrides });
  return mutateAsync;
}

describe('Perfil (M6/M7) — sessão Clerk + perfil ArenaHub + notificações push', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, signOut: jest.fn(), getToken: jest.fn() });
    mockedUseUser.mockReturnValue({ user: { firstName: 'Cliente', lastName: 'Exemplo', update: jest.fn() } });
    mockProfileQuery();
    mockUpdateMutation();
    mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'granted', canAskAgain: true } });
    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]' });
    mockedUseRemovePushToken.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(undefined) });
    mockedUseRequestPushPermission.mockReturnValue({ mutate: jest.fn(), isPending: false });
  });

  it('estrutura de autenticação renderiza enquanto a sessão ainda está carregando', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: false });
    mockedUseUser.mockReturnValue({ user: null });

    await render(<PerfilScreen />);

    expect(screen.getByText('Carregando sessão…')).toBeTruthy();
  });

  it('sessão pode ser consultada: visitante deslogado vê o link para entrar', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockedUseUser.mockReturnValue({ user: null });

    await render(<PerfilScreen />);

    expect(screen.getByTestId('profile-sign-in')).toBeTruthy();
  });

  it('deslogado: nunca dispara a consulta de perfil', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockedUseUser.mockReturnValue({ user: null });

    await render(<PerfilScreen />);

    expect(mockedUseMyProfile).toHaveBeenCalledWith(false);
  });

  it('loading: mostra o estado de carregamento do perfil', async () => {
    mockProfileQuery({ isPending: true, data: undefined });

    await render(<PerfilScreen />);

    expect(screen.getByText('Carregando perfil…')).toBeTruthy();
  });

  it('erro: mostra mensagem de erro com retry', async () => {
    const refetch = jest.fn();
    mockProfileQuery({ isError: true, data: undefined, error: new ApiError(500, 'Erro 500'), refetch });

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('error-retry'));

    expect(screen.getByText('Não foi possível carregar seu perfil.')).toBeTruthy();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('erro 404 (conta ainda não sincronizada pelo webhook): mensagem específica', async () => {
    mockProfileQuery({ isError: true, data: undefined, error: new ApiError(404, 'não sincronizado') });

    await render(<PerfilScreen />);

    expect(
      screen.getByText('Sua conta está sendo sincronizada. Tente novamente em instantes.'),
    ).toBeTruthy();
  });

  it('sucesso: mostra nome, email, telefone e "cliente desde" reais do backend', async () => {
    await render(<PerfilScreen />);

    expect(screen.getByText('Cliente Exemplo')).toBeTruthy();
    expect(screen.getByText('cliente@example.com')).toBeTruthy();
    expect(screen.getByText('+5511999999999')).toBeTruthy();
    // formatDate é deliberadamente no timezone LOCAL do aparelho (M6 — não há
    // arena/timezone envolvida numa data de conta), por isso o valor
    // esperado é calculado com a mesma função em vez de uma string fixa, que
    // seria frágil dependendo do timezone de quem roda os testes.
    expect(screen.getByText(formatDate(profile.createdAt))).toBeTruthy();
  });

  it('campos sem valor mostram "Não informado", nunca um campo vazio ou undefined literal', async () => {
    mockProfileQuery({ data: { ...profile, name: null, phone: null } });

    await render(<PerfilScreen />);

    const naoInformado = screen.getAllByText('Não informado');
    expect(naoInformado).toHaveLength(2);
  });

  it('email e telefone nunca têm nenhuma ação de edição — só nome é editável', async () => {
    await render(<PerfilScreen />);

    expect(screen.queryByTestId('profile-edit-email')).toBeNull();
    expect(screen.queryByTestId('profile-edit-phone')).toBeNull();
  });

  it('editar: tocar em "Editar nome" abre o formulário pré-preenchido com os dados do Clerk', async () => {
    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));

    expect(screen.getByTestId('profile-first-name').props.value).toBe('Cliente');
    expect(screen.getByTestId('profile-last-name').props.value).toBe('Exemplo');
  });

  it('editar: "Salvar" começa desabilitado quando nada foi alterado', async () => {
    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));

    expect(screen.getByTestId('profile-save').props.accessibilityState.disabled).toBe(true);
  });

  it('editar: alterar o nome habilita "Salvar"', async () => {
    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Novo Nome');

    expect(screen.getByTestId('profile-save').props.accessibilityState.disabled).toBe(false);
  });

  it('validação: nome vazio mostra erro e nunca chama a mutation', async () => {
    const mutateAsync = mockUpdateMutation();

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), '   ');
    // "Salvar" fica desabilitado com nome vazio (trimmedFirstName vazio) —
    // ainda assim o handler é defensivo caso seja invocado de outra forma.
    expect(screen.getByTestId('profile-save').props.accessibilityState.disabled).toBe(true);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('cancelar: descarta as alterações e volta pro modo de visualização', async () => {
    const mutateAsync = mockUpdateMutation();

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Outro Nome');
    await fireEvent.press(screen.getByTestId('profile-cancel-edit'));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Cliente Exemplo')).toBeTruthy();
    expect(screen.queryByTestId('profile-first-name')).toBeNull();
  });

  it('salvar com sucesso: chama a mutation só com firstName/lastName (nunca id/role/campo administrativo), mostra feedback e fecha o formulário', async () => {
    const mutateAsync = mockUpdateMutation();

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Novo');
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), 'Sobrenome');
    await fireEvent.press(screen.getByTestId('profile-save'));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ firstName: 'Novo', lastName: 'Sobrenome' }));
    expect(Object.keys(mutateAsync.mock.calls[0][0])).toEqual(['firstName', 'lastName']);
    await waitFor(() => expect(screen.getByText('Perfil atualizado.')).toBeTruthy());
    expect(screen.queryByTestId('profile-first-name')).toBeNull();
  });

  it('salvar com erro: mantém o formulário aberto com os dados digitados preservados e mostra mensagem compreensível', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new Error('Clerk: nome inválido'));
    mockedUseUpdateMyProfile.mockReturnValue({ mutateAsync, isPending: false });

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Novo Nome');
    await fireEvent.press(screen.getByTestId('profile-save'));

    await waitFor(() =>
      expect(
        screen.getByText('Não foi possível salvar suas alterações. Tente novamente.'),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId('profile-first-name').props.value).toBe('Novo Nome');
    expect(screen.queryByText('Clerk: nome inválido')).toBeNull();
  });

  it('duplo toque: "Salvar" e "Cancelar" ficam desabilitados enquanto a mutation está em andamento', async () => {
    mockUpdateMutation({ isPending: true });

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Novo Nome');

    expect(screen.getByTestId('profile-save').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('profile-cancel-edit').props.accessibilityState.disabled).toBe(true);
  });

  it('logout: pressionar "Sair" chama getToken e signOut sem quebrar', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    const getToken = jest.fn().mockResolvedValue('token-abc');
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, signOut, getToken });

    await render(<PerfilScreen />);
    await fireEvent.press(screen.getByTestId('profile-sign-out'));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('segurança: 401/sessão inválida nunca deixa dados privados visíveis — cai no estado de erro/deslogado, nunca mostra o perfil antigo', async () => {
    mockProfileQuery({ isError: true, data: undefined, error: new ApiError(401, 'Não autenticado.') });

    await render(<PerfilScreen />);

    expect(screen.queryByText('cliente@example.com')).toBeNull();
    expect(screen.queryByText('+5511999999999')).toBeNull();
  });

  describe('Notificações push (M7)', () => {
    it('permissão concedida: mostra o estado ativado, sem botão de ação', async () => {
      await render(<PerfilScreen />);

      expect(screen.getByTestId('notifications-granted')).toBeTruthy();
      expect(screen.queryByTestId('notifications-request-permission')).toBeNull();
      expect(screen.queryByTestId('notifications-open-settings')).toBeNull();
    });

    it('permissão nunca solicitada (undetermined): mostra o botão "Ativar notificações"', async () => {
      mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'undetermined', canAskAgain: true } });

      await render(<PerfilScreen />);

      expect(screen.getByTestId('notifications-request-permission')).toBeTruthy();
    });

    it('tocar em "Ativar notificações" chama o pedido de permissão real do sistema', async () => {
      const mutate = jest.fn();
      mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'undetermined', canAskAgain: true } });
      mockedUseRequestPushPermission.mockReturnValue({ mutate, isPending: false });

      await render(<PerfilScreen />);
      await fireEvent.press(screen.getByTestId('notifications-request-permission'));

      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('permissão negada mas ainda pode perguntar de novo: mostra "Ativar notificações", nunca o botão de configurações', async () => {
      mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'denied', canAskAgain: true } });

      await render(<PerfilScreen />);

      expect(screen.getByTestId('notifications-request-permission')).toBeTruthy();
      expect(screen.queryByTestId('notifications-open-settings')).toBeNull();
    });

    it('permissão bloqueada permanentemente (canAskAgain=false): mostra "Abrir configurações", nunca pede permissão de novo', async () => {
      mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'denied', canAskAgain: false } });
      const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

      await render(<PerfilScreen />);
      await fireEvent.press(screen.getByTestId('notifications-open-settings'));

      expect(screen.queryByTestId('notifications-request-permission')).toBeNull();
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);
      openSettingsSpy.mockRestore();
    });

    it('logout remove o token de push ANTES de encerrar a sessão (enquanto ainda há sessão válida pra autorizar a remoção)', async () => {
      const signOut = jest.fn().mockResolvedValue(undefined);
      const getToken = jest.fn().mockResolvedValue('token-abc');
      mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, signOut, getToken });
      const removeMutateAsync = jest.fn().mockResolvedValue(undefined);
      mockedUseRemovePushToken.mockReturnValue({ mutateAsync: removeMutateAsync });
      mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]' });

      const callOrder: string[] = [];
      removeMutateAsync.mockImplementation(async () => {
        callOrder.push('remove-push-token');
      });
      signOut.mockImplementation(async () => {
        callOrder.push('sign-out');
      });

      await render(<PerfilScreen />);
      await fireEvent.press(screen.getByTestId('profile-sign-out'));

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
      expect(removeMutateAsync).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]' });
      expect(callOrder).toEqual(['remove-push-token', 'sign-out']);
    });

    it('logout sem nenhum token de push registrado: nunca chama a remoção, ainda assim encerra a sessão', async () => {
      const signOut = jest.fn().mockResolvedValue(undefined);
      mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, signOut, getToken: jest.fn() });
      const removeMutateAsync = jest.fn();
      mockedUseRemovePushToken.mockReturnValue({ mutateAsync: removeMutateAsync });
      mockedUseExpoPushToken.mockReturnValue({ data: undefined });

      await render(<PerfilScreen />);
      await fireEvent.press(screen.getByTestId('profile-sign-out'));

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
      expect(removeMutateAsync).not.toHaveBeenCalled();
    });

    it('falha ao remover o token de push nunca impede o logout', async () => {
      const signOut = jest.fn().mockResolvedValue(undefined);
      mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, signOut, getToken: jest.fn() });
      mockedUseRemovePushToken.mockReturnValue({
        mutateAsync: jest.fn().mockRejectedValue(new Error('rede indisponível')),
      });
      mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]' });

      await render(<PerfilScreen />);
      await fireEvent.press(screen.getByTestId('profile-sign-out'));

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    });
  });
});
