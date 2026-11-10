# Contracts

- **Terraform input:** `job_rule = { bus_name = string, event_pattern = string }` or `null`.
  `bus_name` must be non-empty and a valid EventBridge bus name; `event_pattern` must be valid
  JSON. Invalid input fails validation before apply.
- **AWS resource contract:** an EventBridge rule on the named bus targets the existing jobs queue.
- **Queue policy:** `events.amazonaws.com` may call `sqs:SendMessage` only when
  `aws:SourceArn` equals the configured rule ARN.
- **Job contract:** unchanged. EventBridge events that match the pattern must carry a valid print
  job body; the worker applies the same schema, DLQ, callback and rendering path.
