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

const ensureConnected = (conn: snowflake.Connection): Promise<void> =>
  new Promise((resolve, reject) => {
    if (conn.isUp()) {
      resolve();
      return;
    }
    conn.connect((error) => {
      if (error) {
        connection = null; // build a fresh connection next time
        reject(error);
      } else {
        resolve();
      }
    });
  });

const executeQuery = async (sqlText: string, binds: TBind[]): Promise<void> => {
  const conn = getConnection();
  await ensureConnected(conn);
  await new Promise<void>((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (error) => (error ? reject(error) : resolve()),
    });
  });
};

/** Inserts rows into SURVEY_RESPONSES. Throws on failure; the caller decides whether that matters. */
export const insertSurveyResponseRows = async (rows: TSnowflakeResponseRow[]): Promise<void> => {
  if (rows.length === 0 || !isSnowflakeConfigured()) return;

  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
    const placeholders = batch.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(",\n");
    const binds = batch.flatMap((row) => COLUMNS.map((column): TBind => row[column]));
    await executeQuery(`INSERT INTO SURVEY_RESPONSES (${COLUMNS.join(", ")})\nVALUES ${placeholders}`, binds);
  }
};

/** Removes the rows of the given responses. */
export const deleteSurveyResponseRows = async (responseIds: string[]): Promise<void> => {
  if (responseIds.length === 0 || !isSnowflakeConfigured()) return;
  const placeholders = responseIds.map(() => "?").join(", ");
  await executeQuery(`DELETE FROM SURVEY_RESPONSES WHERE RESPONSE_ID IN (${placeholders})`, responseIds);
};

/** Removes every row of a survey (survey reset). */
export const deleteSurveyRows = async (surveyId: string): Promise<void> => {
  if (!isSnowflakeConfigured()) return;
  await executeQuery("DELETE FROM SURVEY_RESPONSES WHERE SURVEY_ID = ?", [surveyId]);
};
