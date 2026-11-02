/**
 * Migration: workflow_timers — pending waits and retries, used when
 * knexStores(knex, { timers: true }) is used.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('workflow_timers', (table) => {
    table.bigIncrements('id').primary();
    table.string('subject_id').notNullable();
    table.string('workflow_id').notNullable();
    table.string('node_id').notNullable();
    table.string('kind', 16).notNullable();
    table.timestamp('due_at', { useTz: true }).notNullable();
    table.text('move');
    table.integer('attempt').notNullable().defaultTo(1);
    table.index(['due_at']);
    table.index(['subject_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('workflow_timers');
};
