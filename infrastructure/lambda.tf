# ---------------------------------------------------------------
# Lambda functions
# Terraform zips the source from the lambda/ directory at plan time
# ---------------------------------------------------------------

# --- IAM role shared by all Lambda functions ---
resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# DynamoDB access for all Lambda functions
resource "aws_iam_role_policy" "lambda_dynamo" {
  name = "${local.prefix}-lambda-dynamo"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = [
        aws_dynamodb_table.urls.arn,
        "${aws_dynamodb_table.urls.arn}/index/*"
      ]
    }]
  })
}

# CloudWatch log groups — one per function
resource "aws_cloudwatch_log_group" "shorten" {
  name              = "/aws/lambda/${local.prefix}-shorten"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "redirect" {
  name              = "/aws/lambda/${local.prefix}-redirect"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "list_urls" {
  name              = "/aws/lambda/${local.prefix}-list-urls"
  retention_in_days = 14
}

# --- Zip the Lambda source code ---
data "archive_file" "shorten" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/shorten"
  output_path = "${path.module}/.lambda_builds/shorten.zip"
}

data "archive_file" "redirect" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/redirect"
  output_path = "${path.module}/.lambda_builds/redirect.zip"
}

data "archive_file" "list_urls" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/urls"
  output_path = "${path.module}/.lambda_builds/urls.zip"
}

# --- Common environment variables for all functions ---
locals {
  lambda_environment = {
    TABLE_NAME  = aws_dynamodb_table.urls.name
    AWS_REGION_ = var.aws_region # avoid overriding reserved AWS_REGION
  }
}

# --- shorten Lambda ---
resource "aws_lambda_function" "shorten" {
  function_name    = "${local.prefix}-shorten"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.shorten.output_path
  source_code_hash = data.archive_file.shorten.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_cloudwatch_log_group.shorten]
}

resource "aws_lambda_permission" "shorten" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.shorten.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# --- redirect Lambda ---
resource "aws_lambda_function" "redirect" {
  function_name    = "${local.prefix}-redirect"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.redirect.output_path
  source_code_hash = data.archive_file.redirect.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_cloudwatch_log_group.redirect]
}

resource "aws_lambda_permission" "redirect" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.redirect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# --- list_urls Lambda (also handles DELETE) ---
resource "aws_lambda_function" "list_urls" {
  function_name    = "${local.prefix}-list-urls"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.list_urls.output_path
  source_code_hash = data.archive_file.list_urls.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.lambda_environment
  }

  depends_on = [aws_cloudwatch_log_group.list_urls]
}

resource "aws_lambda_permission" "list_urls" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_urls.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
