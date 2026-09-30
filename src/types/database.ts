export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      video_screenings: {
        Row: {
          classifier_model: string;
          confidence: number;
          content_item_id: string;
          created_at: string;
          decision: string;
          id: string;
          instructions_version: string;
          provider: string;
          rationale: string;
          reason_code: string;
          sample_duration_seconds: number;
          sample_model: string;
          screening_version: string;
        };
        Insert: {
          classifier_model: string;
          confidence: number;
          content_item_id: string;
          created_at?: string;
          decision: string;
          id?: string;
          instructions_version: string;
          provider: string;
          rationale: string;
          reason_code: string;
          sample_duration_seconds: number;
          sample_model: string;
          screening_version: string;
        };
        Update: {
          classifier_model?: string;
          confidence?: number;
          content_item_id?: string;
          created_at?: string;
          decision?: string;
          id?: string;
          instructions_version?: string;
          provider?: string;
          rationale?: string;
          reason_code?: string;
          sample_duration_seconds?: number;
          sample_model?: string;
          screening_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "video_screenings_content_item_id_fkey";
            columns: ["content_item_id"];
            isOneToOne: false;
            referencedRelation: "content_items";
            referencedColumns: ["id"];
          },
        ];
      };
      transcripts: {
        Row: {
          content_item_id: string;
          created_at: string;
          id: string;
          language: string | null;
          model: string;
          pipeline_version: string;
          provider: string;
          segments: Json;
        };
        Insert: {
          content_item_id: string;
          created_at?: string;
          id?: string;
          language?: string | null;
          model: string;
          pipeline_version?: string;
          provider: string;
          segments: Json;
        };
        Update: {
          content_item_id?: string;
          created_at?: string;
          id?: string;
          language?: string | null;
          model?: string;
          pipeline_version?: string;
          provider?: string;
          segments?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "transcripts_content_item_id_fkey";
            columns: ["content_item_id"];
            isOneToOne: false;
            referencedRelation: "content_items";
            referencedColumns: ["id"];
          },
        ];
      };
      analysis_jobs: {
        Row: {
          attempt: number;
          completed_at: string | null;
          content_item_id: string;
          created_at: string;
          error_code: string | null;
          generation: number;
          id: string;
          pipeline_version: string;
          run_id: string | null;
          stage: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["analysis_job_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempt?: number;
          completed_at?: string | null;
          content_item_id: string;
          created_at?: string;
          error_code?: string | null;
          generation?: number;
          id?: string;
          pipeline_version?: string;
          run_id?: string | null;
          stage?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["analysis_job_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempt?: number;
          completed_at?: string | null;
          content_item_id?: string;
          created_at?: string;
          error_code?: string | null;
          generation?: number;
          id?: string;
          pipeline_version?: string;
          run_id?: string | null;
          stage?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["analysis_job_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_content_item_id_user_id_fkey";
            columns: ["content_item_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "content_items";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "analysis_jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
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
      auth_recovery_codes: {
        Row: {
          code_hash: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          code_hash?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      content_items: {
        Row: {
          created_at: string;
          file_mime_type: string | null;
          file_size_bytes: number | null;
          id: string;
          original_file_name: string | null;
          status: Database["public"]["Enums"]["content_item_status"];
          storage_path: string | null;
          type: Database["public"]["Enums"]["content_item_type"];
          updated_at: string;
          upload_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_mime_type?: string | null;
          file_size_bytes?: number | null;
          id?: string;
          original_file_name?: string | null;
          status?: Database["public"]["Enums"]["content_item_status"];
          storage_path?: string | null;
          type?: Database["public"]["Enums"]["content_item_type"];
          updated_at?: string;
          upload_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_mime_type?: string | null;
          file_size_bytes?: number | null;
          id?: string;
          original_file_name?: string | null;
          status?: Database["public"]["Enums"]["content_item_status"];
          storage_path?: string | null;
          type?: Database["public"]["Enums"]["content_item_type"];
          updated_at?: string;
          upload_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      advance_analysis_job: {
        Args: {
          p_attempt?: number;
          p_error_code?: string;
          p_generation: number;
          p_job_id: string;
          p_run_id: string;
          p_status: Database["public"]["Enums"]["analysis_job_status"];
        };
        Returns: {
          attempt: number;
          completed_at: string | null;
          content_item_id: string;
          created_at: string;
          error_code: string | null;
          generation: number;
          id: string;
          pipeline_version: string;
          run_id: string | null;
          stage: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["analysis_job_status"];
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "analysis_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      set_analysis_job_stage: {
        Args: {
          p_attempt?: number;
          p_generation: number;
          p_job_id: string;
          p_run_id: string;
          p_stage: string;
        };
        Returns: boolean;
      };
      request_analysis_job: {
        Args: { p_content_item_id: string; p_retry_generation?: number };
        Returns: {
          attempt: number;
          completed_at: string | null;
          content_item_id: string;
          created_at: string;
          error_code: string | null;
          generation: number;
          id: string;
          pipeline_version: string;
          run_id: string | null;
          stage: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["analysis_job_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "analysis_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      analysis_job_status:
        "queued" | "running" | "completed" | "failed" | "cancelled";
      content_item_status: "pending" | "ready" | "failed";
      content_item_type: "video";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      analysis_job_status: [
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ],
      content_item_status: ["pending", "ready", "failed"],
      content_item_type: ["video"],
    },
  },
} as const;
