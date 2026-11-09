data "aws_iam_policy_document" "prints_key" {
  statement {
    sid    = "EnableAccountAdministration"
    effect = "Allow"

    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowWorkerEncryptAndDecrypt"
    effect = "Allow"

    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]

    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [local.worker_role]
    }
  }

  statement {
    sid    = "AllowDeployRoleAdministration"
    effect = "Allow"

    actions = [
      "kms:CancelKeyDeletion",
      "kms:CreateAlias",
      "kms:DeleteAlias",
      "kms:DescribeKey",
      "kms:DisableKey",
      "kms:DisableKeyRotation",
      "kms:EnableKey",
      "kms:EnableKeyRotation",
      "kms:GetKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:ListResourceTags",
      "kms:PutKeyPolicy",
      "kms:ScheduleKeyDeletion",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:UpdateAlias",
      "kms:UpdateKeyDescription",
    ]

    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [var.deploy_role_arn]
    }
  }
}

resource "aws_kms_key" "prints" {
  description             = "Encrypts ${var.name_prefix} print objects at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.prints_key.json

  # Bootstrap scopes the deploy role's KMS identity policy with
  # aws:ResourceTag/Project, so the tag must be present on the key.
  tags = merge(var.tags, {
    Project = var.name_prefix
  })

  # KMS rejects principals that IAM has not propagated yet. Creating the role
  # first removes that retry window from the first apply.
  depends_on = [aws_iam_role.worker]
}

resource "aws_kms_alias" "prints" {
  name          = "alias/${var.name_prefix}-prints"
  target_key_id = aws_kms_key.prints.key_id
}
