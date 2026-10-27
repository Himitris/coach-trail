import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';

import { colors } from './src/theme';
import { loadBaseURL } from './src/api';

import DashboardScreen from './src/screens/DashboardScreen';
import ActivitiesScreen from './src/screens/ActivitiesScreen';
import ActivityDetailScreen from './src/screens/ActivityDetailScreen';
import StatsScreen from './src/screens/StatsScreen';
import ZonesScreen from './src/screens/ZonesScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.cardBorder,
  },
};

const screenOpts = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
};

function ActivitiesStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="ActivitiesList" component={ActivitiesScreen} options={{ title: 'Activités' }} />
      <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} options={{ title: 'Détail' }} />
    </Stack.Navigator>
  );
}

function TabIcon({ name, focused }) {
  const icons = {
    Dashboard: focused ? '⬡' : '⬡',
    Activités: focused ? '▶' : '▷',
    Stats: focused ? '▮▮' : '▯▯',
    Zones: focused ? '♥' : '♡',
    Réglages: focused ? '⚙' : '⚙',
  };
  return (
    <Text style={{ fontSize: 18, color: focused ? colors.accent : colors.textMuted }}>
      {icons[name] ?? '●'}
    </Text>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadBaseURL().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          ...screenOpts,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.cardBorder,
            height: 60,
            paddingBottom: 8,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
          headerShown: route.name !== 'Activités',
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
        <Tab.Screen name="Activités" component={ActivitiesStack} options={{ headerShown: false }} />
        <Tab.Screen name="Stats" component={StatsScreen} />
        <Tab.Screen name="Zones" component={ZonesScreen} />
        <Tab.Screen name="Réglages" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
