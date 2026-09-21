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
      amenities: {
        Row: {
          code: string
          name: string
        }
        Insert: {
          code: string
          name: string
        }
        Update: {
          code?: string
          name?: string
        }
        Relationships: []
      }
      booking_events: {
        Row: {
          booking_id: string
          created_at: string
          event_type: string
          id: string
          public_summary: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          event_type: string
          id?: string
          public_summary: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          event_type?: string
          id?: string
          public_summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_slots: {
        Row: {
          booking_id: string
          master_owner_id: string
          quoted_amount_minor: number
          resource_id: string
          slot_id: string
          turf_id: string
        }
        Insert: {
          booking_id: string
          master_owner_id: string
          quoted_amount_minor: number
          resource_id: string
          slot_id: string
          turf_id: string
        }
        Update: {
          booking_id?: string
          master_owner_id?: string
          quoted_amount_minor?: number
          resource_id?: string
          slot_id?: string
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_slots_booking_id_resource_id_turf_id_master_owner__fkey"
            columns: ["booking_id", "resource_id", "turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: [
              "id",
              "resource_id",
              "turf_id",
              "master_owner_id",
            ]
          },
          {
            foreignKeyName: "booking_slots_slot_id_resource_id_turf_id_master_owner_id_fkey"
            columns: ["slot_id", "resource_id", "turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: [
              "id",
              "resource_id",
              "turf_id",
              "master_owner_id",
            ]
          },
        ]
      }
      bookings: {
        Row: {
          cancellation_snapshot: Json
          cancelled_at: string | null
          commission_snapshot: Json
          confirmed_at: string | null
          created_at: string
          created_by: string
          currency: string
          ends_at: string
          hold_expires_at: string | null
          id: string
          master_owner_id: string
          payment_exception_reason: string | null
          player_user_id: string | null
          pricing_snapshot: Json
          reference_code: string
          required_online_minor: number
          resource_id: string
          source: string
          starts_at: string
          status: string
          total_minor: number
          turf_id: string
          version: number
        }
        Insert: {
          cancellation_snapshot: Json
          cancelled_at?: string | null
          commission_snapshot: Json
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          currency?: string
          ends_at: string
          hold_expires_at?: string | null
          id?: string
          master_owner_id: string
          payment_exception_reason?: string | null
          player_user_id?: string | null
          pricing_snapshot: Json
          reference_code: string
          required_online_minor: number
          resource_id: string
          source: string
          starts_at: string
          status?: string
          total_minor: number
          turf_id: string
          version?: number
        }
        Update: {
          cancellation_snapshot?: Json
          cancelled_at?: string | null
          commission_snapshot?: Json
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          ends_at?: string
          hold_expires_at?: string | null
          id?: string
          master_owner_id?: string
          payment_exception_reason?: string | null
          player_user_id?: string | null
          pricing_snapshot?: Json
          reference_code?: string
          required_online_minor?: number
          resource_id?: string
          source?: string
          starts_at?: string
          status?: string
          total_minor?: number
          turf_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bookings_player_user_id_fkey"
            columns: ["player_user_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bookings_resource_id_turf_id_master_owner_id_fkey"
            columns: ["resource_id", "turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id", "turf_id", "master_owner_id"]
          },
        ]
      }
      cancellation_policies: {
        Row: {
          created_at: string
          id: string
          master_owner_id: string
          name: string
          rules: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          master_owner_id: string
          name: string
          rules: Json
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          master_owner_id?: string
          name?: string
          rules?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_policies_master_owner_id_fkey"
            columns: ["master_owner_id"]
            isOneToOne: false
            referencedRelation: "master_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_turf_assignments: {
        Row: {
          active: boolean
          created_at: string
          employee_id: string
          id: string
          master_owner_id: string
          turf_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          employee_id: string
          id?: string
          master_owner_id: string
          turf_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          employee_id?: string
          id?: string
          master_owner_id?: string
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_turf_assignments_employee_id_master_owner_id_fkey"
            columns: ["employee_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "master_owner_id"]
          },
          {
            foreignKeyName: "employee_turf_assignments_turf_id_master_owner_id_fkey"
            columns: ["turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "turfs"
            referencedColumns: ["id", "master_owner_id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          id: string
          master_owner_id: string
          permission_version: number
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_owner_id: string
          permission_version?: number
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          master_owner_id?: string
          permission_version?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_master_owner_id_fkey"
            columns: ["master_owner_id"]
            isOneToOne: false
            referencedRelation: "master_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      inventory_allocations: {
        Row: {
          booking_id: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          expires_at: string | null
          id: string
          kind: string
          master_owner_id: string
          occupied_period: unknown
          reason: string | null
          released_at: string | null
          resource_id: string
          starts_at: string
          turf_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          expires_at?: string | null
          id?: string
          kind: string
          master_owner_id: string
          occupied_period?: unknown
          reason?: string | null
          released_at?: string | null
          resource_id: string
          starts_at: string
          turf_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          master_owner_id?: string
          occupied_period?: unknown
          reason?: string | null
          released_at?: string | null
          resource_id?: string
          starts_at?: string
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_allocations_booking_id_master_owner_id_fkey"
            columns: ["booking_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "master_owner_id"]
          },
          {
            foreignKeyName: "inventory_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "inventory_allocations_resource_id_turf_id_master_owner_id_fkey"
            columns: ["resource_id", "turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id", "turf_id", "master_owner_id"]
          },
        ]
      }
      master_owners: {
        Row: {
          business_name: string
          created_at: string
          id: string
          owner_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          business_name: string
          created_at?: string
          id?: string
          owner_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          business_name?: string
          created_at?: string
          id?: string
          owner_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_owners_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          deep_link: string | null
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deep_link?: string | null
          id?: string
          kind: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deep_link?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      operating_exceptions: {
        Row: {
          closed: boolean
          id: string
          local_date: string
          override_periods: Json | null
          reason: string | null
          resource_id: string
        }
        Insert: {
          closed: boolean
          id?: string
          local_date: string
          override_periods?: Json | null
          reason?: string | null
          resource_id: string
        }
        Update: {
          closed?: boolean
          id?: string
          local_date?: string
          override_periods?: Json | null
          reason?: string | null
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_exceptions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_hours: {
        Row: {
          closes_at: string
          closes_next_day: boolean
          id: string
          iso_weekday: number
          opens_at: string
          resource_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          closes_at: string
          closes_next_day?: boolean
          id?: string
          iso_weekday: number
          opens_at: string
          resource_id: string
          valid_from: string
          valid_until?: string | null
        }
        Update: {
          closes_at?: string
          closes_next_day?: boolean
          id?: string
          iso_weekday?: number
          opens_at?: string
          resource_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operating_hours_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          preferred_timezone: string
          user_id: string
        }
        Insert: {
          created_at?: string
          preferred_timezone?: string
          user_id: string
        }
        Update: {
          created_at?: string
          preferred_timezone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          active: boolean
          amount_per_increment_minor: number
          created_at: string
          currency: string
          ends_local: string
          id: string
          iso_weekdays: number[]
          master_owner_id: string
          priority: number
          resource_id: string
          starts_local: string
          turf_id: string
          updated_at: string
          valid_from: string
          valid_until: string | null
          version: number
        }
        Insert: {
          active?: boolean
          amount_per_increment_minor: number
          created_at?: string
          currency?: string
          ends_local: string
          id?: string
          iso_weekdays: number[]
          master_owner_id: string
          priority?: number
          resource_id: string
          starts_local: string
          turf_id: string
          updated_at?: string
          valid_from: string
          valid_until?: string | null
          version?: number
        }
        Update: {
          active?: boolean
          amount_per_increment_minor?: number
          created_at?: string
          currency?: string
          ends_local?: string
          id?: string
          iso_weekdays?: number[]
          master_owner_id?: string
          priority?: number
          resource_id?: string
          starts_local?: string
          turf_id?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_resource_id_turf_id_master_owner_id_fkey"
            columns: ["resource_id", "turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id", "turf_id", "master_owner_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resource_sports: {
        Row: {
          resource_id: string
          sport_code: string
        }
        Insert: {
          resource_id: string
          sport_code: string
        }
        Update: {
          resource_id?: string
          sport_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_sports_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_sports_sport_code_fkey"
            columns: ["sport_code"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["code"]
          },
        ]
      }
      resources: {
        Row: {
          active: boolean
          booking_increment_minutes: number
          id: string
          master_owner_id: string
          maximum_duration_minutes: number
          minimum_duration_minutes: number
          name: string
          schedule_version: number
          turf_id: string
        }
        Insert: {
          active?: boolean
          booking_increment_minutes?: number
          id?: string
          master_owner_id: string
          maximum_duration_minutes?: number
          minimum_duration_minutes?: number
          name: string
          schedule_version?: number
          turf_id: string
        }
        Update: {
          active?: boolean
          booking_increment_minutes?: number
          id?: string
          master_owner_id?: string
          maximum_duration_minutes?: number
          minimum_duration_minutes?: number
          name?: string
          schedule_version?: number
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_turf_id_master_owner_id_fkey"
            columns: ["turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "turfs"
            referencedColumns: ["id", "master_owner_id"]
          },
        ]
      }
      slots: {
        Row: {
          ends_at: string
          id: string
          master_owner_id: string
          published: boolean
          resource_id: string
          schedule_version: number
          starts_at: string
          turf_id: string
        }
        Insert: {
          ends_at: string
          id?: string
          master_owner_id: string
          published?: boolean
          resource_id: string
          schedule_version?: number
          starts_at: string
          turf_id: string
        }
        Update: {
          ends_at?: string
          id?: string
          master_owner_id?: string
          published?: boolean
          resource_id?: string
          schedule_version?: number
          starts_at?: string
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slots_resource_id_turf_id_master_owner_id_fkey"
            columns: ["resource_id", "turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id", "turf_id", "master_owner_id"]
          },
        ]
      }
      sports: {
        Row: {
          code: string
          name: string
        }
        Insert: {
          code: string
          name: string
        }
        Update: {
          code?: string
          name?: string
        }
        Relationships: []
      }
      turf_amenities: {
        Row: {
          amenity_code: string
          turf_id: string
        }
        Insert: {
          amenity_code: string
          turf_id: string
        }
        Update: {
          amenity_code?: string
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turf_amenities_amenity_code_fkey"
            columns: ["amenity_code"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "turf_amenities_turf_id_fkey"
            columns: ["turf_id"]
            isOneToOne: false
            referencedRelation: "turfs"
            referencedColumns: ["id"]
          },
        ]
      }
      turf_booking_settings: {
        Row: {
          advance_basis_points: number
          booking_horizon_days: number
          cancellation_policy_id: string
          hold_seconds: number
          master_owner_id: string
          minimum_lead_minutes: number
          turf_id: string
        }
        Insert: {
          advance_basis_points?: number
          booking_horizon_days?: number
          cancellation_policy_id: string
          hold_seconds?: number
          master_owner_id: string
          minimum_lead_minutes?: number
          turf_id: string
        }
        Update: {
          advance_basis_points?: number
          booking_horizon_days?: number
          cancellation_policy_id?: string
          hold_seconds?: number
          master_owner_id?: string
          minimum_lead_minutes?: number
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turf_booking_settings_cancellation_policy_id_master_owner__fkey"
            columns: ["cancellation_policy_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "cancellation_policies"
            referencedColumns: ["id", "master_owner_id"]
          },
          {
            foreignKeyName: "turf_booking_settings_turf_id_master_owner_id_fkey"
            columns: ["turf_id", "master_owner_id"]
            isOneToOne: false
            referencedRelation: "turfs"
            referencedColumns: ["id", "master_owner_id"]
          },
        ]
      }
      turf_photos: {
        Row: {
          created_at: string
          id: string
          published: boolean
          sort_order: number
          storage_path: string
          turf_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          published?: boolean
          sort_order?: number
          storage_path: string
          turf_id: string
        }
        Update: {
          created_at?: string
          id?: string
          published?: boolean
          sort_order?: number
          storage_path?: string
          turf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turf_photos_turf_id_fkey"
            columns: ["turf_id"]
            isOneToOne: false
            referencedRelation: "turfs"
            referencedColumns: ["id"]
          },
        ]
      }
      turfs: {
        Row: {
          address_text: string
          approval_status: string
          archived_at: string | null
          city: string
          created_at: string
          description: string
          id: string
          location: unknown
          master_owner_id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
          version: number
        }
        Insert: {
          address_text: string
          approval_status?: string
          archived_at?: string | null
          city: string
          created_at?: string
          description?: string
          id?: string
          location: unknown
          master_owner_id: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
          version?: number
        }
        Update: {
          address_text?: string
          approval_status?: string
          archived_at?: string | null
          city?: string
          created_at?: string
          description?: string
          id?: string
          location?: unknown
          master_owner_id?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "turfs_master_owner_id_fkey"
            columns: ["master_owner_id"]
            isOneToOne: false
            referencedRelation: "master_owners"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_employee_invite: { Args: { p_token: string }; Returns: Json }
      admin_get_commission_rules: {
        Args: never
        Returns: {
          basis_points: number
          business_name: string
          effective_from: string
          effective_until: string
          fixed_minor: number
          id: string
          master_owner_id: string
          version: number
        }[]
      }
      admin_get_payouts: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          amount_minor: number
          business_name: string
          created_at: string
          currency: string
          financial_account_id: string
          id: string
          idempotency_key: string
          masked_bank_label: string
          master_owner_id: string
          period_end: string
          period_start: string
          provider: string
          provider_account_id: string
          provider_settlement_id: string
          settled_at: string
          status: string
          total_count: number
        }[]
      }
      admin_get_tenants: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          business_name: string
          created_at: string
          id: string
          owner_email: string
          owner_user_id: string
          status: string
          total_count: number
          turf_count: number
        }[]
      }
      admin_get_turf_queue: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          address_text: string
          approval_status: string
          business_name: string
          city: string
          created_at: string
          id: string
          master_owner_id: string
          name: string
          owner_email: string
          slug: string
          total_count: number
          updated_at: string
        }[]
      }
      admin_review_turf: {
        Args: { p_decision: string; p_reason: string; p_turf_id: string }
        Returns: Json
      }
      admin_set_commission_rule: {
        Args: {
          p_basis_points?: number
          p_fixed_minor?: number
          p_master_owner_id?: string
        }
        Returns: Json
      }
      authorize_realtime_channel: {
        Args: { p_topic: string }
        Returns: boolean
      }
      block_resource_time: {
        Args: {
          p_ends_at: string
          p_reason?: string
          p_resource_id: string
          p_starts_at: string
        }
        Returns: Json
      }
      cancel_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      create_booking_hold: {
        Args: {
          p_contact_email?: string
          p_contact_name?: string
          p_contact_phone?: string
          p_ends_at: string
          p_idempotency_key: string
          p_resource_id: string
          p_starts_at: string
        }
        Returns: Json
      }
      create_or_get_payment_order: {
        Args: {
          p_booking_id: string
          p_idempotency_key: string
          p_purpose?: string
        }
        Returns: Json
      }
      create_turf: {
        Args: {
          p_address_text: string
          p_city: string
          p_description?: string
          p_location?: unknown
          p_master_owner_id: string
          p_name: string
          p_timezone?: string
        }
        Returns: string
      }
      create_walkin_booking: {
        Args: {
          p_contact_email?: string
          p_contact_name: string
          p_contact_phone: string
          p_ends_at: string
          p_idempotency_key?: string
          p_notes?: string
          p_payment_method?: string
          p_resource_id: string
          p_starts_at: string
        }
        Returns: Json
      }
      disable_employee: { Args: { p_employee_id: string }; Returns: Json }
      get_audit_events: {
        Args: { p_limit?: number; p_offset?: number; p_turf_id?: string }
        Returns: {
          action: string
          actor_type: string
          actor_user_id: string
          after_data: Json
          before_data: Json
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          master_owner_id: string
          reason: string
          turf_id: string
        }[]
      }
      get_booking_contact: { Args: { p_booking_id: string }; Returns: Json }
      get_my_capabilities: {
        Args: { p_master_owner_id?: string }
        Returns: Json
      }
      get_my_context: { Args: never; Returns: Json }
      get_my_notifications: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          body: string
          created_at: string
          deep_link: string
          id: string
          kind: string
          read_at: string
          title: string
        }[]
      }
      get_owner_dashboard: {
        Args: {
          p_end_date?: string
          p_master_owner_id: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_owner_financial_summary: {
        Args: { p_master_owner_id: string }
        Returns: Json
      }
      get_owner_statement: {
        Args: {
          p_end_date?: string
          p_master_owner_id: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_pending_employee_invites: {
        Args: { p_master_owner_id: string }
        Returns: Json
      }
      get_public_slot_allocations: {
        Args: { p_ends_at: string; p_resource_id: string; p_starts_at: string }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      invite_employee: {
        Args: {
          p_capabilities: string[]
          p_email: string
          p_master_owner_id: string
          p_turf_ids: string[]
        }
        Returns: Json
      }
      is_platform_admin: { Args: never; Returns: boolean }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      persist_webhook_event: {
        Args: {
          p_body_hash: string
          p_event_id: string
          p_event_type: string
          p_provider: string
          p_raw_body: string
          p_scope: string
        }
        Returns: Json
      }
      plan_owner_payout: {
        Args: {
          p_idempotency_key?: string
          p_master_owner_id: string
          p_period_end?: string
          p_period_start?: string
        }
        Returns: Json
      }
      process_webhook_event: {
        Args: { p_webhook_event_id: string }
        Returns: Json
      }
      quote_booking: {
        Args: { p_ends_at: string; p_resource_id: string; p_starts_at: string }
        Returns: Json
      }
      register_device_token: {
        Args: { p_app_id: string; p_platform: string; p_token: string }
        Returns: string
      }
      register_owner_financial_account: {
        Args: {
          p_active?: boolean
          p_masked_bank_label: string
          p_master_owner_id: string
          p_provider: string
          p_provider_account_id: string
        }
        Returns: Json
      }
      release_resource_block: {
        Args: { p_allocation_id: string }
        Returns: Json
      }
      request_refund: {
        Args: {
          p_amount_minor: number
          p_idempotency_key?: string
          p_payment_id: string
          p_reason: string
          p_requested_by?: string
        }
        Returns: Json
      }
      set_resource_operating_hours: {
        Args: {
          p_hours: Json
          p_resource_id: string
          p_valid_from?: string
          p_valid_until?: string
        }
        Returns: {
          closes_at: string
          closes_next_day: boolean
          id: string
          iso_weekday: number
          opens_at: string
          resource_id: string
          valid_from: string
          valid_until: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "operating_hours"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      settle_owner_payout: {
        Args: {
          p_payout_id: string
          p_provider_settlement_id: string
          p_settled_at?: string
        }
        Returns: Json
      }
      submit_turf_for_approval: { Args: { p_turf_id: string }; Returns: Json }
      update_employee_assignments: {
        Args: {
          p_active?: boolean
          p_capabilities: string[]
          p_employee_id: string
          p_turf_id: string
        }
        Returns: Json
      }
      update_payment_order_provider: {
        Args: {
          p_order_id: string
          p_provider_order_id: string
          p_status?: string
        }
        Returns: undefined
      }
      update_turf_onboarding: {
        Args: {
          p_address_text?: string
          p_amenities?: string[]
          p_description?: string
          p_expected_version?: number
          p_photos?: Json
          p_resource_sports?: Json
          p_turf_id: string
        }
        Returns: {
          address_text: string
          approval_status: string
          archived_at: string | null
          city: string
          created_at: string
          description: string
          id: string
          location: unknown
          master_owner_id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "turfs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_pricing_rule: {
        Args: {
          p_active?: boolean
          p_amount_per_increment_minor: number
          p_ends_local: string
          p_expected_version?: number
          p_iso_weekdays: number[]
          p_priority?: number
          p_resource_id: string
          p_rule_id: string
          p_starts_local: string
          p_valid_from: string
          p_valid_until: string
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
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

