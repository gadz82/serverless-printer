@completion
Feature: Optional network
  The worker can run outside a VPC by default or attach to a created or looked-up VPC.

  @req:R-106
  Scenario: The default mode creates no network
    Given vpc_mode is none
    When Terraform plan runs
    Then no VPC, subnets, NAT or endpoints are created
    And the worker has no VPC configuration

  @req:R-106
  Scenario: Create mode attaches the worker to private subnets
    Given vpc_mode is create
    When Terraform applies
    Then a VPC with private subnets is created
    And optional public subnets, NAT, S3 gateway and SQS/Lambda/Events endpoints are configured
    And the worker uses the private subnets and security group

  @req:R-106
  Scenario: Lookup mode uses an existing VPC
    Given vpc_mode is lookup and a VPC or subnet selector
    When Terraform applies
    Then the worker uses the resolved private subnets
    And no new VPC is created
