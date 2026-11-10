output "jobs_queue_url" {
  description = "URL of the jobs queue that accepts print jobs."
  value       = aws_sqs_queue.jobs.id
}

output "jobs_queue_arn" {
  description = "ARN of the jobs queue."
  value       = aws_sqs_queue.jobs.arn
}

output "jobs_dlq_url" {
  description = "URL of the dead-letter queue for jobs that exceed max_receive_count."
  value       = aws_sqs_queue.jobs_dlq.id
}

output "jobs_dlq_arn" {
  description = "ARN of the dead-letter queue."
  value       = aws_sqs_queue.jobs_dlq.arn
}

output "prints_bucket" {
  description = "Name of the S3 bucket that holds transient print objects."
  value       = aws_s3_bucket.prints.bucket
}

output "smoke_queue_url" {
  description = "URL of the queue that receives release-smoke results."
  value       = aws_sqs_queue.smoke_results.id
}

output "smoke_queue_arn" {
  description = "ARN of the release-smoke results queue."
  value       = aws_sqs_queue.smoke_results.arn
}

output "function_name" {
  description = "Name of the render worker Lambda function."
  value       = aws_lambda_function.worker.function_name
}

output "function_alias_arn" {
  description = "ARN of the live alias that receives the jobs event source mapping."
  value       = aws_lambda_alias.live.arn
}

output "caller_role_arn" {
  description = "ARN of the caller role allowed to publish jobs, created or provided."
  value       = local.caller_role_arn
}

output "caller_role_created" {
  description = "True when Terraform created the caller role; false when a provided role is used."
  value       = local.caller_role_created
}

output "worker_role_arn" {
  description = "ARN of the render worker execution role, created or provided."
  value       = local.worker_role_arn
}

output "worker_role_created" {
  description = "True when Terraform created the worker role; false when a provided role is used."
  value       = local.worker_role_created
}

output "kms_key_arn" {
  description = "ARN of the project KMS key that encrypts print objects."
  value       = aws_kms_key.prints.arn
}

output "vpc_subnet_ids" {
  description = "Private subnets attached to the worker when vpc_mode is create or lookup, otherwise empty."
  value       = var.vpc_subnet_ids
}

output "worker_security_group_ids" {
  description = "Security groups attached to the worker when vpc_mode is create or lookup, otherwise empty."
  value       = var.vpc_security_group_ids
}
