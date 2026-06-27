variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-2"
}

variable "project_name" {
  description = "Project name used in resource naming"
  type        = string
  default     = "url-shortener"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Your custom domain (e.g. snip.example.com). Leave empty to use CloudFront default domain."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repo in owner/repo format (e.g. acme/url-shortener). Used for OIDC trust."
  type        = string
}

variable "lambda_memory_mb" {
  description = "Memory allocated to each Lambda function"
  type        = number
  default     = 256
}

variable "lambda_timeout_seconds" {
  description = "Lambda function timeout"
  type        = number
  default     = 10
}

variable "dynamodb_billing_mode" {
  description = "DynamoDB billing mode: PAY_PER_REQUEST or PROVISIONED"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "qstash_token" {
  description = "QStash token for publishing messages (from Upstash console)"
  type        = string
  sensitive   = true
}

variable "qstash_signing_key" {
  description = "QStash current signing key for verifying incoming requests (from Upstash console)"
  type        = string
  sensitive   = true
}

variable "qstash_next_signing_key" {
  description = "QStash next signing key for verifying incoming requests during rotation (from Upstash console)"
  type        = string
  sensitive   = true
}

locals {
  prefix       = "urlshortener-${var.environment}"
  use_custom_domain = var.domain_name != ""
}
