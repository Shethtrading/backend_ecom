# backend_ecom

## Migrations

This backend now uses SQL migration files in `migrations/` and a runner script in `scripts/run-migrations.js`.

Run migration before starting the API in production:

1. Set `DB_CONNECTION_STRING` in your environment.
2. Optional for managed SSL setups: set `DB_SSL=true`.
3. Run:

```bash
npm run migrate
```

For order-preservation in quotation flow, migration `001_add_order_details_line_order.sql` adds `order_details.line_order`, backfills existing rows, and creates an index used by ordered reads.