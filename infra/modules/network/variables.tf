variable "name_prefix" {
  description = "Prefix for every network resource created by the module. Must match the root name_prefix."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.name_prefix)) && length(var.name_prefix) <= 24
    error_message = "name_prefix must be 1-24 lowercase letters, digits or hyphens, and must start and end with a letter or digit."
  }
}

variable "region" {
  description = "AWS region used in VPC endpoint service names. Must match the provider region."
  type        = string

  validation {
    condition     = length(trimspace(var.region)) > 0
    error_message = "region must not be empty."
  }
}

variable "vpc_mode" {
  description = "Network mode: none (default), create a VPC, or look up an existing one."
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
  description = "IPv4 CIDR for the created VPC. Ignored by none and lookup modes."
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
  description = "Number of availability zones used for private subnets. Ignored by none and lookup modes."
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

variable "tags" {
  description = "Tags applied to network resources. The root provider also applies default tags."
  type        = map(string)
  default     = {}
}
