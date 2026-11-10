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
  name               = local.worker_name
  description        = "Render worker that consumes print jobs and stores PDFs"
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
      sid    = "SendCallbackResults"
      effect = "Allow"

      actions = ["sqs:SendMessage"]

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
  name   = "${local.worker_name}-policy"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}
