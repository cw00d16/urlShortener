const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
 
const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;
 
// ---------------------------------------------------------------
// ID generation: 7 random Base62 characters (62^7 ≈ 3.5 trillion
// combinations), matching the length of mainstream URL shorteners
// (bit.ly, TinyURL) instead of a longer sortable ID.
//
// No coordination needed across Lambda invocations — collisions
// are astronomically unlikely at any realistic traffic level, and
// the rare one is caught by the ConditionExpression on the write
// and retried with a fresh code.
// ---------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 7;
const MAX_ATTEMPTS = 5;

function generateShortCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let result = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += BASE62[bytes[i] % 62];
  }
  return result;
}
 
function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
 
exports.handler = async (event) => {
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) return response(401, { error: "Unauthorized" });
 
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return response(400, { error: "Invalid JSON" }); }
 
  const { longUrl } = body;
 
  if (!longUrl) return response(400, { error: "longUrl is required" });
  try { new URL(longUrl); }
  catch { return response(400, { error: "Invalid URL — include https://" }); }
 
  const createdAt = new Date().toISOString();
  let shortCode;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    shortCode = generateShortCode();
    try {
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: { shortCode, longUrl, userId, createdAt, clickCount: 0 },
        ConditionExpression: "attribute_not_exists(shortCode)",
      }));
      break; // write succeeded — code is unique
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException" && attempt < MAX_ATTEMPTS - 1) {
        continue; // collision — generate a new code and retry
      }
      throw err;
    }
  }

  const baseUrl = process.env.BASE_URL || `https://${event.requestContext.domainName}`;

  return response(200, {
    shortCode,
    shortUrl: `${baseUrl}/${shortCode}`,
  });
};