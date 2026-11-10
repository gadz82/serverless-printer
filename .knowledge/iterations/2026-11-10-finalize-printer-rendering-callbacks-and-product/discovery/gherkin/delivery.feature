@final
Feature: Delivery channels and callback security
  Every documented channel delivers the result with the correct payload and failure handling, and
  HTTP callbacks are restricted.

  @req:R-203
  Scenario: HTTP delivery and ping
    Given an allowlisted HTTPS success URL
    When the worker delivers a result
    Then it POSTs JSON with X-Printer-Print-Id and a 5 second timeout
    And any 2xx counts as delivered
    And the ping is sent afterwards

  @req:R-203
  Scenario: Lambda, EventBridge and S3 deliver
    Given a lambda ARN, an EventBridge bus ARN or an S3 presigned PUT URL
    When the worker delivers a result
    Then it invokes, publishes or PUTs with the documented payload
    And the result carries the channel-specific fields

  @req:R-203
  Scenario: SQS FIFO and ping
    Given an SQS FIFO callback queue
    When the worker delivers a result
    Then MessageGroupId and MessageDeduplicationId follow the spec
    And the ping is sent after delivery

  @req:R-204
  Scenario: Allowlist and SSRF block dangerous URLs
    Given an HTTP callback or ping URL outside the allowlist or resolving to link-local/metadata
    When the worker validates it
    Then the job fails with CALLBACK_NOT_ALLOWED
    And no request is sent
