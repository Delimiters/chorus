/**
 * Reminder preferences.
 *
 * On the device, not in the database, and that is a decision rather than an
 * oversight: a local notification fires from the phone that scheduled it, so
 * "remind me at 7am" is a fact about *this device*, not about the household. Two
 * people sharing a list should not share a reminder time, and syncing one would
 * mean one of them silently getting the other's.
 *
 * Persisted through the same storage the session uses, so preferences survive a
 * restart without a round trip.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { DEFAULT_POLICY, type ReminderPolicy } from '@/core/notify/plan';
import type { CivilTime } from '@/core/civil/types';
import { BUCKETS, DEFAULT_BUCKET_TIMES, type TimeBucket } from '@/core/routines/buckets';

const STORAGE_KEY = 'chorus.reminders.v1';

interface ReminderState {
  readonly policy: ReminderPolicy;
  /** False until the stored value has been read, so nothing is written over it. */
  readonly hydrated: boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setDefaultTime: (time: CivilTime) => void;
  readonly setIncludeUnassigned: (include: boolean) => void;
  readonly setIncludeOthers: (include: boolean) => void;
  readonly setIncludeRoutines: (include: boolean) => void;
  readonly setBucketTime: (bucket: TimeBucket, time: CivilTime) => void;
  readonly hydrate: () => Promise<void>;
}

/** Only the parts worth persisting; the rest is derived or constant. */
interface Stored {
  enabled?: boolean;
  defaultTime?: string;
  includeUnassigned?: boolean;
  includeOthers?: boolean;
  includeRoutines?: boolean;
  bucketTimes?: Record<string, string>;
}

function persist(policy: ReminderPolicy): void {
  const stored: Stored = {
    enabled: policy.enabled,
    defaultTime: policy.defaultTime,
    includeUnassigned: policy.includeUnassigned,
    includeOthers: policy.includeOthers,
    includeRoutines: policy.includeRoutines,
    bucketTimes: policy.bucketTimes,
  };
  // Fire and forget: a failed write costs a preference, not correctness, and
  // blocking a toggle on disk would make the switch feel broken.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export const useReminderStore = create<ReminderState>((set, get) => ({
  policy: DEFAULT_POLICY,
  hydrated: false,

  setEnabled: (enabled) => {
    const policy = { ...get().policy, enabled };
    set({ policy });
    persist(policy);
  },

  setDefaultTime: (defaultTime) => {
    const policy = { ...get().policy, defaultTime };
    set({ policy });
    persist(policy);
  },

  setIncludeUnassigned: (includeUnassigned) => {
    const policy = { ...get().policy, includeUnassigned };
    set({ policy });
    persist(policy);
  },

  setIncludeOthers: (includeOthers) => {
    const policy = { ...get().policy, includeOthers };
    set({ policy });
    persist(policy);
  },

  setIncludeRoutines: (includeRoutines) => {
    const policy = { ...get().policy, includeRoutines };
    set({ policy });
    persist(policy);
  },

  setBucketTime: (bucket, time) => {
    const policy = {
      ...get().policy,
      bucketTimes: { ...get().policy.bucketTimes, [bucket]: time },
    };
    set({ policy });
    persist(policy);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const stored = JSON.parse(raw) as Stored;
        set({
          policy: {
            ...DEFAULT_POLICY,
            // Each field defended individually. A stored blob from an older
            // version is missing keys rather than malformed, and losing every
            // preference because one is absent would be a poor trade.
            ...(typeof stored.enabled === 'boolean' ? { enabled: stored.enabled } : {}),
            ...(typeof stored.defaultTime === 'string' && /^\d{2}:\d{2}$/.test(stored.defaultTime)
              ? { defaultTime: stored.defaultTime as CivilTime }
              : {}),
            ...(typeof stored.includeUnassigned === 'boolean'
              ? { includeUnassigned: stored.includeUnassigned }
              : {}),
            ...(typeof stored.includeOthers === 'boolean'
              ? { includeOthers: stored.includeOthers }
              : {}),
            ...(typeof stored.includeRoutines === 'boolean'
              ? { includeRoutines: stored.includeRoutines }
              : {}),
            // Per bucket, and each one checked on its own: a stored blob from
            // before this setting existed is missing keys rather than
            // malformed, and one bad value should not cost the other three.
            ...{
              bucketTimes: BUCKETS.reduce<Record<TimeBucket, CivilTime>>(
                (acc, bucket) => {
                  const value = stored.bucketTimes?.[bucket];
                  if (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
                    acc[bucket] = value as CivilTime;
                  }
                  return acc;
                },
                { ...DEFAULT_BUCKET_TIMES },
              ),
            },
          },
        });
      }
    } catch {
      // Unreadable preferences are not worth a crash on launch; the defaults
      // are perfectly usable and the next change overwrites them.
    } finally {
      set({ hydrated: true });
    }
  },
}));

export const useReminderPolicy = (): ReminderPolicy => useReminderStore((s) => s.policy);
