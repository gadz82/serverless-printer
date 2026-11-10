locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  state_bucket_arn     = aws_s3_bucket.state.arn
  artifacts_bucket_arn = aws_s3_bucket.artifacts.arn
  prints_bucket_arn    = "arn:${local.partition}:s3:::${var.name_prefix}-prints*"

  worker_role_arns = [
    "arn:${local.partition}:iam::${local.account_id}:role/${var.name_prefix}-*worker*",
    "arn:${local.partition}:iam::${local.account_id}:role/${var.name_prefix}-lambda*",
  ]

  caller_role_arns = [
    "arn:${local.partition}:iam::${local.account_id}:role/${var.name_prefix}-caller",
  ]

  worker_policy_arns = [
    "arn:${local.partition}:iam::${local.account_id}:policy/${var.name_prefix}-*worker*",
    "arn:${local.partition}:iam::${local.account_id}:policy/${var.name_prefix}-lambda*",
  ]

  # The network module creates VPCs, subnets, route tables, gateways, NAT
  # gateways, endpoints, security groups and Elastic IPs. These patterns scope
  # tag and delete permissions to the project's region and resource types.
  project_vpc_arns = [
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:vpc/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:subnet/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:route-table/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:internet-gateway/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:natgateway/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:vpc-endpoint/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:security-group/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:security-group-rule/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:elastic-ip/*",
  ]

  project_security_group_rule_arns = [
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:security-group-rule/*",
  ]

  project_security_group_arns = [
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:security-group/*",
    "arn:${local.partition}:ec2:${var.region}:${local.account_id}:security-group-rule/*",
  ]

  # Add the tag keys the main deployment applies to network resources here so
  # tag-on-create and tag updates stay restricted to a finite allowlist.
  project_tag_keys = distinct(concat(["Project", "Name", "Tier"], keys(var.tags)))

  lambda_function_arns = [
    "arn:${local.partition}:lambda:${var.region}:${local.account_id}:function:${var.name_prefix}-*",
    "arn:${local.partition}:lambda:${var.region}:${local.account_id}:function:${var.name_prefix}-*:*",
  ]

  lambda_event_source_mapping_arns = [
    "arn:${local.partition}:lambda:${var.region}:${local.account_id}:event-source-mapping:*",
  ]

  worker_log_group_arns = [
    "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.name_prefix}-*",
    "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.name_prefix}-*:*",
    "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:${var.name_prefix}-*",
    "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:${var.name_prefix}-*:*",
  ]

  alarm_arns = [
    "arn:${local.partition}:cloudwatch:${var.region}:${local.account_id}:alarm:${var.name_prefix}-*",
  ]
}

resource "terraform_data" "additional_worker_role_contract" {
  input = var.additional_worker_role_arns

  lifecycle {
    precondition {
      condition = alltrue([
        for arn in var.additional_worker_role_arns :
        try(
          split(":", arn)[1] == local.partition &&
          split(":", arn)[4] == local.account_id,
          false,
        )
      ])
      error_message = "additional_worker_role_arns must reference IAM roles in the current account and partition."
    }
  }
}

data "aws_iam_policy_document" "deploy_assume_role" {
  statement {
    sid     = "GitHubActionsMainBranch"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.deploy_subject]
    }
  }
}

data "aws_iam_policy_document" "plan_assume_role" {
  statement {
    sid     = "GitHubActionsPullRequest"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.plan_subject]
    }
  }
}

data "aws_iam_policy_document" "deploy_permissions" {
  statement {
    sid    = "ReadWriteTerraformState"
    effect = "Allow"

    actions = [
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]

    resources = [
      local.state_bucket_arn,
      "${local.state_bucket_arn}/*",
    ]
  }

  statement {
    sid    = "PublishReleaseArtifacts"
    effect = "Allow"

    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutObject",
    ]

    resources = [
      local.artifacts_bucket_arn,
      "${local.artifacts_bucket_arn}/*",
    ]
  }

  statement {
    sid    = "ManagePrintsBucket"
    effect = "Allow"

    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:DeleteBucketWebsite",
      "s3:GetAccelerateConfiguration",
      "s3:GetBucketAcl",
      "s3:GetBucketCORS",
      "s3:GetBucketLocation",
      "s3:GetBucketLogging",
      "s3:GetBucketNotification",
      "s3:GetBucketObjectLockConfiguration",
      "s3:GetBucketOwnershipControls",
      "s3:GetBucketPolicy",
      "s3:GetBucketPolicyStatus",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketRequestPayment",
      "s3:GetBucketTagging",
      "s3:GetBucketVersioning",
      "s3:GetBucketWebsite",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutAccelerateConfiguration",
      "s3:PutBucketCORS",
      "s3:PutBucketLogging",
      "s3:PutBucketNotification",
      "s3:PutBucketObjectLockConfiguration",
      "s3:PutBucketOwnershipControls",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketRequestPayment",
      "s3:PutBucketTagging",
      "s3:PutBucketVersioning",
      "s3:PutBucketWebsite",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutReplicationConfiguration",
    ]

    resources = [
      local.prints_bucket_arn,
      "${local.prints_bucket_arn}/*",
    ]
  }

  statement {
    sid    = "ManageJobsQueues"
    effect = "Allow"

    actions = [
      "sqs:CreateQueue",
      "sqs:DeleteQueue",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ListQueueTags",
      "sqs:SetQueueAttributes",
      "sqs:TagQueue",
      "sqs:UntagQueue",
    ]

    resources = [
      "arn:${local.partition}:sqs:${var.region}:${local.account_id}:${var.name_prefix}-*",
    ]
  }

  # The release smoke test sends one job and polls the smoke-results queue.
  statement {
    sid    = "SendReleaseSmokeJobs"
    effect = "Allow"

    actions = [
      "sqs:GetQueueAttributes",
      "sqs:SendMessage",
    ]

    resources = [
      "arn:${local.partition}:sqs:${var.region}:${local.account_id}:${var.name_prefix}-jobs",
    ]
  }

  statement {
    sid    = "ReadReleaseSmokeResults"
    effect = "Allow"

    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ]

    resources = [
      "arn:${local.partition}:sqs:${var.region}:${local.account_id}:${var.name_prefix}-*smoke*",
    ]
  }

  statement {
    sid       = "CreateProjectKmsKeys"
    effect    = "Allow"
    actions   = ["kms:CreateKey"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.name_prefix]
    }
  }

  # ListAliases has no resource-level or condition-key support.
  statement {
    sid       = "ListKmsAliases"
    effect    = "Allow"
    actions   = ["kms:ListAliases"]
    resources = ["*"]
  }

  # KMS authorization requires both the key policy and the caller identity
  # policy. The main module tags the key with Project=<name_prefix> and grants
  # this role in the key policy; the resource-tag condition keeps identity
  # permissions on the project key rather than every CMK in the account.
  statement {
    sid    = "ManageProjectKmsKeys"
    effect = "Allow"

    actions = [
      "kms:CancelKeyDeletion",
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
      "kms:UpdateKeyDescription",
    ]

    resources = ["arn:${local.partition}:kms:${var.region}:${local.account_id}:key/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }
  }

  # Tagging is limited to keys that already carry the project tag; CreateKey
  # sends the initial Project tag in the same request. Requiring both the
  # existing and requested tag prevents tagging an unrelated account key and
  # then administering it through ManageProjectKmsKeys.
  statement {
    sid       = "TagProjectKmsKeys"
    effect    = "Allow"
    actions   = ["kms:TagResource"]
    resources = ["arn:${local.partition}:kms:${var.region}:${local.account_id}:key/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.name_prefix]
    }
  }

  statement {
    sid    = "ManageProjectKmsAliases"
    effect = "Allow"

    actions = [
      "kms:CreateAlias",
      "kms:DeleteAlias",
      "kms:UpdateAlias",
    ]

    # Alias operations do not support KMS condition keys. The alias name is the
    # project scope; key/* is required because CreateAlias and UpdateAlias are
    # authorized against both the alias and its target key.
    resources = [
      "arn:${local.partition}:kms:${var.region}:${local.account_id}:alias/${var.name_prefix}-*",
      "arn:${local.partition}:kms:${var.region}:${local.account_id}:key/*",
    ]
  }

  statement {
    sid    = "ManageRenderWorkerLambda"
    effect = "Allow"

    actions = [
      "lambda:AddPermission",
      "lambda:CreateAlias",
      "lambda:CreateFunction",
      "lambda:DeleteAlias",
      "lambda:DeleteEventSourceMapping",
      "lambda:DeleteFunction",
      "lambda:DeleteFunctionConcurrency",
      "lambda:DeleteFunctionEventInvokeConfig",
      "lambda:GetAlias",
      "lambda:GetEventSourceMapping",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:GetFunctionConcurrency",
      "lambda:GetFunctionConfiguration",
      "lambda:GetFunctionEventInvokeConfig",
      "lambda:GetFunctionRecursionConfig",
      "lambda:GetPolicy",
      "lambda:GetRuntimeManagementConfig",
      "lambda:ListAliases",
      "lambda:ListTags",
      "lambda:ListVersionsByFunction",
      "lambda:PublishVersion",
      "lambda:PutFunctionConcurrency",
      "lambda:PutFunctionEventInvokeConfig",
      "lambda:PutFunctionRecursionConfig",
      "lambda:PutRuntimeManagementConfig",
      "lambda:RemovePermission",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateAlias",
      "lambda:UpdateEventSourceMapping",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:UpdateFunctionEventInvokeConfig",
    ]

    resources = concat(
      local.lambda_function_arns,
      local.lambda_event_source_mapping_arns,
    )
  }

  # EC2 create authorization is all-or-nothing: the resource does not exist
  # yet. The create request must carry the Project tag; tag keys are limited by
  # TagProjectVpcResourcesOnCreate below.
  statement {
    sid    = "CreateProjectVpcResources"
    effect = "Allow"

    actions = [
      "ec2:AllocateAddress",
      "ec2:CreateInternetGateway",
      "ec2:CreateNatGateway",
      "ec2:CreateRouteTable",
      "ec2:CreateSecurityGroup",
      "ec2:CreateSubnet",
      "ec2:CreateVpc",
      "ec2:CreateVpcEndpoint",
    ]

    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  # Mutating actions are scoped to the project's EC2 resource ARNs and require
  # the Project tag on the target resource. The ARN list includes every type
  # these actions can authorize against, including referenced subnets and
  # security groups.
  statement {
    sid    = "ConfigureProjectVpcResources"
    effect = "Allow"

    actions = [
      "ec2:AssociateRouteTable",
      "ec2:AttachInternetGateway",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateRoute",
      "ec2:DeleteRoute",
      "ec2:DetachInternetGateway",
      "ec2:DisassociateRouteTable",
      "ec2:ModifySubnetAttribute",
      "ec2:ModifyVpcAttribute",
      "ec2:ModifyVpcEndpoint",
      "ec2:ReleaseAddress",
      "ec2:ReplaceRoute",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
    ]

    resources = local.project_vpc_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  # ModifySecurityGroupRules operates on rule ARNs, which are not covered by
  # the security-group resource statement above. Scope it to project rule ARNs
  # and require the project tag and region.
  statement {
    sid       = "ModifyProjectSecurityGroupRules"
    effect    = "Allow"
    actions   = ["ec2:ModifySecurityGroupRules"]
    resources = local.project_security_group_rule_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  # Deletion is scoped by the Project tag on every taggable network resource.
  statement {
    sid    = "DeleteProjectVpcResources"
    effect = "Allow"

    actions = [
      "ec2:DeleteInternetGateway",
      "ec2:DeleteNatGateway",
      "ec2:DeleteRouteTable",
      "ec2:DeleteSecurityGroup",
      "ec2:DeleteSubnet",
      "ec2:DeleteVpc",
      "ec2:DeleteVpcEndpoints",
    ]

    resources = local.project_vpc_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  # Describe actions have no resource-level permissions. Describe* calls are
  # read-only and are also needed for vpc_mode = lookup and VPC endpoint
  # creation (DescribePrefixLists).
  statement {
    sid    = "DescribeProjectVpcResources"
    effect = "Allow"

    actions = [
      "ec2:DescribeAddresses",
      "ec2:DescribeAddressesAttribute",
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeInternetGateways",
      "ec2:DescribeNatGateways",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribePrefixLists",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroupRules",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeTags",
      "ec2:DescribeVpcAttribute",
      "ec2:DescribeVpcEndpointServices",
      "ec2:DescribeVpcEndpoints",
      "ec2:DescribeVpcs",
    ]

    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  # Tag-on-create is limited to the project's own create actions and tag keys.
  # This prevents CreateTags from being used to mark an unrelated resource as
  # part of the project.
  statement {
    sid       = "TagProjectVpcResourcesOnCreate"
    effect    = "Allow"
    actions   = ["ec2:CreateTags"]
    resources = local.project_vpc_arns

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "aws:TagKeys"
      values   = local.project_tag_keys
    }

    condition {
      test     = "StringEquals"
      variable = "ec2:CreateAction"
      values = [
        "AllocateAddress",
        "AuthorizeSecurityGroupEgress",
        "AuthorizeSecurityGroupIngress",
        "CreateInternetGateway",
        "CreateNatGateway",
        "CreateRouteTable",
        "CreateSecurityGroup",
        "CreateSubnet",
        "CreateVpc",
        "CreateVpcEndpoint",
      ]
    }
  }

  # AuthorizeSecurityGroupIngress/Egress can carry TagSpecifications for new
  # rules. The ConfigureProjectVpcResources statement above authorizes the
  # security-group change itself; this statement covers the tag-on-create
  # portion using the same project tag and key restrictions.
  statement {
    sid    = "AuthorizeProjectSecurityGroupRulesWithTags"
    effect = "Allow"

    actions = [
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
    ]

    resources = concat(local.project_security_group_arns, local.project_security_group_rule_arns)

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "aws:TagKeys"
      values   = local.project_tag_keys
    }
  }

  # Tag changes require the resource to already be in the project scope. Tag
  # keys are limited to the project set, so tag-only updates do not need to
  # resend the Project tag.
  statement {
    sid       = "TagProjectVpcResources"
    effect    = "Allow"
    actions   = ["ec2:CreateTags"]
    resources = local.project_vpc_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "aws:TagKeys"
      values   = local.project_tag_keys
    }
  }

  statement {
    sid       = "UntagProjectVpcResources"
    effect    = "Allow"
    actions   = ["ec2:DeleteTags"]
    resources = local.project_vpc_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.name_prefix]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "aws:TagKeys"
      values   = local.project_tag_keys
    }
  }

  # CreateEventSourceMapping has no resource-level permission and is authorized
  # against "*" with the target function ARN as the condition.
  statement {
    sid       = "CreateRenderWorkerEventSourceMappings"
    effect    = "Allow"
    actions   = ["lambda:CreateEventSourceMapping"]
    resources = ["*"]

    condition {
      test     = "ArnLike"
      variable = "lambda:FunctionArn"
      values   = ["arn:${local.partition}:lambda:${var.region}:${local.account_id}:function:${var.name_prefix}-*"]
    }
  }

  # Read-only access lets the main module resolve the deploy role when it
  # builds the KMS key policy without granting control over bootstrap roles.
  statement {
    sid    = "ReadBootstrapRoles"
    effect = "Allow"

    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
    ]

    resources = [
      "arn:${local.partition}:iam::${local.account_id}:role/${var.name_prefix}-deploy",
      "arn:${local.partition}:iam::${local.account_id}:role/${var.name_prefix}-plan",
    ]
  }

  statement {
    sid    = "ManagePrinterRoles"
    effect = "Allow"

    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePermissionsBoundary",
      "iam:DeleteRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
    ]

    resources = concat(local.worker_role_arns, local.caller_role_arns)
  }

  # The main module reads provided worker roles to validate their existence and
  # trust policy, but must not be able to modify them.
  dynamic "statement" {
    for_each = length(var.additional_worker_role_arns) > 0 ? [var.additional_worker_role_arns] : []

    content {
      sid       = "ReadAdditionalWorkerRoles"
      effect    = "Allow"
      actions   = ["iam:GetRole"]
      resources = statement.value
    }
  }

  statement {
    sid    = "ManageRenderWorkerPolicies"
    effect = "Allow"

    actions = [
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyTags",
      "iam:ListPolicyVersions",
      "iam:SetDefaultPolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
    ]

    resources = local.worker_policy_arns
  }

  statement {
    sid    = "AttachRenderWorkerPolicies"
    effect = "Allow"

    actions = [
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
    ]

    resources = concat(
      local.worker_role_arns,
      local.worker_policy_arns,
      [
        "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
      ],
    )
  }

  statement {
    sid     = "PassRenderWorkerRoleToLambda"
    effect  = "Allow"
    actions = ["iam:PassRole"]

    resources = distinct(concat(local.worker_role_arns, var.additional_worker_role_arns))

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid    = "ManageRenderWorkerLogGroups"
    effect = "Allow"

    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:DeleteRetentionPolicy",
      "logs:ListTagsForResource",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
    ]

    resources = local.worker_log_group_arns
  }

  # DescribeLogGroups has no resource-level permission and is used by the
  # provider's log-group read path.
  statement {
    sid       = "DescribeRenderWorkerLogGroups"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid    = "ManagePrinterAlarms"
    effect = "Allow"

    actions = [
      "cloudwatch:DeleteAlarms",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]

    resources = local.alarm_arns
  }
}

data "aws_iam_policy_document" "plan_state_access" {
  statement {
    sid    = "ReadTerraformStateBucket"
    effect = "Allow"

    actions = [
      "s3:GetBucketLocation",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetObject",
      "s3:ListBucket",
    ]

    resources = [
      local.state_bucket_arn,
      "${local.state_bucket_arn}/*",
    ]
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name_prefix}-deploy"
  description        = "Deploys the ${var.name_prefix} stack from ${var.github_owner}/${var.github_repo} main"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume_role.json
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name_prefix}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_permissions.json
}

resource "aws_iam_role" "plan" {
  name               = "${var.name_prefix}-plan"
  description        = "Read-only Terraform plan for pull requests in ${var.github_owner}/${var.github_repo}"
  assume_role_policy = data.aws_iam_policy_document.plan_assume_role.json
}

# The plan role stays read-only. Native S3 locking writes <state-key>.tflock even
# during a plan, so CI must plan with -lock=false or grant that single object.
resource "aws_iam_role_policy" "plan_state_access" {
  name   = "${var.name_prefix}-plan-state-read"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state_access.json
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}
