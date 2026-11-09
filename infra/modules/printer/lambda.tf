resource "aws_cloudwatch_log_group" "worker" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "worker" {
  function_name = local.worker_name
  description   = "Renders print jobs from ${var.name_prefix}-jobs"
  role          = aws_iam_role.worker.arn

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

  depends_on = [
    aws_cloudwatch_log_group.worker,
    aws_iam_role_policy.worker,
  ]

  lifecycle {
    precondition {
      condition     = var.vpc_mode == "none"
      error_message = "The render worker does not support VPC create or lookup modes until Phase 2."
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
