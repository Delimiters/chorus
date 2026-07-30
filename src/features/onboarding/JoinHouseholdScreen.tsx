import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatInviteCode, normalizeInviteCode } from '@/data/api/invites';
import { useJoinHousehold } from '@/data/hooks/useHousehold';
import { Button, Field, Stack, Txt } from '@/design/components';
import { useColors } from '@/design/theme';
import { space, type } from '@/design/tokens';

export function JoinHouseholdScreen() {
  const colors = useColors();
  const join = useJoinHousehold();
  const [code, setCode] = useState('');

  const normalized = normalizeInviteCode(code);
  const canSubmit = normalized.length === 8;

  const submit = (): void => {
    if (!canSubmit) return;
    join.mutate(normalized);
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
                Enter the invite code
              </Txt>
              <Txt tone="muted">Eight characters, from whoever set up the household.</Txt>
            </Stack>

            <Field
              label="Invite code"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              placeholder="7K4M-92XB"
              returnKeyType="go"
              onSubmitEditing={submit}
              maxLength={9}
              inputStyle={type.mono}
              hint={
                canSubmit ? formatInviteCode(normalized) : `${normalized.length} of 8 characters`
              }
            />

            {join.isError ? (
              <Txt variant="small" tone="danger">
                {join.error.message}
              </Txt>
            ) : null}

            <Button
              label="Join household"
              onPress={submit}
              loading={join.isPending}
              disabled={!canSubmit}
            />
          </Stack>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
