import React, { useCallback, useEffect, useState } from "react";
import { TouchableOpacity } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import LoginScreen from "./src/screens/LoginScreen";
import SignupScreen from "./src/screens/SignupScreen";

import ChatScreen from "./src/screens/ChatScreen";
import TasksScreen from "./src/screens/TasksScreen";
import FocusScreen from "./src/screens/FocusScreen";
import InsightsScreen from "./src/screens/InsightsScreen";
import PreferencesScreen from "./src/screens/PreferencesScreen";

import { clearToken } from "./src/authStorage";
import { api } from "./src/api";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function AppTabs({ onLogout }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        headerRight: () => (
          <TouchableOpacity onPress={onLogout} style={{ paddingHorizontal: 14 }}>
            <Ionicons name="log-out-outline" size={24} color="#A11B1B" />
          </TouchableOpacity>
        ),
        tabBarActiveTintColor: "#111",
        tabBarInactiveTintColor: "#111",
        tabBarStyle: { height: 78, paddingBottom: 12, paddingTop: 10 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "800" },
        tabBarIcon: ({ color, focused }) => {
          let icon = "home-outline";
          if (route.name === "Chat") icon = focused ? "home" : "home-outline";
          if (route.name === "Tasks") icon = focused ? "book" : "book-outline";
          if (route.name === "Focus") icon = focused ? "time" : "time-outline";
          if (route.name === "Insights") icon = focused ? "pulse" : "pulse-outline";
          if (route.name === "Prefs") icon = focused ? "settings" : "settings-outline";
          return <Ionicons name={icon} size={26} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Tasks" component={TasksScreen} />
      <Tab.Screen name="Focus" component={FocusScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Prefs" component={PreferencesScreen} options={{ tabBarLabel: "Prefs" }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(false);

  const logout = useCallback(() => {
    setAuthed(false);
    clearToken().catch(() => {});
  }, []);

  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      async (err) => {
        if (err?.response?.status === 401) {
          await logout();
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [logout]);

  return (
    <NavigationContainer key={authed ? "app" : "auth"}>
      {authed ? (
        <AppTabs onLogout={logout} />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login">
            {(props) => (
              <LoginScreen
                {...props}
                onAuthed={() => setAuthed(true)}
                goSignup={() => props.navigation.replace("Signup")}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Signup">
            {(props) => (
              <SignupScreen
                {...props}
                onAuthed={() => setAuthed(true)}
                goLogin={() => props.navigation.replace("Login")}
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
