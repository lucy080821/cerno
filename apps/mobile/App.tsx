import { StatusBar } from "expo-status-bar";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { BRAND, SCHEMA_VERSION } from "@dashboard/schema";

export default function App() {
  return (
    <View style={styles.container}>
      <Image source={require("./assets/icon.png")} style={styles.logo} accessibilityLabel="Cerno" />
      <Text style={styles.title}>Cerno</Text>
      <Text style={styles.sub}>Kết nối thành công ✅</Text>
      <Text style={styles.meta}>
        {Platform.OS} · schema v{SCHEMA_VERSION}
      </Text>
      <StatusBar style="light" />
    </View>
  );
}

// Màu và logo giống web: BRAND ở packages/schema/src/brand.ts, icon.png sinh từ cùng hình học với app/icon.svg.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND.ink, alignItems: "center", justifyContent: "center", gap: 8 },
  logo: { width: 96, height: 96, borderRadius: 22, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: "800", color: "#e8edf7", letterSpacing: 0.5 },
  sub: { fontSize: 16, color: BRAND.teal },
  meta: { fontSize: 13, color: "#8b97b1" },
});
