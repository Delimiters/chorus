export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      chore_categories: {
        Row: {
          created_at: string
          household_id: string
          icon: string | null
          id: string
          ink: string | null
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          household_id: string
          icon?: string | null
          id?: string
          ink?: string | null
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          icon?: string | null
          id?: string
          ink?: string | null
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chore_categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      chore_completions: {
        Row: {
          chore_id: string
          completed_at: string
          completed_by: string | null
          completed_by_name: string | null
          completed_on: string
          due_on: string
          household_id: string
          id: string
          note: string | null
          occurrence_key: string
        }
        Insert: {
          chore_id: string
          completed_at?: string
          completed_by?: string | null
          completed_by_name?: string | null
          completed_on: string
          due_on: string
          household_id: string
          id?: string
          note?: string | null
          occurrence_key: string
        }
        Update: {
          chore_id?: string
          completed_at?: string
          completed_by?: string | null
          completed_by_name?: string | null
          completed_on?: string
          due_on?: string
          household_id?: string
          id?: string
          note?: string | null
          occurrence_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "chore_completions_chore_id_fkey"
            columns: ["chore_id"]
            isOneToOne: false
            referencedRelation: "chores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_completions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      chore_exceptions: {
        Row: {
          chore_id: string
          created_at: string
          created_by: string | null
          due_on: string
          household_id: string
          id: string
          kind: Database["public"]["Enums"]["exception_kind"]
          moved_to: string | null
          occurrence_key: string
          reason: string | null
        }
        Insert: {
          chore_id: string
          created_at?: string
          created_by?: string | null
          due_on: string
          household_id: string
          id?: string
          kind: Database["public"]["Enums"]["exception_kind"]
          moved_to?: string | null
          occurrence_key: string
          reason?: string | null
        }
        Update: {
          chore_id?: string
          created_at?: string
          created_by?: string | null
          due_on?: string
          household_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["exception_kind"]
          moved_to?: string | null
          occurrence_key?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chore_exceptions_chore_id_fkey"
            columns: ["chore_id"]
            isOneToOne: false
            referencedRelation: "chores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_exceptions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      chores: {
        Row: {
          archived_at: string | null
          assignment: Json
          assignment_kind: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          ends_on: string | null
          household_id: string
          icon: string | null
          id: string
          notes: string | null
          priority: string
          schedule: Json
          schedule_kind: string | null
          starts_on: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignment?: Json
          assignment_kind?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          household_id: string
          icon?: string | null
          id?: string
          notes?: string | null
          priority?: string
          schedule: Json
          schedule_kind?: string | null
          starts_on?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignment?: Json
          assignment_kind?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          household_id?: string
          icon?: string | null
          id?: string
          notes?: string | null
          priority?: string
          schedule?: Json
          schedule_kind?: string | null
          starts_on?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chores_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chore_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chores_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chores_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string
          household_id: string
          id: string
          redeemed_at: string | null
          redeemed_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          household_id: string
          id?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          household_id?: string
          id?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "household_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_invites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_invites_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          accent: string
          household_id: string
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          share_routine: boolean
          sort_order: number
          user_id: string
        }
        Insert: {
          accent?: string
          household_id: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          share_routine?: boolean
          sort_order?: number
          user_id: string
        }
        Update: {
          accent?: string
          household_id?: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          share_routine?: boolean
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          created_by: string | null
          default_reminder_time: string | null
          id: string
          name: string
          time_zone: string
          updated_at: string
          week_starts_on: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_reminder_time?: string | null
          id?: string
          name: string
          time_zone?: string
          updated_at?: string
          week_starts_on?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_reminder_time?: string | null
          id?: string
          name?: string
          time_zone?: string
          updated_at?: string
          week_starts_on?: number
        }
        Relationships: [
          {
            foreignKeyName: "households_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          device_name: string | null
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_completions: {
        Row: {
          completed_at: string
          completed_on: string
          due_on: string
          household_id: string
          id: string
          occurrence_key: string
          routine_item_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          completed_on: string
          due_on: string
          household_id: string
          id?: string
          occurrence_key: string
          routine_item_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          completed_on?: string
          due_on?: string
          household_id?: string
          id?: string
          occurrence_key?: string
          routine_item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_completions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_completions_routine_item_id_fkey"
            columns: ["routine_item_id"]
            isOneToOne: false
            referencedRelation: "routine_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_items: {
        Row: {
          archived_at: string | null
          bucket: string | null
          bucket_choice: string | null
          created_at: string
          ends_on: string | null
          household_id: string
          icon: string | null
          id: string
          linked_chore_id: string | null
          notes: string | null
          remind: boolean
          schedule: Json
          schedule_kind: string | null
          starts_on: string | null
          time_of_day: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          bucket?: string | null
          bucket_choice?: string | null
          created_at?: string
          ends_on?: string | null
          household_id: string
          icon?: string | null
          id?: string
          linked_chore_id?: string | null
          notes?: string | null
          remind?: boolean
          schedule: Json
          schedule_kind?: string | null
          starts_on?: string | null
          time_of_day?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          bucket?: string | null
          bucket_choice?: string | null
          created_at?: string
          ends_on?: string | null
          household_id?: string
          icon?: string | null
          id?: string
          linked_chore_id?: string | null
          notes?: string | null
          remind?: boolean
          schedule?: Json
          schedule_kind?: string | null
          starts_on?: string | null
          time_of_day?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_items_linked_chore_fkey"
            columns: ["linked_chore_id", "household_id"]
            isOneToOne: false
            referencedRelation: "chores"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "routine_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_household: {
        Args: { household_name: string; tz?: string; week_start?: number }
        Returns: string
      }
      delete_my_account: { Args: never; Returns: undefined }
      redeem_invite: { Args: { invite_code: string }; Returns: string }
      tick_routine: {
        Args: {
          p_chore?: string
          p_chore_due_on?: string
          p_chore_occ?: string
          p_completed_on: string
          p_due_on: string
          p_item: string
          p_occurrence: string
        }
        Returns: undefined
      }
      untick_routine: {
        Args: {
          p_chore?: string
          p_chore_occ?: string
          p_item: string
          p_occurrence: string
        }
        Returns: undefined
      }
    }
    Enums: {
      exception_kind: "skip" | "reschedule"
      member_role: "owner" | "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      exception_kind: ["skip", "reschedule"],
      member_role: ["owner", "admin", "member"],
    },
  },
} as const

