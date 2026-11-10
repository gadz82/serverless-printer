# Glossary

- **job_rule**: optional Terraform object `{ bus_name, event_pattern }` that enables EventBridge
  ingress to the jobs queue.
- **Event bus**: the named EventBridge bus the rule watches (`default` or a custom bus).
- **Event pattern**: the EventBridge JSON pattern selecting events that become print jobs.
- **Target**: the jobs SQS queue that receives matching events.
- **Queue-policy statement**: the resource policy allowing `events.amazonaws.com` to send only
  from the configured rule ARN.
