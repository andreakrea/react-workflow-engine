/**
 * Migration: create workflows table
 *
 * No foreign keys to any domain table.
 * `created_by` is a plain nullable string — the consumer app can enforce
 * referential integrity on their own schema if needed.
 *
 * Run with knex migrate:latest
 */
exports.up = async function (knex) {
  await knex.schema.createTable('workflows', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.text('description');
    table.json('nodes').notNullable().defaultTo('[]');
    table.json('edges').notNullable().defaultTo('[]');
    table.jsonb('hooks').defaultTo('[]');
    // Optional: who created this workflow. Plain string, no FK constraint.
    table.string('created_by');
    table.timestamps(true, true); // created_at, updated_at
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('workflows');
};
