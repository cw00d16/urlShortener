const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;
const QSTASH_SIGNING_KEY = process.env.QSTASH_SIGNING_KEY; // current signing key
const QSTASH_NEXT_SIGNING_KEY = process.env.QSTASH_NEXT_SIGNING_KEY; // next signing key

// ---------------------------------------------------------------
// QStash request verification
//
// QStash signs every request it delivers with a JWT using your
// signing key. We verify this before processing to ensure only
// QStash (not random internet traffic) can hit this endpoint.
// ---------------------------------------------------------------
function verifyQStashSignature(event) {
  const signature = event.headers?.["upstash-signature"];
  if (!signature) return false;

  // JWT structure: header.payload.signature
  const parts = signature.split(".");
  if (parts.length !== 3) return false;

  const signingInput = `${parts[0]}.${parts[1]}`;

  // Try current signing key first, then next (for key rotation)
  for (const key of [QSTASH_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY]) {
    if (!key) continue;
    try {
      const hmac = crypto.createHmac("sha256", key);
      hmac.update(signingInput);
      const expected = hmac.digest("base64url");
      if (expected === parts[2]) return true;
    } catch {
      continue;
    }
  }
  return false;
}

exports.handler = async (event) => {
  // Verify the request actually came from QStash
  if (!verifyQStashSignature(event)) {
    console.error("Invalid QStash signature — rejecting request");
    return { statusCode: 401, body: "Unauthorized" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { shortCode, timestamp, userAgent, referer } = body;
  if (!shortCode) {
    return { statusCode: 400, body: "Missing shortCode" };
  }

  // Increment click count and record last clicked timestamp
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { shortCode },
    UpdateExpression: `
      SET clickCount = if_not_exists(clickCount, :zero) + :one,
          lastClickedAt = :ts
    `,
    ExpressionAttributeValues: {
      ":zero": 0,
      ":one":  1,
      ":ts":   timestamp || new Date().toISOString(),
    },
  }));

  console.log(JSON.stringify({ shortCode, timestamp, userAgent, referer }));

  // QStash expects a 2xx to confirm delivery — otherwise it retries
  return { statusCode: 200, body: "ok" };
};
