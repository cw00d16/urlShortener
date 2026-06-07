const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

// nanoid-compatible base62 alphabet, no external deps needed in Lambda
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function generateCode(length = 7) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => ALPHABET[b % ALPHABET.length]).join("");
}

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // Cognito userId comes from the JWT authorizer context
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) return response(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return response(400, { error: "Invalid JSON" }); }

  const { longUrl, customSlug } = body;

  if (!longUrl) return response(400, { error: "longUrl is required" });
  try { new URL(longUrl); }
  catch { return response(400, { error: "Invalid URL — include https://" }); }

  if (customSlug && !/^[a-zA-Z0-9_-]+$/.test(customSlug)) {
    return response(400, { error: "Slug may only contain letters, numbers, hyphens, underscores" });
  }

  const shortCode = customSlug?.trim() || generateCode();

  // Check for slug collision
  if (customSlug) {
    const existing = await db.send(new GetCommand({ TableName: TABLE, Key: { shortCode } }));
    if (existing.Item) return response(409, { error: "That slug is already taken" });
  }

  const createdAt = new Date().toISOString();

  await db.send(new PutCommand({
    TableName: TABLE,
    Item: {
      shortCode,
      longUrl,
      userId,
      createdAt,
      clickCount: 0,
    },
    // Extra safety: don't overwrite if race condition on random code
    ConditionExpression: "attribute_not_exists(shortCode)",
  }));

  const baseUrl = process.env.BASE_URL || `https://${event.requestContext.domainName}`;

  return response(200, {
    shortCode,
    shortUrl: `${baseUrl}/r/${shortCode}`,
  });
};