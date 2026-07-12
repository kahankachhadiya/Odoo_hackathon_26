// This file was generated to match the schema defined in supabase/schema.sql.
// To regenerate: npx supabase gen types typescript --project-id <ref> --schema public > src/lib/database.types.ts
// Do NOT hand-edit this file — regenerate it whenever the schema changes.

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
      profiles: {
        Row: {
          id: string
          full_name: string | null
          email: string
          role: Database['public']['Enums']['user_role']
          department_id: string | null
          status: Database['public']['Enums']['active_status']
          created_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          email: string
          role?: Database['public']['Enums']['user_role']
          department_id?: string | null
          status?: Database['public']['Enums']['active_status']
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          email?: string
          role?: Database['public']['Enums']['user_role']
          department_id?: string | null
          status?: Database['public']['Enums']['active_status']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_department_id_fkey'
            columns: ['department_id']
            isOneToOne: false
            referencedRelation: 'departments'
            referencedColumns: ['id']
          }
        ]
      }
      departments: {
        Row: {
          id: string
          name: string
          head_id: string | null
          parent_department_id: string | null
          status: Database['public']['Enums']['active_status']
        }
        Insert: {
          id?: string
          name: string
          head_id?: string | null
          parent_department_id?: string | null
          status?: Database['public']['Enums']['active_status']
        }
        Update: {
          id?: string
          name?: string
          head_id?: string | null
          parent_department_id?: string | null
          status?: Database['public']['Enums']['active_status']
        }
        Relationships: [
          {
            foreignKeyName: 'departments_head_id_fkey'
            columns: ['head_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'departments_parent_department_id_fkey'
            columns: ['parent_department_id']
            isOneToOne: false
            referencedRelation: 'departments'
            referencedColumns: ['id']
          }
        ]
      }
      asset_categories: {
        Row: {
          id: string
          name: string
          attributes: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          attributes?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          attributes?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          id: string
          tag: string
          name: string
          category_id: string
          serial_number: string | null
          status: Database['public']['Enums']['asset_status']
          condition: string | null
          location: string | null
          is_bookable: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tag?: string
          name: string
          category_id: string
          serial_number?: string | null
          status?: Database['public']['Enums']['asset_status']
          condition?: string | null
          location?: string | null
          is_bookable?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tag?: string
          name?: string
          category_id?: string
          serial_number?: string | null
          status?: Database['public']['Enums']['asset_status']
          condition?: string | null
          location?: string | null
          is_bookable?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'assets_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'asset_categories'
            referencedColumns: ['id']
          }
        ]
      }
      allocations: {
        Row: {
          id: string
          asset_id: string
          assigned_to: string
          assigned_by: string
          expected_return_date: string | null
          returned_at: string | null
          return_condition: string | null
        }
        Insert: {
          id?: string
          asset_id: string
          assigned_to: string
          assigned_by: string
          expected_return_date?: string | null
          returned_at?: string | null
          return_condition?: string | null
        }
        Update: {
          id?: string
          asset_id?: string
          assigned_to?: string
          assigned_by?: string
          expected_return_date?: string | null
          returned_at?: string | null
          return_condition?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'allocations_asset_id_fkey'
            columns: ['asset_id']
            isOneToOne: false
            referencedRelation: 'assets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'allocations_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'allocations_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      transfer_requests: {
        Row: {
          id: string
          asset_id: string
          requested_by: string
          current_holder: string
          reason: string
          status: Database['public']['Enums']['transfer_request_status']
          created_at: string
        }
        Insert: {
          id?: string
          asset_id: string
          requested_by: string
          current_holder: string
          reason: string
          status?: Database['public']['Enums']['transfer_request_status']
          created_at?: string
        }
        Update: {
          id?: string
          asset_id?: string
          requested_by?: string
          current_holder?: string
          reason?: string
          status?: Database['public']['Enums']['transfer_request_status']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'transfer_requests_asset_id_fkey'
            columns: ['asset_id']
            isOneToOne: false
            referencedRelation: 'assets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transfer_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transfer_requests_current_holder_fkey'
            columns: ['current_holder']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_asset_manager: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      user_role: 'Employee' | 'Department Head' | 'Asset Manager' | 'Admin'
      active_status: 'Active' | 'Inactive'
      asset_status: 'Available' | 'Allocated' | 'Reserved' | 'Under Maintenance' | 'Lost' | 'Retired' | 'Disposed'
      transfer_request_status: 'Pending' | 'Approved' | 'Rejected'
    }
    CompositeTypes: Record<string, never>
  }
}

// Convenience type helpers — mirrors what `supabase gen types` produces
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]
