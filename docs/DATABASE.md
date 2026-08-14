# Database Package

`database/bootstrap/00_remove_retired_features.sql` removes retired AI/e-sign schema objects that may exist in a schema-only clone.

`database/bootstrap/01_storage_buckets.sql` contains generic storage setup for proposal/agreement signed PDFs, HR documents, company documents, and ticket attachments required by the active application.

`database/seeds/01_roles_and_permissions.sql` seeds the active baseline roles and permission matrix.

`database/seeds/02_bootstrap_admin_profile.sql` is used by `scripts/bootstrap-admin-profile.sh` after the first Supabase Auth user is created.

`database/migrations/` is intentionally reserved for **future generic migrations only**. The old project's historical migration and root SQL folders were patch history, not a reliable blank-database bootstrap; many files were tied to specific clients, locations, agreement numbers or employee records. They are intentionally not shipped in the clean master.

For a new database, use `scripts/clone-new-client-schema.sh` to clone the `public` schema only from a known-good reference database. The script preserves schema grants, blocks accidental restore into a non-empty target by default, and does not copy business rows or Auth users.
