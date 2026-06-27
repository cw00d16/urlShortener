const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;
const QSTASH_URL = process.env.QSTASH_URL;       // e.g. https://qstash.upstash.io/v2/publish/...
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const ANALYTICS_URL = process.env.ANALYTICS_URL; // full URL of your /internal/analytics endpoint

exports.handler = async (event) => {
  const shortCode = event.pathParameters?.code;
  if (!shortCode) {
    return { statusCode: 400, body: "Missing short code" };
  }

  const result = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { shortCode },
    ProjectionExpression: "longUrl",
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "text/html" },
      body: "<h1>404 — Short URL not found</h1>",
    };
  }

  // Fire-and-forget: publish a click event to QStash.
  // QStash will call our analytics Lambda asynchronously.
  // We do NOT await this — the 301 goes back immediately.
  fetch(`${QSTASH_URL}${ANALYTICS_URL}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
      // Retry up to 3 times if the analytics Lambda fails
      "Upstash-Retries": "3",
    },
    body: JSON.stringify({
      shortCode,
      timestamp: new Date().toISOString(),
      userAgent: event.headers?.["user-agent"] || "",
      referer: event.headers?.referer || "",
    }),
  }).catch(err => console.error("QStash publish failed:", err));

  // 302 — temporary redirect
  // Clicks are tracked async via QStash.
  return {
    statusCode: 302,
    headers: {
      Location: result.Item.longUrl,
      "Cache-Control": "no-cache",
    },
    body: "",
  };
};
