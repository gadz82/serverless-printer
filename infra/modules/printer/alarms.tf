resource "aws_cloudwatch_metric_alarm" "jobs_dlq_depth" {
  count = var.enable_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-jobs-dlq-depth"
  alarm_description   = "Print jobs have reached the dead-letter queue."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.jobs_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  lifecycle {
    precondition {
      condition     = var.alarm_sns_topic_arn != null && var.alarm_sns_topic_arn != ""
      error_message = "alarm_sns_topic_arn is required when enable_alarms is true."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  count = var.enable_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-render-worker-errors"
  alarm_description   = "The render worker reported one or more invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.worker.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  lifecycle {
    precondition {
      condition     = var.alarm_sns_topic_arn != null && var.alarm_sns_topic_arn != ""
      error_message = "alarm_sns_topic_arn is required when enable_alarms is true."
    }
  }
}
