variable "name_prefix" {
  description = "Prefix for every resource created by this deployment. Must match the bootstrap name_prefix."
  type        = string
  default     = "printer"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.name_prefix)) && length(var.name_prefix) <= 24
    error_message = "name_prefix must be 1-24 lowercase letters, digits or hyphens, and must start and end with a letter or digit."
  }
}

variable "region" {
  description = "AWS region for the deployment. Must match the region used by the bootstrap state and artifacts buckets."
  type        = string
  default     = "eu-central-1"

  validation {
    condition     = length(trimspace(var.region)) > 0
    error_message = "region must not be empty."
  }
}

variable "release" {
  description = "Release label whose artifacts are deployed, for example v1.2.3 or sha-abc1234. The release workflow supplies it."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._-]*$", var.release)) && length(var.release) <= 128
    error_message = "release must be 1-128 letters, digits, dots, underscores or hyphens, and must start with a letter or digit."
  }
}

variable "artifacts_bucket" {
  description = "Bootstrap artifacts bucket that contains <release>/render-worker.zip. Defaults to <name_prefix>-artifacts."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.artifacts_bucket == null || can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.artifacts_bucket))
    error_message = "artifacts_bucket must be a valid S3 bucket name (3-63 lowercase characters, digits, dots or hyphens)."
  }
}

variable "deploy_role_arn" {
  description = "Bootstrap deploy role ARN allowed to administer the project KMS key. Defaults to the bootstrap naming convention."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.deploy_role_arn == null || can(regex("^arn:[a-z0-9-]+:iam::[0-9]{12}:role/.+$", var.deploy_role_arn))
    error_message = "deploy_role_arn must be an IAM role ARN."
  }
}

variable "caller_role_mode" {
  description = "Caller role mode: create the integrator role (default) or use caller_role_arn."
  type        = string
  default     = "create"

  validation {
    condition     = contains(["create", "existing"], var.caller_role_mode)
    error_message = "caller_role_mode must be one of: create, existing."
  }
}

variable "caller_role_arn" {
  description = "Provided caller role ARN used when caller_role_mode is existing. The role is added to the jobs queue senders but not modified."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.caller_role_arn == null || can(regex("^arn:[a-z0-9-]+:iam::[0-9]{12}:role/.+$", var.caller_role_arn))
    error_message = "caller_role_arn must be null or an IAM role ARN."
  }
}

variable "caller_trusted_principal_arns" {
  description = "Principals allowed to assume the generated caller role. Empty trusts the deployer account root. Existing mode ignores this list."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.caller_trusted_principal_arns :
      can(regex("^arn:[a-z0-9-]+:iam::[0-9]{12}:(root|role/.+|user/.+)$", arn))
    ])
    error_message = "caller_trusted_principal_arns must contain account root, IAM role or IAM user ARNs."
  }
}

variable "worker_role_mode" {
  description = "Worker execution role mode: create the Lambda role (default) or use worker_role_arn."
  type        = string
  default     = "create"

  validation {
    condition     = contains(["create", "existing"], var.worker_role_mode)
    error_message = "worker_role_mode must be one of: create, existing."
  }
}

variable "worker_role_arn" {
  description = "Provided same-account worker execution role ARN trusting lambda.amazonaws.com, used when worker_role_mode is existing. Terraform reads the role to validate its trust policy but does not modify it."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.worker_role_arn == null || can(regex("^arn:[a-z0-9-]+:iam::[0-9]{12}:role/.+$", var.worker_role_arn))
    error_message = "worker_role_arn must be null or an IAM role ARN."
  }
}

variable "vpc_mode" {
  description = "Worker network mode: none (default), create a VPC, or look up an existing one."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "create", "lookup"], var.vpc_mode)
    error_message = "vpc_mode must be one of: none, create, lookup."
  }

  validation {
    condition = var.vpc_mode != "lookup" || (
      (var.vpc_id != null && length(var.vpc_tags) == 0) ||
      (var.vpc_id == null && length(var.vpc_tags) > 0)
    )
    error_message = "vpc_mode = lookup requires exactly one of vpc_id or vpc_tags."
  }

  validation {
    condition = var.vpc_mode != "lookup" || (
      (length(var.subnet_ids) > 0 && length(var.subnet_tags) == 0) ||
      (length(var.subnet_ids) == 0 && length(var.subnet_tags) > 0)
    )
    error_message = "vpc_mode = lookup requires exactly one of subnet_ids or subnet_tags."
  }

  validation {
    condition = var.vpc_mode != "none" || (
      var.vpc_id == null &&
      length(var.vpc_tags) == 0 &&
      length(var.subnet_ids) == 0 &&
      length(var.subnet_tags) == 0 &&
      length(var.worker_security_group_ids) == 0
    )
    error_message = "vpc_mode = none does not accept VPC, subnet or security-group inputs."
  }

  validation {
    condition = var.vpc_mode != "create" || (
      var.vpc_id == null &&
      length(var.vpc_tags) == 0 &&
      length(var.subnet_ids) == 0 &&
      length(var.subnet_tags) == 0 &&
      length(var.worker_security_group_ids) == 0
    )
    error_message = "vpc_mode = create owns the VPC and does not accept lookup or security-group inputs."
  }

  validation {
    condition     = var.vpc_mode != "lookup" || !var.enable_nat_gateway
    error_message = "enable_nat_gateway is only valid with vpc_mode = create."
  }
}

variable "vpc_cidr" {
  description = "IPv4 CIDR for a created VPC. Ignored by none and lookup modes."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition = try(
      can(cidrnetmask(var.vpc_cidr)) &&
      tonumber(split("/", var.vpc_cidr)[1]) >= 16 &&
      tonumber(split("/", var.vpc_cidr)[1]) <= 24 &&
      cidrhost(var.vpc_cidr, 0) == split("/", var.vpc_cidr)[0],
      false,
    )
    error_message = "vpc_cidr must be a canonical IPv4 network CIDR with a /16 to /24 prefix, for example 10.0.0.0/16."
  }
}

variable "az_count" {
  description = "Availability zones for private subnets in create mode. Ignored by none and lookup modes."
  type        = number
  default     = 2

  validation {
    condition = try(
      floor(var.az_count) == var.az_count &&
      var.az_count >= 1 &&
      var.az_count <= 6 &&
      var.az_count * 2 <= pow(2, max(24 - tonumber(split("/", var.vpc_cidr)[1]), 4)),
      false,
    )
    error_message = "az_count must be an integer between 1 and 6 that fits the vpc_cidr subnet space."
  }
}

variable "availability_zones" {
  description = "Optional availability-zone names for create mode. Empty uses the enabled zones for the region."
  type        = list(string)
  default     = []

  validation {
    condition     = var.vpc_mode != "create" || length(var.availability_zones) == 0 || length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "availability_zones must be empty or contain distinct names when vpc_mode = create. az_count is checked against the available or supplied list before subnet creation."
  }
}

variable "enable_nat_gateway" {
  description = "Create public subnets and one NAT gateway so private worker traffic can reach the internet. Off by default."
  type        = bool
  default     = false
}

variable "enable_s3_endpoint" {
  description = "Create the S3 gateway VPC endpoint in create mode."
  type        = bool
  default     = true
}

variable "enable_sqs_endpoint" {
  description = "Create the SQS interface VPC endpoint in create mode."
  type        = bool
  default     = true
}

variable "enable_lambda_endpoint" {
  description = "Create the Lambda interface VPC endpoint in create mode."
  type        = bool
  default     = true
}

variable "enable_events_endpoint" {
  description = "Create the EventBridge (events) interface VPC endpoint in create mode."
  type        = bool
  default     = true
}

variable "vpc_id" {
  description = "Existing VPC ID for lookup mode. Mutually exclusive with vpc_tags."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.vpc_id == null || can(regex("^vpc-[0-9a-f]+$", var.vpc_id))
    error_message = "vpc_id must be null or a VPC ID such as vpc-0123456789abcdef0."
  }
}

variable "vpc_tags" {
  description = "Tags that identify the existing VPC in lookup mode. Mutually exclusive with vpc_id."
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  description = "Existing private subnet IDs for lookup mode. Mutually exclusive with subnet_tags."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for subnet_id in var.subnet_ids : can(regex("^subnet-[0-9a-f]+$", subnet_id))])
    error_message = "subnet_ids must contain subnet IDs such as subnet-0123456789abcdef0."
  }
}

variable "subnet_tags" {
  description = "Tags that identify the existing worker subnets in lookup mode. Mutually exclusive with subnet_ids."
  type        = map(string)
  default     = {}
}

variable "worker_security_group_ids" {
  description = "Optional existing security groups for the worker in lookup mode. Empty creates a managed worker security group."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.worker_security_group_ids) <= 5
    error_message = "worker_security_group_ids must contain at most five security groups."
  }

  validation {
    condition     = alltrue([for security_group_id in var.worker_security_group_ids : can(regex("^sg-[0-9a-f]+$", security_group_id))])
    error_message = "worker_security_group_ids must contain security group IDs such as sg-0123456789abcdef0."
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
  description = "Explicit SQS queue, Lambda function or EventBridge event bus ARNs the worker may publish results to. The smoke-results queue is always added by the module. Wildcards and the jobs queue ARN are rejected."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.callback_target_arns :
      can(regex("^arn:[a-z0-9-]+:", arn)) && !can(regex("[*?]", arn))
    ])
    error_message = "callback_target_arns must contain explicit ARNs without wildcards."
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
  description = "PDF/A levels jobs may request. Defaults to every supported level."
  type        = list(string)
  default     = ["PDF/A-1b", "PDF/A-1a", "PDF/A-2b", "PDF/A-2u", "PDF/A-2a", "PDF/A-3b", "PDF/A-3u", "PDF/A-3a"]

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

variable "worker_memory_size" {
  description = "Memory (MB) allocated to the render worker Lambda. Tune it with AWS Lambda Power Tuning."
  type        = number
  default     = 1536

  validation {
    condition = try(
      floor(var.worker_memory_size) == var.worker_memory_size &&
      var.worker_memory_size >= 128 &&
      var.worker_memory_size <= 10240,
      false,
    )
    error_message = "worker_memory_size must be an integer between 128 and 10240."
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
  description = "Tags applied to resources that support tagging. Project is forced to name_prefix."
  type        = map(string)
  default     = {}
}

variable "job_rule" {
  description = "Optional EventBridge rule that forwards matching events to the jobs queue."
  type = object({
    bus_name      = string
    event_pattern = string
  })
  default = null

  validation {
    condition = var.job_rule == null ? true : (
      can(regex("^[A-Za-z0-9._-]{1,256}$", var.job_rule.bus_name)) &&
      length(trimspace(var.job_rule.event_pattern)) > 0 &&
      length(var.job_rule.event_pattern) <= 2048 &&
      can(keys(jsondecode(var.job_rule.event_pattern)))
    )
    error_message = "job_rule.bus_name must be 1-256 letters, digits, dots, underscores or hyphens and job_rule.event_pattern must be a JSON object of at most 2048 characters."
  }
}
