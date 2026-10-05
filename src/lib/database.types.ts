export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          full_name: string;
          support_code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          full_name?: string;
          support_code?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          display_name: string;
          status: "setup" | "active" | "suspended";
          business_type: string;
          reply_language: "ar" | "en" | "both";
          country: string;
          city: string;
          hours: string;
          contact_phone: string;
          contact_email: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          display_name: string;
          status?: "setup" | "active" | "suspended";
          business_type?: string;
          reply_language?: "ar" | "en" | "both";
          country?: string;
          city?: string;
          hours?: string;
          contact_phone?: string;
          contact_email?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          business_type?: string;
          reply_language?: "ar" | "en" | "both";
          country?: string;
          city?: string;
          hours?: string;
          contact_phone?: string;
          contact_email?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      company_members: {
        Row: {
          company_id: string;
          user_id: string;
          role: "owner" | "staff";
          status: "active" | "disabled";
          member_name: string;
          created_at: string;
        };
        Insert: {
          company_id: string;
          user_id: string;
          role: "owner" | "staff";
          status?: "active" | "disabled";
          member_name?: string;
          created_at?: string;
        };
        Update: {
          role?: "owner" | "staff";
          status?: "active" | "disabled";
          member_name?: string;
        };
        Relationships: [];
      };
      company_review_requests: {
        Row: {
          company_id: string;
          requested_by: string;
          number_ownership: "own" | "new";
          whatsapp_number: string;
          readiness_confirmed: boolean;
          requested_at: string;
          status: "pending_review" | "changes_requested" | "approved";
          revision: number;
          decided_by: string | null;
          decided_at: string | null;
          owner_note: string;
        };
        Insert: {
          company_id: string;
          requested_by: string;
          number_ownership: "own" | "new";
          whatsapp_number?: string;
          readiness_confirmed?: boolean;
          status?: "pending_review" | "changes_requested" | "approved";
          revision?: number;
          decided_by?: string | null;
          decided_at?: string | null;
          owner_note?: string;
        };
        Update: {
          number_ownership?: "own" | "new";
          whatsapp_number?: string;
          readiness_confirmed?: boolean;
          status?: "pending_review" | "changes_requested" | "approved";
          revision?: number;
          decided_by?: string | null;
          decided_at?: string | null;
          owner_note?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          granted_at: string;
          granted_by: string | null;
          note: string;
        };
        Insert: {
          user_id: string;
          granted_at?: string;
          granted_by?: string | null;
          note?: string;
        };
        Update: {
          note?: string;
          granted_by?: string | null;
        };
        Relationships: [];
      };
      admin_audit_logs: {
        Row: {
          id: string;
          actor_user_id: string;
          company_id: string | null;
          action: string;
          before_data: Json | null;
          after_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_user_id: string;
          company_id?: string | null;
          action: string;
          before_data?: Json | null;
          after_data?: Json | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      knowledge_sources: {
        Row: {
          id: string;
          company_id: string;
          kind: "text" | "file";
          title: string;
          content: string;
          file_name: string | null;
          content_type: string | null;
          byte_size: number | null;
          storage_path: string | null;
          status: "draft" | "stored" | "processing" | "ready" | "failed";
          failure_code: "no_text" | "corrupt" | "unsupported" | "extract_failed" | null;
          content_version: number;
          approved_for_answers: boolean;
          approved_version: number | null;
          approved_at: string | null;
          approved_by: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          kind: "text" | "file";
          title: string;
          content?: string;
          file_name?: string | null;
          content_type?: string | null;
          byte_size?: number | null;
          storage_path?: string | null;
          status?: "draft" | "stored" | "processing" | "ready" | "failed";
          failure_code?: "no_text" | "corrupt" | "unsupported" | "extract_failed" | null;
          content_version?: number;
          approved_for_answers?: boolean;
          approved_version?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          kind?: "text" | "file";
          title?: string;
          content?: string;
          file_name?: string | null;
          content_type?: string | null;
          byte_size?: number | null;
          storage_path?: string | null;
          status?: "draft" | "stored" | "processing" | "ready" | "failed";
          failure_code?: "no_text" | "corrupt" | "unsupported" | "extract_failed" | null;
          content_version?: number;
          approved_for_answers?: boolean;
          approved_version?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      whatsapp_conversations: {
        Row: {
          id: string;
          company_id: string;
          phone_number_id: string;
          customer_wa_id: string;
          customer_name: string;
          last_message_at: string;
          created_at: string;
          status: "open" | "handed_over" | "resolved";
          automation_allowed: boolean;
          automation_generation: number;
          control_revision: number;
          control_actor_id: string | null;
          control_acted_at: string | null;
          assigned_to: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          phone_number_id: string;
          customer_wa_id: string;
          customer_name?: string;
          last_message_at?: string;
          created_at?: string;
          status?: "open" | "handed_over" | "resolved";
          automation_allowed?: boolean;
          automation_generation?: number;
          control_revision?: number;
          control_actor_id?: string | null;
          control_acted_at?: string | null;
          assigned_to?: string | null;
        };
        Update: {
          customer_name?: string;
          last_message_at?: string;
          status?: "open" | "handed_over" | "resolved";
          automation_allowed?: boolean;
          automation_generation?: number;
          control_revision?: number;
          control_actor_id?: string | null;
          control_acted_at?: string | null;
          assigned_to?: string | null;
        };
        Relationships: [];
      };
      whatsapp_conversation_events: {
        Row: {
          id: string;
          company_id: string;
          conversation_id: string;
          actor_user_id: string | null;
          action: "take_over" | "resume" | "close" | "reopen_inbound";
          revision: number;
          automation_generation: number;
          detail: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          conversation_id: string;
          actor_user_id?: string | null;
          action: "take_over" | "resume" | "close" | "reopen_inbound";
          revision: number;
          automation_generation: number;
          detail?: Json;
          created_at?: string;
        };
        Update: {
          detail?: Json;
        };
        Relationships: [];
      };
      whatsapp_messages: {
        Row: {
          id: string;
          company_id: string;
          conversation_id: string;
          wa_message_id: string;
          body: string;
          message_type: string;
          direction: "inbound" | "outbound";
          sender: "customer" | "staff" | "assistant";
          received_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          conversation_id: string;
          wa_message_id: string;
          body: string;
          message_type?: string;
          direction?: "inbound" | "outbound";
          sender?: "customer" | "staff" | "assistant";
          received_at: string;
          created_at?: string;
        };
        Update: {
          body?: string;
          direction?: "inbound" | "outbound";
          sender?: "customer" | "staff" | "assistant";
        };
        Relationships: [];
      };
      whatsapp_delivery_statuses: {
        Row: {
          id: string;
          company_id: string;
          phone_number_id: string;
          wa_message_id: string;
          status: string;
          recipient_wa_id: string;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          phone_number_id: string;
          wa_message_id: string;
          status: string;
          recipient_wa_id?: string;
          occurred_at: string;
          created_at?: string;
        };
        Update: {
          status?: string;
        };
        Relationships: [];
      };
      whatsapp_inbound_jobs: {
        Row: {
          id: string;
          company_id: string;
          message_id: string;
          wa_message_id: string;
          status: "pending" | "claimed" | "completed" | "failed";
          claim_token: string | null;
          claimed_at: string | null;
          claim_expires_at: string | null;
          completed_at: string | null;
          result_code: string | null;
          attempt_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          message_id: string;
          wa_message_id: string;
          status?: "pending" | "claimed" | "completed" | "failed";
          claim_token?: string | null;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
          completed_at?: string | null;
          result_code?: string | null;
          attempt_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "pending" | "claimed" | "completed" | "failed";
          claim_token?: string | null;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
          completed_at?: string | null;
          result_code?: string | null;
          attempt_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      save_whatsapp_inbound: {
        Args: {
          p_company_id: string;
          p_phone_number_id: string;
          p_customer_wa_id: string;
          p_customer_name: string;
          p_wa_message_id: string;
          p_body: string;
          p_message_type: string;
          p_received_at: string;
        };
        Returns: Json;
      };
      claim_whatsapp_inbound_job: {
        Args: { p_job_id: string; p_lease_seconds?: number };
        Returns: Json;
      };
      complete_whatsapp_inbound_job: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_ok: boolean;
          p_result_code?: string | null;
        };
        Returns: Json;
      };
      control_whatsapp_conversation: {
        Args: {
          p_conversation_id: string;
          p_action: string;
          p_expected_revision: number;
        };
        Returns: Json;
      };
      whatsapp_automation_gate: {
        Args: { p_conversation_id: string };
        Returns: Json;
      };
      set_knowledge_source_approval: {
        Args: { p_source_id: string; p_approved: boolean };
        Returns: Database["public"]["Tables"]["knowledge_sources"]["Row"];
      };
      upsert_owner_company: {
        Args: {
          p_display_name: string;
          p_business_type?: string;
          p_reply_language?: string;
          p_country?: string;
          p_city?: string;
          p_hours?: string;
          p_contact_phone?: string;
          p_contact_email?: string;
          p_member_name?: string;
        };
        Returns: Database["public"]["Tables"]["companies"]["Row"];
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      admin_list_companies: {
        Args: { p_search?: string };
        Returns: {
          id: string;
          display_name: string;
          status: string;
          business_type: string;
          country: string;
          city: string;
          contact_phone: string;
          contact_email: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          owner_email: string | null;
          owner_name: string | null;
          member_count: number;
          review_requested_at: string | null;
          review_requested_by: string | null;
        }[];
      };
      admin_get_company: {
        Args: { p_company_id: string };
        Returns: Json;
      };
      admin_update_company: {
        Args: {
          p_company_id: string;
          p_display_name: string;
          p_business_type: string;
          p_reply_language: string;
          p_country: string;
          p_city: string;
          p_hours: string;
          p_contact_phone: string;
          p_contact_email: string;
        };
        Returns: Database["public"]["Tables"]["companies"]["Row"];
      };
      admin_set_company_status: {
        Args: { p_company_id: string; p_status: string };
        Returns: Database["public"]["Tables"]["companies"]["Row"];
      };
      admin_set_member_status: {
        Args: {
          p_company_id: string;
          p_user_id: string;
          p_status: string;
          p_role?: string | null;
          p_member_name?: string | null;
        };
        Returns: Database["public"]["Tables"]["company_members"]["Row"];
      };
      transition_company_review: {
        Args: {
          p_action: string;
          p_company_id: string;
          p_expected_revision?: number | null;
          p_number_ownership?: string | null;
          p_whatsapp_number?: string | null;
          p_readiness_confirmed?: boolean | null;
          p_owner_note?: string | null;
        };
        Returns: Json;
      };
      list_owner_company_review_events: {
        Args: Record<string, never>;
        Returns: Json;
      };
      admin_search_accounts: {
        Args: {
          p_query?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          user_id: string;
          support_code: string;
          full_name: string;
          email: string | null;
          account_phone: string | null;
          companies: Json;
        }[];
      };
      admin_list_company_conversations: {
        Args: {
          p_company_id: string;
          p_phone_number_id?: string | null;
          p_limit?: number;
          p_offset?: number;
          p_message_limit?: number;
          p_message_offset?: number;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
