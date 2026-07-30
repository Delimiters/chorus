import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSignIn } from '@/data/hooks/useAuth';
import { Button, Field, Stack, Txt } from '@/design/components';
import { useColors } from '@/design/theme';
import { space } from '@/design/tokens';

export function SignInScreen() {
  const colors = useColors();
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const submit = (): void => {
    if (!canSubmit) return;
    signIn.mutate({ email, password });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <Stack gap={space.xl}>
            <Stack gap={space.xs}>
              <Txt variant="display" accessibilityRole="header">
                Chorus
              </Txt>
              <Txt tone="muted">Shared chores, shared reminders.</Txt>
            </Stack>

            <Stack gap={space.md}>
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
                returnKeyType="next"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
              />

              {signIn.isError ? (
                <Txt variant="small" tone="danger">
                  {signIn.error.message}
                </Txt>
              ) : null}

              <Button
                label="Sign in"
                onPress={submit}
                loading={signIn.isPending}
                disabled={!canSubmit}
              />
            </Stack>

            <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'baseline' }}>
              <Txt variant="small" tone="faint">
                No account yet?
              </Txt>
              <Link href="/sign-up" accessibilityRole="link">
                <Txt variant="small" tone="accent">
                  Create one
                </Txt>
              </Link>
            </View>
          </Stack>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
