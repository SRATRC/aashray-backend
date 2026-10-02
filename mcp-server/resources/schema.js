import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANNOTATIONS_PATH = join(__dirname, '..', 'annotations.json');

export const SCHEMA_RESOURCE_URI = 'schema://aashray';

export function loadAnnotations() {
  try {
    return JSON.parse(readFileSync(ANNOTATIONS_PATH, 'utf8'));
  } catch {
    return { tables: {}, glossary: {} };
  }
}

// Pass `tables` (array of table names) to filter both queries in SQL rather than
// fetching whole-database metadata and discarding most of it in JS. Pass
// `includeForeignKeys: false` to skip the FK query when the caller won't use it
// (the lightweight index never does).
export async function fetchSchemaRows(executeQuery, { tables, includeForeignKeys = true } = {}) {
  const inClause = tables && tables.length ? `AND TABLE_NAME IN (${tables.map(() => '?').join(', ')})` : '';
  const params = tables && tables.length ? tables : [];

  const colPromise = executeQuery(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
            COLUMN_DEFAULT, COLUMN_KEY
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() ${inClause}
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    params
  );

  const fkPromise = includeForeignKeys
    ? executeQuery(
        `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND REFERENCED_TABLE_NAME IS NOT NULL ${inClause}`,
        params
      )
    : Promise.resolve([]);

  const [colRows, fkRows] = await Promise.all([colPromise, fkPromise]);
  return { colRows, fkRows };
}

// One-line-per-table index: name, description, column names only. No types/FKs.
export function buildSchemaIndex(colRows, annotations) {
  const tables = {};
  for (const row of colRows) {
    const table = row.TABLE_NAME;
    if (!tables[table]) {
      tables[table] = {
        description: annotations.tables?.[table]?.description ?? null,
        columns: [],
      };
    }
    tables[table].columns.push(row.COLUMN_NAME);
  }
  return { tables };
}

// Full per-column detail (types, nullability, defaults, enums, FKs, annotations).
// Caller filters colRows/fkRows to the tables it wants before calling this.
export function buildSchemaDetail(colRows, fkRows, annotations) {
  const schema = {};

  function ensureTable(table) {
    if (!schema[table]) {
      schema[table] = {
        description: annotations.tables?.[table]?.description ?? null,
        columns: [],
        foreignKeys: [],
      };
      const statusFlow = annotations.tables?.[table]?.statusFlow;
      if (statusFlow) schema[table].statusFlow = statusFlow;
    }
    return schema[table];
  }

  const fkMap = {};
  for (const fk of fkRows) {
    fkMap[`${fk.TABLE_NAME}.${fk.COLUMN_NAME}`] = `${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`;
    ensureTable(fk.TABLE_NAME).foreignKeys.push(
      `${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`
    );
  }

  for (const row of colRows) {
    const table = row.TABLE_NAME;
    const entry = ensureTable(table);

    const col = {
      column: row.COLUMN_NAME,
      type: row.DATA_TYPE,
      nullable: row.IS_NULLABLE === 'YES',
    };

    if (row.COLUMN_DEFAULT !== null) col.default = row.COLUMN_DEFAULT;
    if (row.COLUMN_KEY === 'PRI') col.primaryKey = true;

    if (row.DATA_TYPE === 'enum' || row.DATA_TYPE === 'set') {
      const match = row.COLUMN_TYPE.match(/^(?:enum|set)\((.+)\)$/i);
      if (match) col.values = match[1].replace(/'/g, '').split(',');
    }

    const fkRef = fkMap[`${table}.${row.COLUMN_NAME}`];
    if (fkRef) col.references = fkRef;

    const colAnnotation = annotations.tables?.[table]?.columns?.[row.COLUMN_NAME];
    if (colAnnotation) col.description = colAnnotation;

    entry.columns.push(col);
  }

  return schema;
}

export async function buildSchemaResource(executeQuery) {
  const annotations = loadAnnotations();
  const { colRows, fkRows } = await fetchSchemaRows(executeQuery);

  const output = { tables: buildSchemaDetail(colRows, fkRows, annotations) };
  if (annotations.glossary && Object.keys(annotations.glossary).length) {
    output.glossary = annotations.glossary;
  }

  return JSON.stringify(output);
}
