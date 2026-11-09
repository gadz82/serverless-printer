data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition
  worker_name = "${var.name_prefix}-render-worker"
  log_group   = "/aws/lambda/${local.worker_name}"
  worker_role = "arn:${local.partition}:iam::${local.account_id}:role/${local.worker_name}"

  # SQS keeps failed jobs for four days, the same retention on both queues.
  message_retention_seconds = 345600

  # The queue visibility timeout must leave room for a full batch: the worker's
  # 60-second timeout, with a 6x safety factor required by the deployment.
  worker_timeout_seconds     = 60
  visibility_timeout_seconds = local.worker_timeout_seconds * 6

  organization_id_set = var.organization_id != null && var.organization_id != ""

  # The deploy role is deliberately absent: the release smoke sends through the
  # deploy role's bootstrap IAM identity policy, not a queue-policy exception.
  jobs_sender_principals = concat(
    [for account_id in var.allowed_sender_account_ids : "arn:${local.partition}:iam::${account_id}:root"],
    var.allowed_sender_principal_arns,
  )
  has_configured_senders = length(local.jobs_sender_principals) > 0
  has_jobs_queue_policy  = local.has_configured_senders || local.organization_id_set

  worker_environment = {
    PRINTS_BUCKET       = aws_s3_bucket.prints.bucket
    HANDLEBARS_MODE     = var.handlebars_mode
    PDFA_ALLOWED_LEVELS = join(",", var.pdfa_allowed_levels)
    CALLBACK_ALLOWLIST  = jsonencode(var.callback_allowlist)
    EVENT_SOURCE        = var.event_source
    PRESIGN_TTL_SECONDS = tostring(var.presign_ttl_seconds)
    MAX_RECEIVE_COUNT   = tostring(var.max_receive_count)
  }
}

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${var.name_prefix}-jobs-dlq"
  max_message_size          = 1048576
  message_retention_seconds = local.message_retention_seconds
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.name_prefix}-jobs"
  max_message_size           = 1048576
  visibility_timeout_seconds = local.visibility_timeout_seconds
  message_retention_seconds  = local.message_retention_seconds
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "jobs_dlq" {
  queue_url = aws_sqs_queue.jobs_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.jobs.arn]
  })
}

data "aws_iam_policy_document" "jobs_queue" {
  count = local.has_jobs_queue_policy ? 1 : 0

  dynamic "statement" {
    for_each = local.has_configured_senders ? [local.jobs_sender_principals] : []

    content {
      sid    = "AllowConfiguredSenders"
      effect = "Allow"

      actions = ["sqs:SendMessage"]

      resources = [aws_sqs_queue.jobs.arn]

      principals {
        type        = "AWS"
        identifiers = statement.value
      }
    }
  }

  dynamic "statement" {
    for_each = local.organization_id_set ? [var.organization_id] : []

    content {
      sid    = "AllowOrganizationSenders"
      effect = "Allow"

      actions = ["sqs:SendMessage"]

      resources = [aws_sqs_queue.jobs.arn]

      principals {
        type        = "*"
        identifiers = ["*"]
      }

      condition {
        test     = "StringEquals"
        variable = "aws:PrincipalOrgID"
        values   = [statement.value]
      }
    }
  }
}

resource "aws_sqs_queue_policy" "jobs" {
  count = local.has_jobs_queue_policy ? 1 : 0

  queue_url = aws_sqs_queue.jobs.id
  policy    = data.aws_iam_policy_document.jobs_queue[0].json
}

resource "aws_sqs_queue" "smoke_results" {
  name                       = "${var.name_prefix}-smoke-results"
  message_retention_seconds  = 300
  visibility_timeout_seconds = local.worker_timeout_seconds
  sqs_managed_sse_enabled    = true
}

data "aws_iam_policy_document" "smoke_results_queue" {
  statement {
    sid    = "AllowWorkerSendResults"
    effect = "Allow"

    actions = ["sqs:SendMessage"]

    resources = [aws_sqs_queue.smoke_results.arn]

    principals {
      type        = "AWS"
      identifiers = [local.worker_role]
    }
  }

  statement {
    sid    = "AllowDeployRoleReadResults"
    effect = "Allow"

    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ]

    resources = [aws_sqs_queue.smoke_results.arn]

    principals {
      type        = "AWS"
      identifiers = [var.deploy_role_arn]
    }
  }
}

resource "aws_sqs_queue_policy" "smoke_results" {
  queue_url = aws_sqs_queue.smoke_results.id
  policy    = data.aws_iam_policy_document.smoke_results_queue.json

  # The policy names the worker role; create the role first so the principal
  # exists when SQS stores the policy.
  depends_on = [aws_iam_role.worker]
}

resource "aws_s3_bucket" "prints" {
  bucket = "${var.name_prefix}-prints"
}

resource "aws_s3_bucket_public_access_block" "prints" {
  bucket = aws_s3_bucket.prints.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "prints" {
  bucket = aws_s3_bucket.prints.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "prints" {
  bucket = aws_s3_bucket.prints.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prints" {
  bucket = aws_s3_bucket.prints.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.prints.arn
    }

    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "prints" {
  bucket = aws_s3_bucket.prints.id

  rule {
    id     = "expire-prints"
    status = "Enabled"

    filter {
      prefix = "prints/"
    }

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "prints_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.prints.arn,
      "${aws_s3_bucket.prints.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "prints" {
  bucket = aws_s3_bucket.prints.id
  policy = data.aws_iam_policy_document.prints_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.prints]
}
