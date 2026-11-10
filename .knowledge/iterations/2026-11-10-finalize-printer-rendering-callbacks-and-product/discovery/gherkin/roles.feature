@final
Feature: Generated or provided caller and worker roles
  The deployer can generate both roles or provide existing ARNs, and the roles remain separated.

  @req:R-212
  @req:R-215
  @req:R-218
  Scenario: Generated roles are least privilege and output
    Given the default role modes
    When Terraform applies
    Then a caller role trusting the configured principals can only send to the jobs queue
    And a worker role trusts lambda.amazonaws.com and can publish only to callback targets
    And both ARNs are outputs

  @req:R-213
  @req:R-217
  Scenario: Provided roles are used without modification
    Given a provided caller role ARN and a provided same-account worker role ARN
    When Terraform applies
    Then the caller ARN is added to the jobs queue senders
    And the worker ARN is used for Lambda, KMS and the smoke queue
    And Terraform creates or modifies no IAM role or policy
    And bootstrap can pass the worker role to Lambda

  @req:R-216
  Scenario: Caller and worker roles cannot perform each other's actions
    Given the generated caller and worker roles
    When their policies are evaluated
    Then the caller cannot publish results to delivery channels
    And the worker cannot enqueue new jobs

  @req:R-210
  Scenario: The deploy role can manage the optional network
    Given the bootstrap policy is expanded
    When a VPC mode is applied through OIDC
    Then the deploy role can manage the VPC/subnets/endpoints/NAT
    And the worker role has the required ENI permissions
