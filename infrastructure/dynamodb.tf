# ---------------------------------------------------------------
# DynamoDB — URL storage
#
# Access patterns this schema supports:
#   1. Get URL by short code           → PK lookup (GetItem)
#   2. List all URLs for a user        → GSI query by userId
#   3. Delete a URL (owner only)       → PK delete with condition
# ---------------------------------------------------------------

resource "aws_dynamodb_table" "urls" {
  name         = "${local.prefix}-urls"
  billing_mode = var.dynamodb_billing_mode
  hash_key     = "shortCode"

  # Primary key — shortCode is the partition key
  attribute {
    name = "shortCode"
    type = "S"
  }

  # GSI partition key — userId for per-user queries
  attribute {
    name = "userId"
    type = "S"
  }

  # GSI sort key — createdAt for ordering
  attribute {
    name = "createdAt"
    type = "S"
  }

  # GSI: query all URLs belonging to a user, sorted by creation time
  global_secondary_index {
    name            = "userId-createdAt-index"
    hash_key        = "userId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # TTL — items with an `expiresAt` attribute (Unix timestamp) are auto-deleted
  # Useful for future feature: expiring links
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

# Item schema (for reference — not enforced by DynamoDB):
#
# shortCode  (S) — PK, e.g. "abc1234"
# longUrl    (S) — the destination URL
# userId     (S) — Cognito sub, e.g. "abc-123-def"
# createdAt  (S) — ISO 8601 timestamp, e.g. "2025-06-01T12:00:00Z"
# clickCount (N) — incremented on each redirect
# expiresAt  (N) — optional Unix timestamp for TTL
