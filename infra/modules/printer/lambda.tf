resource "aws_cloudwatch_log_group" "worker" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "worker" {
  function_name = local.worker_name
  description   = "Renders print jobs from ${var.name_prefix}-jobs"
  role          = local.worker_role_arn

  runtime       = "nodejs24.x"
  architectures = ["x86_64"]
  handler       = "handler.handler"
  memory_size   = 1536
  timeout       = local.worker_timeout_seconds

  s3_bucket = var.artifacts_bucket
  s3_key    = "${var.release}/render-worker.zip"
  publish   = true

  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = local.worker_environment
  }

  dynamic "vpc_config" {
    for_each = var.vpc_mode == "none" ? [] : [true]

    content {
      subnet_ids         = var.vpc_subnet_ids
      security_group_ids = var.vpc_security_group_ids
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.worker,
    aws_iam_role_policy.worker,
  ]

  lifecycle {
    precondition {
      condition     = var.vpc_mode == "none" || (length(var.vpc_subnet_ids) > 0 && length(var.vpc_security_group_ids) > 0)
      error_message = "vpc_subnet_ids and vpc_security_group_ids are required when the worker is attached to a VPC."
    }

    precondition {
      condition     = length(jsonencode(local.worker_environment)) < 4096
      error_message = "The worker environment exceeds the Lambda 4 KB aggregate limit."
    }
  }
}

resource "aws_lambda_alias" "live" {
  name             = "live"
  description      = "Live ${var.release} render worker"
  function_name    = aws_lambda_function.worker.function_name
  function_version = aws_lambda_function.worker.version
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_alias.live.arn

  batch_size              = var.batch_size
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.maximum_concurrency
  }

  depends_on = [aws_iam_role_policy.worker]
}
