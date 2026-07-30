import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSignUp } from '@/data/hooks/useAuth';
import { Button, Field, Stack, Txt } from '@/design/components';
import { useColors } from '@/design/theme';
import { space } from '@/design/tokens';

/** Supabase's own default minimum. Stated up front rather than after a failure. */
const MIN_PASSWORD = 8;

export function SignUpScreen() {
  const colors = useColors();
  const signUp = useSignUp();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit =
    displayName.trim().length > 0 && email.trim().length > 0 && password.length >= MIN_PASSWORD;

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    signUp.mutate({ email, password, displayName });
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
                Create an account
              </Txt>
              <Txt tone="muted">
                You&apos;ll set up your household next, then invite whoever you live with.
              </Txt>
            </Stack>

            <Stack gap={space.md}>
              <Field
                label="Your name"
                value={displayName}
                onChangeText={setDisplayName}
                autoComplete="name"
                textContentType="givenName"
                placeholder="Jake"
                hint="This is what your housemate sees next to a chore."
              />
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={submit}
                error={
                  touched && passwordTooShort ? `At least ${MIN_PASSWORD} characters.` : undefined
                }
                hint={`At least ${MIN_PASSWORD} characters.`}
              />

              {signUp.isError ? (
                <Txt variant="small" tone="danger">
                  {signUp.error.message}
                </Txt>
              ) : null}

              <Button
                label="Create account"
                onPress={submit}
                loading={signUp.isPending}
                disabled={!canSubmit}
              />
            </Stack>

            <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'baseline' }}>
              <Txt variant="small" tone="faint">
                Already have an account?
              </Txt>
              <Link href="/sign-in" accessibilityRole="link">
                <Txt variant="small" tone="accent">
                  Sign in
                </Txt>
              </Link>
            </View>
          </Stack>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
