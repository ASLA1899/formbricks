import "server-only";
import snowflake from "snowflake-sdk";
import { env } from "@/lib/env";
import type { TSnowflakeResponseRow } from "./response-rows";

const COLUMNS = [
  "RESPONSE_ID",
  "SURVEY_ID",
  "SURVEY_NAME",
  "RECORD_NUMBER",
  "CREATED_AT",
  "FINISHED",
  "QUESTION_ID",
  "QUESTION_TEXT",
  "QUESTION_TYPE",
  "ANSWER",
  "LANGUAGE",
  "SOURCE_URL",
] as const satisfies readonly (keyof TSnowflakeResponseRow)[];

/** Rows per INSERT. Snowflake caps a statement at 16,384 bind expressions; 12 columns x 1,000 stays under. */
const INSERT_BATCH_SIZE = 1000;

type TBind = string | number | boolean | null;

let connection: snowflake.Connection | null = null;
/** The connect attempt in flight, shared so concurrent callers never call connect() twice. */
let connecting: Promise<void> | null = null;
let logConfigured = false;
/** Connections whose session already has the server statement timeout. */
const sessionConfigured = new WeakSet<snowflake.Connection>();

/** True only when every credential the sync needs is set. Without them the sync is a silent no-op. */
export const isSnowflakeConfigured = (): boolean =>
  Boolean(
    env.SNOWFLAKE_ACCOUNT &&
    env.SNOWFLAKE_USERNAME &&
    env.SNOWFLAKE_PASSWORD &&
    env.SNOWFLAKE_DATABASE &&
    env.SNOWFLAKE_WAREHOUSE
  );

const getConnection = (): snowflake.Connection => {
  if (!logConfigured) {
    // The driver writes snowflake.log into the container's writable layer; keep it to errors.
    snowflake.configure({ logLevel: "ERROR" });
    logConfigured = true;
  }
  connection ??= snowflake.createConnection({
    account: env.SNOWFLAKE_ACCOUNT ?? "",
    username: env.SNOWFLAKE_USERNAME ?? "",
    password: env.SNOWFLAKE_PASSWORD ?? "",
    database: env.SNOWFLAKE_DATABASE ?? "",
    schema: env.SNOWFLAKE_SCHEMA,
    warehouse: env.SNOWFLAKE_WAREHOUSE ?? "",
    timeout: 10_000,
    clientSessionKeepAlive: true,
    clientSessionKeepAliveHeartbeatFrequency: 3600,
  });
  return connection;
};

/** The server cancels a statement at this limit, before the client deadline below. */
const SERVER_STATEMENT_TIMEOUT_SECONDS = 40;

const SESSION_SETUP_DEADLINE_MS = 10_000;

const resetConnection = (conn: snowflake.Connection) => {
  if (connection === conn) connection = null; // build a fresh connection next time
  conn.destroy(() => undefined);
};

/** Connects and sets the server statement timeout. `connecting` stays set until both are done. */
const ensureConnected = (conn: snowflake.Connection): Promise<void> => {
  if (conn.isUp() && sessionConfigured.has(conn)) return Promise.resolve();
  connecting ??= new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      connecting = null;
      if (error) {
        resetConnection(conn);
        reject(error);
      } else {
        resolve();
      }
    };
    conn.connect((error) => {
      if (error) return finish(error);
      const timer = setTimeout(
        () => finish(new Error("Snowflake session setup exceeded its deadline")),
        SESSION_SETUP_DEADLINE_MS
      );
      conn.execute({
        sqlText: `ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = ${SERVER_STATEMENT_TIMEOUT_SECONDS}`,
        complete: (sessionError) => {
          clearTimeout(timer);
          if (!sessionError) sessionConfigured.add(conn);
          finish(sessionError);
        },
      });
    });
  });
  return connecting;
};

/**
 * Every statement ends within this time, success or failure: the server cancels it at the shorter limit, and
 * the client gives up and drops the connection at the longer one. The driver may still deliver a retried
 * request after that, so no caller may rely on a statement being finished or not run. Writes are therefore
 * idempotent (see upsertSurveyResponseRows) and deletes are repeated by a delayed reconcile (see sync.ts).
 */
export const SNOWFLAKE_STATEMENT_DEADLINE_MS = 45_000;

const executeQuery = async (sqlText: string, binds: TBind[]): Promise<void> => {
  const conn = getConnection();
  await ensureConnected(conn);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Drop the session so nothing from it completes later; the next call builds a fresh connection.
      resetConnection(conn);
      reject(new Error("Snowflake statement exceeded its client deadline"));
    }, SNOWFLAKE_STATEMENT_DEADLINE_MS);
    conn.execute({
      sqlText,
      binds,
      complete: (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      },
    });
  });
};

/**
 * Writes the rows of one response with MERGE on (RESPONSE_ID, QUESTION_ID): a matching row is updated, a
 * missing one inserted. Running it twice, or late, gives the same table, so a retried or delayed statement
 * cannot create duplicates. Rows of questions no longer in the response are then deleted (also repeatable).
 * Snowflake queues concurrent DML on one table, so two MERGEs of the same keys do not both insert.
 * Throws on failure; the caller decides whether that matters.
 */
export const upsertSurveyResponseRows = async (
  responseId: string,
  rows: TSnowflakeResponseRow[]
): Promise<void> => {
  if (!isSnowflakeConfigured()) return;
  if (rows.length === 0) return deleteSurveyResponseRows([responseId]);

  const tuple = `(${COLUMNS.map(() => "?").join(", ")})`;
  const selectList = COLUMNS.map((column, i) => `column${i + 1} AS ${column}`).join(", ");
  const updates = COLUMNS.filter((c) => c !== "RESPONSE_ID" && c !== "QUESTION_ID")
    .map((column) => `t.${column} = s.${column}`)
    .join(", ");
  const insertValues = COLUMNS.map((c) => `s.${c}`).join(", ");

  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
    const binds = batch.flatMap((row) => COLUMNS.map((column): TBind => row[column]));
    await executeQuery(
      `MERGE INTO SURVEY_RESPONSES t USING (SELECT ${selectList} FROM VALUES ${batch.map(() => tuple).join(", ")}) s\n` +
        `ON t.RESPONSE_ID = s.RESPONSE_ID AND t.QUESTION_ID = s.QUESTION_ID\n` +
        `WHEN MATCHED THEN UPDATE SET ${updates}\n` +
        `WHEN NOT MATCHED THEN INSERT (${COLUMNS.join(", ")}) VALUES (${insertValues})`,
      binds
    );
  }

  // Drop rows of questions the response no longer has. Skipped when the list is too long to bind: a stale
  // row is harmless and the next sync of that response removes it.
  if (rows.length <= INSERT_BATCH_SIZE) {
    const questionIds = rows.map((row) => row.QUESTION_ID);
    await executeQuery(
      `DELETE FROM SURVEY_RESPONSES WHERE RESPONSE_ID = ? AND QUESTION_ID NOT IN (${questionIds.map(() => "?").join(", ")})`,
      [responseId, ...questionIds]
    );
  }
};

/** Removes the rows of the given responses. */
export const deleteSurveyResponseRows = async (responseIds: string[]): Promise<void> => {
  if (responseIds.length === 0 || !isSnowflakeConfigured()) return;
  for (let start = 0; start < responseIds.length; start += INSERT_BATCH_SIZE) {
    const batch = responseIds.slice(start, start + INSERT_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    await executeQuery(`DELETE FROM SURVEY_RESPONSES WHERE RESPONSE_ID IN (${placeholders})`, batch);
  }
};
