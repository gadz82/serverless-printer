variable "name_prefix" {
  description = "Prefix for every resource created by the bootstrap and the main deployment."
  type        = string
  default     = "printer"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.name_prefix)) && length(var.name_prefix) <= 24
    error_message = "name_prefix must be 1-24 lowercase letters, digits or hyphens, and must start and end with a letter or digit."
  }
}

variable "region" {
  description = "AWS region for the state and artifacts buckets and the GitHub OIDC roles."
  type        = string
  default     = "eu-central-1"
}

variable "github_owner" {
  description = "GitHub organization or user that owns the repository allowed to assume the OIDC roles."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$", var.github_owner))
    error_message = "github_owner must be a valid GitHub organization or user name."
  }
}

variable "github_repo" {
  description = "GitHub repository name allowed to assume the OIDC roles."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.github_repo))
    error_message = "github_repo must contain only letters, digits, dots, underscores or hyphens."
  }
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider. Set to false to look up an existing provider in the account."
  type        = bool
  default     = true
}

variable "state_bucket_name" {
  description = "Optional override for the Terraform state bucket name. Defaults to <name_prefix>-tfstate."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.state_bucket_name == null || can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be a valid S3 bucket name (3-63 lowercase characters, digits, dots or hyphens)."
  }
}

variable "artifacts_bucket_name" {
  description = "Optional override for the release artifacts bucket name. Defaults to <name_prefix>-artifacts."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.artifacts_bucket_name == null || can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.artifacts_bucket_name))
    error_message = "artifacts_bucket_name must be a valid S3 bucket name (3-63 lowercase characters, digits, dots or hyphens)."
  }
}

variable "additional_worker_role_arns" {
  description = "Additional same-account and same-partition worker execution role ARNs the deploy role may pass to Lambda and read for trust validation, typically provided roles used with worker_role_mode = existing."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.additional_worker_role_arns :
      can(regex("^arn:[a-z0-9-]+:iam::[0-9]{12}:role/.+$", arn)) && !can(regex("[*?]", arn))
    ])
    error_message = "additional_worker_role_arns must contain explicit IAM role ARNs without wildcards."
  }
}

variable "tags" {
  description = "Tags applied to every resource that supports tagging."
  type        = map(string)
  default     = {}
}
