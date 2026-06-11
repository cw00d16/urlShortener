const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
 
const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;
 
// ---------------------------------------------------------------
// ID generation: timestamp (41 bits) + crypto random (22 bits)
//
// Layout packed into a 63-bit integer, encoded as Base62:
//   41 bits — ms since custom epoch (~69 years of range)
//   22 bits — cryptographically random (1-in-4M chance of same value per ms)
//
// This approach is designed for serverless (Lambda) where you can't
// assign stable worker IDs across ephemeral execution environments.
// The timestamp prefix keeps IDs monotonically increasing, which means
// DynamoDB write distribution stays even over time.
//
// The ConditionExpression below is a last-resort safety net — in
// practice it will never fire at any realistic traffic level.
// ---------------------------------------------------------------
 
const EPOCH = 1700000000000n; // Nov 14 2023 custom epoch
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
 
function generateShortCode() {
  const now = BigInt(Date.now()) - EPOCH;                           // 41 bits
  const rand = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]) & 0x3FFFFFn; // 22 bits
  const id = (now << 22n) | rand;
 
  // Base62 encode
  let num = id;
  let result = "";
  while (num > 0n) {
    result = BASE62[Number(num % 62n)] + result;
    num = num / 62n;
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
 
  const shortCode = generateShortCode();
  const createdAt = new Date().toISOString();
 
  await db.send(new PutCommand({
    TableName: TABLE,
    Item: { shortCode, longUrl, userId, createdAt, clickCount: 0 },
    ConditionExpression: "attribute_not_exists(shortCode)",
  }));
 
  const baseUrl = process.env.BASE_URL || `https://${event.requestContext.domainName}`;
 
  return response(200, {
    shortCode,
    shortUrl: `${baseUrl}/r/${shortCode}`,
  });
};