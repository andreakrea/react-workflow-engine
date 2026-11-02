/**
 * Migration: workflow_history — one row per move, written by the engine when
 * knexStores(knex, { history: true }) is used.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('workflow_history', (table) => {
    table.bigIncrements('id').primary();
    table.string('subject_id').notNullable();
    table.string('workflow_id').notNullable();
    table.string('from_node');
    table.string('to_node').notNullable();
    table.string('branch');
    table.string('actor');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['subject_id', 'id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('workflow_history');
};
