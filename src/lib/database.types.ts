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
          timezone: string | null;
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
          timezone?: string | null;
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
          timezone?: string | null;
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
          usage_role: "knowledge" | "business_instructions";
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
          usage_role?: "knowledge" | "business_instructions";
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
          usage_role?: "knowledge" | "business_instructions";
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
          lead_stage: string;
          lead_stage_reason: string;
          internal_note: string;
          follow_up_status: string;
          follow_up_at: string | null;
          last_touch_at: string | null;
          lead_revision: number;
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
          lead_stage?: string;
          lead_stage_reason?: string;
          internal_note?: string;
          follow_up_status?: string;
          follow_up_at?: string | null;
          last_touch_at?: string | null;
          lead_revision?: number;
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
          lead_stage?: string;
          lead_stage_reason?: string;
          internal_note?: string;
          follow_up_status?: string;
          follow_up_at?: string | null;
          last_touch_at?: string | null;
          lead_revision?: number;
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
          delivery_state: "accepted" | "sent" | "delivered" | "read" | "failed" | null;
          delivery_rank: number;
          delivery_updated_at: string | null;
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
          delivery_state?: "accepted" | "sent" | "delivered" | "read" | "failed" | null;
          delivery_rank?: number;
          delivery_updated_at?: string | null;
        };
        Update: {
          body?: string;
          direction?: "inbound" | "outbound";
          sender?: "customer" | "staff" | "assistant";
          delivery_state?: "accepted" | "sent" | "delivered" | "read" | "failed" | null;
          delivery_rank?: number;
          delivery_updated_at?: string | null;
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
          message_id: string | null;
          link_state: "applied" | "unmatched" | "ignored_stale";
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
          message_id?: string | null;
          link_state?: "applied" | "unmatched" | "ignored_stale";
        };
        Update: {
          status?: string;
          message_id?: string | null;
          link_state?: "applied" | "unmatched" | "ignored_stale";
        };
        Relationships: [];
      };
      whatsapp_send_intents: {
        Row: {
          id: string;
          client_op_id: string;
          company_id: string;
          conversation_id: string;
          phone_number_id: string;
          recipient_wa_id: string;
          body: string;
          sender_kind: "staff" | "assistant";
          actor_user_id: string | null;
          outcome: "ready" | "attempting" | "accepted" | "rejected" | "unknown";
          wa_message_id: string | null;
          message_id: string | null;
          attempt_token: string | null;
          attempt_started_at: string | null;
          attempt_expires_at: string | null;
          provider_error_code: string | null;
          expected_automation_generation: number | null;
          link_id: string | null;
          link_generation: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_op_id: string;
          company_id: string;
          conversation_id: string;
          phone_number_id: string;
          recipient_wa_id: string;
          body: string;
          sender_kind: "staff" | "assistant";
          actor_user_id?: string | null;
          outcome?: "ready" | "attempting" | "accepted" | "rejected" | "unknown";
          wa_message_id?: string | null;
          message_id?: string | null;
          attempt_token?: string | null;
          attempt_started_at?: string | null;
          attempt_expires_at?: string | null;
          provider_error_code?: string | null;
          expected_automation_generation?: number | null;
          link_id?: string | null;
          link_generation?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          outcome?: "ready" | "attempting" | "accepted" | "rejected" | "unknown";
          wa_message_id?: string | null;
          message_id?: string | null;
          attempt_token?: string | null;
          attempt_started_at?: string | null;
          attempt_expires_at?: string | null;
          provider_error_code?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      whatsapp_company_links: {
        Row: {
          id: string;
          company_id: string;
          requested_display_number: string;
          keep_on_phone: boolean;
          status:
            | "not_connected"
            | "request_saved"
            | "needs_external_action"
            | "verified"
            | "error"
            | "disconnected";
          provider_phone_number_id: string | null;
          verified_display_number: string | null;
          inbound_tested_at: string | null;
          outbound_tested_at: string | null;
          last_error_code: string | null;
          admin_note: string | null;
          generation: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          requested_display_number?: string;
          keep_on_phone?: boolean;
          status?:
            | "not_connected"
            | "request_saved"
            | "needs_external_action"
            | "verified"
            | "error"
            | "disconnected";
          provider_phone_number_id?: string | null;
          verified_display_number?: string | null;
          inbound_tested_at?: string | null;
          outbound_tested_at?: string | null;
          last_error_code?: string | null;
          admin_note?: string | null;
          generation?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          requested_display_number?: string;
          keep_on_phone?: boolean;
          status?:
            | "not_connected"
            | "request_saved"
            | "needs_external_action"
            | "verified"
            | "error"
            | "disconnected";
          provider_phone_number_id?: string | null;
          verified_display_number?: string | null;
          inbound_tested_at?: string | null;
          outbound_tested_at?: string | null;
          last_error_code?: string | null;
          admin_note?: string | null;
          updated_at?: string;
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
      ai_settle_admin_attempt: { Args: {p_id:string;p_status:string;p_cost_usd:number|null;p_cost_baisa:number|null;p_usage:Json;p_request_id:string|null;p_error_code:string|null;p_latency_ms:number;p_response_id:string|null;p_actual_model_id:string|null}; Returns:boolean };
      whatsapp_inbox_page: { Args: {p_company_id:string;p_limit?:number;p_before?:string|null}; Returns:Json };
      whatsapp_thread_page: { Args: {p_company_id:string;p_conversation_id:string;p_limit?:number;p_before?:string|null}; Returns:Json };
      whatsapp_mark_thread_read: { Args: {p_company_id:string;p_conversation_id:string;p_displayed_inbound_message_id:string}; Returns:Json };
      whatsapp_control_audit_page: { Args: {p_company_id:string;p_conversation_id:string;p_limit?:number;p_before?:string|null}; Returns:Json };
      whatsapp_inbox_connection_status: { Args: {p_company_id:string}; Returns:Json };
      ai_reserve_whatsapp_capacity_cost_attempt: { Args: { p_id:string; p_job_id:string; p_claim_token:string; p_attempt:number; p_model_id:string; p_provider:string; p_reserved_baisa:number; p_pricing_version:string; p_pricing_snapshot:Json; p_source_citations:Json; p_expected_persona?:string|null; p_expected_plan_version_id?:string|null }; Returns:Json };
      whatsapp_revoke_failed_credential: {Args:{p_company_id:string;p_link_id:string;p_phone_number_id:string;p_link_generation:number;p_provider_code:number};Returns:boolean};
      whatsapp_revoke_meta_waba_authorization: { Args: { p_waba_id:string; p_reason:string; p_occurred_at:string }; Returns:Json };
      ai_reserve_whatsapp_profile_attempt: { Args: { p_id:string; p_job_id:string; p_claim_token:string; p_attempt:number; p_model_id:string; p_provider:string; p_reserved_baisa:number; p_pricing_version:string; p_pricing_snapshot:Json; p_source_citations:Json; p_expected_persona:string; p_expected_plan_version_id:string }; Returns:Json };
      whatsapp_embedded_signup_readiness: { Args: {p_company_id:string}; Returns:Json };
      whatsapp_start_embedded_signup: { Args: {p_company_id:string;p_attempt_id:string;p_nonce:string;p_keep_on_phone:boolean;p_app_id:string;p_config_id:string;p_graph_version:string}; Returns:Json };
      whatsapp_claim_embedded_signup: { Args: {p_company_id:string;p_attempt_id:string;p_nonce:string}; Returns:Json };
      whatsapp_cancel_embedded_signup: { Args: {p_company_id:string;p_attempt_id:string;p_nonce:string}; Returns:Json };
      whatsapp_finalize_embedded_signup: { Args: {p_attempt_id:string;p_user_id:string;p_session_id:string;p_access_token:string;p_proof:Json}; Returns:Json };
      whatsapp_fail_embedded_signup: { Args: {p_attempt_id:string;p_user_id:string;p_session_id:string;p_code:string}; Returns:Json };
      whatsapp_disconnect_embedded_signup: { Args: {p_company_id:string}; Returns:Json };
      whatsapp_read_link_access_secret: { Args: { p_company_id:string; p_link_id:string; p_phone_number_id:string; p_link_generation:number }; Returns:Json };
      resolve_whatsapp_company_by_meta_asset: { Args: { p_waba_id:string; p_provider_phone_number_id:string }; Returns:Json };
      whatsapp_check_service_window: { Args: { p_company_id:string; p_conversation_id:string; p_phone_number_id:string; p_recipient_wa_id:string }; Returns:Json };
      whatsapp_store_meta_inbound: { Args: { p_waba_id:string; p_company_id:string; p_phone_number_id:string; p_customer_wa_id:string; p_customer_name:string; p_wa_message_id:string; p_body:string; p_message_type:string; p_received_at:string }; Returns:Json };
      whatsapp_apply_meta_delivery_status: { Args: { p_waba_id:string; p_company_id:string; p_phone_number_id:string; p_wa_message_id:string; p_status:string; p_recipient_wa_id:string; p_occurred_at:string }; Returns:Json };
      whatsapp_read_answer_profile: { Args: { p_company_id:string; p_job_id:string; p_claim_token:string }; Returns:Json };
      whatsapp_retrieve_approved_knowledge: { Args: { p_company_id:string; p_job_id:string; p_claim_token:string; p_question:string }; Returns:Json };
      check_app_session: { Args:{p_touch?:boolean}; Returns:Json };
      get_selected_whatsapp_company_link: { Args:{p_company_id:string}; Returns:Json };
      upsert_selected_whatsapp_link_request: { Args:{p_company_id:string;p_requested_display_number:string;p_keep_on_phone?:boolean}; Returns:Json };
      upsert_selected_owner_company: {
        Args:{p_company_id:string;p_display_name:string;p_business_type?:string;p_reply_language?:string;p_country?:string;p_city?:string;p_hours?:string;p_contact_phone?:string;p_contact_email?:string;p_member_name?:string};
        Returns:Database["public"]["Tables"]["companies"]["Row"];
      };
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
          p_assignee_user_id?: string | null;
        };
        Returns: Json;
      };
      upsert_conversation_lead_state: {
        Args: {
          p_conversation_id: string;
          p_expected_revision: number;
          p_lead_stage: string;
          p_lead_stage_reason: string;
          p_internal_note: string;
          p_follow_up_status: string;
          p_follow_up_at: string | null;
        };
        Returns: Json;
      };
      whatsapp_automation_gate: {
        Args: { p_conversation_id: string };
        Returns: Json;
      };
      create_whatsapp_send_intent: {
        Args: {
          p_client_op_id: string;
          p_conversation_id: string;
          p_body: string;
          p_phone_number_id: string;
          p_sender_kind?: string;
          p_expected_automation_generation?: number | null;
          p_link_id?: string | null;
          p_link_generation?: number | null;
        };
        Returns: Json;
      };
      claim_whatsapp_send_attempt: {
        Args: {
          p_intent_id: string;
          p_actor_user_id: string;
          p_lease_seconds?: number;
        };
        Returns: Json;
      };
      finalize_whatsapp_send_attempt: {
        Args: {
          p_intent_id: string;
          p_attempt_token: string;
          p_result: string;
          p_wa_message_id?: string | null;
          p_error_code?: string | null;
          p_actor_user_id?: string | null;
        };
        Returns: Json;
      };
      retry_whatsapp_send_persist: {
        Args: { p_intent_id: string; p_actor_user_id?: string | null };
        Returns: Json;
      };
      apply_whatsapp_delivery_status: {
        Args: {
          p_company_id: string;
          p_phone_number_id: string;
          p_wa_message_id: string;
          p_status: string;
          p_recipient_wa_id: string;
          p_occurred_at: string;
        };
        Returns: Json;
      };
      rebind_whatsapp_delivery_statuses: {
        Args: {
          p_company_id: string;
          p_phone_number_id: string;
          p_wa_message_id: string;
        };
        Returns: Json;
      };
      get_whatsapp_company_link: {
        Args: Record<string, never>;
        Returns: Json;
      };
      upsert_whatsapp_link_request: {
        Args: { p_requested_display_number: string; p_keep_on_phone?: boolean };
        Returns: Json;
      };
      admin_get_whatsapp_company_link: {
        Args: { p_company_id: string };
        Returns: Json;
      };
      admin_update_whatsapp_link_note: {
        Args: { p_company_id: string; p_admin_note: string };
        Returns: Json;
      };
      admin_mark_whatsapp_link_needs_external: {
        Args: { p_company_id: string };
        Returns: Json;
      };
      resolve_whatsapp_company_by_provider_phone: {
        Args: { p_provider_phone_number_id: string };
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
      is_platform_owner: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      has_company_capability: {
        Args: { p_company_id: string; p_capability: string };
        Returns: boolean;
      };
      company_conversation_scope: {
        Args: { p_company_id: string };
        Returns: string;
      };
      access_get_user_snapshot: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      access_set_member_grants: {
        Args: {
          p_company_id: string;
          p_user_id: string;
          p_capabilities: string[];
          p_conversation_scope: string;
          p_manager_user_id: string | null;
          p_expected_revision: number;
          p_reason?: string;
        };
        Returns: Json;
      };
      access_add_company_staff: {
        Args: {
          p_company_id: string;
          p_user_id: string;
          p_capabilities: string[];
          p_conversation_scope: string;
          p_expected_grant_revision: number;
          p_reason?: string;
        };
        Returns: Json;
      };
      access_apply_staff_capability_conversion: {
        Args: { p_company_id?: string | null };
        Returns: Json;
      };
      access_set_admin_scope: {
        Args: {
          p_admin_user_id: string;
          p_company_id: string;
          p_usable: string[];
          p_delegable: string[];
          p_expected_revision: number;
          p_reason?: string;
        };
        Returns: Json;
      };
      access_set_platform_role: {
        Args: {
          p_user_id: string;
          p_role: string;
          p_status: string;
          p_expected_revision: number;
          p_note?: string;
          p_reason?: string;
        };
        Returns: Json;
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
          support_code: string | null;
          full_name: string | null;
          email: string | null;
          account_phone: string | null;
          email_confirmed: boolean | null;
          companies: Json;
        }[];
      };
      admin_overview_stats: {
        Args: Record<string, never>;
        Returns: Json;
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
