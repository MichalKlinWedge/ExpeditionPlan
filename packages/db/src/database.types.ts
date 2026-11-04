
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"diff": Json | null,"entity": string,"entity_id": string,"id": number,"trip_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"entity": string,"entity_id": string,"id"?: never,"trip_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"entity"?: string,"entity_id"?: string,"id"?: never,"trip_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_log_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_messages": {
                  Row: {
                    "ai_run_id": string | null,"content": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"role": string,"row_version": number,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_run_id"?: string | null,"content": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id": string,"role": string,"row_version"?: number,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "ai_run_id"?: string | null,"content"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"role"?: string,"row_version"?: number,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_messages_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_messages_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_messages_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_runs": {
                  Row: {
                    "cost_usd": number | null,"created_at": string,"created_by": string,"deleted_at": string | null,"duration_ms": number | null,"id": string,"input": Json | null,"model": string,"output": Json | null,"parent_run_id": string | null,"provider": string,"row_version": number,"stage": string,"status": string,"tokens_in": number | null,"tokens_out": number | null,"trip_id": string,"updated_at": string,"updated_by": string | null,"validation_errors": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_usd"?: number | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"duration_ms"?: number | null,"id": string,"input"?: Json | null,"model": string,"output"?: Json | null,"parent_run_id"?: string | null,"provider": string,"row_version"?: number,"stage": string,"status"?: string,"tokens_in"?: number | null,"tokens_out"?: number | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"validation_errors"?: Json | null
                  }
                  Update: {
                    "cost_usd"?: number | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"duration_ms"?: number | null,"id"?: string,"input"?: Json | null,"model"?: string,"output"?: Json | null,"parent_run_id"?: string | null,"provider"?: string,"row_version"?: number,"stage"?: string,"status"?: string,"tokens_in"?: number | null,"tokens_out"?: number | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"validation_errors"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_runs_parent_run_id_fkey"
      columns: ["parent_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_runs_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_runs_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"audio_guides": {
                  Row: {
                    "audience": string,"audio_path": string | null,"content": NonNullable<Json>,"created_at": string,"deleted_at": string | null,"duration_s": number | null,"id": string,"item_id": string | null,"lang": string,"license": string | null,"place_id": string | null,"row_version": number,"sources": NonNullable<Json>,"status": string,"text": string,"title": string,"trigger_radius_m": number,"trip_id": string,"updated_at": string,"updated_by": string | null,"voice": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string,"audio_path"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"duration_s"?: number | null,"id": string,"item_id"?: string | null,"lang"?: string,"license"?: string | null,"place_id"?: string | null,"row_version"?: number,"sources"?: NonNullable<Json>,"status"?: string,"text": string,"title": string,"trigger_radius_m"?: number,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"voice"?: string | null
                  }
                  Update: {
                    "audience"?: string,"audio_path"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"duration_s"?: number | null,"id"?: string,"item_id"?: string | null,"lang"?: string,"license"?: string | null,"place_id"?: string | null,"row_version"?: number,"sources"?: NonNullable<Json>,"status"?: string,"text"?: string,"title"?: string,"trigger_radius_m"?: number,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"voice"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audio_guides_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audio_guides_place_id_fkey"
      columns: ["place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audio_guides_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audio_guides_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "addons": NonNullable<Json>,"check_in_from": string | null,"check_out_until": string | null,"confirmation_code": string | null,"cons": (string)[],"created_at": string,"deleted_at": string | null,"details": NonNullable<Json>,"end_date": string | null,"end_place_id": string | null,"end_precision": string | null,"end_time": string | null,"end_tz": string | null,"free_cancellation_until": string | null,"id": string,"includes": (string)[],"kind": string,"language": string | null,"links": NonNullable<Json>,"notes": (string)[],"paid_by_traveler_id": string | null,"paid_currency": string | null,"paid_minor": number | null,"paid_on": string | null,"party": Json | null,"pay_when": string | null,"payment_method": string | null,"price": Json | null,"pros": (string)[],"provider": string | null,"rating": Json | null,"raw": Json | null,"recommended": boolean | null,"ref": string | null,"refundable": boolean | null,"row_version": number,"sort_key": string | null,"start_date": string | null,"start_place_id": string | null,"start_precision": string | null,"start_time": string | null,"start_tz": string | null,"status": string,"title": string,"trip_id": string,"updated_at": string,"updated_by": string | null,"variant_group_id": string | null,"variant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "addons"?: NonNullable<Json>,"check_in_from"?: string | null,"check_out_until"?: string | null,"confirmation_code"?: string | null,"cons"?: (string)[],"created_at"?: string,"deleted_at"?: string | null,"details"?: NonNullable<Json>,"end_date"?: string | null,"end_place_id"?: string | null,"end_precision"?: string | null,"end_time"?: string | null,"end_tz"?: string | null,"free_cancellation_until"?: string | null,"id": string,"includes"?: (string)[],"kind": string,"language"?: string | null,"links"?: NonNullable<Json>,"notes"?: (string)[],"paid_by_traveler_id"?: string | null,"paid_currency"?: string | null,"paid_minor"?: number | null,"paid_on"?: string | null,"party"?: Json | null,"pay_when"?: string | null,"payment_method"?: string | null,"price"?: Json | null,"pros"?: (string)[],"provider"?: string | null,"rating"?: Json | null,"raw"?: Json | null,"recommended"?: boolean | null,"ref"?: string | null,"refundable"?: boolean | null,"row_version"?: number,"sort_key"?: string | null,"start_date"?: string | null,"start_place_id"?: string | null,"start_precision"?: string | null,"start_time"?: string | null,"start_tz"?: string | null,"status": string,"title": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"variant_group_id"?: string | null,"variant_id"?: string | null
                  }
                  Update: {
                    "addons"?: NonNullable<Json>,"check_in_from"?: string | null,"check_out_until"?: string | null,"confirmation_code"?: string | null,"cons"?: (string)[],"created_at"?: string,"deleted_at"?: string | null,"details"?: NonNullable<Json>,"end_date"?: string | null,"end_place_id"?: string | null,"end_precision"?: string | null,"end_time"?: string | null,"end_tz"?: string | null,"free_cancellation_until"?: string | null,"id"?: string,"includes"?: (string)[],"kind"?: string,"language"?: string | null,"links"?: NonNullable<Json>,"notes"?: (string)[],"paid_by_traveler_id"?: string | null,"paid_currency"?: string | null,"paid_minor"?: number | null,"paid_on"?: string | null,"party"?: Json | null,"pay_when"?: string | null,"payment_method"?: string | null,"price"?: Json | null,"pros"?: (string)[],"provider"?: string | null,"rating"?: Json | null,"raw"?: Json | null,"recommended"?: boolean | null,"ref"?: string | null,"refundable"?: boolean | null,"row_version"?: number,"sort_key"?: string | null,"start_date"?: string | null,"start_place_id"?: string | null,"start_precision"?: string | null,"start_time"?: string | null,"start_tz"?: string | null,"status"?: string,"title"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"variant_group_id"?: string | null,"variant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_end_place_id_fkey"
      columns: ["end_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_paid_by_traveler_id_fkey"
      columns: ["paid_by_traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_start_place_id_fkey"
      columns: ["start_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_variant_group_id_fkey"
      columns: ["variant_group_id"]
isOneToOne: false
      referencedRelation: "variant_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "variants"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_lines": {
                  Row: {
                    "auto": boolean,"base_high_minor": number | null,"base_low_minor": number | null,"booking_id": string | null,"category": string,"created_at": string,"currency": string,"deleted_at": string | null,"fx_date": string | null,"fx_rate": number | null,"high_minor": number,"id": string,"item_id": string | null,"low_minor": number,"note": string | null,"per_person": boolean,"ref": string | null,"row_version": number,"sort_key": string | null,"status": string,"title": string,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auto"?: boolean,"base_high_minor"?: number | null,"base_low_minor"?: number | null,"booking_id"?: string | null,"category": string,"created_at"?: string,"currency": string,"deleted_at"?: string | null,"fx_date"?: string | null,"fx_rate"?: number | null,"high_minor": number,"id": string,"item_id"?: string | null,"low_minor": number,"note"?: string | null,"per_person"?: boolean,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"status": string,"title": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "auto"?: boolean,"base_high_minor"?: number | null,"base_low_minor"?: number | null,"booking_id"?: string | null,"category"?: string,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"fx_date"?: string | null,"fx_rate"?: number | null,"high_minor"?: number,"id"?: string,"item_id"?: string | null,"low_minor"?: number,"note"?: string | null,"per_person"?: boolean,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"status"?: string,"title"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_lines_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_lines_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_lines_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"constraints": {
                  Row: {
                    "booking_id": string | null,"created_at": string,"day_id": string | null,"deleted_at": string | null,"id": string,"item_id": string | null,"kind": string,"minutes": number | null,"reason": string | null,"ref": string | null,"row_version": number,"severity": string,"sort_key": string | null,"time": string | null,"trip_id": string,"tz": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"created_at"?: string,"day_id"?: string | null,"deleted_at"?: string | null,"id": string,"item_id"?: string | null,"kind": string,"minutes"?: number | null,"reason"?: string | null,"ref"?: string | null,"row_version"?: number,"severity"?: string,"sort_key"?: string | null,"time"?: string | null,"trip_id": string,"tz"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"created_at"?: string,"day_id"?: string | null,"deleted_at"?: string | null,"id"?: string,"item_id"?: string | null,"kind"?: string,"minutes"?: number | null,"reason"?: string | null,"ref"?: string | null,"row_version"?: number,"severity"?: string,"sort_key"?: string | null,"time"?: string | null,"trip_id"?: string,"tz"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "constraints_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "constraints_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "constraints_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "constraints_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "constraints_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "booking_id": string | null,"created_at": string,"deleted_at": string | null,"email": string | null,"id": string,"messenger": string | null,"name": string,"notes": string | null,"phone": string | null,"ref": string | null,"role": string,"row_version": number,"sort_key": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"id": string,"messenger"?: string | null,"name": string,"notes"?: string | null,"phone"?: string | null,"ref"?: string | null,"role": string,"row_version"?: number,"sort_key"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"messenger"?: string | null,"name"?: string,"notes"?: string | null,"phone"?: string | null,"ref"?: string | null,"role"?: string,"row_version"?: number,"sort_key"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"days": {
                  Row: {
                    "anchor_time": string | null,"base_place_id": string | null,"created_at": string,"date": string,"day_end": string | null,"day_start": string | null,"deleted_at": string | null,"id": string,"lodging_booking_id": string | null,"lodging_group_id": string | null,"ref": string | null,"row_version": number,"stated_driving": Json | null,"summary": string | null,"title": string | null,"trip_id": string,"tz": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor_time"?: string | null,"base_place_id"?: string | null,"created_at"?: string,"date": string,"day_end"?: string | null,"day_start"?: string | null,"deleted_at"?: string | null,"id": string,"lodging_booking_id"?: string | null,"lodging_group_id"?: string | null,"ref"?: string | null,"row_version"?: number,"stated_driving"?: Json | null,"summary"?: string | null,"title"?: string | null,"trip_id": string,"tz": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "anchor_time"?: string | null,"base_place_id"?: string | null,"created_at"?: string,"date"?: string,"day_end"?: string | null,"day_start"?: string | null,"deleted_at"?: string | null,"id"?: string,"lodging_booking_id"?: string | null,"lodging_group_id"?: string | null,"ref"?: string | null,"row_version"?: number,"stated_driving"?: Json | null,"summary"?: string | null,"title"?: string | null,"trip_id"?: string,"tz"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "days_base_place_id_fkey"
      columns: ["base_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "days_lodging_booking_id_fkey"
      columns: ["lodging_booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "days_lodging_group_id_fkey"
      columns: ["lodging_group_id"]
isOneToOne: false
      referencedRelation: "variant_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "days_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "days_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "booking_id": string | null,"code_format": string | null,"code_payload": string | null,"created_at": string,"deleted_at": string | null,"file_name": string,"id": string,"item_id": string | null,"mime": string | null,"offline": boolean,"row_version": number,"sha256": string | null,"size": number | null,"storage_path": string,"trip_id": string,"updated_at": string,"updated_by": string | null,"visibility": string,"visible_to": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"code_format"?: string | null,"code_payload"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"file_name": string,"id": string,"item_id"?: string | null,"mime"?: string | null,"offline"?: boolean,"row_version"?: number,"sha256"?: string | null,"size"?: number | null,"storage_path": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"visibility"?: string,"visible_to"?: (string)[]
                  }
                  Update: {
                    "booking_id"?: string | null,"code_format"?: string | null,"code_payload"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"file_name"?: string,"id"?: string,"item_id"?: string | null,"mime"?: string | null,"offline"?: boolean,"row_version"?: number,"sha256"?: string | null,"size"?: number | null,"storage_path"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"visibility"?: string,"visible_to"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_splits": {
                  Row: {
                    "amount_minor": number | null,"created_at": string,"deleted_at": string | null,"expense_id": string,"household": string | null,"id": string,"row_version": number,"traveler_id": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null,"weight": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"expense_id": string,"household"?: string | null,"id": string,"row_version"?: number,"traveler_id"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"weight"?: number | null
                  }
                  Update: {
                    "amount_minor"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"expense_id"?: string,"household"?: string | null,"id"?: string,"row_version"?: number,"traveler_id"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"weight"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_splits_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_splits_traveler_id_fkey"
      columns: ["traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_splits_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_splits_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount_minor": number,"base_amount_minor": number | null,"booking_id": string | null,"budget_line_id": string | null,"category": string,"created_at": string,"created_by": string | null,"currency": string,"deleted_at": string | null,"fx_rate": number | null,"fx_source": string | null,"id": string,"item_id": string | null,"note": string | null,"paid_at": string,"payer_traveler_id": string | null,"receipt_document_id": string | null,"receipt_path": string | null,"row_version": number,"split_mode": string,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"base_amount_minor"?: number | null,"booking_id"?: string | null,"budget_line_id"?: string | null,"category"?: string,"created_at"?: string,"created_by"?: string | null,"currency": string,"deleted_at"?: string | null,"fx_rate"?: number | null,"fx_source"?: string | null,"id": string,"item_id"?: string | null,"note"?: string | null,"paid_at": string,"payer_traveler_id"?: string | null,"receipt_document_id"?: string | null,"receipt_path"?: string | null,"row_version"?: number,"split_mode"?: string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount_minor"?: number,"base_amount_minor"?: number | null,"booking_id"?: string | null,"budget_line_id"?: string | null,"category"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"deleted_at"?: string | null,"fx_rate"?: number | null,"fx_source"?: string | null,"id"?: string,"item_id"?: string | null,"note"?: string | null,"paid_at"?: string,"payer_traveler_id"?: string | null,"receipt_document_id"?: string | null,"receipt_path"?: string | null,"row_version"?: number,"split_mode"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_budget_line_id_fkey"
      columns: ["budget_line_id"]
isOneToOne: false
      referencedRelation: "budget_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_payer_traveler_id_fkey"
      columns: ["payer_traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_receipt_document_id_fkey"
      columns: ["receipt_document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "activity": Json | null,"ai_run_id": string | null,"area": string | null,"booking_group_id": string | null,"booking_id": string | null,"buffer_after_min": number | null,"created_at": string,"cut_rank": number | null,"day_id": string | null,"deleted_at": string | null,"description": string | null,"duration_max_min": number | null,"duration_min": number | null,"end_time": string | null,"id": string,"is_fixed": boolean | null,"kind": string,"leg": Json | null,"links": NonNullable<Json>,"notes": (string)[],"offset_min": number | null,"parent_id": string | null,"part_of_day": string | null,"participant_ids": (string)[] | null,"payment": string | null,"place_id": string | null,"plan_status": string,"price": Json | null,"priority": string | null,"ref": string | null,"relative_from": string | null,"replaces_item_ids": (string)[],"row_version": number,"self_cooked": boolean | null,"sort_key": string | null,"source": string,"start_time": string | null,"status": string,"time_precision": string | null,"time_tz": string | null,"title": string,"trip_id": string,"updated_at": string,"updated_by": string | null,"user_locked": boolean,"variant_ids": (string)[],"weather": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activity"?: Json | null,"ai_run_id"?: string | null,"area"?: string | null,"booking_group_id"?: string | null,"booking_id"?: string | null,"buffer_after_min"?: number | null,"created_at"?: string,"cut_rank"?: number | null,"day_id"?: string | null,"deleted_at"?: string | null,"description"?: string | null,"duration_max_min"?: number | null,"duration_min"?: number | null,"end_time"?: string | null,"id": string,"is_fixed"?: boolean | null,"kind": string,"leg"?: Json | null,"links"?: NonNullable<Json>,"notes"?: (string)[],"offset_min"?: number | null,"parent_id"?: string | null,"part_of_day"?: string | null,"participant_ids"?: (string)[] | null,"payment"?: string | null,"place_id"?: string | null,"plan_status"?: string,"price"?: Json | null,"priority"?: string | null,"ref"?: string | null,"relative_from"?: string | null,"replaces_item_ids"?: (string)[],"row_version"?: number,"self_cooked"?: boolean | null,"sort_key"?: string | null,"source"?: string,"start_time"?: string | null,"status"?: string,"time_precision"?: string | null,"time_tz"?: string | null,"title": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"user_locked"?: boolean,"variant_ids"?: (string)[],"weather"?: string | null
                  }
                  Update: {
                    "activity"?: Json | null,"ai_run_id"?: string | null,"area"?: string | null,"booking_group_id"?: string | null,"booking_id"?: string | null,"buffer_after_min"?: number | null,"created_at"?: string,"cut_rank"?: number | null,"day_id"?: string | null,"deleted_at"?: string | null,"description"?: string | null,"duration_max_min"?: number | null,"duration_min"?: number | null,"end_time"?: string | null,"id"?: string,"is_fixed"?: boolean | null,"kind"?: string,"leg"?: Json | null,"links"?: NonNullable<Json>,"notes"?: (string)[],"offset_min"?: number | null,"parent_id"?: string | null,"part_of_day"?: string | null,"participant_ids"?: (string)[] | null,"payment"?: string | null,"place_id"?: string | null,"plan_status"?: string,"price"?: Json | null,"priority"?: string | null,"ref"?: string | null,"relative_from"?: string | null,"replaces_item_ids"?: (string)[],"row_version"?: number,"self_cooked"?: boolean | null,"sort_key"?: string | null,"source"?: string,"start_time"?: string | null,"status"?: string,"time_precision"?: string | null,"time_tz"?: string | null,"title"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_locked"?: boolean,"variant_ids"?: (string)[],"weather"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_booking_group_id_fkey"
      columns: ["booking_group_id"]
isOneToOne: false
      referencedRelation: "variant_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_place_id_fkey"
      columns: ["place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"journal_entries": {
                  Row: {
                    "body": string,"created_at": string,"created_by": string | null,"day_id": string | null,"deleted_at": string | null,"id": string,"item_id": string | null,"photo_path": string | null,"row_version": number,"taken_at": string,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"created_at"?: string,"created_by"?: string | null,"day_id"?: string | null,"deleted_at"?: string | null,"id": string,"item_id"?: string | null,"photo_path"?: string | null,"row_version"?: number,"taken_at": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"created_by"?: string | null,"day_id"?: string | null,"deleted_at"?: string | null,"id"?: string,"item_id"?: string | null,"photo_path"?: string | null,"row_version"?: number,"taken_at"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "journal_entries_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_entries_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_entries_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_entries_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"legs": {
                  Row: {
                    "computed_at": string | null,"created_at": string,"deleted_at": string | null,"details": NonNullable<Json>,"distance_km": number | null,"duration_max_min": number | null,"duration_min": number | null,"frequency_min": number | null,"from_item_id": string | null,"from_place_id": string | null,"id": string,"instructions": string | null,"line": string | null,"mode": string,"polyline": string | null,"price": Json | null,"ref": string | null,"row_version": number,"sort_key": string | null,"source": string,"ticket_booking_id": string | null,"to_item_id": string | null,"to_place_id": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "computed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"details"?: NonNullable<Json>,"distance_km"?: number | null,"duration_max_min"?: number | null,"duration_min"?: number | null,"frequency_min"?: number | null,"from_item_id"?: string | null,"from_place_id"?: string | null,"id": string,"instructions"?: string | null,"line"?: string | null,"mode": string,"polyline"?: string | null,"price"?: Json | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"source"?: string,"ticket_booking_id"?: string | null,"to_item_id"?: string | null,"to_place_id"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "computed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"details"?: NonNullable<Json>,"distance_km"?: number | null,"duration_max_min"?: number | null,"duration_min"?: number | null,"frequency_min"?: number | null,"from_item_id"?: string | null,"from_place_id"?: string | null,"id"?: string,"instructions"?: string | null,"line"?: string | null,"mode"?: string,"polyline"?: string | null,"price"?: Json | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"source"?: string,"ticket_booking_id"?: string | null,"to_item_id"?: string | null,"to_place_id"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "legs_from_item_id_fkey"
      columns: ["from_item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legs_from_place_id_fkey"
      columns: ["from_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legs_ticket_booking_id_fkey"
      columns: ["ticket_booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legs_to_item_id_fkey"
      columns: ["to_item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legs_to_place_id_fkey"
      columns: ["to_place_id"]
isOneToOne: false
      referencedRelation: "places"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legs_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legs_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"notes": {
                  Row: {
                    "body": string,"created_at": string,"deleted_at": string | null,"entity_id": string | null,"id": string,"kind": string,"ref": string | null,"row_version": number,"scope": string,"slack": string | null,"sort_key": string | null,"title": string | null,"topic": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"deleted_at"?: string | null,"entity_id"?: string | null,"id": string,"kind": string,"ref"?: string | null,"row_version"?: number,"scope": string,"slack"?: string | null,"sort_key"?: string | null,"title"?: string | null,"topic"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"deleted_at"?: string | null,"entity_id"?: string | null,"id"?: string,"kind"?: string,"ref"?: string | null,"row_version"?: number,"scope"?: string,"slack"?: string | null,"sort_key"?: string | null,"title"?: string | null,"topic"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notes_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notes_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"packing_checks": {
                  Row: {
                    "checked_at": string,"created_at": string,"deleted_at": string | null,"id": string,"packed": boolean,"packing_item_id": string,"row_version": number,"traveler_id": string,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at"?: string,"created_at"?: string,"deleted_at"?: string | null,"id": string,"packed"?: boolean,"packing_item_id": string,"row_version"?: number,"traveler_id": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "checked_at"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"packed"?: boolean,"packing_item_id"?: string,"row_version"?: number,"traveler_id"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "packing_checks_packing_item_id_fkey"
      columns: ["packing_item_id"]
isOneToOne: false
      referencedRelation: "packing_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packing_checks_traveler_id_fkey"
      columns: ["traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packing_checks_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packing_checks_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"packing_items": {
                  Row: {
                    "assignee_traveler_id": string | null,"category": string,"created_at": string,"deleted_at": string | null,"id": string,"note": string | null,"quantity": number | null,"ref": string | null,"row_version": number,"scope": string,"sort_key": string | null,"title": string,"trip_id": string,"unit": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_traveler_id"?: string | null,"category": string,"created_at"?: string,"deleted_at"?: string | null,"id": string,"note"?: string | null,"quantity"?: number | null,"ref"?: string | null,"row_version"?: number,"scope": string,"sort_key"?: string | null,"title": string,"trip_id": string,"unit"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "assignee_traveler_id"?: string | null,"category"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"note"?: string | null,"quantity"?: number | null,"ref"?: string | null,"row_version"?: number,"scope"?: string,"sort_key"?: string | null,"title"?: string,"trip_id"?: string,"unit"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "packing_items_assignee_traveler_id_fkey"
      columns: ["assignee_traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packing_items_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packing_items_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"places": {
                  Row: {
                    "address": string | null,"category": string | null,"created_at": string,"deleted_at": string | null,"elevation_m": number | null,"fetched_at": string | null,"id": string,"lat": number | null,"links": NonNullable<Json>,"lng": number | null,"name": string,"notes": string | null,"opening_hours": string | null,"opening_hours_parsed": Json | null,"provider": string,"provider_id": string | null,"raw": Json | null,"ref": string | null,"row_version": number,"search_name": string | null,"sort_key": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"category"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"elevation_m"?: number | null,"fetched_at"?: string | null,"id": string,"lat"?: number | null,"links"?: NonNullable<Json>,"lng"?: number | null,"name": string,"notes"?: string | null,"opening_hours"?: string | null,"opening_hours_parsed"?: Json | null,"provider"?: string,"provider_id"?: string | null,"raw"?: Json | null,"ref"?: string | null,"row_version"?: number,"search_name"?: string | null,"sort_key"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"category"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"elevation_m"?: number | null,"fetched_at"?: string | null,"id"?: string,"lat"?: number | null,"links"?: NonNullable<Json>,"lng"?: number | null,"name"?: string,"notes"?: string | null,"opening_hours"?: string | null,"opening_hours_parsed"?: Json | null,"provider"?: string,"provider_id"?: string | null,"raw"?: Json | null,"ref"?: string | null,"row_version"?: number,"search_name"?: string | null,"sort_key"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "places_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "places_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_snapshots": {
                  Row: {
                    "created_at": string,"created_by": string,"deleted_at": string | null,"id": string,"label": string,"row_version": number,"snapshot": NonNullable<Json>,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"id": string,"label": string,"row_version"?: number,"snapshot": NonNullable<Json>,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"id"?: string,"label"?: string,"row_version"?: number,"snapshot"?: NonNullable<Json>,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_snapshots_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_snapshots_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"home_currency": string,"id": string,"locale": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"home_currency"?: string,"id": string,"locale"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"home_currency"?: string,"id"?: string,"locale"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"public_shares": {
                  Row: {
                    "created_at": string,"enabled": boolean,"hide": NonNullable<Json>,"id": string,"token_hash": string,"trip_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"enabled"?: boolean,"hide"?: NonNullable<Json>,"id"?: string,"token_hash": string,"trip_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"enabled"?: boolean,"hide"?: NonNullable<Json>,"id"?: string,"token_hash"?: string,"trip_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "public_shares_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: true
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_shares_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: true
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_events": {
                  Row: {
                    "created_at": string,"created_by": string | null,"day_id": string | null,"deleted_at": string | null,"device_id": string | null,"id": string,"item_id": string | null,"kind": string,"minutes": number | null,"occurred_at": string,"payload": NonNullable<Json>,"row_version": number,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"day_id"?: string | null,"deleted_at"?: string | null,"device_id"?: string | null,"id": string,"item_id"?: string | null,"kind": string,"minutes"?: number | null,"occurred_at": string,"payload"?: NonNullable<Json>,"row_version"?: number,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"day_id"?: string | null,"deleted_at"?: string | null,"device_id"?: string | null,"id"?: string,"item_id"?: string | null,"kind"?: string,"minutes"?: number | null,"occurred_at"?: string,"payload"?: NonNullable<Json>,"row_version"?: number,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_events_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_events_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_events_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_events_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"settlements": {
                  Row: {
                    "amount_minor": number,"created_at": string,"currency": string,"deleted_at": string | null,"from_traveler_id": string,"id": string,"row_version": number,"settled_at": string | null,"to_traveler_id": string,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"created_at"?: string,"currency": string,"deleted_at"?: string | null,"from_traveler_id": string,"id": string,"row_version"?: number,"settled_at"?: string | null,"to_traveler_id": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount_minor"?: number,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"from_traveler_id"?: string,"id"?: string,"row_version"?: number,"settled_at"?: string | null,"to_traveler_id"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "settlements_from_traveler_id_fkey"
      columns: ["from_traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_to_traveler_id_fkey"
      columns: ["to_traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlements_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "applies_to_ids": (string)[],"checked_at": string | null,"created_at": string,"deleted_at": string | null,"id": string,"note": string | null,"ref": string | null,"row_version": number,"sort_key": string | null,"title": string,"trip_id": string,"updated_at": string,"updated_by": string | null,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "applies_to_ids"?: (string)[],"checked_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id": string,"note"?: string | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"title": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"url"?: string | null
                  }
                  Update: {
                    "applies_to_ids"?: (string)[],"checked_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"note"?: string | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"title"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sources_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sources_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "answer": string | null,"assignee_ids": (string)[],"body": string | null,"booking_id": string | null,"created_at": string,"deleted_at": string | null,"due": Json | null,"id": string,"item_id": string | null,"kind": string,"priority": string | null,"ref": string | null,"row_version": number,"sort_key": string | null,"source": string,"status": string,"title": string,"trip_id": string,"updated_at": string,"updated_by": string | null,"variant_group_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "answer"?: string | null,"assignee_ids"?: (string)[],"body"?: string | null,"booking_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due"?: Json | null,"id": string,"item_id"?: string | null,"kind": string,"priority"?: string | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"source"?: string,"status"?: string,"title": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"variant_group_id"?: string | null
                  }
                  Update: {
                    "answer"?: string | null,"assignee_ids"?: (string)[],"body"?: string | null,"booking_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due"?: Json | null,"id"?: string,"item_id"?: string | null,"kind"?: string,"priority"?: string | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"source"?: string,"status"?: string,"title"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"variant_group_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_variant_group_id_fkey"
      columns: ["variant_group_id"]
isOneToOne: false
      referencedRelation: "variant_groups"
      referencedColumns: ["id"]
    }
                  ]
                },"tracks": {
                  Row: {
                    "ascent_m": number | null,"created_at": string,"deleted_at": string | null,"descent_m": number | null,"difficulty": string | null,"distance_km": number | null,"duration_max_min": number | null,"duration_min": number | null,"geojson": Json | null,"gpx_path": string | null,"id": string,"name": string,"offline": boolean,"ref": string | null,"route_notes": string | null,"row_version": number,"sort_key": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null,"url": string | null,"waymarking": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ascent_m"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"descent_m"?: number | null,"difficulty"?: string | null,"distance_km"?: number | null,"duration_max_min"?: number | null,"duration_min"?: number | null,"geojson"?: Json | null,"gpx_path"?: string | null,"id": string,"name": string,"offline"?: boolean,"ref"?: string | null,"route_notes"?: string | null,"row_version"?: number,"sort_key"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"url"?: string | null,"waymarking"?: string | null
                  }
                  Update: {
                    "ascent_m"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"descent_m"?: number | null,"difficulty"?: string | null,"distance_km"?: number | null,"duration_max_min"?: number | null,"duration_min"?: number | null,"geojson"?: Json | null,"gpx_path"?: string | null,"id"?: string,"name"?: string,"offline"?: boolean,"ref"?: string | null,"route_notes"?: string | null,"row_version"?: number,"sort_key"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"url"?: string | null,"waymarking"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tracks_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tracks_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"travelers": {
                  Row: {
                    "age": number | null,"created_at": string,"deleted_at": string | null,"diet": string | null,"guardian_id": string | null,"height_cm": number | null,"household": string | null,"id": string,"is_driver": boolean | null,"name": string,"nickname": string | null,"notes": string | null,"ref": string | null,"row_version": number,"sort_key": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "age"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"diet"?: string | null,"guardian_id"?: string | null,"height_cm"?: number | null,"household"?: string | null,"id": string,"is_driver"?: boolean | null,"name": string,"nickname"?: string | null,"notes"?: string | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "age"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"diet"?: string | null,"guardian_id"?: string | null,"height_cm"?: number | null,"household"?: string | null,"id"?: string,"is_driver"?: boolean | null,"name"?: string,"nickname"?: string | null,"notes"?: string | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "travelers_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "travelers_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "travelers_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trip_brief": {
                  Row: {
                    "brief": NonNullable<Json>,"created_at": string,"deleted_at": string | null,"id": string,"row_version": number,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brief": NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"id": string,"row_version"?: number,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "brief"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"row_version"?: number,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trip_brief_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: true
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trip_brief_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: true
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trip_invites": {
                  Row: {
                    "created_at": string,"created_by": string,"expires_at": string,"id": string,"max_uses": number,"revoked_at": string | null,"role": string,"token_hash": string,"traveler_id": string | null,"trip_id": string,"used_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string,"expires_at"?: string,"id"?: string,"max_uses"?: number,"revoked_at"?: string | null,"role": string,"token_hash": string,"traveler_id"?: string | null,"trip_id": string,"used_count"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"expires_at"?: string,"id"?: string,"max_uses"?: number,"revoked_at"?: string | null,"role"?: string,"token_hash"?: string,"traveler_id"?: string | null,"trip_id"?: string,"used_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "trip_invites_traveler_id_fkey"
      columns: ["traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trip_invites_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trip_invites_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trip_members": {
                  Row: {
                    "can_add_expenses": boolean,"created_at": string,"invite_id": string | null,"last_seen_phone_at": string | null,"last_seen_web_at": string | null,"role": string,"seen_changes_at": string | null,"trip_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "can_add_expenses"?: boolean,"created_at"?: string,"invite_id"?: string | null,"last_seen_phone_at"?: string | null,"last_seen_web_at"?: string | null,"role": string,"seen_changes_at"?: string | null,"trip_id": string,"user_id": string
                  }
                  Update: {
                    "can_add_expenses"?: boolean,"created_at"?: string,"invite_id"?: string | null,"last_seen_phone_at"?: string | null,"last_seen_web_at"?: string | null,"role"?: string,"seen_changes_at"?: string | null,"trip_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trip_members_invite_id_fkey"
      columns: ["invite_id"]
isOneToOne: false
      referencedRelation: "trip_invites"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trip_members_profile_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trip_members_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trip_members_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trips": {
                  Row: {
                    "base_currency": string,"cover_path": string | null,"created_at": string,"deleted_at": string | null,"doc_version": string | null,"end_date": string,"fx": NonNullable<Json>,"goal": string | null,"home_tz": string,"id": string,"owner_id": string,"plan_version": number,"primary_tz": string,"row_version": number,"start_date": string,"status": string,"subtitle": string | null,"summary": string | null,"sync_version": number,"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "base_currency": string,"cover_path"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"doc_version"?: string | null,"end_date": string,"fx"?: NonNullable<Json>,"goal"?: string | null,"home_tz"?: string,"id": string,"owner_id"?: string,"plan_version"?: number,"primary_tz": string,"row_version"?: number,"start_date": string,"status"?: string,"subtitle"?: string | null,"summary"?: string | null,"sync_version"?: number,"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "base_currency"?: string,"cover_path"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"doc_version"?: string | null,"end_date"?: string,"fx"?: NonNullable<Json>,"goal"?: string | null,"home_tz"?: string,"id"?: string,"owner_id"?: string,"plan_version"?: number,"primary_tz"?: string,"row_version"?: number,"start_date"?: string,"status"?: string,"subtitle"?: string | null,"summary"?: string | null,"sync_version"?: number,"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"variant_groups": {
                  Row: {
                    "chosen_variant_id": string | null,"comparison": Json | null,"condition_kind": string,"condition_text": string | null,"created_at": string,"day_id": string | null,"decide_by": Json | null,"deleted_at": string | null,"id": string,"rationale": string | null,"ref": string | null,"row_version": number,"scope": string,"sort_key": string | null,"title": string,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "chosen_variant_id"?: string | null,"comparison"?: Json | null,"condition_kind": string,"condition_text"?: string | null,"created_at"?: string,"day_id"?: string | null,"decide_by"?: Json | null,"deleted_at"?: string | null,"id": string,"rationale"?: string | null,"ref"?: string | null,"row_version"?: number,"scope": string,"sort_key"?: string | null,"title": string,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "chosen_variant_id"?: string | null,"comparison"?: Json | null,"condition_kind"?: string,"condition_text"?: string | null,"created_at"?: string,"day_id"?: string | null,"decide_by"?: Json | null,"deleted_at"?: string | null,"id"?: string,"rationale"?: string | null,"ref"?: string | null,"row_version"?: number,"scope"?: string,"sort_key"?: string | null,"title"?: string,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "variant_groups_chosen_variant_id_fkey"
      columns: ["chosen_variant_id"]
isOneToOne: false
      referencedRelation: "variants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "variant_groups_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "variant_groups_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "variant_groups_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"variants": {
                  Row: {
                    "cons": (string)[],"created_at": string,"deleted_at": string | null,"excludes_item_ids": (string)[],"group_id": string,"id": string,"label": string,"metrics": Json | null,"pros": (string)[],"recommended": boolean | null,"ref": string | null,"row_version": number,"sort_key": string | null,"summary": string | null,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cons"?: (string)[],"created_at"?: string,"deleted_at"?: string | null,"excludes_item_ids"?: (string)[],"group_id": string,"id": string,"label": string,"metrics"?: Json | null,"pros"?: (string)[],"recommended"?: boolean | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"summary"?: string | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "cons"?: (string)[],"created_at"?: string,"deleted_at"?: string | null,"excludes_item_ids"?: (string)[],"group_id"?: string,"id"?: string,"label"?: string,"metrics"?: Json | null,"pros"?: (string)[],"recommended"?: boolean | null,"ref"?: string | null,"row_version"?: number,"sort_key"?: string | null,"summary"?: string | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "variants_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "variant_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "variants_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "variants_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicles": {
                  Row: {
                    "booking_id": string | null,"created_at": string,"deleted_at": string | null,"driver_traveler_id": string | null,"id": string,"label": string,"notes": string | null,"passenger_ids": (string)[],"row_version": number,"seats": number | null,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"driver_traveler_id"?: string | null,"id": string,"label": string,"notes"?: string | null,"passenger_ids"?: (string)[],"row_version"?: number,"seats"?: number | null,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"driver_traveler_id"?: string | null,"id"?: string,"label"?: string,"notes"?: string | null,"passenger_ids"?: (string)[],"row_version"?: number,"seats"?: number | null,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicles_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicles_driver_traveler_id_fkey"
      columns: ["driver_traveler_id"]
isOneToOne: false
      referencedRelation: "travelers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicles_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vehicles_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"weather_snapshots": {
                  Row: {
                    "created_at": string,"day_id": string | null,"deleted_at": string | null,"fetched_at": string,"forecast": NonNullable<Json>,"id": string,"lat": number,"lng": number,"row_version": number,"trip_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day_id"?: string | null,"deleted_at"?: string | null,"fetched_at"?: string,"forecast": NonNullable<Json>,"id": string,"lat": number,"lng": number,"row_version"?: number,"trip_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"day_id"?: string | null,"deleted_at"?: string | null,"fetched_at"?: string,"forecast"?: NonNullable<Json>,"id"?: string,"lat"?: number,"lng"?: number,"row_version"?: number,"trip_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "weather_snapshots_day_id_fkey"
      columns: ["day_id"]
isOneToOne: false
      referencedRelation: "days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "weather_snapshots_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "my_trips"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "weather_snapshots_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "my_trips": {
                  Row: {
                    "base_currency": string,"can_add_expenses": boolean,"end_date": string,"id": string,"primary_tz": string,"role": string,"start_date": string,"status": string,"subtitle": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "accept_invite":
{ Args: { "p_token": string }; Returns: string
                           },
"before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"can_add_expense":
{ Args: { "p_trip": string }; Returns: boolean
                           },
"can_create_trips":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"can_edit_trip":
{ Args: { "p_trip": string }; Returns: boolean
                           },
"can_see_document":
{ Args: { "p_trip": string,"p_visibility": string,"p_visible_to": (string)[] }; Returns: boolean
                           },
"create_invite":
{ Args: { "p_days"?: number,"p_max_uses"?: number,"p_role"?: string,"p_traveler"?: string,"p_trip": string }; Returns: string
                           },
"create_public_share":
{ Args: { "p_hide"?: Json,"p_trip": string }; Returns: string
                           },
"delete_trip":
{ Args: { "p_trip": string }; Returns: undefined
                           },
"disable_public_share":
{ Args: { "p_trip": string }; Returns: undefined
                           },
"import_trip":
{ Args: { "p_tables": Json,"p_trip": Json }; Returns: string
                           },
"invite_preview":
{ Args: { "p_token": string }; Returns: {
              "end_date": string,"invited_by": string,"role": string,"start_date": string,"title": string
            }[]
                           },
"invite_token_valid":
{ Args: { "p_token": string }; Returns: boolean
                           },
"is_my_traveler":
{ Args: { "p_traveler": string }; Returns: boolean
                           },
"is_trip_member":
{ Args: { "p_trip": string }; Returns: boolean
                           },
"is_trip_owner":
{ Args: { "p_trip": string }; Returns: boolean
                           },
"leave_trip":
{ Args: { "p_trip": string }; Returns: undefined
                           },
"link_traveler_account":
{ Args: { "p_traveler": string,"p_trip": string,"p_user": string }; Returns: undefined
                           },
"mark_changes_seen":
{ Args: { "p_trip": string }; Returns: undefined
                           },
"owns_expense":
{ Args: { "p_expense": string }; Returns: boolean
                           },
"public_trip":
{ Args: { "p_token": string }; Returns: Json
                           },
"pull_changes":
{ Args: { "p_since"?: number,"p_trip": string }; Returns: Json
                           },
"reschedule_trip":
{ Args: { "p_changes": Json,"p_end": string,"p_restore"?: boolean,"p_start": string,"p_trip": string,"p_version": number }; Returns: undefined
                           },
"storage_trip":
{ Args: { "p_name": string }; Returns: string
                           },
"synced_tables":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"token_digest":
{ Args: { "p_token": string }; Returns: string
                           },
"touch_trip":
{ Args: { "p_client": string,"p_trip": string }; Returns: undefined
                           },
"trip_member_stats":
{ Args: { "p_trip": string }; Returns: Json
                           },
"trip_news":
{ Args: { "p_limit"?: number,"p_trip": string }; Returns: Json
                           },
"trip_role":
{ Args: { "p_trip": string }; Returns: string
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
