// Generated-contract shape for the checked-in Supabase migrations. Regenerate
// with the documented Supabase CLI command after every migration.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      auth_access_tokens: {
        Row: {
          created_at: string;
          revoked_at: string | null;
          token_hash: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          revoked_at?: string | null;
          token_hash: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          revoked_at?: string | null;
          token_hash?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      auth_pending_access_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          token_hash?: string;
        };
        Relationships: [];
      };
      analysis_jobs: {
        Row: {
          content_item_id: string;
          created_at: string;
          id: string;
          status: Database["public"]["Enums"]["analysis_job_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content_item_id: string;
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["analysis_job_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content_item_id?: string;
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["analysis_job_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      content_items: {
        Row: {
          created_at: string;
          id: string;
          status: Database["public"]["Enums"]["content_item_status"];
          type: Database["public"]["Enums"]["content_item_type"];
          updated_at: string;
          user_id: string;
          storage_path: string | null;
          original_file_name: string | null;
          file_size_bytes: number | null;
          file_mime_type: string | null;
          upload_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["content_item_status"];
          type?: Database["public"]["Enums"]["content_item_type"];
          updated_at?: string;
          user_id: string;
          storage_path?: string | null;
          original_file_name?: string | null;
          file_size_bytes?: number | null;
          file_mime_type?: string | null;
          upload_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["content_item_status"];
          type?: Database["public"]["Enums"]["content_item_type"];
          updated_at?: string;
          user_id?: string;
          storage_path?: string | null;
          original_file_name?: string | null;
          file_size_bytes?: number | null;
          file_mime_type?: string | null;
          upload_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: { created_at: string; id: string; updated_at: string };
        Insert: { created_at?: string; id: string; updated_at?: string };
        Update: { created_at?: string; id?: string; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      analysis_job_status:
        "queued" | "running" | "completed" | "failed" | "cancelled";
      content_item_status: "pending" | "ready" | "failed";
      content_item_type: "video";
    };
    CompositeTypes: Record<string, never>;
  };
};
