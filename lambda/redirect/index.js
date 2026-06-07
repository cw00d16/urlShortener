const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const shortCode = event.pathParameters?.code;
  if (!shortCode) {
    return { statusCode: 400, body: "Missing short code" };
  }

  const result = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { shortCode },
    // Only fetch what we need — cheaper and faster
    ProjectionExpression: "longUrl",
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "text/html" },
      body: "<h1>404 — Short URL not found</h1>",
    };
  }

  // Increment click count asynchronously — don't await so redirect is instant
  db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { shortCode },
    UpdateExpression: "SET clickCount = if_not_exists(clickCount, :zero) + :one",
    ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
  })).catch(err => console.error("Click count update failed:", err));

  // 302 = temporary redirect (browser won't cache it — good for click tracking)
  // Use 301 only if you want browsers/CDN to cache the redirect permanently
  return {
    statusCode: 302,
    headers: {
      Location: result.Item.longUrl,
      "Cache-Control": "no-cache", // prevent browser caching so clicks always hit Lambda
    },
    body: "",
  };
};
