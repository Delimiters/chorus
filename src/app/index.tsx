import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Placeholder shell. Real screens arrive in Phase 4 (auth) and Phase 5 (agenda).
 * This exists so Phase 0 has something that visibly boots in Expo Go.
 */
export default function Index() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Chore Hero</Text>
        <Text style={styles.subtitle}>Phase 0 — foundations</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 16, opacity: 0.6 },
});
