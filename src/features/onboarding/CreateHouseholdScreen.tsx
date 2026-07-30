import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deviceCalendarDefaults, useCreateHousehold } from '@/data/hooks/useHousehold';
import { Button, Field, Stack, Txt } from '@/design/components';
import { useColors } from '@/design/theme';
import { space } from '@/design/tokens';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function CreateHouseholdScreen() {
  const colors = useColors();
  const create = useCreateHousehold();
  const [name, setName] = useState('');

  // Read once: these come from the device and are only shown so the choice isn't
  // silent. They're editable later in settings.
  const [defaults] = useState(deviceCalendarDefaults);

  const canSubmit = name.trim().length > 0;

  const submit = (): void => {
    if (!canSubmit) return;
    create.mutate(name);
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
                Name your household
              </Txt>
              <Txt tone="muted">Whatever you two call the place. You can change it later.</Txt>
            </Stack>

            <Field
              label="Household"
              value={name}
              onChangeText={setName}
              placeholder="The House"
              returnKeyType="go"
              onSubmitEditing={submit}
              maxLength={60}
            />

            <Stack gap={space.xs}>
              <Txt variant="small" tone="faint">
                Time zone: {defaults.timeZone}
              </Txt>
              <Txt variant="small" tone="faint">
                Week starts: {WEEKDAYS[defaults.weekStartsOn]}
              </Txt>
              <Txt variant="small" tone="faint">
                Taken from your device. Both are editable in settings — the week start decides what
                &ldquo;3 times a week&rdquo; means.
              </Txt>
            </Stack>

            {create.isError ? (
              <Txt variant="small" tone="danger">
                {create.error.message}
              </Txt>
            ) : null}

            <Button
              label="Create household"
              onPress={submit}
              loading={create.isPending}
              disabled={!canSubmit}
            />
          </Stack>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
