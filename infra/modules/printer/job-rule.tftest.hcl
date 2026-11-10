mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  mock_data "aws_region" {
    defaults = {
      region = "eu-central-1"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

run "default_is_disabled" {
  command = plan

  variables {
    name_prefix      = "printer"
    deploy_role_arn  = "arn:aws:iam::123456789012:role/printer-deploy"
    artifacts_bucket = "printer-artifacts"
    release          = "test"
  }

  assert {
    condition     = length(aws_cloudwatch_event_rule.jobs) == 0
    error_message = "job_rule null must not create an EventBridge rule"
  }

  assert {
    condition     = length(aws_cloudwatch_event_target.jobs) == 0
    error_message = "job_rule null must not create an EventBridge target"
  }
}

run "configured_forwards_to_jobs_queue" {
  command = plan

  variables {
    name_prefix      = "printer"
    deploy_role_arn  = "arn:aws:iam::123456789012:role/printer-deploy"
    artifacts_bucket = "printer-artifacts"
    release          = "test"
    job_rule = {
      bus_name      = "default"
      event_pattern = "{\"source\":[\"my.app\"]}"
    }
  }

  assert {
    condition     = length(aws_cloudwatch_event_rule.jobs) == 1
    error_message = "configured job_rule must create one EventBridge rule"
  }

  assert {
    condition     = aws_cloudwatch_event_target.jobs[0].rule == aws_cloudwatch_event_rule.jobs[0].name
    error_message = "the EventBridge target must reference the created rule"
  }

  assert {
    condition     = aws_cloudwatch_event_target.jobs[0].event_bus_name == "default"
    error_message = "the EventBridge target must use the configured bus"
  }

  assert {
    condition     = aws_cloudwatch_event_target.jobs[0].input_path == "$.detail"
    error_message = "the EventBridge target must forward the event detail as the job body"
  }

  assert {
    condition     = aws_cloudwatch_event_rule.jobs[0].event_bus_name == "default"
    error_message = "the EventBridge rule must use the configured bus"
  }

  assert {
    condition     = aws_cloudwatch_event_rule.jobs[0].event_pattern == "{\"source\":[\"my.app\"]}"
    error_message = "the EventBridge rule must keep the configured event pattern"
  }
}

run "rejects_empty_bus_name" {
  command = plan

  variables {
    name_prefix      = "printer"
    deploy_role_arn  = "arn:aws:iam::123456789012:role/printer-deploy"
    artifacts_bucket = "printer-artifacts"
    release          = "test"
    job_rule = {
      bus_name      = ""
      event_pattern = "{}"
    }
  }

  expect_failures = [var.job_rule]
}

run "rejects_malformed_pattern" {
  command = plan

  variables {
    name_prefix      = "printer"
    deploy_role_arn  = "arn:aws:iam::123456789012:role/printer-deploy"
    artifacts_bucket = "printer-artifacts"
    release          = "test"
    job_rule = {
      bus_name      = "default"
      event_pattern = "not-json"
    }
  }

  expect_failures = [var.job_rule]
}

run "rejects_invalid_bus_characters" {
  command = plan

  variables {
    name_prefix      = "printer"
    deploy_role_arn  = "arn:aws:iam::123456789012:role/printer-deploy"
    artifacts_bucket = "printer-artifacts"
    release          = "test"
    job_rule = {
      bus_name      = "bad bus name"
      event_pattern = "{}"
    }
  }

  expect_failures = [var.job_rule]
}

run "rejects_non_object_pattern" {
  command = plan

  variables {
    name_prefix      = "printer"
    deploy_role_arn  = "arn:aws:iam::123456789012:role/printer-deploy"
    artifacts_bucket = "printer-artifacts"
    release          = "test"
    job_rule = {
      bus_name      = "default"
      event_pattern = "[]"
    }
  }

  expect_failures = [var.job_rule]
}
