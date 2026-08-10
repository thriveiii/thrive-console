/* ---------- Baked connection to the thrive-console Supabase project ----------

   Both values here are PUBLIC by design and safe to ship in the client:
     - the anon (publishable) key is delivered to every browser that loads the app regardless, and
     - the project URL is a constant.
   What protects the data is Row Level Security plus the operator sign-in (P2), never the secrecy of
   these two values. No service-role key, and no other true secret, is ever placed here or anywhere in
   the client.

   Baking the connection in means a fresh or cleared device already has it, so the first open is a
   sign-in (the operator step after the passcode), never a setup, and never an empty board. A value
   stored in Settings still overrides the baked default (a deliberate change, or a legacy device), but
   the baked default is always present, so there is no state where the console has no connection.

   Scope, the first rule: this is the thrive-console project only. Nothing here references any other
   project, its URL, its keys, or its tables. */
;(function (global) {
  "use strict";
  var C = global.THRIVE_CONFIG = global.THRIVE_CONFIG || {};
  // The thrive-console project's PUBLIC values. Project URL, then the anon (publishable) key.
  // The key is the anon/publishable key (its JWT payload is role:anon), never the service_role key.
  C.supaUrl  = "https://ssqhwdzgegzqcjfcclmr.supabase.co";
  C.supaAnon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzcWh3ZHpnZWd6cWNqZmNjbG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzODAyNTcsImV4cCI6MjA4Njk1NjI1N30.MASuul-IGtVxKSwlo57DgFdy5_kwMuumxnoTupAMQxs";
})(typeof window !== "undefined" ? window : this);
