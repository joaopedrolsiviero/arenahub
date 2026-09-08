import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/constants/theme';

// Navegação inferior com as quatro abas do MVP (item 8 do prompt) — usa o
// Tabs nativo do próprio Expo Router (@react-navigation/bottom-tabs por
// baixo), nenhuma biblioteca extra. Dependência de login/dado remoto por
// aba (M7): "Início" é um placeholder estático; "Explorar" busca dado
// remoto público (useDiscoverArenas, sem exigir login — mesma descoberta
// pública do web); "Reservas" e "Perfil" exigem login (useAuth().isSignedIn)
// e buscam dado remoto do próprio usuário (useMyBookings/useMyProfile).
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="explorar"
        options={{
          title: 'Explorar',
          tabBarIcon: ({ color, size }) => <Ionicons name="compass" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reservas"
        options={{
          title: 'Reservas',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
