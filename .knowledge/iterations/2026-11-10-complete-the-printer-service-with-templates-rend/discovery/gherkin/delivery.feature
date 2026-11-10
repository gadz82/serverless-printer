@completion
Feature: Result delivery and callback security
  Every documented channel delivers the result with the correct payload and failure handling,
  and HTTP callbacks are restricted.

  @req:R-109
  Scenario: HTTP delivery posts the result
    Given an allowlisted HTTPS success URL
    When the worker delivers a result
    Then it POSTs JSON with X-Printer-Print-Id and a 5 second timeout
    And any 2xx counts as delivered
    And the ping is sent afterwards

  @req:R-109
  Scenario: Lambda, EventBridge and S3 deliver
    Given a lambda ARN, an EventBridge bus ARN or an S3 presigned PUT URL
    When the worker delivers a result
    Then it invokes, publishes or PUTs with the documented payload
    And the result carries the channel-specific fields

  @req:R-109
  Scenario: SQS FIFO and ping are correct
    Given an SQS FIFO callback queue
    When the worker delivers a result
    Then MessageGroupId and MessageDeduplicationId follow the spec
    And the ping is sent after delivery

  @req:R-110
  Scenario: The allowlist and SSRF checks block a dangerous URL
    Given an HTTP callback or ping URL outside the allowlist or resolving to a link-local/metadata address
    When the worker validates it
    Then the job fails with CALLBACK_NOT_ALLOWED
    And no request is sent
