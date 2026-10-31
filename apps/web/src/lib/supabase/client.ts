"use client";

import type { Database } from "@expeditionplan/db";
import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/** Klient w przeglądarce (logowanie). `createBrowserClient` zwraca jedną instancję. */
export const createClient = () => createBrowserClient<Database>(SUPABASE_URL, SUPABASE_KEY);
