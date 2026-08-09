export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_member_id: string | null
          actor_type: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          household_id: string
          id: string
          inbound_message_id: string | null
        }
        Insert: {
          action: string
          actor_member_id?: string | null
          actor_type: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          household_id: string
          id?: string
          inbound_message_id?: string | null
        }
        Update: {
          action?: string
          actor_member_id?: string | null
          actor_type?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          household_id?: string
          id?: string
          inbound_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_runs: {
        Row: {
          created_at: string
          error_code: string | null
          household_id: string | null
          id: string
          inbound_message_id: string | null
          input_tokens: number | null
          latency_ms: number | null
          model_identifier: string | null
          model_provider: string | null
          output_tokens: number | null
          prompt_version: string | null
          state: string
          structured_output: Json | null
          validation_result: Json | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          household_id?: string | null
          id?: string
          inbound_message_id?: string | null
          input_tokens?: number | null
          latency_ms?: number | null
          model_identifier?: string | null
          model_provider?: string | null
          output_tokens?: number | null
          prompt_version?: string | null
          state?: string
          structured_output?: Json | null
          validation_result?: Json | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          household_id?: string | null
          id?: string
          inbound_message_id?: string | null
          input_tokens?: number | null
          latency_ms?: number | null
          model_identifier?: string | null
          model_provider?: string | null
          output_tokens?: number | null
          prompt_version?: string | null
          state?: string
          structured_output?: Json | null
          validation_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_runs_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      bridges: {
        Row: {
          bluebubbles_version: string | null
          bot_handle: string | null
          created_at: string
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          last_seen_at: string | null
          macos_version: string | null
          name: string
          secret_hash: string
          status: string
          worker_version: string | null
        }
        Insert: {
          bluebubbles_version?: string | null
          bot_handle?: string | null
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_seen_at?: string | null
          macos_version?: string | null
          name: string
          secret_hash: string
          status?: string
          worker_version?: string | null
        }
        Update: {
          bluebubbles_version?: string | null
          bot_handle?: string | null
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_seen_at?: string | null
          macos_version?: string | null
          name?: string
          secret_hash?: string
          status?: string
          worker_version?: string | null
        }
        Relationships: []
      }
      channels: {
        Row: {
          bridge_id: string
          channel_type: string
          chat_guid: string
          created_at: string
          household_id: string | null
          id: string
          state: string
        }
        Insert: {
          bridge_id: string
          channel_type?: string
          chat_guid: string
          created_at?: string
          household_id?: string | null
          id?: string
          state?: string
        }
        Update: {
          bridge_id?: string
          channel_type?: string
          chat_guid?: string
          created_at?: string
          household_id?: string | null
          id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          created_at: string
          created_by_member_id: string | null
          ends_at: string | null
          household_id: string
          id: string
          location: string | null
          notes: string | null
          short_code: string
          source_message_id: string | null
          starts_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          created_by_member_id?: string | null
          ends_at?: string | null
          household_id: string
          id?: string
          location?: string | null
          notes?: string | null
          short_code?: string
          source_message_id?: string | null
          starts_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          created_at?: string
          created_by_member_id?: string | null
          ends_at?: string | null
          household_id?: string
          id?: string
          location?: string | null
          notes?: string | null
          short_code?: string
          source_message_id?: string | null
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          activated_at: string | null
          afternoon_default: string
          before_event_offset_minutes: number
          created_at: string
          display_name: string | null
          evening_default: string
          id: string
          invocation_name: string
          morning_default: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          slug: string
          state: string
          stopped_at: string | null
          timezone: string | null
        }
        Insert: {
          activated_at?: string | null
          afternoon_default?: string
          before_event_offset_minutes?: number
          created_at?: string
          display_name?: string | null
          evening_default?: string
          id?: string
          invocation_name?: string
          morning_default?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          slug?: string
          state?: string
          stopped_at?: string | null
          timezone?: string | null
        }
        Update: {
          activated_at?: string | null
          afternoon_default?: string
          before_event_offset_minutes?: number
          created_at?: string
          display_name?: string | null
          evening_default?: string
          id?: string
          invocation_name?: string
          morning_default?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          slug?: string
          state?: string
          stopped_at?: string | null
          timezone?: string | null
        }
        Relationships: []
      }
      inbound_messages: {
        Row: {
          bridge_id: string
          channel_id: string | null
          chat_guid: string
          error_code: string | null
          household_id: string | null
          id: string
          invoked_bot: boolean
          message_guid: string
          message_text: string
          processing_state: string
          raw_metadata: Json | null
          received_at: string
          sender_handle: string
        }
        Insert: {
          bridge_id: string
          channel_id?: string | null
          chat_guid: string
          error_code?: string | null
          household_id?: string | null
          id?: string
          invoked_bot?: boolean
          message_guid: string
          message_text: string
          processing_state?: string
          raw_metadata?: Json | null
          received_at?: string
          sender_handle: string
        }
        Update: {
          bridge_id?: string
          channel_id?: string | null
          chat_guid?: string
          error_code?: string | null
          household_id?: string | null
          id?: string
          invoked_bot?: boolean
          message_guid?: string
          message_text?: string
          processing_state?: string
          raw_metadata?: Json | null
          received_at?: string
          sender_handle?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          household_id: string
          member_id: string
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          household_id: string
          member_id: string
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          household_id?: string
          member_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_codes_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_codes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_links: {
        Row: {
          auth_user_id: string
          household_id: string
          linked_at: string
          member_id: string
        }
        Insert: {
          auth_user_id: string
          household_id: string
          linked_at?: string
          member_id: string
        }
        Update: {
          auth_user_id?: string
          household_id?: string
          linked_at?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_links_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_links_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          aliases: string[]
          display_name: string | null
          household_id: string
          id: string
          joined_at: string
          last_seen_at: string | null
          normalized_handle: string
          removed_at: string | null
        }
        Insert: {
          aliases?: string[]
          display_name?: string | null
          household_id: string
          id?: string
          joined_at?: string
          last_seen_at?: string | null
          normalized_handle: string
          removed_at?: string | null
        }
        Update: {
          aliases?: string[]
          display_name?: string | null
          household_id?: string
          id?: string
          joined_at?: string
          last_seen_at?: string | null
          normalized_handle?: string
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox: {
        Row: {
          attempts: number
          bridge_id: string
          channel_id: string | null
          chat_guid: string
          created_at: string
          dedupe_key: string
          household_id: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          message_text: string
          message_type: string
          not_before: string | null
          sent_at: string | null
          state: string
        }
        Insert: {
          attempts?: number
          bridge_id: string
          channel_id?: string | null
          chat_guid: string
          created_at?: string
          dedupe_key: string
          household_id?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          message_text: string
          message_type: string
          not_before?: string | null
          sent_at?: string | null
          state?: string
        }
        Update: {
          attempts?: number
          bridge_id?: string
          channel_id?: string | null
          chat_guid?: string
          created_at?: string
          dedupe_key?: string
          household_id?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          message_text?: string
          message_type?: string
          not_before?: string | null
          sent_at?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_clarifications: {
        Row: {
          created_at: string
          draft_action: Json
          expires_at: string
          household_id: string
          id: string
          missing_field: string
          question_text: string
          requester_member_id: string | null
          resolved_at: string | null
          state: string
        }
        Insert: {
          created_at?: string
          draft_action: Json
          expires_at?: string
          household_id: string
          id?: string
          missing_field: string
          question_text: string
          requester_member_id?: string | null
          resolved_at?: string | null
          state?: string
        }
        Update: {
          created_at?: string
          draft_action?: Json
          expires_at?: string
          household_id?: string
          id?: string
          missing_field?: string
          question_text?: string
          requester_member_id?: string | null
          resolved_at?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_clarifications_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_clarifications_requester_member_id_fkey"
            columns: ["requester_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          assignee_member_id: string | null
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          enqueued_at: string | null
          event_id: string | null
          fire_at: string
          household_id: string
          id: string
          state: string
          task_id: string | null
        }
        Insert: {
          assignee_member_id?: string | null
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          enqueued_at?: string | null
          event_id?: string | null
          fire_at: string
          household_id: string
          id?: string
          state?: string
          task_id?: string | null
        }
        Update: {
          assignee_member_id?: string | null
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          enqueued_at?: string | null
          event_id?: string | null
          fire_at?: string
          household_id?: string
          id?: string
          state?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_assignee_member_id_fkey"
            columns: ["assignee_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_member_id: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by_member_id: string | null
          due_at: string | null
          household_id: string
          id: string
          notes: string | null
          short_code: string
          source_message_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_member_id?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_member_id?: string | null
          due_at?: string | null
          household_id: string
          id?: string
          notes?: string | null
          short_code?: string
          source_message_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_member_id?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_member_id?: string | null
          due_at?: string | null
          household_id?: string
          id?: string
          notes?: string | null
          short_code?: string
          source_message_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_member_id_fkey"
            columns: ["assignee_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_link_member_by_email: { Args: never; Returns: string[] }
      enqueue_due_reminders: { Args: never; Returns: undefined }
      expire_clarifications: { Args: never; Returns: undefined }
      fambot_nanoid: { Args: { size?: number }; Returns: string }
      redeem_link_code: { Args: { p_code: string }; Returns: Json }
      release_expired_outbox_leases: { Args: never; Returns: undefined }
      update_household_settings: {
        Args: {
          p_afternoon_default?: string
          p_before_event_offset_minutes?: number
          p_display_name?: string
          p_evening_default?: string
          p_household_id: string
          p_invocation_name?: string
          p_morning_default?: string
          p_quiet_hours_end?: string
          p_quiet_hours_start?: string
          p_timezone?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

