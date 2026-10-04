export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
    };
    Views: Record<string, never>;
    Functions: {
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
