# The lookup is the existence check for a provided worker role; its trust
# policy is checked by the role contract below. Cross-account ARNs are skipped
# so that precondition reports the actionable account error.
data "aws_iam_role" "provided_worker" {
  count = local.lookup_provided_worker ? 1 : 0

  name = local.provided_worker_role_name
}

# Cross-variable role validation lives here because Terraform variable
# validation conditions cannot reference other variables.
resource "terraform_data" "role_contract" {
  input = {
    caller_role_mode              = var.caller_role_mode
    caller_role_arn               = var.caller_role_arn
    caller_trusted_principal_arns = var.caller_trusted_principal_arns
    worker_role_mode              = var.worker_role_mode
    worker_role_arn               = var.worker_role_arn
  }

  lifecycle {
    precondition {
      condition     = var.caller_role_mode != "create" || var.caller_role_arn == null
      error_message = "caller_role_arn must be null when caller_role_mode is create; set caller_role_mode = \"existing\" to use a provided role."
    }

    precondition {
      condition     = var.caller_role_mode != "existing" || var.caller_role_arn != null
      error_message = "caller_role_arn is required when caller_role_mode is existing."
    }

    precondition {
      condition     = var.worker_role_mode != "create" || var.worker_role_arn == null
      error_message = "worker_role_arn must be null when worker_role_mode is create; set worker_role_mode = \"existing\" to use a provided role."
    }

    precondition {
      condition     = var.worker_role_mode != "existing" || var.worker_role_arn != null
      error_message = "worker_role_arn is required when worker_role_mode is existing."
    }

    precondition {
      condition = (
        var.worker_role_mode != "existing" ||
        var.worker_role_arn == null ||
        try(
          split(":", var.worker_role_arn)[1] == local.partition &&
          split(":", var.worker_role_arn)[4] == local.account_id,
          false,
        )
      )
      error_message = "worker_role_arn must be an IAM role in the current AWS account; Lambda execution roles cannot be cross-account."
    }

    precondition {
      condition = (
        var.worker_role_mode != "existing" ||
        var.worker_role_arn == null ||
        !local.lookup_provided_worker ||
        local.provided_worker_trusts_lambda
      )
      error_message = "worker_role_arn must exist in this account and its trust policy must allow lambda.amazonaws.com to assume it."
    }

    precondition {
      condition = (
        var.caller_role_mode != "existing" ||
        var.caller_role_arn != local.generated_worker_role_arn
      )
      error_message = "caller_role_arn must not be the generated worker role; the caller and worker roles must be separate."
    }

    precondition {
      condition = (
        var.worker_role_mode != "existing" ||
        var.worker_role_arn != local.generated_caller_role_arn
      )
      error_message = "worker_role_arn must not be the generated caller role; the caller and worker roles must be separate."
    }

    precondition {
      condition = (
        var.caller_role_mode != "existing" ||
        var.worker_role_mode != "existing" ||
        var.caller_role_arn != var.worker_role_arn
      )
      error_message = "caller_role_arn and worker_role_arn must be different IAM roles; a shared role merges caller and worker permissions."
    }
  }
}

data "aws_iam_policy_document" "caller_assume_role" {
  count = local.caller_role_created ? 1 : 0

  statement {
    sid     = "TrustedCallerPrincipals"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = local.caller_trusted_principal_arns
    }
  }
}

resource "aws_iam_role" "caller" {
  count = local.caller_role_created ? 1 : 0

  name               = local.caller_name
  description        = "Publishes print jobs to the ${var.name_prefix}-jobs queue"
  assume_role_policy = data.aws_iam_policy_document.caller_assume_role[0].json
}

data "aws_iam_policy_document" "caller" {
  count = local.caller_role_created ? 1 : 0

  statement {
    sid    = "SendJobs"
    effect = "Allow"

    actions = ["sqs:SendMessage"]

    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "caller" {
  count = local.caller_role_created ? 1 : 0

  name   = local.caller_name
  role   = aws_iam_role.caller[0].id
  policy = data.aws_iam_policy_document.caller[0].json
}

data "aws_iam_policy_document" "worker_assume_role" {
  statement {
    sid     = "LambdaService"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  count = local.worker_role_created ? 1 : 0

  name               = local.worker_name
  description        = "Render worker that consumes print jobs and publishes results"
  assume_role_policy = data.aws_iam_policy_document.worker_assume_role.json
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid    = "ConsumeJobsQueue"
    effect = "Allow"

    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ]

    resources = [aws_sqs_queue.jobs.arn]
  }

  dynamic "statement" {
    for_each = var.vpc_mode == "none" ? [] : [true]

    content {
      sid    = "ManageVpcNetworkInterfaces"
      effect = "Allow"

      # AWS documents these EC2 actions as requiring Resource "*" for Lambda
      # Hyperplane ENI management (AWSLambdaVPCAccessExecutionRole).
      # DescribeNetworkInterfaces and DescribeSubnets have no resource-level
      # permissions, and Lambda creates/deletes ENIs whose IDs Terraform does
      # not know in advance. ec2:Subnet and ec2:SecurityGroup conditions are
      # also not used because Lambda's documented VPC execution policy grants
      # these actions on all resources; narrowing them can stop ENI creation.
      actions = [
        "ec2:AssignPrivateIpAddresses",
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DescribeSubnets",
        "ec2:UnassignPrivateIpAddresses",
      ]

      resources = ["*"]
    }
  }

  statement {
    sid    = "ReadWritePrints"
    effect = "Allow"

    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetObject",
      "s3:PutObject",
    ]

    resources = ["${aws_s3_bucket.prints.arn}/prints/*"]
  }

  statement {
    sid    = "UsePrintsKey"
    effect = "Allow"

    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]

    resources = [aws_kms_key.prints.arn]
  }

  statement {
    sid    = "WriteWorkerLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = [
      aws_cloudwatch_log_group.worker.arn,
      "${aws_cloudwatch_log_group.worker.arn}:*",
    ]
  }

  dynamic "statement" {
    for_each = length(var.callback_target_arns) > 0 ? [var.callback_target_arns] : []

    content {
      sid    = "PublishCallbackResults"
      effect = "Allow"

      actions = [
        "events:PutEvents",
        "lambda:InvokeFunction",
        "sqs:SendMessage",
      ]

      resources = statement.value

      dynamic "condition" {
        for_each = local.organization_id_set ? [var.organization_id] : []

        content {
          test     = "StringEquals"
          variable = "aws:ResourceOrgID"
          values   = [condition.value]
        }
      }
    }
  }

  statement {
    sid    = "SendSmokeResults"
    effect = "Allow"

    actions = ["sqs:SendMessage"]

    resources = [aws_sqs_queue.smoke_results.arn]
  }
}

resource "aws_iam_role_policy" "worker" {
  count = local.worker_role_created ? 1 : 0

  name   = "${local.worker_name}-policy"
  role   = aws_iam_role.worker[0].id
  policy = data.aws_iam_policy_document.worker.json
}
