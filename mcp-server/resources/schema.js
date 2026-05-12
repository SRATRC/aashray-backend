import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANNOTATIONS_PATH = join(__dirname, '..', 'annotations.json');

export const SCHEMA_RESOURCE_URI = 'schema://aashray';

function loadAnnotations() {
  try {
    return JSON.parse(readFileSync(ANNOTATIONS_PATH, 'utf8'));
  } catch {
    return { tables: {}, glossary: {} };
  }
}

export async function buildSchemaResource(executeQuery) {
  const annotations = loadAnnotations();

  const [colRows, fkRows] = await Promise.all([
    executeQuery(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
              COLUMN_DEFAULT, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME, ORDINAL_POSITION`
    ),
    executeQuery(
      `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    ),
  ]);

  const fkMap = {};
  for (const fk of fkRows) {
    fkMap[`${fk.TABLE_NAME}.${fk.COLUMN_NAME}`] = `${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`;
  }

  const schema = {};
  for (const row of colRows) {
    const table = row.TABLE_NAME;
    if (!schema[table]) {
      schema[table] = {
        description: annotations.tables?.[table]?.description ?? null,
        statusFlow: annotations.tables?.[table]?.statusFlow ?? undefined,
        columns: [],
        foreignKeys: [],
      };
      if (!schema[table].statusFlow) delete schema[table].statusFlow;
    }

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

    schema[table].columns.push(col);
  }

  for (const fk of fkRows) {
    schema[fk.TABLE_NAME]?.foreignKeys.push(
      `${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`
    );
  }

  const output = { tables: schema };
  if (annotations.glossary && Object.keys(annotations.glossary).length) {
    output.glossary = annotations.glossary;
  }

  return JSON.stringify(output, null, 2);
}
