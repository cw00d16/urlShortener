const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

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

  const method = event.requestContext.http.method;

  // GET /api/urls — list all URLs for this user
  if (method === "GET") {
    const result = await db.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "userId-createdAt-index",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": userId },
      ScanIndexForward: false, // newest first
      Limit: 100,
    }));

    return response(200, result.Items || []);
  }

  // DELETE /api/urls/{code} — delete a URL (must be owner)
  if (method === "DELETE") {
    const shortCode = event.pathParameters?.code;
    if (!shortCode) return response(400, { error: "Missing code" });

    // Verify ownership before deleting
    const existing = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { shortCode },
      ProjectionExpression: "userId",
    }));

    if (!existing.Item) return response(404, { error: "Not found" });
    if (existing.Item.userId !== userId) return response(403, { error: "Forbidden" });

    await db.send(new DeleteCommand({
      TableName: TABLE,
      Key: { shortCode },
    }));

    return response(200, { ok: true });
  }

  return response(405, { error: "Method not allowed" });
};
