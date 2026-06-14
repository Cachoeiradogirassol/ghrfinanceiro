export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          cost_center_id: string
          created_at: string
          id: string
          is_active: boolean
          is_administrative: boolean
          kind: string
          name: string
        }
        Insert: {
          cost_center_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_administrative?: boolean
          kind?: string
          name: string
        }
        Update: {
          cost_center_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_administrative?: boolean
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          bank: string | null
          created_at: string
          enterprise: Database["public"]["Enums"]["enterprise_type"]
          id: string
          initial_balance: number
          is_active: boolean
          master_only: boolean
          name: string
          pluggy_account_id: string | null
          pluggy_item_id: string | null
        }
        Insert: {
          bank?: string | null
          created_at?: string
          enterprise: Database["public"]["Enums"]["enterprise_type"]
          id?: string
          initial_balance?: number
          is_active?: boolean
          master_only?: boolean
          name: string
          pluggy_account_id?: string | null
          pluggy_item_id?: string | null
        }
        Update: {
          bank?: string | null
          created_at?: string
          enterprise?: Database["public"]["Enums"]["enterprise_type"]
          id?: string
          initial_balance?: number
          is_active?: boolean
          master_only?: boolean
          name?: string
          pluggy_account_id?: string | null
          pluggy_item_id?: string | null
        }
        Relationships: []
      }
      bank_statement_extracts: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          description: string
          id: string
          matched_at: string | null
          matched_by: string | null
          matched_transaction_id: string | null
          pluggy_transaction_id: string
          status: string
          transaction_date: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          description?: string
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_transaction_id?: string | null
          pluggy_transaction_id: string
          status?: string
          transaction_date: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          description?: string
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_transaction_id?: string | null
          pluggy_transaction_id?: string
          status?: string
          transaction_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_extracts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_extracts_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          matched_at: string | null
          matched_by: string | null
          matched_transaction_id: string | null
          reconciled: boolean
          statement_date: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_transaction_id?: string | null
          reconciled?: boolean
          statement_date: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_transaction_id?: string | null
          reconciled?: boolean
          statement_date?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_projection_realizations: {
        Row: {
          created_by: string | null
          id: string
          month_index: number
          projection_id: string
          realized_amount: number
          realized_at: string
          transaction_id: string | null
        }
        Insert: {
          created_by?: string | null
          id?: string
          month_index: number
          projection_id: string
          realized_amount: number
          realized_at?: string
          transaction_id?: string | null
        }
        Update: {
          created_by?: string | null
          id?: string
          month_index?: number
          projection_id?: string
          realized_amount?: number
          realized_at?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_projection_realizations_projection_id_fkey"
            columns: ["projection_id"]
            isOneToOne: false
            referencedRelation: "cash_projections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_projection_realizations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_projections: {
        Row: {
          account_id: string
          contact_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          default_bank_account_id: string | null
          direction: string
          horizon_months: number
          id: string
          initial_amount: number
          monthly_growth_rate: number
          name: string
          notes: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          account_id: string
          contact_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          default_bank_account_id?: string | null
          direction?: string
          horizon_months?: number
          id?: string
          initial_amount: number
          monthly_growth_rate?: number
          name: string
          notes?: string | null
          start_date?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          contact_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          default_bank_account_id?: string | null
          direction?: string
          horizon_months?: number
          id?: string
          initial_amount?: number
          monthly_growth_rate?: number
          name?: string
          notes?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_projections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_projections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_projections_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_projections_default_bank_account_id_fkey"
            columns: ["default_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          document_number: string | null
          document_type: string | null
          id: string
          master_only: boolean
          name: string
          phone: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          id?: string
          master_only?: boolean
          name: string
          phone?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          id?: string
          master_only?: boolean
          name?: string
          phone?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_centers: {
        Row: {
          code: number
          created_at: string
          enterprise: Database["public"]["Enums"]["enterprise_type"]
          id: string
          is_active: boolean
          master_only: boolean
          name: string
        }
        Insert: {
          code: number
          created_at?: string
          enterprise: Database["public"]["Enums"]["enterprise_type"]
          id?: string
          is_active?: boolean
          master_only?: boolean
          name: string
        }
        Update: {
          code?: number
          created_at?: string
          enterprise?: Database["public"]["Enums"]["enterprise_type"]
          id?: string
          is_active?: boolean
          master_only?: boolean
          name?: string
        }
        Relationships: []
      }
      intercompany_transfers: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          projection_id: string | null
          source_cost_center_id: string
          target_cost_center_id: string
          transaction_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          projection_id?: string | null
          source_cost_center_id: string
          target_cost_center_id: string
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          projection_id?: string | null
          source_cost_center_id?: string
          target_cost_center_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intercompany_transfers_projection_id_fkey"
            columns: ["projection_id"]
            isOneToOne: false
            referencedRelation: "cash_projections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_source_cost_center_id_fkey"
            columns: ["source_cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_target_cost_center_id_fkey"
            columns: ["target_cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      transaction_allocations: {
        Row: {
          amount: number
          cost_center_id: string
          created_at: string
          id: string
          percent: number | null
          transaction_id: string
        }
        Insert: {
          amount: number
          cost_center_id: string
          created_at?: string
          id?: string
          percent?: number | null
          transaction_id: string
        }
        Update: {
          amount?: number
          cost_center_id?: string
          created_at?: string
          id?: string
          percent?: number | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_allocations_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_allocations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          bank_account_id: string | null
          contact_id: string | null
          cost_center_id: string
          created_at: string
          created_by: string | null
          description: string | null
          document_datetime: string | null
          due_date: string
          id: string
          installment_number: number | null
          installment_total: number | null
          is_batch: boolean
          is_recurring: boolean
          paid_at: string | null
          parent_transaction_id: string | null
          payment_method: string | null
          recurrence_group_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          amount: number
          bank_account_id?: string | null
          contact_id?: string | null
          cost_center_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_datetime?: string | null
          due_date: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          is_batch?: boolean
          is_recurring?: boolean
          paid_at?: string | null
          parent_transaction_id?: string | null
          payment_method?: string | null
          recurrence_group_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          bank_account_id?: string | null
          contact_id?: string | null
          cost_center_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_datetime?: string | null
          due_date?: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          is_batch?: boolean
          is_recurring?: boolean
          paid_at?: string | null
          parent_transaction_id?: string | null
          payment_method?: string | null
          recurrence_group_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_transaction_id_fkey"
            columns: ["parent_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          enterprise_restriction:
            | Database["public"]["Enums"]["enterprise_type"]
            | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          enterprise_restriction?:
            | Database["public"]["Enums"]["enterprise_type"]
            | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          enterprise_restriction?:
            | Database["public"]["Enums"]["enterprise_type"]
            | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_dre_consolidada: {
        Row: {
          amount: number | null
          competence_date: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          projection_id: string | null
          source_cost_center_id: string | null
          source_enterprise:
            | Database["public"]["Enums"]["enterprise_type"]
            | null
          target_cost_center_id: string | null
          target_enterprise:
            | Database["public"]["Enums"]["enterprise_type"]
            | null
          transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intercompany_transfers_projection_id_fkey"
            columns: ["projection_id"]
            isOneToOne: false
            referencedRelation: "cash_projections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_source_cost_center_id_fkey"
            columns: ["source_cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_target_cost_center_id_fkey"
            columns: ["target_cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transfers_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      close_period_month: {
        Args: { _month: number; _year: number }
        Returns: string
      }
      confirm_bank_statement_extract_matches: {
        Args: { _matches: Json }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_date_locked: { Args: { _date: string }; Returns: boolean }
      is_master: { Args: never; Returns: boolean }
      reopen_period_month: {
        Args: { _month: number; _year: number }
        Returns: boolean
      }
      sync_projection_intercompany: {
        Args: { _projection_id: string }
        Returns: undefined
      }
      sync_transaction_intercompany: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "master" | "user"
      enterprise_type:
        | "turismo"
        | "restaurante"
        | "vinhedo"
        | "ghr"
        | "institucional_fazenda"
        | "impostos"
        | "ghr_aldeia"
        | "ghr_jk"
      transaction_status: "pending" | "paid" | "reconciled"
      transaction_type: "payable" | "receivable"
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
      app_role: ["master", "user"],
      enterprise_type: [
        "turismo",
        "restaurante",
        "vinhedo",
        "ghr",
        "institucional_fazenda",
        "impostos",
        "ghr_aldeia",
        "ghr_jk",
      ],
      transaction_status: ["pending", "paid", "reconciled"],
      transaction_type: ["payable", "receivable"],
    },
  },
} as const
