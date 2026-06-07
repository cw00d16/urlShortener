# ---------------------------------------------------------------
# API Gateway v2 (HTTP API) — routes to Lambda functions
# HTTP API is cheaper and lower latency than REST API for this use case
# ---------------------------------------------------------------

resource "aws_apigatewayv2_api" "main" {
  name          = "${local.prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins  = ["https://${aws_cloudfront_distribution.frontend.domain_name}"]
    allow_methods  = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers  = ["Content-Type", "Authorization"]
    expose_headers = ["Location"]
    max_age        = 86400
  }
}

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
  }

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

# Cognito JWT authorizer — validates tokens on protected routes
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.prefix}-cognito-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.frontend.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

# --- Routes ---

# POST /api/shorten — create short URL (auth required)
resource "aws_apigatewayv2_integration" "shorten" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.shorten.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "shorten" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /api/shorten"
  target             = "integrations/${aws_apigatewayv2_integration.shorten.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# GET /api/urls — list user's URLs (auth required)
resource "aws_apigatewayv2_integration" "list_urls" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_urls.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "list_urls" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "GET /api/urls"
  target             = "integrations/${aws_apigatewayv2_integration.list_urls.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# DELETE /api/urls/{code} — delete a URL (auth required)
resource "aws_apigatewayv2_route" "delete_url" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "DELETE /api/urls/{code}"
  target             = "integrations/${aws_apigatewayv2_integration.list_urls.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# GET /r/{code} — public redirect (no auth)
resource "aws_apigatewayv2_integration" "redirect" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.redirect.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "redirect" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /r/{code}"
  target    = "integrations/${aws_apigatewayv2_integration.redirect.id}"
}

# CloudWatch log group for API Gateway access logs
resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.prefix}"
  retention_in_days = 14
}
