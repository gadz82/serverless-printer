variable "name_prefix" {
  description = "Prefix for every resource created by the module. Must match the bootstrap name_prefix."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.name_prefix)) && length(var.name_prefix) <= 24
    error_message = "name_prefix must be 1-24 lowercase letters, digits or hyphens, and must start and end with a letter or digit."
  }
}

variable "release" {
  description = "Release label whose artifacts are deployed, for example v1.2.3 or sha-abc1234."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._-]*$", var.release)) && length(var.release) <= 128
    error_message = "release must be 1-128 letters, digits, dots, underscores or hyphens, and must start with a letter or digit."
  }
}

variable "artifacts_bucket" {
  description = "Bootstrap artifacts bucket that contains <release>/render-worker.zip."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.artifacts_bucket))
    error_message = "artifacts_bucket must be a valid S3 bucket name (3-63 lowercase characters, digits, dots or hyphens)."
  }
}

variable "deploy_role_arn" {
  description = "Bootstrap deploy role ARN that receives key administration in the prints KMS key policy."
  type        = string

  validation {
    condition     = can(regex("^arn:[a-z0-9-]+:iam::[0-9]{12}:role/.+$", var.deploy_role_arn))
    error_message = "deploy_role_arn must be an IAM role ARN."
  }
}

variable "vpc_mode" {
  description = "Worker network mode. Only \"none\" is supported in Phase 1."
  type        = string
  default     = "none"

  validation {
    condition     = var.vpc_mode == "none"
    error_message = "vpc_mode must be \"none\" in Phase 1. VPC create and lookup modes are not implemented yet."
  }
}

variable "allowed_sender_account_ids" {
  description = "AWS account IDs whose principals may send jobs directly to the jobs queue."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for account_id in var.allowed_sender_account_ids : can(regex("^[0-9]{12}$", account_id))])
    error_message = "allowed_sender_account_ids must contain only 12-digit AWS account IDs."
  }
}

variable "allowed_sender_principal_arns" {
  description = "IAM principal ARNs, such as cross-account roles, that may send jobs directly to the jobs queue."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for arn in var.allowed_sender_principal_arns : can(regex("^arn:[a-z0-9-]+:", arn))])
    error_message = "allowed_sender_principal_arns must contain ARNs."
  }
}

variable "organization_id" {
  description = "Optional AWS Organizations ID. When set, principals in the organization may send jobs to the jobs queue."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.organization_id == null || can(regex("^o-[a-z0-9]{8,32}$", var.organization_id))
    error_message = "organization_id must be null or an AWS Organizations ID such as o-a1b2c3d4e5."
  }
}

variable "callback_target_arns" {
  description = "ARNs the worker may send SQS results to. The smoke-results queue is always added by the module."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for arn in var.callback_target_arns : can(regex("^arn:[a-z0-9-]+:", arn))])
    error_message = "callback_target_arns must contain ARNs."
  }
}

variable "callback_allowlist" {
  description = "HTTPS host patterns allowed for http callbacks and ping URLs, for example https://*.example.com."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for entry in var.callback_allowlist : can(regex("^https://[^/[:space:]]+$", entry))])
    error_message = "callback_allowlist entries must be https://host[:port] patterns without a path."
  }
}

variable "handlebars_mode" {
  description = "Handlebars strictness: lenient, strict or assume-objects."
  type        = string
  default     = "lenient"

  validation {
    condition     = contains(["lenient", "strict", "assume-objects"], var.handlebars_mode)
    error_message = "handlebars_mode must be one of: lenient, strict, assume-objects."
  }
}

variable "pdfa_allowed_levels" {
  description = "PDF/A levels jobs may request. Empty in Phase 1 because PDF/A conversion is not implemented (ADR-003)."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for level in var.pdfa_allowed_levels : contains([
        "PDF/A-1b",
        "PDF/A-1a",
        "PDF/A-2b",
        "PDF/A-2u",
        "PDF/A-2a",
        "PDF/A-3b",
        "PDF/A-3u",
        "PDF/A-3a",
      ], level)
    ])
    error_message = "pdfa_allowed_levels must contain only PDF/A-1b, 1a, 2b, 2u, 2a, 3b, 3u or 3a."
  }
}

variable "event_source" {
  description = "EventBridge Source value used by the worker for eventBridge callbacks."
  type        = string
  default     = "printer"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.event_source)) && length(var.event_source) <= 256
    error_message = "event_source must be 1-256 letters, digits, dots, underscores or hyphens."
  }
}

variable "presign_ttl_seconds" {
  description = "Lifetime of presigned print download URLs, in seconds."
  type        = number
  default     = 900

  validation {
    condition = try(
      floor(var.presign_ttl_seconds) == var.presign_ttl_seconds &&
      var.presign_ttl_seconds >= 1 &&
      var.presign_ttl_seconds <= 604800,
      false,
    )
    error_message = "presign_ttl_seconds must be an integer between 1 and 604800."
  }
}

variable "max_receive_count" {
  description = "Receives before the jobs queue moves a message to the dead-letter queue."
  type        = number
  default     = 5

  validation {
    condition = try(
      floor(var.max_receive_count) == var.max_receive_count &&
      var.max_receive_count >= 1 &&
      var.max_receive_count <= 1000,
      false,
    )
    error_message = "max_receive_count must be an integer between 1 and 1000."
  }
}

variable "batch_size" {
  description = "Maximum SQS records per worker invocation."
  type        = number
  default     = 5

  validation {
    condition = try(
      floor(var.batch_size) == var.batch_size &&
      var.batch_size >= 1 &&
      var.batch_size <= 5,
      false,
    )
    error_message = "batch_size must be an integer between 1 and 5."
  }
}

variable "maximum_concurrency" {
  description = "Maximum concurrency of the jobs event source mapping."
  type        = number
  default     = 10

  validation {
    condition = try(
      floor(var.maximum_concurrency) == var.maximum_concurrency &&
      var.maximum_concurrency >= 2 &&
      var.maximum_concurrency <= 1000,
      false,
    )
    error_message = "maximum_concurrency must be an integer between 2 and 1000."
  }
}

variable "reserved_concurrency" {
  description = "Optional reserved concurrency for the worker function. Null leaves the function unreserved."
  type        = number
  default     = null
  nullable    = true

  validation {
    condition = var.reserved_concurrency == null || try(
      floor(var.reserved_concurrency) == var.reserved_concurrency &&
      var.reserved_concurrency >= 0 &&
      var.reserved_concurrency <= 10000,
      false,
    )
    error_message = "reserved_concurrency must be null or a non-negative integer."
  }
}

variable "enable_alarms" {
  description = "Create the DLQ-depth and worker-error CloudWatch alarms."
  type        = bool
  default     = false
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN that receives alarm notifications when enable_alarms is true."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.alarm_sns_topic_arn == null || can(regex("^arn:[a-z0-9-]+:sns:", var.alarm_sns_topic_arn))
    error_message = "alarm_sns_topic_arn must be null or an SNS topic ARN."
  }
}

variable "log_retention_days" {
  description = "Retention for the worker CloudWatch log group."
  type        = number
  default     = 30

  validation {
    condition = try(
      floor(var.log_retention_days) == var.log_retention_days &&
      contains([
        0, 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653
      ], var.log_retention_days),
      false,
    )
    error_message = "log_retention_days must be a CloudWatch Logs supported integer retention value."
  }
}

variable "tags" {
  description = "Tags applied to the project KMS key. The root provider also applies default tags to the other module resources."
  type        = map(string)
  default     = {}
}
