output "state_bucket" {
  description = "S3 bucket that holds the main deployment's Terraform state."
  value       = aws_s3_bucket.state.bucket
}

output "artifacts_bucket" {
  description = "S3 bucket for release artifacts, including <release>/render-worker.zip."
  value       = aws_s3_bucket.artifacts.bucket
}

output "deploy_role_arn" {
  description = "ARN of the GitHub Actions role allowed to deploy from main."
  value       = aws_iam_role.deploy.arn
}

output "plan_role_arn" {
  description = "ARN of the read-only GitHub Actions role allowed to plan pull requests."
  value       = aws_iam_role.plan.arn
}

output "oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider, created or looked up."
  value       = local.oidc_provider_arn
}
